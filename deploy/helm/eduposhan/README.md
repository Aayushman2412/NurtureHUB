# EduPoshan Helm chart

The Kubernetes shape from [`deploy/scale/ARCHITECTURE_300K.md`](../../scale/ARCHITECTURE_300K.md).
There is one backend image, and the role of each pod comes from its command and settings.

| Workload | Kind | Gets | Scales |
|---|---|---|---|
| `api` | StatefulSet | `/api/*` except admin | HPA 4 → 48 on CPU |
| `realtime` | StatefulSet | `/ws/*` (live monitoring, proctoring) | HPA 2 → 20, pre-scaled for exams |
| `admin` | StatefulSet, 1 pod | `/api/admin/*`, `/uploads/*`; owns the pipeline volume | fixed |
| `worker` | StatefulSet | leased jobs (`python -m app.worker`) | fixed |
| `frontend` | Deployment | `/` (the SPA origin behind Cloudflare) | HPA 2 → 6 |
| `migrate` | Job, pre-install/pre-upgrade hook | `python -m app.migrate` | once per release |

The optional pieces are off by default:
- **PgBouncer** (`pgbouncer.enabled`), for a managed Postgres.
- **NetworkPolicies** (`networkPolicy.enabled`).

Postgres inside the cluster is deliberately **not** in this chart. It lives in
[`deploy/k8s/cloudnativepg.yaml`](../../k8s/cloudnativepg.yaml), applied once
beforehand. The migration hook runs before any of this release's resources
exist, and `helm uninstall` must never be able to reach the data.

## What the cluster needs first
- Kubernetes ≥ 1.29 with metrics-server (for the autoscalers) and a default StorageClass.
- A **Gateway API** implementation with a `Gateway` that terminates TLS for the
  public host. Envoy Gateway is the portable default. ingress-nginx was retired
  in March 2026; for a cluster with another Ingress controller, set
  `gateway.enabled=false` and `ingress.enabled=true`.
- Postgres 16, either managed (India region) or through the CloudNativePG operator
  (`deploy/k8s/cloudnativepg.yaml`).
- Redis or Valkey, highly available behind one address.
- An R2 or S3-compatible bucket for media. The chart refuses to render without one.
- Cloudflare in front, with the origin locked to it (next section).

## Lock the origin to Cloudflare
The default values trust `cf-connecting-ip` (`CLIENT_IP_HEADER`). That header
becomes the audit trail's source address and the rate-limit bucket. Cloudflare
overwrites it on every request, but a client that reaches the Gateway directly
can write whatever it likes there. So nothing may reach the origin except
through Cloudflare. Use either of:

1. **Cloudflare Tunnel** (preferred). Run `cloudflared` in the cluster, pointed
   at the Gateway's internal Service, and give the Gateway no public load
   balancer. With no public origin, there is nothing to go around.
2. **Load-balancer source ranges.** Restrict the Gateway's LoadBalancer Service
   (`loadBalancerSourceRanges`, or your cloud's firewall) to Cloudflare's
   published IP ranges, keep that list current, and enable `networkPolicy` so
   pods accept traffic only from the Gateway.

If neither is in place, unset `CLIENT_IP_HEADER` *and* `TRUST_PROXY_HEADERS`.
Every caller then shares the Gateway's address, which is honest but useless for
limits. The app also rejects any reported value that isn't an IP address.

## The Secret
Create one Secret, named in `secret.name`, outside the chart: with External
Secrets from your vault, or with `kubectl create secret generic --from-env-file`
using a file that never enters git. The chart reads these keys and never stores
a value:

| Key | What it is |
|---|---|
| `DATABASE_URL` | Through the pooler, e.g. `postgresql://…@eduposhan-pgbouncer:6432/eduposhan` |
| `DIRECT_DATABASE_URL` | The primary itself. Only the migration Job uses it (advisory lock + DDL). |
| `JWT_SECRET_KEY`, `AUDIT_HMAC_KEY` | Different values, each ≥ 32 characters |
| `PHI_ENCRYPTION_KEYS`, `PHI_ENCRYPTION_ACTIVE_KEY`, `PHI_INDEX_KEY` | The field-encryption key ring and blind-index key |
| `REDIS_URL`, `RATE_LIMIT_STORAGE_URI` | e.g. `redis://…:6379/0` and `/1` |
| `SMTP_USER`, `SMTP_PASSWORD` | OTP mail |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Media storage. The bucket and public URL go in `media.r2`. |

## Install / upgrade

```bash
helm upgrade --install eduposhan deploy/helm/eduposhan -n eduposhan --create-namespace -f prod.yaml --set image.tag=sha-<commit>
```

A minimal `prod.yaml`:

```yaml
publicHost: eduposhan.example.org
gateway:
  parentRefs: [{ name: public, namespace: gateway-system, sectionName: https }]
media:
  r2: { bucket: eduposhan-media, publicBaseUrl: https://media.eduposhan.example.org }
pgbouncer:
  enabled: true
  image: { tag: "<a version you verified>" }
  serverHost: <primary address>
env:
  ORG_LEGAL_NAME: "<legal name>"
  DPO_NAME: "<name>"
  DPO_EMAIL: "<address>"
```

What a release does:
1. The **migrate Job** runs first. A database newer than the code (a rollback)
   counts as nothing to do. A failure stops the release before any pod changes.
2. The **StatefulSets roll one pod at a time**. A new pod checks the schema at
   boot: it refuses to start if the code is newer than the database, and starts
   with a warning if it's older.
3. A pod gets traffic only once `/readyz` passes. Liveness (`/healthz`) checks
   nothing beyond the process itself, so a database outage never restarts the
   fleet.

Every probe sends `Host: <publicHost>`. With `ALLOWED_HOSTS` set, a probe
arriving as the pod's IP would get a 400, and the pod would never become ready.

## Exam day
Apply `values-exam-day.yaml` about an hour before candidates arrive, and drop it
afterwards. Autoscaling can't move a WebSocket that is already open, so the
sockets must find their pods waiting.

## Known limits (Phase 1)
- Rollouts of the serving StatefulSets are sequential, about 30 s per pod. At
  peak (~40 api pods) a full rollout takes ~20 minutes, and at the 4-pod floor
  about two. They can become Deployments once the audit spool moves off the pod
  (Phase 2).
- An audit spool left on a scaled-down pod's volume is re-ingested only when
  that pod ordinal comes back.
- The worker's liveness is a heartbeat file (`/tmp/eduposhan-worker.heartbeat`,
  written every 20 s). Its loops log errors and carry on rather than exit, so a
  heartbeat older than 90 s gets the pod restarted.
- The realtime autoscaler waits 30 minutes before scaling down
  (`scaleDownStabilizationSeconds`). Scale-down removes the highest-numbered
  pods, and those hold sockets. Clients reconnect, but mid-exam that is churn
  nobody needs.
- Pipeline runs record their owner as host + PID. A StatefulSet keeps its pod
  name across restarts while PIDs start again, so after a restart of the admin
  pod an interrupted run can look alive until `PIPELINE_RUN_TIMEOUT_MINUTES`
  passes. It is bounded, and it is the same as a `docker restart` today. The fix
  is to record the process start time too.
- The frontend uses the official nginx image, which starts as root. Moving to
  an unprivileged nginx is a follow-up.
- This chart has not been rendered with `helm` on the development machine yet,
  because Helm isn't installed there. Run `helm lint` and `helm template … | kubeconform`
  before the first install.

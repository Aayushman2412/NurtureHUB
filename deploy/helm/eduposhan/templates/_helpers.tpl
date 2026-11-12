{{/*
Shared names, labels and settings. Component templates call these with a dict:
  (dict "root" $ "component" "api")
*/}}

{{- define "eduposhan.fullname" -}}
{{- default .Release.Name .Values.fullnameOverride | trunc 40 | trimSuffix "-" -}}
{{- end -}}

{{- define "eduposhan.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "eduposhan.selectorLabels" -}}
app.kubernetes.io/name: eduposhan
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "eduposhan.labels" -}}
{{ include "eduposhan.selectorLabels" . }}
app.kubernetes.io/part-of: eduposhan
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
app.kubernetes.io/version: {{ .root.Values.image.tag | quote }}
helm.sh/chart: {{ include "eduposhan.chart" .root }}
{{- end -}}

{{/* (dict "root" $ "name" "backend") -> registry/backend:tag */}}
{{- define "eduposhan.image" -}}
{{- $tag := required "image.tag is required: the sha-<commit> tag CI pushed (never latest)" .root.Values.image.tag -}}
{{- printf "%s/%s:%s" .root.Values.image.registry .name $tag -}}
{{- end -}}

{{/* The Host header every probe sends; see publicHost in values.yaml. */}}
{{- define "eduposhan.probeHeaders" -}}
httpHeaders:
  - name: Host
    value: {{ .Values.publicHost | quote }}
{{- end -}}

{{/* Environment shared by every backend process (takes the root context). */}}
{{- define "eduposhan.backendEnv" -}}
- name: POD_NAME
  valueFrom:
    fieldRef:
      fieldPath: metadata.name
- name: ALLOWED_HOSTS
  value: {{ join "," (prepend (default (list) .Values.extraAllowedHosts) .Values.publicHost) | quote }}
- name: CORS_ORIGINS
  value: {{ printf "https://%s" .Values.publicHost | quote }}
- name: PUBLIC_BASE_URL
  value: {{ printf "https://%s" .Values.publicHost | quote }}
- name: AUDIT_SPOOL_PATH
  value: /data/audit_spool/audit_spool.jsonl
{{- with .Values.media.r2 }}
{{- if .bucket }}
- name: R2_BUCKET
  value: {{ .bucket | quote }}
- name: R2_PUBLIC_BASE_URL
  value: {{ required "media.r2.publicBaseUrl is required with media.r2.bucket" .publicBaseUrl | quote }}
{{- end }}
{{- end }}
{{- range $name, $value := .Values.env }}
{{- /* Empty = unset, so the app's own default applies (an empty variable would override it). */}}
{{- if ne (toString $value) "" }}
- name: {{ $name }}
  value: {{ $value | quote }}
{{- end }}
{{- end }}
{{- end -}}

{{/* The role switches (backend/app/config.py, "Process roles"). Takes (dict "role" ...). */}}
{{- define "eduposhan.roleEnv" -}}
- name: RUN_MIGRATIONS_ON_START
  value: "false"
- name: RUN_BACKGROUND_TASKS
  value: "false"
- name: OWNS_PIPELINE_RUNS
  value: {{ ternary "true" "false" (eq .role "admin") | quote }}
{{- if eq .role "admin" }}
- name: PIPELINE_DATA_DIR
  value: /data/pipeline_data
{{- end }}
{{- end -}}

{{/* Refuse to render a release that would misbehave once it has several pods. */}}
{{- define "eduposhan.validate" -}}
{{- if not .Values.publicHost -}}
{{- fail "publicHost is required: the host the platform is served at" -}}
{{- end -}}
{{- if and (not .Values.media.r2.bucket) (not .Values.media.allowLocalUploads) -}}
{{- fail "media.r2.bucket is required: with several pods a learner's photo would land on whichever pod took the upload. Set media.allowLocalUploads=true only for a single-pod trial." -}}
{{- end -}}
{{- if and .Values.gateway.enabled (not .Values.gateway.parentRefs) -}}
{{- fail "gateway.parentRefs is required with gateway.enabled: name the Gateway this route attaches to" -}}
{{- end -}}
{{- end -}}

{{/* Spread a component's pods across zones first, then nodes. Takes the label context. */}}
{{- define "eduposhan.spread" -}}
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        {{- include "eduposhan.selectorLabels" . | nindent 8 }}
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        {{- include "eduposhan.selectorLabels" . | nindent 8 }}
{{- end -}}

{{/* HorizontalPodAutoscaler. Takes (dict "root" $ "role" "api" "cfg" .Values.api "kind" "StatefulSet"). */}}
{{- define "eduposhan.hpa" -}}
{{- if .cfg.autoscaling.enabled }}
{{- $name := printf "%s-%s" (include "eduposhan.fullname" .root) .role }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ $name }}
  labels:
    {{- include "eduposhan.labels" (dict "root" .root "component" .role) | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: {{ .kind }}
    name: {{ $name }}
  minReplicas: {{ .cfg.autoscaling.minReplicas }}
  maxReplicas: {{ .cfg.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .cfg.autoscaling.targetCPUUtilizationPercentage }}
  behavior:
    # Up fast — a test going live is a cliff, not a slope. Down slowly.
    scaleUp:
      stabilizationWindowSeconds: 0
      selectPolicy: Max
      policies:
        - type: Percent
          value: 100
          periodSeconds: 30
        - type: Pods
          value: 4
          periodSeconds: 30
    scaleDown:
      stabilizationWindowSeconds: {{ .cfg.autoscaling.scaleDownStabilizationSeconds | default 300 }}
      policies:
        - type: Percent
          value: 20
          periodSeconds: 60
{{- end }}
{{- end -}}

{{/* PodDisruptionBudget: drains take one pod of a component at a time. Takes (dict "root" $ "role" "api"). */}}
{{- define "eduposhan.pdb" -}}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ printf "%s-%s" (include "eduposhan.fullname" .root) .role }}
  labels:
    {{- include "eduposhan.labels" (dict "root" .root "component" .role) | nindent 4 }}
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      {{- include "eduposhan.selectorLabels" (dict "root" .root "component" .role) | nindent 6 }}
{{- end -}}

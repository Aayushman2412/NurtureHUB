{{/*
One backend role: its Services and its StatefulSet.
Takes (dict "root" $ "role" "api" "cfg" .Values.api).

A StatefulSet, not a Deployment, because each pod keeps a small volume for the
audit spool: events written while the database is unreachable must survive the
pod being replaced (ARCHITECTURE_300K.md §3 #12). It also gives each pod a
stable name, which is the host in its audit chain key. The cost is that
rollouts go one pod at a time; once the spool moves off the pod (Phase 2) the
serving roles can become Deployments.
*/}}
{{- define "eduposhan.backend" -}}
{{- $root := .root -}}
{{- $role := .role -}}
{{- $cfg := .cfg -}}
{{- $name := printf "%s-%s" (include "eduposhan.fullname" $root) $role -}}
{{- $ctx := dict "root" $root "component" $role -}}
{{- $serves := ne $role "worker" -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ $name }}-pods
  labels:
    {{- include "eduposhan.labels" $ctx | nindent 4 }}
spec:
  clusterIP: None
  publishNotReadyAddresses: true
  selector:
    {{- include "eduposhan.selectorLabels" $ctx | nindent 4 }}
  {{- if $serves }}
  ports:
    - name: http
      port: 8000
      targetPort: http
  {{- end }}
{{- if $serves }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ $name }}
  labels:
    {{- include "eduposhan.labels" $ctx | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "eduposhan.selectorLabels" $ctx | nindent 4 }}
  ports:
    - name: http
      port: 8000
      targetPort: http
{{- end }}
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {{ $name }}
  labels:
    {{- include "eduposhan.labels" $ctx | nindent 4 }}
spec:
  serviceName: {{ $name }}-pods
  podManagementPolicy: Parallel
  {{- if not $cfg.autoscaling.enabled }}
  replicas: {{ $cfg.replicas }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "eduposhan.selectorLabels" $ctx | nindent 6 }}
  updateStrategy:
    type: RollingUpdate
  persistentVolumeClaimRetentionPolicy:
    whenDeleted: Retain
    whenScaled: Retain
  template:
    metadata:
      labels:
        {{- include "eduposhan.labels" $ctx | nindent 8 }}
    spec:
      serviceAccountName: {{ include "eduposhan.fullname" $root }}
      automountServiceAccountToken: false
      {{- with $root.Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      terminationGracePeriodSeconds: {{ $cfg.terminationGracePeriodSeconds }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        fsGroupChangePolicy: OnRootMismatch
        seccompProfile:
          type: RuntimeDefault
      {{- include "eduposhan.spread" $ctx | nindent 6 }}
      {{- with $cfg.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $cfg.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      containers:
        - name: {{ $role }}
          image: {{ include "eduposhan.image" (dict "root" $root "name" "backend") }}
          imagePullPolicy: {{ $root.Values.image.pullPolicy }}
          {{- if $serves }}
          command:
            - uvicorn
            - app.main:app
            - --host=0.0.0.0
            - --port=8000
            - --workers={{ $cfg.uvicornWorkers }}
            - --timeout-graceful-shutdown={{ $cfg.gracefulShutdownSeconds }}
          ports:
            - name: http
              containerPort: 8000
          # Boot = imports + the schema check: give it up to 3 minutes before
          # liveness starts counting.
          startupProbe:
            httpGet:
              path: /healthz
              port: http
              {{- include "eduposhan.probeHeaders" $root | nindent 14 }}
            periodSeconds: 5
            failureThreshold: 36
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
              {{- include "eduposhan.probeHeaders" $root | nindent 14 }}
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 6
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
              {{- include "eduposhan.probeHeaders" $root | nindent 14 }}
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "{{ $root.Values.preStopSleepSeconds }}"]
          {{- else }}
          command: ["python", "-m", "app.worker"]
          # The worker's loops log errors and carry on, so it never exits by
          # itself: a heartbeat older than 90 s (app/worker.py beats every 20 s)
          # is a wedged event loop, and a restart is the cure.
          startupProbe:
            exec:
              command:
                - python
                - -c
                - "import os, sys, time; sys.exit(0 if time.time() - os.path.getmtime('/tmp/eduposhan-worker.heartbeat') < 90 else 1)"
            periodSeconds: 5
            failureThreshold: 36
          livenessProbe:
            exec:
              command:
                - python
                - -c
                - "import os, sys, time; sys.exit(0 if time.time() - os.path.getmtime('/tmp/eduposhan-worker.heartbeat') < 90 else 1)"
            periodSeconds: 30
            timeoutSeconds: 10
            failureThreshold: 3
          {{- end }}
          env:
            {{- include "eduposhan.backendEnv" $root | nindent 12 }}
            {{- include "eduposhan.roleEnv" (dict "role" $role) | nindent 12 }}
          envFrom:
            - secretRef:
                name: {{ $root.Values.secret.name }}
          resources:
            {{- toYaml $cfg.resources | nindent 12 }}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: {{ $cfg.readOnlyRootFilesystem }}
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: audit-spool
              mountPath: /data/audit_spool
            - name: tmp
              mountPath: /tmp
            - name: uploads
              mountPath: /app/uploads
            {{- if eq $role "admin" }}
            - name: pipeline-data
              mountPath: /data/pipeline_data
            {{- end }}
      volumes:
        - name: tmp
          emptyDir: {}
        {{- if ne $role "admin" }}
        # Not kept: with R2 on nothing is written here (the chart refuses to
        # render without R2 unless media.allowLocalUploads is set).
        - name: uploads
          emptyDir: {}
        {{- end }}
  volumeClaimTemplates:
    {{- include "eduposhan.claim" (dict "root" $root "name" "audit-spool" "size" $root.Values.auditSpool.size) | nindent 4 }}
    {{- if eq $role "admin" }}
    {{- include "eduposhan.claim" (dict "root" $root "name" "uploads" "size" $cfg.uploadsSize) | nindent 4 }}
    {{- include "eduposhan.claim" (dict "root" $root "name" "pipeline-data" "size" $cfg.pipelineDataSize) | nindent 4 }}
    {{- end }}
{{- end -}}

{{/* One volumeClaimTemplates entry. Takes (dict "root" $ "name" ... "size" ...). */}}
{{- define "eduposhan.claim" -}}
- metadata:
    name: {{ .name }}
  spec:
    accessModes: ["ReadWriteOnce"]
    {{- with .root.Values.storageClassName }}
    storageClassName: {{ . }}
    {{- end }}
    resources:
      requests:
        storage: {{ .size }}
{{- end -}}

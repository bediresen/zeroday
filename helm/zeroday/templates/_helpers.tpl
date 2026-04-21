{{- define "zeroday.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "zeroday.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end }}

{{- define "zeroday.labels" -}}
helm.sh/chart: {{ include "zeroday.chart" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "zeroday.imageRef" -}}
{{- $root := index . 0 -}}
{{- $repo := index . 1 -}}
{{- $tag := index . 2 | default "latest" -}}
{{- if $root.Values.global.imageRegistry -}}
{{- printf "%s/%s:%s" $root.Values.global.imageRegistry $repo $tag -}}
{{- else -}}
{{- printf "docker.io/%s:%s" $repo $tag -}}
{{- end -}}
{{- end }}

{{- define "zeroday.secretName" -}}
{{- if .Values.existingSecretName -}}
{{- .Values.existingSecretName -}}
{{- else if .Values.secrets.create -}}
{{- printf "%s-secrets" .Release.Name -}}
{{- else -}}
zeroday-secrets
{{- end -}}
{{- end }}

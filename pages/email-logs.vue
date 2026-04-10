<script setup lang="ts">
const { t, locale } = useI18n()

type LogItem = {
  id: number
  createdAt: string
  status: string
  recipients: string
  subject: string | null
  errorMessage: string | null
  errorCode: string | null
  detail: string | null
}

type LogsResponse = {
  data: { items: LogItem[] }
}

const { data, pending, error, refresh } = await useFetch<LogsResponse>('/api/v2/cve-email-logs', {
  key: 'cve-email-logs',
  query: { limit: 100 },
})

const items = computed(() => data.value?.data?.items ?? [])

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-GB' : 'tr-TR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(d)
}

function statusLabel(status: string): string {
  if (status === 'ok') return t('emailLogs.statusOk')
  return t('emailLogs.statusFailed')
}

function statusClass(status: string): string {
  return status === 'ok' ? 'pill pill--ok' : 'pill pill--err'
}
</script>

<template>
  <div class="email-logs-page">
    <header class="head">
      <h1>{{ t('emailLogs.title') }}</h1>
      <p class="lead">{{ t('emailLogs.lead') }}</p>
    </header>

    <p v-if="error" class="banner banner--err">{{ error.message }}</p>
    <p v-if="pending" class="muted">{{ t('emailLogs.loading') }}</p>

    <template v-else>
      <div class="toolbar">
        <button type="button" class="btn btn--ghost" :disabled="pending" @click="() => refresh()">
          {{ t('emailLogs.refresh') }}
        </button>
      </div>

      <div v-if="!items.length" class="empty-box">
        {{ t('emailLogs.empty') }}
      </div>

      <div v-else class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-time">{{ t('emailLogs.colTime') }}</th>
              <th class="col-status">{{ t('emailLogs.colStatus') }}</th>
              <th class="col-to">{{ t('emailLogs.colRecipients') }}</th>
              <th class="col-subj">{{ t('emailLogs.colSubject') }}</th>
              <th class="col-err">{{ t('emailLogs.colError') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in items" :key="row.id">
              <td class="mono muted">{{ formatWhen(row.createdAt) }}</td>
              <td>
                <span :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span>
              </td>
              <td class="cell-wrap">{{ row.recipients }}</td>
              <td class="cell-wrap">{{ row.subject || '—' }}</td>
              <td class="cell-wrap cell-err">
                <template v-if="row.errorMessage">
                  <span>{{ row.errorMessage }}</span>
                  <details v-if="row.detail && row.detail !== row.errorMessage" class="detail">
                    <summary>{{ t('emailLogs.technicalDetail') }}</summary>
                    <pre class="pre">{{ row.detail }}</pre>
                  </details>
                </template>
                <span v-else class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="footnote muted">{{ t('emailLogs.footnote') }}</p>
    </template>
  </div>
</template>

<style scoped>
.email-logs-page {
  width: 100%;
  max-width: 100%;
}

.head {
  margin-bottom: 1.25rem;
}

h1 {
  margin: 0 0 0.5rem;
  font-size: clamp(1.375rem, 2.5vw, 1.75rem);
  font-weight: 700;
  color: var(--app-text);
}

.lead {
  margin: 0;
  color: var(--app-text-secondary);
  line-height: 1.6;
  font-size: 0.9375rem;
  max-width: 52rem;
}

.toolbar {
  margin-bottom: 0.75rem;
}

.btn {
  padding: 0.45rem 0.9rem;
  border-radius: var(--app-radius-md);
  font-weight: 600;
  cursor: pointer;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: var(--app-surface);
  color: var(--app-text);
}

.btn--ghost:hover {
  border-color: rgba(99, 102, 241, 0.45);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.muted {
  color: var(--app-text-muted);
}

.mono {
  font-family: var(--app-font-mono);
  font-size: 0.8125rem;
}

.empty-box {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--app-text-muted);
  background: var(--app-surface);
  border: 1px dashed rgba(148, 163, 184, 0.45);
  border-radius: var(--app-radius-lg);
}

.table-wrap {
  overflow-x: auto;
  background: var(--app-surface);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: var(--app-radius-xl);
  box-shadow: var(--app-shadow-md);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.data-table th,
.data-table td {
  padding: 0.65rem 0.75rem;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.data-table th {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-text-muted);
  background: rgba(0, 0, 0, 0.02);
  white-space: nowrap;
}

.col-time {
  min-width: 11rem;
}
.col-status {
  min-width: 8rem;
}
.col-to {
  min-width: 12rem;
}
.col-subj {
  min-width: 10rem;
}
.col-err {
  min-width: 14rem;
}

.cell-wrap {
  word-break: break-word;
}

.cell-err {
  max-width: 28rem;
}

.pill {
  display: inline-block;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  margin-right: 0.35rem;
}

.pill--ok {
  background: var(--app-success-bg);
  color: var(--app-success-text);
  border: 1px solid var(--app-success-border);
}

.pill--err {
  background: var(--app-error-bg);
  color: var(--app-error-text);
  border: 1px solid var(--app-error-border);
}

.detail {
  margin-top: 0.5rem;
}

.detail summary {
  cursor: pointer;
  font-size: 0.75rem;
  color: var(--app-accent);
}

.pre {
  margin: 0.35rem 0 0;
  padding: 0.5rem;
  font-size: 0.7rem;
  background: rgba(0, 0, 0, 0.04);
  border-radius: var(--app-radius-sm);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.footnote {
  margin-top: 1rem;
  font-size: 0.8rem;
  max-width: 42rem;
}

.banner {
  padding: 0.75rem 1rem;
  border-radius: var(--app-radius-md);
  margin-bottom: 0.75rem;
}

.banner--err {
  background: var(--app-error-bg);
  color: var(--app-error-text);
  border: 1px solid var(--app-error-border);
}
</style>

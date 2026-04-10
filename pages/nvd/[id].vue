<script setup lang="ts">
import {
  DEFAULT_NVD_DISPLAY_TIME_ZONE,
  formatNvdDate,
  nvdReferenceList,
  pickCvssV31Strings,
  pickEnglishDescription,
  type NvdCveBlock,
} from '~/utils/nvdDisplay'
import { nvdReferenceLabel } from '~/utils/nvdRefs'

interface DetailPayload {
  cveId: string
  totalResults: number
  timestamp?: string
  /** Kayıt sonrası DB’deki Türkçe açıklama */
  descriptionTr?: string | null
  /** Cron’daki yayın dilimi; yayın tarihi gösterimi */
  timeZone?: string
  vulnerability: { cve?: NvdCveBlock }
}

interface DetailResponse {
  data: DetailPayload
}

const { t, locale } = useI18n()
const { vulnStatus, severity: severityLabel } = useNvdLocale()

const route = useRoute()
const cveParam = computed(() => String(route.params.id || '').trim().toUpperCase())

const requestFetch = useRequestFetch()

const detailUrl = computed(
  () => `/api/v2/cves/nvd/${encodeURIComponent(cveParam.value)}`
)

const { data, pending, error, refresh } = await useFetch<DetailResponse>(detailUrl, {
  key: computed(() => `nvd-detail-${cveParam.value}`),
  $fetch: requestFetch,
})

const cve = computed(() => data.value?.data?.vulnerability?.cve)
const meta = computed(() => data.value?.data)

const cvss = computed(() => pickCvssV31Strings(cve.value))
const descriptionEn = computed(() => pickEnglishDescription(cve.value))
const descriptionDisplay = computed(() => {
  if (locale.value === 'en') return descriptionEn.value
  const tr = meta.value?.descriptionTr?.trim()
  if (tr) return tr
  return descriptionEn.value
})
const refs = computed(() => nvdReferenceList(cve.value))

const displayTimeZone = computed(
  () => meta.value?.timeZone?.trim() || DEFAULT_NVD_DISPLAY_TIME_ZONE
)

const nvdPortalUrl = computed(() =>
  cveParam.value ? `https://nvd.nist.gov/vuln/detail/${cveParam.value}` : ''
)

function severityClass(sev: string): string {
  const s = sev.toUpperCase()
  if (s === 'CRITICAL') return 'sev sev--critical'
  if (s === 'HIGH') return 'sev sev--high'
  if (s === 'MEDIUM') return 'sev sev--medium'
  if (s === 'LOW') return 'sev sev--low'
  return 'sev sev--na'
}
</script>

<template>
  <div class="detail-page">
    <p class="back">
      <NuxtLink to="/">{{ t('detail.backToList') }}</NuxtLink>
    </p>

    <p v-if="pending" class="muted">{{ t('detail.loading') }}</p>
    <p v-else-if="error" class="banner banner--err">
      {{ error.statusMessage || error.message }}
    </p>

    <template v-else-if="cve && meta">
      <header class="head">
        <div>
          <h1>{{ meta.cveId }}</h1>
          <p v-if="meta.timestamp" class="muted mono">{{ t('detail.nvdResponse') }} {{ meta.timestamp }}</p>
        </div>
        <div class="head-actions">
          <a
            v-if="nvdPortalUrl"
            :href="nvdPortalUrl"
            class="btn btn--ghost"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ t('detail.openOnNvd') }}
          </a>
          <button type="button" class="btn btn--ghost" @click="() => refresh()">{{ t('detail.refresh') }}</button>
        </div>
      </header>

      <div class="cards">
        <div class="card">
          <span class="label">{{ t('detail.published') }}</span>
          <span class="value">{{ formatNvdDate(cve.published, displayTimeZone) }}</span>
        </div>
        <div class="card">
          <span class="label">{{ t('detail.status') }}</span>
          <span class="value">{{ vulnStatus(cve.vulnStatus || '—') }}</span>
        </div>
        <div class="card">
          <span class="label">{{ t('detail.cvss31') }}</span>
          <span class="value mono">{{ cvss.score }}</span>
        </div>
        <div class="card">
          <span class="label">{{ t('detail.severity') }}</span>
          <span class="value">
            <span :class="severityClass(cvss.severity)">{{ severityLabel(cvss.severity) }}</span>
          </span>
        </div>
      </div>

      <section class="panel">
        <h2>{{ t('detail.description') }}</h2>
        <p class="desc">{{ descriptionDisplay }}</p>
      </section>

      <section class="panel">
        <h2>{{ t('detail.references') }}</h2>
        <ul v-if="refs.length" class="ref-list">
          <li v-for="(ref, i) in refs" :key="`${ref.url}-${i}`">
            <a
              :href="ref.url"
              :title="ref.url"
              target="_blank"
              rel="noopener noreferrer"
              class="ref-main"
            >
              {{ nvdReferenceLabel(ref, i) }}
            </a>
            <span class="ref-url mono">{{ ref.url }}</span>
            <span v-if="ref.tags?.length" class="tags">
              <span v-for="(tag, ti) in ref.tags" :key="ti" class="tag">{{ tag }}</span>
            </span>
          </li>
        </ul>
        <p v-else class="muted">—</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.detail-page {
  max-width: 900px;
  margin: 0 auto;
}

.back {
  margin-bottom: 1.1rem;
}
.back a {
  color: var(--app-link);
  font-weight: 600;
  font-size: 0.875rem;
  text-decoration: none;
  transition: color 0.12s ease;
}
.back a:hover {
  color: var(--app-link-hover);
  text-decoration: underline;
}

.muted {
  color: var(--app-text-muted);
}

.mono {
  font-family: var(--app-font-mono);
  font-size: 0.8125rem;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

h1 {
  margin: 0 0 0.35rem;
  font-size: clamp(1.5rem, 3vw, 1.85rem);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.2;
  color: var(--app-text);
}

.head-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn {
  padding: 0.55rem 1.1rem;
  border-radius: var(--app-radius-md);
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: var(--app-surface);
  color: var(--app-text-secondary);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  box-shadow: var(--app-shadow-sm);
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.btn--ghost:hover {
  background: #f8f9fd;
  border-color: rgba(99, 102, 241, 0.3);
  color: var(--app-text);
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.875rem;
  margin-bottom: 1.5rem;
}

.card {
  background: var(--app-surface);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: var(--app-radius-lg);
  padding: 0.95rem 1.1rem;
  box-shadow: var(--app-shadow-sm), var(--app-shadow-inset);
}

.label {
  display: block;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--app-text-muted);
  margin-bottom: 0.35rem;
}

.value {
  font-size: 0.95rem;
  color: var(--app-text-secondary);
}

.panel {
  background: var(--app-surface);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: var(--app-radius-xl);
  padding: 1.25rem 1.4rem;
  margin-bottom: 1rem;
  box-shadow: var(--app-shadow-md);
}

.panel h2 {
  margin: 0 0 0.85rem;
  font-size: 0.9375rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--app-text);
}

.desc {
  margin: 0;
  line-height: 1.65;
  color: var(--app-text-secondary);
  white-space: pre-wrap;
  font-weight: 500;
}

.ref-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.ref-list li {
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--app-border-subtle);
}

.ref-list li:last-child {
  border-bottom: none;
}

.ref-main {
  font-weight: 600;
  color: #4c1d95;
  text-decoration: none;
  word-break: break-word;
  transition: color 0.12s ease;
}

.ref-main:hover {
  color: var(--app-accent);
  text-decoration: underline;
}

.ref-url {
  display: block;
  margin-top: 0.3rem;
  font-size: 0.75rem;
  color: var(--app-text-muted);
  word-break: break-all;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.45rem;
}

.tag {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.2rem 0.45rem;
  border-radius: var(--app-radius-sm);
  background: #f4f4f7;
  color: var(--app-text-secondary);
  border: 1px solid var(--app-border-subtle);
}

.sev {
  display: inline-block;
  padding: 0.28rem 0.65rem;
  border-radius: var(--app-radius-pill, 999px);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.sev--critical {
  background: #3f0d12;
  color: #fecdd3;
}
.sev--high {
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fecaca;
}
.sev--medium {
  background: #fffbeb;
  color: #b45309;
  border: 1px solid #fde68a;
}
.sev--low {
  background: #ecfdf5;
  color: #047857;
  border: 1px solid #a7f3d0;
}
.sev--na {
  background: #f4f4f6;
  color: var(--app-text-muted);
  border: 1px solid var(--app-border-subtle);
}

.banner--err {
  padding: 0.85rem 1.1rem;
  background: var(--app-error-bg);
  color: var(--app-error-text);
  border-radius: var(--app-radius-md);
  border: 1px solid var(--app-error-border);
  line-height: 1.5;
}
</style>

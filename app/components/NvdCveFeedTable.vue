<script setup lang="ts">
import {
  DEFAULT_NVD_DISPLAY_TIME_ZONE,
  formatDbNewestPublished,
  formatNvdDate,
  nvdReferenceList,
  pickCvssV31Strings,
  pickEnglishDescription,
  type NvdCveBlock,
} from '~/utils/nvdDisplay'
import { nvdReferenceLabel } from '~/utils/nvdRefs'

const props = withDefaults(
  defineProps<{
    fetchPath: string
    fetchKey: string
    title: string
    lead: string
    showDbMeta?: boolean
    /** NVD senkron sayfasında: mevcut yayın penceresi için PDF indirme */
    showPdfReport?: boolean
  }>(),
  { showDbMeta: true, showPdfReport: false }
)

interface NvdCveItem {
  cve?: NvdCveBlock
  /** Veritabanında Kaydet ile yazılan Türkçe açıklama */
  descriptionTr?: string | null
}

interface NvdPayload {
  pubStartDate: string
  pubEndDate: string
  totalResults: number
  vulnerabilities: NvdCveItem[]
  dbNewestPublishedAt: string | null
  publicationRangeClamped: boolean
  timeZone?: string
  windowSummary?: string
  /** NVD / DB sorgu üst sınırı (pencerenin son dahil anı, UTC ISO) */
  listQueryEndDate?: string
  /** Pencere bitiş sınırı (exclusive), UTC ISO */
  windowEndExclusiveUtcIso?: string
  /** Yenile (liveEnd=1): bitiş = istek anı */
  liveEndRefresh?: boolean
  /** Sunucu: bu sayfa listesindeki CVE’ler bu yayın penceresinde DB’de mi */
  listPersisted?: boolean
}

interface NvdApiResponse {
  data: NvdPayload
}

const requestFetch = useRequestFetch()
const { t, locale } = useI18n()
const { vulnStatus, severity: severityLabel } = useNvdLocale()
const unauthorizedHandlers = useUnauthorizedRedirectHandlers()

/** 0 = ilk yükleme (artımlı NVD birleşimi); artış = Yenile: başlangıç dün+cron saati, bitiş şu an */
const manualRefreshGeneration = ref(0)

const nvdRequestUrl = computed(() => {
  const base = props.fetchPath
  if (manualRefreshGeneration.value === 0) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}liveEnd=1&_=${manualRefreshGeneration.value}`
})

const { data: nvd, pending, error, refresh } = await useFetch<NvdApiResponse>(nvdRequestUrl, {
  key: computed(() => `${props.fetchKey}-${manualRefreshGeneration.value}`),
  $fetch: requestFetch,
  ...unauthorizedHandlers,
})

async function manualRefreshNvd() {
  manualRefreshGeneration.value += 1
  await refresh()
}

const vulnerabilities = computed(() => nvd.value?.data?.vulnerabilities ?? [])
const meta = computed(() => nvd.value?.data)

/** Cron ayarındaki TZ; yayın penceresi ve gösterim buna göre */
const displayTimeZone = computed(
  () => meta.value?.timeZone?.trim() || DEFAULT_NVD_DISPLAY_TIME_ZONE
)

/**
 * `windowSummary` metnini (örn. cron 10:10: `13.04.2026 10:10 → 14.04.2026 10:10 (Europe/Istanbul)`; bitiş exclusive)
 * başlangıç / bitiş / TZ olarak ayırır; ayrışmazsa API’den gelen ham metin veya ISO fallback kullanılır.
 */
const windowSummaryParts = computed(() => {
  const m = meta.value
  if (!m) return null
  const tz = displayTimeZone.value
  const raw = (m.windowSummary || '').trim()
  if (raw) {
    const withTz = raw.match(/^(.+?)\s*→\s*(.+?)\s*\(([^)]+)\)\s*$/)
    if (withTz) {
      return {
        start: withTz[1].trim(),
        end: withTz[2].trim(),
        tzLabel: withTz[3].trim(),
        pubStartIso: m.pubStartDate,
        pubEndIso: m.pubEndDate,
      }
    }
    const noTz = raw.match(/^(.+?)\s*→\s*(.+)$/)
    if (noTz) {
      return {
        start: noTz[1].trim(),
        end: noTz[2].trim(),
        tzLabel: tz,
        pubStartIso: m.pubStartDate,
        pubEndIso: m.pubEndDate,
      }
    }
  }
  const start = formatNvdDate(m.pubStartDate, tz)
  const end = formatNvdDate(m.pubEndDate, tz)
  if (start !== '—' && end !== '—') {
    return {
      start,
      end,
      tzLabel: tz,
      pubStartIso: m.pubStartDate,
      pubEndIso: m.pubEndDate,
    }
  }
  return null
})

const windowSummaryFallback = computed(() => {
  const m = meta.value
  if (!m) return ''
  const s = m.windowSummary?.trim()
  if (s) return s
  if (m.pubStartDate && m.pubEndDate) {
    return `${m.pubStartDate} → ${m.pubEndDate}`
  }
  return ''
})

const dbNewestDisplay = computed(() =>
  formatDbNewestPublished(meta.value?.dbNewestPublishedAt, displayTimeZone.value)
)

/** Tablo satırı sayısı; NVD `totalResults` ile bazen farklı olabilir — büyük sayı bunu gösterir */
const listCount = computed(() => vulnerabilities.value.length)

const listPersisted = computed(() => meta.value?.listPersisted === true)

const saveDisabled = computed(
  () =>
    saving.value ||
    pending.value ||
    !vulnerabilities.value.length ||
    listPersisted.value
)

const tableRows = computed(() =>
  vulnerabilities.value.map((item, idx) => {
    const cve = item.cve
    const cvss = pickCvssV31Strings(cve)
    const tz = displayTimeZone.value
    return {
      key: cve?.id ?? `row-${idx}`,
      item,
      id: cve?.id,
      published: formatNvdDate(cve?.published, tz),
      statusRaw: cve?.vulnStatus || '—',
      description: pickEnglishDescription(cve),
      descriptionTr: item.descriptionTr ?? null,
      score: cvss.score,
      severityRaw: cvss.severity,
      refs: nvdReferenceList(cve),
    }
  })
)

function descriptionForRow(row: {
  description: string
  descriptionTr: string | null
}) {
  if (locale.value === 'en') return row.description
  const tr = row.descriptionTr?.trim()
  if (tr) return tr
  return row.description
}

const saving = ref(false)
const saveMessage = ref('')
const saveError = ref('')

const pdfLoading = ref(false)
const pdfError = ref('')
const pdfMinioMsg = ref('')
const pdfMinioMsgKind = ref<'ok' | 'warn'>('ok')

const emailLoading = ref(false)
const emailError = ref('')
const emailOk = ref('')
/** Kısmi gönderim: bazı alıcılarda hata */
const emailPartial = ref('')

/** “E-posta gönder” için önce başarılı “Rapor oluştur” gerekir; pencere değişince sıfırlanır */
const reportReadyForEmail = ref(false)

watch(
  () => [meta.value?.pubStartDate, meta.value?.pubEndDate] as const,
  () => {
    reportReadyForEmail.value = false
  }
)

/** Rapor dosya adı: yayın penceresi bitiş günü (UTC), yoksa bugün */
function syncReportFilenamePdf(): string {
  const pubEnd = meta.value?.pubEndDate
  if (typeof pubEnd === 'string' && pubEnd.trim()) {
    const hasZone = /Z$/i.test(pubEnd) || /[+-]\d{2}:\d{2}$/.test(pubEnd) || /[+-]\d{4}$/.test(pubEnd)
    const d = new Date(hasZone ? pubEnd : `${pubEnd}Z`)
    if (!Number.isNaN(d.getTime())) {
      const day = String(d.getUTCDate()).padStart(2, '0')
      const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
      const y = d.getUTCFullYear()
      return `Siber_Guvenlik_0day_Zafiyet_Bildirimi-${day}.${mo}.${y}.pdf`
    }
  }
  const now = new Date()
  const u = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = String(u.getUTCDate()).padStart(2, '0')
  const mo = String(u.getUTCMonth() + 1).padStart(2, '0')
  const y = u.getUTCFullYear()
  return `Siber_Guvenlik_0day_Zafiyet_Bildirimi-${day}.${mo}.${y}.pdf`
}

async function downloadSyncReportPdf() {
  if (!props.showPdfReport) return
  pdfError.value = ''
  pdfMinioMsg.value = ''
  pdfLoading.value = true
  try {
    const res = await fetch('/api/v2/cves/nvd/sync-report')
    const minioHdr = (res.headers.get('X-Minio-Status') || '').trim()
    if (!res.ok) {
      const ct = res.headers.get('content-type') || ''
      let msg = t('feed.reportFailed')
      if (ct.includes('application/json')) {
        try {
          const j = (await res.json()) as { data?: { message?: string }; message?: string }
          msg = j?.data?.message || j?.message || msg
        } catch {
          /* ignore */
        }
      }
      throw new Error(msg)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = syncReportFilenamePdf()
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    reportReadyForEmail.value = true
    if (minioHdr === 'ok') {
      pdfMinioMsgKind.value = 'ok'
      pdfMinioMsg.value = t('feed.reportMinioOk')
    } else if (minioHdr === 'failed') {
      pdfMinioMsgKind.value = 'warn'
      pdfMinioMsg.value = t('feed.reportMinioFailed')
    }
  } catch (e: unknown) {
    const err = e as { message?: string }
    pdfError.value = err?.message || t('feed.reportFailed')
  } finally {
    pdfLoading.value = false
  }
}

async function sendReportEmail() {
  if (!props.showPdfReport || !reportReadyForEmail.value) return
  emailError.value = ''
  emailOk.value = ''
  emailPartial.value = ''
  emailLoading.value = true
  try {
    const res = await $fetch<{
      ok?: boolean
      partial?: boolean
      failedRecipients?: string[]
    }>('/api/v2/cves/nvd/send-report-email', {
      method: 'POST',
    })
    if (res.partial && res.failedRecipients?.length) {
      emailPartial.value = t('feed.emailPartial', {
        list: res.failedRecipients.join(', '),
      })
    } else {
      emailOk.value = t('feed.emailSent')
    }
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    emailError.value = err?.data?.message || err?.message || t('feed.emailFailed')
  } finally {
    emailLoading.value = false
  }
}

async function saveToDb() {
  const list = vulnerabilities.value
  if (!list.length) {
    saveError.value = t('feed.nothingToSave')
    return
  }
  saving.value = true
  saveMessage.value = ''
  saveError.value = ''
  try {
    const res = await $fetch<{
      message: string
      data: {
        upserted: number
        skippedInvalid: number
        llm: {
          reusedFromDb: number
          newRowCount: number
          newRowsSkippedLlm: number
          llmQueueCount: number
          openaiRequestCount: number
          memoryCacheHits: number
          llmDurationMs: number
          hadOpenaiKey: boolean
        }
      }
    }>('/api/v2/cves/nvd', {
      method: 'POST',
      body: { vulnerabilities: list },
    })
    const llm = res.data.llm
    const llmPart =
      llm !== undefined
        ? t('', {
            reused: llm.reusedFromDb,
            newRows: llm.newRowCount,
            skipped: llm.newRowsSkippedLlm,
            queued: llm.llmQueueCount,
            api: llm.openaiRequestCount,
            cached: llm.memoryCacheHits,
            sec: (llm.llmDurationMs / 1000).toFixed(1),
          })
        : ''
    saveMessage.value = t('feed.saveResult', {
      message: res.message,
      upserted: res.data.upserted,
      skippedPart: res.data.skippedInvalid
        ? t('feed.saveSkippedPart', { n: res.data.skippedInvalid })
        : '',
      llmPart,
    })
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    saveError.value = err?.data?.message || err?.message || t('feed.saveFailed')
  } finally {
    saving.value = false
  }
}

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
  <div class="nvd-page">
    <div class="page-head">
      <div>
        <h1>{{ title }}</h1>
        <p class="lead">{{ lead }}</p>
      </div>
      <button type="button" class="btn btn--ghost" :disabled="pending" @click="manualRefreshNvd">
        {{ pending ? t('feed.loading') : t('feed.refresh') }}
      </button>
    </div>

    <p v-if="error" class="banner banner--err">{{ error.message }}</p>

    <template v-else-if="meta">
      <div class="meta-hero" aria-live="polite">
        <span class="meta-hero-label">{{ t('feed.totalNvd') }}</span>
        <span class="meta-hero-number">{{ listCount }}</span>
        <p
          v-if="typeof meta.totalResults === 'number' && meta.totalResults !== listCount"
          class="meta-hero-note muted tiny"
        >
          {{ t('feed.totalNvdNote', { nvd: meta.totalResults, list: listCount }) }}
        </p>
      </div>
      <section class="meta-insights" :aria-label="t('feed.pubWindow')">
        <article class="insight insight--window">
          <div class="insight__top">
            <span class="insight__icon insight__icon--window" aria-hidden="true" />
            <div class="insight__titles">
              <h2 class="insight__title">{{ t('feed.pubWindow') }}</h2>
              <p class="insight__hint">{{ t('feed.windowCardHint') }}</p>
            </div>
          </div>

          <div v-if="windowSummaryParts" class="insight__range">
            <div class="insight__point">
              <span class="insight__point-label">{{ t('feed.windowFrom') }}</span>
              <time
                class="insight__point-value"
                :datetime="windowSummaryParts.pubStartIso || undefined"
              >{{ windowSummaryParts.start }}</time>
            </div>
            <span class="insight__arrow" aria-hidden="true" />
            <div class="insight__point">
              <span class="insight__point-label">{{ t('feed.windowTo') }}</span>
              <time
                class="insight__point-value"
                :datetime="windowSummaryParts.pubEndIso || undefined"
              >{{ windowSummaryParts.end }}</time>
            </div>
            <span class="insight__tz-pill" :title="windowSummaryParts.tzLabel">{{
              windowSummaryParts.tzLabel
            }}</span>
          </div>
          <p v-else class="insight__fallback mono">{{ windowSummaryFallback }}</p>
        </article>

        <article v-if="showDbMeta" class="insight insight--db">
          <div class="insight__top">
            <span class="insight__icon insight__icon--db" aria-hidden="true" />
            <div class="insight__titles">
              <h2 class="insight__title">{{ t('feed.dbNewestPub') }}</h2>
              <p class="insight__hint">{{ t('feed.dbNewestHint') }}</p>
            </div>
          </div>
          <p class="insight__db-time" :title="dbNewestDisplay">{{ dbNewestDisplay }}</p>
          <div class="insight__db-foot">
            <span class="insight__tz-pill insight__tz-pill--dbtz">{{ displayTimeZone }}</span>
          </div>
        </article>

        <div
          v-if="meta.publicationRangeClamped"
          class="insight insight--warn"
          role="status"
        >
          <span class="insight__warn-icon" aria-hidden="true">!</span>
          <div>
            <span class="insight__title insight__title--inline">{{ t('feed.range') }}</span>
            <p class="insight__hint insight__hint--tight">{{ t('feed.rangeClamped') }}</p>
          </div>
        </div>
      </section>
    </template>

    <div v-if="pending" class="skeleton">{{ t('feed.loadingData') }}</div>

    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th class="col-id">{{ t('feed.colCveId') }}</th>
            <th class="col-date">{{ t('feed.colPublished') }}</th>
            <th class="col-status">{{ t('feed.colStatus') }}</th>
            <th class="col-desc">{{ t('feed.colDesc') }}</th>
            <th class="col-score">{{ t('feed.colCvss') }}</th>
            <th class="col-sev">{{ t('feed.colSeverity') }}</th>
            <th class="col-refs">{{ t('feed.colRefs') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in tableRows" :key="row.key">
            <td class="col-id">
              <NuxtLink v-if="row.id" :to="`/nvd/${row.id}`" class="cve-link">{{ row.id }}</NuxtLink>
              <span v-else>—</span>
            </td>
            <td class="col-date muted">{{ row.published }}</td>
            <td class="col-status">{{ vulnStatus(row.statusRaw) }}</td>
            <td class="col-desc">
              <span class="desc-clamp" :title="descriptionForRow(row)">{{ descriptionForRow(row) }}</span>
            </td>
            <td class="col-score mono">{{ row.score }}</td>
            <td class="col-sev">
              <span :class="severityClass(row.severityRaw)">{{ severityLabel(row.severityRaw) }}</span>
            </td>
            <td class="col-refs">
              <ul v-if="row.refs.length" class="ref-list">
                <li v-for="(ref, i) in row.refs" :key="i">
                  <a
                    :href="ref.url"
                    :title="ref.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="ref-a"
                  >
                    {{ nvdReferenceLabel(ref, i) }}
                  </a>
                </li>
              </ul>
              <span v-else class="muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!vulnerabilities.length" class="empty">{{ t('feed.emptyWindow') }}</p>
    </div>

    <div class="footer-bar">
      <div class="footer-msgs">
        <p v-if="saveMessage" class="banner banner--ok">{{ saveMessage }}</p>
        <p v-if="saveError" class="banner banner--err">{{ saveError }}</p>
        <p v-if="pdfError" class="banner banner--err">{{ pdfError }}</p>
        <p
          v-if="pdfMinioMsg"
          class="banner"
          :class="pdfMinioMsgKind === 'ok' ? 'banner--ok' : 'banner--warn'"
        >
          {{ pdfMinioMsg }}
        </p>
        <p v-if="emailOk" class="banner banner--ok">{{ emailOk }}</p>
        <p v-if="emailPartial" class="banner banner--warn">{{ emailPartial }}</p>
        <p v-if="emailError" class="banner banner--err">{{ emailError }}</p>
      </div>
      <div class="footer-actions">
        <button
          v-if="showPdfReport"
          type="button"
          class="btn btn--ghost btn--lg"
          :disabled="pdfLoading || pending"
          @click="downloadSyncReportPdf"
        >
          {{ pdfLoading ? t('feed.reportGenerating') : t('feed.downloadReport') }}
        </button>
        <button
          v-if="showPdfReport"
          type="button"
          class="btn btn--ghost btn--lg"
          :disabled="emailLoading || pending || !reportReadyForEmail"
          :title="
            !reportReadyForEmail && !emailLoading ? t('feed.emailNeedsReportFirst') : undefined
          "
          @click="sendReportEmail"
        >
          {{ emailLoading ? t('feed.emailSending') : t('feed.sendReportEmail') }}
        </button>
        <button
          type="button"
          class="btn btn--primary btn--lg"
          :disabled="saveDisabled"
          :title="listPersisted && !saving && !pending ? t('feed.saveAlreadySynced') : undefined"
          @click="saveToDb"
        >
          {{ saving ? t('feed.saving') : t('feed.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nvd-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  margin: 0;
  min-height: 0;
}

.page-head {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

h1 {
  margin: 0 0 0.5rem;
  font-size: clamp(1.375rem, 2.5vw, 1.75rem);
  font-weight: 700;
  letter-spacing: -0.025em;
  color: var(--app-text);
  line-height: 1.25;
}

.lead {
  margin: 0;
  color: var(--app-text-secondary);
  font-size: 0.9375rem;
  line-height: 1.65;
  max-width: 52rem;
  font-weight: 500;
}

.mono {
  font-family: var(--app-font-mono);
  font-size: 0.8125rem;
}

.meta-hero {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 1.35rem 1.5rem 1.5rem;
  margin-bottom: 1rem;
  background: linear-gradient(165deg, #ffffff 0%, #fafbff 48%, #f4f5fb 100%);
  border: 1px solid rgba(99, 102, 241, 0.14);
  border-radius: var(--app-radius-xl);
  box-shadow:
    var(--app-shadow-md),
    inset 0 1px 0 rgba(255, 255, 255, 0.95);
}

.meta-hero-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--app-text-muted);
  margin-bottom: 0.45rem;
}

.meta-hero-number {
  font-size: clamp(2.5rem, 7vw, 3.35rem);
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
  color: var(--app-accent);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
}

.meta-insights {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
  align-items: stretch;
}

.insight {
  background: var(--app-surface);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: var(--app-radius-lg);
  padding: 1.15rem 1.25rem;
  box-shadow: var(--app-shadow-sm), var(--app-shadow-inset);
  min-width: 0;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.insight:hover {
  border-color: rgba(99, 102, 241, 0.16);
  box-shadow:
    0 4px 18px rgba(15, 23, 42, 0.05),
    var(--app-shadow-inset);
}

.insight--warn {
  grid-column: 1 / -1;
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  border-color: var(--app-warn-border);
  background: var(--app-warn-bg);
}

.insight--warn:hover {
  border-color: var(--app-warn-border);
}

.insight__top {
  display: flex;
  gap: 0.85rem;
  align-items: flex-start;
}

.insight__icon {
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--app-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
}

.insight__icon--window {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.14), rgba(129, 140, 248, 0.08));
  color: var(--app-accent);
}

.insight__icon--window::after {
  content: '';
  width: 1.05rem;
  height: 1.05rem;
  border: 2px solid currentColor;
  border-radius: 3px;
  opacity: 0.92;
}

.insight__icon--db {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.14), rgba(52, 211, 153, 0.08));
  color: #059669;
}

.insight__icon--db::after {
  content: '';
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 2px rgba(5, 150, 105, 0.22);
}

.insight__titles {
  min-width: 0;
}

.insight__title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}

.insight__title--inline {
  text-transform: none;
  letter-spacing: normal;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--app-text);
}

.insight__hint {
  margin: 0.35rem 0 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--app-text-secondary);
  font-weight: 500;
}

.insight__hint--tight {
  margin: 0.2rem 0 0;
}

.insight__range {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.65rem 1rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(148, 163, 184, 0.14);
}

.insight__point {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.insight__point-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--app-text-muted);
}

.insight__point-value {
  font-size: 1.05rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--app-text);
  line-height: 1.2;
}

.insight__arrow {
  display: inline-flex;
  align-items: center;
  align-self: center;
  color: var(--app-text-muted);
  font-size: 1.15rem;
  line-height: 1;
  padding: 0 0.1rem;
}

.insight__arrow::before {
  content: '→';
}

.insight__tz-pill {
  margin-left: auto;
  align-self: center;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.32rem 0.6rem;
  border-radius: var(--app-radius-pill);
  background: rgba(99, 102, 241, 0.09);
  color: var(--app-accent);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.insight__fallback {
  margin: 0.85rem 0 0;
  font-size: 0.8rem;
  color: var(--app-text-secondary);
  word-break: break-word;
}

.insight__db-time {
  margin: 0.85rem 0 0;
  font-size: clamp(1.35rem, 4vw, 1.7rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--app-accent);
  line-height: 1.15;
}

.insight__db-foot {
  margin-top: 0.65rem;
}

.insight__tz-pill--dbtz {
  margin-left: 0;
  background: rgba(16, 185, 129, 0.1);
  color: #047857;
}

.insight__warn-icon {
  flex-shrink: 0;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  background: #ca8a04;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 0.95rem;
  line-height: 1;
}

@media (max-width: 520px) {
  .insight__range {
    flex-direction: column;
    align-items: stretch;
  }

  .insight__arrow {
    align-self: center;
    transform: rotate(90deg);
    margin: 0.15rem 0;
  }

  .insight__tz-pill {
    margin-left: 0;
  }
}

.skeleton {
  flex: 1 1 auto;
  min-height: 8rem;
  padding: 2.25rem;
  text-align: center;
  color: var(--app-text-muted);
  background: linear-gradient(180deg, #fafbfe 0%, #f5f6fa 100%);
  border-radius: var(--app-radius-xl);
  border: 1px dashed rgba(148, 163, 184, 0.45);
  box-shadow: var(--app-shadow-sm);
  font-weight: 500;
}

.table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  background: var(--app-surface);
  border-radius: var(--app-radius-xl);
  border: 1px solid rgba(148, 163, 184, 0.2);
  box-shadow:
    var(--app-shadow-md),
    inset 0 1px 0 rgba(255, 255, 255, 0.92);
  overflow: auto;
  margin-bottom: 1.5rem;
  -webkit-overflow-scrolling: touch;
}

.data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.9rem;
}

.data-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
  background: linear-gradient(180deg, #fafbfe 0%, #f3f4f9 100%);
  box-shadow: 0 1px 0 rgba(148, 163, 184, 0.12);
}

.data-table th {
  text-align: left;
  padding: 0.95rem 1.05rem;
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.055em;
  color: var(--app-text-muted);
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  white-space: nowrap;
}

.data-table th:first-child {
  border-top-left-radius: calc(var(--app-radius-xl) - 2px);
}

.data-table th:last-child {
  border-top-right-radius: calc(var(--app-radius-xl) - 2px);
}

.data-table td {
  padding: 0.85rem 1.05rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  vertical-align: top;
  font-weight: 500;
  line-height: 1.5;
}

.data-table tbody tr:last-child td {
  border-bottom: none;
}

.data-table tbody tr:last-child td:first-child {
  border-bottom-left-radius: calc(var(--app-radius-xl) - 2px);
}

.data-table tbody tr:last-child td:last-child {
  border-bottom-right-radius: calc(var(--app-radius-xl) - 2px);
}

.data-table tbody tr:nth-child(even) {
  background: rgba(99, 102, 241, 0.028);
}

.data-table tbody tr:hover {
  background: rgba(99, 102, 241, 0.06);
}

.col-id {
  width: 9.5rem;
}

.col-date {
  width: 10.5rem;
}

.col-status {
  width: 7rem;
}

.col-score {
  width: 3.5rem;
  text-align: center;
}

.col-sev {
  width: 6.5rem;
}

.col-desc {
  min-width: 200px;
  max-width: 320px;
}

.col-refs {
  min-width: 140px;
  max-width: 220px;
}

.desc-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.58;
  color: var(--app-text-secondary);
}

.cve-link {
  font-weight: 600;
  color: var(--app-link);
  text-decoration: none;
  transition: color 0.12s ease;
}

.cve-link:hover {
  color: var(--app-link-hover);
  text-decoration: underline;
}

.muted {
  color: var(--app-text-muted);
}

.sev {
  display: inline-block;
  padding: 0.28rem 0.65rem;
  border-radius: var(--app-radius-pill);
  font-size: 0.6875rem;
  font-weight: 600;
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

.ref-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ref-list li {
  margin-bottom: 0.35rem;
}

.ref-a {
  font-size: 0.75rem;
  color: #4c1d95;
  word-break: break-all;
  font-weight: 500;
}

.ref-a:hover {
  color: var(--app-accent);
  text-decoration: underline;
}

.empty {
  padding: 2rem;
  text-align: center;
  color: var(--app-text-muted);
  margin: 0;
}

.footer-bar {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.35rem 0 0;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
}

.footer-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.footer-msgs {
  flex: 1;
  min-width: 200px;
}

.btn {
  padding: 0.55rem 1.15rem;
  border-radius: var(--app-radius-md);
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    opacity 0.18s ease,
    transform 0.18s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--ghost {
  background: var(--app-surface);
  border-color: rgba(148, 163, 184, 0.35);
  color: var(--app-text-secondary);
  box-shadow: var(--app-shadow-sm);
}

.btn--ghost:hover:not(:disabled) {
  background: #f8f9fd;
  border-color: rgba(99, 102, 241, 0.35);
  color: var(--app-text);
}

.btn--primary {
  background: linear-gradient(175deg, #5b52eb 0%, var(--app-accent) 55%, var(--app-accent-hover) 100%);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow:
    0 2px 6px rgba(67, 56, 202, 0.22),
    0 8px 24px rgba(67, 56, 202, 0.28);
}

.btn--primary:hover:not(:disabled) {
  background: linear-gradient(175deg, var(--app-accent) 0%, var(--app-accent-hover) 100%);
  box-shadow:
    0 2px 8px rgba(67, 56, 202, 0.28),
    0 10px 28px rgba(67, 56, 202, 0.32);
  transform: translateY(-1px);
}

.btn--lg {
  padding: 0.85rem 1.95rem;
  font-size: 0.9375rem;
  border-radius: var(--app-radius-lg);
}

.nvd-page > .banner {
  flex-shrink: 0;
}

.banner {
  margin: 0 0 0.5rem;
  padding: 0.75rem 1.05rem;
  border-radius: var(--app-radius-md);
  font-size: 0.875rem;
  line-height: 1.5;
}

.banner--ok {
  background: var(--app-success-bg);
  color: var(--app-success-text);
  border: 1px solid var(--app-success-border);
}

.banner--warn {
  background: #fff8e6;
  border: 1px solid #e6c200;
  color: #5c4d00;
}

.banner--err {
  background: var(--app-error-bg);
  color: var(--app-error-text);
  border: 1px solid var(--app-error-border);
}

@media (max-width: 1024px) {
  .data-table {
    min-width: 900px;
  }
}
</style>

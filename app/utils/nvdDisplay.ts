import { DateTime } from 'luxon'

/** Cron ayarında TZ yoksa liste/detay için varsayılan gösterim dilimi */
export const DEFAULT_NVD_DISPLAY_TIME_ZONE = 'Europe/Istanbul'

function parseIsoToInstant(iso: string): DateTime | null {
  const hasZone = /Z$/i.test(iso) || /[+-]\d{2}:?\d{2}$/.test(iso) || /[+-]\d{4}$/.test(iso)
  const dt = hasZone ? DateTime.fromISO(iso, { setZone: true }) : DateTime.fromISO(iso, { zone: 'utc' })
  return dt.isValid ? dt : null
}

export type NvdCveBlock = {
  id?: string
  sourceIdentifier?: string
  published?: string
  lastModified?: string
  vulnStatus?: string
  descriptions?: { lang?: string; value?: string }[]
  metrics?: {
    cvssMetricV31?: {
      type?: string
      cvssData?: { baseScore?: number; baseSeverity?: string }
    }[]
  }
  references?: { url?: string; source?: string; tags?: string[] }[]
}

export function formatNvdDate(
  iso: string | undefined,
  displayZone: string = DEFAULT_NVD_DISPLAY_TIME_ZONE
): string {
  if (!iso) return '—'
  const dt = parseIsoToInstant(iso)
  if (!dt) return iso
  return dt.setZone(displayZone).toFormat('dd.MM.yyyy HH:mm')
}

/** DB’deki an (UTC) aynı kalır; gösterim cron `timeZone` ile hizalanır */
export function formatDbNewestPublished(
  value: string | Date | null | undefined,
  displayZone: string = DEFAULT_NVD_DISPLAY_TIME_ZONE
): string {
  if (value == null) return '—'
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '—'
    return DateTime.fromJSDate(value, { zone: 'utc' })
      .setZone(displayZone)
      .toFormat('dd.MM.yyyy HH:mm')
  }
  const s = String(value).trim()
  if (!s) return '—'
  let dt = parseIsoToInstant(s)
  if (!dt || !dt.isValid) {
    dt = DateTime.fromSQL(s, { zone: 'utc' })
  }
  if (!dt.isValid) return s
  return dt.setZone(displayZone).toFormat('dd.MM.yyyy HH:mm')
}

export function pickEnglishDescription(cve: NvdCveBlock | undefined): string {
  const list = cve?.descriptions
  if (!Array.isArray(list) || list.length === 0) return '—'
  const en = list.find((d) => d.lang === 'en')
  const text = (en || list[0])?.value
  return typeof text === 'string' ? text : '—'
}

export function pickCvssV31Strings(cve: NvdCveBlock | undefined): {
  score: string
  severity: string
} {
  const list = cve?.metrics?.cvssMetricV31
  if (!Array.isArray(list) || list.length === 0) {
    return { score: '—', severity: '—' }
  }
  const primary = list.find((x) => x?.type === 'Primary')
  const pick = primary || list[0]
  const d = pick?.cvssData
  const score = typeof d?.baseScore === 'number' ? String(d.baseScore) : '—'
  const severity = typeof d?.baseSeverity === 'string' ? d.baseSeverity : '—'
  return { score, severity }
}

export function nvdReferenceList(
  cve: NvdCveBlock | undefined
): NonNullable<NvdCveBlock['references']> {
  const refs = cve?.references
  if (!Array.isArray(refs)) return []
  return refs.filter((r) => r.url && String(r.url).trim())
}

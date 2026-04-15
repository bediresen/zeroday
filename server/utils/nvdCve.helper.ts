import axios from 'axios'
import { DateTime } from 'luxon'
import { Op } from 'sequelize'
import { ensureCveSchema } from './cveSchema'
import { getCveModel, getSequelize } from './db'
import { normalizeDescriptionForLlm, translateManyCveStructuredEnToTr } from './translateText'

const NVD_CVE_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0'
const DEFAULT_RESULTS_PER_PAGE = 2000
const NVD_THROTTLE_MS_NO_KEY = 6000

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatNvdPubStartUtc(d: Date): string {
  const y = d.getUTCFullYear()
  const m = pad2(d.getUTCMonth() + 1)
  const day = pad2(d.getUTCDate())
  return `${y}-${m}-${day}T00:00:00.000`
}

/** Gün sonu UTC */
export function formatNvdPubEndUtc(d: Date): string {
  const y = d.getUTCFullYear()
  const m = pad2(d.getUTCMonth() + 1)
  const day = pad2(d.getUTCDate())
  return `${y}-${m}-${day}T23:59:59.999`
}

export function parseNvdIsoAsUtc(iso: string): Date | null {
  const s = iso.trim()
  if (!s) {
    return null
  }
  const hasZone = /Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)
  const d = new Date(hasZone ? s : `${s}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export type NvdCveItem = {
  cve?: {
    id?: string
    sourceIdentifier?: string
    published?: string
    lastModified?: string
    vulnStatus?: string
    descriptions?: { lang?: string; value?: string }[]
    metrics?: {
      cvssMetricV31?: {
        type?: string
        cvssData?: {
          baseScore?: number
          baseSeverity?: string
        }
      }[]
    }
    references?: { url?: string; source?: string; tags?: string[] }[]
  }
}

export type NvdCveByIdResult = {
  totalResults: number
  resultsPerPage?: number
  startIndex?: number
  timestamp?: string
  format?: string
  version?: string
  vulnerabilities: NvdCveItem[]
}

function pickCvssV31(cve: NvdCveItem['cve']): {
  score: number | null
  severity: string | null
} {
  const m = (cve as { metrics?: { cvssMetricV31?: unknown[] } })?.metrics
  const list = m?.cvssMetricV31
  if (!Array.isArray(list) || list.length === 0) {
    return { score: null, severity: null }
  }
  const primary = list.find((x: { type?: string }) => x?.type === 'Primary')
  const pick = primary || list[0]
  const d = (pick as { cvssData?: { baseScore?: number; baseSeverity?: string } })?.cvssData
  if (!d) {
    return { score: null, severity: null }
  }
  const score = typeof d.baseScore === 'number' ? d.baseScore : null
  const severity = typeof d.baseSeverity === 'string' ? d.baseSeverity : null
  return { score, severity }
}

function pickEnglishDescription(cve: NvdCveItem['cve']): string | null {
  const list = cve?.descriptions
  if (!Array.isArray(list) || list.length === 0) {
    return null
  }
  const en = list.find((d) => d.lang === 'en')
  const text = (en || list[0])?.value
  return typeof text === 'string' ? text : null
}

export function mapNvdVulnerabilityToCveRow(item: NvdCveItem): Record<string, unknown> | null {
  const cve = item?.cve
  const cveId = cve?.id
  if (!cveId || typeof cveId !== 'string') {
    return null
  }

  const { score, severity } = pickCvssV31(cve)

  return {
    id: cveId,
    /** NVD anı (UTC); sorgu aralığı ve sıralama için doğru an — UI’da İstanbul gösterimi ayrı */
    published_at: cve?.published ? parseNvdIsoAsUtc(cve.published) : null,
    last_modified_at: cve?.lastModified ? parseNvdIsoAsUtc(cve.lastModified) : null,
    vuln_status: cve?.vulnStatus ?? null,
    description: pickEnglishDescription(cve),
    cvss_score: score,
    cvss_severity: severity,
    raw_json: cve ?? null,
    reference_entries: Array.isArray(cve?.references) ? cve.references : null,
    created_at: new Date(),
  }
}

export type NvdFetchResult = {
  pubStartDate: string
  pubEndDate: string
  totalResults: number
  vulnerabilities: NvdCveItem[]
}

/** API yanıtında DB’deki Türkçe açıklama ve LLM ürün listesi (Kaydet sonrası dolabilir) */
export type NvdCveItemWithTr = NvdCveItem & {
  descriptionTr?: string | null
  affectedProducts?: string[] | null
}

type CveDbRowPdf = {
  id: string
  published_at: Date | string | null
  description: string | null
  description_tr: string | null
  affected_products?: unknown
  vuln_status: string | null
  raw_json: unknown
}

function dbAffectedProductsValue(v: unknown): string[] | null {
  if (v == null) return null
  if (!Array.isArray(v)) return null
  const xs = v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((s) => s.trim())
  return xs.length > 0 ? xs : null
}

/** DB `published_at` anı NVD ile aynı sözleşmede (UTC ISO); UI `formatNvdDate(..., timeZone)` ile gösterilir */
function publishedAtToUtcIso(pa: Date | string | null | undefined): string | null {
  if (pa == null) return null
  if (pa instanceof Date) {
    if (Number.isNaN(pa.getTime())) return null
    return pa.toISOString()
  }
  if (typeof pa === 'string' && pa.trim()) {
    const t = new Date(pa).getTime()
    if (Number.isNaN(t)) return null
    return new Date(t).toISOString()
  }
  return null
}

function mapDbRowToNvdCveItemWithTr(row: CveDbRowPdf): NvdCveItemWithTr | null {
  if (!row.id || typeof row.id !== 'string') {
    return null
  }
  const publishedFromDb = publishedAtToUtcIso(row.published_at)
  const raw = row.raw_json
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const rid = (raw as { id?: string }).id
    if (typeof rid === 'string' && rid.length > 0) {
      const cve: NvdCveItem['cve'] = { ...(raw as NvdCveItem['cve']) }
      if (publishedFromDb) {
        cve.published = publishedFromDb
      }
      return {
        cve,
        descriptionTr: row.description_tr ?? null,
        affectedProducts: dbAffectedProductsValue(row.affected_products),
      }
    }
  }
  let published: string | undefined
  if (publishedFromDb) {
    published = publishedFromDb
  } else {
    const pa = row.published_at
    if (pa instanceof Date && !Number.isNaN(pa.getTime())) {
      published = pa.toISOString()
    } else if (typeof pa === 'string' && pa.trim()) {
      published = pa
    }
  }
  return {
    cve: {
      id: row.id,
      published,
      vulnStatus: row.vuln_status ?? undefined,
      descriptions: row.description?.trim()
        ? [{ lang: 'en', value: row.description }]
        : [{ lang: 'en', value: '—' }],
    },
    descriptionTr: row.description_tr ?? null,
    affectedProducts: dbAffectedProductsValue(row.affected_products),
  }
}

/**
 * PDF için: yayın penceresindeki `published_at` ile DB’den CVE satırları.
 * NVD API çağrısı yok; `raw_json` + `description_tr` kullanılır.
 */
export async function loadVulnerabilitiesForPdfFromDb(
  pubStartDate: string,
  pubEndDate: string
): Promise<NvdCveItemWithTr[]> {
  await ensureCveSchema()
  const start = parseNvdIsoAsUtc(pubStartDate)
  const end = parseNvdIsoAsUtc(pubEndDate)
  if (!start || !end) {
    return []
  }

  const Cve = getCveModel()!
  const rows = (await Cve.findAll({
    where: {
      published_at: {
        [Op.between]: [start, end],
      },
    },
    order: [['published_at', 'ASC']],
    raw: true,
  })) as unknown as CveDbRowPdf[]

  const out: NvdCveItemWithTr[] = []
  for (const row of rows) {
    const item = mapDbRowToNvdCveItemWithTr(row)
    if (item) out.push(item)
  }
  return out
}


export async function loadVulnerabilitiesFromDbPublishedAfterWindowEnd(
  pubEndDate: string,
  upperBound: Date
): Promise<NvdCveItemWithTr[]> {
  await ensureCveSchema()
  const end = parseNvdIsoAsUtc(pubEndDate)
  if (!end || Number.isNaN(upperBound.getTime())) {
    return []
  }

  const Cve = getCveModel()!
  const rows = (await Cve.findAll({
    where: {
      published_at: {
        [Op.gt]: end,
        [Op.lte]: upperBound,
      },
    },
    order: [['published_at', 'DESC']],
    raw: true,
  })) as unknown as CveDbRowPdf[]

  const out: NvdCveItemWithTr[] = []
  for (const row of rows) {
    const item = mapDbRowToNvdCveItemWithTr(row)
    if (item) out.push(item)
  }
  return out
}

function publishedAtMsForSort(item: NvdCveItemWithTr): number {
  const p = item.cve?.published
  if (typeof p !== 'string' || !p.trim()) return 0
  const t = new Date(p).getTime()
  return Number.isNaN(t) ? 0 : t
}


export function mergeVulnerabilitiesDedupe(
  primary: NvdCveItemWithTr[],
  secondary: NvdCveItemWithTr[]
): NvdCveItemWithTr[] {
  const map = new Map<string, NvdCveItemWithTr>()
  for (const it of primary) {
    const id = it.cve?.id
    if (typeof id === 'string' && id.length > 0) {
      map.set(id, it)
    }
  }
  for (const it of secondary) {
    const id = it.cve?.id
    if (typeof id === 'string' && id.length > 0 && !map.has(id)) {
      map.set(id, it)
    }
  }
  return [...map.values()].sort((a, b) => publishedAtMsForSort(b) - publishedAtMsForSort(a))
}

/** Güncelle sorgusu: cron penceresi başlangıcından bu yana DB’deki en geç `published_at`. */
export async function getMaxPublishedAtSince(sinceUtc: Date): Promise<Date | null> {
  await ensureCveSchema()
  const Cve = getCveModel()!
  const max = (await Cve.max('published_at', {
    where: { published_at: { [Op.gte]: sinceUtc } },
  })) as Date | string | null
  if (max == null) return null
  const d = max instanceof Date ? max : new Date(max)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * DB’deki son yayına göre NVD’de (UTC) şu ana kadar eklenen CVE’ler — ana liste ile birleştirmek için.
 */
export async function fetchNvdIncrementalSlice(
  windowPubStartDate: string,
  options?: { apiKey?: string; /** Günlük rapor: NVD üst sınırı (örn. dünün son anı) */ pubEndDateCapIso?: string }
): Promise<{
  vulnerabilities: NvdCveItemWithTr[]
  pubStartDate: string
  pubEndDate: string
  totalResults: number
}> {
  const startUtc = parseNvdIsoAsUtc(windowPubStartDate)
  const nowUtc = DateTime.utc()
  const capRaw = options?.pubEndDateCapIso?.trim()
  const capDt = capRaw ? DateTime.fromISO(capRaw, { zone: 'utc' }) : null
  const pubEndForFetch = capDt?.isValid && capDt < nowUtc ? capDt.toISO()! : nowUtc.toISO()!
  if (!startUtc) {
    return { vulnerabilities: [], pubStartDate: windowPubStartDate, pubEndDate: pubEndForFetch, totalResults: 0 }
  }

  const maxPub = await getMaxPublishedAtSince(startUtc)
  let pubStartForFetch: string
  if (maxPub) {
    pubStartForFetch = DateTime.fromJSDate(new Date(maxPub.getTime() + 1), { zone: 'utc' }).toISO()!
  } else {
    pubStartForFetch = windowPubStartDate
  }

  const startMs = parseNvdIsoAsUtc(pubStartForFetch)?.getTime() ?? 0
  const endMs = parseNvdIsoAsUtc(pubEndForFetch)?.getTime() ?? 0
  if (startMs >= endMs) {
    return { vulnerabilities: [], pubStartDate: pubStartForFetch, pubEndDate: pubEndForFetch, totalResults: 0 }
  }

  const fetched = await fetchNvdCvesByPubRange(pubStartForFetch, pubEndForFetch, options)
  const vulnerabilities = await attachDescriptionTrFromDb(fetched.vulnerabilities)
  return {
    vulnerabilities,
    pubStartDate: pubStartForFetch,
    pubEndDate: pubEndForFetch,
    totalResults: fetched.totalResults,
  }
}

/**
 * Sayfadaki NVD listesindeki her CVE kimliği, bu yayın penceresinde `published_at` ile DB’de kayıtlı mı.
 * Kaydet gereksiz ise (yenile sonrası da) doğru sonuç verir.
 */
export async function areListCvesPersistedInWindow(
  items: NvdCveItem[],
  pubStartDate: string,
  pubEndDate: string
): Promise<boolean> {
  const ids = [
    ...new Set(
      items.map((v) => v.cve?.id).filter((x): x is string => typeof x === 'string' && x.length > 0)
    ),
  ]
  if (ids.length === 0) {
    return true
  }
  const start = parseNvdIsoAsUtc(pubStartDate)
  const end = parseNvdIsoAsUtc(pubEndDate)
  if (!start || !end) {
    return false
  }
  await ensureCveSchema()
  const Cve = getCveModel()!
  const count = await Cve.count({
    where: {
      id: { [Op.in]: ids },
      published_at: { [Op.between]: [start, end] },
    },
  })
  return count === ids.length
}

export async function attachDescriptionTrFromDb(
  vulnerabilities: NvdCveItem[]
): Promise<NvdCveItemWithTr[]> {
  const ids = [
    ...new Set(
      vulnerabilities.map((v) => v.cve?.id).filter((x): x is string => typeof x === 'string' && x.length > 0)
    ),
  ]
  if (ids.length === 0) {
    return vulnerabilities.map((v) => ({ ...v, descriptionTr: null, affectedProducts: null }))
  }
  try {
    await ensureCveSchema()
    const Cve = getCveModel()
    const rows = (await Cve.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ['id', 'description_tr', 'affected_products'],
      raw: true,
    })) as { id: string; description_tr: string | null; affected_products: unknown }[]

    const trMap = new Map<string, string | null>()
    const prodMap = new Map<string, string[] | null>()
    for (const r of rows) {
      trMap.set(r.id, r.description_tr ?? null)
      prodMap.set(r.id, dbAffectedProductsValue(r.affected_products))
    }
    return vulnerabilities.map((v) => {
      const id = v.cve?.id
      if (typeof id !== 'string') {
        return { ...v, descriptionTr: null, affectedProducts: null }
      }
      return {
        ...v,
        descriptionTr: trMap.get(id) ?? null,
        affectedProducts: prodMap.get(id) ?? null,
      }
    })
  } catch (e) {
    console.warn('[attachDescriptionTrFromDb] DB okunamadı, Türkçe sütunu atlanıyor:', e)
    return vulnerabilities.map((v) => ({ ...v, descriptionTr: null, affectedProducts: null }))
  }
}

function getNvdApiKey(): string | undefined {
  return (
    process.env.NUXT_NVD_API_KEY?.trim() ||
    process.env.NVD_API_KEY?.trim() ||
    undefined
  )
}

export async function fetchNvdCvesByPubRange(
  pubStartDate: string,
  pubEndDate: string,
  options?: { apiKey?: string }
): Promise<NvdFetchResult> {
  const apiKey = options?.apiKey?.trim() || getNvdApiKey()
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers.apiKey = apiKey
  }

  const vulnerabilities: NvdCveItem[] = []
  let startIndex = 0
  let totalResults = 0

  for (;;) {
    if (!apiKey && startIndex > 0) {
      await new Promise((r) => setTimeout(r, NVD_THROTTLE_MS_NO_KEY))
    }

    const { data } = await axios.get(NVD_CVE_URL, {
      params: {
        pubStartDate,
        pubEndDate,
        resultsPerPage: DEFAULT_RESULTS_PER_PAGE,
        startIndex,
      },
      headers,
      timeout: 120000,
      validateStatus: (s) => s >= 200 && s < 300,
    })

    const batch = Array.isArray(data?.vulnerabilities) ? data.vulnerabilities : []
    vulnerabilities.push(...batch)
    totalResults = typeof data?.totalResults === 'number' ? data.totalResults : vulnerabilities.length

    startIndex += DEFAULT_RESULTS_PER_PAGE
    if (startIndex >= totalResults || batch.length === 0) {
      break
    }
  }

  return {
    pubStartDate,
    pubEndDate,
    totalResults,
    vulnerabilities,
  }
}


export async function fetchNvdCveById(
  cveId: string,
  options?: { apiKey?: string }
): Promise<NvdCveByIdResult> {
  const id = cveId.trim().toUpperCase()
  const apiKey = options?.apiKey?.trim() || getNvdApiKey()
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers.apiKey = apiKey
  }

  const { data } = await axios.get(NVD_CVE_URL, {
    params: { cveId: id },
    headers,
    timeout: 120000,
    validateStatus: (s) => s >= 200 && s < 300,
  })

  return {
    totalResults: typeof data?.totalResults === 'number' ? data.totalResults : 0,
    resultsPerPage: data?.resultsPerPage,
    startIndex: data?.startIndex,
    timestamp: data?.timestamp,
    format: data?.format,
    version: data?.version,
    vulnerabilities: Array.isArray(data?.vulnerabilities) ? data.vulnerabilities : [],
  }
}

const CVE_UPSERT_FIELDS = [
  'published_at',
  'last_modified_at',
  'vuln_status',
  'description',
  'description_tr',
  'affected_products',
  'cvss_score',
  'cvss_severity',
  'raw_json',
  'reference_entries',
] as const

export type PersistNvdLlmSummary = {
  /** Bu kayıtta zaten DB’de olan CVE sayısı (LLM tekrarlanmadı) */
  reusedFromDb: number
  /** Bu istekte DB’de olmayan satır sayısı */
  newRowCount: number
  /** Yeni satırlardan LLM kuyruğuna alınmayan (boş açıklama, anahtar yok vb.) */
  newRowsSkippedLlm: number
  /** OpenAI’ye gönderilmek üzere sıraya alınan CVE sayısı */
  llmQueueCount: number
  /** Gerçekleşen OpenAI HTTP isteği sayısı (≈ kuyruk; önbellek sonrası) */
  openaiRequestCount: number
  /** Bellek içi çeviri önbelleği isabeti */
  memoryCacheHits: number
  /** Yapılandırılmış çeviri bloğunun süresi (ms); kuyruk boşsa 0 */
  llmDurationMs: number
  hadOpenaiKey: boolean
}

export type PersistNvdVulnerabilitiesResult = {
  upserted: number
  skippedInvalid: number
  llm: PersistNvdLlmSummary
}

export async function persistNvdVulnerabilities(
  items: NvdCveItem[],
  options?: { openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string }
): Promise<PersistNvdVulnerabilitiesResult> {
  await ensureCveSchema()
  const sequelize = getSequelize()
  const Cve = getCveModel()
  const rows = items
    .map(mapNvdVulnerabilityToCveRow)
    .filter((r): r is Record<string, unknown> => r !== null)
  const skippedInvalid = items.length - rows.length
  if (rows.length === 0) {
    return {
      upserted: 0,
      skippedInvalid,
      llm: {
        reusedFromDb: 0,
        newRowCount: 0,
        newRowsSkippedLlm: 0,
        llmQueueCount: 0,
        openaiRequestCount: 0,
        memoryCacheHits: 0,
        llmDurationMs: 0,
        hadOpenaiKey: Boolean(options?.openaiApiKey?.trim()),
      },
    }
  }

  console.info(
    `[NVD persist] Kayıt hazırlığı: ${rows.length} satır (istekten ${items.length}, geçersiz atlanan ${skippedInvalid}).`
  )

  const openaiKey = options?.openaiApiKey?.trim()
  const translateCfg = {
    openaiApiKey: openaiKey,
    openaiModel: options?.openaiModel?.trim(),
    openaiBaseUrl: options?.openaiBaseUrl?.trim(),
  }

  const ids = rows
    .map((r) => r.id as string)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  const existingRows = (await Cve!.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ['id', 'description', 'description_tr', 'affected_products'],
    raw: true,
  })) as {
    id: string
    description: string | null
    description_tr: string | null
    affected_products: unknown
  }[]
  const existingById = new Map(existingRows.map((e) => [e.id, e]))

  function normDesc(s: unknown): string {
    return typeof s === 'string' ? s.trim() : ''
  }

  const toTranslate: { row: Record<string, unknown>; text: string }[] = []
  let reusedFromDb = 0

  for (const row of rows) {
    const id = row.id as string
    const ex = existingById.get(id)
    const desc = row.description

    if (ex) {
      reusedFromDb++
      row.description_tr = ex.description_tr ?? null
      row.affected_products = ex.affected_products ?? null
      continue
    }

    const descPlain =
      typeof desc === 'string' ? normalizeDescriptionForLlm(normDesc(desc)) : ''
    if (openaiKey && descPlain && descPlain !== '—') {
      toTranslate.push({ row, text: descPlain })
    } else {
      row.description_tr = null
      row.affected_products = null
    }
  }

  const newRowCount = rows.length - reusedFromDb
  const llmQueueCount = toTranslate.length
  const newRowsSkippedLlm = Math.max(0, newRowCount - llmQueueCount)

  let openaiRequestCount = 0
  let memoryCacheHits = 0
  let llmDurationMs = 0

  if (toTranslate.length > 0 && openaiKey) {
    console.info(
      `[NVD persist] LLM aşaması başlıyor: kuyruk ${toTranslate.length} CVE (DB’den korunan ${reusedFromDb}, yeni satır ${newRowCount}, LLM dışı kalan yeni ${newRowsSkippedLlm}).`
    )
    const llmT0 = Date.now()
    const { translations: structured, stats } = await translateManyCveStructuredEnToTr(
      toTranslate.map((x) => ({ cveId: x.row.id as string, text: x.text })),
      translateCfg
    )
    llmDurationMs = Date.now() - llmT0
    openaiRequestCount = stats.openaiRequestCount
    memoryCacheHits = stats.memoryCacheHits
    console.info(
      `[NVD persist] LLM aşaması bitti: ${llmDurationMs} ms (OpenAI istekleri ${openaiRequestCount}, bellek önbelleği ${memoryCacheHits}).`
    )
    toTranslate.forEach((item, i) => {
      const r = structured[i]!
      const raw = item.row.description
      const d = normDesc(raw)
      const tr = r.descriptionTr.trim()
      item.row.description_tr = tr === d ? null : tr
      item.row.affected_products = r.affectedProducts.length > 0 ? r.affectedProducts : null
    })
  } else {
    console.info(
      `[NVD persist] LLM atlandı: kuyruk ${toTranslate.length} (OpenAI anahtarı: ${openaiKey ? 'var' : 'yok'}). DB’den korunan ${reusedFromDb}, yeni ${newRowCount}.`
    )
  }

  const chunkSize = 500
  console.info(`[NVD persist] Veritabanı yazımı: ${rows.length} satır, parça boyutu ${chunkSize}.`)
  const t = await sequelize.transaction()
  try {
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize)
      await Cve.bulkCreate(chunk as never[], {
        transaction: t,
        updateOnDuplicate: [...CVE_UPSERT_FIELDS],
      })
    }
    await t.commit()
  } catch (e) {
    await t.rollback()
    throw e
  }
  console.info(`[NVD persist] Bitti: ${rows.length} kayıt upsert.`)

  return {
    upserted: rows.length,
    skippedInvalid,
    llm: {
      reusedFromDb,
      newRowCount,
      newRowsSkippedLlm,
      llmQueueCount,
      openaiRequestCount,
      memoryCacheHits,
      llmDurationMs,
      hadOpenaiKey: Boolean(openaiKey),
    },
  }
}

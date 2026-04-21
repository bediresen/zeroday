import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DateTime } from 'luxon'
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces'
import { pickCvssV31Strings, pickEnglishDescription } from '../../app/utils/nvdDisplay'
import { countCveSeverityBuckets, formatExecutiveSeverityBreakdownTr } from './cveReportMjml'
import type { NvdCveItem, NvdCveItemWithTr } from './nvdCve.helper'

function createPdfRequire() {
  const cwd = process.cwd()
  const nitroAnchor = join(cwd, '.output', 'server', 'index.mjs')
  const anchor = existsSync(nitroAnchor) ? nitroAnchor : join(cwd, 'package.json')
  return createRequire(anchor)
}

const pdfRequire = createPdfRequire()

let pdfMakeReady = false

function ensurePdfMake() {
  if (pdfMakeReady) return
  const pdfMake = pdfRequire('pdfmake') as {
    virtualfs: { writeFileSync: (name: string, buf: Buffer) => void }
    setFonts: (f: Record<string, unknown>) => void
    createPdf: (def: TDocumentDefinitions) => { getBuffer: () => Promise<Buffer> }
  }
  const vfs = pdfRequire('pdfmake/build/vfs_fonts.js') as Record<string, string>
  for (const key of Object.keys(vfs)) {
    const b64 = vfs[key]
    if (typeof b64 !== 'string') continue
    pdfMake.virtualfs.writeFileSync(key, Buffer.from(b64, 'base64'))
  }
  pdfMake.setFonts({
    Roboto: {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italics: 'Roboto-Italic.ttf',
      bolditalics: 'Roboto-MediumItalic.ttf',
    },
  })
  pdfMakeReady = true
}

const PDF_MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/** `assets/kapak.png` — statik kapak; yalnızca rapor tarihi kodla üstüne basılır */
function resolveKapakPngPath(): string | null {
  const candidates = [
    join(process.cwd(), 'assets', 'kapak.png'),
    join(PDF_MODULE_DIR, '..', '..', 'assets', 'kapak.png'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

/** pdfmake A4 varsayılanı (pt); `kapak.png` ile hizalı — gerekirse tarih kutusunu kaydırmak için */
const COVER_A4_W_PT = 595.28
const COVER_A4_H_PT = 841.89
/** PNG’de boş bırakılan tarih alanının üst kenarı (sayfa sol üstüne göre) */
const COVER_KAPAK_DATE_TOP_PT = 458
const COVER_KAPAK_DATE_BOX_W_PT = 268
const COVER_KAPAK_DATE_LEFT_PT = (COVER_A4_W_PT - COVER_KAPAK_DATE_BOX_W_PT) / 2

function loadKapakCoverDataUrl(): string | null {
  try {
    const p = resolveKapakPngPath()
    if (!p) {
      console.warn('[nvdTodayPdf] Kapak görseli bulunamadı (assets/kapak.png).')
      return null
    }
    const buf = readFileSync(p)
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch (e) {
    console.warn('[nvdTodayPdf] Kapak görseli okunamadı:', e)
    return null
  }
}

/** NVD `published`: offset yoksa UTC kabul et (NVD yayın anı) */
function parseNvdPublishedInstant(raw: string): DateTime | null {
  const hasZone = /Z$/i.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw) || /[+-]\d{4}$/.test(raw)
  const dt = hasZone
    ? DateTime.fromISO(raw, { setZone: true })
    : DateTime.fromISO(raw, { zone: 'utc' })
  return dt.isValid ? dt : null
}

/** NVD yayın anını ayarlardaki TZ’de tek satır (NVD UTC satırı yok) */
function formatPublishedForPdf(raw: string, displayTimeZone: string): string {
  if (!raw || raw === '—') return '—'
  const dt = parseNvdPublishedInstant(raw)
  if (!dt) return raw
  const local = dt.setZone(displayTimeZone)
  return `${local.toFormat('dd.MM.yyyy HH:mm')} (${displayTimeZone})`
}

/** cpe:2.3:a:vendor:product:version:... → okunabilir etiket */
function cpeCriteriaToLabel(criteria: string): string | null {
  const s = criteria.trim()
  if (!s.toLowerCase().startsWith('cpe:2.3')) return null
  const parts = s.split(':')
  if (parts.length < 6) return null
  const vendor = unescapeCpeToken(parts[3] ?? '')
  const product = unescapeCpeToken(parts[4] ?? '')
  const version = unescapeCpeToken(parts[5] ?? '')
  if (!vendor && !product) return null
  let out = [vendor, product].filter(Boolean).join(' ')
  if (version && version !== '*' && version !== '-') {
    out += ` ${version}`
  }
  return out.trim() || null
}

function unescapeCpeToken(t: string): string {
  if (!t || t === '*') return ''
  return t.replace(/\\([\\.!_*$?"'()#])/g, '$1').replace(/_/g, ' ')
}

function collectCpeLabelsFromCve(cve: Record<string, unknown> | undefined): string[] {
  const out: string[] = []
  const configs = cve?.configurations
  if (!Array.isArray(configs)) return out
  for (const cfg of configs) {
    const nodes = (cfg as { nodes?: unknown[] })?.nodes
    if (!Array.isArray(nodes)) continue
    for (const node of nodes) {
      const matches = (node as { cpeMatch?: unknown[] })?.cpeMatch
      if (!Array.isArray(matches)) continue
      for (const m of matches) {
        const criteria = (m as { criteria?: string })?.criteria
        if (typeof criteria !== 'string' || !criteria.trim()) continue
        const label = cpeCriteriaToLabel(criteria)
        if (label) out.push(label)
      }
    }
  }
  return out
}

function collectProductNamesForCve(item: NvdCveItemWithTr): string[] {
  const db = item.affectedProducts
  const dbList = Array.isArray(db)
    ? db.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
    : []
  if (dbList.length > 0) return [...new Set(dbList)]
  const cve = item.cve as Record<string, unknown> | undefined
  return [...new Set(collectCpeLabelsFromCve(cve))]
}

function getCveIdFromItem(item: NvdCveItemWithTr): string {
  const cve = item.cve as Record<string, unknown> | undefined
  const id = cve?.id
  return typeof id === 'string' && id.trim() ? id.trim() : '—'
}

/** Ürün etiketiyle eşleşen tüm CVE kimlikleri (sıralı, tekrarsız) */
function collectCveIdsForProductLabel(items: NvdCveItemWithTr[], productLabel: string): string[] {
  const pLc = productLabel.trim().toLowerCase()
  const ids = new Set<string>()
  for (const item of items) {
    for (const n of collectProductNamesForCve(item)) {
      if (n.trim().toLowerCase() === pLc) {
        ids.add(getCveIdFromItem(item))
        break
      }
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b, 'en'))
}

/** `productBullets` sırasına göre gruplama; eşleşme yoksa listenin sonuna */
function vulnerabilityProductSortRank(item: NvdCveItemWithTr, productBullets: string[]): number {
  const names = collectProductNamesForCve(item)
  const lowerToCanon = new Map(productBullets.map((p) => [p.toLowerCase(), p]))
  let best = Infinity
  for (const n of names) {
    const canon = lowerToCanon.get(n.trim().toLowerCase())
    if (!canon) continue
    const idx = productBullets.indexOf(canon)
    if (idx >= 0 && idx < best) best = idx
  }
  return best === Infinity ? productBullets.length : best
}

function sortVulnerabilitiesByProductBullets(
  items: NvdCveItemWithTr[],
  productBullets: string[]
): NvdCveItemWithTr[] {
  return [...items].sort((a, b) => {
    const ra = vulnerabilityProductSortRank(a, productBullets)
    const rb = vulnerabilityProductSortRank(b, productBullets)
    if (ra !== rb) return ra - rb
    return getCveIdFromItem(a).localeCompare(getCveIdFromItem(b), 'en')
  })
}

/** pdfmake iç bağlantı hedefi — ürün listesi indeksi ile sabit */
function pdfProductAnchorId(productIndex: number): string {
  return `prod-${productIndex}`
}

function primaryAffectedProduct(cve: Record<string, unknown> | undefined): string {
  const labels = collectCpeLabelsFromCve(cve)
  if (labels.length === 0) return 'Belirtilmemiştir'
  const unique = [...new Set(labels)]
  return unique[0] ?? 'Belirtilmemiştir'
}

function affectedSystemsText(cve: Record<string, unknown> | undefined): string {
  const labels = collectCpeLabelsFromCve(cve)
  if (labels.length === 0) return 'Henüz belirtilmemiştir.'
  const unique = [...new Set(labels)]
  return unique.join('\n')
}

/** Veritabanındaki LLM `affected_products` varsa öncelik; yoksa NVD CPE listesi */
function primaryProductForPdf(item: NvdCveItemWithTr): string {
  const db = item.affectedProducts
  if (Array.isArray(db)) {
    const first = db.map((s) => (typeof s === 'string' ? s.trim() : '')).find(Boolean)
    if (first) return first
  }
  const cve = item.cve as Record<string, unknown> | undefined
  return primaryAffectedProduct(cve)
}

function affectedSystemsTextForPdf(item: NvdCveItemWithTr): string {
  const db = item.affectedProducts
  if (Array.isArray(db) && db.length > 0) {
    const unique = [...new Set(db.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean))]
    if (unique.length > 0) return unique.join('\n')
  }
  const cve = item.cve as Record<string, unknown> | undefined
  return affectedSystemsText(cve)
}

function weaknessNames(cve: Record<string, unknown> | undefined): string {
  const w = cve?.weaknesses
  if (!Array.isArray(w) || w.length === 0) return '—'
  const parts: string[] = []
  for (const item of w) {
    const desc = (item as { description?: { lang?: string; value?: string }[] })?.description
    if (!Array.isArray(desc)) continue
    const en = desc.find((d) => d.lang === 'en') || desc[0]
    if (typeof en?.value === 'string' && en.value.trim()) parts.push(en.value.trim())
  }
  return parts.length ? parts.join('; ') : '—'
}

type CvssMetricV31 = {
  source?: string
  type?: string
  cvssData?: { baseScore?: number; baseSeverity?: string }
}

/** NVD `baseSeverity` (İngilizce) → PDF’de Türkçe etiket */
const CVSS_SEVERITY_LABEL_TR: Record<string, string> = {
  CRITICAL: 'Kritik',
  HIGH: 'Yüksek',
  MEDIUM: 'Orta',
  LOW: 'Düşük',
  NONE: 'Yok',
  UNKNOWN: 'Belirtilmemiş',
  MODERATE: 'Orta',
}

function cvssSeverityLabelTr(sev: string | undefined | null): string {
  if (sev == null) return '—'
  const t = String(sev).trim()
  if (!t || t === '—') return t
  const k = t.toUpperCase()
  return CVSS_SEVERITY_LABEL_TR[k] ?? t
}

/** Tablo üst şeridinde tek satır CVSS özeti (CVE kimliği ile aynı satır) */
function cvssScoreLineForTableHeader(cve: Record<string, unknown> | undefined): string {
  const metrics = cve?.metrics as {
    cvssMetricV31?: CvssMetricV31[]
    cvssMetricV40?: CvssMetricV31[]
  } | undefined
  const list = metrics?.cvssMetricV31?.length ? metrics.cvssMetricV31 : metrics?.cvssMetricV40
  if (Array.isArray(list) && list.length > 0) {
    const primary = list.find((m) => m.type === 'Primary') || list[0]
    const score = primary?.cvssData?.baseScore
    const sev = primary?.cvssData?.baseSeverity
    const sc = typeof score === 'number' ? String(score) : '—'
    const tail = typeof sev === 'string' && sev.trim() ? ` (${cvssSeverityLabelTr(sev)})` : ''
    return `${sc}${tail}`
  }
  const f = pickCvssV31Strings(cve as NvdCveItem['cve'])
  if (f.score === '—' && f.severity === '—') return '—'
  return `${f.score} (${cvssSeverityLabelTr(f.severity)})`
}

function formatCvssBlock(cve: Record<string, unknown> | undefined): string {
  const metrics = cve?.metrics as {
    cvssMetricV31?: CvssMetricV31[]
    cvssMetricV40?: CvssMetricV31[]
  } | undefined
  const list = metrics?.cvssMetricV31?.length ? metrics.cvssMetricV31 : metrics?.cvssMetricV40
  if (!Array.isArray(list) || list.length === 0) {
    const fallback = pickCvssV31Strings(cve as NvdCveItem['cve'])
    return `${fallback.score} (${cvssSeverityLabelTr(fallback.severity)})`
  }
  return list
    .map((m) => {
      const src = typeof m.source === 'string' ? m.source : 'NVD'
      const score = m.cvssData?.baseScore
      const sev = m.cvssData?.baseSeverity
      const sc = typeof score === 'number' ? String(score) : '—'
      const tail = sev ? ` (${cvssSeverityLabelTr(String(sev))})` : ''
      return `${src}: ${sc}${tail}`
    })
    .join('\n')
}

function referencesValueCell(cve: Record<string, unknown> | undefined): TableCell {
  const refs = cve?.references
  if (!Array.isArray(refs) || refs.length === 0) {
    return valueCell('—')
  }
  const urls = refs
    .map((r) => (typeof (r as { url?: string }).url === 'string' ? (r as { url: string }).url.trim() : ''))
    .filter(Boolean)
  if (!urls.length) return valueCell('—')

  const parts: Content[] = []
  urls.forEach((url, idx) => {
    if (idx > 0) parts.push('\n')
    parts.push({
      text: url,
      link: url,
      color: '#1a0dab',
      decoration: 'underline',
      fontSize: 10,
    })
  })

  return {
    border: [true, true, true, true],
    style: 'detailValue',
    text: parts,
  }
}

function labelCell(text: string): TableCell {
  return {
    text,
    style: 'detailLabel',
    fillColor: '#f0f0f5',
    border: [true, true, true, true],
  }
}

function valueCell(text: string): TableCell {
  return {
    text,
    style: 'detailValue',
    border: [true, true, true, true],
  }
}

/** DB’de Türkçe varsa onu, yoksa NVD İngilizce açıklamayı kullanır */
function pickDescriptionForPdf(item: NvdCveItemWithTr): string {
  const tr = item.descriptionTr?.trim()
  if (tr) return tr
  const en = pickEnglishDescription(item.cve as Parameters<typeof pickEnglishDescription>[0])
  return typeof en === 'string' && en.trim() ? en : '—'
}

function buildCveDetailTable(
  item: NvdCveItemWithTr,
  pageBreakBefore: boolean,
  displayTimeZone: string,
  options?: { pdfAnchorIds?: string[] }
): Content {
  const cveRaw = item.cve
  const cve = cveRaw as Record<string, unknown> | undefined
  const id = typeof cve?.id === 'string' ? cve.id : '—'
  const publishedRaw = typeof cve?.published === 'string' ? cve.published : '—'
  const published = formatPublishedForPdf(publishedRaw, displayTimeZone)
  const status = typeof cve?.vulnStatus === 'string' ? cve.vulnStatus : '—'
  const description = pickDescriptionForPdf(item)
  const scoreHeader = cvssScoreLineForTableHeader(cve)

  const body: TableCell[][] = [
    [
      {
        text: id,
        style: 'cveTableTitle',
        fillColor: '#1e1b36',
        color: '#ffffff',
        border: [true, true, false, true],
        alignment: 'left',
      },
      {
        text: scoreHeader,
        style: 'cveTableTitle',
        fillColor: '#1e1b36',
        color: '#ffffff',
        border: [false, true, true, true],
        alignment: 'right',
      },
    ],
    [labelCell('Zafiyetin Bulunduğu Ürün'), valueCell(primaryProductForPdf(item))],
    [labelCell('Zafiyetin Adı'), valueCell(weaknessNames(cve))],
    [labelCell('Zafiyet Açıklaması'), valueCell(description)],
    [labelCell('Yayınlanma Tarihi'), valueCell(published)],
    [labelCell('CVSS Skoru'), valueCell(formatCvssBlock(cve))],
    [labelCell('Durum'), valueCell(status)],
    [labelCell('Etkilenen Sistemler'), valueCell(affectedSystemsTextForPdf(item))],
    [labelCell('Referanslar'), referencesValueCell(cve)],
  ]

  const tableBlock: Content = {
    table: {
      widths: [148, '*'],
      dontBreakRows: false,
      body,
    },
    layout: {
      hLineWidth: () => 0.6,
      vLineWidth: () => 0.6,
      hLineColor: () => '#c8c8d4',
      vLineColor: () => '#c8c8d4',
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: (i) => (i <= 1 ? 10 : 7),
      paddingBottom: (i) => (i <= 1 ? 10 : 7),
    },
    margin: [0, 0, 0, 18],
  }

  const anchorIds = options?.pdfAnchorIds?.filter(Boolean) ?? []
  const block: Content =
    anchorIds.length > 0
      ? {
          stack: [
            ...anchorIds.map(
              (aid) =>
                ({
                  text: '\u200b',
                  fontSize: 0.5,
                  lineHeight: 0.5,
                  color: '#ffffff',
                  id: aid,
                }) as Content
            ),
            tableBlock,
          ],
        }
      : tableBlock

  if (pageBreakBefore) {
    return { stack: [block], pageBreak: 'before' }
  }
  return block
}

/**
 * Yayın penceresi tek satır — ok/Unicode okları yok (pdfmake varsayılan fontta «tofu» olmasın).
 * Biçim: `15.04.2026 : 15:29 -- 16.04.2026 : 15:29`
 */
function formatPublicationWindowLineForPdf(params: {
  pubStartDate: string
  pubEndDate: string
  displayTimeZone: string
}): string {
  const tz = params.displayTimeZone?.trim() || 'Europe/Istanbul'
  const fmt = "dd.LL.yyyy ' : 'HH:mm"

  function formatOne(iso: string): string {
    const s = iso.trim()
    if (!s) return '—'
    const hasZone = /Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)
    const dt = DateTime.fromISO(hasZone ? s : `${s}Z`, { setZone: true })
    if (!dt.isValid) return s
    return dt.setZone(tz).toFormat(fmt)
  }

  return `${formatOne(params.pubStartDate)} -- ${formatOne(params.pubEndDate)}`
}

export type NvdTodayPdfInput = {
  pubStartDate: string
  pubEndDate: string
  totalResults: number
  /** `descriptionTr` dolu ise PDF’de Türkçe açıklama basılır */
  vulnerabilities: NvdCveItemWithTr[]
  /** Ayarlardaki IANA TZ — CVE yayın satırı ve kapak altbilgisi için yerel saat */
  displayTimeZone: string
  /** `resolveNvdPublicationWindow().windowSummary` — pencere özeti (yerel saatler) */
  windowSummary?: string
}

export async function buildNvdTodayPdfBuffer(input: NvdTodayPdfInput): Promise<Buffer> {
  ensurePdfMake()
  const pdfMake = pdfRequire('pdfmake') as {
    createPdf: (def: TDocumentDefinitions) => { getBuffer: () => Promise<Buffer> }
  }

  const tz = input.displayTimeZone || 'Europe/Istanbul'
  const genLocal = DateTime.now().setZone(tz)
  const reportDateShort = genLocal.isValid ? genLocal.toFormat('dd.MM.yyyy') : '—'
  const generatedAtFooter = genLocal.isValid
    ? `${genLocal.toFormat('dd.MM.yyyy HH:mm')}`
    : new Date().toLocaleString('tr-TR')

  /** LLM `affected_products` doluysa rapor listesine yalnızca onu al; aksi halde NVD CPE yedek */
  const productSet = new Set<string>()
  for (const item of input.vulnerabilities) {
    for (const p of collectProductNamesForCve(item)) {
      productSet.add(p)
    }
  }
  const productBullets = [...productSet].sort((a, b) => a.localeCompare(b, 'tr'))

  const vulnerabilitiesOrdered = sortVulnerabilitiesByProductBullets(
    input.vulnerabilities,
    productBullets
  )

  const windowLineForPdf = formatPublicationWindowLineForPdf({
    pubStartDate: input.pubStartDate,
    pubEndDate: input.pubEndDate,
    displayTimeZone: tz,
  })

  const severityCounts = countCveSeverityBuckets(input.vulnerabilities)
  const severityBreakdownTr = formatExecutiveSeverityBreakdownTr(severityCounts)
  const totalListed = input.vulnerabilities.length

  const executiveSummaryBody =
    'Bu belge, Ulusal Güvenlik Açıkları Veritabanı üzerinde ' +
    `${windowLineForPdf} tarih aralığında yayımlanan güvenlik açıklarının ayrıntılı dökümüdür. ` +
    `Toplam ${totalListed} adet açık bulunmuştur. ${severityBreakdownTr} ` +
    'Her kayıt aşağıda kendi tablosunda sunulmuştur. Kurum içi risk değerlendirmesi için referans amaçlıdır.'

  const kapakDataUrl = loadKapakCoverDataUrl()

  const coverDateLines: Content[] = [
    {
      text: 'RAPOR TARİHİ',
      style: 'coverKapakDateLabel',
      alignment: 'center',
      margin: [0, 0, 0, 5],
    },
    {
      text: reportDateShort,
      style: 'coverKapakDateBig',
      alignment: 'center',
      margin: [0, 0, 0, 0],
    },
  ]

  /** Mutlak tarih üstte kalsın diye önce akış yüksekliği, sonra tarih (pdfmake çizim sırası). */
  const coverStack: Content[] = [
    {
      text: '\u200b',
      fontSize: 1,
      color: '#ffffff',
      margin: [0, 0, 0, Math.max(0, COVER_A4_H_PT - 140)],
    },
    {
      absolutePosition: { x: COVER_KAPAK_DATE_LEFT_PT, y: COVER_KAPAK_DATE_TOP_PT },
      columns: [{ width: COVER_KAPAK_DATE_BOX_W_PT, stack: coverDateLines }],
    },
  ]


  const content: Content[] = [
    {
      stack: coverStack,
      pageBreak: 'after',
    },
    { text: 'Yönetici Özeti', style: 'h2', margin: [0, 0, 0, 8] },
    {
      text: executiveSummaryBody,
      alignment: 'justify',
      fontSize: 10,
      margin: [0, 0, 0, 16],
    },
    { text: 'Zafiyet Barındıran Ürünler', style: 'h2', margin: [0, 0, 0, 8] },
  ]

  if (productBullets.length === 0) {
    content.push({
      text:
        input.vulnerabilities.length === 0
          ? 'Bu yayın penceresi için NVD kaydı bulunamadığından ürün listesi boştur.'
          : 'NVD kayıtlarında yapılandırma (CPE) bilgisi bulunamadı; ayrıntılar CVE tablolarında açıklama ve referanslardan takip edilebilir.',
      italics: true,
      fontSize: 10,
      color: '#555555',
      margin: [0, 0, 0, 14],
    })
  } else {
    const productCveBody: TableCell[][] = productBullets.map((label, idx) => {
      const cveIds = collectCveIdsForProductLabel(input.vulnerabilities, label)
      const cvePart = cveIds.length ? cveIds.join(', ') : '—'
      return [
        {
          text: label,
          style: 'pdfProductListLink',
          linkToDestination: pdfProductAnchorId(idx),
          border: [true, true, true, true],
        },
        {
          text: cvePart,
          style: 'productCveTableCveCell',
          border: [true, true, true, true],
        },
      ]
    })
    content.push({
      table: {
        widths: [168, '*'],
        headerRows: 1,
        dontBreakRows: false,
        body: [
          [
            {
              text: 'Ürün veya bileşen',
              style: 'productCveTableHead',
              border: [true, true, true, true],
            },
            {
              text: 'İlgili CVE kimlikleri',
              style: 'productCveTableHead',
              border: [true, true, true, true],
            },
          ],
          ...productCveBody,
        ],
      },
      layout: {
        hLineWidth: () => 0.55,
        vLineWidth: () => 0.55,
        hLineColor: () => '#c8ced9',
        vLineColor: () => '#c8ced9',
        paddingLeft: () => 8,
        paddingRight: () => 8,
        paddingTop: (i) => (i === 0 ? 7 : 6),
        paddingBottom: (i) => (i === 0 ? 7 : 6),
      },
      margin: [0, 0, 0, 14],
    })
  }

  content.push({
    text: 'Zafiyet Detayları',
    style: 'h2',
    pageBreak: vulnerabilitiesOrdered.length > 0 ? 'before' : undefined,
    margin: [0, 4, 0, 10],
  })

  if (vulnerabilitiesOrdered.length === 0) {
    content.push({
      table: {
        widths: ['*'],
        body: [
          [
            {
              text: 'Bu yayın penceresi için NVD kaydı bulunamadı.',
              alignment: 'center',
              italics: true,
              margin: [12, 14, 12, 14],
              fontSize: 11,
            },
          ],
        ],
      },
      layout: {
        hLineWidth: () => 0.8,
        vLineWidth: () => 0.8,
        hLineColor: () => '#cccccc',
        vLineColor: () => '#cccccc',
      },
    })
  } else {
    const firstCveIndexForProduct = new Map<number, number>()
    vulnerabilitiesOrdered.forEach((item, i) => {
      const nameLc = new Set(collectProductNamesForCve(item).map((n) => n.trim().toLowerCase()))
      productBullets.forEach((p, j) => {
        if (firstCveIndexForProduct.has(j)) return
        if (nameLc.has(p.trim().toLowerCase())) {
          firstCveIndexForProduct.set(j, i)
        }
      })
    })

    vulnerabilitiesOrdered.forEach((item, i) => {
      const pdfAnchorIds = [...firstCveIndexForProduct.entries()]
        .filter(([, firstIdx]) => firstIdx === i)
        .map(([j]) => pdfProductAnchorId(j))
      content.push(buildCveDetailTable(item, i > 0, tz, { pdfAnchorIds }))
    })
  }

  content.push({
    text:
      'Kaynak: NVD API 2.0 (https://nvd.nist.gov). Zafiyet açıklaması: veritabanında Türkçe kayıt varsa o metin, yoksa NVD İngilizce açıklaması kullanılmıştır. CWE adları NVD kaydındaki dildedir.',
    fontSize: 8,
    color: '#666666',
    margin: [0, 20, 0, 0],
  })

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [42, 52, 42, 60],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#1a1a1a' },
    ...(kapakDataUrl ? { images: { kapakCover: kapakDataUrl } } : {}),
    background: (currentPage, pageSize) => {
      const w = pageSize.width
      const h = pageSize.height
      if (currentPage === 1) {
        if (kapakDataUrl) {
          return [
            {
              image: 'kapakCover',
              width: w,
              height: h,
              absolutePosition: { x: 0, y: 0 },
            },
          ] as Content[]
        }
        return [
          {
            canvas: [{ type: 'rect', x: 0, y: 0, w, h, color: '#0a1a30' }],
            absolutePosition: { x: 0, y: 0 },
          },
        ] as Content[]
      }
      return [
        {
          canvas: [{ type: 'rect', x: 0, y: 0, w, h, color: '#ffffff' }],
          absolutePosition: { x: 0, y: 0 },
        },
      ] as Content[]
    },
    info: {
      title: `Siber Güvenlik Raporu — ${reportDateShort}`,
      author: 'CVE Modülü / NVD',
      subject: 'Günlük NVD özeti',
    },
    content,
    header: (currentPage: number, _pageCount: number) => {
      if (currentPage === 1) {
        return { text: '', margin: [0, 0, 0, 0] }
      }
      return {
        margin: [42, 6, 42, 0],
        columns: [
          { width: '*', text: '' },
          {
            width: 'auto',
            text: 'Genel | Kişisel Veri İçermez',
            fontSize: 7.5,
            color: '#666666',
            alignment: 'right',
            bold: true,
          },
        ],
      }
    },
    styles: {
      coverKapakDateLabel: {
        fontSize: 12,
        bold: true,
        characterSpacing: 1.5,
        color: '#ffffff',
      },
      coverKapakDateBig: { fontSize: 17, bold: true, color: '#ffffff' },
      h2: { fontSize: 13, bold: true, color: '#1e1b36' },
      pdfProductListLink: {
        fontSize: 10,
        color: '#1a5275',
        decoration: 'underline',
        decorationColor: '#1a5275',
      },
      productCveTableHead: {
        fontSize: 9,
        bold: true,
        color: '#4b5563',
        fillColor: '#eef1f6',
      },
      productCveTableCveCell: { fontSize: 10, color: '#1a1a1a' },
      cveTableTitle: { fontSize: 13, bold: true },
      detailLabel: { bold: true, fontSize: 9.5 },
      detailValue: { fontSize: 10 },
    },
    footer: (currentPage: number, pageCount: number) => {
      if (currentPage === 1) {
        return { text: '', margin: [0, 0, 0, 0] }
      }
      return {
        margin: [42, 10, 42, 0],
        columns: [
          {
            text: `turktelekomguvenlik.com`,
            fontSize: 7,
            color: '#888888',
          },
          {
            text: `Sayfa ${currentPage} / ${pageCount}`,
            alignment: 'right',
            fontSize: 7,
            color: '#888888',
          },
        ],
      }
    },
  }

  const pdf = pdfMake.createPdf(docDefinition)
  return pdf.getBuffer()
}

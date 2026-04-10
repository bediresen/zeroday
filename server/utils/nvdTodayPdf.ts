import { createRequire } from 'node:module'
import { DateTime } from 'luxon'
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces'
import { pickCvssV31Strings, pickEnglishDescription } from '../../app/utils/nvdDisplay'
import type { NvdCveItem, NvdCveItemWithTr } from './nvdCve.helper'

const require = createRequire(import.meta.url)

let pdfMakeReady = false

function ensurePdfMake() {
  if (pdfMakeReady) return
  const pdfMake = require('pdfmake') as {
    virtualfs: { writeFileSync: (name: string, buf: Buffer) => void }
    setFonts: (f: Record<string, unknown>) => void
    createPdf: (def: TDocumentDefinitions) => { getBuffer: () => Promise<Buffer> }
  }
  const vfs = require('pdfmake/build/vfs_fonts.js') as Record<string, string>
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

function formatDateTrUtc(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0')
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const y = d.getUTCFullYear()
  return `${day}.${mo}.${y}`
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

function formatCvssBlock(cve: Record<string, unknown> | undefined): string {
  const metrics = cve?.metrics as {
    cvssMetricV31?: CvssMetricV31[]
    cvssMetricV40?: CvssMetricV31[]
  } | undefined
  const list = metrics?.cvssMetricV31?.length ? metrics.cvssMetricV31 : metrics?.cvssMetricV40
  if (!Array.isArray(list) || list.length === 0) {
    const fallback = pickCvssV31Strings(cve as NvdCveItem['cve'])
    return `${fallback.score} (${fallback.severity})`
  }
  return list
    .map((m) => {
      const src = typeof m.source === 'string' ? m.source : 'NVD'
      const score = m.cvssData?.baseScore
      const sev = m.cvssData?.baseSeverity
      const sc = typeof score === 'number' ? String(score) : '—'
      const tail = sev ? ` (${sev})` : ''
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
  displayTimeZone: string
): Content {
  const cveRaw = item.cve
  const cve = cveRaw as Record<string, unknown> | undefined
  const id = typeof cve?.id === 'string' ? cve.id : '—'
  const publishedRaw = typeof cve?.published === 'string' ? cve.published : '—'
  const published = formatPublishedForPdf(publishedRaw, displayTimeZone)
  const status = typeof cve?.vulnStatus === 'string' ? cve.vulnStatus : '—'
  const description = pickDescriptionForPdf(item)

  const body: TableCell[][] = [
    [
      {
        text: id,
        style: 'cveTableTitle',
        colSpan: 2,
        fillColor: '#1e1b36',
        color: '#ffffff',
        border: [true, true, true, true],
      },
      {},
    ],
    [labelCell('Zafiyetin Bulunduğu Ürün'), valueCell(primaryAffectedProduct(cve))],
    [labelCell('Zafiyetin Adı'), valueCell(weaknessNames(cve))],
    [labelCell('Zafiyet Açıklaması'), valueCell(description)],
    [labelCell('Yayınlanma Tarihi'), valueCell(published)],
    [labelCell('CVSS Skoru'), valueCell(formatCvssBlock(cve))],
    [labelCell('Durum'), valueCell(status)],
    [labelCell('Etkilenen Sistemler'), valueCell(affectedSystemsText(cve))],
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

  if (pageBreakBefore) {
    return { stack: [tableBlock], pageBreak: 'before' }
  }
  return tableBlock
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
  const pdfMake = require('pdfmake') as {
    createPdf: (def: TDocumentDefinitions) => { getBuffer: () => Promise<Buffer> }
  }

  const dayUtc = new Date()
  const reportDateStr = formatDateTrUtc(dayUtc)
  const tz = input.displayTimeZone || 'UTC'
  const genLocal = DateTime.now().setZone(tz)
  const genUtc = DateTime.utc()
  const generatedAtFooter =
    genLocal.isValid && genUtc.isValid
      ? `${genLocal.toFormat('dd.MM.yyyy HH:mm')} (${tz}) · ${genUtc.toFormat('yyyy-MM-dd HH:mm:ss')} UTC`
      : `${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`

  const productSet = new Set<string>()
  for (const item of input.vulnerabilities) {
    const cve = item.cve as Record<string, unknown> | undefined
    for (const label of collectCpeLabelsFromCve(cve)) {
      productSet.add(label)
    }
  }
  const productBullets = [...productSet].sort((a, b) => a.localeCompare(b, 'tr'))

  const content: Content[] = [
    {
      table: {
        widths: ['*'],
        body: [
          [
            {
              stack: [
                {
                  text: 'Siber Güvenlik 0-day Zafiyet Bildirimi',
                  style: 'coverTitle',
                  color: '#ffffff',
                  alignment: 'center',
                },
                {
                  text: 'Raporu',
                  style: 'coverSubtitle',
                  color: '#e8e8f0',
                  alignment: 'center',
                  margin: [0, 6, 0, 0],
                },
                {
                  text: `Rapor tarihi (UTC): ${reportDateStr}`,
                  style: 'coverSub',
                  color: '#d0d0e0',
                  alignment: 'center',
                  margin: [0, 14, 0, 0],
                },
              ],
              fillColor: '#1e1b36',
              margin: [20, 36, 20, 36],
            },
          ],
        ],
      },
      layout: 'noBorders',
    },
    { text: '', pageBreak: 'after' as const },
    { text: 'Yönetici Özeti', style: 'h2', margin: [0, 0, 0, 8] },
    {
      text:
        'Bu belge, Ulusal Güvenlik Açıkları Veritabanı (NVD) üzerinde seçilen yayın penceresinde yayımlanan güvenlik açıklarının ayrıntılı dökümüdür. ' +
        'Her kayıt aşağıda kendi tablosunda sunulmuştur. Kurum içi risk değerlendirmesi için referans amaçlıdır; kesin teknik kapsam için NVD ve üretici bültenleri esas alınmalıdır.',
      alignment: 'justify',
      fontSize: 10,
      margin: [0, 0, 0, 10],
    },
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: 'Yayın penceresi', style: 'metaLabel' },
            {
              text: input.windowSummary
                ? `${input.windowSummary}\nUTC (NVD aralığı): ${input.pubStartDate} → ${input.pubEndDate}`
                : `${input.pubStartDate} → ${input.pubEndDate}`,
              style: 'metaValue',
              margin: [0, 2, 0, 0],
            },
          ],
        },
        {
          width: '*',
          stack: [
            { text: 'Toplam kayıt (NVD)', style: 'metaLabel' },
            { text: String(input.totalResults), style: 'metaValue', margin: [0, 2, 0, 0] },
          ],
        },
      ],
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
    content.push({
      ul: productBullets,
      fontSize: 10,
      margin: [0, 0, 0, 14],
    })
  }

  content.push({
    text: 'Zafiyet Detayları',
    style: 'h2',
    pageBreak: input.vulnerabilities.length > 0 ? 'before' : undefined,
    margin: [0, 4, 0, 10],
  })

  if (input.vulnerabilities.length === 0) {
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
    input.vulnerabilities.forEach((item, i) => {
      content.push(buildCveDetailTable(item, i > 0, tz))
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
    info: {
      title: `Siber Güvenlik 0-day Zafiyet Bildirimi — ${reportDateStr}`,
      author: 'CVE Modülü / NVD',
      subject: 'Günlük NVD özeti',
    },
    content,
    styles: {
      coverTitle: { fontSize: 20, bold: true },
      coverSubtitle: { fontSize: 14, bold: true },
      coverSub: { fontSize: 11 },
      h2: { fontSize: 13, bold: true, color: '#1e1b36' },
      metaLabel: { fontSize: 8, bold: true, color: '#666666' },
      metaValue: { fontSize: 10 },
      cveTableTitle: { fontSize: 13, bold: true },
      detailLabel: { bold: true, fontSize: 9.5 },
      detailValue: { fontSize: 10 },
    },
    footer: (currentPage: number, pageCount: number) => ({
      margin: [42, 10, 42, 0],
      columns: [
        {
          text: `Oluşturulma: ${generatedAtFooter}`,
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
    }),
  }

  const pdf = pdfMake.createPdf(docDefinition)
  return pdf.getBuffer()
}

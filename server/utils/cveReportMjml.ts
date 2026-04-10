import mjml2html from 'mjml'
import { pickCvssV31Strings } from '../../app/utils/nvdDisplay'
import type { NvdCveItemWithTr } from './nvdCve.helper'

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE', 'UNKNOWN'] as const

const SEVERITY_LABEL_TR: Record<(typeof SEVERITY_ORDER)[number], string> = {
  CRITICAL: 'Kritik',
  HIGH: 'Yüksek',
  MEDIUM: 'Orta',
  LOW: 'Düşük',
  NONE: 'Yok',
  UNKNOWN: 'Belirtilmemiş',
}

function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizeSeverityKey(raw: string): (typeof SEVERITY_ORDER)[number] {
  if (!raw || raw === '—' || raw === '-') return 'UNKNOWN'
  const s = raw.trim().toUpperCase()
  if ((SEVERITY_ORDER as readonly string[]).includes(s)) {
    return s as (typeof SEVERITY_ORDER)[number]
  }
  return 'UNKNOWN'
}

export function countCveSeverityBuckets(items: NvdCveItemWithTr[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const k of SEVERITY_ORDER) counts[k] = 0
  for (const item of items) {
    const raw = pickCvssV31Strings(item.cve).severity
    const key = normalizeSeverityKey(raw)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function buildSeverityRowsHtml(counts: Record<string, number>): string {
  let rows = ''
  for (const key of SEVERITY_ORDER) {
    const label = escapeXmlText(SEVERITY_LABEL_TR[key])
    const n = counts[key] ?? 0
    rows += `<tr><td style="padding:8px;border:1px solid #dee2e6;">${label}</td><td style="padding:8px;border:1px solid #dee2e6;text-align:right;">${n}</td></tr>`
  }
  return rows
}

export function compileCveReportEmailHtml(params: {
  windowSummary: string
  total: number
  vulnerabilities: NvdCveItemWithTr[]
  year: number
}): string {
  const counts = countCveSeverityBuckets(params.vulnerabilities)
  const severityRowsHtml = buildSeverityRowsHtml(counts)
  const windowSafe = escapeXmlText(params.windowSummary)
  const mjmlSrc = `
<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Arial, Helvetica, sans-serif" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-section background-color="#0056b3" padding="10px">
      <mj-column>
        <mj-text font-size="22px" font-weight="600" color="white" align="center">
          Siber Güvenlik — CVE Özeti
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="15px 15px 5px 15px">
      <mj-column>
        <mj-text font-size="14px" color="#555555" align="center">
          ${windowSafe}
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0px 15px" border-radius="8px">
      <mj-column padding="10px" background-color="#ffffff">
        <mj-text font-weight="bold" font-size="18px" color="#0056b3" align="center" padding-bottom="10px">
          Toplam ${params.total} kayıt
        </mj-text>
        <mj-text color="#333333" align="center" padding-bottom="15px" font-size="14px">
          Aşağıda CVSS 3.1 şiddet dağılımı yer almaktadır. Detaylı liste ekteki PDF raporundadır.
        </mj-text>
        <mj-text font-weight="600" font-size="16px" color="#333333" padding-bottom="8px">
          Şiddet dağılımı (CVSS 3.1)
        </mj-text>
        <mj-raw>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#333;">
            <thead>
              <tr style="background:#e9ecef;">
                <th style="padding:10px;border:1px solid #dee2e6;text-align:left;">Şiddet</th>
                <th style="padding:10px;border:1px solid #dee2e6;text-align:right;">Adet</th>
              </tr>
            </thead>
            <tbody>
              ${severityRowsHtml}
            </tbody>
          </table>
        </mj-raw>
      </mj-column>
    </mj-section>
    <mj-section padding="10px 15px">
      <mj-column>
        <mj-text font-size="13px" color="#555555">
          Ekte, yayın penceresine göre üretilen PDF raporu bulunmaktadır.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="10px 0" background-color="#f8f9fa">
      <mj-column>
        <mj-text font-size="12px" align="center" color="#6c757d">
          Bu otomatik bir mesajdır. © ${params.year} Tüm Hakları Saklıdır
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`
  const { html, errors } = mjml2html(mjmlSrc, { validationLevel: 'soft' })
  if (errors?.length) {
    console.warn('[cveReportMjml]', errors)
  }
  return html
}

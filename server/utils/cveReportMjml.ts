import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mjml2html from 'mjml'
import type { Attachment } from 'nodemailer/lib/mailer'
import { pickCvssV31Strings } from '../../app/utils/nvdDisplay'
import type { NvdCveItemWithTr } from './nvdCve.helper'

/** HTML `src="cid:…"` ile aynı olmalı; Gmail vb. için data-URI yerine inline ek */
export const CVE_EMAIL_BANNER_CID = 'zeroday-banner@zeroday'
export const CVE_EMAIL_LOGO_CID = 'zeroday-logo@zeroday'

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE', 'UNKNOWN'] as const

const SEVERITY_LABEL_TR: Record<(typeof SEVERITY_ORDER)[number], string> = {
  CRITICAL: 'Kritik',
  HIGH: 'Yüksek',
  MEDIUM: 'Orta',
  LOW: 'Düşük',
  NONE: 'Yok',
  UNKNOWN: 'Belirtilmemiş',
}

/** Üst bilgi + ara şerit — bülten (lacivert-mavi) ile uyumlu */
const EMAIL_STRIP_CLASSIFICATION_BG = '#1e3a52'
const EMAIL_STRIP_SECTION_BG = '#2a4f7c'

/** Tablo üst satırı — banner’a yakın mavi degrade */
const EMAIL_TABLE_HEAD_GRADIENT =
  'linear-gradient(118deg,#1a2f4a 0%,#244a73 42%,#2d5a8f 72%,#355f92 100%)'

const SEVERITY_EMAIL_ROW: Record<(typeof SEVERITY_ORDER)[number], { emoji: string; bg: string; accent: string }> = {
  CRITICAL: { emoji: '🚨', bg: '#FDF2F2', accent: '#B71C1C' },
  HIGH: { emoji: '⚡', bg: '#FFF8F0', accent: '#E65100' },
  MEDIUM: { emoji: '📌', bg: '#FFFCF0', accent: '#F57F17' },
  LOW: { emoji: '🔹', bg: '#EEF4FB', accent: '#1e4a8c' },
  NONE: { emoji: '◻️', bg: '#F4F7FB', accent: '#5c6f8a' },
  UNKNOWN: { emoji: '❔', bg: '#F4F7FB', accent: '#6b7c99' },
}

const CVE_REPORT_MODULE_DIR = dirname(fileURLToPath(import.meta.url))

function resolveCveEmailAssetPath(fileName: string): string | null {
  const candidates = [join(process.cwd(), 'assets', fileName), join(CVE_REPORT_MODULE_DIR, '..', '..', 'assets', fileName)]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

/** Nodemailer inline ekleri — `compileCveReportEmailHtml` ile aynı CID’ler */
export function buildCveReportEmailInlineImageAttachments(): Attachment[] {
  const out: Attachment[] = []
  const bannerPath = resolveCveEmailAssetPath('email-banner.png')
  if (bannerPath) {
    try {
      out.push({
        filename: 'email-banner.png',
        content: readFileSync(bannerPath),
        cid: CVE_EMAIL_BANNER_CID,
        contentDisposition: 'inline',
        contentType: 'image/png',
      })
    } catch {
      console.warn('[cveReportMjml] email-banner.png eklenemedi')
    }
  }
  const logoPath = resolveCveEmailAssetPath('tt-logo-white.svg')
  if (logoPath) {
    try {
      out.push({
        filename: 'tt-logo-white.svg',
        content: readFileSync(logoPath),
        cid: CVE_EMAIL_LOGO_CID,
        contentDisposition: 'inline',
        contentType: 'image/svg+xml',
      })
    } catch {
      console.warn('[cveReportMjml] tt-logo-white.svg eklenemedi')
    }
  }
  return out
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
    const st = SEVERITY_EMAIL_ROW[key]
    const emoji = st.emoji
    rows += `<tr style="background-color:${st.bg};">
  <td style="padding:12px 14px;border-bottom:1px solid #d4e0f0;border-left:5px solid ${st.accent};font-size:15px;color:#111827;">
    <span style="font-size:20px;line-height:1;vertical-align:middle;margin-right:8px;">${emoji}</span>
    <strong style="vertical-align:middle;">${label}</strong>
  </td>
  <td style="padding:12px 16px;border-bottom:1px solid #d4e0f0;text-align:right;font-size:20px;font-weight:800;color:${st.accent};">${n}</td>
</tr>`
  }
  return rows
}

/** E-posta gövdesinde saat dilimi parantezini kısaltmak için */
function stripTrailingIanaZoneForEmail(text: string): string {
  return text
    .trim()
    .replace(/\s*\([A-Za-z][A-Za-z0-9_]*\/[A-Za-z][A-Za-z0-9_/]*\)\s*$/u, '')
    .trim()
}

export function compileCveReportEmailHtml(params: {
  /** Bülten üst şeridindeki tarih (örn. yerel TZ’de bugün) */
  bulletinDateLabel: string
  windowSummary: string
  total: number
  vulnerabilities: NvdCveItemWithTr[]
  year: number
}): string {
  const hasBanner = Boolean(resolveCveEmailAssetPath('email-banner.png'))
  const hasLogo = Boolean(resolveCveEmailAssetPath('tt-logo-white.svg'))
  const bannerSrc = `cid:${CVE_EMAIL_BANNER_CID}`
  const logoSrc = `cid:${CVE_EMAIL_LOGO_CID}`

  const counts = countCveSeverityBuckets(params.vulnerabilities)
  const severityRowsHtml = buildSeverityRowsHtml(counts)
  const windowForBody = stripTrailingIanaZoneForEmail(params.windowSummary)
  const windowSafe = escapeXmlText(windowForBody)
  const dateSafe = escapeXmlText(params.bulletinDateLabel)
  const totalSafe = String(Math.max(0, Math.floor(params.total)))

  const heroBannerMjml = hasBanner
    ? `<mj-image src="${bannerSrc}" alt="ZERODAY CVE Bülteni" width="600px" padding="0" fluid-on-mobile="true" />`
    : ''

  const footerLogoMjml = hasLogo
    ? `<mj-image src="${logoSrc}" alt="Türk Telekom Güvenlik" width="140px" align="left" padding="0 0 14px 0" />`
    : ''

  const mjmlSrc = `
<mjml>
  <mj-head>
    <mj-title>ZERODAY CVE BÜLTENİ</mj-title>
    <mj-font name="Inter" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700" />
    <mj-attributes>
      <mj-all font-family="Inter, Arial, Helvetica, sans-serif" />
      <mj-text color="#1A1A1A" font-size="15px" line-height="1.55" />
    </mj-attributes>
    <mj-style inline="inline">
      .cve-table-wrap { border-radius: 12px; overflow: hidden; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08); }
    </mj-style>
  </mj-head>
  <mj-body background-color="#F3F4F6">
    <mj-section background-color="${EMAIL_STRIP_CLASSIFICATION_BG}" padding="8px 14px">
      <mj-group>
        <mj-column width="80%">
          <mj-text color="#E8F1FA" font-size="12px" font-weight="600" padding="0">
            Türk Telekom Siber Güvenlik Direktörlüğü • Dahili • Kişisel Veri İçermez
          </mj-text>
        </mj-column>
        <mj-column width="20%">
          <mj-text align="right" color="#E8F1FA" font-size="12px" font-weight="600" padding="0">
            ${dateSafe}
          </mj-text>
        </mj-column>
      </mj-group>
    </mj-section>
    <mj-section background-color="#1a1744" padding="0">
      <mj-column padding="0">
        ${heroBannerMjml}

      </mj-column>
    </mj-section>
    <mj-section background-color="#FFFFFF" padding="16px 18px 8px 18px" border-left="1px solid #E5E7EB" border-right="1px solid #E5E7EB" border-top="1px solid #E5E7EB">
      <mj-column>
        <mj-text font-size="15px" color="#374151" padding="0" line-height="1.65">
          ${windowSafe} tarih aralığında <strong>${totalSafe}</strong> adet yeni CVE kaydı bulunmuştur. CVSS 3.1 zafiyet skoru dağılımı aşağıdadır; ayrıntılı liste ekteki PDF raporundadır.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL_STRIP_SECTION_BG}" padding="10px 14px">
      <mj-column>
        <mj-text align="center" color="#E8F1FA" font-size="17px" font-weight="700" padding="0">
          Kritik güvenlik zafiyetleri — özet
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#FFFFFF" padding="14px 16px 18px 16px" border-left="1px solid #E5E7EB" border-right="1px solid #E5E7EB" border-bottom="1px solid #E5E7EB">
      <mj-column>
        <mj-text font-weight="700" font-size="16px" color="#1e4976" padding="0 0 12px 0">
          Şiddet dağılımı (CVSS 3.1)
        </mj-text>
        <mj-raw>
          <table class="cve-table-wrap" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1e293b;border:1px solid #c7d6eb;border-radius:12px;overflow:hidden;">
            <thead>
              <tr style="background:${EMAIL_TABLE_HEAD_GRADIENT};">
                <th style="padding:14px 16px;text-align:left;color:#f0f7ff;font-size:13px;letter-spacing:0.03em;text-transform:uppercase;">Zaafiyet Durumu</th>
                <th style="padding:14px 16px;text-align:right;color:#f0f7ff;font-size:13px;letter-spacing:0.03em;text-transform:uppercase;">Adet</th>
              </tr>
            </thead>
            <tbody>
              ${severityRowsHtml}
            </tbody>
          </table>
        </mj-raw>
        <mj-text font-size="13px" color="#6B7280" padding="14px 0 0 0">
          Ekte, bu pencereye göre üretilen PDF raporu bulunmaktadır.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#0F3A6D" padding="28px 20px">
      <mj-group>
        <mj-column width="50%">
          ${footerLogoMjml}
          <mj-text color="#FFFFFF" font-size="16px" font-weight="700" padding="0 0 6px 0">
            TT Siber Güvenlik Direktörlüğü
          </mj-text>
          <mj-text color="#DCEAFF" font-size="14px" padding="0">
            Güvenlik Olay Yönetim Müdürlüğü
          </mj-text>
        </mj-column>
        <mj-column width="50%">
          <mj-text align="right" color="#FFFFFF" font-size="14px" font-weight="700" padding="0 0 8px 0">
            Bizi takip edin
          </mj-text>
          <mj-social mode="horizontal" icon-size="26px" align="right" padding="0 0 12px 0">
            <mj-social-element name="linkedin" href="https://www.linkedin.com/company/turktelekom/" />
            <mj-social-element name="web" href="https://www.turktelekomguvenlik.com/" />
          </mj-social>
          <mj-text align="right" color="#DCEAFF" font-size="12px" padding="0" line-height="1.5">
            Kurumumuzun siber dayanıklılığını artırmaya yönelik çözüm ve bültenlerimiz hakkında daha fazla bilgi için bizimle iletişime geçebilirsiniz.
          </mj-text>
        </mj-column>
      </mj-group>
    </mj-section>
    <mj-section background-color="#F3F4F6" padding="16px 20px">
      <mj-column>
        <mj-text align="center" font-size="11px" color="#9CA3AF" padding="0" line-height="1.5">
          Bu bülten, Türk Telekom Siber Güvenlik Direktörlüğü Güvenlik Olay Yönetim Müdürlüğü tarafından, Türk Telekom personellerini bilgilendirmek için hazırlanmıştır.
        </mj-text>
        <mj-text align="center" font-size="11px" color="#9CA3AF" padding="10px 0 0 0">
          Otomatik ileti • © ${params.year}
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

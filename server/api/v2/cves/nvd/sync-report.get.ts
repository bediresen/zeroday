import { buildNvdTodayPdfBuffer } from '../../../../utils/nvdTodayPdf'
import { loadVulnerabilitiesForPdfFromDb } from '../../../../utils/nvdCve.helper'
import {
  buildMinioReportObjectKey,
  uploadCveReportPdfToMinio,
} from '../../../../utils/minioReportUpload'
import { resolveReportPublicationWindow } from '../../../../utils/nvdPublicationWindow'

/**
 * NVD senkron ile aynı yayın penceresi için PDF.
 * Veriler NVD API’den değil, `cves` tablosunda `published_at` aralığına düşen kayıtlardan üretilir.
 * GET /api/v2/cves/nvd/sync-report
 */
export default defineEventHandler(async (event) => {
  try {
    const pubWindow = await resolveReportPublicationWindow(true, new Date())

    const vulnerabilities = await loadVulnerabilitiesForPdfFromDb(
      pubWindow.pubStartDate,
      pubWindow.pubEndDate
    )

    const buffer = await buildNvdTodayPdfBuffer({
      pubStartDate: pubWindow.pubStartDate,
      pubEndDate: pubWindow.pubEndDate,
      totalResults: vulnerabilities.length,
      vulnerabilities,
      displayTimeZone: pubWindow.timeZone,
      windowSummary: pubWindow.windowSummary,
    })

    const endIso = pubWindow.pubEndDate
    const endInstant = new Date(
      endIso.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(endIso) || /[+-]\d{4}$/.test(endIso)
        ? endIso
        : `${endIso}Z`
    )
    const d = Number.isNaN(endInstant.getTime()) ? new Date() : endInstant
    const day = String(d.getUTCDate()).padStart(2, '0')
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
    const y = d.getUTCFullYear()
    const filenameAscii = `Siber_Guvenlik_0day_Zafiyet_Bildirimi-${day}.${mo}.${y}.pdf`
    const filenameUtf8 = `Siber Güvenlik 0-day Zafiyet Bildirimi - ${day}.${mo}.${y}.pdf`

    const objectKey = buildMinioReportObjectKey(filenameAscii, String(y), mo, day)
    const minioStatus = await uploadCveReportPdfToMinio({ buffer, objectKey })
    setHeader(event, 'X-Minio-Status', minioStatus)

    setHeader(event, 'Content-Type', 'application/pdf')
    setHeader(
      event,
      'Content-Disposition',
      `attachment; filename="${filenameAscii}"; filename*=UTF-8''${encodeURIComponent(filenameUtf8)}`
    )

    return buffer
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'PDF oluşturulamadı'
    console.error('[GET /api/v2/cves/nvd/sync-report]', error)
    throw createError({
      statusCode: 500,
      statusMessage: msg,
      data: { message: 'Rapor PDF’i üretilemedi.' },
    })
  }
})

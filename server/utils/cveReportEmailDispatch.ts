import { DateTime } from 'luxon'
import { getEmailSettingsResolved, getSmtpSettingsResolved } from './cveSettings'
import {
  buildCveReportEmailInlineImageAttachments,
  compileCveReportEmailHtml,
} from './cveReportMjml'
import { logReportEmailAttempt } from './emailSendLog'
import {
  buildMinioReportObjectKey,
  fetchCveReportPdfFromMinio,
  uploadCveReportPdfToMinio,
} from './minioReportUpload'
import { buildNvdTodayPdfBuffer } from './nvdTodayPdf'
import { loadVulnerabilitiesForPdfFromDb } from './nvdCve.helper'
import { resolveNvdPublicationWindow } from './nvdPublicationWindow'
import { MailHelper } from './mail.helper'

function buildReportPdfNames(pubEndDateIso: string): { filenameAscii: string; objectKey: string } {
  const endIso = pubEndDateIso
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
  const objectKey = buildMinioReportObjectKey(filenameAscii, String(y), mo, day)
  return { filenameAscii, objectKey }
}

export type DispatchCveReportEmailResult =
  | {
      kind: 'validation'
      code: 'NO_RECIPIENTS' | 'SMTP_CONFIG'
      message: string
    }
  | {
      kind: 'success'
      message: string
      partial: boolean
      failedRecipients: string[]
      errors: { email: string; message: string }[]
    }
  | {
      kind: 'all_failed'
      message: string
      failedRecipients: string[]
      errors: { email: string; message: string }[]
    }
  | {
      kind: 'unexpected'
      message: string
      friendly: string
    }

export type DispatchCveReportEmailOptions = {
  /**
   * true: önce MinIO’da `sync-report` ile aynı anahtarda PDF ara (manuel gönderim).
   * false: her zaman DB’den üret (NVD cron senkronundan hemen sonra).
   */
  tryMinioPdfFirst?: boolean
  /** true: PDF üretildikten sonra MinIO’ya yükle (cron sonrası arşiv). */
  uploadPdfToMinioAfterBuild?: boolean
}

/**
 * CVE raporu PDF + MJML e-posta gönderimi. HTTP katmanı `createError` atmaz; sonuç `kind` ile ayrılır.
 */
export async function dispatchCveReportEmail(
  options: DispatchCveReportEmailOptions = {}
): Promise<DispatchCveReportEmailResult> {
  const tryMinioPdfFirst = options.tryMinioPdfFirst !== false
  const uploadPdfToMinioAfterBuild = options.uploadPdfToMinioAfterBuild === true

  const emailCfg = await getEmailSettingsResolved()
  const recipientList = [...new Set(emailCfg.recipientEmails.map((e) => e.trim()).filter(Boolean))]
  const to = recipientList.join(', ')
  if (!recipientList.length) {
    await logReportEmailAttempt({
      status: 'failed',
      recipients: '—',
      subject: 'ZERODAY CVE bülteni',
      errorMessage: 'Ayarlar > E-posta ayarları bölümünde en az bir alıcı e-posta girin.',
      errorCode: 'VALIDATION',
    })
    return {
      kind: 'validation',
      code: 'NO_RECIPIENTS',
      message: 'Ayarlar > E-posta ayarları bölümünde en az bir alıcı e-posta girin.',
    }
  }

  const smtp = await getSmtpSettingsResolved()
  if (!smtp.host?.trim() || !smtp.from?.trim()) {
    await logReportEmailAttempt({
      status: 'failed',
      recipients: to,
      subject: 'ZERODAY CVE bülteni',
      errorMessage: 'SMTP sunucu adresi ve gönderen (From) ayarlarını doldurun.',
      errorCode: 'SMTP_CONFIG',
    })
    return {
      kind: 'validation',
      code: 'SMTP_CONFIG',
      message: 'SMTP sunucu adresi ve gönderen (From) ayarlarını doldurun.',
    }
  }

  let logSubject: string | null = null

  try {
    const pubWindow = await resolveNvdPublicationWindow()
    const vulnerabilities = await loadVulnerabilitiesForPdfFromDb(
      pubWindow.pubStartDate,
      pubWindow.pubEndDate
    )

    const { filenameAscii, objectKey } = buildReportPdfNames(pubWindow.pubEndDate)

    let buffer: Buffer
    if (tryMinioPdfFirst) {
      const fromMinio = await fetchCveReportPdfFromMinio(objectKey)
      buffer =
        fromMinio && fromMinio.length > 0
          ? fromMinio
          : await buildNvdTodayPdfBuffer({
              pubStartDate: pubWindow.pubStartDate,
              pubEndDate: pubWindow.pubEndDate,
              totalResults: vulnerabilities.length,
              vulnerabilities,
              displayTimeZone: pubWindow.timeZone,
              windowSummary: pubWindow.windowSummary,
            })
    } else {
      buffer = await buildNvdTodayPdfBuffer({
        pubStartDate: pubWindow.pubStartDate,
        pubEndDate: pubWindow.pubEndDate,
        totalResults: vulnerabilities.length,
        vulnerabilities,
        displayTimeZone: pubWindow.timeZone,
        windowSummary: pubWindow.windowSummary,
      })
    }

    if (uploadPdfToMinioAfterBuild) {
      const st = await uploadCveReportPdfToMinio({ buffer, objectKey })
      if (st === 'failed') {
        console.warn('[cve-report-email] MinIO yüklemesi başarısız (e-posta yine gönderiliyor):', objectKey)
      }
    }

    const year = new Date().getFullYear()
    const bulletinDateLabel = DateTime.now().setZone(pubWindow.timeZone).toFormat('dd.MM.yyyy')
    const html = compileCveReportEmailHtml({
      bulletinDateLabel,
      windowSummary: pubWindow.windowSummary,
      total: vulnerabilities.length,
      vulnerabilities,
      year,
    })

    const fname = filenameAscii
    logSubject = `ZERODAY CVE bülteni (${bulletinDateLabel})`

    const mail = new MailHelper({
      host: smtp.host.trim(),
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.username?.trim() || undefined,
        pass: smtp.password || undefined,
      },
      tls: {
        rejectUnauthorized: smtp.rejectUnauthorized !== false,
      },
    })

    const sendFailures: { email: string; friendly: string; detail: string; code?: string }[] = []

    for (const recipient of recipientList) {
      try {
        await mail.send({
          from: smtp.from.trim(),
          to: recipient,
          subject: logSubject,
          html,
          attachments: [
            ...buildCveReportEmailInlineImageAttachments(),
            {
              filename: fname,
              content: buffer,
              contentType: 'application/pdf',
            },
          ],
        })
        await logReportEmailAttempt({
          status: 'ok',
          recipients: recipient,
          subject: logSubject,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'E-posta gönderilemedi'
        const errno = err as NodeJS.ErrnoException & { response?: string }
        const mailErr = {
          code: typeof errno.code === 'string' ? errno.code : undefined,
          message: msg,
          response: errno.response,
        }
        const friendly = MailHelper.mapErrorToUserFriendlyMessage(mailErr)
        await logReportEmailAttempt({
          status: 'failed',
          recipients: recipient,
          subject: logSubject,
          errorMessage: friendly,
          errorCode: typeof errno.code === 'string' ? errno.code : 'SEND_FAILED',
          detail: MailHelper.detailForEmailLog(friendly, msg),
        })
        sendFailures.push({
          email: recipient,
          friendly,
          detail: msg,
          code: typeof errno.code === 'string' ? errno.code : undefined,
        })
      }
    }

    if (sendFailures.length === recipientList.length) {
      const first = sendFailures[0]!
      return {
        kind: 'all_failed',
        message: first.friendly,
        failedRecipients: sendFailures.map((f) => f.email),
        errors: sendFailures.map((f) => ({ email: f.email, message: f.friendly })),
      }
    }

    if (sendFailures.length > 0) {
      return {
        kind: 'success',
        partial: true,
        message:
          'E-posta bazı alıcılara ulaşmadı; her alıcı için ayrı kayıt e-posta günlüğünde.',
        failedRecipients: sendFailures.map((f) => f.email),
        errors: sendFailures.map((f) => ({ email: f.email, message: f.friendly })),
      }
    }

    return {
      kind: 'success',
      partial: false,
      message: 'E-posta gönderildi.',
      failedRecipients: [],
      errors: [],
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'E-posta gönderilemedi'
    console.error('[dispatchCveReportEmail]', error)
    const errno = error as NodeJS.ErrnoException & { response?: string }
    const mailErr = {
      code: typeof errno.code === 'string' ? errno.code : undefined,
      message: msg,
      response: errno.response,
    }
    const friendly = MailHelper.mapErrorToUserFriendlyMessage(mailErr)

    await logReportEmailAttempt({
      status: 'failed',
      recipients: to,
      subject: logSubject,
      errorMessage: friendly,
      errorCode: typeof errno.code === 'string' ? errno.code : 'SEND_FAILED',
      detail: MailHelper.detailForEmailLog(friendly, msg),
    })

    return { kind: 'unexpected', message: msg, friendly }
  }
}

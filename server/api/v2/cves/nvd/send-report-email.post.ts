import { DateTime } from 'luxon'
import { getEmailSettingsResolved, getSmtpSettingsResolved } from '../../../../utils/cveSettings'
import {
  buildCveReportEmailInlineImageAttachments,
  compileCveReportEmailHtml,
} from '../../../../utils/cveReportMjml'
import { logReportEmailAttempt } from '../../../../utils/emailSendLog'
import {
  buildMinioReportObjectKey,
  fetchCveReportPdfFromMinio,
} from '../../../../utils/minioReportUpload'
import { buildNvdTodayPdfBuffer } from '../../../../utils/nvdTodayPdf'
import { loadVulnerabilitiesForPdfFromDb } from '../../../../utils/nvdCve.helper'
import { resolveNvdPublicationWindow } from '../../../../utils/nvdPublicationWindow'
import { MailHelper } from '../../../../utils/mail.helper'

/**
 * MJML gövdeli e-posta; ek PDF önce MinIO’da `sync-report` ile aynı anahtardan okunur, yoksa DB’den üretilir.
 * Alıcılar: ayarlardaki e-posta sekmesi (`email.recipientEmails`).
 * POST /api/v2/cves/nvd/send-report-email
 */
export default defineEventHandler(async () => {
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
    throw createError({
      statusCode: 400,
      statusMessage: 'Alıcı e-posta yok',
      data: { message: 'Ayarlar > E-posta ayarları bölümünde en az bir alıcı e-posta girin.' },
    })
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
    throw createError({
      statusCode: 400,
      statusMessage: 'SMTP eksik',
      data: { message: 'SMTP sunucu adresi ve gönderen (From) ayarlarını doldurun.' },
    })
  }

  let logSubject: string | null = null

  try {
    const pubWindow = await resolveNvdPublicationWindow()
    const vulnerabilities = await loadVulnerabilitiesForPdfFromDb(
      pubWindow.pubStartDate,
      pubWindow.pubEndDate
    )

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
    const objectKey = buildMinioReportObjectKey(filenameAscii, String(y), mo, day)

    const fromMinio = await fetchCveReportPdfFromMinio(objectKey)
    const buffer =
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
      throw createError({
        statusCode: 500,
        statusMessage: first.friendly,
        data: {
          message: first.friendly,
          failedRecipients: sendFailures.map((f) => f.email),
          errors: sendFailures.map((f) => ({ email: f.email, message: f.friendly })),
        },
      })
    }

    if (sendFailures.length > 0) {
      return {
        ok: true as const,
        partial: true as const,
        message:
          'E-posta bazı alıcılara ulaşmadı; her alıcı için ayrı kayıt e-posta günlüğünde.',
        failedRecipients: sendFailures.map((f) => f.email),
        errors: sendFailures.map((f) => ({ email: f.email, message: f.friendly })),
      }
    }

    return { ok: true as const, message: 'E-posta gönderildi.' }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    const msg = error instanceof Error ? error.message : 'E-posta gönderilemedi'
    console.error('[POST /api/v2/cves/nvd/send-report-email]', error)
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

    throw createError({
      statusCode: 500,
      statusMessage: friendly,
      data: { message: friendly },
    })
  }
})

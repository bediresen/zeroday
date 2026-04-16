import { dispatchCveReportEmail } from '../../../../utils/cveReportEmailDispatch'

/**
 * MJML gövdeli e-posta; ek PDF önce MinIO’da `sync-report` ile aynı anahtardan okunur, yoksa DB’den üretilir.
 * Alıcılar: ayarlardaki e-posta sekmesi (`email.recipientEmails`).
 * POST /api/v2/cves/nvd/send-report-email
 */
export default defineEventHandler(async () => {
  const result = await dispatchCveReportEmail({
    tryMinioPdfFirst: true,
    uploadPdfToMinioAfterBuild: false,
  })

  if (result.kind === 'validation') {
    throw createError({
      statusCode: 400,
      statusMessage: result.code === 'NO_RECIPIENTS' ? 'Alıcı e-posta yok' : 'SMTP eksik',
      data: { message: result.message },
    })
  }

  if (result.kind === 'all_failed') {
    throw createError({
      statusCode: 500,
      statusMessage: result.message,
      data: {
        message: result.message,
        failedRecipients: result.failedRecipients,
        errors: result.errors,
      },
    })
  }

  if (result.kind === 'unexpected') {
    throw createError({
      statusCode: 500,
      statusMessage: result.friendly,
      data: { message: result.friendly },
    })
  }

  if (result.partial) {
    return {
      ok: true as const,
      partial: true as const,
      message: result.message,
      failedRecipients: result.failedRecipients,
      errors: result.errors,
    }
  }

  return { ok: true as const, message: result.message }
})

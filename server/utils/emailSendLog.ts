import { ensureCveSchema } from './cveSchema'
import { getCveEmailLogModel } from './db'
import type { CveEmailLogStatus } from '../models/cve-email-log.model'

export type LogReportEmailParams = {
  status: CveEmailLogStatus
  recipients: string
  subject: string | null
  errorMessage?: string | null
  errorCode?: string | null
  detail?: string | null
}

/**
 * Rapor e-postası denemesini `cve_email_logs` tablosuna yazar; hata olursa sadece konsola düşer.
 */
export async function logReportEmailAttempt(params: LogReportEmailParams): Promise<void> {
  try {
    await ensureCveSchema()
    const M = getCveEmailLogModel()!
    await M.create({
      status: params.status,
      recipients: params.recipients.slice(0, 65000),
      subject: params.subject ? params.subject.slice(0, 512) : null,
      error_message: params.errorMessage ?? null,
      error_code: params.errorCode ?? null,
      detail: params.detail ? params.detail.slice(0, 65000) : null,
    } as never)
  } catch (e) {
    console.error('[emailSendLog] kayıt yazılamadı', e)
  }
}

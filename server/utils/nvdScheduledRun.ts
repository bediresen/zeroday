import { dispatchCveReportEmail } from './cveReportEmailDispatch'
import { fetchNvdCvesByPubRange, persistNvdVulnerabilities } from './nvdCve.helper'
import { getOpenAiTranslateOptionsForPersist, getNvdApiKeyForFetch } from './cveRuntimeConfig'
import { resolveNvdPublicationWindow } from './nvdPublicationWindow'
import { getCronSettingsResolved } from './cveSettings'

/**
 * Cron: son tamamlanan günlük pencerede NVD çek, DB’ye yaz; ardından PDF üret, MinIO’ya yükle, bülten e-postası gönder.
 * Alıcı veya SMTP eksikse e-posta atlanır (senkron yine tamamlanır).
 */
export async function runNvdScheduledJob(): Promise<void> {
  const cronCfg = await getCronSettingsResolved()
  if (!cronCfg.enabled) {
    console.log('[nvd-scheduled] atlandı: cron devre dışı')
    return
  }

  const window = await resolveNvdPublicationWindow()
  const apiKey = getNvdApiKeyForFetch()

  const fetched = await fetchNvdCvesByPubRange(window.pubStartDate, window.pubEndDate, {
    apiKey,
  })

  const persistResult = await persistNvdVulnerabilities(fetched.vulnerabilities, {
    ...getOpenAiTranslateOptionsForPersist(),
  })

  const L = persistResult.llm
  console.log(
    `[nvd-scheduled] NVD ${fetched.totalResults} kayıt; DB ${persistResult.upserted} yazıldı, ${persistResult.skippedInvalid} atlandı (${window.windowSummary}) | LLM: OpenAI ${L.openaiRequestCount}, önbellek ${L.memoryCacheHits}, ${L.llmDurationMs}ms`
  )

  const emailResult = await dispatchCveReportEmail({
    tryMinioPdfFirst: false,
    uploadPdfToMinioAfterBuild: true,
    livePublicationEnd: false,
  })
  switch (emailResult.kind) {
    case 'validation':
      console.warn(`[nvd-scheduled] Rapor e-postası atlandı: ${emailResult.message}`)
      break
    case 'success':
      console.log(
        `[nvd-scheduled] Rapor e-postası: ${emailResult.message}` +
          (emailResult.partial ? ` (kısmi; başarısız: ${emailResult.failedRecipients.join(', ')})` : '')
      )
      break
    case 'all_failed':
      console.error(
        `[nvd-scheduled] Rapor e-postası tüm alıcılarda başarısız: ${emailResult.message}`
      )
      break
    case 'unexpected':
      console.error(`[nvd-scheduled] Rapor e-postası beklenmeyen hata: ${emailResult.friendly}`)
      break
  }
}

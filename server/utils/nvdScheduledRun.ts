import { fetchNvdCvesByPubRange, persistNvdVulnerabilities } from './nvdCve.helper'
import { getOpenAiTranslateOptionsForPersist, getNvdApiKeyForFetch } from './cveRuntimeConfig'
import { resolveNvdPublicationWindow } from './nvdPublicationWindow'
import { getCronSettingsResolved } from './cveSettings'

/**
 * Cron: son tamamlanan günlük pencerede NVD çek, DB’ye yaz.
 * PDF e-postası yalnızca arayüzden manuel tetiklenir (ayarlardaki otomatik gönderim kaldırıldı).
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
}

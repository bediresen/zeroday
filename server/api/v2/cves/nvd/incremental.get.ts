import {
  areListCvesPersistedInWindow,
  fetchNvdIncrementalSlice,
} from '../../../../utils/nvdCve.helper'
import { getLiveFeedWindowSummary, resolveNvdPublicationWindow } from '../../../../utils/nvdPublicationWindow'

/**
 * Yalnızca artımlı NVD dilimi (opsiyonel / geriye dönük).
 * Ana sayfa listesi artık GET /api/v2/cves/nvd içinde birleştirilir.
 * GET /api/v2/cves/nvd/incremental
 */
export default defineEventHandler(async () => {
  try {
    const window = await resolveNvdPublicationWindow()
    const { nvdApiKey } = useRuntimeConfig()

    const inc = await fetchNvdIncrementalSlice(window.pubStartDate, {
      apiKey: nvdApiKey || undefined,
    })

    const incrementalWindowSummary = await getLiveFeedWindowSummary()

    const listPersisted = await areListCvesPersistedInWindow(
      inc.vulnerabilities,
      inc.pubStartDate,
      inc.pubEndDate
    )

    return {
      data: {
        totalResults: inc.totalResults,
        vulnerabilities: inc.vulnerabilities,
        pubStartDate: inc.pubStartDate,
        pubEndDate: inc.pubEndDate,
        incrementalWindowSummary,
        listPersisted,
      },
    }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    const msg = error instanceof Error ? error.message : 'NVD incremental fetch failed'
    console.error('[GET /api/v2/cves/nvd/incremental]', error)
    throw createError({
      statusCode: 500,
      statusMessage: msg,
      data: { message: 'Güncelleme verisi alınamadı.' },
    })
  }
})

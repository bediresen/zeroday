import { DateTime } from 'luxon'
import {
  areListCvesPersistedInWindow,
  attachDescriptionTrFromDb,
  fetchNvdCvesByPubRange,
  fetchNvdIncrementalSlice,
  loadVulnerabilitiesFromDbPublishedAfterWindowEnd,
  mergeVulnerabilitiesDedupe,
} from '../../../utils/nvdCve.helper'
import { getLiveFeedWindowSummary, resolveNvdPublicationWindow } from '../../../utils/nvdPublicationWindow'

export default defineEventHandler(async () => {
  try {
    const window = await resolveNvdPublicationWindow()
    const { nvdApiKey } = useRuntimeConfig()
    const fetched = await fetchNvdCvesByPubRange(window.pubStartDate, window.pubEndDate, {
      apiKey: nvdApiKey || undefined,
    })

    const nowUtc = new Date()
    const nowIsoUtc = DateTime.fromJSDate(nowUtc, { zone: 'utc' }).toISO()!

    let vulnerabilities = await attachDescriptionTrFromDb(fetched.vulnerabilities)
    const extraFromDb = await loadVulnerabilitiesFromDbPublishedAfterWindowEnd(
      window.pubEndDate,
      nowUtc
    )
    vulnerabilities = mergeVulnerabilitiesDedupe(vulnerabilities, extraFromDb)

    const inc = await fetchNvdIncrementalSlice(window.pubStartDate, {
      apiKey: nvdApiKey || undefined,
    })
    vulnerabilities = mergeVulnerabilitiesDedupe(vulnerabilities, inc.vulnerabilities)

    const listPersisted = await areListCvesPersistedInWindow(
      vulnerabilities,
      window.pubStartDate,
      nowIsoUtc
    )

    const windowSummary = await getLiveFeedWindowSummary()

    return {
      data: {
        ...fetched,
        totalResults: vulnerabilities.length,
        vulnerabilities,
        dbNewestPublishedAt: window.newestPublishedAt,
        publicationRangeClamped: window.publicationRangeClamped,
        timeZone: window.timeZone,
        windowSummary,
        listQueryEndDate: nowIsoUtc,
        listPersisted,
      },
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'NVD fetch failed'
    console.error('[GET /api/v2/cves/nvd]', error)
    throw createError({
      statusCode: 500,
      statusMessage: msg,
      data: { message: 'NVD verisi alınamadı.' },
    })
  }
})

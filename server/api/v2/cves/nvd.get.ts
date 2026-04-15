import { DateTime } from 'luxon'
import {
  areListCvesPersistedInWindow,
  attachDescriptionTrFromDb,
  fetchNvdCvesByPubRange,
  fetchNvdIncrementalSlice,
  mergeVulnerabilitiesDedupe,
} from '../../../utils/nvdCve.helper'
import {
  computeScheduledBoundaryPublicationWindow,
  resolveNvdPublicationWindow,
} from '../../../utils/nvdPublicationWindow'
import { getCronSettingsResolved } from '../../../utils/cveSettings'

function parseLiveEndFlag(raw: Record<string, unknown>): boolean {
  const le = raw.liveEnd
  return (
    le === '1' ||
    le === 'true' ||
    le === 1 ||
    (Array.isArray(le) && (le[0] === '1' || le[0] === 'true'))
  )
}

export default defineEventHandler(async (event) => {
  try {
    const liveEnd = parseLiveEndFlag(getQuery(event) as Record<string, unknown>)
    const requestNow = new Date()

    const window = await resolveNvdPublicationWindow(requestNow)
    const { nvdApiKey } = useRuntimeConfig()

    let pubStartDate = window.pubStartDate
    let pubEndDate = window.pubEndDate
    let windowSummary = window.windowSummary
    let windowEndExclusiveUtcIso = window.windowEndExclusiveUtcIso

    if (liveEnd) {
      const cronCfg = await getCronSettingsResolved()
      const comp = computeScheduledBoundaryPublicationWindow({
        timeZone: cronCfg.timeZone,
        hour: cronCfg.hour,
        minute: cronCfg.minute,
        now: requestNow,
      })
      pubStartDate = comp.pubStartDate
      pubEndDate = DateTime.fromJSDate(requestNow, { zone: 'utc' }).toISO()!
      const startLabel = comp.windowStart.setZone(cronCfg.timeZone).toFormat('dd.MM.yyyy HH:mm')
      const endLabel = DateTime.fromJSDate(requestNow).setZone(cronCfg.timeZone).toFormat('dd.MM.yyyy HH:mm')
      windowSummary = `${startLabel} → ${endLabel} (${cronCfg.timeZone})`
      windowEndExclusiveUtcIso = pubEndDate
    }

    const fetched = await fetchNvdCvesByPubRange(pubStartDate, pubEndDate, {
      apiKey: nvdApiKey || undefined,
    })

    let vulnerabilities = await attachDescriptionTrFromDb(fetched.vulnerabilities)

    if (!liveEnd) {
      const inc = await fetchNvdIncrementalSlice(window.pubStartDate, {
        apiKey: nvdApiKey || undefined,
        pubEndDateCapIso: window.pubEndDate,
      })
      vulnerabilities = mergeVulnerabilitiesDedupe(vulnerabilities, inc.vulnerabilities)
    }

    const listPersisted = await areListCvesPersistedInWindow(
      vulnerabilities,
      pubStartDate,
      pubEndDate
    )

    return {
      data: {
        ...fetched,
        pubStartDate,
        pubEndDate,
        totalResults: vulnerabilities.length,
        vulnerabilities,
        dbNewestPublishedAt: window.newestPublishedAt,
        publicationRangeClamped: window.publicationRangeClamped,
        timeZone: window.timeZone,
        windowSummary,
        listQueryEndDate: pubEndDate,
        windowEndExclusiveUtcIso,
        listPersisted,
        liveEndRefresh: liveEnd,
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

import {
  areListCvesPersistedInWindow,
  attachDescriptionTrFromDb,
  fetchNvdCvesByPubRange,
  fetchNvdIncrementalSlice,
  loadLatestCvesFromDb,
  loadVulnerabilitiesForPdfFromDb,
  mergeVulnerabilitiesDedupe,
} from '../../../utils/nvdCve.helper'
import { resolveNvdPublicationWindow, resolveReportPublicationWindow } from '../../../utils/nvdPublicationWindow'

function parseLiveEndFlag(raw: Record<string, unknown>): boolean {
  const le = raw.liveEnd
  return (
    le === '1' ||
    le === 'true' ||
    le === 1 ||
    (Array.isArray(le) && (le[0] === '1' || le[0] === 'true'))
  )
}

function parseDbWindowFlag(raw: Record<string, unknown>): boolean {
  const v = raw.dbWindow
  return (
    v === '1' ||
    v === 'true' ||
    v === 1 ||
    (Array.isArray(v) && (v[0] === '1' || v[0] === 'true'))
  )
}

const DB_PEEK_LIMIT = 100

function parseDbPeekFlag(raw: Record<string, unknown>): boolean {
  const v = raw.dbPeek
  return (
    v === '1' ||
    v === 'true' ||
    v === 1 ||
    (Array.isArray(v) && (v[0] === '1' || v[0] === 'true'))
  )
}

function sortVulnerabilitiesByPublishedDesc<T extends { cve?: { published?: string } }>(items: T[]) {
  items.sort((a, b) => {
    const ta = new Date(typeof a.cve?.published === 'string' ? a.cve.published : 0).getTime()
    const tb = new Date(typeof b.cve?.published === 'string' ? b.cve.published : 0).getTime()
    return tb - ta
  })
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as Record<string, unknown>
  try {
    const liveEnd = parseLiveEndFlag(query)
    const dbPeek = parseDbPeekFlag(query) && !liveEnd
    const dbWindow = parseDbWindowFlag(query) && !liveEnd && !dbPeek
    const requestNow = new Date()

    const window = await resolveNvdPublicationWindow(requestNow)
    const { nvdApiKey } = useRuntimeConfig()

    let pubStartDate = window.pubStartDate
    let pubEndDate = window.pubEndDate
    let windowSummary = window.windowSummary
    let windowEndExclusiveUtcIso = window.windowEndExclusiveUtcIso

    if (liveEnd) {
      const w = await resolveReportPublicationWindow(true, requestNow)
      pubStartDate = w.pubStartDate
      pubEndDate = w.pubEndDate
      windowSummary = w.windowSummary
      windowEndExclusiveUtcIso = w.windowEndExclusiveUtcIso
    }

    if (dbPeek) {
      const vulnerabilities = await loadLatestCvesFromDb(DB_PEEK_LIMIT)
      return {
        data: {
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
          listPersisted: false,
          liveEndRefresh: false,
          dbWindowOnly: false,
          quickDashboard: true,
          dbPeekLimit: DB_PEEK_LIMIT,
        },
      }
    }

    if (dbWindow) {
      const vulnerabilities = await loadVulnerabilitiesForPdfFromDb(pubStartDate, pubEndDate)
      sortVulnerabilitiesByPublishedDesc(vulnerabilities)
      const listPersisted = await areListCvesPersistedInWindow(
        vulnerabilities,
        pubStartDate,
        pubEndDate
      )
      return {
        data: {
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
          liveEndRefresh: false,
          dbWindowOnly: true,
          quickDashboard: false,
        },
      }
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
        dbWindowOnly: false,
        quickDashboard: false,
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

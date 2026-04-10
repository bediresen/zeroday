import { DateTime } from 'luxon'
import { ensureCveSchema } from './cveSchema'
import { getCronSettingsResolved } from './cveSettings'
import { getCveModel } from './db'

export type NvdPublicationWindow = {
  pubStartDate: string
  pubEndDate: string
  /** DB’de gösterim için (pencere hesabında kullanılmaz) */
  newestPublishedAt: Date | null
  /** Eski API uyumluluğu; her zaman false */
  publicationRangeClamped: boolean
  timeZone: string
  /** Örn. Europe/Istanbul’da okunaklı aralık */
  windowSummary: string
}

/**
 * Dün [saat]:[dakika] → bugün [saat]:[dakika] (aynı TZ’de son tamamlanan 24 saatlik dilim).
 * Siteye giriş anı veya DB’deki en yeni yayın pencereyi belirlemez.
 */
export function computeBoundaryWindow(opts: {
  timeZone: string
  hour: number
  minute: number
  now: Date
}): {
  windowStart: DateTime
  windowEnd: DateTime
  pubStartDate: string
  pubEndDate: string
} {
  const { timeZone, hour, minute, now } = opts
  const dt = DateTime.fromJSDate(now).setZone(timeZone)
  const todayBoundary = dt.startOf('day').set({ hour, minute, second: 0, millisecond: 0 })

  let windowEnd: DateTime
  let windowStart: DateTime
  if (dt >= todayBoundary) {
    windowEnd = todayBoundary
    windowStart = todayBoundary.minus({ days: 1 })
  } else {
    windowEnd = todayBoundary.minus({ days: 1 })
    windowStart = todayBoundary.minus({ days: 2 })
  }

  const pubStartDate = windowStart.toUTC().toISO()!
  const pubEndDate = windowEnd.minus({ milliseconds: 1 }).toUTC().toISO()!

  return { windowStart, windowEnd, pubStartDate, pubEndDate }
}

export async function resolveNvdPublicationWindow(now: Date = new Date()): Promise<NvdPublicationWindow> {
  await ensureCveSchema()
  const cron = await getCronSettingsResolved()
  const { windowStart, windowEnd, pubStartDate, pubEndDate } = computeBoundaryWindow({
    timeZone: cron.timeZone,
    hour: cron.hour,
    minute: cron.minute,
    now,
  })

  const Cve = getCveModel()!
  const newest = (await Cve.max('published_at')) as Date | string | null
  const newestPublishedAt = newest ? new Date(newest) : null
  const newestValid =
    newestPublishedAt && !Number.isNaN(newestPublishedAt.getTime()) ? newestPublishedAt : null

  const tz = cron.timeZone
  const startLocal = windowStart.setZone(tz)
  const endInclusive = windowEnd.minus({ milliseconds: 1 }).setZone(tz)
  const windowSummary = `${startLocal.toFormat('dd.MM.yyyy HH:mm')} → ${endInclusive.toFormat('dd.MM.yyyy HH:mm')} (${tz})`

  return {
    pubStartDate,
    pubEndDate,
    newestPublishedAt: newestValid,
    publicationRangeClamped: false,
    timeZone: tz,
    windowSummary,
  }
}


export async function getLiveFeedWindowSummary(): Promise<string> {
  const cron = await getCronSettingsResolved()
  const { windowStart } = computeBoundaryWindow({
    timeZone: cron.timeZone,
    hour: cron.hour,
    minute: cron.minute,
    now: new Date(),
  })
  const startLabel = windowStart.setZone(cron.timeZone).toFormat('dd.MM.yyyy HH:mm')
  const nowLabel = DateTime.now().setZone(cron.timeZone).toFormat('dd.MM.yyyy HH:mm')
  return `${startLabel} → ${nowLabel} (${cron.timeZone})`
}

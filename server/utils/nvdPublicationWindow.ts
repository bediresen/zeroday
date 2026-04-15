import { DateTime } from 'luxon'
import { ensureCveSchema } from './cveSchema'
import { getCronSettingsResolved } from './cveSettings'
import { getCveModel } from './db'

export type NvdPublicationWindow = {
  pubStartDate: string
  pubEndDate: string
  /** Yerel TZ’de üst sınır anı (exclusive): `pubEndDate` bu andan 1 ms öncesine kadar */
  windowEndExclusiveUtcIso: string
  /** DB’de gösterim için (pencere hesabında kullanılmaz) */
  newestPublishedAt: Date | null
  /** Eski API uyumluluğu; her zaman false */
  publicationRangeClamped: boolean
  timeZone: string
  /** Örn. dün 10:10 → bugün 10:10 (bitiş exclusive); ayarlardaki saat/dakika */
  windowSummary: string
}

/**
 * NVD yayın penceresi: yerel takvimde **dün** ve **bugün**, ayarlardaki aynı saat/dakikada.
 * [dün @ HH:mm, bugün @ HH:mm) — üst sınır exclusive (`pubEndDate` bir ms öncesine kadar).
 * Böylece sınır saatinden önce sayfa açılsa bile tarihler bir gün geride kalmaz (her zaman dün→bugün).
 */
export function computeScheduledBoundaryPublicationWindow(opts: {
  timeZone: string
  hour: number
  minute: number
  now: Date
}): {
  windowStart: DateTime
  windowEnd: DateTime
  pubStartDate: string
  pubEndDate: string
  windowEndExclusiveUtcIso: string
  windowSummary: string
} {
  const { timeZone, hour, minute, now } = opts
  const h = Math.min(23, Math.max(0, Math.floor(hour)))
  const mi = Math.min(59, Math.max(0, Math.floor(minute)))
  const dt = DateTime.fromJSDate(now).setZone(timeZone)
  const windowEnd = dt.startOf('day').set({ hour: h, minute: mi, second: 0, millisecond: 0 })
  const windowStart = windowEnd.minus({ days: 1 })

  const pubStartDate = windowStart.toUTC().toISO()!
  const pubEndDate = windowEnd.minus({ milliseconds: 1 }).toUTC().toISO()!
  const windowEndExclusiveUtcIso = windowEnd.toUTC().toISO()!

  const startLabel = windowStart.setZone(timeZone).toFormat('dd.MM.yyyy HH:mm')
  const endLabel = windowEnd.setZone(timeZone).toFormat('dd.MM.yyyy HH:mm')
  const windowSummary = `${startLabel} → ${endLabel} (${timeZone})`

  return {
    windowStart,
    windowEnd,
    pubStartDate,
    pubEndDate,
    windowEndExclusiveUtcIso,
    windowSummary,
  }
}

export async function resolveNvdPublicationWindow(now: Date = new Date()): Promise<NvdPublicationWindow> {
  await ensureCveSchema()
  const cron = await getCronSettingsResolved()
  const { pubStartDate, pubEndDate, windowSummary, windowEndExclusiveUtcIso } =
    computeScheduledBoundaryPublicationWindow({
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

  return {
    pubStartDate,
    pubEndDate,
    windowEndExclusiveUtcIso,
    newestPublishedAt: newestValid,
    publicationRangeClamped: false,
    timeZone: cron.timeZone,
    windowSummary,
  }
}

/** Liste / e-posta üst bilgisi: `resolveNvdPublicationWindow` ile aynı pencere özeti */
export async function getLiveFeedWindowSummary(): Promise<string> {
  const cron = await getCronSettingsResolved()
  return computeScheduledBoundaryPublicationWindow({
    timeZone: cron.timeZone,
    hour: cron.hour,
    minute: cron.minute,
    now: new Date(),
  }).windowSummary
}

import { DateTime } from 'luxon'
import { ensureCveSchema } from './cveSchema'
import { getCronSettingsResolved } from './cveSettings'
import type { CronSettingsData } from './cveSettings'
import { runNvdScheduledJob } from './nvdScheduledRun'

/** node-cron Nitro bundle ile uyumsuz; Luxon + setInterval kullanıyoruz. */

let pollHandle: ReturnType<typeof setInterval> | null = null
let lastFiredMinuteKey: string | null = null

export function buildCronExpression(c: CronSettingsData): string {
  const minute = Math.min(59, Math.max(0, c.minute))
  const hour = Math.min(23, Math.max(0, c.hour))
  const dow =
    !c.daysOfWeek?.length
      ? '*'
      : [...new Set(c.daysOfWeek)]
          .filter((d) => d >= 0 && d <= 6)
          .sort((a, b) => a - b)
          .join(',')
  if (!dow) {
    return `0 ${minute} ${hour} * * *`
  }
  return `0 ${minute} ${hour} * * ${dow}`
}

function minuteKeyInZone(now: DateTime): string {
  return now.toFormat('yyyy-MM-dd-HH-mm')
}

/**
 * DB’deki cron ayarına göre zamanlayıcıyı yeniler. Sunucu başlangıcında ve ayar kaydında çağrılır.
 */
export async function rescheduleNvdCronJob(): Promise<void> {
  if (pollHandle !== null) {
    clearInterval(pollHandle)
    pollHandle = null
  }
  lastFiredMinuteKey = null

  try {
    await ensureCveSchema()
  } catch (e) {
    console.warn('[nvd-cron] DB yok, zamanlayıcı başlatılamadı:', e)
    return
  }

  const cfg = await getCronSettingsResolved()
  if (!cfg.enabled) {
    console.log('[nvd-cron] devre dışı (ayarlar)')
    return
  }

  const tz = cfg.timeZone?.trim() || 'Europe/Istanbul'

  const tick = async () => {
    let now: DateTime
    try {
      now = DateTime.now().setZone(tz)
    } catch {
      console.error('[nvd-cron] geçersiz saat dilimi:', tz)
      return
    }

    if (now.minute !== cfg.minute || now.hour !== cfg.hour) {
      return
    }

    // node-cron: 0=Pazar … 6=Cumartesi — Luxon: Pzt=1 … Paz=7
    const cronDow = now.weekday === 7 ? 0 : now.weekday
    if (cfg.daysOfWeek.length > 0 && !cfg.daysOfWeek.includes(cronDow)) {
      return
    }

    const key = minuteKeyInZone(now)
    if (lastFiredMinuteKey === key) {
      return
    }
    lastFiredMinuteKey = key

    try {
      await runNvdScheduledJob()
    } catch (e) {
      console.error('[nvd-cron] görev hatası:', e)
    }
  }

  pollHandle = setInterval(() => {
    void tick()
  }, 20_000)

  void tick()

  const dowDesc =
    cfg.daysOfWeek.length > 0 ? cfg.daysOfWeek.sort((a, b) => a - b).join(',') : '*'
  console.log(
    `[nvd-cron] zamanlayıcı aktif: ${String(cfg.hour).padStart(2, '0')}:${String(cfg.minute).padStart(2, '0')} ${tz} (hafta günü: ${dowDesc}, ~20s kontrol)`
  )
}

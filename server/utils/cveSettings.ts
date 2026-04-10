import { ensureCveSchema } from './cveSchema'
import { getCveSettingsModel } from './db'

export interface SmtpSettingsData {
  from: string
  host: string
  port: number
  /** true = SSL (465), false = STARTTLS veya düz */
  secure: boolean
  username: string
  password: string
  rejectUnauthorized: boolean
}

export interface CronSettingsData {
  /** IANA, örn. Europe/Istanbul */
  timeZone: string
  hour: number
  minute: number
  /** 0=Pazar … 6=Cumartesi; boş = her gün */
  daysOfWeek: number[]
  enabled: boolean
}

/** Manuel «E-posta gönder» ve gelecekteki bildirimler için alıcılar (`cve_settings` satırı: `email`) */
export interface EmailSettingsData {
  recipientEmails: string[]
}

export const DEFAULT_SMTP: SmtpSettingsData = {
  from: '',
  host: '',
  port: 587,
  secure: false,
  username: '',
  password: '',
  rejectUnauthorized: true,
}

export const DEFAULT_CRON: CronSettingsData = {
  timeZone: 'Europe/Istanbul',
  hour: 9,
  minute: 0,
  daysOfWeek: [],
  enabled: true,
}

export const DEFAULT_EMAIL: EmailSettingsData = {
  recipientEmails: [],
}

function mergeSmtp(base: SmtpSettingsData, patch: Partial<Record<string, unknown>>): SmtpSettingsData {
  const p = patch as Partial<SmtpSettingsData>
  return {
    from: typeof p.from === 'string' ? p.from : base.from,
    host: typeof p.host === 'string' ? p.host : base.host,
    port: typeof p.port === 'number' && p.port > 0 && p.port < 65536 ? p.port : base.port,
    secure: typeof p.secure === 'boolean' ? p.secure : base.secure,
    username: typeof p.username === 'string' ? p.username : base.username,
    password: typeof p.password === 'string' ? p.password : base.password,
    rejectUnauthorized:
      typeof p.rejectUnauthorized === 'boolean' ? p.rejectUnauthorized : base.rejectUnauthorized,
  }
}

function mergeCron(base: CronSettingsData, patch: Partial<Record<string, unknown>>): CronSettingsData {
  const p = patch as Partial<CronSettingsData>
  const days = p.daysOfWeek
  const daysOk =
    Array.isArray(days) && days.every((d) => typeof d === 'number' && d >= 0 && d <= 6)
      ? (days as number[])
      : base.daysOfWeek
  const tz = typeof p.timeZone === 'string' && p.timeZone.trim() ? p.timeZone.trim() : base.timeZone
  const hour =
    typeof p.hour === 'number' && p.hour >= 0 && p.hour <= 23 ? p.hour : base.hour
  const minute =
    typeof p.minute === 'number' && p.minute >= 0 && p.minute <= 59 ? p.minute : base.minute
  return {
    timeZone: tz,
    hour,
    minute,
    daysOfWeek: daysOk,
    enabled: typeof p.enabled === 'boolean' ? p.enabled : base.enabled,
  }
}

function mergeEmail(base: EmailSettingsData, patch: Partial<Record<string, unknown>>): EmailSettingsData {
  const p = patch as Partial<EmailSettingsData>
  const emails = Array.isArray(p.recipientEmails)
    ? (p.recipientEmails as unknown[]).filter((x): x is string => typeof x === 'string' && x.includes('@'))
    : base.recipientEmails
  return { recipientEmails: emails }
}

export async function getSmtpSettingsResolved(): Promise<SmtpSettingsData> {
  await ensureCveSchema()
  const M = getCveSettingsModel()!
  const row = await M.findByPk('smtp')
  const raw = row?.get('data') as Record<string, unknown> | undefined
  return mergeSmtp(DEFAULT_SMTP, raw ?? {})
}

export async function getCronSettingsResolved(): Promise<CronSettingsData> {
  await ensureCveSchema()
  const M = getCveSettingsModel()!
  const row = await M.findByPk('cron')
  const raw = row?.get('data') as Record<string, unknown> | undefined
  return mergeCron(DEFAULT_CRON, raw ?? {})
}

export async function getEmailSettingsResolved(): Promise<EmailSettingsData> {
  await ensureCveSchema()
  const M = getCveSettingsModel()!
  const emailRow = await M.findByPk('email')
  if (emailRow) {
    const emailRaw = emailRow.get('data') as Record<string, unknown> | undefined
    return mergeEmail(DEFAULT_EMAIL, emailRaw ?? {})
  }
  const cronRow = await M.findByPk('cron')
  const cronData = cronRow?.get('data') as Record<string, unknown> | undefined
  const legacy = Array.isArray(cronData?.recipientEmails)
    ? (cronData!.recipientEmails as unknown[]).filter((x): x is string => typeof x === 'string' && x.includes('@'))
    : []
  return { recipientEmails: legacy }
}

export async function upsertEmailSettings(patch: Partial<EmailSettingsData>): Promise<EmailSettingsData> {
  await ensureCveSchema()
  const current = await getEmailSettingsResolved()
  const next = mergeEmail(current, patch as Record<string, unknown>)
  const M = getCveSettingsModel()!
  await M.upsert({ type: 'email', data: next as unknown as Record<string, unknown> })
  return next
}

/** İstemciye: parola dönmeyin */
export async function getSmtpSettingsForClient(): Promise<
  SmtpSettingsData & { passwordConfigured: boolean }
> {
  const full = await getSmtpSettingsResolved()
  const passwordConfigured = !!full.password?.trim()
  return { ...full, password: '', passwordConfigured }
}

export async function upsertSmtpSettings(patch: Partial<SmtpSettingsData>): Promise<SmtpSettingsData> {
  await ensureCveSchema()
  const current = await getSmtpSettingsResolved()
  const merged = mergeSmtp(current, patch as Record<string, unknown>)
  const next =
    patch.password !== undefined && !String(patch.password).trim()
      ? { ...merged, password: current.password }
      : merged
  const M = getCveSettingsModel()!
  await M.upsert({ type: 'smtp', data: next as unknown as Record<string, unknown> })
  return next
}

export async function upsertCronSettings(patch: Partial<CronSettingsData>): Promise<CronSettingsData> {
  await ensureCveSchema()
  const current = await getCronSettingsResolved()
  const next = mergeCron(current, patch as Record<string, unknown>)
  const M = getCveSettingsModel()!
  await M.upsert({ type: 'cron', data: next as unknown as Record<string, unknown> })
  return next
}

import type { SessionConfig } from 'h3'

const DEV_FALLBACK_SECRET = 'zeroday-dev-session-secret-min-32-chars!!'

export type AuthSessionData = {
  userId?: number
  username?: string
}

export function getAuthSessionConfig(): SessionConfig {
  const config = useRuntimeConfig()
  const fromConfig = typeof config.sessionSecret === 'string' ? config.sessionSecret.trim() : ''
  const fromEnv = process.env.NUXT_SESSION_SECRET?.trim() || ''
  let password = fromConfig || fromEnv
  if (password.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'NUXT_SESSION_SECRET (veya runtimeConfig.sessionSecret) üretimde en az 32 karakter olmalıdır.'
      )
    }
    console.warn(
      '[auth] NUXT_SESSION_SECRET eksik veya kısa; geliştirme için geçici sabit kullanılıyor.'
    )
    password = DEV_FALLBACK_SECRET
  }

  /** Üretimde varsayılan true (yalnız HTTPS). HTTP (port-forward, iç Ingress) için NUXT_SESSION_COOKIE_SECURE=false */
  const cookieSecureEnv = process.env.NUXT_SESSION_COOKIE_SECURE?.trim().toLowerCase()
  const secure =
    cookieSecureEnv === 'false' || cookieSecureEnv === '0'
      ? false
      : cookieSecureEnv === 'true' || cookieSecureEnv === '1'
        ? true
        : process.env.NODE_ENV === 'production'

  return {
    password,
    maxAge: 60 * 60 * 24 * 7,
    name: 'zeroday',
    cookie: {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
    },
  }
}

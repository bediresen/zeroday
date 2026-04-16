import { UniqueConstraintError } from 'sequelize'
import { ensureCveSchema } from '../../utils/cveSchema'
import { hashPassword, validatePasswordPlain, validateUsername } from '../../utils/authCredentials'
import { getUserModel } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (!config.authAllowRegister) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Registration disabled',
      data: { message: 'Yeni kayıt şu an kapalı.', code: 'REGISTER_DISABLED' },
    })
  }

  const body = await readBody(event).catch(() => null) as
 | { username?: unknown; password?: unknown }
    | null

  const username = validateUsername(body?.username)
  const password = validatePasswordPlain(body?.password)
  const pw = body?.password

  if (!username || !password) {
    const parts: string[] = []
    if (!username) {
      parts.push(
        'Kullanıcı adı 3–32 karakter olmalı; yalnızca harf, rakam ve alt çizgi (_) kullanılabilir.'
      )
    }
    if (!password) {
      if (typeof pw !== 'string' || !pw.length) {
        parts.push('Şifre girin.')
      } else if (pw.length < 8) {
        parts.push('Şifre en az 8 karakter olmalıdır.')
      } else if (pw.length > 128) {
        parts.push('Şifre en fazla 128 karakter olabilir.')
      } else {
        parts.push('Şifre geçerli formatta değil.')
      }
    }
    const code =
      !username && !password ? 'VALIDATION' : !username ? 'USERNAME_INVALID' : 'PASSWORD_INVALID'
    throw createError({
      statusCode: 400,
      statusMessage: 'Şifre en az 8 karakter olmalıdır.',
      data: {
        message: parts.join(' '),
        code,
      },
    })
  }

  await ensureCveSchema()
  const User = getUserModel()!
  const password_hash = await hashPassword(password)

  try {
    const row = (await User.create({
      username,
      password_hash,
    })) as unknown as { id: number; username: string }
    /** Oturum açılmaz; kullanıcı «Giriş yap» ile giriş yapar. */
    return {
      data: {
        ok: true,
        user: { id: row.id, username: row.username },
      },
    }
  } catch (e) {
    if (e instanceof UniqueConstraintError) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Bu kullanıcı adı zaten alınmış.',
        data: { message: 'Bu kullanıcı adı zaten alınmış. Başka bir kullanıcı adı seçin.', code: 'USERNAME_TAKEN' },
      })
    }
    throw e
  }
})

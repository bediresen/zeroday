import { useSession } from 'h3'
import { ensureCveSchema } from '../../utils/cveSchema'
import { verifyPassword, validatePasswordPlain, validateUsername } from '../../utils/authCredentials'
import { getAuthSessionConfig, type AuthSessionData } from '../../utils/authSession'
import { getUserModel } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as
    | { username?: unknown; password?: unknown }
    | null

  const username = validateUsername(body?.username)
  const password = validatePasswordPlain(body?.password)
  const pw = body?.password

  if (!username) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Geçersiz kullanıcı adı',
      data: {
        message:
          'Kullanıcı adı 3–32 karakter olmalı; yalnızca harf, rakam ve alt çizgi (_) kullanılabilir.',
        code: 'USERNAME_INVALID',
      },
    })
  }
  if (!password) {
    let msg = 'Şifre en az 8, en fazla 128 karakter olmalıdır.'
    if (typeof pw !== 'string' || !pw.length) msg = 'Şifre girin.'
    else if (pw.length < 8) msg = 'Şifre en az 8 karakter olmalıdır.'
    else if (pw.length > 128) msg = 'Şifre en fazla 128 karakter olabilir.'
    throw createError({
      statusCode: 400,
      statusMessage: 'Geçersiz şifre',
      data: { message: msg, code: 'PASSWORD_INVALID' },
    })
  }

  await ensureCveSchema()
  const User = getUserModel()
  const row = (await User.findOne({
    where: { username },
    attributes: ['id', 'username', 'password_hash'],
    raw: true,
  })) as { id: number; username: string; password_hash: string } | null

  const hash = row?.password_hash
  const id = row?.id
  const uname = row?.username

  const ok = hash && password ? await verifyPassword(password, hash) : false
  if (!ok || !id || !uname) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Kullanıcı adı veya şifre hatalı.',
      data: { message: 'Kullanıcı adı veya şifre yanlış.', code: 'LOGIN_FAILED' },
    })
  }

  const session = await useSession<AuthSessionData>(event, getAuthSessionConfig())
  await session.update({ userId: id, username: uname })

  return {
    data: {
      ok: true,
      user: { id, username: uname },
    },
  }
})

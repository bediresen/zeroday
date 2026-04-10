import { useSession } from 'h3'
import { UniqueConstraintError } from 'sequelize'
import { ensureCveSchema } from '../../utils/cveSchema'
import { hashPassword, validatePasswordPlain, validateUsername } from '../../utils/authCredentials'
import { getAuthSessionConfig, type AuthSessionData } from '../../utils/authSession'
import { getUserModel } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (!config.authAllowRegister) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Registration disabled',
      data: { message: 'Yeni kayıt şu an kapalı.' },
    })
  }

  const body = await readBody(event).catch(() => null) as
 | { username?: unknown; password?: unknown }
    | null

  const username = validateUsername(body?.username)
  const password = validatePasswordPlain(body?.password)
  if (!username || !password) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid credentials',
      data: {
        message:
          'Kullanıcı adı 3–32 karakter (harf, rakam, alt çizgi). Şifre en az 8, en fazla 128 karakter.',
      },
    })
  }

  await ensureCveSchema()
  const User = getUserModel()
  const password_hash = await hashPassword(password)

  try {
    const row = await User.create({
      username,
      password_hash,
    })
    const session = await useSession<AuthSessionData>(event, getAuthSessionConfig())
    await session.update({ userId: row.id, username: row.username })
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
        statusMessage: 'Username taken',
        data: { message: 'Bu kullanıcı adı zaten kullanılıyor.' },
      })
    }
    throw e
  }
})

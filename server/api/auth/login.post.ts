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
  if (!username || !password) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid input',
      data: { message: 'Geçersiz kullanıcı adı veya şifre formatı.' },
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
      statusMessage: 'Invalid login',
      data: { message: 'Kullanıcı adı veya şifre hatalı.' },
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

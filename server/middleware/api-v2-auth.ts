import { useSession } from 'h3'
import { getAuthSessionConfig, type AuthSessionData } from '../utils/authSession'

/**
 * /api/v2/* isteklerinde oturum zorunlu. /api/auth/* bu middleware’e girmez.
 */
export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/v2')) return

  const session = await useSession<AuthSessionData>(event, getAuthSessionConfig())
  const userId = session.data.userId
  if (typeof userId !== 'number' || userId < 1) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      data: { message: 'Oturum gerekli. Lütfen giriş yapın.' },
    })
  }

  event.context.auth = {
    userId,
    username: session.data.username,
  }
})

import { useSession } from 'h3'
import { getAuthSessionConfig, type AuthSessionData } from '../../utils/authSession'

export default defineEventHandler(async (event) => {
  const session = await useSession<AuthSessionData>(event, getAuthSessionConfig())
  await session.clear()
  return { data: { ok: true } }
})

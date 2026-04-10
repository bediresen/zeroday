import { useSession } from 'h3'
import { ensureCveSchema } from '../../utils/cveSchema'
import { getAuthSessionConfig, type AuthSessionData } from '../../utils/authSession'
import { getUserModel } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const session = await useSession<AuthSessionData>(event, getAuthSessionConfig())
  const userId = session.data.userId
  if (typeof userId !== 'number' || userId < 1) {
    return { data: { user: null as null } }
  }

  await ensureCveSchema()
  const User = getUserModel()
  const row = await User.findByPk(userId, {
    attributes: ['id', 'username'],
  })
  if (!row) {
    await session.clear()
    return { data: { user: null as null } }
  }

  return {
    data: {
      user: {
        id: row.id,
        username: row.username,
      },
    },
  }
})

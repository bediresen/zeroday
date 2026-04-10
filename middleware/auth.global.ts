export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return

  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  try {
    const r = await $fetch<{ data: { user: { id: number; username: string } | null } }>(
      '/api/auth/me',
      { headers }
    )
    if (!r.data.user) {
      return navigateTo('/login')
    }
  } catch {
    return navigateTo('/login')
  }
})

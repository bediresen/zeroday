
export function useUnauthorizedRedirectHandlers() {
  const nuxtApp = useNuxtApp()

  return {
    async onResponseError({
      response,
    }: {
      response?: { status: number }
    }) {
      if (response?.status !== 401) return
      await nuxtApp.runWithContext(() => navigateTo('/login'))
    },
  }
}

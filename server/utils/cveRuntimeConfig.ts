/**
 * Zamanlanmış görevlerde `useRuntimeConfig()` event olmadan Nitro’da çalışır;
 * POST /api/v2/cves/nvd ile aynı OpenAI ve NVD anahtarı kaynağını kullanır.
 */
export function getOpenAiTranslateOptionsForPersist(): {
  openaiApiKey?: string
  openaiModel?: string
  openaiBaseUrl?: string
} {
  const config = useRuntimeConfig()
  return {
    openaiApiKey: typeof config.openaiApiKey === 'string' ? config.openaiApiKey : undefined,
    openaiModel: typeof config.openaiModel === 'string' ? config.openaiModel : undefined,
    openaiBaseUrl: typeof config.openaiBaseUrl === 'string' ? config.openaiBaseUrl : undefined,
  }
}

export function getNvdApiKeyForFetch(): string | undefined {
  const config = useRuntimeConfig()
  const k = typeof config.nvdApiKey === 'string' ? config.nvdApiKey.trim() : ''
  if (k) return k
  return (
    process.env.NUXT_NVD_API_KEY?.trim() ||
    process.env.NVD_API_KEY?.trim() ||
    undefined
  )
}

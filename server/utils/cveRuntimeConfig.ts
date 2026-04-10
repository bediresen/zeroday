/**
 * Zamanlanmış görevlerde `useRuntimeConfig()` event olmadan Nitro’da çalışır;
 * POST /api/v2/cves/nvd ile aynı Azure ve NVD anahtarı kaynağını kullanır.
 */
export function getAzureTranslatorOptionsForPersist(): {
  azureTranslatorKey?: string
  azureTranslatorRegion?: string
} {
  const config = useRuntimeConfig()
  return {
    azureTranslatorKey:
      typeof config.azureTranslatorKey === 'string' ? config.azureTranslatorKey : undefined,
    azureTranslatorRegion:
      typeof config.azureTranslatorRegion === 'string' ? config.azureTranslatorRegion : undefined,
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

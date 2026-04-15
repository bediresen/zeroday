import { persistNvdVulnerabilities, type NvdCveItem } from '../../../utils/nvdCve.helper'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody<{
      vulnerabilities?: NvdCveItem[]
      data?: { vulnerabilities?: NvdCveItem[] }
    }>(event)

    const list = Array.isArray(body?.vulnerabilities)
      ? body.vulnerabilities
      : body?.data?.vulnerabilities

    if (!Array.isArray(list)) {
      throw createError({
        statusCode: 400,
        data: { message: 'vulnerabilities dizisi gerekli (body.vulnerabilities veya body.data.vulnerabilities).' },
      })
    }

    const config = useRuntimeConfig()
    const result = await persistNvdVulnerabilities(list, {
      openaiApiKey: typeof config.openaiApiKey === 'string' ? config.openaiApiKey : undefined,
      openaiModel: typeof config.openaiModel === 'string' ? config.openaiModel : undefined,
      openaiBaseUrl: typeof config.openaiBaseUrl === 'string' ? config.openaiBaseUrl : undefined,
    })

    return {
      message: 'Senkronizasyon başarılı.',
      data: result,
    }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    const msg = error instanceof Error ? error.message : 'Sync failed'
    console.error('[POST /api/v2/cves/nvd]', error)
    throw createError({
      statusCode: 500,
      statusMessage: msg,
      data: { message: 'Senkronizasyon sırasında hata oluştu.' },
    })
  }
})

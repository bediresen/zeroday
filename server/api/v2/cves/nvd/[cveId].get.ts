import { ensureCveSchema } from '../../../../utils/cveSchema'
import { getCronSettingsResolved } from '../../../../utils/cveSettings'
import { getCveModel } from '../../../../utils/db'
import { fetchNvdCveById } from '../../../../utils/nvdCve.helper'

const CVE_ID_RE = /^CVE-\d{4}-\d+$/i

export default defineEventHandler(async (event) => {
  const raw = getRouterParam(event, 'cveId')
  const cveId = raw?.trim() || ''
  if (!CVE_ID_RE.test(cveId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Geçersiz CVE kimliği',
    })
  }

  try {
    const { nvdApiKey } = useRuntimeConfig()
    const nvd = await fetchNvdCveById(cveId, { apiKey: nvdApiKey || undefined })
    const vulnerability = nvd.vulnerabilities[0] ?? null

    if (!vulnerability || nvd.totalResults < 1) {
      throw createError({
        statusCode: 404,
        statusMessage: 'NVD’de bu CVE bulunamadı',
      })
    }

    let descriptionTr: string | null = null
    let affectedProducts: string[] | null = null
    try {
      await ensureCveSchema()
      const Cve = getCveModel()
      const row = (await Cve.findOne({
        where: { id: cveId.toUpperCase() },
        attributes: ['description_tr', 'affected_products'],
        raw: true,
      })) as { description_tr: string | null; affected_products: unknown } | null
      descriptionTr = row?.description_tr ?? null
      const ap = row?.affected_products
      if (Array.isArray(ap)) {
        const xs = ap.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim())
        affectedProducts = xs.length > 0 ? xs : null
      }
    } catch (e) {
      console.warn('[GET /api/v2/cves/nvd/:cveId] DB alanları okunamadı', e)
    }

    const cron = await getCronSettingsResolved()

    return {
      data: {
        cveId: cveId.toUpperCase(),
        totalResults: nvd.totalResults,
        resultsPerPage: nvd.resultsPerPage,
        startIndex: nvd.startIndex,
        timestamp: nvd.timestamp,
        format: nvd.format,
        version: nvd.version,
        descriptionTr,
        affectedProducts,
        timeZone: cron.timeZone,
        vulnerability,
      },
    }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    const msg = error instanceof Error ? error.message : 'NVD isteği başarısız'
    console.error('[GET /api/v2/cves/nvd/:cveId]', error)
    throw createError({
      statusCode: 502,
      statusMessage: msg,
      data: { message: 'NVD’den CVE alınamadı.' },
    })
  }
})

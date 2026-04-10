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
    try {
      await ensureCveSchema()
      const Cve = getCveModel()
      const row = (await Cve.findOne({
        where: { id: cveId.toUpperCase() },
        attributes: ['description_tr'],
        raw: true,
      })) as { description_tr: string | null } | null
      descriptionTr = row?.description_tr ?? null
    } catch (e) {
      console.warn('[GET /api/v2/cves/nvd/:cveId] description_tr okunamadı', e)
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

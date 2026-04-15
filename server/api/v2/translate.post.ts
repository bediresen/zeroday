import { translateCveStructuredEnToTr, type CveStructuredTranslation } from '../../utils/translateText'

const MAX_BODY_CHARS = 120_000
const MAX_TOTAL_CHARS = 400_000
const MAX_ITEMS = 500

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    text?: string
    texts?: string[]
    cveId?: string
    cveIds?: string[]
    to?: string
  }>(event)
  const to = body?.to ?? 'tr'

  if (Array.isArray(body?.texts)) {
    return handleBatch(body.texts, body?.cveIds, to)
  }

  const text = typeof body?.text === 'string' ? body.text : ''
  const cveId = typeof body?.cveId === 'string' ? body.cveId.trim() : undefined

  if (to !== 'tr') {
    return { translated: text, degraded: false }
  }
  if (text.length > MAX_BODY_CHARS) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Metin çok uzun',
    })
  }

  if (!text.trim() || text.trim() === '—') {
    const empty: CveStructuredTranslation = {
      cveId: cveId ?? 'UNKNOWN',
      descriptionTr: text,
      affectedProducts: [],
    }
    return { ...empty, translated: text, degraded: false }
  }

  const config = useRuntimeConfig()
  const llmCfg = {
    openaiApiKey: typeof config.openaiApiKey === 'string' ? config.openaiApiKey : undefined,
    openaiModel: typeof config.openaiModel === 'string' ? config.openaiModel : undefined,
    openaiBaseUrl: typeof config.openaiBaseUrl === 'string' ? config.openaiBaseUrl : undefined,
  }

  const structured = await translateCveStructuredEnToTr(cveId ?? 'UNKNOWN', text, llmCfg)
  if (structured) {
    const degraded = structured.descriptionTr.trim() === text.trim()
    return {
      cveId: structured.cveId,
      translated: structured.descriptionTr,
      affectedProducts: structured.affectedProducts,
      degraded,
    }
  }

  return {
    cveId: cveId ?? 'UNKNOWN',
    translated: text,
    affectedProducts: [] as string[],
    degraded: true,
  }
})

async function handleBatch(texts: string[], cveIds: string[] | undefined, to: string) {
  if (to !== 'tr') {
    return { translations: texts, degraded: false }
  }
  if (texts.length > MAX_ITEMS) {
    throw createError({ statusCode: 413, statusMessage: 'Çok fazla öğe' })
  }

  let total = 0
  for (const t of texts) {
    if (typeof t !== 'string') {
      throw createError({ statusCode: 400, statusMessage: 'texts dizisi string olmalı' })
    }
    total += t.length
  }
  if (total > MAX_TOTAL_CHARS) {
    throw createError({ statusCode: 413, statusMessage: 'Toplam metin çok uzun' })
  }

  if (cveIds !== undefined && cveIds.length !== texts.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'cveIds varsa texts ile aynı uzunlukta olmalı',
    })
  }

  const config = useRuntimeConfig()
  const llmCfg = {
    openaiApiKey: typeof config.openaiApiKey === 'string' ? config.openaiApiKey : undefined,
    openaiModel: typeof config.openaiModel === 'string' ? config.openaiModel : undefined,
    openaiBaseUrl: typeof config.openaiBaseUrl === 'string' ? config.openaiBaseUrl : undefined,
  }

  const results: CveStructuredTranslation[] = []
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]!
    const id = (cveIds?.[i] ?? 'UNKNOWN').trim() || 'UNKNOWN'
    if (!text.trim() || text.trim() === '—') {
      results.push({ cveId: id, descriptionTr: text, affectedProducts: [] })
      continue
    }
    const s = await translateCveStructuredEnToTr(id, text, llmCfg)
    if (s) {
      results.push(s)
    } else {
      results.push({ cveId: id, descriptionTr: text, affectedProducts: [] })
    }
  }

  return {
    translations: results.map((r) => r.descriptionTr),
    structured: results,
    degraded: false,
  }
}

import { translateEnToTr } from '../../utils/translateText'

const MAX_BODY_CHARS = 120_000
const MAX_TOTAL_CHARS = 400_000
const MAX_ITEMS = 500

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    text?: string
    texts?: string[]
    to?: string
  }>(event)
  const to = body?.to ?? 'tr'

  if (Array.isArray(body?.texts)) {
    return handleBatch(body.texts, to)
  }

  const text = typeof body?.text === 'string' ? body.text : ''

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
    return { translated: text, degraded: false }
  }

  const config = useRuntimeConfig()
  const translated = await translateEnToTr(text, {
    azureTranslatorKey:
      typeof config.azureTranslatorKey === 'string' ? config.azureTranslatorKey : undefined,
    azureTranslatorRegion:
      typeof config.azureTranslatorRegion === 'string' ? config.azureTranslatorRegion : undefined,
  })
  const degraded = translated.trim() === text.trim()
  return { translated, degraded }
})

async function handleBatch(texts: string[], to: string) {
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

  const config = useRuntimeConfig()
  const azureCfg = {
    azureTranslatorKey:
      typeof config.azureTranslatorKey === 'string' ? config.azureTranslatorKey : undefined,
    azureTranslatorRegion:
      typeof config.azureTranslatorRegion === 'string' ? config.azureTranslatorRegion : undefined,
  }

  const translations: string[] = []
  for (const text of texts) {
    if (!text.trim() || text.trim() === '—') {
      translations.push(text)
      continue
    }
    translations.push(await translateEnToTr(text, azureCfg))
  }

  return { translations, degraded: false }
}

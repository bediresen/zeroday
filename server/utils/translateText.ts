import { createHash } from 'node:crypto'

export type TranslateConfig = {
  azureTranslatorKey?: string
  azureTranslatorRegion?: string
}

const memoryCache = new Map<string, string>()
const MAX_CACHE_ENTRIES = 3000

/** Azure Translator istek gövdesi için makul parça boyutu (karakter) */
const AZURE_CHUNK_MAX = 4500

function cacheGet(key: string): string | undefined {
  return memoryCache.get(key)
}

function cacheSet(key: string, value: string) {
  if (memoryCache.size >= MAX_CACHE_ENTRIES) {
    const first = memoryCache.keys().next().value as string | undefined
    if (first !== undefined) memoryCache.delete(first)
  }
  memoryCache.set(key, value)
}

function stableCacheKey(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function chunkText(text: string, maxLen: number): string[] {
  const t = text.trim()
  if (!t) return []
  if (t.length <= maxLen) return [t]
  const parts: string[] = []
  let i = 0
  while (i < t.length) {
    let end = Math.min(i + maxLen, t.length)
    if (end < t.length) {
      const slice = t.slice(i, end)
      const lastBreak = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'), slice.lastIndexOf(' '))
      if (lastBreak > maxLen * 0.35) {
        end = i + lastBreak + 1
      }
    }
    const piece = t.slice(i, end).trim()
    if (piece) parts.push(piece)
    i = end
  }
  return parts
}

function azureHeaders(subscriptionKey: string, region: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Ocp-Apim-Subscription-Key': subscriptionKey,
  }
  const r = region?.trim()
  if (r) {
    headers['Ocp-Apim-Subscription-Region'] = r
  }
  return headers
}

const AZURE_TRANSLATE_URL =
  'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=tr'

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Tek istekte birden fazla metin (Azure sınırı: istek başına makul öğe sayısı + toplam boyut). */
async function translateAzureBatchOnce(
  texts: string[],
  subscriptionKey: string,
  region: string | undefined
): Promise<string[]> {
  if (texts.length === 0) return []
  const res = await fetch(AZURE_TRANSLATE_URL, {
    method: 'POST',
    headers: azureHeaders(subscriptionKey, region),
    body: JSON.stringify(texts.map((Text) => ({ Text }))),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    const err = new Error(`Azure Translator: HTTP ${res.status} ${errText}`) as Error & {
      status?: number
    }
    err.status = res.status
    throw err
  }
  const data = (await res.json()) as Array<{
    translations?: Array<{ text?: string }>
  }>
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error('Azure Translator: batch yanıt uzunluğu uyuşmuyor')
  }
  return data.map((d, i) => {
    const t = d.translations?.[0]?.text
    const fallback = texts[i] ?? ''
    return typeof t === 'string' ? t : fallback
  })
}

async function translateAzureChunk(
  text: string,
  subscriptionKey: string,
  region: string | undefined
): Promise<string> {
  const res = await fetch(AZURE_TRANSLATE_URL, {
    method: 'POST',
    headers: azureHeaders(subscriptionKey, region),
    body: JSON.stringify([{ Text: text }]),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Azure Translator: HTTP ${res.status} ${errText}`)
  }
  const data = (await res.json()) as Array<{
    translations?: Array<{ text?: string; to?: string }>
  }>
  const t = data[0]?.translations?.[0]?.text
  if (typeof t !== 'string') throw new Error('Azure Translator: empty response')
  return t
}

/** Uzun metinler tek tek; kısa metinler toplu isteklerle (429 için gecikme + yeniden deneme). */
const BATCH_MAX_ITEMS = 22
const BETWEEN_BATCH_MS = 500
const BETWEEN_LONG_SEQ_MS = 300
const LONG_TEXT_FOR_BATCH = 7500

/**
 * Aynı anda birden çok İngilizce metni çevirir; önbellek + toplu API ile kota yükünü azaltır.
 * Dizi uzunluğu ve sırası korunur.
 */
export async function translateManyEnToTr(
  texts: string[],
  config: TranslateConfig
): Promise<string[]> {
  const key = config.azureTranslatorKey?.trim()
  const region = config.azureTranslatorRegion
  const out: string[] = new Array(texts.length)
  const pending: { index: number; text: string }[] = []

  for (let i = 0; i < texts.length; i++) {
    const raw = texts[i] ?? ''
    const trimmed = raw.trim()
    if (!trimmed || trimmed === '—') {
      out[i] = raw
      continue
    }
    if (!key) {
      out[i] = raw
      continue
    }
    const ck = stableCacheKey(trimmed)
    const cacheKey = `en-tr:azure:${ck}`
    const hit = cacheGet(cacheKey)
    if (hit !== undefined) {
      out[i] = hit
    } else {
      pending.push({ index: i, text: trimmed })
    }
  }

  if (!key || pending.length === 0) {
    for (let i = 0; i < texts.length; i++) {
      if (out[i] === undefined) out[i] = texts[i] ?? ''
    }
    return out
  }

  const long = pending.filter((p) => p.text.length > LONG_TEXT_FOR_BATCH)
  const short = pending.filter((p) => p.text.length <= LONG_TEXT_FOR_BATCH)

  for (const p of long) {
    out[p.index] = await translateEnToTr(p.text, config)
    await sleepMs(BETWEEN_LONG_SEQ_MS)
  }

  for (let b = 0; b < short.length; b += BATCH_MAX_ITEMS) {
    const slice = short.slice(b, b + BATCH_MAX_ITEMS)
    const batchTexts = slice.map((s) => s.text)
    try {
      let translated: string[]
      try {
        translated = await translateAzureBatchOnce(batchTexts, key, region)
      } catch (e) {
        const status = (e as { status?: number }).status
        if (status === 429) {
          await sleepMs(4000)
          translated = await translateAzureBatchOnce(batchTexts, key, region)
        } else {
          throw e
        }
      }
      slice.forEach((item, j) => {
        const tr = translated[j]!
        out[item.index] = tr
        const ck = stableCacheKey(item.text)
        cacheSet(`en-tr:azure:${ck}`, tr)
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[translateManyEnToTr] toplu çeviri düştü, sırayla deneniyor:', msg)
      for (const item of slice) {
        try {
          out[item.index] = await translateEnToTr(item.text, config)
        } catch {
          out[item.index] = item.text
        }
        await sleepMs(220)
      }
    }
    if (b + BATCH_MAX_ITEMS < short.length) {
      await sleepMs(BETWEEN_BATCH_MS)
    }
  }

  for (let i = 0; i < texts.length; i++) {
    if (out[i] === undefined) out[i] = texts[i] ?? ''
  }
  return out
}

/**
 * İngilizce → Türkçe (Azure AI Translator).
 * Abonelik anahtarı yoksa veya hata olursa orijinal metin döner (throw etmez).
 */
export async function translateEnToTr(text: string, config: TranslateConfig): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed || trimmed === '—') return text

  const key = config.azureTranslatorKey?.trim()
  if (!key) {
    console.warn(
      '[translateEnToTr] NUXT_AZURE_TRANSLATOR_KEY tanımlı değil; çeviri atlanıyor'
    )
    return text
  }

  const region = config.azureTranslatorRegion

  const ck = stableCacheKey(trimmed)
  const cacheKey = `en-tr:azure:${ck}`
  const hit = cacheGet(cacheKey)
  if (hit !== undefined) return hit

  try {
    const chunks = chunkText(trimmed, AZURE_CHUNK_MAX)
    if (chunks.length === 0) return text
    const out: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 120))
      const piece = chunks[i]
      if (piece === undefined) break
      out.push(await translateAzureChunk(piece, key, region))
    }
    const merged = out.join(' ')
    cacheSet(cacheKey, merged)
    return merged
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[translateEnToTr] Azure Translator failed:', msg)
    return text
  }
}

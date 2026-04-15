import { createHash } from 'node:crypto'

export type TranslateConfig = {
  openaiApiKey?: string
  /** Varsayılan: gpt-4o-mini */
  openaiModel?: string
  /** Örn. Azure OpenAI: https://RESOURCE.openai.azure.com/openai/deployments/DEPLOYMENT */
  openaiBaseUrl?: string
}

/** LLM structured çıktısı (OpenAI JSON schema ile hizalı) */
export type CveStructuredTranslation = {
  cveId: string
  descriptionTr: string
  affectedProducts: string[]
}

const memoryCache = new Map<string, string>()
const MAX_CACHE_ENTRIES = 3000

const DEFAULT_MODEL = 'gpt-5-nano'
const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'

/** Tek istekte gönderilecek EN açıklama üst sınırı (yapılandırılmış tek shot) */
const STRUCTURED_INPUT_MAX = 28_000

/** LLM’e yalnızca düz metin açıklama gider (ham NVD JSON / ek alan yok). */
export function normalizeDescriptionForLlm(s: string): string {
  return s.trim().replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n')
}

const STRUCTURED_SYSTEM_PROMPT = `You are a cybersecurity analyst. The user message contains ONLY a CVE identifier and plain English vulnerability description text (no other NVD fields). You must:
1) Translate the full description into Turkish (formal, technical tone). Preserve CVE IDs, CVSS/CWE identifiers, product names, and version numbers as appropriate.
2) affectedProducts: return a SHORT array (usually 1–5 strings) of umbrella vendor or platform names only. Do not list every component, plugin, DLL, driver, or HTTP endpoint. Merge anything that clearly belongs to the same vendor/product family into ONE entry, using a well-known umbrella label (English names are fine). Examples you must follow in spirit: all .NET / .NET Framework / .NET Remoting / "Microsoft .NET" style mentions → a single ".NET"; all Adobe-branded apps and components (Acrobat, Photoshop, InDesign, Bridge, Experience Manager, ColdFusion, etc.) → "Adobe"; all Fortinet Forti* / FortiOS / FortiAnalyzer / etc. → "Fortinet"; Apache projects and Apache APISIX plugins or modules → "Apache"; Microsoft Windows / Office / Defender / SQL Server / SharePoint / Dynamics / PowerShell / Visual Studio when they are Microsoft ecosystem issues → "Microsoft" (or split only if the text is exclusively about one line, e.g. only Office → "Microsoft Office"); any WordPress plugin or theme → "WordPress"; Azure-named services → "Azure"; Chamilo LMS and its endpoints/plugins → "Chamilo". Apply the same merging rule to other vendors (e.g. multiple Siemens product names → "Siemens"; multiple Google/Chromium-related products → "Google" or "Chromium" as fits). Omit generic OS unless it is the sole vulnerable product. If nothing identifiable, use an empty array.
Output must match the JSON schema only.`

const JSON_SCHEMA_NAME = 'cve_translation'

const CVE_TRANSLATION_JSON_SCHEMA = {
  name: JSON_SCHEMA_NAME,
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      cveId: {
        type: 'string',
        description: 'CVE identifier exactly as provided in the user message',
      },
      descriptionTr: {
        type: 'string',
        description: 'Turkish translation of the vulnerability description',
      },
      affectedProducts: {
        type: 'array',
        description:
          '1–5 umbrella vendor/platform names; merge same-vendor components (e.g. Fortinet→one "Fortinet", WordPress plugins→"WordPress")',
        items: { type: 'string' },
      },
    },
    required: ['cveId', 'descriptionTr', 'affectedProducts'],
  },
} as const

/** Tek HTTP isteğinde birlikte gönderilecek maksimum CVE sayısı */
const CVE_BATCH_HTTP_SIZE = 10

const BATCH_JSON_SCHEMA_NAME = 'cve_translation_batch'

const CVE_BATCH_TRANSLATION_JSON_SCHEMA = {
  name: BATCH_JSON_SCHEMA_NAME,
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        description: 'One translation object per CVE in the user payload, same order',
        minItems: 1,
        maxItems: CVE_BATCH_HTTP_SIZE,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cveId: { type: 'string' },
            descriptionTr: { type: 'string' },
            affectedProducts: {
              type: 'array',
              description:
                '1–5 umbrella vendor/platform names; merge same-vendor components into one entry',
              items: { type: 'string' },
            },
          },
          required: ['cveId', 'descriptionTr', 'affectedProducts'],
        },
      },
    },
    required: ['items'],
  },
} as const

const STRUCTURED_BATCH_SYSTEM_PROMPT = `You are a cybersecurity analyst. The user will provide several CVE entries in a fixed order. Each entry is ONLY a CVE ID line plus plain English description text (no raw JSON or other NVD fields).
For EACH entry you must:
1) Translate the full English description into Turkish (formal, technical tone). Preserve CVE IDs, CVSS/CWE identifiers, product names, and version numbers as appropriate.
2) affectedProducts: same rules as single-CVE mode — a SHORT array (typically 1–5) of umbrella vendor/platform names only. Merge all components under one vendor into one string (.NET variants → ".NET"; Adobe apps → "Adobe"; Fortinet line → "Fortinet"; Apache family → "Apache"; Microsoft Windows/Office/Defender/SQL/SharePoint/etc. → usually "Microsoft" or "Microsoft Office" if Office-only; WordPress plugins → "WordPress"; Azure services → "Azure"; Chamilo → "Chamilo"). No per-endpoint or per-DLL lines. If nothing identifiable, use an empty array.
Return ONE JSON object with key "items": an array with the SAME LENGTH and SAME ORDER as the entries. Each element must have cveId (exact string from that entry), descriptionTr, and affectedProducts.`

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

function structuredCacheKey(cveId: string, englishText: string): string {
  return `struct:v3:${stableCacheKey(`${cveId.trim()}\n${englishText.trim()}`)}`
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function resolveBaseUrl(config: TranslateConfig): string {
  const u = config.openaiBaseUrl?.trim()
  if (u) return u.replace(/\/$/, '')
  return DEFAULT_OPENAI_BASE
}

function resolveModel(config: TranslateConfig): string {
  const m = config.openaiModel?.trim()
  return m || DEFAULT_MODEL
}

function clampStructuredInput(english: string): string {
  const t = english.trim()
  if (t.length <= STRUCTURED_INPUT_MAX) return t
  return `${t.slice(0, STRUCTURED_INPUT_MAX)}\n\n[… truncated for processing]`
}

function clampForBatch(english: string, maxLen: number): string {
  const t = english.trim()
  if (t.length <= maxLen) return t
  return `${t.slice(0, maxLen)}\n\n[… truncated for processing]`
}

function stripJsonFence(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (m?.[1]) return m[1].trim()
  return s.trim()
}

function normalizeProducts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const t = x.trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

function parseStructuredContent(
  content: string,
  forcedCveId: string
): CveStructuredTranslation | null {
  const raw = stripJsonFence(content)
  let obj: unknown
  try {
    obj = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  const descriptionTr =
    typeof rec.descriptionTr === 'string' ? rec.descriptionTr.trim() : typeof rec.description_tr === 'string' ? rec.description_tr.trim() : ''
  if (!descriptionTr) return null
  return {
    cveId: forcedCveId,
    descriptionTr,
    affectedProducts: normalizeProducts(rec.affectedProducts ?? rec.affected_products),
  }
}

function parseBatchStructuredContent(
  content: string,
  expectedCveIds: string[]
): CveStructuredTranslation[] | null {
  const raw = stripJsonFence(content)
  let obj: unknown
  try {
    obj = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  const arr = rec.items
  if (!Array.isArray(arr) || arr.length !== expectedCveIds.length) return null

  const byId = new Map<string, CveStructuredTranslation>()
  const byIndex: CveStructuredTranslation[] = []

  for (let i = 0; i < arr.length; i++) {
    const el = arr[i]
    if (!el || typeof el !== 'object') return null
    const e = el as Record<string, unknown>
    const idRaw = typeof e.cveId === 'string' ? e.cveId.trim() : ''
    const descriptionTr =
      typeof e.descriptionTr === 'string'
        ? e.descriptionTr.trim()
        : typeof e.description_tr === 'string'
          ? e.description_tr.trim()
          : ''
    if (!idRaw || !descriptionTr) return null
    const tr: CveStructuredTranslation = {
      cveId: idRaw,
      descriptionTr,
      affectedProducts: normalizeProducts(e.affectedProducts ?? e.affected_products),
    }
    byIndex.push(tr)
    byId.set(idRaw.toUpperCase(), tr)
  }

  const out: CveStructuredTranslation[] = []
  for (let i = 0; i < expectedCveIds.length; i++) {
    const want = (expectedCveIds[i] || 'UNKNOWN').trim().toUpperCase()
    let pick: CveStructuredTranslation | undefined | null = byIndex[i]
    if (!pick || pick.cveId.trim().toUpperCase() !== want) {
      pick = byId.get(want) ?? null
    }
    if (!pick) return null
    const canonId = (expectedCveIds[i] || pick.cveId).trim() || pick.cveId
    out.push({
      ...pick,
      cveId: canonId,
    })
  }
  return out
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>
  error?: { message?: string }
}

async function openAiChatCompletion(
  apiKey: string,
  baseUrl: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: ChatCompletionResponse; raw: string }> {
  const url = `${baseUrl}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  let data: ChatCompletionResponse
  try {
    data = JSON.parse(raw) as ChatCompletionResponse
  } catch {
    data = {}
  }
  return { ok: res.ok, status: res.status, data, raw }
}

/**
 * Tek CVE için EN açıklamadan yapılandırılmış çeviri + etkilenen ürün listesi.
 * Ağ/parse hatasında null döner (çağıran description_tr / affected_products null bırakır).
 */
export async function translateCveStructuredEnToTr(
  cveId: string,
  englishDescription: string,
  config: TranslateConfig
): Promise<CveStructuredTranslation | null> {
  const trimmed = englishDescription.trim()
  if (!trimmed || trimmed === '—') {
    return { cveId: cveId.trim() || 'UNKNOWN', descriptionTr: englishDescription, affectedProducts: [] }
  }

  const key = config.openaiApiKey?.trim()
  if (!key) {
    console.warn('[translateCveStructuredEnToTr] OpenAI API anahtarı tanımlı değil')
    return null
  }

  const idNorm = cveId.trim() || 'UNKNOWN'
  const model = resolveModel(config)
  const baseUrl = resolveBaseUrl(config)

  const cacheKey = structuredCacheKey(idNorm, trimmed)
  const hit = cacheGet(cacheKey)
  if (hit !== undefined) {
    try {
      const parsed = JSON.parse(hit) as { descriptionTr?: string; affectedProducts?: unknown }
      const descriptionTr = typeof parsed.descriptionTr === 'string' ? parsed.descriptionTr : ''
      if (descriptionTr) {
        return {
          cveId: idNorm,
          descriptionTr,
          affectedProducts: normalizeProducts(parsed.affectedProducts),
        }
      }
    } catch {
      /* yeniden çek */
    }
  }

  const userPayload = clampStructuredInput(normalizeDescriptionForLlm(trimmed))
  const userMessage = `${idNorm}
${userPayload}`

  const baseMessages = [
    { role: 'system' as const, content: STRUCTURED_SYSTEM_PROMPT },
    { role: 'user' as const, content: userMessage },
  ]

  const tryBodies: Record<string, unknown>[] = [
    {
      model,
      max_completion_tokens: 8192,
      messages: baseMessages,
      response_format: {
        type: 'json_schema',
        json_schema: CVE_TRANSLATION_JSON_SCHEMA,
      },
    },
    {
      model,
      max_completion_tokens: 8192,
      messages: baseMessages,
      response_format: { type: 'json_object' },
    },
    {
      model,
      max_completion_tokens: 8192,
      messages: [
        {
          role: 'system' as const,
          content: `${STRUCTURED_SYSTEM_PROMPT}\n\nRespond with a single JSON object only. Keys: cveId (string), descriptionTr (string), affectedProducts (array of strings). No markdown or code fences.`,
        },
        { role: 'user' as const, content: userMessage },
      ],
    },
  ]

  let lastErr = ''
  for (let attempt = 0; attempt < tryBodies.length; attempt++) {
    const body = tryBodies[attempt]
    if (body === undefined) break
    try {
      let r = await openAiChatCompletion(key, baseUrl, body)
      if (!r.ok && r.status === 429) {
        await sleepMs(5000)
        r = await openAiChatCompletion(key, baseUrl, body)
      }
      if (!r.ok) {
        lastErr = r.data.error?.message ?? r.raw.slice(0, 400)
        continue
      }
      const content = r.data.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) {
        lastErr = 'empty content'
        continue
      }
      const parsed = parseStructuredContent(content, idNorm)
      if (!parsed) {
        lastErr = 'JSON parse failed'
        continue
      }
      cacheSet(
        cacheKey,
        JSON.stringify({
          descriptionTr: parsed.descriptionTr,
          affectedProducts: parsed.affectedProducts,
        })
      )
      return parsed
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }

  console.warn('[translateCveStructuredEnToTr] OpenAI failed:', lastErr)
  return null
}

/**
 * En fazla `CVE_BATCH_HTTP_SIZE` CVE için tek `chat/completions` isteği.
 * Parse / API hatasında null (çağıran küme başına tekilleştirir).
 */
async function translateCveBatchStructuredEnToTr(
  batch: { cveId: string; text: string }[],
  config: TranslateConfig
): Promise<CveStructuredTranslation[] | null> {
  const key = config.openaiApiKey?.trim()
  if (!key || batch.length === 0) return null

  const model = resolveModel(config)
  const baseUrl = resolveBaseUrl(config)
  const n = batch.length
  const perItemMax = Math.min(
    STRUCTURED_INPUT_MAX,
    Math.max(1800, Math.floor(90_000 / n))
  )

  const lines: string[] = [
    `Return JSON: {"items":[...]} with exactly ${n} objects, same order as below. Each object: cveId, descriptionTr, affectedProducts (short array of merged umbrella vendor names, not per-component).`,
    '',
  ]
  for (let i = 0; i < n; i++) {
    const { cveId, text } = batch[i]!
    const idLine = (cveId.trim() || 'UNKNOWN').trim()
    const body = clampForBatch(normalizeDescriptionForLlm(text), perItemMax)
    lines.push(`[${i + 1}/${n}] ${idLine}`)
    lines.push(body)
    lines.push('')
  }
  const userMessage = lines.join('\n')

  const baseMessages = [
    { role: 'system' as const, content: STRUCTURED_BATCH_SYSTEM_PROMPT },
    { role: 'user' as const, content: userMessage },
  ]

  const expectedIds = batch.map((b) => b.cveId.trim() || 'UNKNOWN')
  const maxOut = Math.min(16384, 2048 + n * 900)

  const tryBodies: Record<string, unknown>[] = [
    {
      model,
      max_completion_tokens: maxOut,
      messages: baseMessages,
      response_format: {
        type: 'json_schema',
        json_schema: CVE_BATCH_TRANSLATION_JSON_SCHEMA,
      },
    },
    {
      model,
      max_completion_tokens: maxOut,
      messages: baseMessages,
      response_format: { type: 'json_object' },
    },
    {
      model,
      max_completion_tokens: maxOut,
      messages: [
        {
          role: 'system' as const,
          content: `${STRUCTURED_BATCH_SYSTEM_PROMPT}\n\nRespond with JSON only: a single object {"items":[ ... ]} with exactly ${n} array elements.`,
        },
        { role: 'user' as const, content: userMessage },
      ],
    },
  ]

  let lastErr = ''
  for (let attempt = 0; attempt < tryBodies.length; attempt++) {
    const body = tryBodies[attempt]
    if (body === undefined) break
    try {
      let r = await openAiChatCompletion(key, baseUrl, body)
      if (!r.ok && r.status === 429) {
        await sleepMs(5000)
        r = await openAiChatCompletion(key, baseUrl, body)
      }
      if (!r.ok) {
        lastErr = r.data.error?.message ?? r.raw.slice(0, 400)
        continue
      }
      const content = r.data.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) {
        lastErr = 'empty content'
        continue
      }
      const parsed = parseBatchStructuredContent(content, expectedIds)
      if (!parsed) {
        lastErr = 'batch JSON parse failed'
        continue
      }
      for (let i = 0; i < batch.length; i++) {
        const b = batch[i]!
        const p = parsed[i]!
        const ck = structuredCacheKey(b.cveId.trim() || 'UNKNOWN', b.text.trim())
        cacheSet(
          ck,
          JSON.stringify({
            descriptionTr: p.descriptionTr,
            affectedProducts: p.affectedProducts,
          })
        )
      }
      return parsed
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }

  console.warn('[translateCveBatchStructuredEnToTr] OpenAI failed:', lastErr)
  return null
}

export type CveStructuredInput = { cveId: string; text: string }

/** `translateManyCveStructuredEnToTr` istatistikleri (Kaydet / sunucu günlüğü) */
export type TranslateManyCveStructuredStats = {
  inputCount: number
  memoryCacheHits: number
  /** Gerçekleşen OpenAI `chat/completions` HTTP isteği sayısı (20’lik kümeler, paralel; gerekirse tekilleşme) */
  openaiRequestCount: number
}

export type TranslateManyCveStructuredResult = {
  translations: CveStructuredTranslation[]
  stats: TranslateManyCveStructuredStats
}

const LLM_LOG = '[NVD persist][LLM]'

/**
 * Birden fazla CVE için yapılandırılmış çeviri; sıra korunur.
 * @param onProgress — İsteğe bağlı; her aşamada tek satır (sunucu konsolu veya UI köprüsü için).
 */
export async function translateManyCveStructuredEnToTr(
  items: CveStructuredInput[],
  config: TranslateConfig,
  onProgress?: (line: string) => void
): Promise<TranslateManyCveStructuredResult> {
  const emit = (line: string) => {
    onProgress?.(line)
    console.info(`${LLM_LOG} ${line}`)
  }

  const key = config.openaiApiKey?.trim()
  const out: CveStructuredTranslation[] = items.map((it) => ({
    cveId: it.cveId.trim() || 'UNKNOWN',
    descriptionTr: it.text,
    affectedProducts: [],
  }))

  const emptyStats = (inputCount: number): TranslateManyCveStructuredStats => ({
    inputCount,
    memoryCacheHits: 0,
    openaiRequestCount: 0,
  })

  if (!key) {
    emit('OpenAI anahtarı yok; yapılandırılmış çeviri atlandı.')
    return { translations: out, stats: emptyStats(items.length) }
  }

  let memoryCacheHits = 0
  const pending: { index: number; cveId: string; text: string }[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!
    const t = it.text.trim()
    if (!t || t === '—') continue
    const ck = structuredCacheKey(it.cveId.trim() || 'UNKNOWN', t)
    const hit = cacheGet(ck)
    if (hit !== undefined) {
      try {
        const parsed = JSON.parse(hit) as { descriptionTr?: string; affectedProducts?: unknown }
        const descriptionTr = typeof parsed.descriptionTr === 'string' ? parsed.descriptionTr : ''
        if (descriptionTr) {
          memoryCacheHits++
          out[i] = {
            cveId: it.cveId.trim() || 'UNKNOWN',
            descriptionTr,
            affectedProducts: normalizeProducts(parsed.affectedProducts),
          }
          continue
        }
      } catch {
        /* API */
      }
    }
    pending.push({ index: i, cveId: it.cveId.trim() || 'UNKNOWN', text: t })
  }

  const httpBatches = Math.ceil(pending.length / CVE_BATCH_HTTP_SIZE) || 0
  emit(
    `Ön tarama bitti: ${items.length} girdi, ${memoryCacheHits} bellek önbelleği, ${pending.length} CVE çeviri kuyruğunda (${httpBatches} HTTP kümesi × en fazla ${CVE_BATCH_HTTP_SIZE}, paralel).`
  )

  const chunks: { index: number; cveId: string; text: string }[][] = []
  for (let b = 0; b < pending.length; b += CVE_BATCH_HTTP_SIZE) {
    chunks.push(pending.slice(b, b + CVE_BATCH_HTTP_SIZE))
  }

  let openaiHttpCalls = 0
  if (chunks.length > 0) {
    emit(`${chunks.length} küme (10'ar) aynı anda OpenAI’ye gönderiliyor; her kümede yalnızca CVE kimliği + İngilizce açıklama metni var.`)
    const chunkOutcomes = await Promise.all(
      chunks.map(async (slice, chunkIdx) => {
        const batchIndex = chunkIdx + 1
        const batchIn = slice.map((p) => ({ cveId: p.cveId, text: p.text }))
        let batchResults: CveStructuredTranslation[] | null = await translateCveBatchStructuredEnToTr(
          batchIn,
          config
        )
        let httpCalls = 1

        if (!batchResults) {
          emit(
            `Küme ${batchIndex}/${httpBatches}: toplu yanıt yok; ${slice.length} CVE tek tek deneniyor.`
          )
          batchResults = await Promise.all(
            slice.map((p) => translateCveStructuredEnToTr(p.cveId, p.text, config))
          ).then((arr) =>
            arr.map(
              (r, j) =>
                r ?? {
                  cveId: slice[j]!.cveId,
                  descriptionTr: slice[j]!.text,
                  affectedProducts: [],
                }
            )
          )
          httpCalls = slice.length
        }

        return { slice, batchResults: batchResults as CveStructuredTranslation[], httpCalls, batchIndex }
      })
    )

    for (const { slice, batchResults, httpCalls } of chunkOutcomes) {
      openaiHttpCalls += httpCalls
      slice.forEach((p, j) => {
        const r = batchResults[j]!
        const orig = items[p.index]?.text ?? ''
        if (r) {
          out[p.index] = r
        } else {
          out[p.index] = {
            cveId: p.cveId,
            descriptionTr: orig,
            affectedProducts: [],
          }
        }
      })
    }
    emit('Tüm paralel HTTP kümeleri tamamlandı.')
  }

  if (pending.length === 0) {
    emit('OpenAI çağrısı yok (tümü önbellekten veya boş metin).')
  }

  return {
    translations: out,
    stats: {
      inputCount: items.length,
      memoryCacheHits,
      openaiRequestCount: openaiHttpCalls,
    },
  }
}

export type TranslateEnToTrOptions = { cveId?: string }

/**
 * İngilizce → Türkçe; yalnızca çeviri metnini döndürür (ürün listesi atılır).
 * İsteğe bağlı cveId ürün çıkarımı ve önbellek için kullanılır.
 */
export async function translateEnToTr(
  text: string,
  config: TranslateConfig,
  options?: TranslateEnToTrOptions
): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed || trimmed === '—') return text

  const cveId = options?.cveId?.trim() || 'UNKNOWN'
  const r = await translateCveStructuredEnToTr(cveId, text, config)
  if (!r) return text
  return r.descriptionTr
}

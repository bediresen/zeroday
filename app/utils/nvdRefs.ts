/** NVD `references[].source` bazen UUID; okunur etiket için URL’den türet. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuidLike(s: string): boolean {
  return UUID_RE.test(s.trim())
}

export type NvdRefLike = { url?: string; source?: string }

export function nvdReferenceLabel(ref: NvdRefLike, index = 0): string {
  const url = ref.url?.trim()
  const src = ref.source?.trim()

  const sourceIsHuman =
    src &&
    !isUuidLike(src) &&
    (src.includes('@') || /[a-z]/i.test(src))

  if (sourceIsHuman && src) {
    return src
  }

  if (url) {
    try {
      const u = new URL(url)
      const host = u.hostname.replace(/^www\./i, '')
      const path = u.pathname && u.pathname !== '/' ? u.pathname : ''
      const max = 64
      let label = path ? `${host}${path}` : host
      if (label.length > max) {
        label = `${label.slice(0, max - 1)}…`
      }
      return label || host || `Bağlantı ${index + 1}`
    } catch {
      return url.length > 64 ? `${url.slice(0, 63)}…` : url
    }
  }

  if (src && !isUuidLike(src)) {
    return src
  }

  return `Bağlantı ${index + 1}`
}

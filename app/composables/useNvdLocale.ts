
export function useNvdLocale() {
  const { t, te } = useI18n()

  function vulnStatus(status: string) {
    if (!status || status === '—') return '—'
    const key = `nvd.vulnStatus.${status}` as const
    return te(key) ? t(key) : status
  }

  function severity(sev: string) {
    if (!sev || sev === '—') return '—'
    const key = `nvd.severity.${sev.toUpperCase()}` as const
    return te(key) ? t(key) : sev
  }

  return { vulnStatus, severity }
}

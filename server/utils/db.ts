import { Sequelize } from 'sequelize'
import { defineCveModel } from '../models/cve.model'
import { defineCveEmailLogModel } from '../models/cve-email-log.model'
import { defineCveSettingsModel } from '../models/cve-settings.model'

let sequelize: Sequelize | null = null


function ensureDatabaseUrl(url: string, dialect: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return url
  }
  const d = (dialect || 'mysql').toLowerCase()
  if (d === 'mysql' || d === 'mariadb') {
    return `mysql://${url}`
  }
  if (d === 'postgres' || d === 'postgresql') {
    return `postgres://${url}`
  }
  throw new Error(
    `NUXT_CVE_URL bir şema içermeli (örn. mysql://...) veya desteklenen bir dialect kullanın. Şu an: ${dialect}`
  )
}

function buildSequelize(): Sequelize {
  const config = useRuntimeConfig()
  const c = config.cve
  const url = typeof c.url === 'string' ? c.url.trim() : ''
  const db = typeof c.database === 'string' ? c.database.trim() : ''
  const user = typeof c.user === 'string' ? c.user.trim() : ''
  const password = c.password === undefined || c.password === null ? '' : String(c.password)

  if (!url && (!db || !user)) {
    throw new Error(
      'db connection url or database name and user name are required'
    )
  }

  if (url) {
    const connectionUrl = ensureDatabaseUrl(url, String(c.dialect || 'mysql'))
    return new Sequelize(connectionUrl, {
      dialect: c.dialect === 'mysql' ? 'mysql' : 'postgres',
      logging: false,
      define: { timestamps: false },
    })
  }

  return new Sequelize(db, user, password, {
    host: c.host,
    port: Number(c.port) || (c.dialect === 'mysql' ? 3306 : 5432),
    dialect: c.dialect === 'mysql' ? 'mysql' : 'postgres',
    logging: false,
    define: { timestamps: false },
  })
}

export function getSequelize(): Sequelize {
  if (!sequelize) sequelize = buildSequelize()
  return sequelize
}

export function getCveModel() {
  const s = getSequelize()
  if (!s.models.Cve) defineCveModel(s)
  return s.models.Cve
}

export function getCveSettingsModel() {
  const s = getSequelize()
  if (!s.models.CveSetting) defineCveSettingsModel(s)
  return s.models.CveSetting
}

export function getCveEmailLogModel() {
  const s = getSequelize()
  if (!s.models.CveEmailLog) defineCveEmailLogModel(s)
  return s.models.CveEmailLog
}

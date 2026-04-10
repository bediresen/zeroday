import { Sequelize } from 'sequelize'
import { defineCveModel } from '../models/cve.model'
import { defineCveEmailLogModel } from '../models/cve-email-log.model'
import { defineCveSettingsModel } from '../models/cve-settings.model'
import { defineUserModel } from '../models/user.model'

let sequelize: Sequelize | null = null

function resolveSequelizeDialect(d: string | undefined): 'mysql' | 'postgres' {
  const x = (d || 'postgres').toLowerCase()
  if (x === 'mysql' || x === 'mariadb') return 'mysql'
  return 'postgres'
}

function ensureDatabaseUrl(url: string, dialect: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return url
  }
  const d = (dialect || 'postgres').toLowerCase()
  if (d === 'mysql' || d === 'mariadb') {
    return `mysql://${url}`
  }
  if (d === 'postgres' || d === 'postgresql') {
    return `postgres://${url}`
  }
  throw new Error(
    `NUXT_CVE_URL bir şema içermeli (örn. postgres://...) veya desteklenen bir dialect kullanın. Şu an: ${dialect}`
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

  const sequelizeDialect = resolveSequelizeDialect(
    typeof c.dialect === 'string' ? c.dialect : undefined
  )

  if (url) {
    const connectionUrl = ensureDatabaseUrl(
      url,
      typeof c.dialect === 'string' ? c.dialect : 'postgres'
    )
    return new Sequelize(connectionUrl, {
      dialect: sequelizeDialect,
      logging: false,
      define: { timestamps: false },
    })
  }

  return new Sequelize(db, user, password, {
    host: c.host,
    port: Number(c.port) || (sequelizeDialect === 'mysql' ? 3306 : 5432),
    dialect: sequelizeDialect,
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

export function getUserModel() {
  const s = getSequelize()
  if (!s.models.User) defineUserModel(s)
  return s.models.User
}

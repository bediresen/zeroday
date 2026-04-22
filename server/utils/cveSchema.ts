import {
  getCveEmailLogModel,
  getCveModel,
  getCveSettingsModel,
  getSequelize,
  getUserModel,
} from './db'

let cveSchemaEnsured = false


export async function ensureCveSchema(): Promise<void> {
  if (cveSchemaEnsured) return

  const Cve = getCveModel()
  await Cve.sync()

  const CveSetting = getCveSettingsModel()
  await CveSetting.sync()

  const CveEmailLog = getCveEmailLogModel()
  await CveEmailLog.sync()

  const User = getUserModel()
  await User.sync()

  await migrateDescriptionTrColumnIfNeeded()
  await migrateAffectedProductsColumnIfNeeded()
  await ensureCvesPublishedAtIndexIfNeeded()

  cveSchemaEnsured = true
}

/**
 * Eski veritabanlarında `description_tr` yoksa ekler. `sync()` ile yeni oluşan tabloda
 * sütun zaten vardır; duplicate sütun hataları yutulur.
 */
async function migrateDescriptionTrColumnIfNeeded(): Promise<void> {
  const sequelize = getSequelize()
  const dialect = sequelize.getDialect()

  if (dialect === 'postgres') {
    await sequelize.query(
      'ALTER TABLE cves ADD COLUMN IF NOT EXISTS description_tr TEXT NULL'
    )
  } else {
    try {
      await sequelize.query('ALTER TABLE cves ADD COLUMN description_tr TEXT NULL')
    } catch (e: unknown) {
      const parent = e as { parent?: { errno?: number }; message?: string }
      const errno = parent?.parent?.errno
      const msg = parent?.message ?? (e instanceof Error ? e.message : String(e))
      if (errno === 1060 || /Duplicate column name/i.test(msg)) {
        // MySQL: ER_DUP_FIELDNAME
      } else {
        throw e
      }
    }
  }
}

/** `published_at` aralık / sıralama sorguları için (mevcut DB’lerde idempotent). */
async function ensureCvesPublishedAtIndexIfNeeded(): Promise<void> {
  const sequelize = getSequelize()
  const dialect = sequelize.getDialect()

  if (dialect === 'postgres' || dialect === 'sqlite') {
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_cves_published_at ON cves (published_at)'
    )
    return
  }

  try {
    await sequelize.query('CREATE INDEX idx_cves_published_at ON cves (published_at)')
  } catch (e: unknown) {
    const parent = e as { parent?: { errno?: number }; message?: string }
    const errno = parent?.parent?.errno
    const msg = parent?.message ?? (e instanceof Error ? e.message : String(e))
    if (errno === 1061 || /Duplicate key name|already exists/i.test(msg)) {
      return
    }
    throw e
  }
}

async function migrateAffectedProductsColumnIfNeeded(): Promise<void> {
  const sequelize = getSequelize()
  const dialect = sequelize.getDialect()

  if (dialect === 'postgres') {
    await sequelize.query(
      'ALTER TABLE cves ADD COLUMN IF NOT EXISTS affected_products JSONB NULL'
    )
  } else {
    try {
      await sequelize.query('ALTER TABLE cves ADD COLUMN affected_products JSON NULL')
    } catch (e: unknown) {
      const parent = e as { parent?: { errno?: number }; message?: string }
      const errno = parent?.parent?.errno
      const msg = parent?.message ?? (e instanceof Error ? e.message : String(e))
      if (errno === 1060 || /Duplicate column name/i.test(msg)) {
        // MySQL: ER_DUP_FIELDNAME
      } else {
        throw e
      }
    }
  }
}

/** @deprecated Aynı işi yapan {@link ensureCveSchema} kullanın */
export async function ensureCveDescriptionTrColumn(): Promise<void> {
  return ensureCveSchema()
}

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

import { DataTypes, type Sequelize, type ModelCtor, type Model } from 'sequelize'

export interface CveAttrs {
  id: string
  published_at: Date | null
  last_modified_at: Date | null
  vuln_status: string | null
  description: string | null
  description_tr: string | null
  cvss_score: string | null
  cvss_severity: string | null
  raw_json: unknown
  reference_entries: unknown
  created_at: Date
}

type CveModel = Model<CveAttrs> & CveAttrs

export function defineCveModel(sequelize: Sequelize): ModelCtor<CveModel> {
  const dialect = sequelize.getDialect()
  const jsonType = dialect === 'postgres' ? DataTypes.JSONB : DataTypes.JSON

  return sequelize.define<CveModel>(
    'Cve',
    {
      id: {
        type: DataTypes.STRING(32),
        primaryKey: true,
        allowNull: false,
      },
      published_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      last_modified_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      vuln_status: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      description_tr: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      cvss_score: {
        type: DataTypes.DECIMAL(4, 1),
        allowNull: true,
      },
      cvss_severity: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      raw_json: {
        type: jsonType,
        allowNull: true,
      },
      reference_entries: {
        type: jsonType,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      modelName: 'Cve',
      tableName: 'cves',
      timestamps: false,
    }
  )
}

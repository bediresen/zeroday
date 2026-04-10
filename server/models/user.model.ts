import { DataTypes, type Sequelize, type ModelCtor, type Model } from 'sequelize'

export interface UserAttrs {
  id: number
  username: string
  password_hash: string
  created_at: Date
}

type UserModel = Model<UserAttrs> & UserAttrs

export function defineUserModel(sequelize: Sequelize): ModelCtor<UserModel> {
  return sequelize.define<UserModel>(
    'User',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      username: {
        type: DataTypes.STRING(32),
        allowNull: false,
        unique: true,
      },
      password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      modelName: 'User',
      tableName: 'users',
      timestamps: false,
    }
  )
}

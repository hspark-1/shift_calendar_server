import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import User from "./User";

interface OAuthAuthorizationAttributes {
  authorization_id: string;
  user_id: string;
  provider: "APPLE";
  provider_subject: string;
  client_id: string;
  refresh_token_ciphertext: Buffer;
  refresh_token_iv: Buffer;
  refresh_token_auth_tag: Buffer;
  created_at?: Date;
  updated_at?: Date;
  revoked_at?: Date | null;
}

interface OAuthAuthorizationCreationAttributes
  extends Optional<
    OAuthAuthorizationAttributes,
    "authorization_id" | "provider" | "created_at" | "updated_at" | "revoked_at"
  > {}

class OAuthAuthorization
  extends Model<
    OAuthAuthorizationAttributes,
    OAuthAuthorizationCreationAttributes
  >
  implements OAuthAuthorizationAttributes
{
  declare authorization_id: string;
  declare user_id: string;
  declare provider: "APPLE";
  declare provider_subject: string;
  declare client_id: string;
  declare refresh_token_ciphertext: Buffer;
  declare refresh_token_iv: Buffer;
  declare refresh_token_auth_tag: Buffer;
  declare created_at: Date | undefined;
  declare updated_at: Date | undefined;
  declare revoked_at: Date | null | undefined;
}

OAuthAuthorization.init(
  {
    authorization_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "user_id" },
      onDelete: "CASCADE",
    },
    provider: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "APPLE",
    },
    provider_subject: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    client_id: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    refresh_token_ciphertext: {
      type: DataTypes.BLOB,
      allowNull: false,
    },
    refresh_token_iv: {
      type: DataTypes.BLOB,
      allowNull: false,
    },
    refresh_token_auth_tag: {
      type: DataTypes.BLOB,
      allowNull: false,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    revoked_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "oauth_authorizations",
    modelName: "OAuthAuthorization",
    timestamps: false,
    indexes: [
      {
        name: "uq_oauth_authorizations_subject_client",
        unique: true,
        fields: ["provider", "provider_subject", "client_id"],
      },
      {
        name: "idx_oauth_authorizations_user_active",
        fields: ["user_id", "provider"],
        where: { revoked_at: null },
      },
    ],
  },
);

OAuthAuthorization.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

User.hasMany(OAuthAuthorization, {
  foreignKey: "user_id",
  as: "oauth_authorizations",
});

export default OAuthAuthorization;

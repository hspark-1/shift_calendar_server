import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

export type OAuthProvider = "APPLE";
export type OAuthLoginPlatform = "ios" | "android";

interface OAuthLoginChallengeAttributes {
  challenge_id: string;
  provider: OAuthProvider;
  platform: OAuthLoginPlatform;
  state_hash: string;
  nonce_hash: string;
  client_id: string;
  redirect_uri?: string | null;
  expires_at: Date;
  consumed_at?: Date | null;
  created_at?: Date;
}

interface OAuthLoginChallengeCreationAttributes
  extends Optional<
    OAuthLoginChallengeAttributes,
    "challenge_id" | "provider" | "redirect_uri" | "consumed_at" | "created_at"
  > {}

class OAuthLoginChallenge
  extends Model<
    OAuthLoginChallengeAttributes,
    OAuthLoginChallengeCreationAttributes
  >
  implements OAuthLoginChallengeAttributes
{
  declare challenge_id: string;
  declare provider: OAuthProvider;
  declare platform: OAuthLoginPlatform;
  declare state_hash: string;
  declare nonce_hash: string;
  declare client_id: string;
  declare redirect_uri: string | null | undefined;
  declare expires_at: Date;
  declare consumed_at: Date | null | undefined;
  declare created_at: Date | undefined;
}

OAuthLoginChallenge.init(
  {
    challenge_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    provider: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "APPLE",
    },
    platform: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    state_hash: {
      type: DataTypes.CHAR(64),
      allowNull: false,
    },
    nonce_hash: {
      type: DataTypes.CHAR(64),
      allowNull: false,
    },
    client_id: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    redirect_uri: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    consumed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "oauth_login_challenges",
    modelName: "OAuthLoginChallenge",
    timestamps: false,
    indexes: [
      {
        name: "uq_oauth_login_challenges_state",
        unique: true,
        fields: ["state_hash"],
      },
      {
        name: "idx_oauth_login_challenges_cleanup",
        fields: ["expires_at"],
        where: { consumed_at: null },
      },
    ],
  },
);

export default OAuthLoginChallenge;

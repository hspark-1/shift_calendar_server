import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import User from "./User";

interface RefreshTokenAttributes {
  token_id: string;
  user_id: string;
  token_hash: string;
  device_info?: string | null;
  expires_at: Date;
  revoked_at?: Date | null;
  created_at?: Date;
}

interface RefreshTokenCreationAttributes
  extends Optional<
    RefreshTokenAttributes,
    "token_id" | "device_info" | "revoked_at" | "created_at"
  > {}

class RefreshToken
  extends Model<RefreshTokenAttributes, RefreshTokenCreationAttributes>
  implements RefreshTokenAttributes
{
  declare token_id: string;
  declare user_id: string;
  declare token_hash: string;
  declare device_info: string | null | undefined;
  declare expires_at: Date;
  declare revoked_at: Date | null | undefined;
  declare created_at: Date | undefined;

  // 토큰이 유효한지 확인
  public isValid(): boolean {
    if (this.revoked_at) return false;
    if (new Date() > this.expires_at) return false;
    return true;
  }

  // 토큰 무효화
  public async revoke(): Promise<void> {
    this.revoked_at = new Date();
    await this.save();
  }
}

RefreshToken.init(
  {
    token_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "user_id",
      },
      onDelete: "CASCADE",
    },
    token_hash: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    device_info: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    revoked_at: {
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
    tableName: "refresh_tokens",
    modelName: "RefreshToken",
    timestamps: false,
    indexes: [
      {
        name: "idx_refresh_tokens_user",
        fields: ["user_id"],
        where: { revoked_at: null },
      },
      {
        name: "idx_refresh_tokens_hash",
        unique: true,
        fields: ["token_hash"],
        where: { revoked_at: null },
      },
    ],
  }
);

// User와의 관계 설정
RefreshToken.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

User.hasMany(RefreshToken, {
  foreignKey: "user_id",
  as: "refresh_tokens",
});

export default RefreshToken;

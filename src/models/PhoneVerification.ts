import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { sequelize } from "../config/database";

export type PhonePurpose = "SIGNUP" | "PHONE_CHANGE";
class PhoneVerification extends Model<InferAttributes<PhoneVerification>, InferCreationAttributes<PhoneVerification>> {
  declare challenge_id: CreationOptional<string>;
  declare user_id: string;
  declare purpose: PhonePurpose;
  declare phone: string;
  declare phone_e164: string;
  declare generation: string;
  declare created_at: Date;
  declare expires_at: Date;
  declare retained_until: Date;
  declare cancelled_at: CreationOptional<Date | null>;
  declare challenge_key: string;
  declare challenge_fingerprint: string;
  declare fingerprint_key_version: string;
  declare verify_key: CreationOptional<string | null>;
  declare verify_fingerprint: CreationOptional<string | null>;
  declare verified_at: CreationOptional<Date | null>;
  declare proof_id: CreationOptional<string | null>;
  declare proof_token_hash: CreationOptional<string | null>;
  declare proof_key_version: CreationOptional<string | null>;
  declare proof_expires_at: CreationOptional<Date | null>;
  declare consumed_at: CreationOptional<Date | null>;
}
PhoneVerification.init({
  challenge_id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  user_id: { type: DataTypes.UUID, allowNull: false },
  purpose: { type: DataTypes.TEXT, allowNull: false },
  phone: { type: DataTypes.TEXT, allowNull: false },
  phone_e164: { type: DataTypes.TEXT, allowNull: false },
  generation: { type: DataTypes.BIGINT, allowNull: false },
  created_at: { type: DataTypes.DATE, allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  retained_until: { type: DataTypes.DATE, allowNull: false },
  cancelled_at: { type: DataTypes.DATE },
  challenge_key: { type: DataTypes.UUID, allowNull: false },
  challenge_fingerprint: { type: DataTypes.CHAR(64), allowNull: false },
  fingerprint_key_version: { type: DataTypes.TEXT, allowNull: false },
  verify_key: { type: DataTypes.UUID },
  verify_fingerprint: { type: DataTypes.CHAR(64) },
  verified_at: { type: DataTypes.DATE },
  proof_id: { type: DataTypes.UUID },
  proof_token_hash: { type: DataTypes.CHAR(64) },
  proof_key_version: { type: DataTypes.TEXT },
  proof_expires_at: { type: DataTypes.DATE },
  consumed_at: { type: DataTypes.DATE },
}, { sequelize, tableName: "phone_verifications", timestamps: false });
export default PhoneVerification;

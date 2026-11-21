import { DataTypes, Model, InferAttributes, InferCreationAttributes } from "sequelize";
import { sequelize } from "../config/database";

class ProfileMutationReceipt extends Model<InferAttributes<ProfileMutationReceipt>, InferCreationAttributes<ProfileMutationReceipt>> {
  declare user_id: string;
  declare idempotency_key: string;
  declare operation: "COMPLETE" | "UPDATE";
  declare request_fingerprint: string;
  declare fingerprint_key_version: string;
  declare verification_id: string | null;
  declare created_at: Date;
  declare retained_until: Date;
}
ProfileMutationReceipt.init({
  user_id: { type: DataTypes.UUID, primaryKey: true },
  idempotency_key: { type: DataTypes.UUID, primaryKey: true },
  operation: { type: DataTypes.TEXT, allowNull: false },
  request_fingerprint: { type: DataTypes.CHAR(64), allowNull: false },
  fingerprint_key_version: { type: DataTypes.TEXT, allowNull: false },
  verification_id: { type: DataTypes.UUID, unique: true },
  created_at: { type: DataTypes.DATE, allowNull: false },
  retained_until: { type: DataTypes.DATE, allowNull: false },
}, { sequelize, tableName: "profile_mutation_receipts", timestamps: false });
export default ProfileMutationReceipt;

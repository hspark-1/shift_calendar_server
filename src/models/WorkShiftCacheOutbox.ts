import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

interface WorkShiftCacheOutboxAttributes {
  event_id: string;
  event_type: "WORK_SHIFT_MONTH_CHANGED";
  owner_user_id: string;
  year_month: string;
  revision: string;
  created_at: Date;
  next_attempt_at: Date;
  claimed_at?: Date | null;
  claim_token?: string | null;
  attempt_count: number;
  processed_at?: Date | null;
  last_error_code?: string | null;
}

interface WorkShiftCacheOutboxCreationAttributes
  extends Optional<
    WorkShiftCacheOutboxAttributes,
    | "event_id"
    | "event_type"
    | "created_at"
    | "next_attempt_at"
    | "claimed_at"
    | "claim_token"
    | "attempt_count"
    | "processed_at"
    | "last_error_code"
  > {}

class WorkShiftCacheOutbox
  extends Model<
    WorkShiftCacheOutboxAttributes,
    WorkShiftCacheOutboxCreationAttributes
  >
  implements WorkShiftCacheOutboxAttributes
{
  declare event_id: string;
  declare event_type: "WORK_SHIFT_MONTH_CHANGED";
  declare owner_user_id: string;
  declare year_month: string;
  declare revision: string;
  declare created_at: Date;
  declare next_attempt_at: Date;
  declare claimed_at: Date | null | undefined;
  declare claim_token: string | null | undefined;
  declare attempt_count: number;
  declare processed_at: Date | null | undefined;
  declare last_error_code: string | null | undefined;
}

WorkShiftCacheOutbox.init(
  {
    event_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    event_type: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "WORK_SHIFT_MONTH_CHANGED",
    },
    owner_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "user_id" },
      onDelete: "CASCADE",
    },
    year_month: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    revision: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    next_attempt_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    claimed_at: { type: DataTypes.DATE, allowNull: true },
    claim_token: { type: DataTypes.UUID, allowNull: true },
    attempt_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    processed_at: { type: DataTypes.DATE, allowNull: true },
    last_error_code: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    sequelize,
    tableName: "work_shift_cache_outbox",
    modelName: "WorkShiftCacheOutbox",
    timestamps: false,
  },
);

export default WorkShiftCacheOutbox;

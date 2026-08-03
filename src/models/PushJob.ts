import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

export type PushJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "RETRY"
  | "COMPLETED"
  | "NO_TARGET"
  | "FAILED"
  | "EXPIRED"
  | "CANCELED";

interface PushJobAttributes {
  push_job_id: string;
  notification_id: string;
  receiver_user_id: string;
  target_policy: "LATEST_ACTIVE";
  title: string;
  body: string | null;
  data_payload: Record<string, string>;
  priority: "HIGH";
  status: PushJobStatus;
  attempt_count: number;
  available_at: Date;
  locked_by: string | null;
  lease_until: Date | null;
  expires_at: Date;
  completed_at: Date | null;
  cancel_requested_at: Date | null;
  cancellation_reason: string | null;
  last_error_code: string | null;
  created_at: Date;
  updated_at: Date;
}

interface PushJobCreationAttributes
  extends Optional<
    PushJobAttributes,
    | "push_job_id"
    | "target_policy"
    | "body"
    | "priority"
    | "status"
    | "attempt_count"
    | "available_at"
    | "locked_by"
    | "lease_until"
    | "completed_at"
    | "cancel_requested_at"
    | "cancellation_reason"
    | "last_error_code"
    | "created_at"
    | "updated_at"
  > {}

class PushJob
  extends Model<PushJobAttributes, PushJobCreationAttributes>
  implements PushJobAttributes
{
  declare push_job_id: string;
  declare notification_id: string;
  declare receiver_user_id: string;
  declare target_policy: "LATEST_ACTIVE";
  declare title: string;
  declare body: string | null;
  declare data_payload: Record<string, string>;
  declare priority: "HIGH";
  declare status: PushJobStatus;
  declare attempt_count: number;
  declare available_at: Date;
  declare locked_by: string | null;
  declare lease_until: Date | null;
  declare expires_at: Date;
  declare completed_at: Date | null;
  declare cancel_requested_at: Date | null;
  declare cancellation_reason: string | null;
  declare last_error_code: string | null;
  declare created_at: Date;
  declare updated_at: Date;
}

PushJob.init(
  {
    push_job_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    notification_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: { model: "notifications", key: "notification_id" },
      onDelete: "CASCADE",
    },
    receiver_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "user_id" },
      onDelete: "CASCADE",
    },
    target_policy: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "LATEST_ACTIVE",
    },
    title: { type: DataTypes.TEXT, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: true },
    data_payload: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    priority: { type: DataTypes.TEXT, allowNull: false, defaultValue: "HIGH" },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "PENDING",
    },
    attempt_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    available_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    locked_by: { type: DataTypes.TEXT, allowNull: true },
    lease_until: { type: DataTypes.DATE, allowNull: true },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    completed_at: { type: DataTypes.DATE, allowNull: true },
    cancel_requested_at: { type: DataTypes.DATE, allowNull: true },
    cancellation_reason: { type: DataTypes.TEXT, allowNull: true },
    last_error_code: { type: DataTypes.TEXT, allowNull: true },
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
  },
  {
    sequelize,
    tableName: "push_jobs",
    modelName: "PushJob",
    timestamps: false,
  },
);

export default PushJob;

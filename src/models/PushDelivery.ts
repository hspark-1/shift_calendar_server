import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

export type PushDeliveryStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "RETRY"
  | "FAILED"
  | "SKIPPED";

interface PushDeliveryAttributes {
  delivery_id: string;
  push_job_id: string;
  device_id: string;
  status: PushDeliveryStatus;
  attempt_count: number;
  next_retry_at: Date | null;
  provider_message_id: string | null;
  target_hash: string | null;
  error_code: string | null;
  sending_started_at: Date | null;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface PushDeliveryCreationAttributes
  extends Optional<
    PushDeliveryAttributes,
    | "delivery_id"
    | "status"
    | "attempt_count"
    | "next_retry_at"
    | "provider_message_id"
    | "target_hash"
    | "error_code"
    | "sending_started_at"
    | "sent_at"
    | "created_at"
    | "updated_at"
  > {}

class PushDelivery
  extends Model<PushDeliveryAttributes, PushDeliveryCreationAttributes>
  implements PushDeliveryAttributes
{
  declare delivery_id: string;
  declare push_job_id: string;
  declare device_id: string;
  declare status: PushDeliveryStatus;
  declare attempt_count: number;
  declare next_retry_at: Date | null;
  declare provider_message_id: string | null;
  declare target_hash: string | null;
  declare error_code: string | null;
  declare sending_started_at: Date | null;
  declare sent_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}

PushDelivery.init(
  {
    delivery_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    push_job_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "push_jobs", key: "push_job_id" },
      onDelete: "CASCADE",
    },
    device_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "user_devices", key: "device_id" },
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "PENDING",
    },
    attempt_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    next_retry_at: { type: DataTypes.DATE, allowNull: true },
    provider_message_id: { type: DataTypes.TEXT, allowNull: true },
    target_hash: { type: DataTypes.TEXT, allowNull: true },
    error_code: { type: DataTypes.TEXT, allowNull: true },
    sending_started_at: { type: DataTypes.DATE, allowNull: true },
    sent_at: { type: DataTypes.DATE, allowNull: true },
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
    tableName: "push_deliveries",
    modelName: "PushDelivery",
    timestamps: false,
  },
);

export default PushDelivery;

import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import AccountDeletionRequest from "./AccountDeletionRequest";

export type AccountDeletionProvider = "APPLE" | "KAKAO";
export type AccountDeletionProviderTaskStatus =
  | "PENDING"
  | "PROCESSING"
  | "RETRY"
  | "COMPLETED"
  | "FAILED";

interface ProviderTaskAttributes {
  provider_task_id: string;
  deletion_request_id: string;
  provider: AccountDeletionProvider;
  status: AccountDeletionProviderTaskStatus;
  attempt_count: number;
  available_at: Date;
  completed_at: Date | null;
  last_error_code: string | null;
  created_at: Date;
  updated_at: Date;
}

type ProviderTaskCreationAttributes = Optional<
  ProviderTaskAttributes,
  | "provider_task_id"
  | "status"
  | "attempt_count"
  | "available_at"
  | "completed_at"
  | "last_error_code"
  | "created_at"
  | "updated_at"
>;

class AccountDeletionProviderTask
  extends Model<ProviderTaskAttributes, ProviderTaskCreationAttributes>
  implements ProviderTaskAttributes
{
  declare provider_task_id: string;
  declare deletion_request_id: string;
  declare provider: AccountDeletionProvider;
  declare status: AccountDeletionProviderTaskStatus;
  declare attempt_count: number;
  declare available_at: Date;
  declare completed_at: Date | null;
  declare last_error_code: string | null;
  declare created_at: Date;
  declare updated_at: Date;
}

AccountDeletionProviderTask.init(
  {
    provider_task_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    deletion_request_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "account_deletion_requests",
        key: "deletion_request_id",
      },
      onDelete: "CASCADE",
    },
    provider: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.TEXT, allowNull: false, defaultValue: "PENDING" },
    attempt_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    available_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    completed_at: { type: DataTypes.DATE, allowNull: true },
    last_error_code: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: "account_deletion_provider_tasks",
    modelName: "AccountDeletionProviderTask",
    timestamps: false,
    indexes: [
      {
        name: "uq_account_deletion_provider_tasks_request_provider",
        unique: true,
        fields: ["deletion_request_id", "provider"],
      },
    ],
  },
);

AccountDeletionProviderTask.belongsTo(AccountDeletionRequest, {
  foreignKey: "deletion_request_id",
  as: "deletion_request",
});
AccountDeletionRequest.hasMany(AccountDeletionProviderTask, {
  foreignKey: "deletion_request_id",
  as: "provider_tasks",
});

export default AccountDeletionProviderTask;

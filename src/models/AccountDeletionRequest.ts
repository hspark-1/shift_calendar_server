import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

export type AccountDeletionStatus =
  | "PENDING"
  | "PROCESSING"
  | "RETRY"
  | "CACHE_PURGE_PENDING"
  | "COMPLETED"
  | "FAILED";

interface AccountDeletionRequestAttributes {
  deletion_request_id: string;
  user_id: string | null;
  status: AccountDeletionStatus;
  cache_year_months: string[];
  requested_at: Date;
  available_at: Date;
  claimed_at: Date | null;
  claim_token: string | null;
  attempt_count: number;
  db_purged_at: Date | null;
  cache_purged_at: Date | null;
  completed_at: Date | null;
  last_error_code: string | null;
}

type AccountDeletionRequestCreationAttributes = Optional<
  AccountDeletionRequestAttributes,
  | "deletion_request_id"
  | "status"
  | "cache_year_months"
  | "requested_at"
  | "available_at"
  | "claimed_at"
  | "claim_token"
  | "attempt_count"
  | "db_purged_at"
  | "cache_purged_at"
  | "completed_at"
  | "last_error_code"
>;

class AccountDeletionRequest
  extends Model<
    AccountDeletionRequestAttributes,
    AccountDeletionRequestCreationAttributes
  >
  implements AccountDeletionRequestAttributes
{
  declare deletion_request_id: string;
  declare user_id: string | null;
  declare status: AccountDeletionStatus;
  declare cache_year_months: string[];
  declare requested_at: Date;
  declare available_at: Date;
  declare claimed_at: Date | null;
  declare claim_token: string | null;
  declare attempt_count: number;
  declare db_purged_at: Date | null;
  declare cache_purged_at: Date | null;
  declare completed_at: Date | null;
  declare last_error_code: string | null;
}

AccountDeletionRequest.init(
  {
    deletion_request_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: { type: DataTypes.UUID, allowNull: true },
    status: { type: DataTypes.TEXT, allowNull: false, defaultValue: "PENDING" },
    cache_year_months: {
      type: DataTypes.ARRAY(DataTypes.DATEONLY),
      allowNull: false,
      defaultValue: [],
    },
    requested_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    available_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    claimed_at: { type: DataTypes.DATE, allowNull: true },
    claim_token: { type: DataTypes.UUID, allowNull: true },
    attempt_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    db_purged_at: { type: DataTypes.DATE, allowNull: true },
    cache_purged_at: { type: DataTypes.DATE, allowNull: true },
    completed_at: { type: DataTypes.DATE, allowNull: true },
    last_error_code: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    sequelize,
    tableName: "account_deletion_requests",
    modelName: "AccountDeletionRequest",
    timestamps: false,
    indexes: [
      {
        name: "uq_account_deletion_requests_active_user",
        unique: true,
        fields: ["user_id"],
        where: { completed_at: null },
      },
      {
        name: "idx_account_deletion_requests_claimable",
        fields: ["available_at", "requested_at"],
      },
    ],
  },
);

export default AccountDeletionRequest;

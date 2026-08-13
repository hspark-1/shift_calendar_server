import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

export type GroupInvitationStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "CANCELED"
  | "EXPIRED";

interface GroupInvitationAttributes {
  invitation_id: string;
  group_id: string;
  inviter_user_id: string;
  invitee_user_id: string;
  status: GroupInvitationStatus;
  message: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
  responded_at: Date | null;
}

interface GroupInvitationCreationAttributes
  extends Optional<
    GroupInvitationAttributes,
    "invitation_id" | "status" | "message" | "created_at" | "updated_at" | "responded_at"
  > {}

class GroupInvitation
  extends Model<GroupInvitationAttributes, GroupInvitationCreationAttributes>
  implements GroupInvitationAttributes
{
  declare invitation_id: string;
  declare group_id: string;
  declare inviter_user_id: string;
  declare invitee_user_id: string;
  declare status: GroupInvitationStatus;
  declare message: string | null;
  declare expires_at: Date;
  declare created_at: Date;
  declare updated_at: Date;
  declare responded_at: Date | null;
}

GroupInvitation.init(
  {
    invitation_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    group_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "groups", key: "group_id" },
    },
    inviter_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "user_id" },
      onDelete: "CASCADE",
    },
    invitee_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "user_id" },
      onDelete: "CASCADE",
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "PENDING",
    },
    message: { type: DataTypes.TEXT, allowNull: true },
    expires_at: { type: DataTypes.DATE, allowNull: false },
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
    responded_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    tableName: "group_invitations",
    modelName: "GroupInvitation",
    timestamps: false,
  },
);

export default GroupInvitation;

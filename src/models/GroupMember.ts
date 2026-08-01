import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

export type GroupRole = "OWNER" | "ADMIN" | "MEMBER";

interface GroupMemberAttributes {
  group_member_id: string;
  group_id: string;
  user_id: string;
  role: GroupRole;
  added_by_user_id: string;
  joined_at: Date;
  updated_at: Date;
  removed_at: Date | null;
  removed_by_user_id: string | null;
}

interface GroupMemberCreationAttributes
  extends Optional<
    GroupMemberAttributes,
    | "group_member_id"
    | "role"
    | "joined_at"
    | "updated_at"
    | "removed_at"
    | "removed_by_user_id"
  > {}

class GroupMember
  extends Model<GroupMemberAttributes, GroupMemberCreationAttributes>
  implements GroupMemberAttributes
{
  declare group_member_id: string;
  declare group_id: string;
  declare user_id: string;
  declare role: GroupRole;
  declare added_by_user_id: string;
  declare joined_at: Date;
  declare updated_at: Date;
  declare removed_at: Date | null;
  declare removed_by_user_id: string | null;
}

GroupMember.init(
  {
    group_member_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    group_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "groups", key: "group_id" },
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "user_id" },
    },
    role: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "MEMBER",
    },
    added_by_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "user_id" },
    },
    joined_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    removed_at: { type: DataTypes.DATE, allowNull: true },
    removed_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "users", key: "user_id" },
    },
  },
  {
    sequelize,
    tableName: "group_members",
    modelName: "GroupMember",
    timestamps: false,
  },
);

export default GroupMember;

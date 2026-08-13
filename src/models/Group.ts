import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

interface GroupAttributes {
  group_id: string;
  name: string;
  timezone: string;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by_user_id: string | null;
}

interface GroupCreationAttributes
  extends Optional<
    GroupAttributes,
    "group_id" | "created_at" | "updated_at" | "deleted_at" | "deleted_by_user_id"
  > {}

class Group
  extends Model<GroupAttributes, GroupCreationAttributes>
  implements GroupAttributes
{
  declare group_id: string;
  declare name: string;
  declare timezone: string;
  declare created_by_user_id: string | null;
  declare created_at: Date;
  declare updated_at: Date;
  declare deleted_at: Date | null;
  declare deleted_by_user_id: string | null;
}

Group.init(
  {
    group_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: { type: DataTypes.TEXT, allowNull: false },
    timezone: { type: DataTypes.TEXT, allowNull: false },
    created_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "users", key: "user_id" },
      onDelete: "SET NULL",
    },
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
    deleted_at: { type: DataTypes.DATE, allowNull: true },
    deleted_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "users", key: "user_id" },
      onDelete: "SET NULL",
    },
  },
  {
    sequelize,
    tableName: "groups",
    modelName: "Group",
    timestamps: false,
  },
);

export default Group;

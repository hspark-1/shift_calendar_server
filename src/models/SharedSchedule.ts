import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import User from "./User";

// 공유 권한 타입
export enum SharePermission {
  VIEW = "view",
  EDIT = "edit",
}

interface SharedScheduleAttributes {
  id: string; // UUID
  owner_id: string; // UUID
  shared_with_id: string; // UUID
  permission: SharePermission;
  start_date?: Date;
  end_date?: Date;
  created_at?: Date;
  updated_at?: Date;
}

interface SharedScheduleCreationAttributes
  extends Optional<
    SharedScheduleAttributes,
    "id" | "start_date" | "end_date" | "created_at" | "updated_at"
  > {}

class SharedSchedule
  extends Model<SharedScheduleAttributes, SharedScheduleCreationAttributes>
  implements SharedScheduleAttributes
{
  declare id: string;
  declare owner_id: string;
  declare shared_with_id: string;
  declare permission: SharePermission;
  declare start_date: Date | undefined;
  declare end_date: Date | undefined;
  declare created_at: Date | undefined;
  declare updated_at: Date | undefined;
}

SharedSchedule.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    owner_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    shared_with_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    permission: {
      type: DataTypes.ENUM("view", "edit"),
      allowNull: false,
      defaultValue: "view",
    },
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "shared_schedules",
    modelName: "SharedSchedule",
    indexes: [
      {
        unique: true,
        fields: ["owner_id", "shared_with_id"],
      },
    ],
  }
);

// 관계 설정
SharedSchedule.belongsTo(User, { foreignKey: "owner_id", as: "owner" });
SharedSchedule.belongsTo(User, {
  foreignKey: "shared_with_id",
  as: "shared_with",
});

export default SharedSchedule;

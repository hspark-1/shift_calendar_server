import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import User from "./User";

// 근무 타입 열거형
export enum ShiftType {
  DAY = "D",
  EVENING = "E",
  NIGHT = "N",
  OFF = "OFF",
}

interface ScheduleAttributes {
  id: string; // UUID
  user_id: string; // UUID
  date: Date;
  shift_type: ShiftType;
  note?: string;
  is_shared: boolean;
  created_at?: Date;
  updated_at?: Date;
}

interface ScheduleCreationAttributes
  extends Optional<
    ScheduleAttributes,
    "id" | "note" | "is_shared" | "created_at" | "updated_at"
  > {}

class Schedule
  extends Model<ScheduleAttributes, ScheduleCreationAttributes>
  implements ScheduleAttributes
{
  declare id: string;
  declare user_id: string;
  declare date: Date;
  declare shift_type: ShiftType;
  declare note: string | undefined;
  declare is_shared: boolean;
  declare created_at: Date | undefined;
  declare updated_at: Date | undefined;
}

Schedule.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    shift_type: {
      type: DataTypes.ENUM("D", "E", "N", "OFF"),
      allowNull: false,
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    is_shared: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: "schedules",
    modelName: "Schedule",
    indexes: [
      {
        unique: true,
        fields: ["user_id", "date"],
      },
    ],
  }
);

// 관계 설정
Schedule.belongsTo(User, { foreignKey: "user_id", as: "user" });
User.hasMany(Schedule, { foreignKey: "user_id", as: "schedules" });

export default Schedule;

import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import User from "./User";
import ShiftTypeSchedule from "./ShiftTypeSchedule";

interface WorkShiftAttributes {
  work_shift_id: string; // UUID
  owner_user_id: string; // UUID
  work_date: Date; // DATE 타입
  schedule_id: string; // UUID
  note?: string | null;
  visibility_level: number; // 항상 0
  created_by_user_id: string; // UUID
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
  deleted_by_user_id?: string | null; // UUID
}

interface WorkShiftCreationAttributes
  extends Optional<
    WorkShiftAttributes,
    | "work_shift_id"
    | "note"
    | "visibility_level"
    | "created_at"
    | "updated_at"
    | "deleted_at"
    | "deleted_by_user_id"
  > {}

class WorkShift
  extends Model<WorkShiftAttributes, WorkShiftCreationAttributes>
  implements WorkShiftAttributes
{
  declare work_shift_id: string;
  declare owner_user_id: string;
  declare work_date: Date;
  declare schedule_id: string;
  declare note: string | null | undefined;
  declare visibility_level: number;
  declare created_by_user_id: string;
  declare created_at: Date | undefined;
  declare updated_at: Date | undefined;
  declare deleted_at: Date | null | undefined;
  declare deleted_by_user_id: string | null | undefined;
}

WorkShift.init(
  {
    work_shift_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    owner_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    work_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    schedule_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "shift_type_schedules",
        key: "schedule_id",
      },
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    visibility_level: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      defaultValue: 0,
    },
    created_by_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "user_id",
      },
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
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deleted_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "users",
        key: "user_id",
      },
    },
  },
  {
    sequelize,
    tableName: "work_shifts",
    modelName: "WorkShift",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["owner_user_id", "work_date"],
      },
      {
        fields: ["owner_user_id", "work_date"],
        where: { deleted_at: null },
      },
    ],
  }
);

// 관계 설정
WorkShift.belongsTo(User, { foreignKey: "owner_user_id", as: "owner" });
User.hasMany(WorkShift, { foreignKey: "owner_user_id", as: "work_shifts" });

WorkShift.belongsTo(User, {
  foreignKey: "created_by_user_id",
  as: "created_by",
});
User.hasMany(WorkShift, {
  foreignKey: "created_by_user_id",
  as: "created_work_shifts",
});

WorkShift.belongsTo(User, {
  foreignKey: "deleted_by_user_id",
  as: "deleted_by",
});

WorkShift.belongsTo(ShiftTypeSchedule, {
  foreignKey: "schedule_id",
  as: "schedule",
});
ShiftTypeSchedule.hasMany(WorkShift, {
  foreignKey: "schedule_id",
  as: "work_shifts",
});

export default WorkShift;


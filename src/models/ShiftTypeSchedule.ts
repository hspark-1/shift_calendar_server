import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import ShiftType from "./ShiftType";
import ShiftTemplateVersion from "./ShiftTemplateVersion";

interface ShiftTypeScheduleAttributes {
  schedule_id: string; // UUID
  shift_type_id: string; // UUID
  template_version_id: string; // UUID
  start_time?: string | null; // TIME 타입 (HH:mm:ss)
  end_time?: string | null; // TIME 타입 (HH:mm:ss)
  crosses_midnight: boolean;
  duration_minutes: number;
  created_at?: Date;
}

interface ShiftTypeScheduleCreationAttributes
  extends Optional<
    ShiftTypeScheduleAttributes,
    | "schedule_id"
    | "start_time"
    | "end_time"
    | "crosses_midnight"
    | "duration_minutes"
    | "created_at"
  > {}

class ShiftTypeSchedule
  extends Model<
    ShiftTypeScheduleAttributes,
    ShiftTypeScheduleCreationAttributes
  >
  implements ShiftTypeScheduleAttributes
{
  declare schedule_id: string;
  declare shift_type_id: string;
  declare template_version_id: string;
  declare start_time: string | null | undefined;
  declare end_time: string | null | undefined;
  declare crosses_midnight: boolean;
  declare duration_minutes: number;
  declare created_at: Date | undefined;
}

ShiftTypeSchedule.init(
  {
    schedule_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    shift_type_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "shift_types",
        key: "shift_type_id",
      },
    },
    template_version_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "shift_template_versions",
        key: "template_version_id",
      },
    },
    start_time: {
      type: DataTypes.TIME,
      allowNull: true,
    },
    end_time: {
      type: DataTypes.TIME,
      allowNull: true,
    },
    crosses_midnight: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    duration_minutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0,
      },
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "shift_type_schedules",
    modelName: "ShiftTypeSchedule",
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ["template_version_id", "shift_type_id"],
      },
      {
        fields: ["template_version_id"],
      },
      {
        fields: ["shift_type_id"],
      },
    ],
    validate: {
      timeConsistency(this: ShiftTypeScheduleAttributes) {
        const has_start =
          this.start_time !== null && this.start_time !== undefined;
        const has_end = this.end_time !== null && this.end_time !== undefined;
        if (has_start !== has_end) {
          throw new Error(
            "start_time과 end_time은 둘 다 있거나 둘 다 없어야 합니다."
          );
        }
      },
    },
  }
);

// 관계 설정
ShiftTypeSchedule.belongsTo(ShiftType, {
  foreignKey: "shift_type_id",
  as: "shift_type",
});
ShiftType.hasMany(ShiftTypeSchedule, {
  foreignKey: "shift_type_id",
  as: "schedules",
});

ShiftTypeSchedule.belongsTo(ShiftTemplateVersion, {
  foreignKey: "template_version_id",
  as: "template_version",
});
ShiftTemplateVersion.hasMany(ShiftTypeSchedule, {
  foreignKey: "template_version_id",
  as: "schedules",
});

export default ShiftTypeSchedule;

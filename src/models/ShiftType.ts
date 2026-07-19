import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import ShiftTemplate from "./ShiftTemplate";

interface ShiftTypeAttributes {
  shift_type_id: string; // UUID
  template_id: string; // UUID
  code: string; // 예: 'D', 'E', 'N', 'OFF'
  name: string; // 예: '데이'
  color?: string | null; // 예: '#FFF5A623' (16진수 색상 문자열)
  base_color?: string | null; // 농도 적용 전 기준 색상
  color_intensity?: number; // 0~100 정수 퍼센트
  sort_order?: number | null;
  created_at?: Date;
  deleted_at?: Date | null;
}

interface ShiftTypeCreationAttributes
  extends Optional<
    ShiftTypeAttributes,
    | "shift_type_id"
    | "color"
    | "base_color"
    | "color_intensity"
    | "sort_order"
    | "created_at"
    | "deleted_at"
  > {}

class ShiftType
  extends Model<ShiftTypeAttributes, ShiftTypeCreationAttributes>
  implements ShiftTypeAttributes
{
  declare shift_type_id: string;
  declare template_id: string;
  declare code: string;
  declare name: string;
  declare color: string | null | undefined;
  declare base_color: string | null | undefined;
  declare color_intensity: number | undefined;
  declare sort_order: number | null | undefined;
  declare created_at: Date | undefined;
  declare deleted_at: Date | null | undefined;
}

ShiftType.init(
  {
    shift_type_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    template_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "shift_templates",
        key: "template_id",
      },
    },
    code: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    color: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    base_color: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    color_intensity: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      defaultValue: 100,
      validate: {
        min: 0,
        max: 100,
        isInt: true,
      },
    },
    sort_order: {
      type: DataTypes.SMALLINT,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "shift_types",
    modelName: "ShiftType",
    timestamps: false,
    indexes: [
      {
        fields: ["template_id"],
        where: { deleted_at: null },
      },
    ],
  }
);

// 관계 설정
ShiftType.belongsTo(ShiftTemplate, {
  foreignKey: "template_id",
  as: "template",
});
ShiftTemplate.hasMany(ShiftType, {
  foreignKey: "template_id",
  as: "shift_types",
});

export default ShiftType;

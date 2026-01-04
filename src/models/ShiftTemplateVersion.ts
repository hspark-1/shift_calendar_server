import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import ShiftTemplate from "./ShiftTemplate";
import User from "./User";

interface ShiftTemplateVersionAttributes {
  template_version_id: string; // UUID
  template_id: string; // UUID
  version_no: number;
  effective_from: Date; // DATE 타입
  created_by_user_id: string; // UUID
  created_at?: Date;
}

interface ShiftTemplateVersionCreationAttributes
  extends Optional<
    ShiftTemplateVersionAttributes,
    "template_version_id" | "created_at"
  > {}

class ShiftTemplateVersion
  extends Model<
    ShiftTemplateVersionAttributes,
    ShiftTemplateVersionCreationAttributes
  >
  implements ShiftTemplateVersionAttributes
{
  declare template_version_id: string;
  declare template_id: string;
  declare version_no: number;
  declare effective_from: Date;
  declare created_by_user_id: string;
  declare created_at: Date | undefined;
}

ShiftTemplateVersion.init(
  {
    template_version_id: {
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
    version_no: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
      },
    },
    effective_from: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW,
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
  },
  {
    sequelize,
    tableName: "shift_template_versions",
    modelName: "ShiftTemplateVersion",
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ["template_id", "version_no"],
      },
      {
        unique: true,
        fields: ["template_id", "effective_from"],
      },
      {
        fields: ["template_id", { name: "effective_from", order: "DESC" }],
      },
    ],
  }
);

// 관계 설정
ShiftTemplateVersion.belongsTo(ShiftTemplate, {
  foreignKey: "template_id",
  as: "template",
});
ShiftTemplate.hasMany(ShiftTemplateVersion, {
  foreignKey: "template_id",
  as: "versions",
});

ShiftTemplateVersion.belongsTo(User, {
  foreignKey: "created_by_user_id",
  as: "created_by",
});

export default ShiftTemplateVersion;

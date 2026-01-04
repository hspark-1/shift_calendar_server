import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import User from "./User";

interface ShiftTemplateAttributes {
  template_id: string; // UUID
  owner_user_id: string; // UUID
  name: string;
  created_at?: Date;
  deleted_at?: Date | null;
}

interface ShiftTemplateCreationAttributes
  extends Optional<
    ShiftTemplateAttributes,
    "template_id" | "created_at" | "deleted_at"
  > {}

class ShiftTemplate
  extends Model<ShiftTemplateAttributes, ShiftTemplateCreationAttributes>
  implements ShiftTemplateAttributes
{
  declare template_id: string;
  declare owner_user_id: string;
  declare name: string;
  declare created_at: Date | undefined;
  declare deleted_at: Date | null | undefined;
}

ShiftTemplate.init(
  {
    template_id: {
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
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
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
    tableName: "shift_templates",
    modelName: "ShiftTemplate",
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ["owner_user_id", "name"],
        where: { deleted_at: null },
      },
    ],
  }
);

// 관계 설정
ShiftTemplate.belongsTo(User, { foreignKey: "owner_user_id", as: "owner" });
User.hasMany(ShiftTemplate, {
  foreignKey: "owner_user_id",
  as: "shift_templates",
});

export default ShiftTemplate;

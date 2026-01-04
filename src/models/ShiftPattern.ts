import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import User from "./User";

interface ShiftPatternAttributes {
  id: string; // UUID
  user_id: string; // UUID
  name: string;
  pattern: string[]; // JSON array: ['D', 'D', 'E', 'E', 'N', 'N', 'OFF', 'OFF']
  is_default: boolean;
  created_at?: Date;
  updated_at?: Date;
}

interface ShiftPatternCreationAttributes
  extends Optional<
    ShiftPatternAttributes,
    "id" | "is_default" | "created_at" | "updated_at"
  > {}

class ShiftPattern
  extends Model<ShiftPatternAttributes, ShiftPatternCreationAttributes>
  implements ShiftPatternAttributes
{
  declare id: string;
  declare user_id: string;
  declare name: string;
  declare pattern: string[];
  declare is_default: boolean;
  declare created_at: Date | undefined;
  declare updated_at: Date | undefined;
}

ShiftPattern.init(
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
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    pattern: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: "shift_patterns",
    modelName: "ShiftPattern",
  }
);

// 관계 설정
ShiftPattern.belongsTo(User, { foreignKey: "user_id", as: "user" });
User.hasMany(ShiftPattern, { foreignKey: "user_id", as: "shift_patterns" });

export default ShiftPattern;

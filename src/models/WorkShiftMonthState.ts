import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

interface WorkShiftMonthStateAttributes {
  owner_user_id: string;
  year_month: string;
  revision: string;
  last_modified_at: Date;
}

interface WorkShiftMonthStateCreationAttributes
  extends Optional<WorkShiftMonthStateAttributes, "revision" | "last_modified_at"> {}

class WorkShiftMonthState
  extends Model<
    WorkShiftMonthStateAttributes,
    WorkShiftMonthStateCreationAttributes
  >
  implements WorkShiftMonthStateAttributes
{
  declare owner_user_id: string;
  declare year_month: string;
  declare revision: string;
  declare last_modified_at: Date;
}

WorkShiftMonthState.init(
  {
    owner_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      primaryKey: true,
      references: { model: "users", key: "user_id" },
    },
    year_month: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      primaryKey: true,
    },
    revision: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: "1",
    },
    last_modified_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "work_shift_month_states",
    modelName: "WorkShiftMonthState",
    timestamps: false,
  },
);

export default WorkShiftMonthState;

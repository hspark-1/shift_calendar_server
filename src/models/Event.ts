import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import User from "./User";

interface EventAttributes {
  event_id: string; // UUID
  owner_user_id: string; // UUID
  created_by_user_id: string; // UUID
  title: string;
  memo?: string | null;
  place?: string | null;
  all_day: boolean;
  start_at: Date; // timestamptz
  end_at: Date; // timestamptz
  visibility_level: number; // 0 이상
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
  deleted_by_user_id?: string | null; // UUID
}

interface EventCreationAttributes
  extends Optional<
    EventAttributes,
    | "event_id"
    | "memo"
    | "place"
    | "all_day"
    | "visibility_level"
    | "created_at"
    | "updated_at"
    | "deleted_at"
    | "deleted_by_user_id"
  > {}

class Event
  extends Model<EventAttributes, EventCreationAttributes>
  implements EventAttributes
{
  declare event_id: string;
  declare owner_user_id: string;
  declare created_by_user_id: string;
  declare title: string;
  declare memo: string | null | undefined;
  declare place: string | null | undefined;
  declare all_day: boolean;
  declare start_at: Date;
  declare end_at: Date;
  declare visibility_level: number;
  declare created_at: Date | undefined;
  declare updated_at: Date | undefined;
  declare deleted_at: Date | null | undefined;
  declare deleted_by_user_id: string | null | undefined;
}

Event.init(
  {
    event_id: {
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
    created_by_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    title: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    memo: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    place: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    all_day: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    start_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    end_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    visibility_level: {
      type: DataTypes.SMALLINT,
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
    tableName: "events",
    modelName: "Event",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ["owner_user_id", "start_at"],
        where: { deleted_at: null },
      },
      {
        fields: ["owner_user_id", "visibility_level", "start_at"],
        where: { deleted_at: null },
      },
    ],
    validate: {
      timeConsistency(this: EventAttributes) {
        if (this.start_at >= this.end_at) {
          throw new Error("start_at은 end_at보다 이전이어야 합니다.");
        }
      },
    },
  }
);

// 관계 설정
Event.belongsTo(User, { foreignKey: "owner_user_id", as: "owner" });
User.hasMany(Event, { foreignKey: "owner_user_id", as: "events" });

Event.belongsTo(User, {
  foreignKey: "created_by_user_id",
  as: "created_by",
});
User.hasMany(Event, {
  foreignKey: "created_by_user_id",
  as: "created_events",
});

Event.belongsTo(User, {
  foreignKey: "deleted_by_user_id",
  as: "deleted_by",
});

export default Event;


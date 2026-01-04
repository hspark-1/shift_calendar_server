import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import User from "./User";

interface FriendLevelSettingAttributes {
  owner_user_id: string; // 설정 소유자 (내 캘린더를 공유하는 주체)
  friend_user_id: string; // 친구 (내 캘린더를 볼 수 있는 대상)
  can_view: boolean; // 내 캘린더 열람 허용 여부
  friend_level: number; // 친구 레벨 (0~5)
  created_at?: Date;
  updated_at?: Date;
}

interface FriendLevelSettingCreationAttributes
  extends Optional<
    FriendLevelSettingAttributes,
    "can_view" | "friend_level" | "created_at" | "updated_at"
  > {}

class FriendLevelSetting
  extends Model<
    FriendLevelSettingAttributes,
    FriendLevelSettingCreationAttributes
  >
  implements FriendLevelSettingAttributes
{
  declare owner_user_id: string;
  declare friend_user_id: string;
  declare can_view: boolean;
  declare friend_level: number;
  declare created_at: Date | undefined;
  declare updated_at: Date | undefined;

  // 연관 관계 타입
  declare owner?: User;
  declare friend?: User;
}

FriendLevelSetting.init(
  {
    owner_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      primaryKey: true,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    friend_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      primaryKey: true,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    can_view: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    friend_level: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0,
        max: 5,
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
  },
  {
    sequelize,
    tableName: "friend_level_settings",
    modelName: "FriendLevelSetting",
    timestamps: false, // 수동으로 updated_at 관리
    indexes: [
      {
        fields: ["owner_user_id"],
        name: "idx_fls_owner",
      },
      {
        fields: ["owner_user_id", "can_view", "friend_level"],
        name: "idx_fls_owner_can_view_level",
      },
    ],
    validate: {
      notSelf(this: FriendLevelSetting) {
        if (this.owner_user_id === this.friend_user_id) {
          throw new Error("owner_user_id와 friend_user_id는 같을 수 없습니다.");
        }
      },
    },
  }
);

// 연관 관계 설정
FriendLevelSetting.belongsTo(User, {
  foreignKey: "owner_user_id",
  as: "owner",
});

FriendLevelSetting.belongsTo(User, {
  foreignKey: "friend_user_id",
  as: "friend",
});

export default FriendLevelSetting;


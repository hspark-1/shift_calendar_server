import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import User from "./User";

interface FriendshipAttributes {
  user_id_a: string; // UUID (항상 user_id_a < user_id_b)
  user_id_b: string; // UUID
  created_at?: Date;
}

interface FriendshipCreationAttributes
  extends Optional<FriendshipAttributes, "created_at"> {}

class Friendship
  extends Model<FriendshipAttributes, FriendshipCreationAttributes>
  implements FriendshipAttributes
{
  declare user_id_a: string;
  declare user_id_b: string;
  declare created_at: Date | undefined;

  // 연관 관계 타입
  declare user_a?: User;
  declare user_b?: User;

  /**
   * 두 사용자 ID를 정렬하여 user_id_a < user_id_b 규칙에 맞게 반환
   */
  static sortUserIds(
    user_id_1: string,
    user_id_2: string
  ): { user_id_a: string; user_id_b: string } {
    if (user_id_1 < user_id_2) {
      return { user_id_a: user_id_1, user_id_b: user_id_2 };
    }
    return { user_id_a: user_id_2, user_id_b: user_id_1 };
  }
}

Friendship.init(
  {
    user_id_a: {
      type: DataTypes.UUID,
      allowNull: false,
      primaryKey: true,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    user_id_b: {
      type: DataTypes.UUID,
      allowNull: false,
      primaryKey: true,
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
    tableName: "friendships",
    modelName: "Friendship",
    timestamps: false,
    indexes: [
      {
        fields: ["user_id_a"],
        name: "idx_friendships_user_a",
      },
      {
        fields: ["user_id_b"],
        name: "idx_friendships_user_b",
      },
    ],
    validate: {
      orderCheck(this: Friendship) {
        if (this.user_id_a >= this.user_id_b) {
          throw new Error("user_id_a must be less than user_id_b");
        }
      },
    },
  }
);

// 연관 관계 설정
Friendship.belongsTo(User, {
  foreignKey: "user_id_a",
  as: "user_a",
});

Friendship.belongsTo(User, {
  foreignKey: "user_id_b",
  as: "user_b",
});

export default Friendship;

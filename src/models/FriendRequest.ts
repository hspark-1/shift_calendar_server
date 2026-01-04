import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import User from "./User";

// 친구 요청 상태
export type FriendRequestStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "CANCELED";

interface FriendRequestAttributes {
  request_id: string; // UUID
  requester_user_id: string; // 요청 보낸 사용자
  addressee_user_id: string; // 요청 받은 사용자
  status: FriendRequestStatus;
  message?: string | null;
  created_at?: Date;
  responded_at?: Date | null;
}

interface FriendRequestCreationAttributes
  extends Optional<
    FriendRequestAttributes,
    "request_id" | "status" | "message" | "created_at" | "responded_at"
  > {}

class FriendRequest
  extends Model<FriendRequestAttributes, FriendRequestCreationAttributes>
  implements FriendRequestAttributes
{
  declare request_id: string;
  declare requester_user_id: string;
  declare addressee_user_id: string;
  declare status: FriendRequestStatus;
  declare message: string | null | undefined;
  declare created_at: Date | undefined;
  declare responded_at: Date | null | undefined;

  // 연관 관계 타입
  declare requester?: User;
  declare addressee?: User;
}

FriendRequest.init(
  {
    request_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    requester_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    addressee_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "PENDING",
      validate: {
        isIn: [["PENDING", "ACCEPTED", "REJECTED", "CANCELED"]],
      },
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    responded_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "friend_requests",
    modelName: "FriendRequest",
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ["requester_user_id", "addressee_user_id"],
        where: { status: "PENDING" },
        name: "uq_friend_requests_pending_pair",
      },
      {
        fields: ["addressee_user_id", "status", "created_at"],
        name: "idx_friend_requests_addressee_status",
      },
      {
        fields: ["requester_user_id", "status", "created_at"],
        name: "idx_friend_requests_requester_status",
      },
    ],
    validate: {
      notSelf(this: FriendRequest) {
        if (this.requester_user_id === this.addressee_user_id) {
          throw new Error("자기 자신에게 친구 요청을 보낼 수 없습니다.");
        }
      },
    },
  }
);

// 연관 관계 설정
FriendRequest.belongsTo(User, {
  foreignKey: "requester_user_id",
  as: "requester",
});

FriendRequest.belongsTo(User, {
  foreignKey: "addressee_user_id",
  as: "addressee",
});

export default FriendRequest;


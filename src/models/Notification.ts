import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import User from "./User";

// 알림 타입 (확장 가능)
// 예시: FRIEND_REQUEST, FRIEND_ACCEPTED, FRIEND_REJECTED, SCHEDULE_SHARED, SYSTEM, GENERAL 등
export type NotificationType = string;

// 알림 액션 타입
export interface NotificationAction {
  type: string; // 액션 타입 (accept, reject, navigate, dismiss 등)
  label: string; // 버튼 라벨
  route?: string; // 네비게이션 경로 (navigate 타입일 때)
}

// 알림 페이로드 타입
export interface NotificationPayload {
  related_user_id?: string; // 관련 사용자 ID
  request_id?: string; // 친구 요청 ID
  user_name?: string; // 사용자 이름
  profile_image_url?: string | null; // 프로필 이미지 URL
  [key: string]: unknown; // 추가 데이터
}

interface NotificationAttributes {
  notification_id: string; // UUID
  user_id: string; // 알림 수신자
  notification_type: NotificationType;
  title: string;
  body?: string | null;
  payload: NotificationPayload;
  actions: NotificationAction[];
  is_read: boolean;
  read_at?: Date | null;
  created_at?: Date;
}

interface NotificationCreationAttributes
  extends Optional<
    NotificationAttributes,
    | "notification_id"
    | "body"
    | "payload"
    | "actions"
    | "is_read"
    | "read_at"
    | "created_at"
  > {}

class Notification
  extends Model<NotificationAttributes, NotificationCreationAttributes>
  implements NotificationAttributes
{
  declare notification_id: string;
  declare user_id: string;
  declare notification_type: NotificationType;
  declare title: string;
  declare body: string | null | undefined;
  declare payload: NotificationPayload;
  declare actions: NotificationAction[];
  declare is_read: boolean;
  declare read_at: Date | null | undefined;
  declare created_at: Date | undefined;

  // 연관 관계 타입
  declare user?: User;
}

Notification.init(
  {
    notification_id: {
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
    notification_type: {
      type: DataTypes.TEXT,
      allowNull: false,
      // 확장성을 위해 타입 제약 없음
    },
    title: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    actions: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    is_read: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    read_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "notifications",
    modelName: "Notification",
    timestamps: false,
    indexes: [
      {
        fields: [
          { name: "user_id", order: "ASC" },
          { name: "created_at", order: "DESC" },
        ],
        name: "idx_notifications_user_created",
      },
      {
        fields: [
          { name: "notification_type", order: "ASC" },
          { name: "created_at", order: "DESC" },
        ],
        name: "idx_notifications_type",
      },
    ],
  }
);

// 연관 관계 설정
Notification.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

export default Notification;

import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";

export type DevicePlatform = "ANDROID" | "IOS";
export type PushAppEnvironment = "STAGE" | "PROD";
export type PushTargetType = "FCM_TOKEN" | "FID";

interface UserDeviceAttributes {
  device_id: string;
  installation_id: string;
  user_id: string | null;
  platform: DevicePlatform;
  provider: "FCM";
  provider_target: string | null;
  target_type: PushTargetType;
  push_permission_enabled: boolean;
  is_active: boolean;
  app_environment: PushAppEnvironment;
  app_version: string | null;
  last_seen_at: Date;
  target_updated_at: Date | null;
  disabled_reason: string | null;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface UserDeviceCreationAttributes
  extends Optional<
    UserDeviceAttributes,
    | "device_id"
    | "user_id"
    | "provider"
    | "provider_target"
    | "target_type"
    | "push_permission_enabled"
    | "is_active"
    | "app_version"
    | "last_seen_at"
    | "target_updated_at"
    | "disabled_reason"
    | "disabled_at"
    | "created_at"
    | "updated_at"
  > {}

class UserDevice
  extends Model<UserDeviceAttributes, UserDeviceCreationAttributes>
  implements UserDeviceAttributes
{
  declare device_id: string;
  declare installation_id: string;
  declare user_id: string | null;
  declare platform: DevicePlatform;
  declare provider: "FCM";
  declare provider_target: string | null;
  declare target_type: PushTargetType;
  declare push_permission_enabled: boolean;
  declare is_active: boolean;
  declare app_environment: PushAppEnvironment;
  declare app_version: string | null;
  declare last_seen_at: Date;
  declare target_updated_at: Date | null;
  declare disabled_reason: string | null;
  declare disabled_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}

UserDevice.init(
  {
    device_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    installation_id: { type: DataTypes.UUID, allowNull: false },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "users", key: "user_id" },
      onDelete: "CASCADE",
    },
    platform: { type: DataTypes.TEXT, allowNull: false },
    provider: { type: DataTypes.TEXT, allowNull: false, defaultValue: "FCM" },
    provider_target: { type: DataTypes.TEXT, allowNull: true },
    target_type: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "FCM_TOKEN",
    },
    push_permission_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    app_environment: { type: DataTypes.TEXT, allowNull: false },
    app_version: { type: DataTypes.TEXT, allowNull: true },
    last_seen_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    target_updated_at: { type: DataTypes.DATE, allowNull: true },
    disabled_reason: { type: DataTypes.TEXT, allowNull: true },
    disabled_at: { type: DataTypes.DATE, allowNull: true },
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
    tableName: "user_devices",
    modelName: "UserDevice",
    timestamps: false,
  },
);

export default UserDevice;

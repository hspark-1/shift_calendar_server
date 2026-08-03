import crypto from "crypto";
import { QueryTypes, Transaction } from "sequelize";
import { sequelize } from "../config/database";
import { getPushAppEnvironment } from "../config/push";
import { DevicePlatform, UserDevice } from "../models";

export interface UpsertCurrentDeviceInput {
  installation_id: string;
  platform: DevicePlatform;
  provider_target: string | null;
  push_permission_enabled: boolean;
  app_version: string;
}

function hashLockValue(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function acquireDeviceLock(
  lock_key: string,
  transaction: Transaction,
): Promise<void> {
  await sequelize.query(
    "SELECT pg_advisory_xact_lock(hashtext(:lock_key))",
    {
      replacements: { lock_key },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
}

export async function upsertCurrentDevice(
  user_id: string,
  input: UpsertCurrentDeviceInput,
): Promise<UserDevice> {
  const app_environment = getPushAppEnvironment();
  const normalized_target =
    input.push_permission_enabled && input.provider_target
      ? input.provider_target.trim()
      : null;

  return sequelize.transaction(async (transaction) => {
    await acquireDeviceLock(
      `shiftmate:device:${app_environment}:${input.installation_id}`,
      transaction,
    );
    if (normalized_target) {
      await acquireDeviceLock(
        `shiftmate:push-target:${app_environment}:${hashLockValue(normalized_target)}`,
        transaction,
      );
    }

    let device = await UserDevice.findOne({
      where: {
        app_environment,
        installation_id: input.installation_id,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (normalized_target) {
      const conflicting_device = await UserDevice.findOne({
        where: {
          app_environment,
          provider: "FCM",
          provider_target: normalized_target,
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (conflicting_device && conflicting_device.device_id !== device?.device_id) {
        const disabled_at = new Date();
        await conflicting_device.update(
          {
            provider_target: null,
            is_active: false,
            disabled_reason: "TARGET_REASSIGNED",
            disabled_at,
            target_updated_at: disabled_at,
            updated_at: disabled_at,
          },
          { transaction },
        );
      }
    }

    const now = new Date();
    const target_changed = device?.provider_target !== normalized_target;
    const is_active = Boolean(
      input.push_permission_enabled && normalized_target,
    );
    const values = {
      user_id,
      platform: input.platform,
      provider: "FCM" as const,
      provider_target: normalized_target,
      target_type: "FCM_TOKEN" as const,
      push_permission_enabled: input.push_permission_enabled,
      is_active,
      app_version: input.app_version,
      last_seen_at: now,
      target_updated_at: target_changed
        ? now
        : device?.target_updated_at ?? null,
      disabled_reason: is_active
        ? null
        : input.push_permission_enabled
          ? "TARGET_UNAVAILABLE"
          : "PERMISSION_DISABLED",
      disabled_at: is_active ? null : now,
      updated_at: now,
    };

    if (device) {
      await device.update(values, { transaction });
      return device;
    }

    device = await UserDevice.create(
      {
        installation_id: input.installation_id,
        app_environment,
        ...values,
        created_at: now,
      },
      { transaction },
    );
    return device;
  });
}

export async function unbindDeviceForLogout(
  user_id: string,
  installation_id: string,
  transaction: Transaction,
): Promise<number> {
  const now = new Date();
  const [affected_count] = await UserDevice.update(
    {
      user_id: null,
      provider_target: null,
      push_permission_enabled: false,
      is_active: false,
      target_updated_at: now,
      disabled_reason: "LOGOUT",
      disabled_at: now,
      updated_at: now,
    },
    {
      where: {
        user_id,
        installation_id,
        app_environment: getPushAppEnvironment(),
      },
      transaction,
    },
  );
  return affected_count;
}

export async function unbindAllUserDevices(
  user_id: string,
  transaction: Transaction,
): Promise<number> {
  const now = new Date();
  const [affected_count] = await UserDevice.update(
    {
      user_id: null,
      provider_target: null,
      push_permission_enabled: false,
      is_active: false,
      target_updated_at: now,
      disabled_reason: "LOGOUT_ALL",
      disabled_at: now,
      updated_at: now,
    },
    { where: { user_id }, transaction },
  );
  return affected_count;
}

export async function disableDeviceTarget(
  device_id: string,
  reason: string,
): Promise<void> {
  const now = new Date();
  await UserDevice.update(
    {
      provider_target: null,
      is_active: false,
      target_updated_at: now,
      disabled_reason: reason,
      disabled_at: now,
      updated_at: now,
    },
    { where: { device_id } },
  );
}

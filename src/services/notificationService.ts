import { Op, Transaction } from "sequelize";
import {
  Notification,
  NotificationAction,
  NotificationPayload,
  PushJob,
} from "../models";
import {
  getPushJobTtlSeconds,
  isPushJobEnqueueEnabled,
} from "../config/push";

const push_notification_types = new Set([
  "FRIEND_REQUEST",
  "FRIEND_ACCEPTED",
  "FRIEND_REJECTED",
  "GROUP_INVITATION",
  "GROUP_INVITATION_ACCEPTED",
  "GROUP_INVITATION_REJECTED",
]);

interface CreateNotificationInput {
  user_id: string;
  notification_type: string;
  title: string;
  body?: string | null;
  payload?: NotificationPayload;
  actions?: NotificationAction[];
}

export async function createNotificationWithPushJob(
  input: CreateNotificationInput,
  transaction: Transaction,
): Promise<Notification> {
  const notification = await Notification.create(
    {
      user_id: input.user_id,
      notification_type: input.notification_type,
      title: input.title,
      body: input.body ?? null,
      payload: input.payload ?? {},
      actions: input.actions ?? [],
    },
    { transaction },
  );

  if (
    !isPushJobEnqueueEnabled() ||
    !push_notification_types.has(input.notification_type)
  ) {
    return notification;
  }

  const now = new Date();
  const expires_at = new Date(
    now.getTime() + getPushJobTtlSeconds() * 1000,
  );
  await PushJob.create(
    {
      notification_id: notification.notification_id,
      receiver_user_id: input.user_id,
      title: input.title,
      body: input.body ?? null,
      data_payload: {
        schema_version: "1",
        notification_id: notification.notification_id,
        notification_type: input.notification_type,
        destination: "NOTIFICATIONS",
      },
      expires_at,
    },
    { transaction },
  );

  return notification;
}

export async function cancelPendingPushForNotification(
  notification_id: string,
  reason: string,
  transaction: Transaction,
): Promise<void> {
  const now = new Date();
  await PushJob.update(
    {
      status: "CANCELED",
      cancel_requested_at: now,
      cancellation_reason: reason,
      completed_at: now,
      locked_by: null,
      lease_until: null,
      updated_at: now,
    },
    {
      where: {
        notification_id,
        status: { [Op.in]: ["PENDING", "RETRY"] },
      },
      transaction,
    },
  );

  await PushJob.update(
    {
      cancel_requested_at: now,
      cancellation_reason: reason,
      updated_at: now,
    },
    {
      where: { notification_id, status: "PROCESSING" },
      transaction,
    },
  );
}

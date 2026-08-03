import {
  Op,
  QueryTypes,
  Transaction,
  UniqueConstraintError,
} from "sequelize";
import { sequelize } from "../config/database";
import {
  getPositiveIntegerEnvironmentVariable,
} from "../config/environment";
import {
  Friendship,
  Group,
  GroupInvitation,
  GroupInvitationStatus,
  GroupMember,
  GroupRole,
  Notification,
  User,
} from "../models";
import type {
  CalendarAccess,
  GroupCalendarEvent,
  GroupCalendarRange,
  GroupCalendarWorkShift,
  GroupDetail,
  GroupInvitationApiModel,
  GroupInvitationSummary,
  GroupMemberSummary,
  GroupSummary,
  GroupUserSummary,
  Pagination,
} from "../types/group";
import {
  formatDbDate,
  formatDbTime,
  formatShiftTypeColor,
  toUtcIso,
} from "../utils/calendarSerialization";
import {
  cancelPendingPushForNotification,
  createNotificationWithPushJob,
} from "./notificationService";

export const GroupErrorCodes = {
  INVALID_GROUP_NAME: "INVALID_GROUP_NAME",
  INVALID_GROUP_TIMEZONE: "INVALID_GROUP_TIMEZONE",
  INVALID_DATE_RANGE: "INVALID_DATE_RANGE",
  GROUP_CALENDAR_RANGE_TOO_LARGE: "GROUP_CALENDAR_RANGE_TOO_LARGE",
  INVALID_GROUP_INVITATION_ACTION: "INVALID_GROUP_INVITATION_ACTION",
  INVALID_GROUP_MEMBER_ROLE: "INVALID_GROUP_MEMBER_ROLE",
  GROUP_PERMISSION_DENIED: "GROUP_PERMISSION_DENIED",
  GROUP_NOT_FOUND: "GROUP_NOT_FOUND",
  GROUP_MEMBER_NOT_FOUND: "GROUP_MEMBER_NOT_FOUND",
  GROUP_INVITATION_NOT_FOUND: "GROUP_INVITATION_NOT_FOUND",
  GROUP_MEMBER_ALREADY_EXISTS: "GROUP_MEMBER_ALREADY_EXISTS",
  GROUP_INVITATION_ALREADY_PENDING: "GROUP_INVITATION_ALREADY_PENDING",
  GROUP_INVITATION_ALREADY_PROCESSED: "GROUP_INVITATION_ALREADY_PROCESSED",
  GROUP_INVITATION_EXPIRED: "GROUP_INVITATION_EXPIRED",
  GROUP_INVITEE_NOT_FRIEND: "GROUP_INVITEE_NOT_FRIEND",
  GROUP_MEMBER_LIMIT_REACHED: "GROUP_MEMBER_LIMIT_REACHED",
  GROUP_OWNER_CANNOT_LEAVE: "GROUP_OWNER_CANNOT_LEAVE",
  GROUP_OWNER_CANNOT_BE_REMOVED: "GROUP_OWNER_CANNOT_BE_REMOVED",
  INVALID_GROUP_OWNER_TRANSFER: "INVALID_GROUP_OWNER_TRANSFER",
} as const;

type GroupErrorCode =
  (typeof GroupErrorCodes)[keyof typeof GroupErrorCodes];

const date_pattern = /^\d{4}-\d{2}-\d{2}$/;
const invitation_statuses: GroupInvitationStatus[] = [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "CANCELED",
  "EXPIRED",
];

function groupError(code: GroupErrorCode): Error {
  return new Error(code);
}

export function normalizeGroupName(value: unknown): string {
  if (typeof value !== "string") {
    throw groupError(GroupErrorCodes.INVALID_GROUP_NAME);
  }
  const name = value.trim();
  const name_length = Array.from(name).length;
  if (name_length < 1 || name_length > 50) {
    throw groupError(GroupErrorCodes.INVALID_GROUP_NAME);
  }
  return name;
}

export function isValidIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function normalizeGroupTimezone(value: unknown): string {
  if (!isValidIanaTimezone(value)) {
    throw groupError(GroupErrorCodes.INVALID_GROUP_TIMEZONE);
  }
  return value.trim();
}

function parseDate(value: string): Date | null {
  if (!date_pattern.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function getInclusiveDateRangeDays(
  start_date: string,
  end_date: string,
): number {
  const parsed_start = parseDate(start_date);
  const parsed_end = parseDate(end_date);
  if (!parsed_start || !parsed_end || parsed_start > parsed_end) {
    throw groupError(GroupErrorCodes.INVALID_DATE_RANGE);
  }
  return (
    Math.floor(
      (parsed_end.getTime() - parsed_start.getTime()) / (24 * 60 * 60 * 1000),
    ) + 1
  );
}

export type GroupPermissionAction =
  | "VIEW"
  | "UPDATE"
  | "INVITE"
  | "DELETE"
  | "CHANGE_ROLE"
  | "REMOVE_MEMBER"
  | "TRANSFER_OWNER";

export function hasGroupPermission(
  role: GroupRole,
  action: GroupPermissionAction,
  target_role?: GroupRole,
): boolean {
  if (action === "VIEW") return true;
  if (action === "UPDATE" || action === "INVITE") {
    return role === "OWNER" || role === "ADMIN";
  }
  if (action === "DELETE" || action === "CHANGE_ROLE" || action === "TRANSFER_OWNER") {
    return role === "OWNER";
  }
  if (action === "REMOVE_MEMBER") {
    return (
      role === "OWNER" ||
      (role === "ADMIN" && target_role === "MEMBER")
    );
  }
  return false;
}

function assertPermission(
  role: GroupRole,
  action: GroupPermissionAction,
  target_role?: GroupRole,
): void {
  if (!hasGroupPermission(role, action, target_role)) {
    throw groupError(GroupErrorCodes.GROUP_PERMISSION_DENIED);
  }
}

function getMemberLimit(): number {
  return getPositiveIntegerEnvironmentVariable("GROUP_MEMBER_LIMIT", 20);
}

function getInvitationTtlDays(): number {
  return getPositiveIntegerEnvironmentVariable(
    "GROUP_INVITATION_TTL_DAYS",
    7,
  );
}

function getCalendarMaxRangeDays(): number {
  return getPositiveIntegerEnvironmentVariable(
    "GROUP_CALENDAR_MAX_RANGE_DAYS",
    100,
  );
}

interface LockedGroupContext {
  group: Group;
  actor_member: GroupMember;
}

async function lockGroupForActor(
  group_id: string,
  actor_user_id: string,
  transaction: Transaction,
): Promise<LockedGroupContext> {
  const group = await Group.findOne({
    where: { group_id, deleted_at: null },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!group) {
    throw groupError(GroupErrorCodes.GROUP_NOT_FOUND);
  }

  const actor_member = await GroupMember.findOne({
    where: { group_id, user_id: actor_user_id, removed_at: null },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!actor_member) {
    throw groupError(GroupErrorCodes.GROUP_NOT_FOUND);
  }
  return { group, actor_member };
}

async function touchGroup(
  group: Group,
  now: Date,
  transaction: Transaction,
): Promise<void> {
  group.updated_at = now;
  await group.save({ transaction });
}

async function areAllFriends(
  user_id: string,
  other_user_ids: string[],
  transaction: Transaction,
): Promise<boolean> {
  if (other_user_ids.length === 0) return true;
  const unique_ids = [...new Set(other_user_ids)];
  if (unique_ids.includes(user_id)) return false;

  const rows = await sequelize.query<{ user_id: string }>(
    `
      SELECT u.user_id
      FROM users u
      WHERE u.user_id IN (:other_user_ids)
        AND EXISTS (
          SELECT 1
          FROM friendships f
          WHERE f.user_id_a = LEAST(:user_id::uuid, u.user_id)
            AND f.user_id_b = GREATEST(:user_id::uuid, u.user_id)
        )
    `,
    {
      replacements: { user_id, other_user_ids: unique_ids },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  return rows.length === unique_ids.length;
}

async function updateInvitationNotification(
  invitation_id: string,
  status: GroupInvitationStatus,
  now: Date,
  transaction: Transaction,
): Promise<Notification | null> {
  const notification_rows = await sequelize.query<{ notification_id: string }>(
    `
      SELECT notification_id
      FROM notifications
      WHERE payload->>'invitation_id' = :invitation_id
        AND notification_type IN (
          'GROUP_INVITATION',
          'GROUP_INVITATION_ACCEPTED',
          'GROUP_INVITATION_REJECTED',
          'GROUP_INVITATION_CANCELED'
        )
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE
    `,
    {
      replacements: { invitation_id },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  if (notification_rows.length === 0) return null;

  const notification = await Notification.findByPk(
    notification_rows[0].notification_id,
    { transaction, lock: transaction.LOCK.UPDATE },
  );
  if (!notification) return null;

  await cancelPendingPushForNotification(
    notification.notification_id,
    `GROUP_INVITATION_${status}`,
    transaction,
  );

  notification.notification_type =
    status === "EXPIRED" ? "GROUP_INVITATION" : `GROUP_INVITATION_${status}`;
  notification.payload = {
    ...notification.payload,
    invitation_status: status,
  };
  notification.actions = [];
  notification.is_read = true;
  notification.read_at = notification.read_at ?? now;
  await notification.save({ transaction });
  return notification;
}

async function createInvitationNotification(
  invitation: GroupInvitation,
  group: Group,
  inviter: User,
  transaction: Transaction,
): Promise<void> {
  await createNotificationWithPushJob(
    {
      user_id: invitation.invitee_user_id,
      notification_type: "GROUP_INVITATION",
      title: "그룹 초대",
      body: `${inviter.name}님이 ${group.name} 그룹에 초대했습니다.`,
      payload: {
        invitation_id: invitation.invitation_id,
        group_id: group.group_id,
        group_name: group.name,
        inviter_user_id: inviter.user_id,
        inviter_name: inviter.name,
        profile_image_url: inviter.profile_image_url ?? null,
        invitation_status: "PENDING",
        expires_at: invitation.expires_at.toISOString(),
      },
      actions: [
        { type: "accept", label: "수락" },
        { type: "reject", label: "거절" },
      ],
    },
    transaction,
  );
}

async function createInvitationResultNotification(
  invitation: GroupInvitation,
  invitee: User,
  status: "ACCEPTED" | "REJECTED",
  transaction: Transaction,
): Promise<void> {
  const accepted = status === "ACCEPTED";
  await createNotificationWithPushJob(
    {
      user_id: invitation.inviter_user_id,
      notification_type: `GROUP_INVITATION_${status}`,
      title: accepted ? "그룹 초대 수락" : "그룹 초대 거절",
      body: accepted
        ? `${invitee.name}님이 그룹 초대를 수락했습니다.`
        : `${invitee.name}님이 그룹 초대를 거절했습니다.`,
      payload: {
        invitation_id: invitation.invitation_id,
        group_id: invitation.group_id,
        related_user_id: invitee.user_id,
        user_name: invitee.name,
        profile_image_url: invitee.profile_image_url ?? null,
        invitation_status: status,
      },
      actions: [],
    },
    transaction,
  );
}

async function expireInvitation(
  invitation: GroupInvitation,
  now: Date,
  transaction: Transaction,
): Promise<void> {
  if (
    invitation.status !== "PENDING" ||
    invitation.expires_at.getTime() > now.getTime()
  ) {
    return;
  }
  invitation.status = "EXPIRED";
  invitation.updated_at = now;
  invitation.responded_at = now;
  await invitation.save({ transaction });
  await updateInvitationNotification(
    invitation.invitation_id,
    "EXPIRED",
    now,
    transaction,
  );
}

async function expirePendingInvitations(
  where: { invitee_user_id?: string; group_id?: string },
  transaction: Transaction,
): Promise<void> {
  const now = new Date();
  const invitations = await GroupInvitation.findAll({
    where: {
      ...where,
      status: "PENDING",
      expires_at: { [Op.lte]: now },
    },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  for (const invitation of invitations) {
    await expireInvitation(invitation, now, transaction);
  }
}

async function createInvitations(
  group: Group,
  inviter: User,
  invitee_user_ids: string[],
  message: string | null,
  transaction: Transaction,
): Promise<GroupInvitation[]> {
  const unique_invitee_ids = [...new Set(invitee_user_ids)];
  if (unique_invitee_ids.length !== invitee_user_ids.length) {
    throw groupError(GroupErrorCodes.GROUP_INVITATION_ALREADY_PENDING);
  }
  if (unique_invitee_ids.length === 0) return [];

  await expirePendingInvitations({ group_id: group.group_id }, transaction);

  const active_member_count = await GroupMember.count({
    where: { group_id: group.group_id, removed_at: null },
    transaction,
  });
  const active_invitee_count = await GroupMember.count({
    where: {
      group_id: group.group_id,
      user_id: { [Op.in]: unique_invitee_ids },
      removed_at: null,
    },
    transaction,
  });
  if (active_invitee_count > 0) {
    throw groupError(GroupErrorCodes.GROUP_MEMBER_ALREADY_EXISTS);
  }
  if (active_member_count >= getMemberLimit()) {
    throw groupError(GroupErrorCodes.GROUP_MEMBER_LIMIT_REACHED);
  }

  const pending_count = await GroupInvitation.count({
    where: {
      group_id: group.group_id,
      invitee_user_id: { [Op.in]: unique_invitee_ids },
      status: "PENDING",
    },
    transaction,
  });
  if (pending_count > 0) {
    throw groupError(GroupErrorCodes.GROUP_INVITATION_ALREADY_PENDING);
  }
  if (
    !(await areAllFriends(
      inviter.user_id,
      unique_invitee_ids,
      transaction,
    ))
  ) {
    throw groupError(GroupErrorCodes.GROUP_INVITEE_NOT_FRIEND);
  }

  const now = new Date();
  const expires_at = new Date(
    now.getTime() + getInvitationTtlDays() * 24 * 60 * 60 * 1000,
  );
  const invitations: GroupInvitation[] = [];
  for (const invitee_user_id of unique_invitee_ids) {
    try {
      const invitation = await GroupInvitation.create(
        {
          group_id: group.group_id,
          inviter_user_id: inviter.user_id,
          invitee_user_id,
          status: "PENDING",
          message,
          expires_at,
          created_at: now,
          updated_at: now,
        },
        { transaction },
      );
      await createInvitationNotification(
        invitation,
        group,
        inviter,
        transaction,
      );
      invitations.push(invitation);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw groupError(GroupErrorCodes.GROUP_INVITATION_ALREADY_PENDING);
      }
      throw error;
    }
  }
  return invitations;
}

function toInvitationSummary(
  invitation: GroupInvitation,
): GroupInvitationSummary {
  return {
    invitation_id: invitation.invitation_id,
    invitee_user_id: invitation.invitee_user_id,
    status: invitation.status,
    expires_at: invitation.expires_at.toISOString(),
  };
}

interface GroupDetailHeaderRow {
  group_id: string;
  name: string;
  timezone: string;
  my_role: GroupRole;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}

interface GroupMemberRow {
  user_id: string;
  name: string;
  profile_image_url: string | null;
  role: GroupRole;
  joined_at: Date;
}

export async function getGroupDetail(
  actor_user_id: string,
  group_id: string,
  transaction?: Transaction,
): Promise<GroupDetail> {
  const headers = await sequelize.query<GroupDetailHeaderRow>(
    `
      SELECT
        g.group_id,
        g.name,
        g.timezone,
        actor.role AS my_role,
        g.created_by_user_id,
        g.created_at,
        g.updated_at
      FROM groups g
      JOIN group_members actor
        ON actor.group_id = g.group_id
       AND actor.user_id = :actor_user_id
       AND actor.removed_at IS NULL
      WHERE g.group_id = :group_id
        AND g.deleted_at IS NULL
    `,
    {
      replacements: { actor_user_id, group_id },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  if (headers.length === 0) {
    throw groupError(GroupErrorCodes.GROUP_NOT_FOUND);
  }
  const members = await sequelize.query<GroupMemberRow>(
    `
      SELECT
        gm.user_id,
        u.name,
        u.profile_image_url,
        gm.role,
        gm.joined_at
      FROM group_members gm
      JOIN users u ON u.user_id = gm.user_id
      WHERE gm.group_id = :group_id
        AND gm.removed_at IS NULL
      ORDER BY
        CASE gm.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END,
        gm.joined_at ASC,
        gm.user_id ASC
    `,
    {
      replacements: { group_id },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  const header = headers[0];
  return {
    group_id: header.group_id,
    name: header.name,
    timezone: header.timezone,
    my_role: header.my_role,
    member_count: members.length,
    members: members.map((member) => ({
      user_id: member.user_id,
      name: member.name,
      profile_image_url: member.profile_image_url,
      role: member.role,
      joined_at: toUtcIso(member.joined_at),
    })),
    created_by_user_id: header.created_by_user_id,
    created_at: toUtcIso(header.created_at),
    updated_at: toUtcIso(header.updated_at),
  };
}

interface GroupListRow {
  group_id: string;
  name: string;
  timezone: string;
  my_role: GroupRole;
  member_count: string | number;
  members_preview: GroupUserSummary[];
  created_at: Date;
  updated_at: Date;
}

export async function getGroups(
  actor_user_id: string,
  page = 1,
  limit = 20,
): Promise<{ groups: GroupSummary[]; pagination: Pagination }> {
  const offset = (page - 1) * limit;
  const [rows, total_rows] = await Promise.all([
    sequelize.query<GroupListRow>(
      `
        SELECT
          g.group_id,
          g.name,
          g.timezone,
          actor.role AS my_role,
          (
            SELECT count(*)
            FROM group_members member_count
            WHERE member_count.group_id = g.group_id
              AND member_count.removed_at IS NULL
          ) AS member_count,
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'user_id', preview.user_id,
                  'name', preview.name,
                  'profile_image_url', preview.profile_image_url
                )
                ORDER BY preview.role_order, preview.joined_at, preview.user_id
              )
              FROM (
                SELECT
                  gm.user_id,
                  u.name,
                  u.profile_image_url,
                  gm.joined_at,
                  CASE gm.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END AS role_order
                FROM group_members gm
                JOIN users u ON u.user_id = gm.user_id
                WHERE gm.group_id = g.group_id
                  AND gm.removed_at IS NULL
                ORDER BY role_order, gm.joined_at, gm.user_id
                LIMIT 4
              ) preview
            ),
            '[]'::jsonb
          ) AS members_preview,
          g.created_at,
          g.updated_at
        FROM groups g
        JOIN group_members actor
          ON actor.group_id = g.group_id
         AND actor.user_id = :actor_user_id
         AND actor.removed_at IS NULL
        WHERE g.deleted_at IS NULL
        ORDER BY g.updated_at DESC, g.group_id DESC
        LIMIT :limit OFFSET :offset
      `,
      {
        replacements: { actor_user_id, limit, offset },
        type: QueryTypes.SELECT,
      },
    ),
    sequelize.query<{ total: string | number }>(
      `
        SELECT count(*) AS total
        FROM groups g
        JOIN group_members actor
          ON actor.group_id = g.group_id
         AND actor.user_id = :actor_user_id
         AND actor.removed_at IS NULL
        WHERE g.deleted_at IS NULL
      `,
      {
        replacements: { actor_user_id },
        type: QueryTypes.SELECT,
      },
    ),
  ]);
  const total = Number(total_rows[0]?.total ?? 0);
  return {
    groups: rows.map((row) => ({
      group_id: row.group_id,
      name: row.name,
      timezone: row.timezone,
      my_role: row.my_role,
      member_count: Number(row.member_count),
      members_preview: row.members_preview,
      created_at: toUtcIso(row.created_at),
      updated_at: toUtcIso(row.updated_at),
    })),
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  };
}

export async function createGroup(
  actor_user_id: string,
  input: {
    name: unknown;
    timezone?: unknown;
    invitee_user_ids?: string[];
  },
): Promise<{
  group: GroupDetail;
  invitations: GroupInvitationSummary[];
}> {
  const name = normalizeGroupName(input.name);
  const creator = await User.findByPk(actor_user_id);
  if (!creator) {
    throw new Error("UNAUTHORIZED");
  }
  const creator_timezone = isValidIanaTimezone(creator.timezone)
    ? creator.timezone
    : "Asia/Seoul";
  const timezone = normalizeGroupTimezone(input.timezone ?? creator_timezone);
  const invitee_user_ids = input.invitee_user_ids ?? [];

  const result = await sequelize.transaction(async (transaction) => {
    const group = await Group.create(
      {
        name,
        timezone,
        created_by_user_id: actor_user_id,
      },
      { transaction },
    );
    await GroupMember.create(
      {
        group_id: group.group_id,
        user_id: actor_user_id,
        role: "OWNER",
        added_by_user_id: actor_user_id,
      },
      { transaction },
    );
    const invitations = await createInvitations(
      group,
      creator,
      invitee_user_ids,
      null,
      transaction,
    );
    return {
      group_id: group.group_id,
      invitations: invitations.map(toInvitationSummary),
    };
  });

  return {
    group: await getGroupDetail(actor_user_id, result.group_id),
    invitations: result.invitations,
  };
}

export async function inviteGroupMembers(
  actor_user_id: string,
  group_id: string,
  invitee_user_ids: string[],
  message?: string | null,
): Promise<GroupInvitationSummary[]> {
  const inviter = await User.findByPk(actor_user_id);
  if (!inviter) throw new Error("UNAUTHORIZED");
  if (!Array.isArray(invitee_user_ids) || invitee_user_ids.length === 0) {
    throw groupError(GroupErrorCodes.GROUP_INVITEE_NOT_FRIEND);
  }
  const normalized_message =
    typeof message === "string" && message.trim().length > 0
      ? message.trim()
      : null;

  return sequelize.transaction(async (transaction) => {
    const { group, actor_member } = await lockGroupForActor(
      group_id,
      actor_user_id,
      transaction,
    );
    assertPermission(actor_member.role, "INVITE");
    const invitations = await createInvitations(
      group,
      inviter,
      invitee_user_ids,
      normalized_message,
      transaction,
    );
    return invitations.map(toInvitationSummary);
  });
}

interface InvitationApiRow {
  invitation_id: string;
  group_id: string;
  group_name: string;
  member_count: string | number;
  inviter_user_id: string;
  inviter_name: string;
  inviter_profile_image_url: string | null;
  invitee_user_id: string;
  status: GroupInvitationStatus;
  message: string | null;
  expires_at: Date;
  created_at: Date;
  responded_at: Date | null;
}

function toInvitationApiModel(row: InvitationApiRow): GroupInvitationApiModel {
  return {
    invitation_id: row.invitation_id,
    group: {
      group_id: row.group_id,
      name: row.group_name,
      member_count: Number(row.member_count),
    },
    inviter: {
      user_id: row.inviter_user_id,
      name: row.inviter_name,
      profile_image_url: row.inviter_profile_image_url,
    },
    invitee_user_id: row.invitee_user_id,
    status: row.status,
    message: row.message,
    expires_at: toUtcIso(row.expires_at),
    created_at: toUtcIso(row.created_at),
    responded_at: row.responded_at ? toUtcIso(row.responded_at) : null,
  };
}

async function queryInvitations(
  condition_sql: string,
  replacements: Record<string, unknown>,
  page: number,
  limit: number,
  transaction?: Transaction,
): Promise<{
  invitations: GroupInvitationApiModel[];
  pagination: Pagination;
}> {
  const offset = (page - 1) * limit;
  const base_from = `
    FROM group_invitations gi
    JOIN groups g ON g.group_id = gi.group_id
    JOIN users inviter ON inviter.user_id = gi.inviter_user_id
    WHERE ${condition_sql}
  `;
  const [rows, count_rows] = await Promise.all([
    sequelize.query<InvitationApiRow>(
      `
        SELECT
          gi.invitation_id,
          gi.group_id,
          g.name AS group_name,
          (
            SELECT count(*)
            FROM group_members gm
            WHERE gm.group_id = gi.group_id
              AND gm.removed_at IS NULL
          ) AS member_count,
          inviter.user_id AS inviter_user_id,
          inviter.name AS inviter_name,
          inviter.profile_image_url AS inviter_profile_image_url,
          gi.invitee_user_id,
          gi.status,
          gi.message,
          gi.expires_at,
          gi.created_at,
          gi.responded_at
        ${base_from}
        ORDER BY gi.created_at DESC, gi.invitation_id DESC
        LIMIT :limit OFFSET :offset
      `,
      {
        replacements: { ...replacements, limit, offset },
        type: QueryTypes.SELECT,
        transaction,
      },
    ),
    sequelize.query<{ total: string | number }>(
      `SELECT count(*) AS total ${base_from}`,
      {
        replacements,
        type: QueryTypes.SELECT,
        transaction,
      },
    ),
  ]);
  const total = Number(count_rows[0]?.total ?? 0);
  return {
    invitations: rows.map(toInvitationApiModel),
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  };
}

function normalizeInvitationStatus(
  status: string | undefined,
): GroupInvitationStatus | undefined {
  if (status === undefined) return undefined;
  if (!invitation_statuses.includes(status as GroupInvitationStatus)) {
    throw groupError(GroupErrorCodes.GROUP_INVITATION_NOT_FOUND);
  }
  return status as GroupInvitationStatus;
}

export async function getReceivedInvitations(
  actor_user_id: string,
  status: string | undefined,
  page = 1,
  limit = 20,
): Promise<{
  invitations: GroupInvitationApiModel[];
  pagination: Pagination;
}> {
  const normalized_status = normalizeInvitationStatus(status);
  return sequelize.transaction(async (transaction) => {
    await expirePendingInvitations(
      { invitee_user_id: actor_user_id },
      transaction,
    );
    const status_sql = normalized_status ? " AND gi.status = :status" : "";
    return queryInvitations(
      `gi.invitee_user_id = :actor_user_id${status_sql}`,
      {
        actor_user_id,
        ...(normalized_status ? { status: normalized_status } : {}),
      },
      page,
      limit,
      transaction,
    );
  });
}

function notificationToApiModel(notification: Notification | null) {
  if (!notification) return null;
  return {
    notification_id: notification.notification_id,
    notification_type: notification.notification_type,
    title: notification.title,
    body: notification.body ?? null,
    payload: notification.payload,
    actions: notification.actions,
    is_read: notification.is_read,
    read_at: notification.read_at?.toISOString() ?? null,
    created_at: notification.created_at?.toISOString() ?? null,
  };
}

export async function respondToInvitation(
  actor_user_id: string,
  invitation_id: string,
  action: string,
): Promise<{
  invitation: {
    invitation_id: string;
    status: "ACCEPTED" | "REJECTED";
    responded_at: string;
  };
  group: {
    group_id: string;
    name: string;
    timezone: string;
    my_role: GroupRole | null;
    member_count: number;
  };
  notification: ReturnType<typeof notificationToApiModel>;
}> {
  if (action !== "accept" && action !== "reject") {
    throw groupError(GroupErrorCodes.INVALID_GROUP_INVITATION_ACTION);
  }
  const initial_invitation = await GroupInvitation.findOne({
    where: { invitation_id, invitee_user_id: actor_user_id },
    attributes: ["invitation_id", "group_id"],
  });
  if (!initial_invitation) {
    throw groupError(GroupErrorCodes.GROUP_INVITATION_NOT_FOUND);
  }

  const result = await sequelize.transaction(async (transaction) => {
    const group = await Group.findOne({
      where: { group_id: initial_invitation.group_id, deleted_at: null },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const invitation = await GroupInvitation.findOne({
      where: { invitation_id, invitee_user_id: actor_user_id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!invitation) {
      throw groupError(GroupErrorCodes.GROUP_INVITATION_NOT_FOUND);
    }
    if (!group) {
      throw groupError(GroupErrorCodes.GROUP_NOT_FOUND);
    }
    const now = new Date();
    if (
      invitation.status === "PENDING" &&
      invitation.expires_at.getTime() <= now.getTime()
    ) {
      await expireInvitation(invitation, now, transaction);
      return { expired: true as const };
    }
    if (invitation.status !== "PENDING") {
      throw groupError(GroupErrorCodes.GROUP_INVITATION_ALREADY_PROCESSED);
    }

    const invitee = await User.findByPk(actor_user_id, { transaction });
    if (!invitee) throw new Error("UNAUTHORIZED");
    const new_status: "ACCEPTED" | "REJECTED" =
      action === "accept" ? "ACCEPTED" : "REJECTED";

    if (action === "accept") {
      const is_friend = await areAllFriends(
        invitation.inviter_user_id,
        [actor_user_id],
        transaction,
      );
      if (!is_friend) {
        throw groupError(GroupErrorCodes.GROUP_INVITEE_NOT_FRIEND);
      }
      const existing_member = await GroupMember.findOne({
        where: {
          group_id: group.group_id,
          user_id: actor_user_id,
          removed_at: null,
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (existing_member) {
        throw groupError(GroupErrorCodes.GROUP_MEMBER_ALREADY_EXISTS);
      }
      const member_count = await GroupMember.count({
        where: { group_id: group.group_id, removed_at: null },
        transaction,
      });
      if (member_count >= getMemberLimit()) {
        throw groupError(GroupErrorCodes.GROUP_MEMBER_LIMIT_REACHED);
      }
      try {
        await GroupMember.create(
          {
            group_id: group.group_id,
            user_id: actor_user_id,
            role: "MEMBER",
            added_by_user_id: invitation.inviter_user_id,
            joined_at: now,
            updated_at: now,
          },
          { transaction },
        );
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          throw groupError(GroupErrorCodes.GROUP_MEMBER_ALREADY_EXISTS);
        }
        throw error;
      }
      await touchGroup(group, now, transaction);
    }

    invitation.status = new_status;
    invitation.updated_at = now;
    invitation.responded_at = now;
    await invitation.save({ transaction });
    const notification = await updateInvitationNotification(
      invitation.invitation_id,
      new_status,
      now,
      transaction,
    );
    await createInvitationResultNotification(
      invitation,
      invitee,
      new_status,
      transaction,
    );

    const member_count = await GroupMember.count({
      where: { group_id: group.group_id, removed_at: null },
      transaction,
    });
    return {
      expired: false as const,
      invitation: {
        invitation_id: invitation.invitation_id,
        status: new_status,
        responded_at: now.toISOString(),
      },
      group: {
        group_id: group.group_id,
        name: group.name,
        timezone: group.timezone,
        my_role: action === "accept" ? ("MEMBER" as const) : null,
        member_count,
      },
      notification: notificationToApiModel(notification),
    };
  });
  if (result.expired) {
    throw groupError(GroupErrorCodes.GROUP_INVITATION_EXPIRED);
  }
  return result;
}

interface CalendarMemberRow extends GroupMemberRow {
  group_id: string;
  group_name: string;
  group_timezone: string;
  calendar_access: CalendarAccess;
}

interface CalendarWorkShiftRow {
  owner_user_id: string;
  work_shift_id: string;
  work_date: string | Date;
  shift_type_code: string;
  shift_type_name: string;
  shift_type_color: string | number | null;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

interface CalendarEventRow {
  owner_user_id: string;
  event_id: string;
  title: string;
  memo: string | null;
  place: string | null;
  all_day: boolean;
  start_at: Date;
  end_at: Date;
  visibility_level: number;
}

export async function getGroupCalendarRange(
  actor_user_id: string,
  group_id: string,
  start_date: string,
  end_date: string,
): Promise<GroupCalendarRange & { query_count: 3; range_days: number }> {
  const range_days = getInclusiveDateRangeDays(start_date, end_date);
  if (range_days > getCalendarMaxRangeDays()) {
    throw groupError(GroupErrorCodes.GROUP_CALENDAR_RANGE_TOO_LARGE);
  }

  const members = await sequelize.query<CalendarMemberRow>(
    `
      SELECT
        g.group_id,
        g.name AS group_name,
        g.timezone AS group_timezone,
        gm.user_id,
        u.name,
        u.profile_image_url,
        gm.role,
        gm.joined_at,
        CASE
          WHEN gm.user_id = :actor_user_id THEN 'SELF'
          WHEN fls.can_view = true
           AND EXISTS (
             SELECT 1
             FROM friendships f
             WHERE f.user_id_a = LEAST(gm.user_id, :actor_user_id::uuid)
               AND f.user_id_b = GREATEST(gm.user_id, :actor_user_id::uuid)
           ) THEN 'VISIBLE'
          ELSE 'DENIED'
        END AS calendar_access
      FROM groups g
      JOIN group_members actor
        ON actor.group_id = g.group_id
       AND actor.user_id = :actor_user_id
       AND actor.removed_at IS NULL
      JOIN group_members gm
        ON gm.group_id = g.group_id
       AND gm.removed_at IS NULL
      JOIN users u ON u.user_id = gm.user_id
      LEFT JOIN friend_level_settings fls
        ON fls.owner_user_id = gm.user_id
       AND fls.friend_user_id = :actor_user_id
      WHERE g.group_id = :group_id
        AND g.deleted_at IS NULL
      ORDER BY
        CASE WHEN gm.user_id = :actor_user_id THEN 0 ELSE 1 END,
        CASE gm.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END,
        gm.joined_at ASC,
        gm.user_id ASC
    `,
    {
      replacements: { actor_user_id, group_id },
      type: QueryTypes.SELECT,
    },
  );
  if (members.length === 0) {
    throw groupError(GroupErrorCodes.GROUP_NOT_FOUND);
  }

  const member_user_ids = members.map((member) => member.user_id);
  const group_timezone = members[0].group_timezone;
  const [work_shift_rows, event_rows] = await Promise.all([
    sequelize.query<CalendarWorkShiftRow>(
      `
        WITH visible_work_shifts AS (
          SELECT
            ws.owner_user_id,
            ws.work_shift_id,
            ws.work_date,
            ws.schedule_id,
            ws.note,
            ws.created_at,
            ws.updated_at
          FROM work_shifts ws
          WHERE ws.owner_user_id = :actor_user_id
            AND ws.work_date BETWEEN CAST(:start_date AS date) AND CAST(:end_date AS date)
            AND ws.deleted_at IS NULL

          UNION ALL

          SELECT
            ws.owner_user_id,
            ws.work_shift_id,
            ws.work_date,
            ws.schedule_id,
            ws.note,
            ws.created_at,
            ws.updated_at
          FROM v_visible_work_shifts_for_friend ws
          WHERE ws.viewer_user_id = :actor_user_id
            AND ws.owner_user_id IN (:member_user_ids)
            AND ws.work_date BETWEEN CAST(:start_date AS date) AND CAST(:end_date AS date)
        )
        SELECT
          visible.owner_user_id,
          visible.work_shift_id,
          visible.work_date,
          st.code AS shift_type_code,
          st.name AS shift_type_name,
          st.color AS shift_type_color,
          sts.start_time,
          sts.end_time,
          visible.note,
          visible.created_at,
          visible.updated_at
        FROM visible_work_shifts visible
        JOIN shift_type_schedules sts ON sts.schedule_id = visible.schedule_id
        JOIN shift_types st ON st.shift_type_id = sts.shift_type_id
        ORDER BY visible.work_date ASC, visible.owner_user_id ASC
      `,
      {
        replacements: {
          actor_user_id,
          member_user_ids,
          start_date,
          end_date,
        },
        type: QueryTypes.SELECT,
      },
    ),
    sequelize.query<CalendarEventRow>(
      `
        WITH visible_events AS (
          SELECT
            e.owner_user_id,
            e.event_id,
            e.title,
            e.memo,
            e.place,
            e.all_day,
            e.start_at,
            e.end_at,
            e.visibility_level
          FROM events e
          WHERE e.owner_user_id = :actor_user_id
            AND e.deleted_at IS NULL
            AND e.start_at < (
              (CAST(:end_date AS date) + 1)::timestamp
              AT TIME ZONE :group_timezone
            )
            AND e.end_at > (
              CAST(:start_date AS date)::timestamp
              AT TIME ZONE :group_timezone
            )

          UNION ALL

          SELECT
            e.owner_user_id,
            e.event_id,
            e.title,
            e.memo,
            e.place,
            e.all_day,
            e.start_at,
            e.end_at,
            e.visibility_level
          FROM v_visible_events_for_friend e
          WHERE e.viewer_user_id = :actor_user_id
            AND e.owner_user_id IN (:member_user_ids)
            AND e.start_at < (
              (CAST(:end_date AS date) + 1)::timestamp
              AT TIME ZONE :group_timezone
            )
            AND e.end_at > (
              CAST(:start_date AS date)::timestamp
              AT TIME ZONE :group_timezone
            )
        )
        SELECT *
        FROM visible_events
        ORDER BY start_at ASC, event_id ASC
      `,
      {
        replacements: {
          actor_user_id,
          member_user_ids,
          start_date,
          end_date,
          group_timezone,
        },
        type: QueryTypes.SELECT,
      },
    ),
  ]);

  const work_shifts: GroupCalendarWorkShift[] = work_shift_rows.map((row) => ({
    owner_user_id: row.owner_user_id,
    work_shift_id: row.work_shift_id,
    work_date: formatDbDate(row.work_date),
    shift_type_code: row.shift_type_code,
    shift_type_name: row.shift_type_name,
    shift_type_color: formatShiftTypeColor(row.shift_type_color),
    start_time: formatDbTime(row.start_time),
    end_time: formatDbTime(row.end_time),
    note: row.note,
    created_at: toUtcIso(row.created_at),
    updated_at: toUtcIso(row.updated_at),
  }));
  const events: GroupCalendarEvent[] = event_rows.map((row) => ({
    owner_user_id: row.owner_user_id,
    event_id: row.event_id,
    title: row.title,
    memo: row.memo,
    place: row.place,
    all_day: row.all_day,
    start_at: toUtcIso(row.start_at),
    end_at: toUtcIso(row.end_at),
    visibility_level: row.visibility_level,
  }));

  return {
    group: {
      group_id: members[0].group_id,
      name: members[0].group_name,
      timezone: group_timezone,
    },
    range: { start_date, end_date },
    members: members.map((member) => ({
      user_id: member.user_id,
      name: member.name,
      profile_image_url: member.profile_image_url,
      role: member.role,
      joined_at: toUtcIso(member.joined_at),
      calendar_access: member.calendar_access,
    })),
    work_shifts,
    events,
    query_count: 3,
    range_days,
  };
}

export async function updateGroup(
  actor_user_id: string,
  group_id: string,
  input: { name?: unknown; timezone?: unknown },
): Promise<GroupDetail> {
  if (input.name === undefined && input.timezone === undefined) {
    throw groupError(GroupErrorCodes.INVALID_GROUP_NAME);
  }
  const name =
    input.name === undefined ? undefined : normalizeGroupName(input.name);
  const timezone =
    input.timezone === undefined
      ? undefined
      : normalizeGroupTimezone(input.timezone);

  await sequelize.transaction(async (transaction) => {
    const { group, actor_member } = await lockGroupForActor(
      group_id,
      actor_user_id,
      transaction,
    );
    assertPermission(actor_member.role, "UPDATE");
    if (name !== undefined) group.name = name;
    if (timezone !== undefined) group.timezone = timezone;
    await touchGroup(group, new Date(), transaction);
  });
  return getGroupDetail(actor_user_id, group_id);
}

export async function deleteGroup(
  actor_user_id: string,
  group_id: string,
): Promise<{ group_id: string; deleted_at: string }> {
  return sequelize.transaction(async (transaction) => {
    const { group, actor_member } = await lockGroupForActor(
      group_id,
      actor_user_id,
      transaction,
    );
    assertPermission(actor_member.role, "DELETE");
    const now = new Date();

    const pending_invitations = await GroupInvitation.findAll({
      where: { group_id, status: "PENDING" },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    for (const invitation of pending_invitations) {
      invitation.status = "CANCELED";
      invitation.updated_at = now;
      invitation.responded_at = now;
      await invitation.save({ transaction });
      await updateInvitationNotification(
        invitation.invitation_id,
        "CANCELED",
        now,
        transaction,
      );
    }

    await GroupMember.update(
      { removed_at: now, removed_by_user_id: actor_user_id, updated_at: now },
      { where: { group_id, removed_at: null }, transaction },
    );
    group.deleted_at = now;
    group.deleted_by_user_id = actor_user_id;
    group.updated_at = now;
    await group.save({ transaction });
    return { group_id, deleted_at: now.toISOString() };
  });
}

export async function getGroupInvitations(
  actor_user_id: string,
  group_id: string,
  status: string | undefined,
  page = 1,
  limit = 20,
): Promise<{
  invitations: GroupInvitationApiModel[];
  pagination: Pagination;
}> {
  const normalized_status = normalizeInvitationStatus(status);
  return sequelize.transaction(async (transaction) => {
    const { actor_member } = await lockGroupForActor(
      group_id,
      actor_user_id,
      transaction,
    );
    assertPermission(actor_member.role, "INVITE");
    await expirePendingInvitations({ group_id }, transaction);
    const status_sql = normalized_status ? " AND gi.status = :status" : "";
    return queryInvitations(
      `gi.group_id = :group_id${status_sql}`,
      {
        group_id,
        ...(normalized_status ? { status: normalized_status } : {}),
      },
      page,
      limit,
      transaction,
    );
  });
}

export async function cancelInvitation(
  actor_user_id: string,
  invitation_id: string,
): Promise<{
  invitation_id: string;
  status: "CANCELED";
  responded_at: string;
  notification: ReturnType<typeof notificationToApiModel>;
}> {
  const initial_invitation = await GroupInvitation.findByPk(invitation_id, {
    attributes: ["invitation_id", "group_id"],
  });
  if (!initial_invitation) {
    throw groupError(GroupErrorCodes.GROUP_INVITATION_NOT_FOUND);
  }

  const result = await sequelize.transaction(async (transaction) => {
    const { actor_member } = await lockGroupForActor(
      initial_invitation.group_id,
      actor_user_id,
      transaction,
    );
    assertPermission(actor_member.role, "INVITE");
    const invitation = await GroupInvitation.findByPk(invitation_id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!invitation) {
      throw groupError(GroupErrorCodes.GROUP_INVITATION_NOT_FOUND);
    }
    const now = new Date();
    if (
      invitation.status === "PENDING" &&
      invitation.expires_at.getTime() <= now.getTime()
    ) {
      await expireInvitation(invitation, now, transaction);
      return { expired: true as const };
    }
    if (invitation.status !== "PENDING") {
      throw groupError(GroupErrorCodes.GROUP_INVITATION_ALREADY_PROCESSED);
    }
    invitation.status = "CANCELED";
    invitation.updated_at = now;
    invitation.responded_at = now;
    await invitation.save({ transaction });
    const notification = await updateInvitationNotification(
      invitation.invitation_id,
      "CANCELED",
      now,
      transaction,
    );
    return {
      expired: false as const,
      invitation_id: invitation.invitation_id,
      status: "CANCELED" as const,
      responded_at: now.toISOString(),
      notification: notificationToApiModel(notification),
    };
  });
  if (result.expired) {
    throw groupError(GroupErrorCodes.GROUP_INVITATION_EXPIRED);
  }
  return result;
}

export async function removeGroupMember(
  actor_user_id: string,
  group_id: string,
  target_user_id: string,
): Promise<{ group_id: string; user_id: string; removed_at: string }> {
  return sequelize.transaction(async (transaction) => {
    const { group, actor_member } = await lockGroupForActor(
      group_id,
      actor_user_id,
      transaction,
    );
    const target_member = await GroupMember.findOne({
      where: { group_id, user_id: target_user_id, removed_at: null },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!target_member) {
      throw groupError(GroupErrorCodes.GROUP_MEMBER_NOT_FOUND);
    }
    if (target_member.role === "OWNER") {
      throw groupError(GroupErrorCodes.GROUP_OWNER_CANNOT_BE_REMOVED);
    }
    assertPermission(
      actor_member.role,
      "REMOVE_MEMBER",
      target_member.role,
    );
    const now = new Date();
    target_member.removed_at = now;
    target_member.removed_by_user_id = actor_user_id;
    target_member.updated_at = now;
    await target_member.save({ transaction });
    await touchGroup(group, now, transaction);
    return { group_id, user_id: target_user_id, removed_at: now.toISOString() };
  });
}

export async function updateGroupMemberRole(
  actor_user_id: string,
  group_id: string,
  target_user_id: string,
  role: string,
): Promise<{
  member: GroupMemberSummary;
  group_updated_at: string;
}> {
  if (role !== "ADMIN" && role !== "MEMBER") {
    throw groupError(GroupErrorCodes.INVALID_GROUP_MEMBER_ROLE);
  }
  const result = await sequelize.transaction(async (transaction) => {
    const { group, actor_member } = await lockGroupForActor(
      group_id,
      actor_user_id,
      transaction,
    );
    assertPermission(actor_member.role, "CHANGE_ROLE");
    const target_member = await GroupMember.findOne({
      where: { group_id, user_id: target_user_id, removed_at: null },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!target_member || target_member.role === "OWNER") {
      throw groupError(GroupErrorCodes.GROUP_MEMBER_NOT_FOUND);
    }
    const now = new Date();
    target_member.role = role;
    target_member.updated_at = now;
    await target_member.save({ transaction });
    await touchGroup(group, now, transaction);
    return {
      target_member,
      group_updated_at: now.toISOString(),
    };
  });
  const target_user = await User.findByPk(target_user_id, {
    attributes: ["user_id", "name", "profile_image_url"],
  });
  if (!target_user) {
    throw groupError(GroupErrorCodes.GROUP_MEMBER_NOT_FOUND);
  }
  return {
    member: {
      user_id: target_user.user_id,
      name: target_user.name,
      profile_image_url: target_user.profile_image_url ?? null,
      role: result.target_member.role,
      joined_at: result.target_member.joined_at.toISOString(),
    },
    group_updated_at: result.group_updated_at,
  };
}

export async function leaveGroup(
  actor_user_id: string,
  group_id: string,
): Promise<{ group_id: string; user_id: string; removed_at: string }> {
  return sequelize.transaction(async (transaction) => {
    const { group, actor_member } = await lockGroupForActor(
      group_id,
      actor_user_id,
      transaction,
    );
    if (actor_member.role === "OWNER") {
      throw groupError(GroupErrorCodes.GROUP_OWNER_CANNOT_LEAVE);
    }
    const now = new Date();
    actor_member.removed_at = now;
    actor_member.removed_by_user_id = actor_user_id;
    actor_member.updated_at = now;
    await actor_member.save({ transaction });
    await touchGroup(group, now, transaction);
    return {
      group_id,
      user_id: actor_user_id,
      removed_at: now.toISOString(),
    };
  });
}

export async function transferGroupOwner(
  actor_user_id: string,
  group_id: string,
  new_owner_user_id: string,
): Promise<GroupDetail> {
  if (new_owner_user_id === actor_user_id) {
    throw groupError(GroupErrorCodes.INVALID_GROUP_OWNER_TRANSFER);
  }
  await sequelize.transaction(async (transaction) => {
    const { group, actor_member } = await lockGroupForActor(
      group_id,
      actor_user_id,
      transaction,
    );
    assertPermission(actor_member.role, "TRANSFER_OWNER");
    const new_owner_member = await GroupMember.findOne({
      where: {
        group_id,
        user_id: new_owner_user_id,
        removed_at: null,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!new_owner_member || new_owner_member.role === "OWNER") {
      throw groupError(GroupErrorCodes.INVALID_GROUP_OWNER_TRANSFER);
    }
    const now = new Date();
    actor_member.role = "ADMIN";
    actor_member.updated_at = now;
    await actor_member.save({ transaction });
    new_owner_member.role = "OWNER";
    new_owner_member.updated_at = now;
    await new_owner_member.save({ transaction });
    await touchGroup(group, now, transaction);
  });
  return getGroupDetail(actor_user_id, group_id);
}

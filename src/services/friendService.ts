import { Op, QueryTypes } from "sequelize";
import { sequelize } from "../config/database";
import {
  User,
  FriendRequest,
  Friendship,
  FriendLevelSetting,
  Notification,
} from "../models";
import { NotificationType } from "../models/Notification";

// ============================================================
// 에러 코드 상수
// ============================================================
export const FriendErrorCodes = {
  SELF_REQUEST: "SELF_REQUEST",
  ALREADY_FRIENDS: "ALREADY_FRIENDS",
  PENDING_REQUEST_EXISTS: "PENDING_REQUEST_EXISTS",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  REQUEST_NOT_FOUND: "REQUEST_NOT_FOUND",
  NOT_ADDRESSEE: "NOT_ADDRESSEE",
  NOT_REQUESTER: "NOT_REQUESTER",
  NOT_PENDING: "NOT_PENDING",
  INVALID_ACTION: "INVALID_ACTION",
  NOT_FRIENDS: "NOT_FRIENDS",
  INVALID_LEVEL: "INVALID_LEVEL",
  INVALID_QUERY: "INVALID_QUERY",
} as const;

// ============================================================
// 타입 정의
// ============================================================
export interface FriendListItem {
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  profile_image_url: string | null;
  friend_level: number;
  can_view: boolean;
  created_at: Date;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface SearchedUser {
  user_id: string;
  name: string;
  email: string;
  profile_image_url: string | null;
  is_friend: boolean;
  has_pending_request: boolean;
  pending_request_direction: "sent" | "received" | null;
}

export interface FriendRequestInfo {
  request_id: string;
  requester_user_id: string;
  addressee_user_id: string;
  status: string;
  message: string | null;
  created_at: Date;
  responded_at: Date | null;
}

// ============================================================
// 친구 목록 조회
// ============================================================
export async function getFriends(
  user_id: string,
  page: number = 1,
  limit: number = 20
): Promise<{ friends: FriendListItem[]; pagination: PaginationInfo }> {
  const offset = (page - 1) * limit;

  // 총 친구 수 조회
  const total_count = await Friendship.count({
    where: {
      [Op.or]: [{ user_id_a: user_id }, { user_id_b: user_id }],
    },
  });

  // 친구 목록 조회 (raw query 사용)
  const friends = await sequelize.query<FriendListItem>(
    `
    SELECT
      u.user_id,
      u.name,
      u.email,
      u.phone,
      u.profile_image_url,
      fls.friend_level,
      fls.can_view,
      f.created_at
    FROM friendships f
    JOIN users u ON (
      (f.user_id_a = :user_id AND f.user_id_b = u.user_id)
      OR
      (f.user_id_b = :user_id AND f.user_id_a = u.user_id)
    )
    JOIN friend_level_settings fls ON (
      fls.owner_user_id = :user_id
      AND fls.friend_user_id = u.user_id
    )
    ORDER BY u.name ASC
    LIMIT :limit OFFSET :offset
    `,
    {
      replacements: { user_id, limit, offset },
      type: QueryTypes.SELECT,
    }
  );

  return {
    friends,
    pagination: {
      page,
      limit,
      total: total_count,
      total_pages: Math.ceil(total_count / limit),
    },
  };
}

// ============================================================
// 사용자 검색 (친구 추가용)
// ============================================================
export async function searchUser(
  my_user_id: string,
  query: string
): Promise<SearchedUser | null> {
  // 이메일 또는 전화번호로 검색
  const is_email = query.includes("@");
  const search_condition = is_email ? { email: query } : { phone: query };

  const user = await User.findOne({
    where: search_condition,
    attributes: ["user_id", "name", "email", "profile_image_url"],
  });

  if (!user) {
    return null;
  }

  // 자기 자신은 검색 결과에서 제외
  if (user.user_id === my_user_id) {
    return null;
  }

  // 친구 관계 확인
  const { user_id_a, user_id_b } = Friendship.sortUserIds(
    my_user_id,
    user.user_id
  );
  const friendship = await Friendship.findOne({
    where: { user_id_a, user_id_b },
  });

  // 대기중인 요청 확인
  const pending_request = await FriendRequest.findOne({
    where: {
      [Op.or]: [
        { requester_user_id: my_user_id, addressee_user_id: user.user_id },
        { requester_user_id: user.user_id, addressee_user_id: my_user_id },
      ],
      status: "PENDING",
    },
  });

  let pending_request_direction: "sent" | "received" | null = null;
  if (pending_request) {
    pending_request_direction =
      pending_request.requester_user_id === my_user_id ? "sent" : "received";
  }

  return {
    user_id: user.user_id,
    name: user.name,
    email: user.email,
    profile_image_url: user.profile_image_url ?? null,
    is_friend: !!friendship,
    has_pending_request: !!pending_request,
    pending_request_direction,
  };
}

// ============================================================
// 친구 요청 보내기
// ============================================================
export async function sendFriendRequest(
  requester_user_id: string,
  addressee_user_id: string,
  message?: string
): Promise<FriendRequestInfo> {
  // 1. 자기 자신 체크
  if (requester_user_id === addressee_user_id) {
    throw new Error(FriendErrorCodes.SELF_REQUEST);
  }

  // 2. 대상 사용자 존재 체크
  const addressee = await User.findByPk(addressee_user_id);
  if (!addressee) {
    throw new Error(FriendErrorCodes.USER_NOT_FOUND);
  }

  // 3. 이미 친구인지 체크
  const { user_id_a, user_id_b } = Friendship.sortUserIds(
    requester_user_id,
    addressee_user_id
  );
  const existing_friendship = await Friendship.findOne({
    where: { user_id_a, user_id_b },
  });
  if (existing_friendship) {
    throw new Error(FriendErrorCodes.ALREADY_FRIENDS);
  }

  // 4. 대기중인 요청 있는지 체크 (양방향)
  const pending_request = await FriendRequest.findOne({
    where: {
      [Op.or]: [
        { requester_user_id, addressee_user_id },
        {
          requester_user_id: addressee_user_id,
          addressee_user_id: requester_user_id,
        },
      ],
      status: "PENDING",
    },
  });
  if (pending_request) {
    throw new Error(FriendErrorCodes.PENDING_REQUEST_EXISTS);
  }

  // 5. 친구 요청 생성
  const request = await FriendRequest.create({
    requester_user_id,
    addressee_user_id,
    message: message ?? null,
  });

  // 6. 알림 생성 (요청 받은 사람에게)
  const requester = await User.findByPk(requester_user_id);
  await createFriendRequestNotification(
    addressee_user_id,
    request.request_id,
    requester!.name,
    requester!.profile_image_url ?? null,
    requester_user_id
  );

  return {
    request_id: request.request_id,
    requester_user_id: request.requester_user_id,
    addressee_user_id: request.addressee_user_id,
    status: request.status,
    message: request.message ?? null,
    created_at: request.created_at!,
    responded_at: request.responded_at ?? null,
  };
}

// ============================================================
// 받은 친구 요청 목록 조회
// ============================================================
export async function getReceivedRequests(
  user_id: string,
  status?: string,
  page: number = 1,
  limit: number = 20
): Promise<{
  requests: Array<{
    request_id: string;
    requester: {
      user_id: string;
      name: string;
      email: string;
      profile_image_url: string | null;
    };
    status: string;
    message: string | null;
    created_at: Date;
    responded_at: Date | null;
  }>;
  pagination: PaginationInfo;
}> {
  const offset = (page - 1) * limit;
  const where_condition: Record<string, unknown> = {
    addressee_user_id: user_id,
  };

  if (status) {
    where_condition.status = status;
  }

  const { count, rows } = await FriendRequest.findAndCountAll({
    where: where_condition,
    include: [
      {
        model: User,
        as: "requester",
        attributes: ["user_id", "name", "email", "profile_image_url"],
      },
    ],
    order: [["created_at", "DESC"]],
    limit,
    offset,
  });

  const requests = rows.map((row) => ({
    request_id: row.request_id,
    requester: {
      user_id: row.requester!.user_id,
      name: row.requester!.name,
      email: row.requester!.email,
      profile_image_url: row.requester!.profile_image_url ?? null,
    },
    status: row.status,
    message: row.message ?? null,
    created_at: row.created_at!,
    responded_at: row.responded_at ?? null,
  }));

  return {
    requests,
    pagination: {
      page,
      limit,
      total: count,
      total_pages: Math.ceil(count / limit),
    },
  };
}

// ============================================================
// 보낸 친구 요청 목록 조회
// ============================================================
export async function getSentRequests(
  user_id: string,
  status?: string,
  page: number = 1,
  limit: number = 20
): Promise<{
  requests: Array<{
    request_id: string;
    addressee: {
      user_id: string;
      name: string;
      email: string;
      profile_image_url: string | null;
    };
    status: string;
    message: string | null;
    created_at: Date;
    responded_at: Date | null;
  }>;
  pagination: PaginationInfo;
}> {
  const offset = (page - 1) * limit;
  const where_condition: Record<string, unknown> = {
    requester_user_id: user_id,
  };

  if (status) {
    where_condition.status = status;
  }

  const { count, rows } = await FriendRequest.findAndCountAll({
    where: where_condition,
    include: [
      {
        model: User,
        as: "addressee",
        attributes: ["user_id", "name", "email", "profile_image_url"],
      },
    ],
    order: [["created_at", "DESC"]],
    limit,
    offset,
  });

  const requests = rows.map((row) => ({
    request_id: row.request_id,
    addressee: {
      user_id: row.addressee!.user_id,
      name: row.addressee!.name,
      email: row.addressee!.email,
      profile_image_url: row.addressee!.profile_image_url ?? null,
    },
    status: row.status,
    message: row.message ?? null,
    created_at: row.created_at!,
    responded_at: row.responded_at ?? null,
  }));

  return {
    requests,
    pagination: {
      page,
      limit,
      total: count,
      total_pages: Math.ceil(count / limit),
    },
  };
}

// ============================================================
// 친구 요청 응답 (수락/거절)
// ============================================================
export async function respondToFriendRequest(
  user_id: string,
  request_id: string,
  action: "accept" | "reject"
): Promise<{
  request_id: string;
  status: string;
  responded_at: Date;
  friendship?: {
    user_id_a: string;
    user_id_b: string;
    created_at: Date;
  };
}> {
  // 1. 요청 조회
  const request = await FriendRequest.findByPk(request_id, {
    include: [
      {
        model: User,
        as: "requester",
        attributes: ["user_id", "name", "profile_image_url"],
      },
    ],
  });

  if (!request) {
    throw new Error(FriendErrorCodes.REQUEST_NOT_FOUND);
  }

  // 2. 현재 사용자가 addressee인지 확인
  if (request.addressee_user_id !== user_id) {
    throw new Error(FriendErrorCodes.NOT_ADDRESSEE);
  }

  // 3. 상태가 PENDING인지 확인
  if (request.status !== "PENDING") {
    throw new Error(FriendErrorCodes.NOT_PENDING);
  }

  // 4. 액션 유효성 검사
  if (action !== "accept" && action !== "reject") {
    throw new Error(FriendErrorCodes.INVALID_ACTION);
  }

  const new_status = action === "accept" ? "ACCEPTED" : "REJECTED";
  const responded_at = new Date();

  // 5. 상태 업데이트 (DB 트리거가 friendships, friend_level_settings 자동 생성)
  await request.update({
    status: new_status,
    responded_at,
  });

  // 6. 수락 시 알림 생성 (요청 보낸 사람에게)
  const addressee = await User.findByPk(user_id);
  if (action === "accept") {
    await createFriendAcceptedNotification(
      request.requester_user_id,
      addressee!.name,
      addressee!.profile_image_url ?? null,
      user_id
    );

    // 친구 관계 정보 조회
    const { user_id_a, user_id_b } = Friendship.sortUserIds(
      request.requester_user_id,
      request.addressee_user_id
    );
    const friendship = await Friendship.findOne({
      where: { user_id_a, user_id_b },
    });

    return {
      request_id,
      status: new_status,
      responded_at,
      friendship: friendship
        ? {
            user_id_a: friendship.user_id_a,
            user_id_b: friendship.user_id_b,
            created_at: friendship.created_at!,
          }
        : undefined,
    };
  } else {
    // 거절 시 알림 생성 (요청 보낸 사람에게)
    await createFriendRejectedNotification(
      request.requester_user_id,
      addressee!.name,
      addressee!.profile_image_url ?? null,
      user_id
    );

    return {
      request_id,
      status: new_status,
      responded_at,
    };
  }
}

// ============================================================
// 친구 요청 취소
// ============================================================
export async function cancelFriendRequest(
  user_id: string,
  request_id: string
): Promise<{
  request_id: string;
  status: string;
  responded_at: Date;
}> {
  // 1. 요청 조회
  const request = await FriendRequest.findByPk(request_id);

  if (!request) {
    throw new Error(FriendErrorCodes.REQUEST_NOT_FOUND);
  }

  // 2. 현재 사용자가 requester인지 확인
  if (request.requester_user_id !== user_id) {
    throw new Error(FriendErrorCodes.NOT_REQUESTER);
  }

  // 3. 상태가 PENDING인지 확인
  if (request.status !== "PENDING") {
    throw new Error(FriendErrorCodes.NOT_PENDING);
  }

  const responded_at = new Date();

  // 4. 상태 업데이트
  await request.update({
    status: "CANCELED",
    responded_at,
  });

  return {
    request_id,
    status: "CANCELED",
    responded_at,
  };
}

// ============================================================
// 친구 레벨 설정 변경
// ============================================================
export async function updateFriendSettings(
  user_id: string,
  friend_user_id: string,
  settings: { friend_level?: number; can_view?: boolean }
): Promise<{
  owner_user_id: string;
  friend_user_id: string;
  friend_level: number;
  can_view: boolean;
  updated_at: Date;
}> {
  // 1. 친구 관계 확인
  const { user_id_a, user_id_b } = Friendship.sortUserIds(
    user_id,
    friend_user_id
  );
  const friendship = await Friendship.findOne({
    where: { user_id_a, user_id_b },
  });

  if (!friendship) {
    throw new Error(FriendErrorCodes.NOT_FRIENDS);
  }

  // 2. 레벨 유효성 검사
  if (
    settings.friend_level !== undefined &&
    (settings.friend_level < 0 || settings.friend_level > 5)
  ) {
    throw new Error(FriendErrorCodes.INVALID_LEVEL);
  }

  // 3. 설정 업데이트
  const [setting] = await FriendLevelSetting.upsert({
    owner_user_id: user_id,
    friend_user_id,
    friend_level: settings.friend_level ?? 0,
    can_view: settings.can_view ?? true,
    updated_at: new Date(),
  });

  // 업데이트된 설정 조회
  const updated_setting = await FriendLevelSetting.findOne({
    where: { owner_user_id: user_id, friend_user_id },
  });

  return {
    owner_user_id: updated_setting!.owner_user_id,
    friend_user_id: updated_setting!.friend_user_id,
    friend_level: updated_setting!.friend_level,
    can_view: updated_setting!.can_view,
    updated_at: updated_setting!.updated_at!,
  };
}

// ============================================================
// 친구 삭제
// ============================================================
export async function deleteFriend(
  user_id: string,
  friend_user_id: string
): Promise<void> {
  const transaction = await sequelize.transaction();
  let is_committed = false;

  try {
    // 1. 친구 관계 확인
    const { user_id_a, user_id_b } = Friendship.sortUserIds(
      user_id,
      friend_user_id
    );
    const friendship = await Friendship.findOne({
      where: { user_id_a, user_id_b },
      transaction,
    });

    if (!friendship) {
      throw new Error(FriendErrorCodes.NOT_FRIENDS);
    }

    // 2. friend_level_settings 삭제 (양방향)
    await FriendLevelSetting.destroy({
      where: {
        [Op.or]: [
          { owner_user_id: user_id, friend_user_id },
          { owner_user_id: friend_user_id, friend_user_id: user_id },
        ],
      },
      transaction,
    });

    // 3. friendships 삭제
    await Friendship.destroy({
      where: { user_id_a, user_id_b },
      transaction,
    });

    await transaction.commit();
    is_committed = true;
  } catch (error) {
    if (!is_committed) {
      await transaction.rollback();
    }
    throw error;
  }
}

// ============================================================
// 알림 관련 헬퍼 함수들
// ============================================================

/**
 * 친구 요청 알림 생성
 */
async function createFriendRequestNotification(
  user_id: string,
  request_id: string,
  requester_name: string,
  requester_profile_image: string | null,
  requester_user_id: string
): Promise<void> {
  await Notification.create({
    user_id,
    notification_type: "FRIEND_REQUEST",
    title: "친구 요청",
    body: `${requester_name}님이 친구 요청을 보냈습니다.`,
    payload: {
      related_user_id: requester_user_id,
      request_id,
      user_name: requester_name,
      profile_image_url: requester_profile_image,
    },
    actions: [
      { type: "accept", label: "수락" },
      { type: "reject", label: "거절" },
    ],
  });
}

/**
 * 친구 요청 수락 알림 생성
 */
async function createFriendAcceptedNotification(
  user_id: string,
  accepter_name: string,
  accepter_profile_image: string | null,
  accepter_user_id: string
): Promise<void> {
  await Notification.create({
    user_id,
    notification_type: "FRIEND_ACCEPTED",
    title: "친구 요청 수락됨",
    body: `${accepter_name}님이 친구 요청을 수락했습니다.`,
    payload: {
      related_user_id: accepter_user_id,
      user_name: accepter_name,
      profile_image_url: accepter_profile_image,
    },
    actions: [{ type: "navigate", label: "친구 목록 보기", route: "/friends" }],
  });
}

/**
 * 친구 요청 거절 알림 생성
 */
async function createFriendRejectedNotification(
  user_id: string,
  rejecter_name: string,
  rejecter_profile_image: string | null,
  rejecter_user_id: string
): Promise<void> {
  await Notification.create({
    user_id,
    notification_type: "FRIEND_REJECTED",
    title: "친구 요청 거절됨",
    body: `${rejecter_name}님이 친구 요청을 거절했습니다.`,
    payload: {
      related_user_id: rejecter_user_id,
      user_name: rejecter_name,
      profile_image_url: rejecter_profile_image,
    },
    actions: [{ type: "dismiss", label: "확인" }],
  });
}

// ============================================================
// 알림 조회 및 관리
// ============================================================

/**
 * 알림 목록 조회 (조회 시 자동 읽음 처리)
 * - 알림 목록을 조회하면 해당 알림들이 자동으로 읽음 처리됨
 */
export async function getNotifications(
  user_id: string,
  page: number = 1,
  limit: number = 20
): Promise<{
  notifications: Array<{
    notification_id: string;
    notification_type: NotificationType;
    title: string;
    body: string | null;
    payload: Record<string, unknown>;
    actions: Array<{ type: string; label: string; route?: string }>;
    is_read: boolean;
    read_at: Date | null;
    created_at: Date;
  }>;
  pagination: PaginationInfo;
}> {
  const offset = (page - 1) * limit;

  const { count, rows } = await Notification.findAndCountAll({
    where: { user_id },
    order: [["created_at", "DESC"]],
    limit,
    offset,
  });

  // 조회된 미읽음 알림들의 ID 수집
  const unread_notification_ids = rows
    .filter((row) => !row.is_read)
    .map((row) => row.notification_id);

  // 조회된 미읽음 알림들 읽음 처리 (비동기, 응답 블로킹 하지 않음)
  if (unread_notification_ids.length > 0) {
    Notification.update(
      { is_read: true, read_at: new Date() },
      { where: { notification_id: unread_notification_ids } }
    ).catch((err) => console.error("알림 읽음 처리 실패:", err));
  }

  const notifications = rows.map((row) => ({
    notification_id: row.notification_id,
    notification_type: row.notification_type,
    title: row.title,
    body: row.body ?? null,
    payload: row.payload as Record<string, unknown>,
    actions: row.actions,
    is_read: true, // 조회 시점에 읽음 처리되므로 true로 반환
    read_at: row.read_at ?? new Date(),
    created_at: row.created_at!,
  }));

  return {
    notifications,
    pagination: {
      page,
      limit,
      total: count,
      total_pages: Math.ceil(count / limit),
    },
  };
}

/**
 * 미읽음 알림 개수 조회 (읽음 처리 하지 않음)
 * - 메인 페이지 등에서 알림 뱃지 표시용
 */
export async function getUnreadNotificationCount(
  user_id: string
): Promise<{ unread_count: number }> {
  const unread_count = await Notification.count({
    where: { user_id, is_read: false },
  });

  return { unread_count };
}

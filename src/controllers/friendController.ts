import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as friendService from "../services/friendService";
import { FriendErrorCodes } from "../services/friendService";

// 인증된 요청 타입
interface AuthenticatedRequest extends Request {
  user?: {
    user_id: string;
    email: string;
    name: string;
  };
}

// ============================================================
// 에러 응답 매핑
// ============================================================
const ErrorMessages: Record<string, { status: number; message: string }> = {
  [FriendErrorCodes.SELF_REQUEST]: {
    status: 400,
    message: "자기 자신에게 친구 요청을 보낼 수 없습니다.",
  },
  [FriendErrorCodes.ALREADY_FRIENDS]: {
    status: 400,
    message: "이미 친구 관계입니다.",
  },
  [FriendErrorCodes.PENDING_REQUEST_EXISTS]: {
    status: 400,
    message: "이미 대기 중인 요청이 있습니다.",
  },
  [FriendErrorCodes.USER_NOT_FOUND]: {
    status: 404,
    message: "해당 사용자를 찾을 수 없습니다.",
  },
  [FriendErrorCodes.REQUEST_NOT_FOUND]: {
    status: 404,
    message: "친구 요청을 찾을 수 없습니다.",
  },
  [FriendErrorCodes.NOT_ADDRESSEE]: {
    status: 403,
    message: "이 요청에 응답할 권한이 없습니다.",
  },
  [FriendErrorCodes.NOT_REQUESTER]: {
    status: 403,
    message: "이 요청을 취소할 권한이 없습니다.",
  },
  [FriendErrorCodes.NOT_PENDING]: {
    status: 400,
    message: "이미 처리된 요청입니다.",
  },
  [FriendErrorCodes.INVALID_ACTION]: {
    status: 400,
    message: "올바른 응답을 선택해주세요.",
  },
  [FriendErrorCodes.NOT_FRIENDS]: {
    status: 400,
    message: "친구 관계가 아닙니다.",
  },
  [FriendErrorCodes.INVALID_LEVEL]: {
    status: 400,
    message: "친구 레벨은 0~5 사이여야 합니다.",
  },
  [FriendErrorCodes.INVALID_QUERY]: {
    status: 400,
    message: "올바른 이메일 또는 전화번호를 입력해주세요.",
  },
};

/**
 * 에러 응답 헬퍼 함수
 */
function handleError(res: Response, error: unknown): void {
  const error_code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const error_info = ErrorMessages[error_code];

  if (error_info) {
    res.status(error_info.status).json({
      success: false,
      error: {
        code: error_code,
        message: error_info.message,
      },
    });
  } else {
    console.error("Friend controller error:", error);
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

// ============================================================
// 친구 목록 조회
// GET /api/v1/friends
// ============================================================
export async function getFriends(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const result = await friendService.getFriends(user_id, page, limit);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    handleError(res, error);
  }
}

// ============================================================
// 사용자 검색 (친구 추가용)
// GET /api/v1/users/search
// ============================================================
export async function searchUser(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "입력값 검증에 실패했습니다.",
        },
        errors: errors.array(),
      });
      return;
    }

    const user_id = req.user!.user_id;
    const query = (req.query.query as string).trim();

    // 간단한 유효성 검사
    const is_email = query.includes("@");
    const is_phone = /^[\+\d][\d\-\s]+$/.test(query);

    if (!is_email && !is_phone) {
      res.status(400).json({
        success: false,
        error: {
          code: FriendErrorCodes.INVALID_QUERY,
          message: "올바른 이메일 또는 전화번호를 입력해주세요.",
        },
      });
      return;
    }

    const result = await friendService.searchUser(user_id, query);

    if (!result) {
      res.status(404).json({
        success: false,
        error: {
          code: FriendErrorCodes.USER_NOT_FOUND,
          message: "해당 사용자를 찾을 수 없습니다.",
        },
      });
      return;
    }

    res.json({
      success: true,
      data: { user: result },
    });
  } catch (error) {
    handleError(res, error);
  }
}

// ============================================================
// 친구 요청 보내기
// POST /api/v1/friend-requests
// ============================================================
export async function sendFriendRequest(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "입력값 검증에 실패했습니다.",
        },
        errors: errors.array(),
      });
      return;
    }

    const requester_user_id = req.user!.user_id;
    const { addressee_user_id, message } = req.body;

    const result = await friendService.sendFriendRequest(
      requester_user_id,
      addressee_user_id,
      message
    );

    res.status(201).json({
      success: true,
      data: result,
      message: "친구 요청을 보냈습니다.",
    });
  } catch (error) {
    handleError(res, error);
  }
}

// ============================================================
// 받은 친구 요청 목록 조회
// GET /api/v1/friend-requests/received
// ============================================================
export async function getReceivedRequests(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const status = req.query.status as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const result = await friendService.getReceivedRequests(
      user_id,
      status,
      page,
      limit
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    handleError(res, error);
  }
}

// ============================================================
// 보낸 친구 요청 목록 조회
// GET /api/v1/friend-requests/sent
// ============================================================
export async function getSentRequests(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const status = req.query.status as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const result = await friendService.getSentRequests(
      user_id,
      status,
      page,
      limit
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    handleError(res, error);
  }
}

// ============================================================
// 친구 요청 응답 (수락/거절)
// PUT /api/v1/friend-requests/:request_id/respond
// ============================================================
export async function respondToRequest(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "입력값 검증에 실패했습니다.",
        },
        errors: errors.array(),
      });
      return;
    }

    const user_id = req.user!.user_id;
    const { request_id } = req.params;
    const { action } = req.body;

    const result = await friendService.respondToFriendRequest(
      user_id,
      request_id,
      action
    );

    const message =
      action === "accept"
        ? "친구 요청을 수락했습니다."
        : "친구 요청을 거절했습니다.";

    res.json({
      success: true,
      data: result,
      message,
    });
  } catch (error) {
    handleError(res, error);
  }
}

// ============================================================
// 친구 요청 취소
// PUT /api/v1/friend-requests/:request_id/cancel
// ============================================================
export async function cancelRequest(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const { request_id } = req.params;

    const result = await friendService.cancelFriendRequest(user_id, request_id);

    res.json({
      success: true,
      data: result,
      message: "친구 요청을 취소했습니다.",
    });
  } catch (error) {
    handleError(res, error);
  }
}

// ============================================================
// 친구 레벨 설정 변경
// PUT /api/v1/friends/:friend_user_id/settings
// ============================================================
export async function updateFriendSettings(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "입력값 검증에 실패했습니다.",
        },
        errors: errors.array(),
      });
      return;
    }

    const user_id = req.user!.user_id;
    const { friend_user_id } = req.params;
    const { friend_level, can_view } = req.body;

    const result = await friendService.updateFriendSettings(
      user_id,
      friend_user_id,
      { friend_level, can_view }
    );

    res.json({
      success: true,
      data: result,
      message: "친구 설정을 변경했습니다.",
    });
  } catch (error) {
    handleError(res, error);
  }
}

// ============================================================
// 친구 삭제
// DELETE /api/v1/friends/:friend_user_id
// ============================================================
export async function deleteFriend(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const { friend_user_id } = req.params;

    await friendService.deleteFriend(user_id, friend_user_id);

    res.json({
      success: true,
      data: null,
      message: "친구를 삭제했습니다.",
    });
  } catch (error) {
    handleError(res, error);
  }
}

// ============================================================
// 알림 목록 조회 (조회 시 자동 읽음 처리)
// GET /api/v1/notifications
// ============================================================
export async function getNotifications(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const result = await friendService.getNotifications(user_id, page, limit);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    handleError(res, error);
  }
}

// ============================================================
// 미읽음 알림 개수 조회 (읽음 처리 하지 않음)
// GET /api/v1/notifications/unread-count
// ============================================================
export async function getUnreadNotificationCount(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;

    const result = await friendService.getUnreadNotificationCount(user_id);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    handleError(res, error);
  }
}


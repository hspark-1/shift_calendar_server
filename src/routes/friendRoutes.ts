import { Router } from "express";
import { body, query, param } from "express-validator";
import { authMiddleware } from "../middlewares/auth";
import * as friendController from "../controllers/friendController";

const router = Router();

// 모든 라우트에 인증 필요
router.use(authMiddleware);

// ============================================================
// 친구 관련 엔드포인트
// ============================================================

/**
 * GET /api/v1/friends
 * 친구 목록 조회
 */
router.get(
  "/friends",
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("페이지 번호는 1 이상이어야 합니다."),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("페이지당 항목 수는 1~100 사이여야 합니다."),
  ],
  friendController.getFriends
);

/**
 * PUT /api/v1/friends/:friend_user_id/settings
 * 친구 레벨 설정 변경
 */
router.put(
  "/friends/:friend_user_id/settings",
  [
    param("friend_user_id")
      .isUUID()
      .withMessage("유효한 사용자 ID를 입력하세요."),
    body("friend_level")
      .optional()
      .isInt({ min: 0, max: 5 })
      .withMessage("친구 레벨은 0~5 사이여야 합니다."),
    body("can_view")
      .optional()
      .isBoolean()
      .withMessage("can_view는 boolean이어야 합니다."),
  ],
  friendController.updateFriendSettings
);

/**
 * DELETE /api/v1/friends/:friend_user_id
 * 친구 삭제
 */
router.delete(
  "/friends/:friend_user_id",
  [
    param("friend_user_id")
      .isUUID()
      .withMessage("유효한 사용자 ID를 입력하세요."),
  ],
  friendController.deleteFriend
);

// ============================================================
// 사용자 검색 엔드포인트
// ============================================================

/**
 * GET /api/v1/users/search
 * 사용자 검색 (친구 추가용)
 */
router.get(
  "/users/search",
  [query("query").notEmpty().withMessage("검색어를 입력하세요.").trim()],
  friendController.searchUser
);

// ============================================================
// 친구 요청 엔드포인트
// ============================================================

/**
 * POST /api/v1/friend-requests
 * 친구 요청 보내기
 */
router.post(
  "/friend-requests",
  [
    body("addressee_user_id")
      .isUUID()
      .withMessage("유효한 사용자 ID를 입력하세요."),
    body("message")
      .optional()
      .isString()
      .isLength({ max: 200 })
      .withMessage("메시지는 200자 이내여야 합니다."),
  ],
  friendController.sendFriendRequest
);

/**
 * GET /api/v1/friend-requests/received
 * 받은 친구 요청 목록 조회
 */
router.get(
  "/friend-requests/received",
  [
    query("status")
      .optional()
      .isIn(["PENDING", "ACCEPTED", "REJECTED"])
      .withMessage("유효한 상태를 입력하세요."),
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("페이지 번호는 1 이상이어야 합니다."),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("페이지당 항목 수는 1~100 사이여야 합니다."),
  ],
  friendController.getReceivedRequests
);

/**
 * GET /api/v1/friend-requests/sent
 * 보낸 친구 요청 목록 조회
 */
router.get(
  "/friend-requests/sent",
  [
    query("status")
      .optional()
      .isIn(["PENDING", "ACCEPTED", "REJECTED", "CANCELED"])
      .withMessage("유효한 상태를 입력하세요."),
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("페이지 번호는 1 이상이어야 합니다."),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("페이지당 항목 수는 1~100 사이여야 합니다."),
  ],
  friendController.getSentRequests
);

/**
 * PUT /api/v1/friend-requests/:request_id/respond
 * 친구 요청 응답 (수락/거절)
 */
router.put(
  "/friend-requests/:request_id/respond",
  [
    param("request_id").isUUID().withMessage("유효한 요청 ID를 입력하세요."),
    body("action")
      .isIn(["accept", "reject"])
      .withMessage("action은 'accept' 또는 'reject'여야 합니다."),
  ],
  friendController.respondToRequest
);

/**
 * PUT /api/v1/friend-requests/:request_id/cancel
 * 친구 요청 취소
 */
router.put(
  "/friend-requests/:request_id/cancel",
  [param("request_id").isUUID().withMessage("유효한 요청 ID를 입력하세요.")],
  friendController.cancelRequest
);

// ============================================================
// 알림 엔드포인트
// ============================================================

/**
 * GET /api/v1/notifications
 * 알림 목록 조회 (조회 시 자동 읽음 처리)
 */
router.get(
  "/notifications",
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("페이지 번호는 1 이상이어야 합니다."),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("페이지당 항목 수는 1~100 사이여야 합니다."),
  ],
  friendController.getNotifications
);

/**
 * GET /api/v1/notifications/unread-count
 * 미읽음 알림 개수 조회 (읽음 처리 하지 않음)
 */
router.get(
  "/notifications/unread-count",
  friendController.getUnreadNotificationCount
);

export default router;

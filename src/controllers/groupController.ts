import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as groupService from "../services/groupService";
import { GroupErrorCodes } from "../services/groupService";
import { logError, logGroupEvent } from "../utils/logger";

interface ErrorInfo {
  status: number;
  message: string;
}

export const group_error_http_map: Record<string, ErrorInfo> = {
  [GroupErrorCodes.INVALID_GROUP_NAME]: {
    status: 400,
    message: "그룹 이름은 trim 후 1~50자여야 합니다.",
  },
  [GroupErrorCodes.INVALID_GROUP_TIMEZONE]: {
    status: 400,
    message: "지원하는 IANA timezone을 입력해주세요.",
  },
  [GroupErrorCodes.INVALID_DATE_RANGE]: {
    status: 400,
    message: "조회 기간이 올바르지 않습니다.",
  },
  [GroupErrorCodes.GROUP_CALENDAR_RANGE_TOO_LARGE]: {
    status: 400,
    message: "그룹 캘린더 최대 조회 기간을 초과했습니다.",
  },
  [GroupErrorCodes.INVALID_GROUP_INVITATION_ACTION]: {
    status: 400,
    message: "초대 응답은 accept 또는 reject여야 합니다.",
  },
  [GroupErrorCodes.INVALID_GROUP_MEMBER_ROLE]: {
    status: 400,
    message: "멤버 역할은 ADMIN 또는 MEMBER여야 합니다.",
  },
  [GroupErrorCodes.GROUP_PERMISSION_DENIED]: {
    status: 403,
    message: "해당 그룹 작업 권한이 없습니다.",
  },
  [GroupErrorCodes.GROUP_NOT_FOUND]: {
    status: 404,
    message: "그룹을 찾을 수 없습니다.",
  },
  [GroupErrorCodes.GROUP_MEMBER_NOT_FOUND]: {
    status: 404,
    message: "활성 그룹 멤버를 찾을 수 없습니다.",
  },
  [GroupErrorCodes.GROUP_INVITATION_NOT_FOUND]: {
    status: 404,
    message: "그룹 초대를 찾을 수 없습니다.",
  },
  [GroupErrorCodes.GROUP_MEMBER_ALREADY_EXISTS]: {
    status: 409,
    message: "이미 그룹의 활성 멤버입니다.",
  },
  [GroupErrorCodes.GROUP_INVITATION_ALREADY_PENDING]: {
    status: 409,
    message: "이미 대기 중인 그룹 초대가 있습니다.",
  },
  [GroupErrorCodes.GROUP_INVITATION_ALREADY_PROCESSED]: {
    status: 409,
    message: "이미 처리된 그룹 초대입니다.",
  },
  [GroupErrorCodes.GROUP_INVITATION_EXPIRED]: {
    status: 409,
    message: "만료된 그룹 초대입니다.",
  },
  [GroupErrorCodes.GROUP_INVITEE_NOT_FRIEND]: {
    status: 409,
    message: "그룹 초대 대상은 수락된 친구여야 합니다.",
  },
  [GroupErrorCodes.GROUP_MEMBER_LIMIT_REACHED]: {
    status: 409,
    message: "그룹의 최대 활성 멤버 수에 도달했습니다.",
  },
  [GroupErrorCodes.GROUP_OWNER_CANNOT_LEAVE]: {
    status: 409,
    message: "그룹 소유자는 소유권 이전 또는 삭제 후 나갈 수 있습니다.",
  },
  [GroupErrorCodes.GROUP_OWNER_CANNOT_BE_REMOVED]: {
    status: 409,
    message: "그룹 소유자는 멤버 제거 API로 제거할 수 없습니다.",
  },
  [GroupErrorCodes.INVALID_GROUP_OWNER_TRANSFER]: {
    status: 409,
    message: "소유권을 이전할 활성 멤버가 올바르지 않습니다.",
  },
};

function actorId(req: Request): string {
  return req.user!.user_id;
}

function pageQuery(req: Request): { page: number; limit: number } {
  return {
    page: Number(req.query.page ?? 1),
    limit: Number(req.query.limit ?? 20),
  };
}

function responseSize(body: unknown): number {
  return Buffer.byteLength(JSON.stringify(body), "utf8");
}

function sendSuccess(
  req: Request,
  res: Response,
  started_at: number,
  action: string,
  status: number,
  body: unknown,
  metadata?: {
    group_id?: string;
    range_days?: number;
    member_count?: number;
    row_count?: number;
  },
): void {
  res.status(status).json(body);
  logGroupEvent({
    request_id: req.request_id,
    actor_user_id: actorId(req),
    group_id: metadata?.group_id,
    action,
    result: "success",
    duration_ms: Date.now() - started_at,
    range_days: metadata?.range_days,
    member_count: metadata?.member_count,
    row_count: metadata?.row_count,
    response_bytes: responseSize(body),
  });
}

function handleError(
  req: Request,
  res: Response,
  started_at: number,
  action: string,
  error: unknown,
  group_id?: string,
): void {
  const error_code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const error_info = group_error_http_map[error_code];
  if (error_info) {
    res.status(error_info.status).json({
      success: false,
      error: { code: error_code, message: error_info.message },
    });
    logGroupEvent({
      request_id: req.request_id,
      actor_user_id: actorId(req),
      group_id,
      action,
      result:
        error_info.status === 403 || error_code === "GROUP_NOT_FOUND"
          ? "denied"
          : "error",
      duration_ms: Date.now() - started_at,
    });
    return;
  }
  logError("group_controller_failed", error, req.request_id);
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "서버 오류가 발생했습니다.",
    },
  });
  logGroupEvent({
    request_id: req.request_id,
    actor_user_id: actorId(req),
    group_id,
    action,
    result: "error",
    duration_ms: Date.now() - started_at,
  });
}

function validate(
  req: Request,
  res: Response,
  code: keyof typeof GroupErrorCodes,
  path_codes?: Partial<
    Record<string, keyof typeof GroupErrorCodes>
  >,
): boolean {
  const errors = validationResult(req);
  if (errors.isEmpty()) return true;
  let selected_code = code;
  for (const validation_error of errors.array()) {
    if (!("path" in validation_error)) continue;
    const matched_entry = Object.entries(path_codes ?? {}).find(
      ([path]) =>
        validation_error.path === path ||
        validation_error.path.startsWith(`${path}[`),
    );
    if (matched_entry?.[1]) {
      selected_code = matched_entry[1];
      break;
    }
  }
  const error_code = GroupErrorCodes[selected_code];
  const error_info = group_error_http_map[error_code];
  res.status(error_info.status).json({
    success: false,
    error: { code: error_code, message: error_info.message },
    errors: errors.array(),
  });
  return false;
}

export async function createGroup(req: Request, res: Response): Promise<void> {
  const started_at = Date.now();
  if (
    !validate(req, res, "INVALID_GROUP_NAME", {
      timezone: "INVALID_GROUP_TIMEZONE",
      invitee_user_ids: "GROUP_INVITEE_NOT_FRIEND",
    })
  ) return;
  try {
    const result = await groupService.createGroup(actorId(req), req.body);
    const body = {
      success: true,
      data: result,
      message: "그룹이 생성되었습니다.",
    };
    sendSuccess(req, res, started_at, "create", 201, body, {
      group_id: result.group.group_id,
      member_count: result.group.member_count,
    });
  } catch (error) {
    handleError(req, res, started_at, "create", error);
  }
}

export async function getGroups(req: Request, res: Response): Promise<void> {
  const started_at = Date.now();
  if (!validate(req, res, "INVALID_DATE_RANGE")) return;
  try {
    const { page, limit } = pageQuery(req);
    const result = await groupService.getGroups(actorId(req), page, limit);
    const body = { success: true, data: result };
    sendSuccess(req, res, started_at, "list", 200, body, {
      row_count: result.groups.length,
    });
  } catch (error) {
    handleError(req, res, started_at, "list", error);
  }
}

export async function getGroupDetail(
  req: Request,
  res: Response,
): Promise<void> {
  const started_at = Date.now();
  if (!validate(req, res, "GROUP_NOT_FOUND")) return;
  try {
    const group = await groupService.getGroupDetail(
      actorId(req),
      req.params.group_id,
    );
    const body = { success: true, data: { group } };
    sendSuccess(req, res, started_at, "detail", 200, body, {
      group_id: group.group_id,
      member_count: group.member_count,
    });
  } catch (error) {
    handleError(req, res, started_at, "detail", error, req.params.group_id);
  }
}

export async function getGroupCalendarRange(
  req: Request,
  res: Response,
): Promise<void> {
  const started_at = Date.now();
  if (
    !validate(req, res, "INVALID_DATE_RANGE", {
      group_id: "GROUP_NOT_FOUND",
    })
  ) return;
  try {
    const result = await groupService.getGroupCalendarRange(
      actorId(req),
      req.params.group_id,
      String(req.query.start_date),
      String(req.query.end_date),
    );
    const { query_count: _query_count, range_days, ...calendar } = result;
    const body = { success: true, data: calendar };
    sendSuccess(req, res, started_at, "calendar_range", 200, body, {
      group_id: req.params.group_id,
      range_days,
      member_count: calendar.members.length,
      row_count: calendar.work_shifts.length + calendar.events.length,
    });
  } catch (error) {
    handleError(
      req,
      res,
      started_at,
      "calendar_range",
      error,
      req.params.group_id,
    );
  }
}

export async function createInvitations(
  req: Request,
  res: Response,
): Promise<void> {
  const started_at = Date.now();
  if (
    !validate(req, res, "GROUP_INVITEE_NOT_FRIEND", {
      group_id: "GROUP_NOT_FOUND",
    })
  ) return;
  try {
    const invitations = await groupService.inviteGroupMembers(
      actorId(req),
      req.params.group_id,
      req.body.invitee_user_ids,
      req.body.message,
    );
    const body = {
      success: true,
      data: { invitations },
      message: "그룹 초대를 보냈습니다.",
    };
    sendSuccess(req, res, started_at, "invite", 201, body, {
      group_id: req.params.group_id,
      row_count: invitations.length,
    });
  } catch (error) {
    handleError(req, res, started_at, "invite", error, req.params.group_id);
  }
}

export async function getReceivedInvitations(
  req: Request,
  res: Response,
): Promise<void> {
  const started_at = Date.now();
  if (!validate(req, res, "GROUP_INVITATION_NOT_FOUND")) return;
  try {
    const { page, limit } = pageQuery(req);
    const result = await groupService.getReceivedInvitations(
      actorId(req),
      req.query.status as string | undefined,
      page,
      limit,
    );
    const body = { success: true, data: result };
    sendSuccess(req, res, started_at, "invitation_received_list", 200, body, {
      row_count: result.invitations.length,
    });
  } catch (error) {
    handleError(req, res, started_at, "invitation_received_list", error);
  }
}

export async function respondToInvitation(
  req: Request,
  res: Response,
): Promise<void> {
  const started_at = Date.now();
  if (
    !validate(req, res, "INVALID_GROUP_INVITATION_ACTION", {
      invitation_id: "GROUP_INVITATION_NOT_FOUND",
    })
  ) return;
  try {
    const result = await groupService.respondToInvitation(
      actorId(req),
      req.params.invitation_id,
      req.body.action,
    );
    const accepted = result.invitation.status === "ACCEPTED";
    const body = {
      success: true,
      data: result,
      message: accepted
        ? "그룹 초대를 수락했습니다."
        : "그룹 초대를 거절했습니다.",
    };
    sendSuccess(req, res, started_at, "invitation_respond", 200, body, {
      group_id: result.group.group_id,
      member_count: result.group.member_count,
    });
  } catch (error) {
    handleError(req, res, started_at, "invitation_respond", error);
  }
}

export async function updateGroup(req: Request, res: Response): Promise<void> {
  const started_at = Date.now();
  if (
    !validate(req, res, "INVALID_GROUP_NAME", {
      group_id: "GROUP_NOT_FOUND",
      timezone: "INVALID_GROUP_TIMEZONE",
    })
  ) return;
  try {
    const group = await groupService.updateGroup(
      actorId(req),
      req.params.group_id,
      req.body,
    );
    const body = { success: true, data: { group } };
    sendSuccess(req, res, started_at, "update", 200, body, {
      group_id: group.group_id,
      member_count: group.member_count,
    });
  } catch (error) {
    handleError(req, res, started_at, "update", error, req.params.group_id);
  }
}

export async function deleteGroup(req: Request, res: Response): Promise<void> {
  const started_at = Date.now();
  if (!validate(req, res, "GROUP_NOT_FOUND")) return;
  try {
    const result = await groupService.deleteGroup(
      actorId(req),
      req.params.group_id,
    );
    const body = {
      success: true,
      data: result,
      message: "그룹이 삭제되었습니다.",
    };
    sendSuccess(req, res, started_at, "delete", 200, body, {
      group_id: req.params.group_id,
    });
  } catch (error) {
    handleError(req, res, started_at, "delete", error, req.params.group_id);
  }
}

export async function getGroupInvitations(
  req: Request,
  res: Response,
): Promise<void> {
  const started_at = Date.now();
  if (
    !validate(req, res, "GROUP_INVITATION_NOT_FOUND", {
      group_id: "GROUP_NOT_FOUND",
    })
  ) return;
  try {
    const { page, limit } = pageQuery(req);
    const result = await groupService.getGroupInvitations(
      actorId(req),
      req.params.group_id,
      req.query.status as string | undefined,
      page,
      limit,
    );
    const body = { success: true, data: result };
    sendSuccess(req, res, started_at, "invitation_list", 200, body, {
      group_id: req.params.group_id,
      row_count: result.invitations.length,
    });
  } catch (error) {
    handleError(
      req,
      res,
      started_at,
      "invitation_list",
      error,
      req.params.group_id,
    );
  }
}

export async function cancelInvitation(
  req: Request,
  res: Response,
): Promise<void> {
  const started_at = Date.now();
  if (!validate(req, res, "GROUP_INVITATION_NOT_FOUND")) return;
  try {
    const result = await groupService.cancelInvitation(
      actorId(req),
      req.params.invitation_id,
    );
    const body = {
      success: true,
      data: result,
      message: "그룹 초대를 취소했습니다.",
    };
    sendSuccess(req, res, started_at, "invitation_cancel", 200, body);
  } catch (error) {
    handleError(req, res, started_at, "invitation_cancel", error);
  }
}

export async function removeGroupMember(
  req: Request,
  res: Response,
): Promise<void> {
  const started_at = Date.now();
  if (
    !validate(req, res, "GROUP_MEMBER_NOT_FOUND", {
      group_id: "GROUP_NOT_FOUND",
    })
  ) return;
  try {
    const result = await groupService.removeGroupMember(
      actorId(req),
      req.params.group_id,
      req.params.user_id,
    );
    const body = {
      success: true,
      data: result,
      message: "그룹 멤버가 제거되었습니다.",
    };
    sendSuccess(req, res, started_at, "member_remove", 200, body, {
      group_id: req.params.group_id,
    });
  } catch (error) {
    handleError(
      req,
      res,
      started_at,
      "member_remove",
      error,
      req.params.group_id,
    );
  }
}

export async function updateGroupMemberRole(
  req: Request,
  res: Response,
): Promise<void> {
  const started_at = Date.now();
  if (
    !validate(req, res, "INVALID_GROUP_MEMBER_ROLE", {
      group_id: "GROUP_NOT_FOUND",
      user_id: "GROUP_MEMBER_NOT_FOUND",
    })
  ) return;
  try {
    const result = await groupService.updateGroupMemberRole(
      actorId(req),
      req.params.group_id,
      req.params.user_id,
      req.body.role,
    );
    const body = { success: true, data: result };
    sendSuccess(req, res, started_at, "member_role_update", 200, body, {
      group_id: req.params.group_id,
    });
  } catch (error) {
    handleError(
      req,
      res,
      started_at,
      "member_role_update",
      error,
      req.params.group_id,
    );
  }
}

export async function leaveGroup(req: Request, res: Response): Promise<void> {
  const started_at = Date.now();
  if (!validate(req, res, "GROUP_NOT_FOUND")) return;
  try {
    const result = await groupService.leaveGroup(
      actorId(req),
      req.params.group_id,
    );
    const body = {
      success: true,
      data: result,
      message: "그룹에서 나갔습니다.",
    };
    sendSuccess(req, res, started_at, "leave", 200, body, {
      group_id: req.params.group_id,
    });
  } catch (error) {
    handleError(req, res, started_at, "leave", error, req.params.group_id);
  }
}

export async function transferGroupOwner(
  req: Request,
  res: Response,
): Promise<void> {
  const started_at = Date.now();
  if (
    !validate(req, res, "INVALID_GROUP_OWNER_TRANSFER", {
      group_id: "GROUP_NOT_FOUND",
    })
  ) return;
  try {
    const group = await groupService.transferGroupOwner(
      actorId(req),
      req.params.group_id,
      req.body.new_owner_user_id,
    );
    const body = {
      success: true,
      data: { group },
      message: "그룹 소유권을 이전했습니다.",
    };
    sendSuccess(req, res, started_at, "owner_transfer", 200, body, {
      group_id: req.params.group_id,
      member_count: group.member_count,
    });
  } catch (error) {
    handleError(
      req,
      res,
      started_at,
      "owner_transfer",
      error,
      req.params.group_id,
    );
  }
}

import { Request, Response } from "express";
import { validationResult } from "express-validator";
import { User, WorkShift, ShiftTypeSchedule, ShiftType } from "../models";
import * as calendarService from "../services/calendarService";
import * as shiftTemplateService from "../services/shiftTemplateService";

// Express Request에 user 속성 추가 타입
interface AuthenticatedRequest extends Request {
  user?: User;
}

/**
 * 근무 타입 정보 조회
 * GET /api/v1/shift-types
 */
export async function getShiftTypes(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;

    const result = await calendarService.getShiftTypes(user_id);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Get shift types error:", error);
    if (error.message === "TEMPLATE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "TEMPLATE_NOT_FOUND",
          message: "활성 템플릿을 찾을 수 없습니다.",
        },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 기간별 근무표 조회
 * GET /api/v1/work-shifts?start_date=&end_date=
 */
export async function getWorkShifts(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "start_date와 end_date가 필요합니다.",
        },
      });
      return;
    }

    if (typeof start_date !== "string" || typeof end_date !== "string") {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "날짜 형식이 올바르지 않습니다.",
        },
      });
      return;
    }

    // 날짜 형식 검증 (YYYY-MM-DD)
    const date_regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!date_regex.test(start_date) || !date_regex.test(end_date)) {
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_DATE_RANGE",
          message: "날짜 범위가 유효하지 않습니다. (YYYY-MM-DD 형식 필요)",
        },
      });
      return;
    }

    if (start_date > end_date) {
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_DATE_RANGE",
          message: "시작 날짜가 종료 날짜보다 늦을 수 없습니다.",
        },
      });
      return;
    }

    const work_shifts = await calendarService.getWorkShifts(
      user_id,
      start_date,
      end_date
    );

    res.json({
      success: true,
      data: {
        work_shifts,
      },
    });
  } catch (error: any) {
    console.error("Get work shifts error:", error);
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 특정 날짜의 일정 조회 (근무표 + 개인 일정)
 * GET /api/v1/calendar/day?date=
 */
export async function getDaySchedule(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const { date } = req.query;

    if (!date || typeof date !== "string") {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "date 파라미터가 필요합니다.",
        },
      });
      return;
    }

    // 날짜 형식 검증 (YYYY-MM-DD)
    const date_regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!date_regex.test(date)) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD 형식 필요)",
        },
      });
      return;
    }

    const result = await calendarService.getDaySchedule(user_id, date);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Get day schedule error:", error);
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 기간별 일정 조회
 * GET /api/v1/events?start_date=&end_date=
 */
export async function getEvents(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "start_date와 end_date가 필요합니다.",
        },
      });
      return;
    }

    if (typeof start_date !== "string" || typeof end_date !== "string") {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "날짜 형식이 올바르지 않습니다.",
        },
      });
      return;
    }

    // 날짜 형식 검증 (YYYY-MM-DD)
    const date_regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!date_regex.test(start_date) || !date_regex.test(end_date)) {
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_DATE_RANGE",
          message: "날짜 범위가 유효하지 않습니다. (YYYY-MM-DD 형식 필요)",
        },
      });
      return;
    }

    if (start_date > end_date) {
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_DATE_RANGE",
          message: "시작 날짜가 종료 날짜보다 늦을 수 없습니다.",
        },
      });
      return;
    }

    const events = await calendarService.getEvents(
      user_id,
      start_date,
      end_date
    );

    res.json({
      success: true,
      data: {
        events,
      },
    });
  } catch (error: any) {
    console.error("Get events error:", error);
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 일정 삭제 (soft delete)
 * DELETE /api/v1/events/:event_id
 */
export async function deleteEvent(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const { event_id } = req.params;

    await calendarService.deleteEvent(user_id, event_id);

    res.json({
      success: true,
      data: {
        event_id,
      },
    });
  } catch (error: any) {
    console.error("Delete event error:", error);
    if (error.message === "EVENT_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "일정을 찾을 수 없습니다.",
        },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 기간별 캘린더 데이터 조회 (근무표 + 일정)
 * GET /api/v1/calendar/range?start_date=&end_date=
 */
export async function getCalendarRange(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "start_date와 end_date가 필요합니다.",
        },
      });
      return;
    }

    if (typeof start_date !== "string" || typeof end_date !== "string") {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "날짜 형식이 올바르지 않습니다.",
        },
      });
      return;
    }

    // 날짜 형식 검증 (YYYY-MM-DD)
    const date_regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!date_regex.test(start_date) || !date_regex.test(end_date)) {
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_DATE_RANGE",
          message: "날짜 범위가 유효하지 않습니다. (YYYY-MM-DD 형식 필요)",
        },
      });
      return;
    }

    if (start_date > end_date) {
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_DATE_RANGE",
          message: "시작 날짜가 종료 날짜보다 늦을 수 없습니다.",
        },
      });
      return;
    }

    const result = await calendarService.getCalendarRange(
      user_id,
      start_date,
      end_date
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Get calendar range error:", error);
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 근무표 생성/수정 (UPSERT)
 * POST /api/v1/work-shifts
 */
export async function upsertWorkShift(
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
          message: "요청 파라미터 오류",
          details: errors.array(),
        },
      });
      return;
    }

    const user_id = req.user!.user_id;
    const { work_date, shift_type_code, note } = req.body;

    if (!work_date || !shift_type_code) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "work_date와 shift_type_code가 필요합니다.",
        },
      });
      return;
    }

    const work_shift = await calendarService.upsertWorkShift(
      user_id,
      work_date,
      shift_type_code,
      note
    );

    // 응답을 위해 schedule 정보 포함하여 조회
    const work_shift_with_details = await WorkShift.findByPk(
      work_shift.work_shift_id,
      {
        include: [
          {
            model: ShiftTypeSchedule,
            as: "schedule",
            required: true,
            include: [
              {
                model: ShiftType,
                as: "shift_type",
                required: true,
              },
            ],
          },
        ],
      }
    );

    if (!work_shift_with_details) {
      res.status(500).json({
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "근무표 조회 중 오류가 발생했습니다.",
        },
      });
      return;
    }

    const schedule = (work_shift_with_details as any).schedule;
    const shift_type = schedule?.shift_type;

    res.json({
      success: true,
      data: {
        work_shift_id: work_shift_with_details.work_shift_id,
        work_date: work_shift_with_details.work_date
          .toISOString()
          .split("T")[0],
        shift_type_code: shift_type?.code || "",
        shift_type_name: shift_type?.name || "",
        shift_type_color: shift_type?.color || null,
        start_time: schedule?.start_time || null,
        end_time: schedule?.end_time || null,
        note: work_shift_with_details.note || null,
        created_at: work_shift_with_details.created_at,
        updated_at: work_shift_with_details.updated_at,
      },
    });
  } catch (error: any) {
    console.error("Upsert work shift error:", error);
    if (error.message === "SHIFT_TYPE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "SHIFT_TYPE_NOT_FOUND",
          message: "근무 타입을 찾을 수 없습니다.",
        },
      });
      return;
    }
    if (error.message === "TEMPLATE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "TEMPLATE_NOT_FOUND",
          message: "활성 템플릿을 찾을 수 없습니다.",
        },
      });
      return;
    }
    if (error.message === "SCHEDULE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "SCHEDULE_NOT_FOUND",
          message: "근무 시간표를 찾을 수 없습니다.",
        },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 근무표 수정
 * PUT /api/v1/work-shifts/:work_shift_id
 */
export async function updateWorkShift(
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
          message: "요청 파라미터 오류",
          details: errors.array(),
        },
      });
      return;
    }

    const user_id = req.user!.user_id;
    const { work_shift_id } = req.params;
    const { shift_type_code, note } = req.body;

    const work_shift = await calendarService.updateWorkShift(
      user_id,
      work_shift_id,
      shift_type_code,
      note
    );

    // 응답을 위해 schedule 정보 포함하여 조회
    const work_shift_with_details = await WorkShift.findByPk(
      work_shift.work_shift_id,
      {
        include: [
          {
            model: ShiftTypeSchedule,
            as: "schedule",
            required: true,
            include: [
              {
                model: ShiftType,
                as: "shift_type",
                required: true,
              },
            ],
          },
        ],
      }
    );

    if (!work_shift_with_details) {
      res.status(500).json({
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "근무표 조회 중 오류가 발생했습니다.",
        },
      });
      return;
    }

    const schedule = (work_shift_with_details as any).schedule;
    const shift_type = schedule?.shift_type;

    res.json({
      success: true,
      data: {
        work_shift_id: work_shift_with_details.work_shift_id,
        work_date: work_shift_with_details.work_date
          .toISOString()
          .split("T")[0],
        shift_type_code: shift_type?.code || "",
        shift_type_name: shift_type?.name || "",
        shift_type_color: shift_type?.color || null,
        start_time: schedule?.start_time || null,
        end_time: schedule?.end_time || null,
        note: work_shift_with_details.note || null,
        created_at: work_shift_with_details.created_at,
        updated_at: work_shift_with_details.updated_at,
      },
    });
  } catch (error: any) {
    console.error("Update work shift error:", error);
    if (error.message === "WORK_SHIFT_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "근무표를 찾을 수 없습니다.",
        },
      });
      return;
    }
    if (error.message === "SHIFT_TYPE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "SHIFT_TYPE_NOT_FOUND",
          message: "근무 타입을 찾을 수 없습니다.",
        },
      });
      return;
    }
    if (error.message === "TEMPLATE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "TEMPLATE_NOT_FOUND",
          message: "활성 템플릿을 찾을 수 없습니다.",
        },
      });
      return;
    }
    if (error.message === "SCHEDULE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "SCHEDULE_NOT_FOUND",
          message: "근무 시간표를 찾을 수 없습니다.",
        },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 근무표 삭제 (soft delete)
 * DELETE /api/v1/work-shifts/:work_shift_id
 */
export async function deleteWorkShift(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const { work_shift_id } = req.params;

    await calendarService.deleteWorkShift(user_id, work_shift_id);

    res.json({
      success: true,
      data: {
        work_shift_id,
      },
    });
  } catch (error: any) {
    console.error("Delete work shift error:", error);
    if (error.message === "WORK_SHIFT_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "근무표를 찾을 수 없습니다.",
        },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 근무표 배치 생성/수정 (UPSERT)
 * POST /api/v1/work-shifts/batch
 */
export async function batchUpsertWorkShifts(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const { work_shifts } = req.body;

    // 1. 요청 데이터 검증
    if (!Array.isArray(work_shifts) || work_shifts.length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "work_shifts 배열이 필요합니다.",
        },
      });
      return;
    }

    if (work_shifts.length > 100) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "최대 100개의 근무 일정만 한 번에 저장할 수 있습니다.",
        },
      });
      return;
    }

    // 2. 각 항목 검증
    const date_regex = /^\d{4}-\d{2}-\d{2}$/;
    for (const ws of work_shifts) {
      if (!ws.work_date || !ws.shift_type_code) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "work_date와 shift_type_code는 필수입니다.",
          },
        });
        return;
      }

      // 날짜 형식 검증
      if (!date_regex.test(ws.work_date)) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)",
          },
        });
        return;
      }

      // shift_type_code 타입 검증
      if (typeof ws.shift_type_code !== "string") {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "shift_type_code는 문자열이어야 합니다.",
          },
        });
        return;
      }
    }

    // 3. 서비스 호출
    const saved_work_shifts = await calendarService.batchUpsertWorkShifts(
      user_id,
      work_shifts
    );

    // 4. 성공 응답
    res.json({
      success: true,
      data: {
        work_shifts: saved_work_shifts,
      },
    });
  } catch (error: any) {
    console.error("Batch upsert work shifts error:", error);

    // 중복 날짜 에러
    if (error.message === "DUPLICATE_DATE") {
      res.status(400).json({
        success: false,
        error: {
          code: "DUPLICATE_DATE",
          message: "요청에 중복된 날짜가 포함되어 있습니다.",
          details: {
            duplicate_dates: error.duplicate_dates || [],
          },
        },
      });
      return;
    }

    // 유효하지 않은 shift_type_code
    if (error.message === "INVALID_SHIFT_TYPE") {
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_SHIFT_TYPE",
          message: "유효하지 않은 근무 타입 코드입니다.",
          details: {
            invalid_codes: [error.invalid_code],
            work_date: error.work_date,
          },
        },
      });
      return;
    }

    // 템플릿 없음
    if (error.message === "TEMPLATE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "TEMPLATE_NOT_FOUND",
          message: "활성 템플릿을 찾을 수 없습니다.",
        },
      });
      return;
    }

    // 스케줄 없음
    if (error.message === "SCHEDULE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "SCHEDULE_NOT_FOUND",
          message: "근무 시간표를 찾을 수 없습니다.",
          details: {
            work_date: error.work_date,
          },
        },
      });
      return;
    }

    // 템플릿 버전 없음
    if (error.message === "TEMPLATE_VERSION_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "TEMPLATE_VERSION_NOT_FOUND",
          message: "템플릿 버전을 찾을 수 없습니다.",
          details: {
            work_date: error.work_date,
          },
        },
      });
      return;
    }

    // 해당 날짜에 유효한 버전 없음
    if (error.message === "NO_VALID_VERSION_FOR_DATE") {
      res.status(400).json({
        success: false,
        error: {
          code: "NO_VALID_VERSION_FOR_DATE",
          message: "해당 날짜에 유효한 템플릿 버전이 없습니다.",
          details: {
            work_date: error.work_date,
            earliest_version_date: error.earliest_version_date,
          },
        },
      });
      return;
    }

    // DB 제약 위반 (UNIQUE 제약 - 하루에 2개 이상)
    if (error.name === "SequelizeUniqueConstraintError") {
      const work_shifts_data = req.body.work_shifts || [];
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "하루에 하나의 근무만 설정할 수 있습니다.",
          details: {
            conflicting_dates: Array.isArray(work_shifts_data)
              ? work_shifts_data.map((ws: any) => ws.work_date)
              : [],
          },
        },
      });
      return;
    }

    // 기타 에러
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: error.message || "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 현재 사용자의 활성 템플릿 조회
 * GET /api/v1/shift-templates/current
 */
export async function getCurrentTemplate(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;

    const result = await shiftTemplateService.getCurrentTemplate(user_id);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Get current template error:", error);
    if (error.message === "TEMPLATE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "TEMPLATE_NOT_FOUND",
          message: "활성 템플릿을 찾을 수 없습니다.",
        },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 템플릿 이름 변경
 * PUT /api/v1/shift-templates/current
 */
export async function updateCurrentTemplate(
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
    const { name } = req.body;

    const result = await shiftTemplateService.updateTemplateName(user_id, name);

    res.json({
      success: true,
      data: {
        template_id: result.template_id,
        template_name: result.name,
        updated_at: result.created_at, // 모델에 updated_at이 없어서 created_at 사용
      },
    });
  } catch (error: any) {
    console.error("Update current template error:", error);
    if (error.message === "TEMPLATE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "TEMPLATE_NOT_FOUND",
          message: "활성 템플릿을 찾을 수 없습니다.",
        },
      });
      return;
    }
    if (error.message === "DUPLICATE_NAME") {
      res.status(400).json({
        success: false,
        error: {
          code: "DUPLICATE_NAME",
          message: "이미 사용 중인 템플릿 이름입니다.",
        },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 근무 타입 추가
 * POST /api/v1/shift-types
 */
export async function createShiftType(
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
    const { code, name, color, start_time, end_time, sort_order } = req.body;

    const result = await shiftTemplateService.createShiftType(user_id, {
      code,
      name,
      color: color ?? null,
      start_time: start_time ?? null,
      end_time: end_time ?? null,
      sort_order: sort_order ?? null,
    });

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Create shift type error:", error);
    if (error.message === "TEMPLATE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "TEMPLATE_NOT_FOUND",
          message: "활성 템플릿을 찾을 수 없습니다.",
        },
      });
      return;
    }
    if (error.message === "MAX_SHIFT_TYPES_EXCEEDED") {
      res.status(400).json({
        success: false,
        error: {
          code: "MAX_SHIFT_TYPES_EXCEEDED",
          message: "근무 타입은 템플릿당 최대 10개까지 추가할 수 있습니다.",
        },
      });
      return;
    }
    // DB unique constraint 위반 (마이그레이션 미적용 시 발생 가능)
    if (error.name === "SequelizeUniqueConstraintError") {
      res.status(400).json({
        success: false,
        error: {
          code: "DUPLICATE_CODE",
          message: "이미 동일한 코드의 근무 타입이 존재합니다.",
        },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 근무 타입 수정
 * PUT /api/v1/shift-types/:shift_type_id
 */
export async function updateShiftType(
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
    const { shift_type_id } = req.params;
    const { code, name, color, start_time, end_time, sort_order } = req.body;

    const result = await shiftTemplateService.updateShiftType(
      user_id,
      shift_type_id,
      {
        code: code !== undefined ? code : undefined,
        name,
        color: color !== undefined ? color : undefined,
        start_time: start_time !== undefined ? start_time : undefined,
        end_time: end_time !== undefined ? end_time : undefined,
        sort_order: sort_order !== undefined ? sort_order : undefined,
      }
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Update shift type error:", error);
    if (error.message === "SHIFT_TYPE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "SHIFT_TYPE_NOT_FOUND",
          message: "근무 타입을 찾을 수 없습니다.",
        },
      });
      return;
    }
    if (error.message === "FORBIDDEN") {
      res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "다른 사용자의 근무 타입을 수정할 수 없습니다.",
        },
      });
      return;
    }
    if (error.message === "TEMPLATE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "TEMPLATE_NOT_FOUND",
          message: "활성 템플릿을 찾을 수 없습니다.",
        },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

/**
 * 근무 타입 삭제
 * DELETE /api/v1/shift-types/:shift_type_id
 */
export async function deleteShiftType(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const { shift_type_id } = req.params;

    const result = await shiftTemplateService.deleteShiftType(
      user_id,
      shift_type_id
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Delete shift type error:", error);
    if (error.message === "SHIFT_TYPE_NOT_FOUND") {
      res.status(404).json({
        success: false,
        error: {
          code: "SHIFT_TYPE_NOT_FOUND",
          message: "근무 타입을 찾을 수 없습니다.",
        },
      });
      return;
    }
    if (error.message === "FORBIDDEN") {
      res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "다른 사용자의 근무 타입을 삭제할 수 없습니다.",
        },
      });
      return;
    }
    if (error.message === "IN_USE") {
      res.status(409).json({
        success: false,
        error: {
          code: "IN_USE",
          message: "해당 근무 타입이 사용 중이어서 삭제할 수 없습니다.",
        },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "서버 오류가 발생했습니다.",
      },
    });
  }
}

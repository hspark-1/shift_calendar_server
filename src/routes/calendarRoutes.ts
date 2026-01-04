import { Router } from "express";
import { body, query } from "express-validator";
import {
  getShiftTypes,
  getWorkShifts,
  getDaySchedule,
  getEvents,
  deleteEvent,
  getCalendarRange,
  upsertWorkShift,
  updateWorkShift,
  deleteWorkShift,
  batchUpsertWorkShifts,
  getCurrentTemplate,
  updateCurrentTemplate,
  createShiftType,
  updateShiftType,
  deleteShiftType,
} from "../controllers/calendarController";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// 모든 라우트에 인증 미들웨어 적용
router.use(authMiddleware);

// 템플릿 관련
router.get("/shift-templates/current", getCurrentTemplate);
router.put(
  "/shift-templates/current",
  [
    body("name")
      .notEmpty()
      .withMessage("템플릿 이름을 입력하세요.")
      .isString()
      .withMessage("템플릿 이름은 문자열이어야 합니다."),
  ],
  updateCurrentTemplate
);

// 근무 타입 정보 조회
router.get("/shift-types", getShiftTypes);

// 기간별 근무표 조회
router.get(
  "/work-shifts",
  [
    query("start_date")
      .isISO8601()
      .withMessage("유효한 시작 날짜를 입력하세요. (YYYY-MM-DD)"),
    query("end_date")
      .isISO8601()
      .withMessage("유효한 종료 날짜를 입력하세요. (YYYY-MM-DD)"),
  ],
  getWorkShifts
);

// 특정 날짜의 일정 조회
router.get(
  "/calendar/day",
  [
    query("date")
      .isISO8601()
      .withMessage("유효한 날짜를 입력하세요. (YYYY-MM-DD)"),
  ],
  getDaySchedule
);

// 기간별 일정 조회
router.get(
  "/events",
  [
    query("start_date")
      .isISO8601()
      .withMessage("유효한 시작 날짜를 입력하세요. (YYYY-MM-DD)"),
    query("end_date")
      .isISO8601()
      .withMessage("유효한 종료 날짜를 입력하세요. (YYYY-MM-DD)"),
  ],
  getEvents
);

// 일정 삭제
router.delete("/events/:event_id", deleteEvent);

// 기간별 캘린더 데이터 조회 (근무표 + 일정)
router.get(
  "/calendar/range",
  [
    query("start_date")
      .isISO8601()
      .withMessage("유효한 시작 날짜를 입력하세요. (YYYY-MM-DD)"),
    query("end_date")
      .isISO8601()
      .withMessage("유효한 종료 날짜를 입력하세요. (YYYY-MM-DD)"),
  ],
  getCalendarRange
);

// 근무표 생성/수정 (UPSERT)
router.post(
  "/work-shifts",
  [
    body("work_date")
      .isISO8601()
      .withMessage("유효한 날짜를 입력하세요. (YYYY-MM-DD)"),
    body("shift_type_code")
      .notEmpty()
      .withMessage("근무 타입 코드를 입력하세요."),
    body("note").optional().isString(),
  ],
  upsertWorkShift
);

// 근무표 수정
router.put(
  "/work-shifts/:work_shift_id",
  [
    body("shift_type_code").optional().notEmpty(),
    body("note").optional().isString(),
  ],
  updateWorkShift
);

// 근무표 삭제
router.delete("/work-shifts/:work_shift_id", deleteWorkShift);

// 근무표 배치 생성/수정 (UPSERT)
router.post(
  "/work-shifts/batch",
  [
    body("work_shifts")
      .isArray({ min: 1, max: 100 })
      .withMessage("work_shifts는 1개 이상 100개 이하의 배열이어야 합니다."),
    body("work_shifts.*.work_date")
      .isISO8601()
      .withMessage("유효한 날짜를 입력하세요. (YYYY-MM-DD)"),
    body("work_shifts.*.shift_type_code")
      .notEmpty()
      .withMessage("근무 타입 코드를 입력하세요."),
    body("work_shifts.*.note").optional().isString(),
  ],
  batchUpsertWorkShifts
);

// 근무 타입 관리
router.post(
  "/shift-types",
  [
    body("code")
      .notEmpty()
      .withMessage("근무 타입 코드를 입력하세요.")
      .isString()
      .withMessage("근무 타입 코드는 문자열이어야 합니다."),
    body("name")
      .notEmpty()
      .withMessage("근무 타입 이름을 입력하세요.")
      .isString()
      .withMessage("근무 타입 이름은 문자열이어야 합니다."),
    body("color").optional().isInt().withMessage("색상은 정수여야 합니다."),
    body("start_time")
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        if (value === null || value === undefined || value === "") {
          return true;
        }
        return /^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(value);
      })
      .withMessage("시작 시간은 HH:mm:ss 형식이거나 null이어야 합니다."),
    body("end_time")
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        if (value === null || value === undefined || value === "") {
          return true;
        }
        return /^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(value);
      })
      .withMessage("종료 시간은 HH:mm:ss 형식이거나 null이어야 합니다."),
    body("sort_order")
      .optional()
      .isInt({ min: 0 })
      .withMessage("정렬 순서는 0 이상의 정수여야 합니다."),
  ],
  createShiftType
);

router.put(
  "/shift-types/:shift_type_id",
  [
    body("code")
      .optional()
      .notEmpty()
      .withMessage("근무 타입 코드를 입력하세요.")
      .isString()
      .withMessage("근무 타입 코드는 문자열이어야 합니다."),
    body("name")
      .optional()
      .notEmpty()
      .withMessage("근무 타입 이름을 입력하세요.")
      .isString()
      .withMessage("근무 타입 이름은 문자열이어야 합니다."),
    body("color").optional().isInt().withMessage("색상은 정수여야 합니다."),
    body("start_time")
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        if (value === null || value === undefined || value === "") {
          return true;
        }
        return /^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(value);
      })
      .withMessage("시작 시간은 HH:mm:ss 형식이거나 null이어야 합니다."),
    body("end_time")
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        if (value === null || value === undefined || value === "") {
          return true;
        }
        return /^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(value);
      })
      .withMessage("종료 시간은 HH:mm:ss 형식이거나 null이어야 합니다."),
    body("sort_order")
      .optional()
      .isInt({ min: 0 })
      .withMessage("정렬 순서는 0 이상의 정수여야 합니다."),
  ],
  updateShiftType
);

router.delete("/shift-types/:shift_type_id", deleteShiftType);

export default router;

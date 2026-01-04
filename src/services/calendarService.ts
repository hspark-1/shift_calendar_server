import { Op, Transaction } from "sequelize";
import {
  ShiftTemplate,
  ShiftTemplateVersion,
  ShiftType,
  ShiftTypeSchedule,
  WorkShift,
  Event,
} from "../models";
import { sequelize } from "../config/database";

/**
 * 사용자의 활성 템플릿에 속한 근무 타입 목록과 시간표 정보 조회
 */
export async function getShiftTypes(user_id: string): Promise<{
  template_id: string;
  template_name: string;
  shift_types: Array<{
    shift_type_id: string;
    code: string;
    name: string;
    color: number | null;
    sort_order: number | null;
    start_time: string | null;
    end_time: string | null;
    crosses_midnight: boolean;
    duration_minutes: number;
  }>;
}> {
  // 1. 사용자의 활성 템플릿 조회
  const template = await ShiftTemplate.findOne({
    where: {
      owner_user_id: user_id,
      deleted_at: null,
    },
  });

  if (!template) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }

  // 2. 최신 버전 조회
  const latest_version = await ShiftTemplateVersion.findOne({
    where: {
      template_id: template.template_id,
    },
    order: [["effective_from", "DESC"]],
  });

  if (!latest_version) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }

  // 3. 근무 타입과 시간표 조회
  const shift_types = await ShiftType.findAll({
    where: {
      template_id: template.template_id,
      deleted_at: null,
    },
    include: [
      {
        model: ShiftTypeSchedule,
        as: "schedules",
        where: {
          template_version_id: latest_version.template_version_id,
        },
        required: false, // LEFT JOIN
      },
    ],
    order: [["sort_order", "ASC"]],
  });

  const result = shift_types.map((st) => {
    const schedules = (st as any).schedules as ShiftTypeSchedule[] | undefined;
    const schedule = schedules?.[0]; // 최대 1개
    return {
      shift_type_id: st.shift_type_id,
      code: st.code,
      name: st.name,
      color: st.color ?? null,
      sort_order: st.sort_order ?? null,
      start_time: schedule?.start_time || null,
      end_time: schedule?.end_time || null,
      crosses_midnight: schedule?.crosses_midnight || false,
      duration_minutes: schedule?.duration_minutes || 0,
    };
  });

  return {
    template_id: template.template_id,
    template_name: template.name,
    shift_types: result,
  };
}

/**
 * 기간별 근무표 조회
 */
export async function getWorkShifts(
  user_id: string,
  start_date: string,
  end_date: string
): Promise<
  Array<{
    work_shift_id: string;
    work_date: string;
    shift_type_code: string;
    shift_type_name: string;
    shift_type_color: number | null;
    start_time: string | null;
    end_time: string | null;
    note: string | null;
    created_at: Date;
    updated_at: Date;
  }>
> {
  const work_shifts = await WorkShift.findAll({
    where: {
      owner_user_id: user_id,
      work_date: {
        [Op.between]: [start_date, end_date],
      },
      deleted_at: null,
    },
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
    order: [["work_date", "ASC"]],
  });

  return work_shifts.map((ws) => {
    const schedule = (ws as any).schedule as
      | (ShiftTypeSchedule & { shift_type?: ShiftType })
      | undefined;
    const shift_type = schedule?.shift_type;

    // work_date가 Date 객체인지 확인하고, 아니면 문자열로 처리
    const work_date_str =
      ws.work_date instanceof Date
        ? ws.work_date.toISOString().split("T")[0]
        : typeof ws.work_date === "string"
        ? ws.work_date
        : String(ws.work_date);

    return {
      work_shift_id: ws.work_shift_id,
      work_date: work_date_str, // YYYY-MM-DD
      shift_type_code: shift_type?.code || "",
      shift_type_name: shift_type?.name || "",
      shift_type_color: shift_type?.color ?? null,
      start_time: schedule?.start_time || null,
      end_time: schedule?.end_time || null,
      note: ws.note || null,
      created_at: ws.created_at!,
      updated_at: ws.updated_at!,
    };
  });
}

/**
 * 기간별 일정 조회
 */
export async function getEvents(
  user_id: string,
  start_date: string,
  end_date: string
): Promise<
  Array<{
    event_id: string;
    title: string;
    memo: string | null;
    place: string | null;
    all_day: boolean;
    start_at: Date;
    end_at: Date;
    visibility_level: number;
  }>
> {
  // 날짜를 Date 객체로 변환 (로컬 타임존 기준)
  // start_date의 시작 시각 (00:00:00)
  const start_date_utc = new Date(start_date);
  start_date_utc.setHours(0, 0, 0, 0);

  // end_date의 종료 시각 (23:59:59.999)
  const end_date_utc = new Date(end_date);
  end_date_utc.setHours(23, 59, 59, 999);

  // 기간 겹침 조건: start_at <= end_date AND end_at >= start_date
  const events = await Event.findAll({
    where: {
      owner_user_id: user_id,
      deleted_at: null,
      [Op.and]: [
        { start_at: { [Op.lte]: end_date_utc } },
        { end_at: { [Op.gte]: start_date_utc } },
      ],
    },
    order: [["start_at", "ASC"]],
  });

  return events.map((e) => ({
    event_id: e.event_id,
    title: e.title,
    memo: e.memo || null,
    place: e.place || null,
    all_day: e.all_day,
    start_at: e.start_at,
    end_at: e.end_at,
    visibility_level: e.visibility_level,
  }));
}

/**
 * 기간별 캘린더 데이터 조회 (근무표 + 일정)
 */
export async function getCalendarRange(
  user_id: string,
  start_date: string,
  end_date: string
): Promise<{
  work_shifts: Array<{
    work_shift_id: string;
    work_date: string;
    shift_type_code: string;
    shift_type_name: string;
    shift_type_color: number | null;
    start_time: string | null;
    end_time: string | null;
    note: string | null;
    created_at: Date;
    updated_at: Date;
  }>;
  events: Array<{
    event_id: string;
    title: string;
    memo: string | null;
    place: string | null;
    all_day: boolean;
    start_at: Date;
    end_at: Date;
    visibility_level: number;
  }>;
}> {
  // 병렬 쿼리 실행
  const [work_shifts, events] = await Promise.all([
    getWorkShifts(user_id, start_date, end_date),
    getEvents(user_id, start_date, end_date),
  ]);

  return {
    work_shifts,
    events,
  };
}

/**
 * 특정 날짜의 일정 조회 (근무표 + 개인 일정)
 */
export async function getDaySchedule(
  user_id: string,
  date: string
): Promise<{
  date: string;
  work_shifts: Array<{
    work_shift_id: string;
    shift_type_code: string;
    shift_type_name: string;
    shift_type_color: number | null;
    start_time: string | null;
    end_time: string | null;
    note: string | null;
  }>;
  events: Array<{
    event_id: string;
    title: string;
    memo: string | null;
    place: string | null;
    all_day: boolean;
    start_at: Date;
    end_at: Date;
    visibility_level: number;
  }>;
}> {
  // 근무표 조회
  const work_shift = await WorkShift.findOne({
    where: {
      owner_user_id: user_id,
      work_date: date,
      deleted_at: null,
    },
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
  });

  // 개인 일정 조회 (해당 날짜에 시작하는 일정)
  const start_of_day = new Date(date);
  start_of_day.setHours(0, 0, 0, 0);
  const end_of_day = new Date(date);
  end_of_day.setHours(23, 59, 59, 999);

  const events = await Event.findAll({
    where: {
      owner_user_id: user_id,
      start_at: {
        [Op.between]: [start_of_day, end_of_day],
      },
      deleted_at: null,
    },
    order: [["start_at", "ASC"]],
  });

  const work_shifts_result = work_shift
    ? (() => {
        const schedule = (work_shift as any).schedule as
          | (ShiftTypeSchedule & { shift_type?: ShiftType })
          | undefined;
        const shift_type = schedule?.shift_type;
        return [
          {
            work_shift_id: work_shift.work_shift_id,
            shift_type_code: shift_type?.code || "",
            shift_type_name: shift_type?.name || "",
            shift_type_color: shift_type?.color ?? null,
            start_time: schedule?.start_time || null,
            end_time: schedule?.end_time || null,
            note: work_shift.note || null,
          },
        ];
      })()
    : [];

  const events_result = events.map((e) => ({
    event_id: e.event_id,
    title: e.title,
    memo: e.memo || null,
    place: e.place || null,
    all_day: e.all_day,
    start_at: e.start_at,
    end_at: e.end_at,
    visibility_level: e.visibility_level,
  }));

  return {
    date,
    work_shifts: work_shifts_result,
    events: events_result,
  };
}

/**
 * 근무표 생성/수정 (UPSERT)
 */
export async function upsertWorkShift(
  user_id: string,
  work_date: string,
  shift_type_code: string,
  note?: string | null
): Promise<WorkShift> {
  // 1. shift_type_code로 shift_type_id 조회
  const shift_type = await ShiftType.findOne({
    where: {
      code: shift_type_code,
      deleted_at: null,
    },
    include: [
      {
        model: ShiftTemplate,
        as: "template",
        where: {
          owner_user_id: user_id,
          deleted_at: null,
        },
        required: true,
      },
    ],
  });

  if (!shift_type) {
    throw new Error("SHIFT_TYPE_NOT_FOUND");
  }

  // 2. 현재 활성 템플릿 버전의 schedule_id 조회
  const template = await ShiftTemplate.findOne({
    where: {
      owner_user_id: user_id,
      deleted_at: null,
    },
  });

  if (!template) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }

  const latest_version = await ShiftTemplateVersion.findOne({
    where: {
      template_id: template.template_id,
    },
    order: [["effective_from", "DESC"]],
  });

  if (!latest_version) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }

  let schedule = await ShiftTypeSchedule.findOne({
    where: {
      shift_type_id: shift_type.shift_type_id,
      template_version_id: latest_version.template_version_id,
    },
  });

  // 스케줄이 없으면 기본 스케줄 생성 (시간 정보 없이 생성된 shift_type 대응)
  if (!schedule) {
    schedule = await ShiftTypeSchedule.create({
      shift_type_id: shift_type.shift_type_id,
      template_version_id: latest_version.template_version_id,
      start_time: null,
      end_time: null,
      crosses_midnight: false,
      duration_minutes: 0,
    });
  }

  // 3. UPSERT
  const [work_shift] = await WorkShift.upsert(
    {
      owner_user_id: user_id,
      work_date: new Date(work_date),
      schedule_id: schedule.schedule_id,
      note: note || null,
      visibility_level: 0,
      created_by_user_id: user_id,
    },
    {
      returning: true,
      conflictFields: ["owner_user_id", "work_date"],
    }
  );

  return work_shift;
}

/**
 * 근무표 수정
 */
export async function updateWorkShift(
  user_id: string,
  work_shift_id: string,
  shift_type_code?: string,
  note?: string | null
): Promise<WorkShift> {
  const work_shift = await WorkShift.findOne({
    where: {
      work_shift_id,
      owner_user_id: user_id,
      deleted_at: null,
    },
  });

  if (!work_shift) {
    throw new Error("WORK_SHIFT_NOT_FOUND");
  }

  const update_data: Partial<WorkShift> = {};

  if (shift_type_code) {
    // shift_type_code로 schedule_id 찾기
    const shift_type = await ShiftType.findOne({
      where: {
        code: shift_type_code,
        deleted_at: null,
      },
      include: [
        {
          model: ShiftTemplate,
          as: "template",
          where: {
            owner_user_id: user_id,
            deleted_at: null,
          },
          required: true,
        },
      ],
    });

    if (!shift_type) {
      throw new Error("SHIFT_TYPE_NOT_FOUND");
    }

    const template = await ShiftTemplate.findOne({
      where: {
        owner_user_id: user_id,
        deleted_at: null,
      },
    });

    if (!template) {
      throw new Error("TEMPLATE_NOT_FOUND");
    }

    const latest_version = await ShiftTemplateVersion.findOne({
      where: {
        template_id: template.template_id,
      },
      order: [["effective_from", "DESC"]],
    });

    if (!latest_version) {
      throw new Error("TEMPLATE_NOT_FOUND");
    }

    let schedule = await ShiftTypeSchedule.findOne({
      where: {
        shift_type_id: shift_type.shift_type_id,
        template_version_id: latest_version.template_version_id,
      },
    });

    // 스케줄이 없으면 기본 스케줄 생성 (시간 정보 없이 생성된 shift_type 대응)
    if (!schedule) {
      schedule = await ShiftTypeSchedule.create({
        shift_type_id: shift_type.shift_type_id,
        template_version_id: latest_version.template_version_id,
        start_time: null,
        end_time: null,
        crosses_midnight: false,
        duration_minutes: 0,
      });
    }

    update_data.schedule_id = schedule.schedule_id;
  }

  if (note !== undefined) {
    update_data.note = note;
  }

  await work_shift.update(update_data);

  return work_shift;
}

/**
 * 근무표 삭제 (soft delete)
 */
export async function deleteWorkShift(
  user_id: string,
  work_shift_id: string
): Promise<void> {
  const work_shift = await WorkShift.findOne({
    where: {
      work_shift_id,
      owner_user_id: user_id,
      deleted_at: null,
    },
  });

  if (!work_shift) {
    throw new Error("WORK_SHIFT_NOT_FOUND");
  }

  await work_shift.update({
    deleted_at: new Date(),
    deleted_by_user_id: user_id,
  });
}

/**
 * 일정 삭제 (soft delete)
 */
export async function deleteEvent(
  user_id: string,
  event_id: string
): Promise<void> {
  const event = await Event.findOne({
    where: {
      event_id,
      owner_user_id: user_id,
      deleted_at: null,
    },
  });

  if (!event) {
    throw new Error("EVENT_NOT_FOUND");
  }

  await event.update({
    deleted_at: new Date(),
    deleted_by_user_id: user_id,
  });
}

/**
 * 근무표 배치 생성/수정 (UPSERT)
 * 트랜잭션으로 처리하여 일부 실패 시 전체 롤백
 */
export async function batchUpsertWorkShifts(
  user_id: string,
  work_shifts: Array<{
    work_date: string;
    shift_type_code: string;
    note?: string | null;
  }>
): Promise<
  Array<{
    work_shift_id: string;
    work_date: string;
    shift_type_code: string;
    shift_type_name: string;
    shift_type_color: number | null;
    start_time: string | null;
    end_time: string | null;
    note: string | null;
    created_at: Date;
    updated_at: Date;
  }>
> {
  // 1. 요청 배열 내 중복 날짜 검증
  const dates = work_shifts.map((ws) => ws.work_date);
  const unique_dates = new Set(dates);
  if (dates.length !== unique_dates.size) {
    const duplicate_dates = dates.filter(
      (date, index) => dates.indexOf(date) !== index
    );
    const error = new Error("DUPLICATE_DATE") as any;
    error.duplicate_dates = [...new Set(duplicate_dates)];
    throw error;
  }

  // 2. 사용자의 활성 템플릿 조회
  const template = await ShiftTemplate.findOne({
    where: {
      owner_user_id: user_id,
      deleted_at: null,
    },
  });

  if (!template) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }

  // 3. 트랜잭션 시작
  const transaction = await sequelize.transaction();
  let is_committed = false;

  try {
    const saved_work_shifts: WorkShift[] = [];

    // 4. 각 근무 일정 처리
    for (const ws of work_shifts) {
      const { work_date, shift_type_code, note } = ws;

      // 4-1. shift_type_code로 shift_type_id 조회
      const shift_type = await ShiftType.findOne({
        where: {
          code: shift_type_code,
          template_id: template.template_id,
          deleted_at: null,
        },
        transaction,
      });

      if (!shift_type) {
        const error = new Error("INVALID_SHIFT_TYPE") as any;
        error.invalid_code = shift_type_code;
        error.work_date = work_date;
        throw error;
      }

      // 4-2. 해당 날짜에 유효한 템플릿 버전의 schedule_id 조회
      // effective_from <= work_date 조건으로 해당 날짜에 유효한 버전 찾기
      // 없으면 가장 최신 버전을 사용 (fallback)
      const work_date_obj = new Date(work_date);
      work_date_obj.setHours(0, 0, 0, 0);

      // 먼저 해당 날짜에 유효한 버전 찾기
      let valid_version = await ShiftTemplateVersion.findOne({
        where: {
          template_id: template.template_id,
          effective_from: {
            [Op.lte]: work_date_obj,
          },
        },
        order: [["effective_from", "DESC"]],
        transaction,
      });

      // 유효한 버전이 없으면 가장 최신 버전을 사용 (fallback)
      if (!valid_version) {
        valid_version = await ShiftTemplateVersion.findOne({
          where: {
            template_id: template.template_id,
          },
          order: [["effective_from", "DESC"]],
          transaction,
        });

        if (!valid_version) {
          const error = new Error("TEMPLATE_VERSION_NOT_FOUND") as any;
          error.work_date = work_date;
          throw error;
        }
      }

      let schedule = await ShiftTypeSchedule.findOne({
        where: {
          shift_type_id: shift_type.shift_type_id,
          template_version_id: valid_version.template_version_id,
        },
        transaction,
      });

      // 스케줄이 없으면 기본 스케줄 생성 (시간 정보 없이 생성된 shift_type 대응)
      if (!schedule) {
        schedule = await ShiftTypeSchedule.create(
          {
            shift_type_id: shift_type.shift_type_id,
            template_version_id: valid_version.template_version_id,
            start_time: null,
            end_time: null,
            crosses_midnight: false,
            duration_minutes: 0,
          },
          { transaction }
        );
      }

      // 4-3. UPSERT
      const [work_shift] = await WorkShift.upsert(
        {
          owner_user_id: user_id,
          work_date: new Date(work_date),
          schedule_id: schedule.schedule_id,
          note: note || null,
          visibility_level: 0,
          created_by_user_id: user_id,
        },
        {
          returning: true,
          conflictFields: ["owner_user_id", "work_date"],
          transaction,
        }
      );

      saved_work_shifts.push(work_shift);
    }

    // 5. 트랜잭션 커밋
    await transaction.commit();
    is_committed = true;

    // 6. 저장된 근무 일정 상세 정보 조회 (트랜잭션 밖에서 수행)
    const work_shift_ids = saved_work_shifts.map((ws) => ws.work_shift_id);
    const work_shifts_with_details = await WorkShift.findAll({
      where: {
        work_shift_id: {
          [Op.in]: work_shift_ids,
        },
      },
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
    });

    // 7. 응답 형식으로 변환
    return work_shifts_with_details.map((ws) => {
      const schedule = (ws as any).schedule as
        | (ShiftTypeSchedule & { shift_type?: ShiftType })
        | undefined;
      const shift_type = schedule?.shift_type;

      // work_date가 Date 객체인지 확인하고, 아니면 문자열로 처리
      const work_date_str =
        ws.work_date instanceof Date
          ? ws.work_date.toISOString().split("T")[0]
          : typeof ws.work_date === "string"
          ? ws.work_date
          : String(ws.work_date);

      return {
        work_shift_id: ws.work_shift_id,
        work_date: work_date_str, // YYYY-MM-DD
        shift_type_code: shift_type?.code || "",
        shift_type_name: shift_type?.name || "",
        shift_type_color: shift_type?.color ?? null,
        start_time: schedule?.start_time || null,
        end_time: schedule?.end_time || null,
        note: ws.note || null,
        created_at: ws.created_at!,
        updated_at: ws.updated_at!,
      };
    });
  } catch (error: any) {
    // 트랜잭션 롤백 (커밋되지 않은 경우에만)
    if (!is_committed) {
      await transaction.rollback();
    }
    throw error;
  }
}

import { Op, Transaction } from "sequelize";
import { sequelize } from "../config/database";
import {
  ShiftTemplate,
  ShiftTemplateVersion,
  ShiftType,
  ShiftTypeSchedule,
  WorkShift,
} from "../models";

// 기본 근무 타입 정의
interface DefaultShiftTypeInfo {
  code: string;
  name: string;
  color: number;
  start_time: string | null;
  end_time: string | null;
  crosses_midnight: boolean;
  duration_minutes: number;
  sort_order: number;
}

// 기본 근무 타입 상세 정보
const DEFAULT_SHIFT_TYPES: DefaultShiftTypeInfo[] = [
  {
    code: "D",
    name: "데이",
    color: 0xfff5a623, // 밝은 오렌지/골드
    start_time: "06:30:00",
    end_time: "15:00:00",
    crosses_midnight: false,
    duration_minutes: 510, // 8시간 30분
    sort_order: 1,
  },
  {
    code: "E",
    name: "이브닝",
    color: 0xffe91e63, // 핑크/마젠타
    start_time: "14:30:00",
    end_time: "23:00:00",
    crosses_midnight: false,
    duration_minutes: 510, // 8시간 30분
    sort_order: 2,
  },
  {
    code: "N",
    name: "나이트",
    color: 0xff5856d6, // 인디고/보라
    start_time: "22:30:00",
    end_time: "07:00:00",
    crosses_midnight: true,
    duration_minutes: 510, // 8시간 30분
    sort_order: 3,
  },
  {
    code: "OFF",
    name: "오프",
    color: 0xff34c759, // 초록
    start_time: null,
    end_time: null,
    crosses_midnight: false,
    duration_minutes: 0,
    sort_order: 4,
  },
];

const DEFAULT_TEMPLATE_NAME = "기본 3교대";
const MAX_SHIFT_TYPES_PER_TEMPLATE = 10;

/**
 * 새 사용자를 위한 기본 근무 템플릿 생성
 * @param user_id 사용자 UUID
 * @param external_transaction 외부 트랜잭션 (선택)
 */
export async function createDefaultShiftTemplate(
  user_id: string,
  external_transaction?: Transaction
): Promise<{
  template: ShiftTemplate;
  version: ShiftTemplateVersion;
  shift_types: ShiftType[];
  schedules: ShiftTypeSchedule[];
}> {
  const executeInTransaction = async (transaction: Transaction) => {
    // 1. 기본 템플릿 생성
    const template = await ShiftTemplate.create(
      {
        owner_user_id: user_id,
        name: DEFAULT_TEMPLATE_NAME,
      },
      { transaction }
    );

    // 2. 템플릿 버전 생성 (버전 1)
    const version = await ShiftTemplateVersion.create(
      {
        template_id: template.template_id,
        version_no: 1,
        effective_from: new Date(),
        created_by_user_id: user_id,
      },
      { transaction }
    );

    // 3. 근무 타입들 생성
    const shift_types: ShiftType[] = [];
    for (const type_info of DEFAULT_SHIFT_TYPES) {
      const shift_type = await ShiftType.create(
        {
          template_id: template.template_id,
          code: type_info.code,
          name: type_info.name,
          color: type_info.color,
          sort_order: type_info.sort_order,
        },
        { transaction }
      );
      shift_types.push(shift_type);
    }

    // 4. 근무 시간표 생성 (버전에 연결)
    const schedules: ShiftTypeSchedule[] = [];
    for (let i = 0; i < shift_types.length; i++) {
      const shift_type = shift_types[i];
      const type_info = DEFAULT_SHIFT_TYPES[i];

      const schedule = await ShiftTypeSchedule.create(
        {
          shift_type_id: shift_type.shift_type_id,
          template_version_id: version.template_version_id,
          start_time: type_info.start_time,
          end_time: type_info.end_time,
          crosses_midnight: type_info.crosses_midnight,
          duration_minutes: type_info.duration_minutes,
        },
        { transaction }
      );
      schedules.push(schedule);
    }

    return { template, version, shift_types, schedules };
  };

  // 외부 트랜잭션이 있으면 사용, 없으면 새로 생성
  if (external_transaction) {
    return executeInTransaction(external_transaction);
  } else {
    return sequelize.transaction(executeInTransaction);
  }
}

/**
 * 사용자가 기본 템플릿을 가지고 있는지 확인
 * @param user_id 사용자 UUID
 */
export async function hasDefaultTemplate(user_id: string): Promise<boolean> {
  const template = await ShiftTemplate.findOne({
    where: {
      owner_user_id: user_id,
      deleted_at: null,
    },
  });
  return template !== null;
}

/**
 * 신규 사용자인 경우에만 기본 템플릿 생성
 * @param user_id 사용자 UUID
 * @param external_transaction 외부 트랜잭션 (선택)
 */
export async function ensureDefaultTemplate(
  user_id: string,
  external_transaction?: Transaction
): Promise<void> {
  const has_template = await hasDefaultTemplate(user_id);
  if (!has_template) {
    await createDefaultShiftTemplate(user_id, external_transaction);
    console.log(`기본 근무 템플릿 생성 완료: user_id=${user_id}`);
  }
}

/**
 * 시간 계산 유틸리티 함수
 */
function calculateTimeInfo(
  start_time: string | null,
  end_time: string | null
): {
  crosses_midnight: boolean;
  duration_minutes: number;
} {
  if (!start_time || !end_time) {
    return {
      crosses_midnight: false,
      duration_minutes: 0,
    };
  }

  // HH:mm:ss 형식 파싱
  const [start_hours, start_minutes] = start_time.split(":").map(Number);
  const [end_hours, end_minutes] = end_time.split(":").map(Number);

  const start_total_minutes = start_hours * 60 + start_minutes;
  const end_total_minutes = end_hours * 60 + end_minutes;

  const crosses_midnight = start_total_minutes > end_total_minutes;
  const duration_minutes = crosses_midnight
    ? 24 * 60 - start_total_minutes + end_total_minutes
    : end_total_minutes - start_total_minutes;

  return {
    crosses_midnight,
    duration_minutes,
  };
}

/**
 * 현재 사용자의 활성 템플릿 조회
 */
export async function getCurrentTemplate(user_id: string): Promise<{
  template_id: string;
  template_name: string;
  owner_user_id: string;
  created_at: Date;
  current_version: {
    template_version_id: string;
    version_no: number;
    effective_from: Date;
    created_at: Date;
  } | null;
}> {
  const template = await ShiftTemplate.findOne({
    where: {
      owner_user_id: user_id,
      deleted_at: null,
    },
  });

  if (!template) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }

  // 최신 버전 조회
  const latest_version = await ShiftTemplateVersion.findOne({
    where: {
      template_id: template.template_id,
    },
    order: [["effective_from", "DESC"]],
  });

  return {
    template_id: template.template_id,
    template_name: template.name,
    owner_user_id: template.owner_user_id,
    created_at: template.created_at!,
    current_version: latest_version
      ? {
          template_version_id: latest_version.template_version_id,
          version_no: latest_version.version_no,
          effective_from: latest_version.effective_from,
          created_at: latest_version.created_at!,
        }
      : null,
  };
}

/**
 * 템플릿 이름 변경
 */
export async function updateTemplateName(
  user_id: string,
  name: string
): Promise<ShiftTemplate> {
  const template = await ShiftTemplate.findOne({
    where: {
      owner_user_id: user_id,
      deleted_at: null,
    },
  });

  if (!template) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }

  // 이름 중복 체크 (같은 사용자의 다른 템플릿과)
  const existing = await ShiftTemplate.findOne({
    where: {
      owner_user_id: user_id,
      name: name,
      deleted_at: null,
      template_id: { [Op.ne]: template.template_id },
    },
  });

  if (existing) {
    throw new Error("DUPLICATE_NAME");
  }

  template.name = name;
  await template.save();

  return template;
}

/**
 * 현재 활성 버전 조회
 */
async function getCurrentVersion(
  template_id: string
): Promise<ShiftTemplateVersion> {
  const version = await ShiftTemplateVersion.findOne({
    where: {
      template_id: template_id,
    },
    order: [["effective_from", "DESC"]],
  });

  if (!version) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }

  return version;
}

/**
 * 근무 타입 추가
 */
export async function createShiftType(
  user_id: string,
  data: {
    code: string;
    name: string;
    color?: number | null;
    start_time?: string | null;
    end_time?: string | null;
    sort_order?: number | null;
  }
): Promise<{
  shift_type_id: string;
  code: string;
  name: string;
  color: number | null;
  sort_order: number | null;
  start_time: string | null;
  end_time: string | null;
  crosses_midnight: boolean;
  duration_minutes: number;
  created_at: Date;
}> {
  return sequelize.transaction(async (transaction) => {
    // 1. 현재 사용자의 활성 템플릿 조회
    const template = await ShiftTemplate.findOne({
      where: {
        owner_user_id: user_id,
        deleted_at: null,
      },
      transaction,
    });

    if (!template) {
      throw new Error("TEMPLATE_NOT_FOUND");
    }

    // 2. 현재 템플릿의 shift_types 개수 확인 (최대 10개 제한)
    const current_count = await ShiftType.count({
      where: {
        template_id: template.template_id,
        deleted_at: null,
      },
      transaction,
    });

    if (current_count >= MAX_SHIFT_TYPES_PER_TEMPLATE) {
      throw new Error("MAX_SHIFT_TYPES_EXCEEDED");
    }

    // 3. sort_order 결정 (기본값: 기존 최대값 + 1)
    let sort_order = data.sort_order;
    if (sort_order === null || sort_order === undefined) {
      const max_sort = await ShiftType.max("sort_order", {
        where: {
          template_id: template.template_id,
          deleted_at: null,
        },
        transaction,
      });
      sort_order = (max_sort as number | null) ?? 0;
      sort_order += 1;
    }

    // 4. 근무 타입 생성
    const shift_type = await ShiftType.create(
      {
        template_id: template.template_id,
        code: data.code,
        name: data.name,
        color: data.color ?? null,
        sort_order: sort_order,
      },
      { transaction }
    );

    // 5. 스케줄 생성 (시간 정보가 없어도 기본 스케줄 생성)
    // work_shift 생성 시 schedule_id가 필요하므로 항상 스케줄을 생성해야 함
    let start_time: string | null = null;
    let end_time: string | null = null;
    let crosses_midnight = false;
    let duration_minutes = 0;

    if (data.start_time && data.end_time) {
      start_time = data.start_time;
      end_time = data.end_time;

      const time_info = calculateTimeInfo(start_time, end_time);
      crosses_midnight = time_info.crosses_midnight;
      duration_minutes = time_info.duration_minutes;
    }

    // 현재 활성 버전 조회
    const current_version = await getCurrentVersion(template.template_id);

    // 스케줄 생성 (시간 정보가 없어도 기본값으로 생성)
    await ShiftTypeSchedule.create(
      {
        shift_type_id: shift_type.shift_type_id,
        template_version_id: current_version.template_version_id,
        start_time: start_time,
        end_time: end_time,
        crosses_midnight: crosses_midnight,
        duration_minutes: duration_minutes,
      },
      { transaction }
    );

    return {
      shift_type_id: shift_type.shift_type_id,
      code: shift_type.code,
      name: shift_type.name,
      color: shift_type.color ?? null,
      sort_order: shift_type.sort_order ?? null,
      start_time: start_time,
      end_time: end_time,
      crosses_midnight: crosses_midnight,
      duration_minutes: duration_minutes,
      created_at: shift_type.created_at!,
    };
  });
}

/**
 * 근무 타입 수정
 */
export async function updateShiftType(
  user_id: string,
  shift_type_id: string,
  data: {
    code?: string;
    name?: string;
    color?: number | null;
    start_time?: string | null;
    end_time?: string | null;
    sort_order?: number | null;
  }
): Promise<{
  shift_type_id: string;
  code: string;
  name: string;
  color: number | null;
  sort_order: number | null;
  start_time: string | null;
  end_time: string | null;
  crosses_midnight: boolean;
  duration_minutes: number;
  updated_at: Date;
}> {
  return sequelize.transaction(async (transaction) => {
    // 1. 근무 타입 조회 및 소유권 확인
    const shift_type = await ShiftType.findOne({
      where: {
        shift_type_id: shift_type_id,
        deleted_at: null,
      },
      include: [
        {
          model: ShiftTemplate,
          as: "template",
          required: true,
        },
      ],
      transaction,
    });

    if (!shift_type) {
      throw new Error("SHIFT_TYPE_NOT_FOUND");
    }

    const template = (shift_type as any).template as ShiftTemplate;
    if (template.owner_user_id !== user_id) {
      throw new Error("FORBIDDEN");
    }

    // 2. shift_types 업데이트
    if (data.code !== undefined) {
      shift_type.code = data.code;
    }
    if (data.name !== undefined) {
      shift_type.name = data.name;
    }
    if (data.color !== undefined) {
      shift_type.color = data.color;
    }
    if (data.sort_order !== undefined) {
      shift_type.sort_order = data.sort_order;
    }
    await shift_type.save({ transaction });

    // 3. 시간 관련 처리
    let start_time: string | null = null;
    let end_time: string | null = null;
    let crosses_midnight = false;
    let duration_minutes = 0;

    const current_version = await getCurrentVersion(template.template_id);

    // 기존 스케줄 조회
    const existing_schedule = await ShiftTypeSchedule.findOne({
      where: {
        shift_type_id: shift_type_id,
        template_version_id: current_version.template_version_id,
      },
      transaction,
    });

    if (data.start_time !== undefined && data.end_time !== undefined) {
      // 시간이 모두 제공된 경우
      if (data.start_time && data.end_time) {
        start_time = data.start_time;
        end_time = data.end_time;

        const time_info = calculateTimeInfo(start_time, end_time);
        crosses_midnight = time_info.crosses_midnight;
        duration_minutes = time_info.duration_minutes;

        // 기존 스케줄이 있으면 UPDATE, 없으면 INSERT
        if (existing_schedule) {
          existing_schedule.start_time = start_time;
          existing_schedule.end_time = end_time;
          existing_schedule.crosses_midnight = crosses_midnight;
          existing_schedule.duration_minutes = duration_minutes;
          await existing_schedule.save({ transaction });
        } else {
          await ShiftTypeSchedule.create(
            {
              shift_type_id: shift_type_id,
              template_version_id: current_version.template_version_id,
              start_time: start_time,
              end_time: end_time,
              crosses_midnight: crosses_midnight,
              duration_minutes: duration_minutes,
            },
            { transaction }
          );
        }
      } else {
        // start_time 또는 end_time이 null인 경우
        if (existing_schedule) {
          // work_shifts에서 사용 중인지 확인
          const in_use = await WorkShift.findOne({
            where: {
              schedule_id: existing_schedule.schedule_id,
              deleted_at: null,
            },
            transaction,
          });

          if (in_use) {
            // 사용 중이면 시간 정보만 null로 업데이트 (스케줄은 유지)
            existing_schedule.start_time = null;
            existing_schedule.end_time = null;
            existing_schedule.crosses_midnight = false;
            existing_schedule.duration_minutes = 0;
            await existing_schedule.save({ transaction });
            start_time = null;
            end_time = null;
            crosses_midnight = false;
            duration_minutes = 0;
          } else {
            // 사용 중이 아니면 스케줄 삭제
            await existing_schedule.destroy({ transaction });
            start_time = null;
            end_time = null;
            crosses_midnight = false;
            duration_minutes = 0;
          }
        } else {
          // 스케줄이 없으면 null로 설정
          start_time = null;
          end_time = null;
          crosses_midnight = false;
          duration_minutes = 0;
        }
      }
    } else {
      // 시간 정보가 제공되지 않은 경우: 기존 값 유지
      if (existing_schedule) {
        start_time = existing_schedule.start_time ?? null;
        end_time = existing_schedule.end_time ?? null;
        crosses_midnight = existing_schedule.crosses_midnight;
        duration_minutes = existing_schedule.duration_minutes;
      }
    }

    return {
      shift_type_id: shift_type.shift_type_id,
      code: shift_type.code,
      name: shift_type.name,
      color: shift_type.color ?? null,
      sort_order: shift_type.sort_order ?? null,
      start_time: start_time,
      end_time: end_time,
      crosses_midnight: crosses_midnight,
      duration_minutes: duration_minutes,
      updated_at: new Date(), // 실제로는 shift_type.updated_at을 사용해야 하지만 모델에 없음
    };
  });
}

/**
 * 근무 타입 삭제 (Soft Delete)
 */
export async function deleteShiftType(
  user_id: string,
  shift_type_id: string
): Promise<{
  shift_type_id: string;
  deleted_at: Date;
}> {
  return sequelize.transaction(async (transaction) => {
    // 1. 근무 타입 조회 및 소유권 확인
    const shift_type = await ShiftType.findOne({
      where: {
        shift_type_id: shift_type_id,
        deleted_at: null,
      },
      include: [
        {
          model: ShiftTemplate,
          as: "template",
          required: true,
        },
      ],
      transaction,
    });

    if (!shift_type) {
      throw new Error("SHIFT_TYPE_NOT_FOUND");
    }

    const template = (shift_type as any).template as ShiftTemplate;
    if (template.owner_user_id !== user_id) {
      throw new Error("FORBIDDEN");
    }

    // 2. work_shifts에서 사용 중인지 확인
    // shift_type_id에 연결된 schedule_id들을 찾아서 work_shifts에서 사용 중인지 확인
    const schedules = await ShiftTypeSchedule.findAll({
      where: {
        shift_type_id: shift_type_id,
      },
      attributes: ["schedule_id"],
      transaction,
    });

    const schedule_ids = schedules.map((s) => s.schedule_id);

    if (schedule_ids.length > 0) {
      const in_use = await WorkShift.findOne({
        where: {
          schedule_id: {
            [Op.in]: schedule_ids,
          },
          deleted_at: null,
        },
        transaction,
      });

      if (in_use) {
        throw new Error("IN_USE");
      }
    }

    // 3. Soft Delete
    shift_type.deleted_at = new Date();
    await shift_type.save({ transaction });

    return {
      shift_type_id: shift_type.shift_type_id,
      deleted_at: shift_type.deleted_at,
    };
  });
}

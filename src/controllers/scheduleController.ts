import { Request, Response } from "express";
import { validationResult } from "express-validator";
import { Op } from "sequelize";
import { Schedule, ShiftPattern, SharedSchedule, User } from "../models";

// Express Request에 user 속성 추가 타입
interface AuthenticatedRequest extends Request {
  user?: User;
}

// 스케줄 목록 조회
export async function getSchedules(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const { start_date, end_date } = req.query;

    const where_clause: Record<string, unknown> = { user_id };

    if (start_date && end_date) {
      where_clause.date = {
        [Op.between]: [start_date, end_date],
      };
    }

    const schedules = await Schedule.findAll({
      where: where_clause,
      order: [["date", "ASC"]],
    });

    res.json({
      success: true,
      data: schedules,
    });
  } catch (error) {
    console.error("Get schedules error:", error);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 스케줄 생성/수정
export async function upsertSchedule(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }

    const user_id = req.user!.user_id;
    const { date, shift_type, note, is_shared } = req.body;

    const [schedule, created] = await Schedule.upsert(
      {
        user_id,
        date,
        shift_type,
        note,
        is_shared: is_shared ?? false,
      },
      {
        returning: true,
      }
    );

    res.status(created ? 201 : 200).json({
      success: true,
      message: created
        ? "스케줄이 등록되었습니다."
        : "스케줄이 수정되었습니다.",
      data: schedule,
    });
  } catch (error) {
    console.error("Upsert schedule error:", error);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 일괄 스케줄 등록 (패턴 기반)
export async function bulkCreateSchedules(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }

    const user_id = req.user!.user_id;
    const { start_date, pattern } = req.body;

    const start = new Date(start_date);
    const schedules_to_create = [];

    for (let i = 0; i < pattern.length; i++) {
      const current_date = new Date(start);
      current_date.setDate(current_date.getDate() + i);

      schedules_to_create.push({
        user_id,
        date: current_date,
        shift_type: pattern[i],
        is_shared: false,
      });
    }

    // 기존 스케줄 삭제 후 생성
    const end_date = new Date(start);
    end_date.setDate(end_date.getDate() + pattern.length - 1);

    await Schedule.destroy({
      where: {
        user_id,
        date: {
          [Op.between]: [start, end_date],
        },
      },
    });

    const schedules = await Schedule.bulkCreate(schedules_to_create);

    res.status(201).json({
      success: true,
      message: `${schedules.length}개의 스케줄이 등록되었습니다.`,
      data: schedules,
    });
  } catch (error) {
    console.error("Bulk create schedules error:", error);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 스케줄 삭제
export async function deleteSchedule(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const { date } = req.params;

    const deleted_count = await Schedule.destroy({
      where: {
        user_id,
        date,
      },
    });

    if (deleted_count === 0) {
      res
        .status(404)
        .json({ success: false, message: "스케줄을 찾을 수 없습니다." });
      return;
    }

    res.json({
      success: true,
      message: "스케줄이 삭제되었습니다.",
    });
  } catch (error) {
    console.error("Delete schedule error:", error);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 공유된 스케줄 조회
export async function getSharedSchedules(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;
    const { start_date, end_date } = req.query;

    // 나에게 공유된 스케줄 목록 조회
    const shared_with_me = await SharedSchedule.findAll({
      where: { shared_with_id: user_id },
      include: [
        {
          model: User,
          as: "owner",
          attributes: ["user_id", "name", "email"],
        },
      ],
    });

    const owner_ids = shared_with_me.map((s) => s.owner_id);

    const where_clause: Record<string, unknown> = {
      user_id: { [Op.in]: owner_ids },
      is_shared: true,
    };

    if (start_date && end_date) {
      where_clause.date = {
        [Op.between]: [start_date, end_date],
      };
    }

    const schedules = await Schedule.findAll({
      where: where_clause,
      include: [
        {
          model: User,
          as: "user",
          attributes: ["user_id", "name", "email"],
        },
      ],
      order: [["date", "ASC"]],
    });

    res.json({
      success: true,
      data: schedules,
    });
  } catch (error) {
    console.error("Get shared schedules error:", error);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 근무 패턴 목록 조회
export async function getShiftPatterns(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user_id = req.user!.user_id;

    const patterns = await ShiftPattern.findAll({
      where: { user_id },
      order: [
        ["is_default", "DESC"],
        ["created_at", "DESC"],
      ],
    });

    res.json({
      success: true,
      data: patterns,
    });
  } catch (error) {
    console.error("Get shift patterns error:", error);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 근무 패턴 생성
export async function createShiftPattern(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }

    const user_id = req.user!.user_id;
    const { name, pattern, is_default } = req.body;

    // 기본 패턴으로 설정 시 기존 기본 패턴 해제
    if (is_default) {
      await ShiftPattern.update(
        { is_default: false },
        { where: { user_id, is_default: true } }
      );
    }

    const shift_pattern = await ShiftPattern.create({
      user_id,
      name,
      pattern,
      is_default: is_default ?? false,
    });

    res.status(201).json({
      success: true,
      message: "근무 패턴이 등록되었습니다.",
      data: shift_pattern,
    });
  } catch (error) {
    console.error("Create shift pattern error:", error);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

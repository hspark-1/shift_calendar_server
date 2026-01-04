import { Router } from 'express';
import { body, query } from 'express-validator';
import {
  getSchedules,
  upsertSchedule,
  bulkCreateSchedules,
  deleteSchedule,
  getSharedSchedules,
  getShiftPatterns,
  createShiftPattern,
} from '../controllers/scheduleController';
import { authMiddleware } from '../middlewares/auth';

const router = Router();

// 모든 라우트에 인증 미들웨어 적용
router.use(authMiddleware);

// 스케줄 목록 조회
router.get('/', getSchedules);

// 스케줄 생성/수정
router.post(
  '/',
  [
    body('date').isDate().withMessage('유효한 날짜를 입력하세요.'),
    body('shift_type')
      .isIn(['D', 'E', 'N', 'OFF'])
      .withMessage('유효한 근무 타입을 입력하세요.'),
  ],
  upsertSchedule
);

// 일괄 스케줄 등록
router.post(
  '/bulk',
  [
    body('start_date').isDate().withMessage('유효한 시작 날짜를 입력하세요.'),
    body('pattern')
      .isArray({ min: 1 })
      .withMessage('패턴 배열을 입력하세요.'),
  ],
  bulkCreateSchedules
);

// 스케줄 삭제
router.delete('/:date', deleteSchedule);

// 공유된 스케줄 조회
router.get('/shared', getSharedSchedules);

// 근무 패턴 목록 조회
router.get('/patterns', getShiftPatterns);

// 근무 패턴 생성
router.post(
  '/patterns',
  [
    body('name').notEmpty().withMessage('패턴 이름을 입력하세요.'),
    body('pattern')
      .isArray({ min: 1 })
      .withMessage('패턴 배열을 입력하세요.'),
  ],
  createShiftPattern
);

export default router;


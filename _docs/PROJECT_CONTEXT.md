# 프로젝트 컨텍스트

## 1. 프로젝트 목적 & 사용자 시나리오

### 목적

근무표 관리 및 캘린더 일정 공유를 위한 백엔드 API 서버입니다. 사용자는 자신의 근무표를 관리하고, 친구와 일정을 공유할 수 있습니다.

### 주요 기능

- 카카오 OAuth 로그인
- 네이버 OAuth 로그인
- 근무 템플릿 관리 (3교대 등)
- 근무표 생성/수정/삭제
- 개인 일정(Event) 관리
- 친구 관계 및 일정 공유
- 그룹 멤버·초대 관리와 기존 친구 공개 규칙 기반 그룹 캘린더
- Push Worker 기반 Android/iOS 알림 전달

---

## 2. 아키텍처 한 장 요약

### Express 서버 구조

```
요청 흐름:
HTTP Request
  → Express App (src/index.ts)
  → Router (src/routes/*.ts)
  → Middleware (auth, validation)
  → Controller (src/controllers/*.ts)
  → Service (src/services/*.ts)
  → Model/DB (Sequelize ORM)
  → Response
```

### 월별 근무표 캐시 구조

```text
본인/친구 기간 조회
  → 친구 조회이면 friendship + can_view를 PostgreSQL에서 먼저 확인
  → 기간을 사용자 work_date 기준 YYYY-MM로 분할
  → 공유 Redis 월 snapshot + revision fence 조회
  → hit: 병합/기간 필터 후 응답
  → miss: PostgreSQL read-only repeatable-read DB 조회 → fence 확인 후 Redis 저장

근무표/근무 타입 변경
  → PostgreSQL transaction
     ├─ 원본 데이터 변경
     ├─ work_shift_month_states revision 증가
     └─ work_shift_cache_outbox INSERT
  → commit 후 Redis best-effort 즉시 무효화
  → 색상별 cache worker가 Outbox를 멱등 재처리
```

- PostgreSQL만 원본이며 Redis 장애 시 기존 DB 조회로 fallback합니다.
- 캐시 단위는 `owner_user_id + YYYYMM`이고 개인 일정은 캐시하지 않습니다.
- 친구 권한은 캐시하지 않으므로 `can_view=false` 또는 친구 삭제가 다음 요청부터 즉시 적용됩니다.
- LevelDB는 읽기 전용 다중 컨테이너와 Blue/Green 공유 정합성에 맞지 않아 사용하지 않습니다.
- 시각화 정본은 [ShiftMate 근무표 캐시 전략 FigJam](https://www.figma.com/board/7U2SsaPGC6I670W7DQnEP1)입니다. 본인·친구 조회의 공통 월 snapshot 흐름과 PostgreSQL transaction·Outbox 기반 무효화 흐름을 각각 확인할 수 있습니다.

### 푸시 알림 구조

```text
친구/그룹 도메인 transaction
  → notifications + push_jobs 원자적 기록
  → Push Worker가 job claim
  → 수신자의 같은 환경 최신 활성 기기 한 대를 delivery로 고정
  → FCM 전송 및 성공/재시도/종료 상태 기록
```

- `notifications`는 기존 인앱 알림 화면의 원본이며, push 전용 컬럼을 추가하지 않습니다.
- push 전달 상태와 기기 정보는 `push_jobs`, `push_deliveries`, `user_devices`에 분리합니다.
- API 서버는 FCM을 직접 호출하지 않으며, 기능 활성화 이후 같은 transaction에서 생성된 job만 worker가 처리합니다.
- 상세 계약과 운영 절차는 `_docs/PUSH_NOTIFICATION_GUIDE.md`를 따릅니다.

#### 캐시 적용 요청과 key 공유 계약

- `GET /work-shifts`, `GET /calendar/range`, `GET /calendar/day`의 근무표는 로그인 사용자의 월 snapshot을 사용합니다.
- `GET /friends/:friend_user_id/calendar/range`의 근무표는 friendship과 `can_view`를 PostgreSQL에서 확인한 뒤 친구 소유자의 같은 월 snapshot을 사용합니다.
- snapshot key는 `{CACHE_KEY_PREFIX}:work-shifts:v1:{owner_user_id}:{YYYYMM}`입니다. 조회자 ID를 포함하지 않으므로 소유자 본인과 여러 친구의 조회가 같은 key를 재사용합니다.
- 캘린더 응답 중 `events`는 캐시 대상이 아니며 본인 일정은 `events`, 친구 일정은 `v_visible_events_for_friend`에서 매번 조회합니다.
- 인증 또는 날짜 validation이 먼저 실패한 `401`/`400` 요청은 캐시 서비스에 진입하지 않으므로 Redis key를 생성하지 않습니다.
- `DBSIZE`는 요청 횟수가 아니라 현재 key 수입니다. 이미 존재하는 소유자·월 snapshot의 재조회는 `DBSIZE`를 증가시키지 않습니다.

### 폴더 구조

```
src/
├── index.ts              # Express 앱 엔트리포인트
├── config/
│   ├── database.ts       # Sequelize 설정
│   ├── redis.ts          # 공유 Redis 연결, timeout, cache 상태
│   ├── environment.ts    # 필수 환경변수 및 숫자 설정 검증
│   └── push.ts           # push worker 환경·재시도·TTL 설정
├── routes/               # 라우터 정의
│   ├── index.ts         # 라우터 통합
│   ├── authRoutes.ts    # 인증 관련 라우트
│   ├── deviceRoutes.ts  # 현재 설치 기기 등록/동기화
│   ├── calendarRoutes.ts # 캘린더/근무표 라우트
│   └── scheduleRoutes.ts # 스케줄 라우트 (레거시)
├── middlewares/
│   ├── auth.ts          # JWT 인증 미들웨어
│   ├── errorHandler.ts  # 에러 핸들러
│   ├── rateLimit.ts     # 인스턴스별 인증 요청 제한
│   ├── requestContext.ts # Request ID 생성/전파
│   └── validateRequest.ts # 인증 route validation 결과 공통 처리
├── controllers/         # 요청 처리 로직
│   ├── authController.ts
│   ├── calendarController.ts
│   ├── friendController.ts
│   └── scheduleController.ts
├── services/            # 비즈니스 로직
│   ├── authService.ts
│   ├── calendarService.ts
│   ├── deviceService.ts # 설치/FCM target 멱등 동기화
│   ├── friendService.ts
│   ├── notificationService.ts # 인앱 알림 + push job 원자적 생성
│   ├── firebasePushProvider.ts # FCM provider adapter
│   ├── kakaoService.ts
│   └── shiftTemplateService.ts
├── workers/
│   ├── workShiftCacheWorker.ts # PostgreSQL Outbox 기반 Redis 무효화 worker
│   └── pushWorker.ts     # lease claim, 최신 기기 선택, FCM 전송 worker
├── utils/               # 공통 검증/정규화 유틸
│   ├── logger.ts        # 민감 오류 객체를 직렬화하지 않는 구조화 오류 로그
│   └── phone.ts         # 전화번호 저장 형식 검증 및 하이픈 정규화
├── models/              # Sequelize 모델
│   ├── User.ts
│   ├── Event.ts
│   ├── WorkShift.ts
│   ├── RefreshToken.ts
│   └── ... (템플릿 관련 모델들)
└── types/
    ├── express.d.ts     # Express Request 타입 확장
    └── workShift.ts     # DB/Redis 공통 근무표 API 모델

test/
├── workShiftMonthCacheService.test.cjs # 월 분할, key, ETag 단위 테스트
├── cacheIntegration.test.cjs           # PostgreSQL/Redis 통합 테스트
├── deploymentCacheRollout.test.cjs     # Redis/worker 배포·rollback 순서 정적 테스트
└── fixtures/
    └── cacheIntegrationSchema.sql      # 격리 테스트 DB 초기화용 최소 schema
```

#### `src/config/environment.ts`

- **파일 역할**: 서버 시작 전 필수 환경변수, JWT secret 분리, 숫자/boolean 운영 설정을 검증
- **의존성**: `dotenv`, Node.js `process.env`
- **사용 예**: 엔트리포인트에서 `validateEnvironment()`를 DB 연결 전에 호출하고, 서비스에서는 `getRequiredEnvironmentVariable("JWT_SECRET")`로 기본값 없는 필수 설정을 조회

#### 운영 공통 미들웨어/로거

- **`src/middlewares/requestContext.ts` 역할**: 유효한 `X-Request-ID`를 이어받거나 UUID를 생성하고 응답 헤더와 `req.request_id`로 전파
- **`src/middlewares/rateLimit.ts` 역할**: 로그인/OAuth/토큰 갱신 요청을 IP 기준으로 인스턴스별 제한
- **`src/middlewares/validateRequest.ts` 역할**: 인증 route의 `express-validator` 결과를 공통 400 응답으로 변환
- **`src/utils/logger.ts` 역할**: 오류 객체 전체, stack, request/response/config를 직렬화하지 않고 context, Request ID, 오류 이름/코드/HTTP 상태만 기록
- **의존성**: Express Request/Response, Node.js `crypto`, 공통 환경변수 파서
- **사용 예**: 인증 컨트롤러에서 `logError("auth_login_failed", error, req.request_id)` 호출

#### 월별 근무표 캐시 모듈

- **`src/services/workShiftMonthCacheService.ts` 역할**: 월 분할, snapshot/lock/revision key, cache-aside, revision fence, ETag 생성
- **`src/services/workShiftCacheInvalidationService.ts` 역할**: 월 revision 증가와 Outbox 이벤트를 업무 transaction에 기록하고 commit 후 즉시 무효화
- **`src/workers/workShiftCacheWorker.ts` 역할**: `FOR UPDATE SKIP LOCKED` 방식 claim, 월별 이벤트 병합, Redis 재시도와 7일 완료 이벤트 정리
- **의존성**: PostgreSQL expand migration, 환경별 공유 Redis, `WORK_SHIFT_CACHE_ENABLED=true`
- **사용 예**: API는 `node dist/index.js`, worker는 `node dist/workers/workShiftCacheWorker.js`, worker health는 `--healthcheck`
- 캐시 flag가 `false`인 worker 본체는 Outbox를 claim하지 않고 대기하지만 health 명령은 PostgreSQL과 Redis를 모두 검사합니다. 활성화 시 API와 worker 컨테이너를 같은 `true` 환경으로 재생성합니다.

#### Push Worker 모듈

- **`src/services/notificationService.ts` 역할**: 기존 인앱 알림과 제목·본문 snapshot을 가진 push job을 도메인 transaction에 함께 기록
- **`src/services/deviceService.ts` 역할**: 인증 사용자 설치의 권한·FCM token·활성 상태를 환경별로 멱등 동기화
- **`src/workers/pushWorker.ts` 역할**: `FOR UPDATE SKIP LOCKED` lease claim, 최신 활성 기기 고정 선택, FCM 전송·재시도·만료·정리
- **의존성**: PostgreSQL push migration, 환경별 Firebase service account, `PUSH_JOB_ENQUEUE_ENABLED`와 `PUSH_WORKER_ENABLED`
- **사용 예**: API는 `npm start`, worker는 `npm run start:push-worker`; 초기 배포에서는 두 flag를 모두 `false`로 유지합니다.

---

## 3. Express 백엔드 상세 문서

### 3.1 요청 처리 흐름

#### 표준 흐름

1. **Router** (`src/routes/*.ts`)
   - HTTP 메서드와 경로 정의
   - Validation 미들웨어 적용 (express-validator)
   - 인증 미들웨어 적용 (authMiddleware)

2. **Middleware**
   - **Validation**: `express-validator`로 요청 데이터 검증
   - **Auth**: `src/middlewares/auth.ts`에서 JWT 토큰 검증 및 사용자 정보 주입

3. **Controller** (`src/controllers/*.ts`)
   - 요청 파라미터 추출
   - Validation 결과 확인 (`validationResult`)
   - Service 호출
   - 응답 포맷팅 및 반환

4. **Service** (`src/services/*.ts`)
   - 비즈니스 로직 처리
   - DB 트랜잭션 관리 (필요 시)
   - Model을 통한 DB 접근

5. **Model/DB** (Sequelize ORM)
   - PostgreSQL 데이터베이스 접근
   - 모델 정의는 `src/models/*.ts`

#### 예시: 근무표 조회

```typescript
// 1. Router (src/routes/calendarRoutes.ts)
router.get("/work-shifts", [
  query("start_date").isISO8601(),
  query("end_date").isISO8601(),
], getWorkShifts);

// 2. Middleware (자동 적용)
router.use(authMiddleware); // 모든 라우트에 적용

// 3. Controller (src/controllers/calendarController.ts)
export async function getWorkShifts(req: AuthenticatedRequest, res: Response) {
  const user_id = req.user!.user_id; // authMiddleware에서 주입
  const { start_date, end_date } = req.query;
  const result = await calendarService.getWorkShifts(user_id, start_date, end_date);
  res.json({ success: true, data: result });
}

// 4. Service (src/services/calendarService.ts)
export async function getWorkShifts(user_id: string, start_date: string, end_date: string) {
  // DB 쿼리 로직
  return await WorkShift.findAll({ ... });
}
```

### 3.2 에러 처리 규칙

#### 에러 처리 위치

- **Controller**: `try-catch`로 Service 에러 캐치, HTTP 상태 코드 및 응답 포맷 결정
- **Global Error Handler**: `src/middlewares/errorHandler.ts`에서 최종 에러 처리

#### 에러 응답 포맷

```typescript
// 성공 응답
{
  success: true,
  data: { ... },
  message?: string
}

// 실패 응답
{
  success: false,
  message: string,
  error?: {
    code: string,  // 예: "VALIDATION_ERROR", "TEMPLATE_NOT_FOUND"
    message: string
  },
  errors?: Array<{ ... }>  // validation 에러 배열
}
```

#### 에러 타입

- **400 Bad Request**: Validation 에러, 잘못된 요청 파라미터
- **401 Unauthorized**: 인증 실패 (토큰 없음/만료/무효)
- **404 Not Found**: 리소스 없음
- **500 Internal Server Error**: 서버 내부 오류

#### 에러 처리 예시

```typescript
// Controller에서
try {
  const result = await calendarService.getWorkShifts(...);
  res.json({ success: true, data: result });
} catch (error: any) {
  if (error.message === "TEMPLATE_NOT_FOUND") {
    res.status(404).json({
      success: false,
      error: {
        code: "TEMPLATE_NOT_FOUND",
        message: "활성 템플릿을 찾을 수 없습니다."
      }
    });
    return;
  }
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "서버 오류가 발생했습니다."
    }
  });
}
```

#### Global Error Handler

```typescript
// src/middlewares/errorHandler.ts
export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const status_code = err.status_code || 500;
  const message = err.message || "서버 내부 오류가 발생했습니다.";

  res.status(status_code).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
}
```

### 3.3 Validation 규칙

#### 사용 도구

- **express-validator**: 요청 데이터 검증
- **위치**: `src/routes/*.ts`에서 라우트 정의 시 미들웨어로 적용

#### Validation 적용 방식

```typescript
// 예시: src/routes/calendarRoutes.ts
import { body, query } from "express-validator";

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
  upsertWorkShift,
);
```

#### 인증 Route에서 Validation 결과 공통 처리

```typescript
// src/routes/authRoutes.ts
router.post(
  "/login",
  [body("email").isEmail(), body("password").isString().notEmpty()],
  validateRequestMiddleware,
  login,
);
```

- 인증 Route는 `validateRequestMiddleware`가 Controller 호출 전에 400으로 차단합니다.
- 오류 응답은 `type`, `field`, `location`, `message`만 포함하며 입력 원문은 반환하지 않습니다.
- 기존 비인증 Route는 각 Controller에서 `validationResult()`를 확인하는 현재 구조를 유지합니다.

#### 주요 Validation 규칙

- **날짜**: `isISO8601()` 또는 `isDate()` (YYYY-MM-DD 형식)
- **이메일**: `isEmail()`
- **필수값**: `notEmpty()`
- **배열**: `isArray({ min: 1, max: 100 })`
- **선택값**: `optional()`

### 3.4 인증/인가

#### 인증 방식

- **JWT (JSON Web Token)**: Access Token + Refresh Token
- **Access Token**: 7일 만료, Authorization 헤더에 `Bearer {token}` 형식
- **Refresh Token**: 30일 만료, DB에 해시값 저장 (SHA-256)

#### 인증 미들웨어

**위치**: `src/middlewares/auth.ts`

```typescript
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // 1. Authorization 헤더 확인
  const auth_header = req.headers.authorization;
  if (!auth_header || !auth_header.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ success: false, message: "인증 토큰이 필요합니다." });
  }

  // 2. JWT 검증
  const token = auth_header.split(" ")[1];
  const decoded = jwt.verify(token, process.env.JWT_SECRET) as JwtPayload;

  // 3. 사용자 조회 및 주입
  const user = await User.findByPk(decoded.user_id);
  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: "유효하지 않은 사용자입니다." });
  }

  (req as AuthenticatedRequest).user = user;
  next();
}
```

#### 인증 적용 위치

- **라우트 레벨**: `router.use(authMiddleware)` - 모든 라우트에 적용
- **개별 라우트**: `router.get("/path", authMiddleware, handler)` - 특정 라우트만

#### 인증된 요청 타입

```typescript
// src/types/express.d.ts
declare global {
  namespace Express {
    interface Request {
      user?: User;
      request_id?: string;
    }
  }
}

// Controller에서 사용
interface AuthenticatedRequest extends Request {
  user?: User;
}

export async function handler(req: AuthenticatedRequest, res: Response) {
  const user_id = req.user!.user_id; // authMiddleware에서 주입됨
}
```

- `tsc`는 `include: ["src/**/*"]`로 이 선언 파일을 로드합니다.
- `ts-node`는 엔트리포인트에서 직접 import하지 않은 선언 파일을 기본적으로 생략하므로 `tsconfig.json`의 `ts-node.files=true`를 유지해야 합니다.
- 이 설정을 제거하면 `npm run dev`에서 `Request.request_id` 등의 전역 확장 타입이 없다는 컴파일 오류가 발생합니다.

#### Refresh Token 관리

- **생성**: 로그인/회원가입 시 `authService.generateTokens()` 호출
- **고유성**: Access/Refresh Token마다 무작위 `jti`를 포함해 같은 사용자의 같은 초 발급도 서로 다른 토큰으로 생성
- **갱신**: `POST /api/v1/auth/refresh` - 대상 `refresh_tokens` row를 `FOR UPDATE`로 잠그고 기존 토큰 무효화와 새 토큰 저장을 하나의 트랜잭션으로 처리
- **동시 갱신**: 동일 Refresh Token에 대한 동시 요청은 정확히 한 요청만 성공
- **무효화**: 로그아웃 시 `refresh_tokens.revoked_at` 설정
- **저장**: `refresh_tokens` 테이블에 SHA-256 해시값 저장

#### OAuth 인증

- **카카오 OAuth**: `src/services/kakaoService.ts`
  - WebView 방식: `POST /api/v1/auth/kakao` (authorization code)
  - SDK 방식: `POST /api/v1/auth/kakao/token` (access_token 직접 전송)
- **네이버 OAuth**: `src/services/naverService.ts`
  - WebView 방식: `POST /api/v1/auth/naver` (authorization code)
  - SDK 방식: `POST /api/v1/auth/naver/token` (access_token 직접 전송)
- **Apple 로그인**: `src/services/appleService.ts`
  - `POST /api/v1/auth/apple/challenge`에서 일회성 state/nonce를 발급
  - `POST /api/v1/auth/apple`에서 code 교환과 JWKS/claim 검증 후 ShiftMate JWT 발급
  - state/nonce는 hash만 저장하고 외부 refresh token은 AES-256-GCM 암호문으로 분리 저장
  - 기본 `APPLE_AUTH_ENABLED=false`, 동일 이메일 기존 계정은 자동 연결하지 않음
- **Google 로그인**: `src/services/googleService.ts`
  - `POST /api/v1/auth/google/token`에서 공식 라이브러리로 ID Token의 서명·issuer·audience·만료·verified email 검증
  - 검증된 `sub`를 `users.google_id`로 저장하고 신규 가입 전체를 transaction으로 처리
  - 기본 `GOOGLE_AUTH_ENABLED=false`, 동일 이메일 기존 계정은 자동 연결하지 않음

### 3.5 DB 접근 규칙

#### ORM

- **Sequelize**: PostgreSQL ORM
- **설정**: `src/config/database.ts`

#### Sequelize 설정

```typescript
export const sequelize = new Sequelize(db_name, db_user, db_password, {
  host: db_host,
  port: db_port,
  dialect: "postgres",
  logging: false, // 프로덕션에서는 false
  pool: {
    max: db_pool_max, // DB_POOL_MAX, 기본 10
    min: db_pool_min, // DB_POOL_MIN, 기본 0
    acquire: db_pool_acquire_ms, // DB_POOL_ACQUIRE_MS, 기본 30000
    idle: db_pool_idle_ms, // DB_POOL_IDLE_MS, 기본 10000
  },
  define: {
    timestamps: true, // createdAt, updatedAt 자동 생성
    underscored: true, // snake_case 컬럼명
  },
  dialectOptions: {
    ssl:
      process.env.DB_SSL === "true"
        ? { require: true, rejectUnauthorized: false }
        : false,
  },
});
```

#### 트랜잭션 사용

**위치**: `src/services/*.ts`에서 복수 작업 시 트랜잭션 사용

```typescript
// 예시: src/services/calendarService.ts
import { sequelize } from "../config/database";
import { Transaction } from "sequelize";

export async function batchUpsertWorkShifts(...) {
  const transaction = await sequelize.transaction();
  let is_committed = false;

  try {
    // 여러 DB 작업 수행
    await WorkShift.upsert(..., { transaction });
    await Event.create(..., { transaction });

    await transaction.commit();
    is_committed = true;
  } catch (error) {
    if (!is_committed) {
      await transaction.rollback();
    }
    throw error;
  }
}
```

#### N+1 방지 원칙

- **Include 사용**: Sequelize의 `include` 옵션으로 연관 데이터 한 번에 조회

```typescript
const work_shifts = await WorkShift.findAll({
  include: [
    {
      model: ShiftTypeSchedule,
      as: "schedule",
      include: [
        {
          model: ShiftType,
          as: "shift_type",
        },
      ],
    },
  ],
});
```

#### 마이그레이션 룰

- `migrations/`의 SQL은 배포 자동화 파일이 아니라 개발자가 직접 실행하고 실행 내역을 `WORKLOG.md`에 기록하기 위한 자료
- API 프로세스와 컨테이너는 migration 또는 `sequelize.sync()`를 실행하지 않음
- `DB_SYNC=true`가 설정되면 서버 시작을 거부
- 운영 DB 변경 순서: 백업 → 개발자 수동 SQL 1회 실행 → 결과 검증/기록 → API 인스턴스 실행
- `migrations/final_schema.sql`은 `DROP SCHEMA`가 포함된 로컬 초기화 전용이며 운영 DB에 실행 금지

#### 모델 정의 위치

- `src/models/*.ts`: Sequelize 모델 정의
- `src/models/index.ts`: 모델 export 통합

### 3.6 API 스펙

#### API 버전

- **Base URL**: `/api/v1`
- **정의 위치**: `src/routes/index.ts`

#### 응답 포맷

**성공 응답**:

```typescript
{
  success: true,
  data?: any,           // 응답 데이터
  message?: string      // 선택적 메시지
}
```

**실패 응답**:

```typescript
{
  success: false,
  message: string,
  error?: {
    code: string,
    message: string
  },
  errors?: Array<{ ... }>  // validation 에러
}
```

#### 주요 엔드포인트

**인증** (`/api/v1/auth`):

- `POST /kakao` - 카카오 OAuth 로그인 (WebView)
- `POST /kakao/token` - 카카오 OAuth 로그인 (SDK)
- `POST /naver` - 네이버 OAuth 로그인 (WebView)
- `POST /naver/token` - 네이버 OAuth 로그인 (SDK)
- `POST /refresh` - 토큰 갱신
- `POST /logout` - 로그아웃
- `POST /logout-all` - 모든 기기 로그아웃 (인증 필요)
- `GET /profile` - 내 정보 조회 (인증 필요)
- `POST /profile` - 내 정보 수정 (인증 필요)

**캘린더/근무표** (`/api/v1`):

- `GET /shift-types` - 근무 타입 정보 조회
- `GET /work-shifts?start_date=&end_date=` - 기간별 근무표 조회
- `POST /work-shifts` - 근무표 생성/수정
- `PUT /work-shifts/:work_shift_id` - 근무표 수정
- `DELETE /work-shifts/:work_shift_id` - 근무표 삭제
- `POST /work-shifts/batch` - 근무표 배치 생성/수정
- `GET /events?start_date=&end_date=` - 기간별 일정 조회
- `POST /events` - 개인 일정 생성
- `DELETE /events/:event_id` - 일정 삭제
- `GET /calendar/range?start_date=&end_date=` - 기간별 캘린더 데이터 (근무표 + 일정)

**캘린더 응답 계약**:

- `GET /calendar/range`, `GET /work-shifts`, `POST /work-shifts`, `PUT /work-shifts/:work_shift_id`, `POST /work-shifts/batch`의 근무표 응답은 동일한 `WorkShiftApiModel` 필드를 반환
- `WorkShiftApiModel`: `work_shift_id`, `work_date`, `shift_type_code`, `shift_type_name`, `shift_type_color`, `start_time`, `end_time`, `note`, `created_at`, `updated_at`
- `POST /work-shifts`, `POST /work-shifts/batch`는 `(owner_user_id, work_date)` 기준 upsert이며, 같은 날짜의 soft-deleted 근무표가 있으면 `deleted_at`, `deleted_by_user_id`를 `null`로 되돌려 재등록 데이터가 조회되도록 복구
- `shift_type_color` 응답 포맷은 `#AARRGGBB` 문자열 또는 값이 없을 때 `null`
- `GET /shift-types`, `POST /shift-types`, `PUT /shift-types/:shift_type_id`의 근무 타입 객체는 최종 렌더링 색상 `color`와 함께 기준 색상 `base_color`, 정수 농도 `color_intensity(0..100)`를 반환
- 신규 색상 설정은 불투명 기준 색상 `#FFRRGGBB`와 농도를 함께 전달하며, 서버가 불투명 흰색 `#FFFFFFFF` 기준으로 최종 `color`를 계산
- `base_color`와 `color_intensity` 중 하나만 전달하면 `INVALID_COLOR_METADATA`, 함께 전달한 `color`가 서버 계산값과 다르면 `COLOR_METADATA_MISMATCH`로 거절
- 구버전 클라이언트의 `color` 단독 쓰기는 `base_color=color`, `color_intensity=100`으로 저장하고, 레거시 DB 행 조회도 같은 기준으로 fallback
- 색상 메타데이터가 없는 수정 요청은 기존 세 값을 유지하며, `color:null` 단독 수정은 최종/기준 색상을 `null`, 농도를 `100`으로 갱신
- `start_time`, `end_time` 응답 포맷은 `HH:mm:ss` 문자열 또는 값이 없을 때 `null`
- 개인 캘린더의 `GET /events`, `POST /events`, `GET /calendar/day`, `GET /calendar/range` 이벤트 응답은 `EventApiModel` 필드를 반환
- `EventApiModel`: `event_id`, `title`, `memo`, `place`, `all_day`, `start_at`, `end_at`, `visibility_level`, `created_at`, `updated_at`
- `POST /events`는 `title`을 trim한 뒤 빈 문자열이면 `INVALID_TITLE`로 거절하고, `start_at`/`end_at`은 UTC `Z` ISO 문자열이며 `start_at < end_at`이어야 함
- `POST /events`의 `visibility_level`은 서버 정책상 0~5만 허용하고, `owner_user_id`와 `created_by_user_id`는 JWT 현재 사용자로 설정
- 개인 캘린더 조회는 JWT 현재 사용자 기준 `owner_user_id = current_user.user_id` 조건으로만 조회
- 친구 캘린더 조회는 `viewer_user_id`, `friend_user_id`, 친구 관계, `friend_level_settings` 공개 조건을 모두 확인한 뒤 동일한 근무표 필드 구조로 반환
- 이벤트 기간 조회는 `start_at < end_date + 1 day` AND `end_at > start_date` 겹침 조건으로 처리
- `/api` 응답은 기본적으로 `Cache-Control: private, no-store`, `Vary: Authorization` 헤더를 내려 인증 사용자별 응답 캐시 혼선을 방지
- `GET /work-shifts`만 월 revision 조합의 opaque `ETag`와 `Cache-Control: private, no-cache`를 반환하며 `If-None-Match` 일치 시 304
- `GET /calendar/range`, `GET /calendar/day`, 친구 캘린더 기간 조회의 근무표도 동일한 월 캐시를 사용하지만 이벤트가 섞인 응답은 `no-store` 유지

**친구/공유 캘린더** (`/api/v1`):

- `GET /friends` - 친구 목록 조회
- `GET /friends/:friend_user_id/calendar/range?start_date=&end_date=` - 친구가 공개한 읽기 전용 캘린더 기간 조회
- `PUT /friends/:friend_user_id/settings` - 친구별 공개 레벨 및 열람 허용 설정 변경
- `DELETE /friends/:friend_user_id` - 친구 삭제
- `POST /friend-requests` - 친구 요청 보내기
- `PUT /friend-requests/:request_id/respond` - 받은 친구 요청 수락/거절
- `GET /notifications` - 알림 목록 조회 및 조회된 알림 읽음 처리
- `GET /notifications/unread-count` - 미읽음 알림 개수 조회

**친구 요청/알림 응답 계약**:

- `FRIEND_REQUEST` 알림은 `payload.request_id`로 `friend_requests.request_id`와 연결되며, `actions`에 `accept`/`reject` 버튼 정보를 포함
- `PUT /friend-requests/:request_id/respond` 성공 시 `friend_requests.status`를 `ACCEPTED` 또는 `REJECTED`로 변경
- 같은 트랜잭션에서 요청 수신자에게 있던 원본 `FRIEND_REQUEST` 알림을 처리 완료 상태로 갱신
  - 수락: `notification_type=FRIEND_REQUEST_ACCEPTED`, `title=친구 요청 수락`, `actions=[]`
  - 거절: `notification_type=FRIEND_REQUEST_REJECTED`, `title=친구 요청 거절`, `actions=[]`
- 응답 `data.notification`에는 갱신된 원본 알림을 포함하므로 프론트는 알림 목록을 재조회하지 않아도 해당 카드 UI를 즉시 교체할 수 있음
- 요청자에게는 기존처럼 `FRIEND_ACCEPTED` 또는 `FRIEND_REJECTED` 새 알림을 생성

#### Swagger/OpenAPI

- **그룹 API 구현됨**: `API_DOCS_ENABLED=true`일 때 `/api-docs`와 `/api-docs/openapi.json` 노출
- **범위 제한**: 현재 OpenAPI 3.0.3 문서는 그룹 P0/P1와 공통 bearer/error/pagination schema만 포함하며 기존 API 전체 문서는 아직 미포함

### 3.7 로깅/모니터링

#### 로깅 도구

- **morgan**: HTTP 요청 로깅
- **위치**: `src/index.ts`

#### 로깅 레벨

- **개발 환경**: `morgan("dev")` - 상세 로그
- **프로덕션**: 원격 주소/메서드/쿼리 없는 경로/상태/응답 크기/처리시간 + `request_id`
- **인스턴스 식별**: 서버 시작 로그와 루트 health에 `INSTANCE_NAME`, 미설정 시 `unknown` 기록

#### 에러 로깅

- **모든 Controller/Service/전역 Handler**: 오류 객체 원문 대신 민감 객체를 직렬화하지 않는 `logError()` 사용

```typescript
catch (error) {
  logError("auth_login_failed", error, req.request_id);
  res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
}
```

#### Structured Logging

- 애플리케이션 오류 로그는 JSON 형식으로 `context`, `request_id`, `error_name`, `error_code`, `http_status`만 기록
- `X-Request-ID`가 영문/숫자/`_`/`-` 1~64자이면 이어받고, 아니면 UUID 신규 생성
- 모든 HTTP access log에 `request_id` 포함
- access log는 query string, request body, Authorization, referrer를 기록하지 않음
- 오류 객체 전체와 Axios config/request/response를 로그에 전달하지 않아 비밀번호, OAuth code, Access/Refresh Token 노출 방지

#### 로깅 위치

- **요청 로그**: morgan이 자동으로 HTTP 요청/응답 로깅
- **에러 로그**: 인증/전역 오류는 `logError()` 사용
- **비즈니스 로그**: Service에서 `console.log()` 사용 (예: "카카오 로그인 성공")

### 3.8 환경변수 표

#### 필수 환경변수

| 변수명                | 설명                       | 예시값                                     | 환경      |
| --------------------- | -------------------------- | ------------------------------------------ | --------- |
| `DB_HOST`             | PostgreSQL 호스트          | `localhost`                                | 모든 환경 |
| `DB_PORT`             | PostgreSQL 포트            | `5432`                                     | 모든 환경 |
| `DB_NAME`             | 데이터베이스 이름          | `shift_calendar`                           | 모든 환경 |
| `DB_USER`             | 데이터베이스 사용자        | `postgres`                                 | 모든 환경 |
| `DB_PASSWORD`         | 데이터베이스 비밀번호      | `password`                                 | 모든 환경 |
| `JWT_SECRET`          | JWT Access Token 서명 키   | `your-secret-key`                          | 모든 환경 |
| `JWT_REFRESH_SECRET`  | JWT Refresh Token 서명 키  | `your-refresh-secret`                      | 모든 환경 |
| `KAKAO_CLIENT_ID`     | 카카오 OAuth Client ID     | `your-kakao-client-id`                     | 모든 환경 |
| `KAKAO_CLIENT_SECRET` | 카카오 OAuth Client Secret | `your-kakao-client-secret`                 | 모든 환경 |
| `KAKAO_REDIRECT_URI`  | 카카오 OAuth Redirect URI  | `http://localhost:3000/test/callback.html` | 모든 환경 |
| `NAVER_CLIENT_ID`     | 네이버 OAuth Client ID     | `your-naver-client-id`                     | 모든 환경 |
| `NAVER_CLIENT_SECRET` | 네이버 OAuth Client Secret | `your-naver-client-secret`                 | 모든 환경 |

#### 선택 환경변수

| 변수명                                | 설명                                  | 기본값             |
| ------------------------------------- | ------------------------------------- | ------------------ |
| `PORT`                                | 서버 포트                             | `3000`             |
| `NODE_ENV`                            | `development`/`test`/`production`     | `development`      |
| `DB_SSL`                              | DB SSL 사용 여부 (`true`/`false`)     | `false`            |
| `DB_POOL_MAX`                         | 인스턴스당 DB 최대 연결 수            | `10`               |
| `DB_POOL_MIN`                         | 인스턴스당 DB 최소 연결 수            | `0`                |
| `DB_POOL_ACQUIRE_MS`                  | DB 연결 획득 제한시간                 | `30000`            |
| `DB_POOL_IDLE_MS`                     | 유휴 DB 연결 유지시간                 | `10000`            |
| `TRUST_PROXY_HOPS`                    | 신뢰할 Nginx 프록시 hop 수            | 개발 `0`, 운영 `1` |
| `SHUTDOWN_TIMEOUT_MS`                 | graceful shutdown 최대 대기시간       | `10000`            |
| `CORS_ALLOWED_ORIGINS`                | 쉼표로 구분한 정확한 허용 Origin 목록 | 환경별 기본 목록   |
| `INSTANCE_NAME`                       | health/log에서 식별할 컨테이너 이름   | `unknown`          |
| `REQUEST_BODY_LIMIT`                  | JSON/form 요청 본문 최대 크기         | `100kb`            |
| `AUTH_RATE_LIMIT_WINDOW_MS`           | 인증 요청 제한 구간                   | `60000`            |
| `AUTH_RATE_LIMIT_MAX`                 | 구간당 인스턴스별 인증 요청 최대 횟수 | `10`               |
| `WORK_SHIFT_CACHE_ENABLED`            | 월별 근무표 Redis 캐시/worker 활성화  | `false`            |
| `REDIS_URL`                           | 비밀번호 포함 환경별 Redis 내부 URL   | 캐시 활성 시 필수  |
| `CACHE_KEY_PREFIX`                    | Stage/Center 분리 Redis key prefix    | 캐시 활성 시 필수  |
| `WORK_SHIFT_CACHE_TTL_SECONDS`        | snapshot 기본 TTL                     | `86400`            |
| `WORK_SHIFT_CACHE_TTL_JITTER_SECONDS` | TTL 최대 jitter                       | `3600`             |
| `WORK_SHIFT_CACHE_LOCK_MS`            | stampede 방지 lock 만료               | `5000`             |
| `WORK_SHIFT_CACHE_WAIT_MS`            | lock 대기 요청의 최대 재조회 시간     | `500`              |
| `REDIS_CONNECT_TIMEOUT_MS`            | Redis 연결 제한시간                   | `500`              |
| `REDIS_COMMAND_TIMEOUT_MS`            | Redis 명령 제한시간                   | `100`              |
| `CACHE_OUTBOX_POLL_MS`                | worker idle polling 간격              | `1000`             |
| `CACHE_OUTBOX_BATCH_SIZE`             | worker 1회 claim 최대 이벤트          | `100`              |
| `GROUP_MEMBER_LIMIT`                  | 그룹 최대 활성 멤버                   | `20`               |
| `GROUP_INVITATION_TTL_DAYS`           | 그룹 초대 만료 일수                   | `7`                |
| `GROUP_CALENDAR_MAX_RANGE_DAYS`       | 그룹 캘린더 양 끝 포함 최대 일수      | `100`              |
| `API_DOCS_ENABLED`                    | `/api-docs`와 원본 OpenAPI 노출        | `false`            |

#### 환경별 차이

**로컬 개발**:

```env
NODE_ENV=development
DB_SSL=false
TRUST_PROXY_HOPS=0
```

**스테이징/프로덕션(현재 비공개 실행 환경 내부 Docker PostgreSQL 16)**:

```env
NODE_ENV=production
DB_SSL=false
TRUST_PROXY_HOPS=1
CORS_ALLOWED_ORIGINS=https://shift-calendar.co.kr
INSTANCE_NAME=shiftmate-api-1
REQUEST_BODY_LIMIT=100kb
AUTH_RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX=10
```

`DB_SSL=true`는 PostgreSQL 접속 경로에 TLS가 실제로 구성된 경우에만 사용합니다. 현재 비공개 실행 환경 내부 Docker 네트워크의 PostgreSQL 16 연결은 `DB_SSL=false`가 기준입니다.

`JWT_SECRET`/`JWT_REFRESH_SECRET` 누락, 두 값의 동일 설정, 잘못된 숫자/boolean 환경변수, `DB_SYNC=true`는 서버 시작 전에 오류로 처리합니다.

---

## 4. 핵심 규칙

### 네이밍 컨벤션

- **변수명**: `snake_case` (예: `user_id`, `work_date`)
- **함수명**: `camelCase` (예: `getWorkShifts`, `upsertWorkShift`)
- **파일명**: `camelCase.ts` (예: `authController.ts`, `calendarService.ts`)

### 에러 처리

- 모든 에러는 Controller에서 캐치하여 적절한 HTTP 상태 코드와 응답 포맷 반환
- Service에서 비즈니스 로직 에러는 `throw new Error("ERROR_CODE")` 형식으로 던짐
- Global Error Handler는 최종 안전망 역할

### 로깅

- 인증/전역 에러는 `logError()`로 구조화해 기록
- 비즈니스 로직 로그는 `console.log()` 사용
- 프로덕션에서는 민감 정보 로깅 금지

### 환경변수

- `.env` 파일 사용 (git에 커밋하지 않음)
- `.env.example`은 비밀값 없이 필요한 키와 안전한 예시만 기록하고 Git에 포함
- 필수 환경변수와 운영 숫자/boolean 설정은 `src/config/environment.ts`에서 서버 시작 전에 검증

### 린트/포맷

- TypeScript 사용
- 린트 규칙은 `tsconfig.json` 및 프로젝트 설정에 따름

### 테스트 원칙

- `npm test`: TypeScript build 후 월 분할, 월 말일, cache key, ETag 단위 테스트 실행
- 그룹 migration·Stage wrapper 정적 테스트는 gitignore 대상인 운영 로컬 SQL 6개가 전부 있으면 실행하고, 전부 없으면 원격 체크아웃으로 판단해 명시적으로 skip하며 일부만 존재하면 실패
- `npm run test:integration`: PostgreSQL 16과 Redis 7.4를 대상으로 cache hit, 다월 병합, 빈 달, read-only repeatable-read, 손상 schema, TTL jitter, transaction rollback, 근무 타입 무효화, stampede lock, revision fence 경합, 친구 권한 재검사, ETag 304, Redis 장애 복구, Outbox 동시 claim/retry/정리를 검증
- `test/fixtures/cacheIntegrationSchema.sql`은 통합 테스트에 필요한 정본 컬럼·제약·공개 view만 구성하는 테스트 전용 파일이며, 실행 시 대상 DB의 `public` schema를 삭제하고 재생성
- 통합 테스트는 `RUN_CACHE_INTEGRATION=true`를 스크립트가 설정하며 CI 또는 폐기 가능한 전용 DB에서만 실행하고 운영/공유 개발 DB에는 실행 금지
- PostgreSQL/Redis 연결 정보와 캐시 환경변수를 제공한 뒤 `npm run test:integration`으로 사용

---

## 5. 데이터/도메인 개요

### 주요 엔티티

#### User (사용자)

- `user_id` (UUID, PK)
- `email`, `name`, `profile_image_url`
- `phone`: nullable unique, `000-000-0000` 또는 `000-0000-0000` 형식만 저장
- `kakao_id`, `apple_id`, `naver_id` (OAuth)
- `timezone`

#### WorkShift (근무표)

- `work_shift_id` (UUID, PK)
- `owner_user_id` (FK → users)
- `work_date` (date)
- `schedule_id` (FK → shift_type_schedules)
- `visibility_level` (항상 0)
- `(owner_user_id, work_date)`는 unique이므로 같은 날짜 재등록은 신규 row 생성이 아니라 soft-deleted row의 `deleted_at`, `deleted_by_user_id`를 `null`로 복구

#### WorkShiftMonthState / WorkShiftCacheOutbox

- `work_shift_month_states`: 사용자·월별 단조 증가 revision과 원본 최종 변경 시각
- `work_shift_cache_outbox`: 원본 변경 transaction과 함께 저장되는 월 캐시 무효화 이벤트
- 배치 저장은 같은 월을 한 번만 증가시키고 근무 타입 표시값 변경은 실제 참조 중인 월만 증가
- worker는 60초 지난 claim을 회수하고 1~60초 지수 backoff로 재시도하며 처리 완료 이벤트는 7일 보관

#### Event (개인 일정)

- `event_id` (UUID, PK)
- `owner_user_id` (FK → users)
- `title`, `memo`, `place`
- `all_day`
- `start_at`, `end_at` (timestamptz)
- `visibility_level` (DB 제약은 0 이상, 일정 생성 API 정책은 0~5)

#### Friendship / FriendLevelSetting (친구 및 공개 설정)

- `friendships`: 수락된 친구 관계를 `user_id_a < user_id_b` 규칙으로 1건 저장
- `friend_level_settings`: `owner_user_id -> friend_user_id` 방향의 캘린더 공개 설정
- 친구 캘린더 조회 조건:
  - 친구 관계가 존재해야 함
  - `friend_level_settings.owner_user_id = 캘린더 소유자`
  - `friend_level_settings.friend_user_id = 조회자`
  - `can_view = true`
  - 개인 일정은 `friend_level >= events.visibility_level` 추가 조건 적용
- 친구에게 공개되는 데이터 조회는 DB 뷰 `v_visible_events_for_friend`, `v_visible_work_shifts_for_friend` 기준으로 수행

#### Notification (알림)

- `notification_id` (UUID, PK)
- `user_id` (FK → users): 알림 수신자
- `notification_type`: 확장 가능한 문자열 타입
- `payload`: 관련 사용자/친구 요청 ID 등 JSON 데이터
- `actions`: 프론트 버튼/이동 동작을 표현하는 JSON 배열
- 친구 요청 수신 알림은 `FRIEND_REQUEST`로 생성하고, 수락/거절 처리 후 원본 알림을 `FRIEND_REQUEST_ACCEPTED` 또는 `FRIEND_REQUEST_REJECTED`로 갱신

#### ShiftTemplate (근무 템플릿)

- `template_id` (UUID, PK)
- `owner_user_id` (FK → users)
- `name`

#### ShiftTemplateVersion (템플릿 버전)

- `template_version_id` (UUID, PK)
- `template_id` (FK → shift_templates)
- `version_no`, `effective_from`

#### ShiftType (근무 타입)

- `shift_type_id` (UUID, PK)
- `template_id` (FK → shift_templates)
- `code` (예: 'D', 'E', 'N', 'OFF')
- `name`, `color`, `sort_order`
- `color` API 입력/응답 표준은 `#AARRGGBB` 문자열
- `base_color`: 농도 적용 전 기준 색상. 신규 API 요청은 불투명 `#FFRRGGBB`
- `color_intensity`: 기준 색상 농도 정수 퍼센트 `0..100`, 기본값 `100`
- 최종 `color` 계산은 각 RGB 채널에 `round(255 + (base - 255) × color_intensity / 100)` 적용

#### ShiftTypeSchedule (근무 시간표)

- `schedule_id` (UUID, PK)
- `shift_type_id` (FK → shift_types)
- `template_version_id` (FK → shift_template_versions)
- `start_time`, `end_time`
- `crosses_midnight`, `duration_minutes`

#### RefreshToken (리프레시 토큰)

- `token_id` (UUID, PK)
- `user_id` (FK → users)
- `token_hash` (SHA-256 해시)
- `device_info`, `expires_at`, `revoked_at`

### DTO/요청 형식

**근무표 생성 요청**:

```typescript
{
  work_date: "2024-01-15",
  shift_type_code: "D",
  note?: string
}
```

**근무표 배치 생성 요청**:

```typescript
{
  work_shifts: [
    { work_date: "2024-01-15", shift_type_code: "D", note: string },
    { work_date: "2024-01-16", shift_type_code: "E", note: string },
  ];
}
```

**개인 일정 생성 요청**:

```typescript
{
  title: "친구 약속",
  memo?: "저녁 식사",
  place?: "서울",
  all_day: false,
  start_at: "2026-07-07T10:00:00.000Z",
  end_at: "2026-07-07T11:00:00.000Z",
  visibility_level: 1
}
```

---

## 6. 로컬 실행 방법

### Docker PostgreSQL 초기화

로컬에서 Docker PostgreSQL을 사용할 때는 `migrations/final_schema.sql`을 실행해 최종 스키마를 생성합니다.

- **파일 역할**: `AGENTS.md`에 문서화된 shift_calendar 최종 PostgreSQL DDL을 실행 가능한 SQL로 정리한 로컬 초기화용 파일
- **의존성**: PostgreSQL 16, `pgcrypto` extension, `postgres` DB 사용자 권한
- **주의**: `DROP SCHEMA IF EXISTS public CASCADE`가 포함되어 있어 기존 `public` 스키마 데이터가 모두 삭제됩니다.

```bash
docker run --name shift-calendar-postgres \
  -e POSTGRES_DB=shift_calendar \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d postgres:16

docker exec -i shift-calendar-postgres \
  psql -U postgres -d shift_calendar < migrations/final_schema.sql
```

기존 DB에 전화번호 형식 제약만 추가할 때는 `migrations/enforce_users_phone_format.sql`을 적용합니다.

- **파일 역할**: 기존 `users.phone` 컬럼에 형식 CHECK 제약과 unique 인덱스를 보강
- **의존성**: `users.phone` 값이 null 또는 `000-000-0000`/`000-0000-0000` 형식이어야 함
- **사용 예**:

```bash
psql -U postgres -d shift_calendar -f migrations/enforce_users_phone_format.sql
```

기존 DB에 근무 타입 색상 기준값과 농도를 추가할 때는 두 단계 SQL을 순서대로 수동 적용합니다.

기존 DB에 월별 근무표 캐시 지원 테이블을 추가할 때는 DB 백업 후 다음 expand SQL을 서버 배포 전에 수동 적용합니다.

```bash
psql -U postgres -d shift_calendar \
  -f migrations/add_work_shift_month_cache_support.sql
```

- 기존 soft-deleted 행을 포함해 사용자·월 상태를 revision 1로 백필합니다.
- 이전 서버가 신규 테이블을 참조하지 않으므로 Blue/Green 롤백과 호환됩니다.
- 캐시/worker를 중단하기 전에는 두 테이블을 삭제하지 않습니다.

#### `migrations/add_shift_type_color_metadata.sql`

- **파일 역할**: 신규 서버 배포 전에 `shift_types.base_color`, `shift_types.color_intensity` nullable 컬럼을 확장하고 사전 색상 감사 결과를 출력
- **의존성**: 기존 `shift_types.color`가 PostgreSQL `text`이며, 대상 DB 백업과 감사 결과 확인이 선행되어야 함
- **사용 예**:

```bash
psql -U postgres -d shift_calendar \
  -f migrations/add_shift_type_color_metadata.sql
```

#### `migrations/backfill_shift_type_color_metadata.sql`

- **파일 역할**: 모든 API 인스턴스를 신규 dual-read/dual-write 서버로 교체한 뒤 레거시 행을 `base_color=color`, `color_intensity=100`으로 백필하고 기본값·NOT NULL·CHECK 제약을 적용
- **의존성**: expand SQL 적용, 신규 서버 API 검증, `color`/`base_color` 형식 및 농도 사전 감사 통과
- **사용 예**:

```bash
psql -U postgres -d shift_calendar \
  -f migrations/backfill_shift_type_color_metadata.sql
```

- 두 SQL은 운영 DB에서 `migrations/final_schema.sql` 대신 사용합니다.
- 확인되지 않은 과거 색상값이 있으면 backfill SQL이 예외로 중단되며 임의 변환하지 않습니다.
- 색상 메타데이터는 조회 필터·정렬·조인 조건이 아니므로 별도 인덱스를 만들지 않습니다.

### 필수 환경변수

`.env` 파일 생성:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=shift_calendar
DB_USER=postgres
DB_PASSWORD=postgres
DB_SSL=false
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret
KAKAO_CLIENT_ID=your-kakao-client-id
KAKAO_CLIENT_SECRET=your-kakao-client-secret
KAKAO_REDIRECT_URI=http://localhost:3000/test/callback.html
NODE_ENV=development
TRUST_PROXY_HOPS=0
```

### 실행 커맨드

```bash
# 개발 모드 (nodemon)
npm run dev

# 빌드
npm run build

# 프로덕션 실행
npm start
```

개발 실행은 `ts-node/register`를 사용하므로 `tsconfig.json`의 `ts-node.files=true`가 `src/types/express.d.ts` 로딩을 보장합니다.

### Stage 자원을 사용하는 로컬 API 디버깅 원칙

- 개발 PC에서 Stage PostgreSQL·Redis를 확인할 때는 외부 포트를 공개하지 않고 SSH local forwarding을 사용합니다.
- 기존 `.env`를 덮어쓰지 않고 gitignore 대상인 `.env.stage.local`에 터널의 `127.0.0.1` 포트와 Stage 접속 정보를 둔 뒤 `node --env-file=.env.stage.local -r ts-node/register src/index.ts`로 API만 실행합니다.
- Redis key 충돌을 막기 위해 `CACHE_KEY_PREFIX=shiftmate:stage-local:<개발자>`처럼 실제 Stage의 `shiftmate:stage`와 다른 prefix를 사용합니다.
- 로컬 API의 POST/PUT/DELETE는 실제 Stage DB를 변경할 수 있으므로 읽기 전용 DB 계정과 기존 Stage access token을 우선 사용합니다.
- **Stage DB를 바라보는 로컬 환경에서는 cache worker를 실행하지 않습니다.** 로컬 worker가 Stage Outbox를 claim하고 로컬 prefix만 무효화한 뒤 처리 완료로 표시하면 실제 Stage cache 무효화 이벤트가 유실될 수 있습니다.
- 컨테이너 IP 기반 SSH 터널은 Stage 컨테이너 재생성 후 IP를 다시 확인해야 합니다.

### Express Docker 이미지

#### 파일 역할

- **`Dockerfile`**: Node 22 Debian slim 멀티 스테이지 빌드로 TypeScript를 `dist/`에 컴파일하고, 최종 이미지에는 운영 의존성과 `dist/`만 포함
- **`.dockerignore`**: `.env*`, Git 메타데이터, 로컬 `node_modules`, `dist`, 문서, migration, 개발 테스트 파일을 빌드 컨텍스트에서 제외

#### 의존성

- Docker Buildx
- Intel N100 대상 플랫폼 `linux/amd64`
- 런타임 환경변수 파일
- 컨테이너에서 접근 가능한 PostgreSQL 주소

#### 사용 예

```bash
docker buildx build \
  --platform linux/amd64 \
  --load \
  -t shiftmate-api:1.0.0 \
  .

docker run --rm \
  --platform linux/amd64 \
  --name shiftmate-test \
  --env-file .env \
  -e INSTANCE_NAME=local-test \
  -p 3000:3000 \
  shiftmate-api:1.0.0

curl --fail http://127.0.0.1:3000/health
```

- `.env`의 `DB_HOST=localhost` 또는 `127.0.0.1`은 컨테이너 자신을 가리킵니다.
- Docker Desktop에서 호스트 PostgreSQL을 사용할 때는 `-e DB_HOST=host.docker.internal`을 추가합니다.
- 비공개 실행 환경에서는 PostgreSQL 컨테이너 서비스명 또는 실제 DB 주소를 사용합니다.
- 운영 실행에서는 `.env`의 `NODE_ENV=production`을 확인합니다. `--env-file` 값은 이미지의 기본 `NODE_ENV=production`보다 우선합니다.
- 최종 컨테이너는 `node` 사용자(UID/GID 1000), `node dist/index.js`, `STOPSIGNAL SIGTERM`으로 실행됩니다.
- Docker 내장 health check는 `PORT`의 루트 `/health`를 호출합니다.
- migration은 이미지에 포함하거나 컨테이너 시작 시 실행하지 않습니다.

### 공개 저장소 배포 경계

- 공개 저장소는 애플리케이션 코드, 범용 migration, 테스트와 API 계약만 관리합니다.
- 환경별 Compose, workflow, 호스트 경로, runner, upstream, secret 위치와 실제 인프라 식별자는 별도 비공개 구성에서 관리합니다.
- DB migration은 자동 실행하지 않고 백업과 대상 확인 후 개발자가 수동 실행합니다.

### DB 변경

- `migrations/` SQL은 개발자가 대상 DB와 롤백 방법을 확인한 뒤 직접 1회 실행
- 실행 전 DB 백업 필수
- 실행 파일, 목적, 결과, 테스트, 롤백 명령을 `WORKLOG.md`에 기록
- API 서버 시작 명령에는 DB 변경 명령을 포함하지 않음

### Swagger/Postman

- **Swagger**: `API_DOCS_ENABLED=true`일 때 그룹 API 전용 `/api-docs`, `/api-docs/openapi.json` 노출. 기존 API 전체 문서는 아직 미포함
- **Flutter 그룹 연동 가이드**: `_docs/GROUP_FRONTEND_API_GUIDE.md`
- **근무 타입 색상 API 가이드**: `_docs/SHIFT_TYPE_COLOR_API_GUIDE.md`
  - **파일 역할**: Flutter 프론트팀에 `color`, `base_color`, `color_intensity` 요청/응답, 레거시 fallback, 오류 코드, 미리보기 계산 및 연동 체크리스트 제공
  - **의존성**: 서버의 `GET/POST/PUT /shift-types` 계약과 `shift_types` 색상 메타데이터 migration
  - **사용 예**: 근무 타입 API 모델·요청 모델·색상 선택 화면을 구현하거나 연동 테스트할 때 기준 문서로 사용
- **테스트 페이지**:
  - `http://localhost:3000/test/kakao-login.html` (카카오 로그인 테스트)
  - `http://localhost:3000/test/naver-login.html` (네이버 로그인 테스트)
- **배포 가이드**: `_docs/DEPLOYMENT_GUIDE.md` 참고

### API 엔드포인트

- **Base URL**: `http://localhost:3000/api/v1`
- **기존 호환 Health Check**: `GET /api/v1/health`
- **Liveness**: `GET /api/v1/health/live` - Express 프로세스 생존 확인
- **Readiness**: `GET /api/v1/health/ready` - PostgreSQL `SELECT 1`까지 성공해야 200, 실패 시 503
- **컨테이너 식별 Health Check**: `GET /health` - `{ "status": "ok", "instance": "<INSTANCE_NAME>" }`
- **사용자 검색**: `GET /users/search?query={email_or_phone}` (인증 필요)
  - 이메일 형식이면 `users.email`에서 검색
  - 전화번호 형식이면 `users.phone`에서 검색
  - 전화번호 검색어는 10~11자리 숫자 또는 `000-000-0000`/`000-0000-0000` 형식을 서버에서 저장 형식으로 정규화
  - 이메일/전화번호 형식이 아니면 `INVALID_QUERY`로 거절
  - 현재 DB 스키마상 `users.email`, `users.phone`은 unique이므로 검색 결과는 최대 1명

---

## 7. 자주 발생하는 함정/주의사항

### 1. DB 스키마 변경

- **주의**: 뷰가 의존하는 컬럼 변경 시 `alter`가 실패할 수 있음
- **해결**: 백업 후 개발자가 수동 DDL을 1회 실행하고 `WORKLOG.md`에 결과 기록
- **금지**: API 인스턴스 시작 시 migration/`sequelize.sync()` 실행

### 2. 트랜잭션 롤백

- 트랜잭션 사용 시 `try-catch`에서 반드시 `rollback()` 호출
- `is_committed` 플래그로 중복 롤백 방지

### 3. Validation 에러 처리

- `express-validator` 사용 시 Controller에서 `validationResult(req)` 확인 필수
- 에러 응답은 일관된 포맷 유지

### 4. 인증 미들웨어

- `req.user`는 `authMiddleware`에서만 주입됨
- 인증이 필요한 라우트는 반드시 `authMiddleware` 적용

### 5. Refresh Token 관리

- Refresh Token은 DB에 해시값으로 저장 (원본 저장 금지)
- Token마다 무작위 `jti` 포함
- Token Rotation은 row lock과 단일 트랜잭션으로 처리

### 6. 환경변수

- `JWT_SECRET`과 `JWT_REFRESH_SECRET`은 반드시 다른 값 사용
- `DB_SYNC=true`는 모든 환경에서 시작 거부
- 3개 인스턴스의 DB 최대 연결 수는 `3 × DB_POOL_MAX`로 계산

### 7. 다중 인스턴스 동시성

- 사용자 기본 템플릿 생성은 사용자별 PostgreSQL advisory transaction lock으로 직렬화
- 반대 방향을 포함한 친구 요청 생성은 정렬된 사용자 쌍 advisory transaction lock으로 직렬화
- 친구 요청 수락/거절은 `friend_requests` row lock으로 직렬화

### 8. 프록시 및 종료

- 운영 컨테이너 포트는 외부 공개하지 않고 Nginx만 접근할 수 있게 제한
- Express는 컨테이너 외부 Nginx 연결을 위해 `0.0.0.0:${PORT}`에 listen
- Nginx 1단 구성은 `TRUST_PROXY_HOPS=1` 사용
- `SIGTERM`/`SIGINT` 수신 시 HTTP 신규 연결을 중단하고 기존 요청 완료 후 Sequelize pool 종료
- OAuth 수동 테스트 페이지와 CSP 비활성화는 개발 환경에서만 사용

### 9. 운영 요청 보안

- `helmet` 적용
- JSON/form 본문은 `REQUEST_BODY_LIMIT`로 제한하며 초과 시 413
- 입력 검증 규칙은 각 route의 `express-validator`로 정의
- 인증 route는 `validateRequestMiddleware`가 Controller 진입 전에 validation 오류를 차단하고 입력 원문 없는 공통 400 응답 반환
- 운영 5xx 응답은 내부 오류 메시지와 stack을 노출하지 않음
- 로그인/회원가입/OAuth/토큰 갱신은 IP 기준 `AUTH_RATE_LIMIT_*` 제한 적용
- Express 제한은 인스턴스별이므로 3개 인스턴스 전체 공통 제한은 Nginx `limit_req`에서 추가
- 비밀번호, Authorization/OAuth code, Access/Refresh Token은 로그 필드로 기록하지 않음

### 10. 월별 근무표 캐시

- Redis는 외부 포트를 공개하지 않고 Stage와 Center가 서로 다른 인스턴스와 key prefix를 사용
- Redis snapshot 오류·timeout·연결 실패는 API 오류로 바꾸지 않고 PostgreSQL fallback
- Redis eviction은 `volatile-lru`를 사용해 TTL 없는 revision fence를 snapshot보다 우선 보존
- readiness HTTP 상태는 PostgreSQL 기준이며 응답 `cache` 필드로 `ready/degraded/disabled`를 구분
- Redis snapshot은 인증과 날짜 validation을 통과한 근무표 조회에서만 생성되며 `401`/`400` 응답은 생성하지 않음
- 본인과 친구 조회는 조회자별 key가 아니라 소유자·월 key를 공유하므로 요청마다 `DBSIZE`가 증가하지 않음
- cache worker가 unhealthy이거나 미처리 Outbox가 증가하면 캐시 flag를 끄고 DB 조회로 즉시 전환
- Stage DB를 공유하는 로컬 디버깅에서는 worker를 실행하지 않고 별도 cache prefix를 사용

### 11. 그룹 기능과 캘린더 aggregate

```text
P0/P1 그룹 요청
  → groupRoutes (authMiddleware + express-validator)
  → groupController (공통 success/error wrapper, 안전한 구조화 로그)
  → groupService (Sequelize transaction + group row 선잠금)
  → Group / GroupMember / GroupInvitation / Notification / PostgreSQL view
```

- 그룹은 별도 캘린더·일정·근무를 소유하지 않습니다. `group_members`는 구성과 역할만 나타냅니다.
- 그룹 가입은 친구 관계나 `friend_level_settings`를 만들거나 변경하지 않습니다.
- 본인 캘린더는 `SELF`, 다른 활성 멤버는 friendship과 소유자→조회자 `can_view=true`일 때 `VISIBLE`, 그 외 `DENIED`입니다.
- `VISIBLE` 이벤트는 기존 `friend_level >= visibility_level`, 근무는 `visibility_level=0` 규칙을 그대로 사용합니다.
- `DENIED` 멤버는 응답에 남지만 그 멤버의 row와 숨겨진 개수는 반환하지 않습니다.
- 그룹 캘린더는 멤버/접근 상태, visible work shifts, visible events를 최대 3개 set-based query로 조회합니다.
- owner별 월 Redis v1은 그룹 aggregate에서 사용하지 않습니다. Stage 측정으로 병목이 확인될 때만 multi-owner cache를 별도 설계합니다.
- 모든 기존 그룹 쓰기는 group row를 먼저 `FOR UPDATE`로 잠근 뒤 멤버 제한·역할·초대 상태를 재확인합니다.
- 비멤버와 삭제 그룹은 모두 `404 GROUP_NOT_FOUND`, 활성 멤버의 역할 부족만 `403 GROUP_PERMISSION_DENIED`입니다.
- `groups.updated_at`은 그룹 정보·가입·제거·나가기·역할·소유권 변경 시 갱신하고 초대 생성·취소만으로는 변경하지 않습니다.

#### 그룹 파일 역할·의존성·사용 예

- **`migrations/add_group_feature.sql`**
  - 역할: 기존 DB에 그룹 3개 테이블을 추가하고 preflight/postflight 감사를 출력하는 expand migration
  - 의존성: PostgreSQL 16, 기존 `users`, `pgcrypto`
  - 사용 예: DB 백업 후 `psql ... -f migrations/add_group_feature.sql`
- **`migrations/rollback_group_feature.sql`**
  - 역할: 데이터 건수를 출력하고 명시적 승인 변수 뒤에만 그룹 테이블을 역순 삭제
  - 의존성: 그룹 데이터 폐기 별도 승인과 DB 백업
  - 사용 예: `psql ... -v confirm_group_feature_drop=true -f migrations/rollback_group_feature.sql`
- **`migrations/stage_group_feature_preflight.sql`**
  - 역할: 기존 Stage DB 식별, PostgreSQL 16/write 가능 상태, 권한, 그룹 API 기반 relation·컬럼, 부분 적용·index 이름 충돌을 read-only 감사
  - 의존성: 실제 Stage DB 이름을 전달하는 `expected_database` psql 변수
  - 사용 예: 백업 전에 단독 실행하고 감사 출력을 보관
- **`migrations/stage_apply_group_feature.sql`**
  - 역할: Stage 승인·백업 식별자·정본 checksum과 advisory lock을 확인하고 preflight → `add_group_feature.sql` → strict postflight 실행
  - 의존성: 세 필수 psql 변수와 승인된 `add_group_feature.sql` SHA-256
  - 사용 예: Stage 백업/복원 확인 뒤 개발자가 1회 수동 실행
- **`migrations/stage_group_feature_postflight.sql`**
  - 역할: 27개 컬럼, 20개 제약, 11개 index와 partial/unique 속성, 필수 COMMENT, 선택적 초기 데이터 0건을 예외 기반으로 판정
  - 의존성: 적용 완료된 그룹 3개 테이블과 `expected_database`
  - 사용 예: apply wrapper 내부 자동 실행 또는 사후 read-only 재감사
- **`migrations/pgadmin_stage_add_group_feature.sql`**
  - 역할: psql meta-command 없이 Stage preflight, public schema 그룹 DDL, strict postflight를 단일 transaction으로 실행하는 pgAdmin Query Tool 전용 SQL
  - 의존성: 파일 상단에 입력하는 실제 Stage DB 이름, 복원 가능한 백업 식별자, 확인 문자열
  - 사용 예: 세 설정값을 변경하고 pgAdmin에서 전체 파일을 Execute(F5)
- **`src/models/Group.ts`, `GroupMember.ts`, `GroupInvitation.ts`**
  - 역할: 최종 DDL의 그룹·멤버십 이력·초대 상태 Sequelize 매핑
  - 의존성: `src/config/database.ts`, 기존 `users`
  - 사용 예: `groupService` transaction에서 row lock·create/update
- **`src/types/group.ts`**
  - 역할: GroupSummary/Detail/Invitation/CalendarRange 공통 응답 타입
  - 의존성: 그룹 역할·초대 상태 union type
  - 사용 예: 서비스 반환 타입과 Flutter/OpenAPI 계약 대조
- **`src/utils/calendarSerialization.ts`**
  - 역할: DB date/time과 `#AARRGGBB`, UTC ISO 직렬화
  - 의존성: 없음
  - 사용 예: 개인/그룹 근무표가 같은 표시 형식을 사용
- **`src/services/groupService.ts`**
  - 역할: 그룹 transaction, 권한, 초대·알림, 3-query 캘린더 aggregate
  - 의존성: Sequelize 모델, 기존 visibility view, 환경변수
  - 사용 예: Controller 외부에서 actor ID와 검증된 DTO를 전달
- **`src/controllers/groupController.ts`, `src/routes/groupRoutes.ts`**
  - 역할: JWT actor, express-validator, HTTP wrapper/error code와 P0/P1 path
  - 의존성: `authMiddleware`, `groupService`
  - 사용 예: `/api/v1/groups`, `/api/v1/group-invitations/*`
- **`src/openapi.ts`, `src/openapi/groupOpenApi.json`**
  - 역할: `API_DOCS_ENABLED=true`일 때 그룹 OpenAPI 3.0.3 JSON과 Swagger UI 노출
  - 의존성: `swagger-ui-express`
  - 사용 예: Local/Stage `/api-docs`, `/api-docs/openapi.json`
- **`test/groupService.test.cjs`, `test/groupIntegration.test.cjs`**
  - 역할: 순수 규칙·OpenAPI·migration 정적 계약과 PostgreSQL 16 동시성/공개 회귀 검증
  - 의존성: build된 `dist`, 통합 테스트는 격리 PostgreSQL
  - 사용 예: `npm test`, `npm run test:group-integration`
- **`test/fixtures/groupDebug.compose.yml`**
  - 역할: 그룹 통합 테스트와 DebugMCP 검증 전용 PostgreSQL 16을 `127.0.0.1:55432`에 tmpfs로 기동
  - 의존성: Docker Compose, 고정 DB `shift_calendar_group_debug`, 로컬 전용 자격증명
  - 사용 예: `npm run debug:group-db:up`으로 기동하고 검증 후 `npm run debug:group-db:down`으로 제거
- **`_docs/GROUP_RUNTIME_VERIFICATION_CHECKLIST.md`**
  - 역할: migration, P0/P1 HTTP, transaction/lock, 공개 ACL, 3-query aggregate, 알림·로그·롤백의 실제 실행 판정과 디버거 시나리오
  - 의존성: 격리 PostgreSQL 16, VS Code/DebugMCP, 그룹 integration fixture
  - 사용 예: Local 증거와 Stage 증거를 분리해 항목별 `[x]` 및 실행 기록을 남김
- **`_docs/GROUP_FRONTEND_API_GUIDE.md`**
  - 역할: Flutter 프론트팀에 그룹 P0/P1 요청·응답 DTO, 화면별 호출 흐름, `owner_user_id`/`calendar_access` 상태 보존, 오류 UX와 Stage 인수 체크리스트 제공
  - 의존성: Stage 그룹 migration/API 배포, 기존 JWT refresh·공통 AppError·Dio 계층
  - 사용 예: 그룹 화면의 더미 datasource를 실제 API로 교체하고 DTO/domain state/widget 테스트를 작성할 때 기준 문서로 사용
- 서버 상세 endpoint·migration·역할은 `_docs/GROUP_API_GUIDE.md`, Flutter 연동은 `_docs/GROUP_FRONTEND_API_GUIDE.md`, 실제 동작 판정은 `_docs/GROUP_RUNTIME_VERIFICATION_CHECKLIST.md`, 설계 근거는 ADR-0021을 정본으로 사용합니다.

### 12. Apple·Google 인증 모듈

- **`src/services/appleService.ts`**
  - 역할: Apple challenge, code 교환, JWKS/claim 검증, 외부 refresh token 암복호화
  - 의존성: PostgreSQL OAuth 보조 테이블, Node.js crypto, Apple 공개 endpoint
  - 사용 예: `authController`가 검증된 플랫폼과 credential을 전달
- **`src/services/googleService.ts`**
  - 역할: Google ID Token 검증과 공개 claim 정규화
  - 의존성: `google-auth-library`, 고정 server audience
  - 사용 예: `POST /api/v1/auth/google/token` 처리
- **`src/models/OAuthLoginChallenge.ts`, `src/models/OAuthAuthorization.ts`**
  - 역할: Apple 일회성 challenge hash와 암호화된 외부 authorization 저장
  - 의존성: `users`, Apple add-only migration
  - 사용 예: 로그인 transaction과 challenge atomic consume
- **`migrations/*apple_auth*`, `migrations/*google_auth*`**
  - 역할: 공개 가능한 범용 preflight/apply/postflight/제한적 rollback SQL
  - 의존성: PostgreSQL 16과 기존 `users`
  - 사용 예: 백업과 대상 확인 후 개발자가 수동 실행
- **`src/openapi/appleAuthOpenApi.json`, `src/openapi/googleAuthOpenApi.json`**
  - 역할: 인증 endpoint와 공통 오류 응답 계약
  - 의존성: `src/openapi.ts`
  - 사용 예: `API_DOCS_ENABLED=true`인 개발 환경에서 확인
- **`test/appleAuth*.test.cjs`, `test/googleAuth*.test.cjs`**
  - 역할: crypto/claim/HTTP/transaction/migration 회귀 검증
  - 의존성: build된 `dist`, 통합 테스트는 격리 PostgreSQL
  - 사용 예: `npm test`, `npm run test:apple-integration`, `npm run test:google-integration`
- 실제 client ID, private key, 암호화 키와 환경별 인프라 식별값은 저장소에 기록하지 않고 `.env.example`에는 빈 값 또는 명시적 placeholder만 둡니다.

---

## 8. Express 작업 체크리스트

### 엔드포인트 추가 시

- [ ] `src/routes/*.ts`에 라우트 정의
- [ ] `express-validator`로 validation 미들웨어 추가
- [ ] 인증 필요 시 `authMiddleware` 적용
- [ ] `src/controllers/*.ts`에 컨트롤러 함수 작성
- [ ] `src/services/*.ts`에 비즈니스 로직 작성
- [ ] 에러 코드/응답 포맷 준수
- [ ] Swagger 업데이트 (구현 시)

### DB 변경 시

- [ ] 실행 SQL과 대상 환경 확인
- [ ] DB 백업
- [ ] 개발자가 SQL을 1회 수동 실행하고 결과 기록
- [ ] 롤백 SQL/복구 전략 확인
- [ ] 시드 데이터 업데이트 (필요 시)

### 배포 영향 시

- [ ] 환경변수 변경 사항 문서화
- [ ] Backwards compatibility 확인
- [ ] 수동 DB 변경 실행 순서와 기록 확인
- [ ] 롤백 계획 수립
- [ ] `3 × DB_POOL_MAX`와 PostgreSQL 연결 한도 확인
- [ ] liveness/readiness 및 SIGTERM 종료 확인
- [ ] 컨테이너별 고유 `INSTANCE_NAME` 확인
- [ ] Request ID, 본문 제한, 인증 rate limit 확인

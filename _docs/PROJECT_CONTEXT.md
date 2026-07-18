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

### 폴더 구조

```
src/
├── index.ts              # Express 앱 엔트리포인트
├── config/
│   ├── database.ts       # Sequelize 설정
│   └── environment.ts    # 필수 환경변수 및 숫자 설정 검증
├── routes/               # 라우터 정의
│   ├── index.ts         # 라우터 통합
│   ├── authRoutes.ts    # 인증 관련 라우트
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
│   ├── friendService.ts
│   ├── kakaoService.ts
│   └── shiftTemplateService.ts
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
    └── express.d.ts     # Express Request 타입 확장
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
  _next: NextFunction
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
  upsertWorkShift
);
```

#### 인증 Route에서 Validation 결과 공통 처리

```typescript
// src/routes/authRoutes.ts
router.post(
  "/login",
  [
    body("email").isEmail(),
    body("password").isString().notEmpty(),
  ],
  validateRequestMiddleware,
  login
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
  next: NextFunction
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
    max: db_pool_max,             // DB_POOL_MAX, 기본 10
    min: db_pool_min,             // DB_POOL_MIN, 기본 0
    acquire: db_pool_acquire_ms,  // DB_POOL_ACQUIRE_MS, 기본 30000
    idle: db_pool_idle_ms,        // DB_POOL_IDLE_MS, 기본 10000
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
- `start_time`, `end_time` 응답 포맷은 `HH:mm:ss` 문자열 또는 값이 없을 때 `null`
- 개인 캘린더의 `GET /events`, `POST /events`, `GET /calendar/day`, `GET /calendar/range` 이벤트 응답은 `EventApiModel` 필드를 반환
- `EventApiModel`: `event_id`, `title`, `memo`, `place`, `all_day`, `start_at`, `end_at`, `visibility_level`, `created_at`, `updated_at`
- `POST /events`는 `title`을 trim한 뒤 빈 문자열이면 `INVALID_TITLE`로 거절하고, `start_at`/`end_at`은 UTC `Z` ISO 문자열이며 `start_at < end_at`이어야 함
- `POST /events`의 `visibility_level`은 서버 정책상 0~5만 허용하고, `owner_user_id`와 `created_by_user_id`는 JWT 현재 사용자로 설정
- 개인 캘린더 조회는 JWT 현재 사용자 기준 `owner_user_id = current_user.user_id` 조건으로만 조회
- 친구 캘린더 조회는 `viewer_user_id`, `friend_user_id`, 친구 관계, `friend_level_settings` 공개 조건을 모두 확인한 뒤 동일한 근무표 필드 구조로 반환
- 이벤트 기간 조회는 `start_at < end_date + 1 day` AND `end_at > start_date` 겹침 조건으로 처리
- `/api` 응답은 기본적으로 `Cache-Control: private, no-store`, `Vary: Authorization` 헤더를 내려 인증 사용자별 응답 캐시 혼선을 방지

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

- **현재 미구현**: Swagger 문서화는 아직 추가되지 않음
- **추후 계획**: `/api-docs` 경로에 Swagger UI 추가 예정

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

| 변수명                   | 설명                                      | 기본값                  |
| ------------------------ | ----------------------------------------- | ----------------------- |
| `PORT`                   | 서버 포트                                 | `3000`                  |
| `NODE_ENV`               | `development`/`test`/`production`         | `development`           |
| `DB_SSL`                 | DB SSL 사용 여부 (`true`/`false`)         | `false`                 |
| `DB_POOL_MAX`            | 인스턴스당 DB 최대 연결 수                | `10`                    |
| `DB_POOL_MIN`            | 인스턴스당 DB 최소 연결 수                | `0`                     |
| `DB_POOL_ACQUIRE_MS`     | DB 연결 획득 제한시간                     | `30000`                 |
| `DB_POOL_IDLE_MS`        | 유휴 DB 연결 유지시간                     | `10000`                 |
| `TRUST_PROXY_HOPS`       | 신뢰할 Nginx 프록시 hop 수                | 개발 `0`, 운영 `1`      |
| `SHUTDOWN_TIMEOUT_MS`    | graceful shutdown 최대 대기시간           | `10000`                 |
| `CORS_ALLOWED_ORIGINS`   | 쉼표로 구분한 정확한 허용 Origin 목록     | 환경별 기본 목록        |
| `INSTANCE_NAME`          | health/log에서 식별할 컨테이너 이름       | `unknown`               |
| `REQUEST_BODY_LIMIT`     | JSON/form 요청 본문 최대 크기             | `100kb`                 |
| `AUTH_RATE_LIMIT_WINDOW_MS` | 인증 요청 제한 구간                    | `60000`                 |
| `AUTH_RATE_LIMIT_MAX`    | 구간당 인스턴스별 인증 요청 최대 횟수     | `10`                    |

#### 환경별 차이

**로컬 개발**:

```env
NODE_ENV=development
DB_SSL=false
TRUST_PROXY_HOPS=0
```

**스테이징/프로덕션**:

```env
NODE_ENV=production
DB_SSL=true
TRUST_PROXY_HOPS=1
CORS_ALLOWED_ORIGINS=https://shift-calendar.co.kr
INSTANCE_NAME=shiftmate-api-1
REQUEST_BODY_LIMIT=100kb
AUTH_RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX=10
```

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

- **현재 미구현**: 단위 테스트/통합 테스트는 아직 작성되지 않음

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

### DB 변경

- `migrations/` SQL은 개발자가 대상 DB와 롤백 방법을 확인한 뒤 직접 1회 실행
- 실행 전 DB 백업 필수
- 실행 파일, 목적, 결과, 테스트, 롤백 명령을 `WORKLOG.md`에 기록
- API 서버 시작 명령에는 DB 변경 명령을 포함하지 않음

### Swagger/Postman

- **Swagger**: 현재 미구현
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

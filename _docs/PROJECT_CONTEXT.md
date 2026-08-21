# 프로젝트 컨텍스트

## 1. 프로젝트 목적 & 사용자 시나리오

### 목적

근무표 관리 및 캘린더 일정 공유를 위한 백엔드 API 서버입니다. 사용자는 자신의 근무표를 관리하고, 친구와 일정을 공유할 수 있습니다.

### 주요 기능

- 카카오 Flutter SDK Access Token 서버 검증 로그인
- 네이버 OAuth 로그인
- Apple 서버 검증형 로그인
- Google ID Token 서버 검증 로그인
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

### Apple 로그인 구조

```text
Challenge 발급(state/nonce 원문은 앱, SHA-256 hash는 DB)
  → iOS native 또는 Android Web 인증
  → Android callback은 state 확인 후 고정 intent로만 303 전달
  → 로그인 완료 요청에서 challenge를 UPDATE ... RETURNING으로 1회 소비
  → Apple token endpoint code 교환(5초 timeout, 자동 재시도 없음)
  → JWKS RS256 + iss/aud/exp/iat/sub/nonce/email_verified 검증
  → User + 기본 템플릿 + OAuth authorization + ShiftMate JWT transaction
```

- 검증된 Apple subject가 사용자 식별 정본이고, 같은 이메일의 기존 계정은 자동 연결하지 않습니다.
- Apple refresh token은 계정 삭제 revoke를 위해 AES-256-GCM 암호화해 `oauth_authorizations`에 저장하며 앱 JWT `refresh_tokens`와 분리합니다.
- Apple 로그인은 feature flag 없이 항상 활성화되며 API 시작 전에 client/redirect, `.p8`, 암호화 키를 검증합니다.
- 상세 HTTP/DB/배포 계약은 `_docs/APPLE_SIGN_IN_SERVER_GUIDE.md`를 따릅니다.

### Google 로그인 구조

```text
Flutter google_sign_in
  → Google ID Token
  → POST /api/v1/auth/google/token
  → auth rate limit + express-validator
  → google-auth-library verifyIdToken(Web client audience 고정)
  → google_id 또는 lower(email) 정책
  → 신규 User + 기본 템플릿 + ShiftMate refresh token 단일 transaction
```

- 검증된 Google `sub`가 사용자 식별 정본이며, 요청 본문의 email/name/id는 받거나 신뢰하지 않습니다.
- `email_verified=true`인 유효 이메일만 허용하고, 같은 이메일의 기존 계정은 자동 연결하지 않습니다.
- 기존 Google 사용자의 저장 프로필은 claim 변경으로 자동 갱신하지 않습니다.
- Google 로그인은 feature flag 없이 항상 활성화되며 서버 시작 전에 Web OAuth Client ID를 검증합니다.
- API key·Web client secret·Google access token은 필요하지 않습니다. 상세 설정과 rollout은 `_docs/GOOGLE_SIGN_IN_SERVER_GUIDE.md`를 따릅니다.

### Kakao 로그인 구조

```text
Flutter Kakao SDK Access Token
  → POST /api/v1/auth/kakao/token
  → access_token_info의 app_id·회원번호 검증
  → user/me 회원번호 교차 검증
  → User + 기본 템플릿 + ShiftMate refresh token 단일 transaction
```

- `KAKAO_APP_ID`는 API 시작 전에 양의 숫자 문자열로 검증하며 Stage와 Production은 서로 다른 Kakao 앱을 사용합니다.
- token info와 user info는 각각 5초 timeout을 적용하고, 앱·회원번호 검증 전에는 DB에 접근하지 않습니다.
- 기존 이메일 계정의 `kakao_id`가 비어 있으면 자동 연결하지만 다른 Kakao ID가 있으면 `KAKAO_ACCOUNT_CONFLICT`로 거부합니다.
- `/auth/kakao` Web authorization-code 경로는 1차 배포의 7일 무사용 관찰 동안만 유지하는 deprecated endpoint입니다.
- Kakao Admin Key는 `KAKAO_ADMIN_KEY_FILE=/run/secrets/kakao_admin_key`로 탈퇴 worker에만 mount합니다.

### 회원 탈퇴 구조

```text
인증 + 최근 재인증 + 명시적 확인
  → users=DELETION_PENDING + 내부 session 차단 + 삭제 요청 기록
  → 전용 worker가 Apple revoke / Kakao unlink를 멱등 처리
  → 그룹 OWNER 자동 승계 또는 1인 그룹 삭제
  → 사용자·콘텐츠·관계·알림/push snapshot 물리 삭제
  → Redis tombstone + 사용자 월 cache 제거
  → 최소 운영 기록만 남기고 사용자 식별자 제거
```

- 회원 탈퇴는 일반 콘텐츠 soft delete의 예외이며 전체 계정과 사용자 생성 콘텐츠를 물리 삭제합니다.
- 외부 HTTP와 Redis 작업을 DB transaction 안에서 실행하지 않고 PostgreSQL lease worker로 재시도합니다.
- Google/Naver는 현재 서버가 revoke 가능한 OAuth token을 보관하지 않으므로 클라이언트 연동 해제와 내부 데이터 삭제를 분리합니다.
- `DELETE /api/v1/auth/account`는 `confirmation=true`와 JWT `auth_time` 10분 조건을 확인한 뒤 `202`로 접수합니다. 접수 즉시 사용자를 `DELETION_PENDING`으로 바꾸고 Refresh Token·푸시 기기를 무효화합니다.
- `src/workers/accountDeletionWorker.ts`는 provider 해제 → DB purge → Redis tombstone/purge 순서를 lease·backoff로 재시도합니다. Stage/Center에서는 `deploy/config/feature-flags.{stage,production}.env`가 API와 worker 플래그의 정본이며 기본값은 모두 `false`입니다.
- 배포 검증은 `ACCOUNT_DELETION_ENABLED=true`와 `ACCOUNT_DELETION_WORKER_ENABLED=false` 조합을 거절합니다. 활성화 전에 탈퇴 migration, worker 전용 `kakao_admin_key` Docker secret, Apple secret과 Redis/DB 연결을 준비하고 Stage E2E를 먼저 통과해야 합니다.
- 구현·운영 정본은 `_docs/ACCOUNT_DELETION_SERVER_DESIGN.md`이며, Stage 실제 Apple/Kakao·Redis 장애 E2E 전에는 Production에서 활성화하지 않습니다.

#### 캐시 적용 요청과 key 공유 계약

- `GET /work-shifts`, `GET /calendar/range`, `GET /calendar/day`의 근무표는 로그인 사용자의 월 snapshot을 사용합니다.
- `GET /friends/:friend_user_id/calendar/range`의 근무표는 friendship과 `can_view`를 PostgreSQL에서 확인한 뒤 친구 소유자의 같은 월 snapshot을 사용합니다.
- snapshot key는 `{CACHE_KEY_PREFIX}:work-shifts:v1:{owner_user_id}:{YYYYMM}`입니다. 조회자 ID를 포함하지 않으므로 소유자 본인과 여러 친구의 조회가 같은 key를 재사용합니다.
- 캘린더 응답 중 `events`는 캐시 대상이 아니며 본인 일정은 `events`, 친구 일정은 `v_visible_events_for_friend`에서 매번 조회합니다.
- 인증 또는 날짜 validation이 먼저 실패한 `401`/`400` 요청은 캐시 서비스에 진입하지 않으므로 Redis key를 생성하지 않습니다.
- `DBSIZE`는 요청 횟수가 아니라 현재 key 수입니다. 이미 존재하는 소유자·월 snapshot의 재조회는 `DBSIZE`를 증가시키지 않습니다.

### Push Worker 알림 구조

```text
친구·그룹 도메인 transaction
  ├─ notifications INSERT (인앱 알림 원본)
  └─ push_jobs INSERT (title/body/data snapshot, TTL 1시간)
      → commit
      → Push Worker가 FOR UPDATE SKIP LOCKED + lease로 claim
      → 수신자의 같은 환경 최신 활성 기기 한 대를 최초 1회 선택
      → push_deliveries에 선택을 고정
      → 전송 직전 최신 FCM token 재조회
      → Firebase Admin sendEach() → Android/iOS FCM
```

- API 서버는 FCM을 직접 호출하지 않으며 `notifications`가 항상 원본입니다.
- 대상 타입은 `FRIEND_REQUEST`, `FRIEND_ACCEPTED`, `FRIEND_REJECTED`, `GROUP_INVITATION`, `GROUP_INVITATION_ACCEPTED`, `GROUP_INVITATION_REJECTED`입니다.
- 선택 순서는 `last_seen_at DESC`, `target_updated_at DESC NULLS LAST`, `device_id ASC`이며 같은 job에서 다른 기기로 fallback하지 않습니다.
- 전달은 at-least-once입니다. FCM 성공 후 DB 반영 전 종료 시 중복될 수 있으므로 collapse ID와 클라이언트 `notification_id` 중복 제거를 함께 사용합니다.
- 원본 요청·초대가 응답/취소/만료되면 미전송 job을 취소합니다. 이미 provider 호출이 시작된 경합은 best-effort 한계입니다.

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
│   ├── deviceRoutes.ts  # 현재 설치 기기 idempotent 동기화
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
│   ├── googleService.ts # Google ID Token 검증, 계정 정책, 신규 transaction
│   ├── appleService.ts # challenge, code 교환, JWKS, authorization 암호화
│   └── shiftTemplateService.ts
├── workers/
│   ├── workShiftCacheWorker.ts # PostgreSQL Outbox 기반 Redis 무효화 worker
│   └── pushWorker.ts     # lease claim, 최신 기기 선택, FCM 전송 worker
├── utils/               # 공통 검증/정규화 유틸
│   ├── logger.ts        # 민감 오류 객체를 직렬화하지 않는 구조화 오류 로그
│   └── phone.ts         # 전화번호 저장 형식 검증 및 하이픈 정규화
├── models/              # Sequelize 모델
│   ├── User.ts
│   ├── UserDevice.ts
│   ├── PushJob.ts
│   ├── PushDelivery.ts
│   ├── Event.ts
│   ├── WorkShift.ts
│   ├── RefreshToken.ts
│   ├── OAuthLoginChallenge.ts
│   ├── OAuthAuthorization.ts
│   └── ... (템플릿 관련 모델들)
└── types/
    ├── express.d.ts     # Express Request 타입 확장
    └── workShift.ts     # DB/Redis 공통 근무표 API 모델

test/
├── workShiftMonthCacheService.test.cjs # 월 분할, key, ETag 단위 테스트
├── cacheIntegration.test.cjs           # PostgreSQL/Redis 통합 테스트
├── deploymentCacheRollout.test.cjs     # Redis/worker 배포·rollback 순서 정적 테스트
├── pushNotification.test.cjs           # 푸시 retry/migration/API/lease 계약 테스트
├── appleAuth.test.cjs                   # Apple crypto/JWKS/계약 단위·정적 테스트
├── appleAuthIntegration.test.cjs        # Apple DB transaction/atomic consume 통합 테스트
├── googleAuth.test.cjs                  # Google claim/계약/migration/CI 단위·정적 테스트
├── googleAuthIntegration.test.cjs       # Google DB transaction/동시성/rollback 통합 테스트
└── fixtures/
    ├── cacheIntegrationSchema.sql       # 캐시 격리 테스트 DB 초기화용 최소 schema
    └── googleAuthMigrationBaseSchema.sql # Google 격리 테스트 최소 기반 schema
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

#### 가입 프로필 완료 모듈

- **`src/services/profileService.ts` 역할**: 이름·IANA timezone·전화번호·직종·소속을 정규화하고 가입 완료 또는 일반 편집을 row lock과 단일 transaction으로 처리하며 전화번호 unique 경쟁을 409로 매핑
- **`src/middlewares/profileImageUpload.ts` 역할**: multipart 메모리 parser에서 파일 1개·5MB를 제한하고 JPEG/PNG/WebP MIME과 magic/컨테이너 구조 일치를 검증
- **`src/services/profileImageStorageService.ts` 역할**: 원본 파일명 대신 `<storage_prefix>/profiles/{user_id}/{uuid}.{ext}` key로 단일 S3 호환 object storage에 저장하고 CDN HTTPS URL을 생성하며 DB 실패 시 같은 key 삭제 지원
- **`src/openapi/profileAuthOpenApi.json` 역할**: `/auth/profile/complete`, 기존 `/auth/profile` 조회·편집과 JSON/multipart/오류 계약 정의
- **의존성**: profile completion DB expand migration, `multer`, `@aws-sdk/client-s3`, 공유 bucket/region, 환경별 `stage|center` prefix·IAM credential, CDN URL과 필요 시 AWS credential chain
- **사용 예**: DB와 storage를 먼저 준비한 뒤 `POST /api/v1/auth/profile/complete`에 JSON 또는 `profile_image` 파일 하나가 포함된 multipart 요청을 전송

#### 월별 근무표 캐시 모듈

- **`src/services/workShiftMonthCacheService.ts` 역할**: 월 분할, snapshot/lock/revision key, cache-aside, revision fence, ETag 생성
- **`src/services/workShiftCacheInvalidationService.ts` 역할**: 월 revision 증가와 Outbox 이벤트를 업무 transaction에 기록하고 commit 후 즉시 무효화
- **`src/workers/workShiftCacheWorker.ts` 역할**: `FOR UPDATE SKIP LOCKED` 방식 claim, 월별 이벤트 병합, Redis 재시도와 7일 완료 이벤트 정리
- **의존성**: PostgreSQL expand migration, 환경별 공유 Redis, `WORK_SHIFT_CACHE_ENABLED=true`
- **사용 예**: API는 `node dist/index.js`, worker는 `node dist/workers/workShiftCacheWorker.js`, worker health는 `--healthcheck`
- 캐시 flag가 `false`인 worker 본체는 Outbox를 claim하지 않고 대기하지만 health 명령은 PostgreSQL과 Redis를 모두 검사합니다. 활성화 시 API와 worker 컨테이너를 같은 `true` 환경으로 재생성합니다.

#### Apple 로그인 모듈

- **`src/services/appleService.ts` 역할**: 플랫폼별 challenge, Android callback allowlist, ES256 client secret, code 교환, JWKS 검증, 사용자/authorization transaction 처리
- **`src/models/OAuthLoginChallenge.ts` 역할**: raw credential 없이 일회성 state/nonce hash와 만료·소비 상태 매핑
- **`src/models/OAuthAuthorization.ts` 역할**: Apple subject/client 연결과 계정 삭제 revoke용 암호화 refresh token 매핑
- **`src/openapi/appleAuthOpenApi.json` 역할**: 3개 public endpoint와 Apple 오류 wrapper 계약
- **`migrations/stage_apple_auth_apply_pgadmin.sql` 역할**: Stage DB명·복원 백업·승인문구·PG16·기존 schema를 검증하고 Apple DDL과 strict postflight를 한 transaction으로 실행해 checksum/초기 0건 증거 출력
- **의존성**: PostgreSQL Apple add-only migration. 활성화 시에만 API 전용 `.p8` 선택적 override, 환경별 고정 AES key, Apple App/Services ID 설정
- **사용 예**: pgAdmin Stage 적용은 실행 파일의 세 승인값만 수정해 전체를 1회 실행하고, DB migration과 필수 Apple secret 설치 뒤 이미지를 배포합니다.

#### Google 로그인 모듈

- **`src/services/googleService.ts` 역할**: Google ID Token 검증, claim 정규화, 이메일 자동 연결 금지, provider subject advisory lock, 신규 사용자·기본 템플릿·refresh token transaction 처리
- **`src/openapi/googleAuthOpenApi.json` 역할**: `/auth/google/token`의 200/201 성공, validation/token/email/link/upstream/disabled 오류 계약
- **`migrations/google_auth_{preflight,postflight}.sql` 역할**: PostgreSQL 16/대상 DB/권한/충돌을 사전 감사하고 nullable `google_id`와 partial unique index를 strict 사후 검증
- **`migrations/stage_google_auth_apply_pgadmin.sql`, `center_google_auth_apply_pgadmin.sql` 역할**: 환경별 DB·백업·승인 guard와 DDL/postflight를 pgAdmin 단일 transaction으로 실행
- **의존성**: `google-auth-library`, Google Cloud Web application OAuth client ID, PostgreSQL add-only migration
- **사용 예**: DB를 먼저 적용하고 실제 `GOOGLE_SERVER_CLIENT_ID`를 설정한 Stage에 배포하여 실기기 E2E를 완료합니다.

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

- **카카오 SDK 토큰 검증·로그인 transaction**: `src/services/kakaoService.ts`
  - WebView 방식: `POST /api/v1/auth/kakao` (authorization code)
  - SDK 방식: `POST /api/v1/auth/kakao/token` (access_token 직접 전송)
- **네이버 OAuth**: `src/services/naverService.ts`
  - WebView 방식: `POST /api/v1/auth/naver` (authorization code)
  - SDK 방식: `POST /api/v1/auth/naver/token` (access_token 직접 전송)
- **Google OIDC**: `src/services/googleService.ts`
  - `POST /api/v1/auth/google/token`에서 Google ID Token만 수신
  - `GOOGLE_SERVER_CLIENT_ID`를 audience 하나로 고정하고 검증된 `sub`를 `users.google_id`로 저장
  - 같은 검증 이메일의 기존 계정은 `409 ACCOUNT_LINK_REQUIRED`; 자동 연결 금지
  - 공개키/네트워크 장애 시 `503 GOOGLE_UPSTREAM_UNAVAILABLE`
- **Apple OAuth**: `src/services/appleService.ts`
  - Challenge: `POST /api/v1/auth/apple/challenge`
  - Android form callback: `POST /api/v1/auth/apple/callback`
  - 로그인 완료: `POST /api/v1/auth/apple`
  - token endpoint 결과의 검증된 `id_token`을 정본으로 사용하고 client 입력 이메일을 받지 않음
  - 같은 검증 이메일의 기존 계정과 충돌하면 `ACCOUNT_LINK_REQUIRED`; 자동 연결 금지
- **Apple 로그인**: `src/services/appleService.ts`
  - `POST /api/v1/auth/apple/challenge`에서 일회성 state/nonce를 발급
  - `POST /api/v1/auth/apple`에서 code 교환과 JWKS/claim 검증 후 ShiftMate JWT 발급
  - state/nonce는 hash만 저장하고 외부 refresh token은 AES-256-GCM 암호문으로 분리 저장
  - 항상 활성, 동일 이메일 기존 계정은 자동 연결하지 않음
- **Google 로그인**: `src/services/googleService.ts`
  - `POST /api/v1/auth/google/token`에서 공식 라이브러리로 ID Token의 서명·issuer·audience·만료·verified email 검증
  - 검증된 `sub`를 `users.google_id`로 저장하고 신규 가입 전체를 transaction으로 처리
  - 항상 활성, 동일 이메일 기존 계정은 자동 연결하지 않음

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

- `POST /kakao` - deprecated 카카오 Web 로그인(7일 무사용 관찰 후 제거)
- `POST /kakao/token` - 카카오 SDK Access Token 검증 로그인
- `POST /naver` - 네이버 OAuth 로그인 (WebView)
- `POST /naver/token` - 네이버 OAuth 로그인 (SDK)
- `POST /google/token` - Google ID Token 서버 검증 로그인
- `POST /apple/challenge` - Apple 일회성 state/nonce challenge 발급
- `POST /apple/callback` - Android/Web form_post를 고정 앱 intent로 303 전달
- `POST /apple` - Apple code 서버 교환·검증 후 ShiftMate JWT 발급
- `POST /refresh` - 토큰 갱신
- `POST /logout` - 로그아웃
- `POST /logout-all` - 모든 기기 로그아웃 (인증 필요)
- `GET /profile` - 내 정보 조회 (인증 필요)
- `POST /profile` - 내 정보 수정 (인증 필요)
- `POST /profile/complete` - 가입 프로필 최초 완료, JSON 또는 이미지 multipart (인증·rate limit 적용)

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
- `PUT /devices/current` - 인증 사용자의 현재 설치 UUID·권한·FCM target 멱등 동기화

**친구 요청/알림 응답 계약**:

- `FRIEND_REQUEST` 알림은 `payload.request_id`로 `friend_requests.request_id`와 연결되며, `actions`에 `accept`/`reject` 버튼 정보를 포함
- `PUT /friend-requests/:request_id/respond` 성공 시 `friend_requests.status`를 `ACCEPTED` 또는 `REJECTED`로 변경
- 같은 트랜잭션에서 요청 수신자에게 있던 원본 `FRIEND_REQUEST` 알림을 처리 완료 상태로 갱신
  - 수락: `notification_type=FRIEND_REQUEST_ACCEPTED`, `title=친구 요청 수락`, `actions=[]`
  - 거절: `notification_type=FRIEND_REQUEST_REJECTED`, `title=친구 요청 거절`, `actions=[]`
- 응답 `data.notification`에는 갱신된 원본 알림을 포함하므로 프론트는 알림 목록을 재조회하지 않아도 해당 카드 UI를 즉시 교체할 수 있음
- 요청자에게는 기존처럼 `FRIEND_ACCEPTED` 또는 `FRIEND_REJECTED` 새 알림을 생성

#### Swagger/OpenAPI

- **그룹·기기·Apple·Google·Kakao 인증 API 구현됨**: `API_DOCS_ENABLED=true`일 때 `/api-docs`와 `/api-docs/openapi.json` 노출
- **범위 제한**: 현재 OpenAPI 3.0.3 문서는 그룹 P0/P1, `PUT /devices/current`, Apple 로그인 3개 endpoint, Google token 로그인 endpoint와 관련 schema를 포함하며 기존 API 전체 문서는 아직 미포함

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
- **Apple 인증 로그**: `logAppleAuthEvent()`는 provider/platform/user/action/result/error_code/duration만 기록하고 code/token/raw state·nonce/email은 기록하지 않음
- **Google 인증 로그**: `logGoogleAuthEvent()`는 request_id/action/result/error_code/duration, 성공 시 내부 user_id/is_new_user만 기록하고 ID Token/email/sub/claim은 기록하지 않음
- **Kakao 인증 로그**: `logKakaoAuthEvent()`는 request_id/action/result/error_code/duration과 내부 user_id/is_new_user만 기록하며 Access Token/email/Kakao ID/App ID/외부 응답 원문은 받지 않음

### 3.8 환경변수 표

> 로컬·테스트에서는 `.env`/프로세스 환경을 사용합니다. Stage/Center의 boolean feature flag 6개는 홈서버 `.env`에서 직접 관리하지 않고 `deploy/config/feature-flags.{stage,production}.env`를 Git 정본으로 사용합니다.

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
| `KAKAO_CLIENT_ID`     | deprecated Web 경로 Client ID | `your-kakao-client-id`                  | 1차 관찰 기간 |
| `KAKAO_CLIENT_SECRET` | deprecated Web 경로 Client Secret | `your-kakao-client-secret`          | 1차 관찰 기간 |
| `KAKAO_REDIRECT_URI`  | deprecated Web 경로 Redirect URI | `http://localhost:3000/test/callback.html` | 1차 관찰 기간 |
| `KAKAO_APP_ID`        | 허용할 카카오 앱의 숫자형 App ID | `123456`                              | API, 환경별 상이 |
| `KAKAO_ADMIN_KEY_FILE` | Kakao Admin Key Docker secret 경로 | `/run/secrets/kakao_admin_key`       | 탈퇴 worker 활성 시 |
| `NAVER_CLIENT_ID`     | 네이버 OAuth Client ID     | `your-naver-client-id`                     | 모든 환경 |
| `NAVER_CLIENT_SECRET` | 네이버 OAuth Client Secret | `your-naver-client-secret`                 | 모든 환경 |
| `PROFILE_IMAGE_STORAGE_BUCKET` | Stage·Center 공유 프로필 이미지 S3 호환 bucket | `shiftmate-profile-images` | API, 운영 환경 공통 |
| `PROFILE_IMAGE_STORAGE_REGION` | 공유 object storage region | `ap-northeast-2` | API, 운영 환경 공통 |
| `PROFILE_IMAGE_STORAGE_PREFIX` | 공유 bucket의 객체 환경 prefix | Stage `stage`, Center `center` | API, 환경별 필수 |
| `PROFILE_IMAGE_PUBLIC_BASE_URL` | 저장 object 공개 CDN HTTPS base URL | `https://cdn.example.com` | API, 환경별 상이 |

#### 선택 환경변수

| 변수명                                | 설명                                     | 기본값                         |
| ------------------------------------- | ---------------------------------------- | ------------------------------ |
| `PORT`                                | 서버 포트                                | `3000`                         |
| `NODE_ENV`                            | `development`/`test`/`production`        | `development`                  |
| `DB_SSL`                              | DB SSL 사용 여부 (`true`/`false`)        | `false`                        |
| `DB_POOL_MAX`                         | 인스턴스당 DB 최대 연결 수               | `10`                           |
| `DB_POOL_MIN`                         | 인스턴스당 DB 최소 연결 수               | `0`                            |
| `DB_POOL_ACQUIRE_MS`                  | DB 연결 획득 제한시간                    | `30000`                        |
| `DB_POOL_IDLE_MS`                     | 유휴 DB 연결 유지시간                    | `10000`                        |
| `TRUST_PROXY_HOPS`                    | 신뢰할 Nginx 프록시 hop 수               | 개발 `0`, 운영 `1`             |
| `SHUTDOWN_TIMEOUT_MS`                 | graceful shutdown 최대 대기시간          | `10000`                        |
| `CORS_ALLOWED_ORIGINS`                | 쉼표로 구분한 정확한 허용 Origin 목록    | 환경별 기본 목록               |
| `INSTANCE_NAME`                       | health/log에서 식별할 컨테이너 이름      | `unknown`                      |
| `REQUEST_BODY_LIMIT`                  | JSON/form 요청 본문 최대 크기            | `100kb`                        |
| `AUTH_RATE_LIMIT_WINDOW_MS`           | 인증 요청 제한 구간                      | `60000`                        |
| `AUTH_RATE_LIMIT_MAX`                 | 구간당 인스턴스별 인증 요청 최대 횟수    | `10`                           |
| `PROFILE_IMAGE_STORAGE_ENDPOINT`      | S3 호환 endpoint, AWS S3는 생략          | 없음                           |
| `PROFILE_IMAGE_STORAGE_FORCE_PATH_STYLE` | S3 path-style 강제 여부                | `false`                        |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | static credential이 필요한 storage 자격 증명 | workload role 사용 시 생략 |
| `WORK_SHIFT_CACHE_ENABLED`            | 월별 근무표 Redis 캐시/worker 활성화     | `false`                        |
| `REDIS_URL`                           | 비밀번호 포함 환경별 Redis 내부 URL      | 캐시 활성 시 필수              |
| `CACHE_KEY_PREFIX`                    | Stage/Center 분리 Redis key prefix       | 캐시 활성 시 필수              |
| `WORK_SHIFT_CACHE_TTL_SECONDS`        | snapshot 기본 TTL                        | `86400`                        |
| `WORK_SHIFT_CACHE_TTL_JITTER_SECONDS` | TTL 최대 jitter                          | `3600`                         |
| `WORK_SHIFT_CACHE_LOCK_MS`            | stampede 방지 lock 만료                  | `5000`                         |
| `WORK_SHIFT_CACHE_WAIT_MS`            | lock 대기 요청의 최대 재조회 시간        | `500`                          |
| `REDIS_CONNECT_TIMEOUT_MS`            | Redis 연결 제한시간                      | `500`                          |
| `REDIS_COMMAND_TIMEOUT_MS`            | Redis 명령 제한시간                      | `100`                          |
| `CACHE_OUTBOX_POLL_MS`                | worker idle polling 간격                 | `1000`                         |
| `CACHE_OUTBOX_BATCH_SIZE`             | worker 1회 claim 최대 이벤트             | `100`                          |
| `GROUP_MEMBER_LIMIT`                  | 그룹 최대 활성 멤버                      | `20`                           |
| `GROUP_INVITATION_TTL_DAYS`           | 그룹 초대 만료 일수                      | `7`                            |
| `GROUP_CALENDAR_MAX_RANGE_DAYS`       | 그룹 캘린더 양 끝 포함 최대 일수         | `100`                          |
| `API_DOCS_ENABLED`                    | `/api-docs`와 원본 OpenAPI 노출          | `false`                        |
| `PUSH_JOB_ENQUEUE_ENABLED`            | 신규 지원 알림의 push job 생성           | `false`                        |
| `PUSH_WORKER_ENABLED`                 | Push Worker claim/전송 활성화            | `false`                        |
| `PUSH_APP_ENVIRONMENT`                | 기기·자격 증명 환경 (`STAGE`/`PROD`)     | 환경별 필수                    |
| `GOOGLE_APPLICATION_CREDENTIALS`      | read-only Firebase service account 경로  | worker 활성 시 필수            |
| `FIREBASE_PROJECT_ID`                 | 환경별 Firebase project ID               | worker 활성 시 필수            |
| `PUSH_JOB_POLL_MS`                    | worker idle polling 간격                 | `1000`                         |
| `PUSH_JOB_BATCH_SIZE`                 | 1회 claim/sendEach 최대 job              | `20`                           |
| `PUSH_JOB_LEASE_SECONDS`              | 처리 lease                               | `120`                          |
| `PUSH_MAX_ATTEMPTS`                   | 최대 provider 시도 수                    | `6`                            |
| `PUSH_JOB_TTL_SECONDS`                | job·FCM TTL                              | `3600`                         |
| `PUSH_TERMINAL_RETENTION_DAYS`        | terminal job/delivery 보관일             | `30`                           |
| `APPLE_TEAM_ID`                       | Apple Developer Team ID                  | 활성 시 필수                   |
| `APPLE_KEY_ID`                        | Sign in with Apple key ID                | 활성 시 필수                   |
| `APPLE_IOS_CLIENT_ID`                 | iOS Bundle ID                            | `com.hspark.shiftmate`         |
| `APPLE_SERVICE_ID`                    | 환경별 Android/Web Services ID           | 활성 시 필수                   |
| `APPLE_REDIRECT_URI`                  | 환경별 exact HTTPS callback              | 활성 시 필수                   |
| `APPLE_PRIVATE_KEY_PATH`              | API 전용 `.p8` mount 경로                | `/run/secrets/apple_signin.p8` |
| `APPLE_TOKEN_ENCRYPTION_KEY`          | 32바이트 base64 AES-GCM 영속 키          | 활성 시 필수                   |
| `APPLE_CHALLENGE_TTL_SECONDS`         | state/nonce challenge TTL(60~600)        | `300`                          |
| `APPLE_JWKS_CACHE_SECONDS`            | Apple JWKS cache 상한(60~86400)          | `21600`                        |
| `GOOGLE_SERVER_CLIENT_ID`             | 서버 검증 audience인 Web OAuth Client ID | 활성 시 필수                   |

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

`JWT_SECRET`/`JWT_REFRESH_SECRET` 누락, 두 값의 동일 설정, 잘못된 숫자/boolean 환경변수, `DB_SYNC=true`는 서버 시작 전에 오류로 처리합니다. API는 Apple Team/Key/Client/redirect, `.p8` 읽기, 32바이트 encryption key와 Google `GOOGLE_SERVER_CLIENT_ID` 형식을 DB 연결 전에 항상 검증합니다. 공통 `validateEnvironment()`는 worker 전용 secret을 요구하지 않으며, push worker만 Firebase project/credential을, 회원 탈퇴 worker만 Kakao Admin Key를 별도 검증합니다. 회원 탈퇴 worker는 Apple revoke 때문에 `.p8`도 검증하지만 cache/push worker는 요구하지 않습니다. 필수 환경변수 누락 로그에는 secret 값 없이 key 이름과 `ENVIRONMENT_VALIDATION_ERROR`만 기록합니다.

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
- `npm run test:apple-integration`: 고정 격리 PostgreSQL 16에서 신규 사용자 transaction, atomic consume/replay 경쟁, 이메일 자동 연결 금지, refresh token 누락 rollback, 기존 authorization 재로그인, Android 고정 callback을 검증
- `test/fixtures/appleAuthMigrationBaseSchema.sql`: Apple preflight/apply/postflight/rollback 실DB 검증용 최소 schema이며 운영 DB에서 실행 금지
- `npm run test:google-integration`: 고정 격리 PostgreSQL 16에서 Google migration, 신규 사용자 transaction, 기존 사용자 profile 불변, 이메일 자동 연결 금지, subject 동시 요청 단일 사용자 생성, rollback을 검증
- `test/fixtures/googleAuthMigrationBaseSchema.sql`: Google migration·로그인 통합 테스트용 최소 schema이며 실행 시 대상 `public` schema를 재생성하므로 운영/공유 개발 DB에서 실행 금지
- `npm run test:profile-integration`: 고정 격리 PostgreSQL 16에서 profile migration/backfill/down, 완료 멱등성·transaction rollback, JSON/multipart, MIME 불일치·5MB 제한, object 저장 실패·DB 실패 정리를 검증
- `test/fixtures/profileCompletionMigrationBaseSchema.sql`: 가입 프로필 migration 전 users 기반 schema와 backfill 대상/비대상 fixture이며 운영/공유 개발 DB에서 실행 금지

---

## 5. 데이터/도메인 개요

### 주요 엔티티

#### User (사용자)

- `user_id` (UUID, PK)
- `email`, `name`, `profile_image_url`
- `phone`: nullable unique, `000-000-0000` 또는 `000-0000-0000` 형식만 저장
- `job_type`: nullable `NURSE | DOCTOR | EMT | OTHER`
- `workplace`: nullable, trim 기준 1~100자
- `profile_completed_at`: 가입 프로필 최초 완료 시각. `null`이면 `requires_profile_setup=true`
- `kakao_id`, `apple_id`, `google_id`, `naver_id` (OAuth)
- `timezone`
- `account_status`: `ACTIVE | DELETION_PENDING`
- `deletion_requested_at`: 탈퇴 접수 시각. `ACTIVE`인 동안 `null`

#### OAuthLoginChallenge / OAuthAuthorization

- `oauth_login_challenges`: Apple `state`/`nonce` SHA-256 hash, 플랫폼별 client/redirect, 5분 만료와 원자적 소비 시각. raw credential은 저장하지 않습니다.
- `oauth_authorizations`: `user_id` FK, Apple provider subject/client unique, AES-256-GCM refresh token 암호문/IV/auth tag, revoke 상태를 저장합니다.
- Apple authorization은 앱 JWT `refresh_tokens`와 수명·용도가 다르며 서로 대체하지 않습니다.

#### AccountDeletionRequest / AccountDeletionProviderTask

- `account_deletion_requests`: 사용자 탈퇴 접수, worker lease, DB/Redis purge 진행 상태를 보관하고 완료 시 `user_id`를 제거합니다.
- `account_deletion_provider_tasks`: Apple revoke와 Kakao unlink의 공급자별 멱등 상태·재시도를 보관하며 token·이메일·provider subject는 저장하지 않습니다.
- 상세 컬럼, FK 변경, 삭제 순서와 rollout은 `_docs/ACCOUNT_DELETION_SERVER_DESIGN.md`가 정본입니다.

#### OAuthLoginChallenge / OAuthAuthorization

- `oauth_login_challenges`: Apple `state`/`nonce` SHA-256 hash, 플랫폼별 client/redirect, 5분 만료와 원자적 소비 시각. raw credential은 저장하지 않습니다.
- `oauth_authorizations`: `user_id` FK, Apple provider subject/client unique, AES-256-GCM refresh token 암호문/IV/auth tag, revoke 상태를 저장합니다.
- Apple authorization은 앱 JWT `refresh_tokens`와 수명·용도가 다르며 서로 대체하지 않습니다.

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

#### UserDevice / PushJob / PushDelivery

- `user_devices`: 환경별 설치 UUID와 로그인 사용자, Android/iOS, 권한·활성 상태, FCM target, 앱 버전, 최신 활동 시각을 관리합니다. raw target은 API 응답과 로그에 노출하지 않습니다.
- `push_jobs`: `notifications.notification_id`당 최대 1건이며 수신자와 표시/data snapshot, `LATEST_ACTIVE`, TTL, retry/lease 상태를 저장합니다. 과거 알림은 backfill하지 않습니다.
- `push_deliveries`: job에서 최초 선택한 기기 1대를 고정하고 provider message ID, target SHA-256 hash, 시도/오류/전송 시각을 기록합니다.
- Stage/Production은 DB, Firebase project, credential, `PUSH_APP_ENVIRONMENT`를 모두 분리합니다.

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

기존 DB에 가입 프로필 완료 상태와 선택 근무 정보를 추가할 때는 `_docs/PROFILE_COMPLETION_GUIDE.md`를 따릅니다.

- **범용 파일 역할**: `profile_completion_preflight.sql` → `add_profile_completion_support.sql` → `profile_completion_postflight.sql` 순서로 PostgreSQL 16 기반 schema와 조건부 backfill을 검증
- **환경별 파일 역할**: `stage_profile_completion_apply_pgadmin.sql`, `center_profile_completion_apply_pgadmin.sql`이 대상 DB명·복원 시험 백업·승인문구·권한·동시 실행 잠금·사후 건수를 한 transaction에서 검증
- **롤백**: `rollback_profile_completion_support.sql`은 별도 승인을 받아 신규 제약 2개와 컬럼 3개만 제거하며 기존 phone 데이터·제약은 유지

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
KAKAO_APP_ID=123456
KAKAO_ADMIN_KEY_FILE=/run/secrets/kakao_admin_key
GOOGLE_SERVER_CLIENT_ID=replace-with-web-oauth-client-id.apps.googleusercontent.com
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

# Push Worker (빌드 후)
npm run start:push-worker

# Push Worker readiness (메시지 미전송)
node dist/workers/pushWorker.js --healthcheck
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

- **배포 저장소**: `hspark-1/shift_calendar_server-deploy`의 `main`
- **파일 역할**:
  - `.github/workflows/validate-main.yml`: main PR에서 build·단위/정적 계약, launcher/deploy Bash, sudoers, YAML과 문서 동기화를 검증하는 branch protection 필수 check
  - `.github/workflows/deploy-production.yml`: main push 자동 실행과 수동 재실행, unit/cache/push/회원 탈퇴/Apple/Google auth integration 검증, `linux/amd64` 이미지 빌드·GHCR push, self-hosted exact checkout과 launcher 호출
  - `.github/workflows/rollback-production.yml`: 기존 commit SHA 이미지를 Stage와 Center에 함께 재배포
  - `deploy/compose.production.yaml`: Blue/Green API 6개, cache/Push/회원 탈퇴 worker 각 2개, singleton Redis, Firebase secret과 API·탈퇴 worker용 Apple secret을 정의하며 main 배포마다 `/opt/shiftmate/compose.yaml`로 검증·원자 동기화되는 Center base Compose 정본
  - `deploy/compose.stage.yaml`: Stage API 3201, Redis, cache/Push/회원 탈퇴 worker, Firebase secret과 API·탈퇴 worker용 Apple secret을 정의하며 main 배포마다 `/opt/shiftmate-stage/compose.yaml`로 검증·원자 동기화되는 Stage base Compose 정본
  - `deploy/config/feature-flags.production.env`, `feature-flags.stage.env`: 비밀값 없는 6개 boolean flag의 환경별 Git 정본. `deploy/shiftmate-deploy-launcher`, `deploy/shiftmate-deploy`와 두 Compose에 의존하며 main 배포마다 각 홈서버 project의 `feature-flags.env`로 검증·원자 동기화됩니다. 기능 활성화 예시는 Stage 파일의 대상 key만 `true`로 변경해 배포·검증한 뒤 별도 commit에서 Production 파일을 변경하는 방식입니다.
  - `deploy/stage.deploy.env.example`: 홈서버 Stage API/cache worker/push worker/회원 탈퇴 worker/Redis 서비스명과 외부 health URL의 root 전용 설정 예시
  - `deploy/shiftmate-deploy`: 하나의 이미지 digest를 Stage API/세 worker에 먼저 적용한 뒤 Center 비활성 색상 API/세 worker에 배포하고, 전체 health 검사·Nginx 전환·통합 실패 복원 수행
  - `deploy/shiftmate-bootstrap`: 기존 운영 구성을 Blue/Green으로 전환하는 최초 1회용 스크립트
  - `deploy/nginx/shiftmate-upstream-{blue,green}.conf`: Center Blue/Green 포트를 `shiftmate_center_api_cluster`로 정의
  - `deploy/nginx/shiftmate-stage-upstream.conf`: 기존 Stage 3201을 `shiftmate_stage_api_cluster`로 정의하는 고정 snippet
  - `deploy/shiftmate-deploy-launcher`: root trust anchor. self-hosted exact checkout의 repository/workspace/commit/image SHA와 배포 엔진·두 base Compose·두 feature flag config의 tree mode/blob을 검증하고 root 임시 번들로 실행
  - `deploy/sudoers/github-runner-shiftmate`: `github-runner`가 root 소유 launcher만 비밀번호 없이 호출하도록 허용하며 저장소 스크립트 직접 sudo는 금지
  - `DEPLOY_README.md`: 저장소 루트에서 바로 확인하는 홈서버 CI/CD 실행 가이드로, 정본 `_docs/CI_CD_DEPLOYMENT_GUIDE.md`와 동일한 절차 유지
  - `_docs/CI_CD_DEPLOYMENT_GUIDE.md`: 홈서버 사전 구성, runner 설치, 최초 배포, 롤백 및 장애 대응 절차
- **의존성**: Private GitHub 저장소, GHCR, `shiftmate-production` label의 전용 self-hosted runner, Docker Compose, Nginx, 기존 운영 `.env`와 외부 Docker 네트워크, Stage 3201 서비스 및 실제 HTTPS health URL
- **캐시 배포 의존성**: Center/Stage 별도 Redis, Stage API/worker/Redis 서비스명, 환경별 `REDIS_URL`/`CACHE_KEY_PREFIX`, 사전 expand migration
- **Push 배포 의존성**: 환경별 Firebase project/service account, `/opt/shiftmate{,-stage}/secrets` root:root 700과 그 아래 `firebase.json` root:root 444, Stage Push Worker 서비스, push expand migration, 최초 비활성인 enqueue/worker flag
- **Apple 배포 의존성**: Apple add-only migration을 먼저 적용하고 Services ID/redirect/encryption key와 `apple_signin.p8`(`root:root 0444`)을 Stage/Center에 준비한 뒤 배포
- **사용 예**: 환경별 feature flag config를 변경한 commit을 main에 반영해 자동 배포를 시작합니다. self-hosted job은 같은 SHA를 checkout하고 launcher 검증 후 해당 commit의 배포 엔진, 두 base Compose와 두 flag config를 함께 적용합니다.
- **문서 동기화 규칙**: 배포 절차 변경 시 `DEPLOY_README.md`와 `_docs/CI_CD_DEPLOYMENT_GUIDE.md`를 함께 갱신하고 내용 일치를 검사
- **원칙**: 배포·롤백은 동일한 `shiftmate-deploy` 경로를 사용하고 Stage API/세 worker와 Center API 3개/세 worker는 같은 불변 GHCR digest를 실행하며 DB migration은 자동 실행하지 않음
- **Stage 복구 원칙**: 기존 Stage readiness 실패는 컨테이너 상태·최근 로그를 남기는 진단 신호이며 새 이미지 적용을 차단하지 않음. 새 Stage API readiness와 세 worker health는 적용 후 필수 gate로 유지하고 실패 시 이전 override를 복원
- **Compose profile 검증**: Center API 6개와 worker 6개는 모두 `blue` 또는 `green` profile에 속하므로 전체 구성 검사에는 두 profile을 명시
- **Runner 권한 계약**: sudoers는 `/usr/local/sbin/shiftmate-deploy-launcher`만 허용. launcher는 고정 repository/actor/workspace, exact source SHA, 배포 엔진·두 Compose·두 flag config의 Git tree mode/blob과 불변 GHCR commit 이미지를 거부 우선 방식으로 검증하고 root 임시 번들만 실행
- **배포 config 적용 계약**: main의 `deploy/compose.{production,stage}.yaml`과 `deploy/config/feature-flags.{production,stage}.env`를 root 소유 홈서버 Compose/`feature-flags.env`로 검증 후 원자 동기화합니다. flag config는 정확한 6개 key와 `true|false`만 허용하며, 탈퇴 API 활성·worker 비활성 조합은 거절합니다. 최초 전환 시 `.env`의 동일 key line을 값 노출 없이 자동 제거하며, 전체 배포 실패 시 두 Compose·두 flag config·정리 전 `.env`를 함께 복원합니다. `.deploy.env`, secret 값과 DB는 자동 변경하지 않습니다.
- **Stage image 적용 계약**: 자동 동기화된 Stage base Compose에 root 관리 `compose.deploy.yaml`을 합성해 API/cache worker/push worker/회원 탈퇴 worker image만 불변 digest로 덮어씀
- **Firebase secret 계약**: service account JSON은 Git·이미지·`.env`에서 제외하고 Compose project의 `./secrets/firebase.json`을 Push Worker의 `/run/secrets/firebase.json`에만 read-only file bind mount하며 `/dev/null` fallback을 허용하지 않음. image는 non-root `node`로 실행되므로 호스트 secret 디렉터리 `0700`으로 탐색을 제한하고 파일은 container가 읽을 수 있는 `0444`로 고정
- **Apple secret 계약**: base Compose가 `.p8`을 API와 회원 탈퇴 worker의 `/run/secrets/apple_signin.p8`에 항상 mount합니다. cache/push worker에는 mount하지 않으며 AES key는 환경별 `.env` secret으로 관리합니다.
- **Google 설정 계약**: 서버에는 API key나 client secret을 두지 않고 `GOOGLE_SERVER_CLIENT_ID`에 Web OAuth Client ID를 필수 설정하며 iOS/Android client ID는 Flutter 플랫폼 설정에 사용합니다.
- **Nginx 라우팅 계약**: 운영 proxy는 `shiftmate_center_api_cluster`, Stage proxy는 `shiftmate_stage_api_cluster`만 참조하며 배포 스크립트는 Center active upstream만 교체하고 Stage 고정 upstream은 변경하지 않음
- 공개 저장소는 애플리케이션 코드, 범용 migration, 테스트와 API 계약만 관리합니다.
- 환경별 Compose, workflow, 호스트 경로, runner, upstream, secret 위치와 실제 인프라 식별자는 별도 비공개 구성에서 관리합니다.
- DB migration은 자동 실행하지 않고 백업과 대상 확인 후 개발자가 수동 실행합니다.

### DB 변경

- `migrations/` SQL은 개발자가 대상 DB와 롤백 방법을 확인한 뒤 직접 1회 실행
- 실행 전 DB 백업 필수
- 실행 파일, 목적, 결과, 테스트, 롤백 명령을 `WORKLOG.md`에 기록
- API 서버 시작 명령에는 DB 변경 명령을 포함하지 않음

### Swagger/Postman

- **Swagger**: `API_DOCS_ENABLED=true`일 때 그룹·기기·Apple·Google·Kakao·가입 프로필 API `/api-docs`, `/api-docs/openapi.json` 노출. 기존 API 전체 문서는 아직 미포함
- **가입 프로필 서버 가이드**: `_docs/PROFILE_COMPLETION_GUIDE.md`
- **Apple 로그인 서버 가이드**: `_docs/APPLE_SIGN_IN_SERVER_GUIDE.md`
- **Google 로그인 서버 가이드**: `_docs/GOOGLE_SIGN_IN_SERVER_GUIDE.md`
  - **파일 역할**: Google Cloud OAuth client 발급, 서버 환경변수, DB migration, 단계 활성화, E2E·롤백 절차를 운영자와 Flutter 개발자에게 제공
  - **의존성**: `POST /api/v1/auth/google/token`, Google Web/iOS/Android OAuth client, `users.google_id` add-only migration
  - **사용 예**: Stage 활성화 전 OAuth client와 `GOOGLE_SERVER_CLIENT_ID`를 준비하고 migration·실기기 검증 순서를 확인할 때 사용
- **Flutter 그룹 연동 가이드**: `_docs/GROUP_FRONTEND_API_GUIDE.md`
- **근무 타입 색상 API 가이드**: `_docs/SHIFT_TYPE_COLOR_API_GUIDE.md`
  - **파일 역할**: Flutter 프론트팀에 `color`, `base_color`, `color_intensity` 요청/응답, 레거시 fallback, 오류 코드, 미리보기 계산 및 연동 체크리스트 제공
  - **의존성**: 서버의 `GET/POST/PUT /shift-types` 계약과 `shift_types` 색상 메타데이터 migration
  - **사용 예**: 근무 타입 API 모델·요청 모델·색상 선택 화면을 구현하거나 연동 테스트할 때 기준 문서로 사용
- **테스트 페이지**:
  - `http://localhost:3000/test/kakao-login.html` (카카오 로그인 테스트)
  - `http://localhost:3000/test/naver-login.html` (네이버 로그인 테스트)
- **기존 수동 배포 가이드**: `_docs/DEPLOYMENT_GUIDE.md` 참고
- **GitHub Blue/Green 자동 배포 가이드**: `_docs/CI_CD_DEPLOYMENT_GUIDE.md` 참고

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
- **`migrations/pgadmin_center_add_group_feature.sql`**
  - 역할: Stage에서 검증한 동일 그룹 DDL을 Center 전용 DB명·백업 파일명·확인 문자열·advisory lock으로 보호하고 strict postflight 뒤에만 commit하는 pgAdmin Query Tool 전용 SQL
  - 의존성: PostgreSQL 16 Center primary/write 연결, 고정 DB명 `shiftmate_center`, 별도 복원 검증을 마친 pgAdmin Custom/`pg_dump -Fc` 백업 파일
  - 사용 예: `SELECT current_database();` 결과가 `shiftmate_center`인지 확인하고 백업 파일명 placeholder만 변경한 뒤 부분 선택 없이 Execute(F5)
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

### 12. Apple·Google·Kakao 인증 모듈

- **`src/services/appleService.ts`**
  - 역할: Apple challenge, code 교환, JWKS/claim 검증, 외부 refresh token 암복호화
  - 의존성: PostgreSQL OAuth 보조 테이블, Node.js crypto, Apple 공개 endpoint
  - 사용 예: `authController`가 검증된 플랫폼과 credential을 전달
- **`src/services/googleService.ts`**
  - 역할: Google ID Token 검증과 공개 claim 정규화
  - 의존성: `google-auth-library`, 고정 server audience
  - 사용 예: `POST /api/v1/auth/google/token` 처리
- **`src/services/kakaoService.ts`**
  - 역할: Kakao Access Token의 App ID·회원번호 교차 검증과 사용자/템플릿/JWT 원자적 provisioning
  - 의존성: `KAKAO_APP_ID`, Kakao token info·user info API, PostgreSQL
  - 사용 예: `POST /api/v1/auth/kakao/token` 처리
- **`src/models/OAuthLoginChallenge.ts`, `src/models/OAuthAuthorization.ts`**
  - 역할: Apple 일회성 challenge hash와 암호화된 외부 authorization 저장
  - 의존성: `users`, Apple add-only migration
  - 사용 예: 로그인 transaction과 challenge atomic consume
- **`migrations/*apple_auth*`, `migrations/*google_auth*`**
  - 역할: 공개 가능한 범용 preflight/apply/postflight/제한적 rollback SQL
  - 의존성: PostgreSQL 16과 기존 `users`
  - 사용 예: 백업과 대상 확인 후 개발자가 수동 실행
- **`src/openapi/appleAuthOpenApi.json`, `src/openapi/googleAuthOpenApi.json`, `src/openapi/kakaoAuthOpenApi.json`**
  - 역할: 인증 endpoint와 공통 오류 응답 계약. Kakao 조각은 1차 배포 동안 deprecated Web 경로도 표시
  - 의존성: `src/openapi.ts`
- **`test/kakaoAuth.test.cjs`**
  - 역할: App ID·회원번호·upstream 오류·로그 비노출·OpenAPI·unlink secret 계약 단위/정적 회귀 검증
  - 의존성: TypeScript build 결과와 주입 가능한 Kakao HTTP/provider adapter
  - 사용 예: `npm test`
- **`test/kakaoAuthIntegration.test.cjs`, `test/fixtures/kakaoAuthIntegrationSchema.sql`**
  - 역할: Kakao 사용자 연결·동시 로그인·기본 템플릿·Refresh Token transaction과 rollback을 격리 PostgreSQL 16에서 검증
  - 의존성: `127.0.0.1:55432`의 고정 격리 DB와 명시적 schema reset 승인
  - 사용 예: `npm run debug:group-db:up && npm run test:kakao-integration`
- **`deploy/secrets/kakao_admin_key.example`**
  - 역할: Kakao Admin Key 파일의 한 줄 plain-text 형식을 보여주는 main 전용 placeholder
  - 의존성: 실제 credential을 차단하는 `.gitignore`; 운영 파일명은 확장자 없는 `kakao_admin_key`
  - 사용 예: 내용을 실제 Admin Key 원문으로 교체한 별도 파일을 환경별 홈서버 `secrets/`에 설치
  - 사용 예: `API_DOCS_ENABLED=true`인 개발 환경에서 확인
- **`test/appleAuth*.test.cjs`, `test/googleAuth*.test.cjs`**
  - 역할: crypto/claim/HTTP/transaction/migration 회귀 검증
  - 의존성: build된 `dist`, 통합 테스트는 격리 PostgreSQL
  - 사용 예: `npm test`, `npm run test:apple-integration`, `npm run test:google-integration`
- 실제 client ID, private key, 암호화 키와 환경별 인프라 식별값은 저장소에 기록하지 않고 `.env.example`에는 빈 값 또는 명시적 placeholder만 둡니다.

### 13. 회원 탈퇴 서버 설계

- **`_docs/ACCOUNT_DELETION_SERVER_DESIGN.md`**
  - 역할: 비동기 탈퇴 API, 최근 재인증, provider revoke/unlink, 그룹 OWNER 승계, FK 삭제 정책, PostgreSQL·Redis purge와 배포/테스트 계약의 정본
  - 의존성: 현재 인증 서비스, Apple OAuth authorization, 친구/그룹/알림/push/근무표 schema, Redis 월 cache
  - 사용 예: 별도 구현 작업에서 migration → model/service/worker → OpenAPI → 통합 테스트 순서의 승인 기준으로 사용
- 현재는 설계만 완료됐으며 `DELETE /api/v1/auth/account`, 삭제 worker와 DB 객체는 아직 존재하지 않습니다.

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

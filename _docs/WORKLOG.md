# 작업 일지

## 2026-07-08

### [DONE] 친구 요청 처리 완료 알림 actions 제거

- **목적**: 친구 요청 수락/거절 처리 후 반환되는 알림에 확인 버튼 액션을 포함하지 않도록 `actions`를 빈 배열로 변경
- **변경**:
  - 처리 완료된 원본 친구 요청 알림 갱신 시 `actions: []`를 저장하도록 변경
  - 친구 요청 거절 결과 알림 생성 시 `actions: []`를 저장하도록 변경
  - `NotificationAction` 타입 주석에서 더 이상 사용하지 않는 `dismiss` 예시 제거
  - 프로젝트 컨텍스트, 친구 API 가이드, ADR의 처리 완료 알림 계약을 `actions=[]`로 갱신
- **영향범위**:
  - 친구 요청 응답 API
  - 알림 목록 API
  - `actions` 배열 기반으로 버튼을 렌더링하는 프론트 알림 UI
- **파일**:
  - `src/services/friendService.ts`
  - `src/models/Notification.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/FRIEND_API_GUIDE.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - `rg -n "dismiss" src` 결과 없음
- **롤백**:
  - 이번 작업에서 수정한 코드/문서 변경을 이전 상태로 되돌리기
- **다음**:
  - 실제 수락/거절 API 호출 후 신규/갱신 알림의 `actions`가 `[]`로 내려오는지 확인

### [DONE] 친구 요청 알림 actions 반환값 DebugMCP 확인

- **목적**: DB에서 임의 수정한 `notifications.actions` 값과 달리 API 응답에서 `[{ type: "dismiss", label: "확인" }]`이 반환되는 이유를 DebugMCP 런타임 디버깅으로 확인
- **변경**:
  - DebugMCP 기존 중단점 정리 후 `getNotifications()` 반환 직전과 친구 요청 응답 갱신 지점에 중단점 설정
  - `GET /notifications` 요청이 `src/services/friendService.ts`의 `const notifications = rows.map(...)` 지점에 도달하는 것을 확인
  - 런타임 `rows` 값 확인 결과 `notification_id=c666e7eb-c234-4c02-8583-50d593b4310b`의 `actions`가 이미 `[{ type: "dismiss", label: "확인" }]`으로 조회됨
  - 런타임 DB 연결 정보가 `localhost:5432/shift_calendar`, `DB_USER=postgres`, `DB_SSL=false`임을 확인
  - `serializeNotification()` 결과도 `rows.actions`와 동일하게 `dismiss`를 반환하는 것을 확인
- **영향범위**:
  - 알림 목록 API
  - 친구 요청 응답 API
- **파일**:
  - `_docs/WORKLOG.md`
- **테스트**:
  - DebugMCP `start_debugging`으로 `Debug npm run dev` 세션 연결 성공
  - `getNotifications()` 런타임 변수 평가로 `rows[0].actions`와 직렬화 결과 확인
  - DebugMCP 중단점 정리 완료
- **롤백**:
  - 문서 작업 항목만 되돌리기
- **다음**:
  - DB 툴에서 수정한 대상 DB/스키마가 서버의 `.env` 연결 정보와 같은지 확인
  - 필요하면 해당 row를 같은 DB에서 다시 수정한 뒤 `GET /notifications` 재호출로 확인

### [DONE] 친구 요청 알림 처리 후 표시 상태 갱신

- **목적**: 알림 화면의 친구 요청 카드에서 수락/거절 버튼을 누른 뒤 같은 알림이 처리 완료 상태로 보이도록 백엔드 응답/알림 데이터를 갱신
- **변경**:
  - `respondToFriendRequest()`에서 친구 요청 상태 변경, 원본 알림 갱신, 요청자 결과 알림 생성을 하나의 트랜잭션으로 처리
  - 요청 수신자의 원본 `FRIEND_REQUEST` 알림을 수락 시 `FRIEND_REQUEST_ACCEPTED`, 거절 시 `FRIEND_REQUEST_REJECTED`로 갱신
  - 처리 완료 원본 알림의 `actions`를 `[{ type: "dismiss", label: "확인" }]`로 변경해 수락/거절 버튼이 다시 표시되지 않도록 계약 고정
  - `payload.request_status`, `payload.responded_at`을 추가해 프론트가 처리 결과를 명시적으로 확인 가능하게 함
  - 친구 요청 응답 API의 `data.notification`에 갱신된 원본 알림을 포함해 프론트가 재조회 없이 기존 카드를 교체할 수 있도록 함
  - `NotificationInfo` 직렬화 함수를 추가해 알림 조회 응답과 응답 API의 알림 객체 구조를 통일
  - 친구 API 가이드, 프로젝트 컨텍스트, ADR에 새 알림 타입/응답 계약 반영
- **영향범위**:
  - 친구 요청 응답 API
  - 알림 목록 API
  - 알림 화면에서 `actions` 또는 `notification_type` 기반으로 버튼을 표시하는 프론트 UI
- **파일**:
  - `src/services/friendService.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/FRIEND_API_GUIDE.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - 코드 확인: 원본 알림 조회는 `notifications.payload->>'request_id'`와 수신자 `user_id` 기준으로 수행
  - 코드 확인: `friend_requests.status` 변경, 원본 알림 갱신, 요청자 결과 알림 생성이 동일 트랜잭션 안에서 수행
- **롤백**:
  - 이번 작업에서 수정한 코드/문서 변경을 이전 상태로 되돌리기
- **다음**:
  - 실제 access token과 친구 요청 fixture로 수락/거절 후 알림 카드가 `확인` 상태로 교체되는지 Flutter 연동 확인

### [DONE] 개인 일정 생성 API 구현

- **목적**: Flutter 메인 캘린더의 일정 추가 모달에서 개인 일정을 생성할 수 있도록 `POST /api/v1/events` 계약 구현
- **변경**:
  - `POST /api/v1/events` 라우트 추가
  - 요청 validation 추가: `title` trim 후 필수, `all_day` boolean, `start_at`/`end_at` UTC `Z` ISO 문자열 및 `start_at < end_at`, `visibility_level` 0~5
  - 컨트롤러에서 validation/service 오류를 `INVALID_TITLE`, `INVALID_EVENT_TIME`, `INVALID_VISIBILITY_LEVEL`로 매핑
  - 서비스에서 인증 사용자 기준 `owner_user_id`, `created_by_user_id`를 설정해 `events` insert 후 `EventApiModel` 반환
  - 개인 캘린더 이벤트 조회 응답을 `EventApiModel` 공통 직렬화로 정리해 `created_at`, `updated_at` 포함
  - 인증 실패 응답에 `UNAUTHORIZED` error code 추가
  - `PROJECT_CONTEXT.md`에 개인 일정 생성 API 계약과 이벤트 응답 필드 반영
- **영향범위**:
  - 개인 일정 생성 API
  - 개인 캘린더 이벤트 조회 응답의 추가 필드(`created_at`, `updated_at`)
  - 인증 실패 응답 포맷에 `error.code=UNAUTHORIZED` 추가
- **파일**:
  - `src/routes/calendarRoutes.ts`
  - `src/controllers/calendarController.ts`
  - `src/services/calendarService.ts`
  - `src/middlewares/auth.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - 코드 확인: 생성 API는 JWT 인증 라우터 아래에서만 접근 가능
  - 코드 확인: `owner_user_id`, `created_by_user_id`는 요청 body가 아니라 인증 사용자 `user_id`로 설정
- **롤백**:
  - 이번 작업에서 수정한 라우트/컨트롤러/서비스/인증 미들웨어/문서 변경을 이전 상태로 되돌리기
- **다음**:
  - 실제 access token으로 정상 생성, title 공백, 시간 역전, visibility 범위 초과, 토큰 없음 케이스 API 호출 검증

## 2026-07-07

### [DONE] FE 캘린더 근무표 응답 계약 점검 및 보강

- **목적**: Flutter 캘린더가 서버 응답의 근무 타입 이름/색상/시간을 화면 표시 기준으로 사용하므로, 캘린더/근무표 API 응답 계약과 사용자별 조회 조건을 안정화
- **변경**:
  - `WorkShiftApiModel` 응답 직렬화를 `calendarService` 공통 함수로 정리
  - `GET /calendar/range`, `GET /work-shifts`, `POST /work-shifts`, `PUT /work-shifts/:work_shift_id`, `POST /work-shifts/batch`의 근무표 응답 필드를 동일하게 유지
  - 단건 생성/수정 응답 상세 조회에 `owner_user_id = current_user.user_id`와 `deleted_at = null` 조건 추가
  - 근무표 배치 응답 상세 조회에도 현재 사용자 소유 조건 추가
  - `shift_type_color` 응답을 `#AARRGGBB` 또는 `null`로 정규화
  - `start_time`, `end_time` 응답을 `HH:mm:ss` 또는 `null`로 정규화
  - `POST/PUT /shift-types`의 `color` 입력 validation을 `#AARRGGBB` 형식으로 고정
  - 개인/친구 캘린더 이벤트 기간 조회를 `start_at < end_date + 1 day` AND `end_at > start_date` overlap 조건으로 통일
  - `/api` 응답에 `Cache-Control: private, no-store`, `Vary: Authorization` 헤더 추가
  - API 계약을 프로젝트 컨텍스트/친구 API 가이드/ADR에 반영
- **영향범위**:
  - 캘린더/근무표 API 응답
  - 친구 캘린더 응답
  - 인증 API 캐시 헤더
- **파일**:
  - `src/services/calendarService.ts`
  - `src/controllers/calendarController.ts`
  - `src/routes/calendarRoutes.ts`
  - `src/services/friendService.ts`
  - `src/index.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/FRIEND_API_GUIDE.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - 코드 확인: 개인 캘린더/근무표 조회는 JWT 현재 사용자 `owner_user_id` 조건 사용
  - 코드 확인: 삭제는 `work_shift_id`와 현재 사용자 `owner_user_id` 조건으로 soft delete
- **롤백**:
  - 이번 작업에서 수정한 코드/문서 변경을 이전 상태로 되돌리기
- **다음**:
  - FE 연동 환경에서 계정 전환 색상 표시 확인
  - 실제 access token과 A/B 계정 fixture로 `/api/v1/calendar/range` 색상/시간 응답 확인

## 2026-07-06

### [DONE] 친구 캘린더 기간 조회 API 구현

- **목적**: 친구 목록에서 선택한 친구의 읽기 전용 캘린더 데이터를 `can_view`와 `friend_level` 기준으로 필터링해 반환
- **변경**:
  - `GET /api/v1/friends/:friend_user_id/calendar/range` 라우트 추가
  - `friend_user_id`, `start_date`, `end_date` 검증 추가
  - 친구 관계 확인 후 친구가 조회자에게 설정한 `friend_level_settings`의 `can_view`를 확인
  - `v_visible_work_shifts_for_friend`, `v_visible_events_for_friend` 뷰 기준으로 공개 조건을 통과한 근무표/개인 일정만 조회
  - 근무표 응답에 근무 타입 코드/이름/색상 및 시작/종료 시간을 포함
  - 에러 코드 `FRIEND_NOT_FOUND`, `CALENDAR_ACCESS_DENIED`, `INVALID_DATE_RANGE` 추가
  - 친구 API 가이드와 프로젝트 컨텍스트에 엔드포인트/공개 규칙 반영
- **영향범위**:
  - 친구 API 라우터/컨트롤러/서비스
  - 친구 API 문서 및 프로젝트 컨텍스트
- **파일**:
  - `src/routes/friendRoutes.ts`
  - `src/controllers/friendController.ts`
  - `src/services/friendService.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/FRIEND_API_GUIDE.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
- **롤백**:
  - 이번 작업에서 추가한 친구 캘린더 라우트/컨트롤러/서비스 함수와 문서 변경을 되돌리기
- **다음**:
  - 실제 access token과 친구/공개 설정 fixture로 정상 조회, `can_view=false`, 날짜 오류 케이스 API 호출 검증

## 2026-07-05

### [DONE] 전화번호 저장 형식 및 DB 제약 강화

- **목적**: 사용자 전화번호를 중복 불가로 유지하면서 `000-000-0000` 또는 `000-0000-0000` 형식으로만 저장/검색되도록 강제
- **변경**:
  - 신규 `src/utils/phone.ts`에서 전화번호 검증/정규화 공통화
  - 프로필 수정 요청에서 10~11자리 숫자 또는 하이픈 형식 전화번호만 허용하고 저장 전 하이픈 형식으로 정규화
  - 프로필 저장 전 동일 전화번호 사용자 존재 여부를 확인해 `PHONE_ALREADY_EXISTS`로 거절
  - `User` 모델에 전화번호 형식 validation 추가
  - 친구 검색에서 전화번호 검색어를 저장 형식으로 정규화한 뒤 `users.phone` 조회
  - `users.phone` DB CHECK 제약을 `final_schema.sql`, `add_phone_and_notifications.sql`, `enforce_users_phone_format.sql`에 반영
  - 전화번호 저장 정책 ADR 추가
- **파일**:
  - `src/utils/phone.ts`
  - `src/routes/authRoutes.ts`
  - `src/controllers/authController.ts`
  - `src/models/User.ts`
  - `src/services/friendService.ts`
  - `migrations/final_schema.sql`
  - `migrations/add_phone_and_notifications.sql`
  - `migrations/enforce_users_phone_format.sql`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/FRIEND_API_GUIDE.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - `dist/utils/phone.normalizePhoneNumber()` 수동 확인:
    - `0101234567` → `010-123-4567`
    - `01012345678` → `010-1234-5678`
    - `010-123-4567` → `010-123-4567`
    - `010-1234-5678` → `010-1234-5678`
    - `+821012345678` → `null`
    - `010-12-3456` → `null`
    - `010-12-345678` → `null`
- **롤백**:
  - 코드 롤백: 이번 작업에서 수정/추가한 파일을 이전 상태로 되돌리기
  - DB 롤백: `ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_phone_format;`
- **다음**:
  - 기존 DB에 `migrations/enforce_users_phone_format.sql` 적용 전 invalid phone 조회 쿼리 실행

### [DONE] 사용자 검색 이메일/전화번호 형식 분기 강화

- **목적**: `GET /api/v1/users/search?query=...`에서 이메일 형식은 `users.email`, 전화번호 형식은 `users.phone`으로만 검색하고 그 외 입력은 거절
- **변경**:
  - `friendService.getUserSearchField()` 추가로 검색어 타입을 `email`/`phone`/invalid로 명시 판정
  - 이메일 형식은 `users.email`, 전화번호 형식은 `users.phone` 조건으로 `User.findOne()` 조회
  - 이메일/전화번호 형식이 아니면 컨트롤러와 서비스에서 `INVALID_QUERY`로 거절
  - 친구 API 문서와 프로젝트 컨텍스트에 사용자 검색 입력 규칙 반영
- **파일**:
  - `src/controllers/friendController.ts`
  - `src/services/friendService.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/FRIEND_API_GUIDE.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
- **롤백**:
  - 이번 작업에서 수정한 파일을 이전 상태로 되돌리기
- **다음**:
  - 실제 access token으로 이메일/전화번호/invalid query 케이스 API 호출 검증

### [DONE] TypeScript moduleResolution deprecation 대응

- **목적**: IDE에서 표시되는 `moduleResolution=node10` deprecation 진단을 현재 빌드와 호환되는 방식으로 해소
- **변경**:
  - `tsconfig.json`의 `moduleResolution`을 deprecated alias인 `node`에서 `node16`으로 변경
  - TypeScript 요구사항에 맞춰 `module`을 `commonjs`에서 `Node16`으로 변경
  - `ignoreDeprecations: "6.0"`은 현재 로컬 TypeScript `5.9.3`에서 유효하지 않아 적용하지 않음
- **파일**:
  - `tsconfig.json`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `node -p "require('typescript').version"` 결과 `5.9.3`
  - `npm run build` 성공
  - `dist/index.js`가 기존과 같은 CommonJS 출력(`require`, `exports`) 형태임을 확인
- **롤백**:
  - `tsconfig.json`의 `module`을 `commonjs`, `moduleResolution`을 `node`로 되돌리기
- **다음**:
  - TypeScript 6.x 이상으로 업그레이드할 때 `ignoreDeprecations` 임시 설정이 필요한지 재검토

### [DONE] auth 카카오/프로필 디버깅 중단점 설정 및 정적 분석

- **목적**: `/api/v1/auth/kakao`, `/api/v1/auth/kakao/token`, `/api/v1/auth/profile` 흐름을 DebugMCP 중단점과 코드 기반 정적 분석으로 확인
- **변경**:
  - DebugMCP에서 VS Code launch 구성 `Debug npm run dev`로 디버그 세션 시작
  - 인증/프로필/카카오 OAuth 흐름 주요 경계에 중단점 9개 설정
  - `/auth/profile` 요청이 `src/middlewares/auth.ts`의 JWT 인증 미들웨어 중단점에 도달하는 것 확인
  - 정적 분석으로 라우트, 컨트롤러, 카카오 서비스, JWT 토큰 발급 흐름 확인
- **파일**:
  - `src/routes/authRoutes.ts`
  - `src/controllers/authController.ts`
  - `src/services/kakaoService.ts`
  - `src/middlewares/auth.ts`
  - `src/services/authService.ts`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - DebugMCP `start_debugging` 성공: `Debug npm run dev` 구성 사용, `authMiddleware` 21라인에서 중단 확인
  - `POST /api/v1/auth/kakao/token` 런타임 확인:
    - 카카오 사용자 정보 API 응답 200 확인
    - `kakao_account.email` 추출 성공
    - `kakao_id` 기준 기존 사용자 없음
    - 이메일 기준 기존 사용자 없음
    - 신규 `users` 생성 성공
    - `ensureDefaultTemplate(user.user_id)` 성공
    - `.env`의 `JWT_SECRET`, `JWT_REFRESH_SECRET` 사용 확인
    - `refresh_tokens` 저장 성공
    - `res.json({ success: true, ... })` 응답 전송 지점까지 예외 없이 도달
- **롤백**:
  - DebugMCP 중단점은 `clear_all_breakpoints`로 제거
  - `_docs/WORKLOG.md`의 이번 작업 항목 되돌리기
- **다음**:
  - 발급된 access token으로 `GET /api/v1/auth/profile`을 호출해 `authMiddleware`의 JWT 검증 및 `getProfile` 응답 확인
  - 필요 시 authorization code 방식 `POST /api/v1/auth/kakao`도 별도 재현

### [DONE] 헬스 체크 공개 라우트 순서 수정

- **목적**: `GET /api/v1/health`가 인증 토큰 없이 서버 상태를 확인할 수 있도록 라우터 등록 순서 수정
- **변경**:
  - `src/routes/index.ts`에서 health 라우트를 인증 미들웨어가 적용된 `calendarRoutes`, `friendRoutes`, `scheduleRoutes`보다 먼저 등록
  - 기존 인증 필요 API의 인증 정책은 유지
- **파일**:
  - `src/routes/index.ts`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - `curl -i http://localhost:3000/api/v1/health` 결과 `HTTP/1.1 200 OK` 확인
- **롤백**:
  - `src/routes/index.ts`의 health 라우트 위치를 이전 순서로 되돌리기
- **다음**:
  - Flutter/외부 클라이언트에서 동일 URL로 헬스 체크 확인

### [DONE] 최종 DB DDL 실행 파일화

- **목적**: `AGENTS.md`에 문서화된 shift_calendar 최종 PostgreSQL DDL을 로컬 Docker PostgreSQL에서 바로 실행 가능한 SQL 파일로 정리
- **변경**:
  - 신규: `migrations/final_schema.sql`
    - `AGENTS.md`의 FINAL SCHEMA를 실행 가능한 PostgreSQL SQL 파일로 정리
    - 문서용으로 깨져 있던 주석 표기와 마지막 불필요한 `$$`를 제거
    - `\set ON_ERROR_STOP on` 추가로 DDL 실패 시 즉시 중단
  - 수정: `_docs/PROJECT_CONTEXT.md`
    - Docker PostgreSQL 초기화 절차 추가
    - `migrations/final_schema.sql` 파일 역할/의존성/사용 예 추가
    - 로컬 `.env` 예시를 Docker DB 기준으로 갱신
- **파일**:
  - `migrations/final_schema.sql`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `docker exec -i shift-calendar-postgres psql -U postgres -d shift_calendar < migrations/final_schema.sql` 성공
  - 생성 객체 확인: `users`, `events`, `work_shifts` 등 12개 테이블 + `v_visible_events_for_friend`, `v_visible_work_shifts_for_friend` 2개 뷰
  - `npm run build` 성공
- **롤백**:
  - 파일 변경 롤백: `migrations/final_schema.sql`, `_docs/PROJECT_CONTEXT.md`, `_docs/WORKLOG.md` 되돌리기
  - DB 롤백: 로컬 Docker DB를 다시 초기화하거나 `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;` 후 필요한 이전 스키마 재적용
- **다음**:
  - `.env`가 Docker DB(`DB_HOST=localhost`, `DB_PASSWORD=postgres`, `DB_SSL=false`)를 바라보는지 확인 후 `npm run dev` 실행

## 2026-01-11

### [DONE] 프로필 수정 API 구현 (POST 방식)

- **목적**: 사용자 프로필 수정 API를 POST 방식으로 구현. GET/POST 중심의 API 설계로 전환
- **변경**:
  - `src/controllers/authController.ts`: `updateProfile()` 함수 추가
    - 선택적 필드만 수정 가능 (name, timezone, profile_image_url, phone)
    - JWT 토큰으로 사용자 식별 (Body에 user_id 불필요)
  - `src/routes/authRoutes.ts`: `POST /api/v1/auth/profile` 라우트 추가
    - 인증 미들웨어 적용
    - express-validator로 선택적 필드 validation
  - `_docs/PROJECT_CONTEXT.md`: API 스펙 업데이트
- **파일**:
  - `src/controllers/authController.ts`
  - `src/routes/authRoutes.ts`
  - `_docs/PROJECT_CONTEXT.md`
- **API 엔드포인트**:
  - `POST /api/v1/auth/profile` - 내 정보 수정 (인증 필요)
- **요청 형식**:
  ```json
  {
    "name": "새 이름",           // 선택적
    "timezone": "Asia/Seoul",    // 선택적
    "profile_image_url": "...",  // 선택적
    "phone": "+821012345678"     // 선택적
  }
  ```
- **응답 형식**:
  ```json
  {
    "success": true,
    "message": "프로필이 수정되었습니다.",
    "data": {
      "user_id": "...",
      "email": "...",
      "name": "...",
      ...
    }
  }
  ```
- **테스트**: 린터 에러 없음 확인
- **롤백**: 변경된 파일들을 이전 커밋으로 되돌리기
- **다음**: 실제 API 테스트 및 클라이언트 연동

## 2026-01-11

### [DONE] 배포 가이드 및 스크립트 작성

- **목적**: 서버 배포 시 필요한 절차 및 인증 토큰 오류 해결 가이드 제공
- **변경**:
  - 신규: `_docs/DEPLOYMENT_GUIDE.md` - 서버 배포 가이드 문서
  - 신규: `deploy.sh` - 자동 배포 스크립트
- **파일**:
  - `_docs/DEPLOYMENT_GUIDE.md`
  - `deploy.sh`
- **내용**:
  - 배포 전 체크리스트 (환경변수 확인)
  - 배포 절차 (git pull, npm install, build, migrate, restart)
  - 인증 토큰 오류 해결 방법
  - PM2 프로세스 관리
  - 트러블슈팅 가이드
- **테스트**: 배포 스크립트 실행 권한 부여 완료
- **다음**: 실제 배포 환경에서 테스트

### [DONE] OAuth API 가이드 문서 작성

- **목적**: 네이버/카카오 OAuth 로그인 API 사용 가이드 제공
- **변경**:
  - 신규: `_docs/OAUTH_API_GUIDE.md` - OAuth 소셜 로그인 API 가이드 문서
- **파일**:
  - `_docs/OAUTH_API_GUIDE.md`
- **내용**:
  - 네이버 OAuth 로그인 API (WebView/SDK 방식)
  - 카카오 OAuth 로그인 API (WebView/SDK 방식)
  - 요청/응답 형식, 에러 코드, 사용 예시
  - 테스트 페이지 사용 방법
  - 환경변수 설정, 주의사항, FAQ
- **테스트**: 문서 검토 완료
- **다음**: 실제 API 테스트 및 피드백 반영

### [DONE] 네이버 OAuth 2.0 소셜 로그인 추가

- **목적**: 네이버 계정을 통한 소셜 로그인 지원
- **변경**:
  - DB: users 테이블에 naver_id 컬럼 추가 (마이그레이션)
  - 신규: `src/services/naverService.ts` - 네이버 OAuth 처리 (토큰 교환 + 사용자 정보 조회)
  - 수정: `src/controllers/authController.ts` - naverLogin, naverLoginWithToken 함수 추가
  - 수정: `src/routes/authRoutes.ts` - 네이버 OAuth 라우트 추가
  - 수정: `src/models/User.ts` - naver_id 필드 추가
  - 문서: `_docs/PROJECT_CONTEXT.md`, `_docs/WORKLOG.md` 업데이트
- **파일**:
  - `migrations/add_naver_id_to_users.sql`
  - `src/services/naverService.ts`
  - `src/controllers/authController.ts`
  - `src/routes/authRoutes.ts`
  - `src/models/User.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/WORKLOG.md`
- **API 엔드포인트**:
  - `POST /api/v1/auth/naver` - 네이버 OAuth 로그인 (WebView 방식 - authorization code)
  - `POST /api/v1/auth/naver/token` - 네이버 OAuth 로그인 (SDK 방식 - access_token 직접 전송)
- **환경변수**:
  - `NAVER_CLIENT_ID`: 네이버 OAuth Client ID
  - `NAVER_CLIENT_SECRET`: 네이버 OAuth Client Secret
- **테스트**: Postman 또는 테스트 HTML 페이지로 두 가지 방식 모두 검증 필요
- **롤백**: 마이그레이션 롤백 SQL (`ALTER TABLE users DROP COLUMN naver_id;`) + 코드 되돌리기
- **다음**: 테스트 페이지 작성 (선택), 실제 네이버 개발자 센터 설정 확인

## 2026-01-04

### [DONE] 친구 관리 API 구현

- **목적**: 친구 관리 기능의 백엔드 API 구현 (친구 목록, 친구 요청, 알림 등)
- **변경**:
  - `migrations/add_phone_and_notifications.sql`: DDL 마이그레이션 파일 추가
    - users 테이블에 phone 컬럼 추가
    - notifications 테이블 생성 (동적 액션 지원, notification_type 제약 없음)
  - `src/models/User.ts`: phone 필드 추가
  - `src/models/FriendRequest.ts`: 친구 요청 모델 생성
  - `src/models/Friendship.ts`: 친구 관계 모델 생성
  - `src/models/FriendLevelSetting.ts`: 친구 레벨 설정 모델 생성
  - `src/models/Notification.ts`: 알림 모델 생성 (동적 액션 지원, 타입 확장 가능)
  - `src/models/index.ts`: 새 모델 export 추가
  - `src/services/friendService.ts`: 친구 관련 비즈니스 로직
    - getFriends(): 친구 목록 조회
    - searchUser(): 사용자 검색 (이메일/전화번호)
    - sendFriendRequest(): 친구 요청 보내기
    - getReceivedRequests(): 받은 요청 목록
    - getSentRequests(): 보낸 요청 목록
    - respondToFriendRequest(): 요청 수락/거절
    - cancelFriendRequest(): 요청 취소
    - updateFriendSettings(): 친구 레벨 설정 변경
    - deleteFriend(): 친구 삭제
    - getNotifications(): 알림 목록 조회 (조회 시 자동 읽음 처리)
    - getUnreadNotificationCount(): 미읽음 알림 개수 조회 (읽음 처리 없음)
  - `src/controllers/friendController.ts`: 친구 관련 컨트롤러
  - `src/routes/friendRoutes.ts`: 친구 관련 라우트
  - `src/routes/index.ts`: friendRoutes 등록
  - `AGENTS.md`: notifications 테이블 스키마 추가
  - `_docs/FRIEND_API_GUIDE.md`: API 가이드 문서 생성
- **파일**:
  - `migrations/add_phone_and_notifications.sql`
  - `src/models/User.ts`
  - `src/models/FriendRequest.ts`
  - `src/models/Friendship.ts`
  - `src/models/FriendLevelSetting.ts`
  - `src/models/Notification.ts`
  - `src/models/index.ts`
  - `src/services/friendService.ts`
  - `src/controllers/friendController.ts`
  - `src/routes/friendRoutes.ts`
  - `src/routes/index.ts`
  - `AGENTS.md`
  - `_docs/FRIEND_API_GUIDE.md`
- **API 엔드포인트**:
  - `GET /api/v1/friends` - 친구 목록 조회
  - `PUT /api/v1/friends/:friend_user_id/settings` - 친구 레벨 설정 변경
  - `DELETE /api/v1/friends/:friend_user_id` - 친구 삭제
  - `GET /api/v1/users/search` - 사용자 검색
  - `POST /api/v1/friend-requests` - 친구 요청 보내기
  - `GET /api/v1/friend-requests/received` - 받은 요청 목록
  - `GET /api/v1/friend-requests/sent` - 보낸 요청 목록
  - `PUT /api/v1/friend-requests/:request_id/respond` - 요청 응답
  - `PUT /api/v1/friend-requests/:request_id/cancel` - 요청 취소
  - `GET /api/v1/notifications` - 알림 목록 조회 (자동 읽음 처리)
  - `GET /api/v1/notifications/unread-count` - 미읽음 알림 개수 조회
- **테스트**:
  - 린터 에러 없음 확인
  - DB 마이그레이션 필요: `migrations/add_phone_and_notifications.sql` 실행
- **롤백**:
  - 변경된 파일들을 이전 커밋으로 되돌리기
  - DB 롤백: notifications 테이블 삭제, users.phone 컬럼 삭제
- **다음**:
  - DB 마이그레이션 실행
  - 실제 API 테스트
  - 푸시 알림 연동 (추후)

---

### [DONE] 일정 삭제 API 구현

- **목적**: 일정(Event)을 삭제할 수 있는 API 엔드포인트 추가. 일정의 UUID를 전달받아 하나씩 삭제 가능하도록 구현
- **변경**:
  - `src/services/calendarService.ts`:
    - `deleteEvent(user_id, event_id)` 함수 추가
    - Soft delete 방식으로 `deleted_at`, `deleted_by_user_id` 설정
    - 본인 일정만 삭제 가능하도록 `owner_user_id` 검증
    - 이미 삭제된 일정(`deleted_at IS NOT NULL`)은 삭제 불가
  - `src/controllers/calendarController.ts`:
    - `deleteEvent(req, res)` 컨트롤러 함수 추가
    - `EVENT_NOT_FOUND` 에러 처리 (404 응답)
    - 성공 시 삭제된 `event_id` 반환
  - `src/routes/calendarRoutes.ts`:
    - `DELETE /api/v1/events/:event_id` 라우트 추가
    - 인증 미들웨어 자동 적용 (모든 라우트에 적용됨)
- **파일**:
  - `src/services/calendarService.ts`
  - `src/controllers/calendarController.ts`
  - `src/routes/calendarRoutes.ts`
- **테스트**:
  - 린터 에러 없음 확인
  - 실제 API 테스트는 클라이언트 구현 후 진행 예정
- **롤백**:
  - 변경된 파일들을 이전 커밋으로 되돌리기
- **다음**:
  - 실제 API 테스트로 동작 확인
  - 일정 생성/수정 API 구현 검토

---

## 2026-01-04

### [DONE] shift_type 생성 시 시간 정보 없어도 스케줄 생성하도록 수정

- **목적**: 시간 정보 없이 shift_type을 생성해도 work_shift 생성 시 `SCHEDULE_NOT_FOUND` 에러가 발생하지 않도록 수정
- **변경**:
  - `src/services/shiftTemplateService.ts`:
    - `createShiftType()` 함수에서 시간 정보가 없어도 기본 스케줄(`ShiftTypeSchedule`)을 생성하도록 수정
    - 시간 정보가 없으면 `start_time: null`, `end_time: null`, `crosses_midnight: false`, `duration_minutes: 0`으로 스케줄 생성
    - work_shift 생성 시 `schedule_id`가 필수이므로 항상 스케줄을 생성해야 함
  - `src/services/calendarService.ts`:
    - `batchUpsertWorkShifts()` 함수에서 스케줄이 없을 때 자동으로 기본 스케줄을 생성하도록 수정 (기존에 생성된 shift_type 대응)
    - `upsertWorkShift()` 함수에서도 동일하게 수정
    - `updateWorkShift()` 함수에서도 동일하게 수정
    - 이미 생성된 shift_type에 스케줄이 없어도 work_shift 생성/수정이 가능하도록 보완
- **파일**:
  - `src/services/shiftTemplateService.ts`
  - `src/services/calendarService.ts`
- **테스트**:
  - 린터 에러 없음 확인
  - 시간 정보 없이 shift_type 생성 후 work_shift 생성 테스트 필요
  - 기존에 생성된 shift_type으로 work_shift 생성 테스트 필요
- **롤백**:
  - 변경된 파일을 이전 커밋으로 되돌리기
- **다음**:
  - 실제 API 테스트로 동작 확인
  - 시간 정보 없이 생성한 shift_type으로 work_shift 생성 테스트

---

### [DONE] 근무 템플릿당 최대 10개 shift_type 제한 검증 로직 추가

- **목적**: 한 템플릿에 최대 10개까지의 근무 타입만 추가할 수 있도록 서버 측 검증 로직 추가
- **변경**:
  - `src/services/shiftTemplateService.ts`:
    - `MAX_SHIFT_TYPES_PER_TEMPLATE = 10` 상수 추가
    - `createShiftType()` 함수에서 shift_type 생성 전에 현재 템플릿의 shift_types 개수 확인
    - 10개 이상이면 `MAX_SHIFT_TYPES_EXCEEDED` 에러 발생
  - `src/controllers/calendarController.ts`:
    - `createShiftType()` 컨트롤러에서 `MAX_SHIFT_TYPES_EXCEEDED` 에러 처리 추가 (400 응답)
- **파일**:
  - `src/services/shiftTemplateService.ts`
  - `src/controllers/calendarController.ts`
- **테스트**:
  - 린터 에러 없음 확인
  - 실제 API 테스트는 클라이언트 구현 후 진행 예정
- **롤백**:
  - 변경된 파일들을 이전 커밋으로 되돌리기
- **다음**:
  - 클라이언트에서 10개 제한 시 UI 처리 (버튼 비활성화 등)
  - API 통합 테스트

---

## 2026-01-04

### [DONE] shift_types 코드 중복 제한 제거

- **목적**: 같은 템플릿 내에서 동일한 code를 가진 근무 타입을 여러 개 생성할 수 있도록 허용
- **변경**:
  - `src/services/shiftTemplateService.ts`: 코드 중복 체크 로직 제거
  - `src/models/ShiftType.ts`: Sequelize 모델의 unique 인덱스 제거 (`template_id`, `code` 조합)
  - `src/controllers/calendarController.ts`: `DUPLICATE_CODE` 에러 처리 제거
  - `migrations/remove_shift_types_unique_constraint.sql`: DB unique constraint 제거 마이그레이션 SQL 추가
- **파일**:
  - `src/services/shiftTemplateService.ts`
  - `src/models/ShiftType.ts`
  - `src/controllers/calendarController.ts`
  - `migrations/remove_shift_types_unique_constraint.sql`
- **테스트**:
  - 린터 에러 없음 확인
  - DB 마이그레이션 필요: `migrations/remove_shift_types_unique_constraint.sql` 실행 필요
- **롤백**:
  - 코드 변경 사항 되돌리기
  - DB에 unique constraint 재생성: `ALTER TABLE shift_types ADD CONSTRAINT uq_shift_types_code UNIQUE (template_id, code);`
- **다음**:
  - DB 마이그레이션 실행
  - 동일한 code로 여러 근무 타입 생성 테스트

---

## 2025-01-XX (최근 작업)

### [DONE] 개인별 근무 세팅 페이지 API 구현

- **목적**: 사용자가 자신의 근무 템플릿과 근무 타입을 관리할 수 있는 설정 페이지를 위한 서버 API 구현
- **변경**:
  - `src/services/shiftTemplateService.ts`: 새로운 서비스 함수 추가
    - `getCurrentTemplate()`: 현재 사용자의 활성 템플릿 조회
    - `updateTemplateName()`: 템플릿 이름 변경
    - `createShiftType()`: 근무 타입 추가 (시간 계산 로직 포함)
    - `updateShiftType()`: 근무 타입 수정 (시간 스케줄 업데이트)
    - `deleteShiftType()`: 근무 타입 삭제 (Soft Delete, 사용 중 체크)
    - `calculateTimeInfo()`: 시간 계산 유틸리티 (crosses_midnight, duration_minutes)
    - `getCurrentVersion()`: 현재 활성 버전 조회 헬퍼 함수
  - `src/controllers/calendarController.ts`: 새로운 컨트롤러 함수 추가
    - `getCurrentTemplate()`: GET `/api/v1/shift-templates/current`
    - `updateCurrentTemplate()`: PUT `/api/v1/shift-templates/current`
    - `createShiftType()`: POST `/api/v1/shift-types`
    - `updateShiftType()`: PUT `/api/v1/shift-types/:shift_type_id`
    - `deleteShiftType()`: DELETE `/api/v1/shift-types/:shift_type_id`
  - `src/routes/calendarRoutes.ts`: 새로운 라우트 등록
    - 템플릿 조회/수정 라우트
    - 근무 타입 CRUD 라우트
    - Validation 미들웨어 적용
- **파일**:
  - `src/services/shiftTemplateService.ts`
  - `src/controllers/calendarController.ts`
  - `src/routes/calendarRoutes.ts`
- **테스트**:
  - 린터 에러 수정 완료
  - 타입 에러 수정 완료
  - 실제 API 테스트는 클라이언트 구현 후 진행 예정
- **롤백**:
  - 변경된 파일들을 이전 커밋으로 되돌리기
  - 또는 각 함수를 주석 처리
- **다음**:
  - 클라이언트 구현 (Flutter)
  - API 통합 테스트
  - 에러 케이스 추가 테스트

---

## 2025-01-XX (최근 작업)

### [DONE] Express 백엔드 문서화

- **목적**: 프로젝트 구조와 아키텍처를 문서화하여 유지보수성 향상
- **변경**:
  - `_docs/PROJECT_CONTEXT.md`: Express 백엔드 상세 문서 작성
    - 요청 처리 흐름
    - 에러 처리 규칙
    - Validation 규칙
    - 인증/인가
    - DB 접근 규칙
    - API 스펙
    - 로깅/모니터링
    - 환경변수 표
  - `_docs/DECISIONS.md`: 아키텍처 결정 기록 (ADR) 작성
    - ADR-0001: Express + Sequelize + PostgreSQL 스택 선택
    - ADR-0002: JWT 기반 인증 + Refresh Token Rotation
    - ADR-0003: express-validator를 사용한 요청 검증
    - ADR-0004: Controller-Service-Model 계층 구조
    - ADR-0005: Sequelize 트랜잭션 사용
    - ADR-0006: Refresh Token을 DB에 해시값으로 저장
    - ADR-0007: 카카오 OAuth 2가지 방식 지원
    - ADR-0008: 근무 템플릿 버전 관리 시스템
    - ADR-0009: Global Error Handler 사용
    - ADR-0010: Soft Delete 사용
  - `_docs/WORKLOG.md`: 작업 일지 템플릿 작성
- **파일**:
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**: 문서 내용 검증 (코드베이스와 일치 확인)
- **롤백**: 문서 삭제 또는 이전 버전으로 복원
- **다음**:
  - Swagger/OpenAPI 문서화 추가
  - 단위 테스트 작성
  - 에러 로깅 중앙화 (Winston 등)

---

## 작업 템플릿

### [TODO] 작업 제목

- **목적**: 왜 이 작업을 하는지
- **변경**: 무엇을 변경했는지
- **파일**: 변경된 파일 목록
- **테스트**: 무엇을 테스트했는지
- **롤백**: 어떻게 되돌릴지
- **다음**: 다음 단계 작업

### [IN_PROGRESS] 작업 제목

- **목적**: ...
- **변경**: ...
- **파일**: ...
- **테스트**: ...
- **롤백**: ...
- **다음**: ...

### [DONE] 작업 제목

- **목적**: ...
- **변경**: ...
- **파일**: ...
- **테스트**: ...
- **롤백**: ...
- **다음**: ...

---

## 작업 규칙

1. **작업 시작 시**: `[TODO]` 상태로 항목 생성
2. **작업 중**: `[IN_PROGRESS]` 상태로 변경
3. **작업 완료**: `[DONE]` 상태로 변경 및 결과 기록
4. **날짜별 섹션**: 최근 작업이 위에 오도록 정렬
5. **상세 기록**: 목적, 변경, 파일, 테스트, 롤백, 다음 단계 모두 기록

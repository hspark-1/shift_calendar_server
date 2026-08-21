# 아키텍처 결정 기록 (ADR)

## ADR-0001: Express + Sequelize + PostgreSQL 스택 선택

### 배경(문제)

백엔드 API 서버를 구축하기 위해 프레임워크와 ORM, 데이터베이스를 선택해야 했습니다.

### 선택지(대안)

1. **Express + Sequelize + PostgreSQL**
2. Express + TypeORM + PostgreSQL
3. Express + Prisma + PostgreSQL
4. NestJS + TypeORM + PostgreSQL
5. Fastify + Sequelize + PostgreSQL

### 결정(무엇을 선택)

**Express + Sequelize + PostgreSQL**을 선택했습니다.

### 근거(왜)

- **Express**: Node.js 생태계에서 가장 널리 사용되고, 학습 곡선이 낮음
- **Sequelize**: TypeScript 지원이 안정적이고, 마이그레이션 도구(sequelize-cli)가 잘 갖춰져 있음
- **PostgreSQL**: 관계형 데이터베이스로 복잡한 쿼리와 뷰 지원이 필요했음
- 기존 팀의 경험과 프로젝트 요구사항에 가장 적합

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 빠른 프로토타이핑 가능
- 풍부한 문서와 커뮤니티 지원
- Sequelize의 include로 N+1 문제 해결 용이

**트레이드오프**:

- Prisma 대비 타입 안정성이 약간 낮을 수 있음
- NestJS 대비 구조화된 아키텍처가 부족할 수 있음

### 추후 과제(언제 다시 평가)

- 프로젝트 규모가 커지면 NestJS로 마이그레이션 검토
- Prisma로 전환하여 타입 안정성 향상 검토

---

## ADR-0002: JWT 기반 인증 + Refresh Token Rotation

### 배경(문제)

사용자 인증 및 세션 관리를 위한 방식을 결정해야 했습니다.

### 선택지(대안)

1. **JWT (Access Token) + Refresh Token (DB 저장, Rotation)**
2. JWT만 사용 (Refresh Token 없음)
3. 세션 기반 인증 (Redis)
4. OAuth만 사용 (서버 세션 없음)

### 결정(무엇을 선택)

**JWT Access Token (7일) + Refresh Token (30일, DB 저장, Token Rotation)**을 선택했습니다.

### 근거(왜)

- **Stateless**: 서버 확장성 확보
- **Refresh Token Rotation**: 토큰 탈취 시 보안 강화 (기존 토큰 무효화)
- **DB 저장**: Refresh Token을 DB에 해시값으로 저장하여 무효화 가능
- **OAuth 지원**: 카카오 OAuth와 병행 사용

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 서버 확장성 (Stateless)
- 보안 강화 (Token Rotation)
- OAuth와 통합 용이

**트레이드오프**:

- Access Token 탈취 시 만료 전까지 무효화 불가 (7일)
- DB 조회 필요 (Refresh Token 검증 시)

### 구현 위치

- **인증 미들웨어**: `src/middlewares/auth.ts`
- **토큰 생성/검증**: `src/services/authService.ts`
- **Refresh Token 모델**: `src/models/RefreshToken.ts`

### 추후 과제(언제 다시 평가)

- Access Token 만료 시간 단축 검토 (7일 → 1일)
- Redis 도입하여 Refresh Token 관리 최적화 검토

---

## ADR-0003: express-validator를 사용한 요청 검증

### 배경(문제)

요청 데이터 검증을 위한 라이브러리를 선택해야 했습니다.

### 선택지(대안)

1. **express-validator**
2. Joi
3. class-validator (NestJS 스타일)
4. Zod
5. 수동 검증

### 결정(무엇을 선택)

**express-validator**를 선택했습니다.

### 근거(왜)

- Express 생태계와 자연스럽게 통합
- 미들웨어 방식으로 라우트에 직접 적용 가능
- 체이닝 방식으로 가독성 좋음
- 커스텀 검증 규칙 추가 용이

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- Express와 통합 용이
- 라우트 정의와 검증 규칙을 한 곳에 작성 가능

**트레이드오프**:

- Zod/class-validator 대비 타입 안정성이 낮을 수 있음
- 스키마 재사용이 어려울 수 있음

### 구현 위치

- **라우트 정의**: `src/routes/*.ts`에서 미들웨어로 적용
- **검증 결과 확인**: `src/controllers/*.ts`에서 `validationResult(req)` 사용

### 추후 과제(언제 다시 평가)

- Zod로 전환하여 타입 안정성 향상 검토
- 공통 검증 규칙을 별도 파일로 분리

---

## ADR-0004: Controller-Service-Model 계층 구조

### 배경(문제)

비즈니스 로직과 요청 처리 로직을 어떻게 분리할지 결정해야 했습니다.

### 선택지(대안)

1. **Controller-Service-Model (3계층)**
2. Controller-Model (2계층, Service 없음)
3. Repository 패턴 추가 (4계층)
4. Domain-Driven Design (DDD)

### 결정(무엇을 선택)

**Controller-Service-Model (3계층)** 구조를 선택했습니다.

### 근거(왜)

- **Controller**: HTTP 요청/응답 처리, Validation 결과 확인
- **Service**: 비즈니스 로직, 트랜잭션 관리
- **Model**: Sequelize 모델, DB 접근
- 단순하고 명확한 책임 분리
- 프로젝트 규모에 적합

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 명확한 책임 분리
- 테스트 용이성 (Service 단위 테스트 가능)
- 재사용성 (Service를 여러 Controller에서 사용 가능)

**트레이드오프**:

- Repository 패턴이 없어 Model과 Service가 직접 결합
- DDD 대비 도메인 모델이 약함

### 구현 위치

- **Controller**: `src/controllers/*.ts`
- **Service**: `src/services/*.ts`
- **Model**: `src/models/*.ts`

### 추후 과제(언제 다시 평가)

- 프로젝트 규모가 커지면 Repository 패턴 도입 검토
- 도메인 로직이 복잡해지면 DDD 적용 검토

---

## ADR-0005: Sequelize 트랜잭션 사용 (배치 작업 시)

### 배경(문제)

여러 DB 작업을 원자적으로 처리해야 하는 경우(예: 배치 작업) 트랜잭션 사용 방식을 결정해야 했습니다.

### 선택지(대안)

1. **Sequelize 트랜잭션 사용**
2. DB 레벨 트랜잭션 (수동 SQL)
3. 트랜잭션 없이 처리 (에러 시 수동 롤백)

### 결정(무엇을 선택)

**Sequelize 트랜잭션**을 사용합니다.

### 근거(왜)

- Sequelize ORM과 자연스럽게 통합
- `transaction` 옵션으로 간단하게 사용 가능
- 자동 롤백 처리 가능
- 외부 트랜잭션 전달 지원 (중첩 트랜잭션)

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 원자성 보장
- 에러 시 자동 롤백
- 코드 가독성 향상

**트레이드오프**:

- 트랜잭션 범위가 길어지면 락 경합 가능
- Nested 트랜잭션은 지원하지 않음 (대신 외부 트랜잭션 전달)

### 구현 위치

- **배치 작업**: `src/services/calendarService.ts`의 `batchUpsertWorkShifts()`
- **템플릿 생성**: `src/services/shiftTemplateService.ts`의 `createDefaultShiftTemplate()`

### 추후 과제(언제 다시 평가)

- 트랜잭션 범위 최적화
- Deadlock 모니터링 및 처리

---

## ADR-0006: Refresh Token을 DB에 해시값으로 저장

### 배경(문제)

Refresh Token을 어디에, 어떤 형태로 저장할지 결정해야 했습니다.

### 선택지(대안)

1. **DB에 SHA-256 해시값으로 저장**
2. DB에 원본 저장
3. Redis에 저장
4. 클라이언트에만 저장 (서버 저장 없음)

### 결정(무엇을 선택)

**DB에 SHA-256 해시값으로 저장**합니다.

### 근거(왜)

- **보안**: 원본 토큰이 DB에 저장되지 않음
- **무효화 가능**: 로그아웃 시 `revoked_at` 설정으로 무효화
- **검증 가능**: 해시값으로 토큰 검증 가능
- **영구 저장**: Redis 대비 영구 저장 가능

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 보안 강화 (해시값 저장)
- 무효화 가능
- 영구 저장

**트레이드오프**:

- DB 조회 필요 (Redis 대비 성능 저하 가능)
- 만료된 토큰 정리 배치 작업 필요

### 구현 위치

- **토큰 해싱**: `src/services/authService.ts`의 `hashToken()`
- **토큰 저장**: `src/models/RefreshToken.ts`
- **토큰 검증**: `src/services/authService.ts`의 `findValidRefreshToken()`

### 추후 과제(언제 다시 평가)

- Redis 도입하여 성능 최적화 검토
- 만료된 토큰 자동 정리 배치 작업 구현

---

## ADR-0007: 카카오 OAuth 2가지 방식 지원 (WebView + SDK) — Superseded by ADR-0032

### 배경(문제)

카카오 OAuth 로그인을 어떤 방식으로 지원할지 결정해야 했습니다.

### 선택지(대안)

1. **WebView 방식 (authorization code) + SDK 방식 (access_token) 모두 지원**
2. WebView 방식만 지원
3. SDK 방식만 지원

### 결정(무엇을 선택)

**WebView 방식과 SDK 방식을 모두 지원**합니다.

### 근거(왜)

- **WebView 방식**: Flutter WebView에서 사용
- **SDK 방식**: Flutter 카카오 SDK에서 직접 access_token을 받아 사용
- 사용자 편의성: 클라이언트 환경에 따라 선택 가능
- 유연성: 두 방식 모두 지원하여 호환성 확보

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 다양한 클라이언트 환경 지원
- 유연한 통합

**트레이드오프**:

- 두 가지 엔드포인트 유지 필요
- 코드 중복 가능 (공통 로직 추출 필요)

### 구현 위치

- **WebView 방식**: `POST /api/v1/auth/kakao` (`src/controllers/authController.ts`의 `kakaoLogin()`)
- **SDK 방식**: `POST /api/v1/auth/kakao/token` (`src/controllers/authController.ts`의 `kakaoLoginWithToken()`)
- **공통 서비스**: `src/services/kakaoService.ts`

### 추후 과제(언제 다시 평가)

- 공통 로직을 더 추출하여 코드 중복 제거
- 애플 OAuth 추가 시 동일 패턴 적용

---

## ADR-0008: 근무 템플릿 버전 관리 시스템

### 배경(문제)

근무 템플릿의 시간표 변경 이력을 관리하고, 과거 근무표와의 일관성을 유지해야 했습니다.

### 선택지(대안)

1. **템플릿 버전 관리 (ShiftTemplateVersion)**
2. 템플릿만 수정 (버전 없음)
3. 근무표에 직접 시간 정보 저장

### 결정(무엇을 선택)

**템플릿 버전 관리 시스템**을 선택했습니다.

### 근거(왜)

- **과거 일관성**: 과거 근무표는 생성 시점의 템플릿 버전을 참조
- **변경 이력**: 템플릿 변경 시 새 버전 생성으로 이력 관리
- **스냅샷**: 각 버전은 스냅샷으로 저장되어 불변성 보장
- **효과일 관리**: `effective_from`으로 버전 적용 시점 관리

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 과거 근무표와의 일관성 유지
- 변경 이력 추적 가능
- 불변성 보장

**트레이드오프**:

- 스키마 복잡도 증가
- 버전 조회 로직 필요

### 구현 위치

- **모델**: `src/models/ShiftTemplateVersion.ts`, `src/models/ShiftTypeSchedule.ts`
- **서비스**: `src/services/calendarService.ts`의 `getShiftTypes()`, `upsertWorkShift()`

### 추후 과제(언제 다시 평가)

- 버전 관리 최적화 (오래된 버전 정리)
- 버전 비교 기능 추가

---

## ADR-0009: Global Error Handler 사용

### 배경(문제)

에러 처리를 일관되게 하고, 처리되지 않은 에러를 안전하게 처리해야 했습니다.

### 선택지(대안)

1. **Global Error Handler (Express middleware)**
2. Controller에서만 try-catch
3. Service에서 에러 던지고 Controller에서 처리

### 결정(무엇을 선택)

**Global Error Handler + Controller try-catch** 조합을 사용합니다.

### 근거(왜)

- **Global Error Handler**: 처리되지 않은 에러를 안전하게 처리
- **Controller try-catch**: 비즈니스 로직 에러를 적절한 HTTP 상태 코드로 변환
- **일관성**: 모든 에러가 동일한 응답 포맷으로 반환
- **개발 환경**: 개발 환경에서만 stack trace 노출

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 안전한 에러 처리
- 일관된 응답 포맷
- 개발 편의성 (stack trace)

**트레이드오프**:

- 에러 타입별 세밀한 처리가 어려울 수 있음
- 에러 로깅이 분산됨

### 구현 위치

- **Global Error Handler**: `src/middlewares/errorHandler.ts`
- **Controller 에러 처리**: `src/controllers/*.ts`의 try-catch

### 추후 과제(언제 다시 평가)

- 구조화된 에러 클래스 도입 (CustomError)
- 에러 로깅 중앙화 (Winston 등)

---

## ADR-0010: Soft Delete 사용 (deleted_at)

### 배경(문제)

데이터 삭제 시 물리적 삭제와 논리적 삭제 중 선택해야 했습니다.

### 선택지(대안)

1. **Soft Delete (deleted_at)**
2. 물리적 삭제 (DELETE)
3. 상태 플래그 (is_deleted)

### 결정(무엇을 선택)

**Soft Delete (deleted_at)**를 사용합니다.

### 근거(왜)

- **데이터 복구**: 실수로 삭제한 데이터 복구 가능
- **감사 추적**: 삭제 이력 추적 가능
- **관계 유지**: 외래키 관계 유지 가능
- **일관성**: 모든 테이블에서 동일한 방식 사용

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 데이터 복구 가능
- 감사 추적
- 관계 유지

**트레이드오프**:

- 쿼리 시 `WHERE deleted_at IS NULL` 조건 필요
- 인덱스 최적화 필요
- 저장 공간 증가

### 구현 위치

- **모델**: 모든 모델에서 `deleted_at` 컬럼 사용
- **쿼리**: `src/services/*.ts`에서 `WHERE deleted_at IS NULL` 조건 추가

### 추후 과제(언제 다시 평가)

- 오래된 삭제 데이터 정리 배치 작업
- Soft Delete 인덱스 최적화

---

## ADR-0011: 사용자 전화번호 저장 형식 고정

### 배경(문제)

친구 검색에서 `users.phone`을 정확히 비교하므로 동일한 전화번호가 여러 문자열 형식으로 저장되면 검색 실패와 중복 데이터가 발생할 수 있습니다.

### 선택지(대안)

1. `000-000-0000` 또는 `000-0000-0000` 형식으로 저장
2. E.164 형식으로 저장
3. 숫자만 저장하고 화면에서 포맷팅
4. 자유 문자열 저장

### 결정(무엇을 선택)

**`000-000-0000` 또는 `000-0000-0000` 형식으로 저장**합니다.

### 근거(왜)

- 현재 요구사항이 하이픈 포함 전화번호 저장 형식을 명시함
- `users.phone` unique 인덱스와 친구 검색의 정확 비교 조건을 안정적으로 유지할 수 있음
- 서버에서 10~11자리 숫자 입력도 저장 형식으로 정규화해 클라이언트 입력 편차를 줄임
- PostgreSQL `CHECK` 제약으로 DB 레벨에서도 형식을 강제할 수 있음

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 전화번호 중복 방지와 검색 일관성 확보
- 서버/API/DB에서 동일한 형식 규칙 적용
- 잘못된 전화번호 문자열 저장 방지

**트레이드오프**:

- 국가번호가 포함된 E.164 형식은 그대로 저장하지 않음
- 기존 DB에 다른 형식 전화번호가 있으면 CHECK 제약 적용 전 데이터 정규화 필요

### 구현 위치

- **정규화 유틸**: `src/utils/phone.ts`
- **프로필 수정 validation**: `src/routes/authRoutes.ts`
- **프로필 저장/중복 검사**: `src/controllers/authController.ts`
- **모델 validation**: `src/models/User.ts`
- **DB CHECK 제약**: `migrations/final_schema.sql`, `migrations/enforce_users_phone_format.sql`

### 추후 과제(언제 다시 평가)

- 해외 전화번호 지원이 요구되면 E.164 저장 방식으로 재평가

---

## ADR-0012: 캘린더 근무표 응답 포맷 고정

### 배경(문제)

Flutter 캘린더가 저장 직후 서버 응답의 근무 타입 이름, 색상, 시작/종료 시간을 화면 표시 기준으로 사용합니다. API별 응답 필드나 색상/시간 포맷이 다르면 계정 전환, 배치 저장 직후 화면 갱신, 친구 캘린더 표시에서 불일치가 발생할 수 있습니다.

### 선택지(대안)

1. `WorkShiftApiModel` 응답 필드를 캘린더/근무표 API에서 공통 사용
2. 각 API가 필요한 필드만 부분 반환
3. 저장 API는 성공 여부만 반환하고 프론트가 별도 조회

### 결정(무엇을 선택)

**캘린더/근무표 API는 동일한 `WorkShiftApiModel` 필드를 반환**합니다.

### 근거(왜)

- 저장 직후 프론트가 별도 재조회 없이 화면 표시 맵을 갱신할 수 있음
- `work_shifts.schedule_id → shift_type_schedules → shift_types` 조인 결과를 항상 서버 기준으로 내려 계정별 템플릿 색상/이름 혼선을 줄임
- 색상은 `#AARRGGBB`, 시간은 `HH:mm:ss`로 고정해 클라이언트 파싱 분기를 줄임
- 개인 캘린더는 JWT 현재 사용자 `owner_user_id`, 친구 캘린더는 `viewer_user_id`/`friend_user_id`/공개 설정 기준으로 조회해 사용자별 데이터 혼선을 방지

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- `GET /calendar/range`, `GET /work-shifts`, `POST /work-shifts`, `PUT /work-shifts/:work_shift_id`, `POST /work-shifts/batch`, 친구 캘린더 응답 구조 일관성 확보
- 색상/시간 표시 계약 명확화
- 인증 응답 캐시 혼선 방지를 위해 `/api`에 `Cache-Control: private, no-store`, `Vary: Authorization` 적용

**트레이드오프**:

- 저장 API 응답 생성 시 상세 조인이 필요함
- 과거에 저장된 숫자 또는 6자리 RGB 색상 문자열은 응답 직렬화 단계에서 `#AARRGGBB`로 정규화됨

### 구현 위치

- **캘린더 서비스**: `src/services/calendarService.ts`
- **캘린더 컨트롤러**: `src/controllers/calendarController.ts`
- **친구 캘린더 서비스**: `src/services/friendService.ts`
- **캐시 헤더**: `src/index.ts`
- **라우트 validation**: `src/routes/calendarRoutes.ts`

### 추후 과제(언제 다시 평가)

- “근무 생성 당시의 이름/색상을 영구 보존” 요구가 생기면 `work_shifts`에 snapshot 컬럼 추가 여부 재평가

---

## ADR-0013: 친구 요청 응답 시 원본 알림 처리 상태 갱신

### 배경(문제)

알림 화면의 `FRIEND_REQUEST` 카드에는 수락/거절 버튼이 포함됩니다. 기존 구현은 버튼을 누르면 `friend_requests.status`를 변경하고 요청자에게 결과 알림을 새로 만들었지만, 요청 수신자에게 표시되던 원본 알림은 계속 `FRIEND_REQUEST`와 `accept`/`reject` 액션을 유지했습니다. 따라서 알림 화면을 다시 그려도 처리 완료 상태가 아니라 대기중 버튼 UI처럼 보일 수 있었습니다.

### 선택지(대안)

1. 원본 `FRIEND_REQUEST` 알림을 처리 완료 타입으로 갱신
2. 원본 알림은 유지하고 프론트가 `friend_requests`를 별도 조회해 상태 보정
3. 원본 알림을 삭제하고 새 완료 알림을 생성

### 결정(무엇을 선택)

**원본 `FRIEND_REQUEST` 알림을 `FRIEND_REQUEST_ACCEPTED` 또는 `FRIEND_REQUEST_REJECTED`로 갱신**합니다.

### 근거(왜)

- 알림 카드의 상태 출처를 `notifications` 한 곳으로 유지할 수 있음
- 응답 API가 갱신된 `notification`을 반환하므로 프론트가 재조회 없이 해당 카드를 즉시 교체할 수 있음
- `notifications.notification_type`은 확장 가능한 문자열이고, `actions`도 JSON 배열이므로 DB 스키마 변경 없이 표현 가능
- 기존 요청자 결과 알림(`FRIEND_ACCEPTED`, `FRIEND_REJECTED`)은 유지되어 양쪽 사용자 경험이 분리됨

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 처리 완료 후 알림 화면에서 수락/거절 버튼이 다시 보이지 않음
- 알림 목록 재조회와 즉시 로컬 갱신 모두 같은 계약을 사용
- `friend_requests.status`, 원본 알림 갱신, 요청자 결과 알림 생성을 하나의 트랜잭션으로 처리

**트레이드오프**:

- 프론트는 `FRIEND_REQUEST_ACCEPTED`, `FRIEND_REQUEST_REJECTED` 타입을 처리 완료 상태로 표시하고 `actions=[]`이면 버튼을 표시하지 않아야 함
- 기존에 `FRIEND_REQUEST` 타입만 보고 버튼을 고정 표시하던 UI는 `actions` 기반 표시로 맞춰야 함

### 구현 위치

- **친구 서비스**: `src/services/friendService.ts`
- **친구 API 가이드**: `_docs/FRIEND_API_GUIDE.md`
- **프로젝트 컨텍스트**: `_docs/PROJECT_CONTEXT.md`

### 추후 과제(언제 다시 평가)

- 친구 요청 취소 시 수신자 원본 알림도 `FRIEND_REQUEST_CANCELED`로 갱신할 요구가 생기면 같은 패턴으로 확장 검토

---

## ADR-0014: 근무표 삭제 후 같은 날짜 재등록은 soft-deleted row 복구

### 배경(문제)

`work_shifts`는 `(owner_user_id, work_date)` unique 제약을 사용하고, 삭제는 `deleted_at`, `deleted_by_user_id`를 설정하는 soft delete 방식입니다. 같은 날짜 근무표를 등록, 삭제, 재등록하면 `WorkShift.upsert()`가 unique 충돌 row를 갱신하지만 기존 `deleted_at` 값을 지우지 않아 `GET /calendar/range`, `GET /work-shifts`의 `deleted_at IS NULL` 조회 조건에서 누락될 수 있었습니다.

### 선택지(대안)

1. 같은 날짜 재등록 시 기존 soft-deleted row의 `deleted_at`, `deleted_by_user_id`를 `null`로 복구
2. unique 제약을 partial unique index로 변경하고 새 row를 생성
3. 조회 API에서 최신 row를 별도 보정해 반환

### 결정(무엇을 선택)

**같은 날짜 재등록은 기존 soft-deleted row를 활성 상태로 복구**합니다.

### 근거(왜)

- 현재 DB 스키마가 사용자별 하루 근무표 1건을 `(owner_user_id, work_date)` unique 제약으로 보장함
- 스키마 변경 없이 단건/배치 upsert 저장 경로만 수정하면 기존 API 계약을 유지할 수 있음
- 조회 API의 `deleted_at IS NULL` 조건은 soft delete 정책상 유지해야 하므로 저장 시점에 활성 상태를 정확히 복구하는 것이 원인 해결에 맞음

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 삭제 후 같은 날짜 재등록 데이터가 캘린더 조회에서 다시 반환됨
- `POST /work-shifts`, `POST /work-shifts/batch` 모두 동일한 복구 동작을 사용
- 기존 unique 제약과 soft delete 조회 정책을 유지

**트레이드오프**:

- 삭제 이력 row가 새 row로 분리되지 않고 기존 `work_shift_id`가 재활성화됨
- 재등록 시 `deleted_at`, `deleted_by_user_id`는 삭제 이력 값으로 남지 않음

### 구현 위치

- **캘린더 서비스**: `src/services/calendarService.ts`
- **프로젝트 컨텍스트**: `_docs/PROJECT_CONTEXT.md`

### 추후 과제(언제 다시 평가)

- 삭제 이력 보존이 별도 요구사항이 되면 audit table 또는 partial unique index 기반 신규 row 생성 방식으로 재평가

---

## ADR-0015: PostgreSQL 잠금 기반 다중 인스턴스 운영 계약

### 배경(문제)

동일 Express 서버를 3개 인스턴스로 실행하면 요청이 서로 다른 프로세스에 전달됩니다. JWT 인증 자체는 stateless이지만 Refresh Token 갱신, 기본 템플릿 생성, 친구 요청 생성/응답에는 조회 후 변경하는 구간이 있어 동시 요청이 중복 성공하거나 unique 오류를 반환할 수 있었습니다. 컨테이너 종료와 헬스 체크도 다중 인스턴스 운영 기준이 정의되지 않았습니다.

### 선택지(대안)

1. PostgreSQL row lock/advisory transaction lock과 단일 트랜잭션 사용
2. Redis 분산 잠금 도입
3. Nginx sticky session으로 동일 사용자를 한 인스턴스에 고정
4. 애플리케이션 메모리 mutex 사용

### 결정(무엇을 선택)

**공용 PostgreSQL의 row lock과 advisory transaction lock으로 인스턴스 간 동시성을 직렬화**합니다.

- Refresh Token rotation: `refresh_tokens` row를 `FOR UPDATE`로 잠그고 무효화와 신규 저장을 단일 트랜잭션으로 처리
- JWT 발급: Access/Refresh Token에 각각 무작위 `jti` 포함
- 기본 템플릿: 사용자 ID 기반 advisory transaction lock
- 친구 요청 생성: 정렬된 사용자 쌍 기반 advisory transaction lock
- 친구 요청 수락/거절: `friend_requests` row lock
- API 프로세스는 migration과 `sequelize.sync()`를 실행하지 않으며 `DB_SYNC=true`면 시작 거부
- `SIGTERM`/`SIGINT`에서 HTTP 서버와 Sequelize pool을 순서대로 종료
- liveness와 DB readiness를 별도 엔드포인트로 제공

### 근거(왜)

- 모든 API 인스턴스가 이미 동일 PostgreSQL을 사용하므로 추가 Redis 운영 의존성이 필요 없음
- DB 트랜잭션과 잠금의 생명주기가 같아 오류 시 자동 해제됨
- sticky session 없이 어느 인스턴스가 요청을 받아도 동일한 정합성 규칙을 적용 가능
- 메모리 mutex와 달리 프로세스/컨테이너 경계를 넘어 동작

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 동일 Refresh Token 동시 갱신은 한 요청만 성공
- 기본 템플릿과 반대 방향 친구 요청이 중복 생성되지 않음
- 수락/거절 동시 요청이 서로 다른 완료 상태를 만들지 않음
- DB 장애를 readiness 503으로 구분하고 rolling stop 시 진행 중 요청을 보호

**트레이드오프**:

- 같은 사용자/친구 쌍에 대한 동시 쓰기는 앞선 트랜잭션 완료까지 대기
- 인스턴스 수에 비례해 DB pool 최대 연결 수가 증가하므로 `DB_POOL_MAX` 용량 계산 필요
- Nginx 외 다른 프록시 계층이 추가되면 `TRUST_PROXY_HOPS` 재설정 필요

### 구현 위치

- **환경변수 검증**: `src/config/environment.ts`
- **DB pool/readiness**: `src/config/database.ts`
- **서버 수명주기/CORS/proxy**: `src/index.ts`
- **헬스 체크**: `src/routes/index.ts`
- **Refresh Token**: `src/services/authService.ts`
- **기본 템플릿**: `src/services/shiftTemplateService.ts`
- **친구 요청**: `src/services/friendService.ts`

### 추후 과제(언제 다시 평가)

- PostgreSQL 외부 작업 큐나 스케줄러가 추가되면 전용 worker 또는 큐 소비자 구조 재평가
- API 인스턴스를 여러 DB 리전에 배치하게 되면 advisory lock 대신 전역 조정 수단 재평가

---

## ADR-0016: Request ID와 인스턴스별 인증 요청 제한을 포함한 운영 HTTP 경계

### 배경(문제)

Nginx 뒤의 Express 인스턴스 3개를 운영하려면 컨테이너 식별, 요청 추적, 과도한 인증 요청 제한, 요청 본문 크기 제한이 필요합니다. 기존 인증 오류 로깅은 Axios 오류 객체 전체를 전달할 수 있어 Authorization 헤더나 OAuth Token이 로그에 포함될 가능성도 있었습니다.

### 선택지(대안)

1. Express 공통 미들웨어에서 Request ID, 본문 제한, 인스턴스별 rate limit, 안전 오류 로그 적용
2. 모든 기능을 Nginx에만 적용
3. Redis 기반 전역 rate limit을 즉시 도입

### 결정(무엇을 선택)

**Express에 최소 운영 방어선을 적용하고, 전체 인스턴스 공통 인증 제한은 Nginx 단계에서 추가**합니다.

- `GET /health`는 `status=ok`와 `INSTANCE_NAME` 반환
- Express는 `0.0.0.0:${PORT}`에 listen
- JSON/form body는 `REQUEST_BODY_LIMIT` 적용
- 로그인/회원가입/OAuth/Refresh는 IP 기준 인스턴스별 `AUTH_RATE_LIMIT_*` 적용
- 모든 요청에 `X-Request-ID`를 생성/전파하고 access/error log에 포함
- access log는 쿼리 문자열, 본문, Authorization, referrer를 기록하지 않음
- 오류 로그는 오류 객체 전체 대신 context, Request ID, 오류 이름/코드/HTTP 상태만 기록
- 운영 5xx 응답은 내부 메시지와 stack을 반환하지 않음

### 근거(왜)

- Nginx 설정 누락이나 내부 직접 접근 시에도 Express 자체 최소 방어 유지
- Request ID로 Nginx와 각 컨테이너 로그를 연결 가능
- Redis 도입 없이 현재 단계의 로그인 폭주를 제한하면서 후속 Nginx `limit_req`로 전체 제한 가능
- Axios request/config/response를 직렬화하지 않아 Bearer Token과 OAuth 자격증명 로그 노출 경로 제거

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- `curl /health`만으로 컨테이너 식별 가능
- 큰 본문은 Controller 도달 전 413으로 차단
- 과도한 인증 요청은 429와 `Retry-After`로 응답
- 모든 응답과 HTTP 로그를 Request ID로 추적 가능

**트레이드오프**:

- Express rate limit은 프로세스 메모리 기반이므로 3개 인스턴스 합산 전역 제한이 아님
- Nginx 프록시 hop 수가 잘못되면 IP 기준 제한과 로그의 클라이언트 주소가 부정확할 수 있음
- 오류 객체 원문을 기록하지 않으므로 상세 디버깅은 로컬 재현이나 명시적 안전 필드 추가가 필요

### 구현 위치

- **서버 경계**: `src/index.ts`
- **Request ID**: `src/middlewares/requestContext.ts`
- **인증 요청 제한**: `src/middlewares/rateLimit.ts`
- **인증 입력 검증 응답**: `src/middlewares/validateRequest.ts`
- **안전 오류 로그**: `src/utils/logger.ts`
- **Controller/Service 오류 처리**: `src/controllers/*.ts`, `src/services/*.ts`
- **전역 오류 응답**: `src/middlewares/errorHandler.ts`
- **인증 라우트**: `src/routes/authRoutes.ts`

### 추후 과제(언제 다시 평가)

- Nginx 설정 단계에서 전체 인스턴스 공통 `limit_req` 추가
- 다중 비공개 실행 환경로 확장하거나 프록시를 우회하는 내부 클라이언트가 생기면 Redis/PostgreSQL 기반 전역 rate limit 재평가

---

## ADR-0017: Node 22 멀티 스테이지 linux/amd64 운영 이미지

### 배경(문제)

self-hosted x86_64 환경에서 동일 Express 인스턴스를 3개 실행하려면 재현 가능한 `linux/amd64` 이미지, TypeScript 빌드 단계와 런타임 단계의 분리, 비밀값 제외, 비루트 실행, Docker health check와 SIGTERM 종료 계약이 필요합니다. 최초 이미지 빌드에서는 운영 의존성 취약점도 확인되었습니다.

### 선택지(대안)

1. Node 22 Debian slim 멀티 스테이지 이미지
2. 단일 스테이지 이미지에 개발 의존성과 소스 전체 포함
3. Alpine 기반 최소 이미지

### 결정(무엇을 선택)

**Node 22 Debian slim 멀티 스테이지 `linux/amd64` 이미지**를 사용합니다.

- builder에서 `npm ci` 후 `npm run build`로 `dist/` 생성
- runtime에서 `npm ci --omit=dev` 후 `dist/`만 복사
- `.dockerignore`로 `.env*`, Git, 로컬 의존성/산출물, migration과 개발 자료 제외
- `USER node`, `CMD ["node", "dist/index.js"]`, `STOPSIGNAL SIGTERM` 사용
- 루트 `/health`를 Docker `HEALTHCHECK`로 사용
- Axios, Express, Morgan, qs, Sequelize를 감사 결과가 해소된 패치 버전 이상으로 고정
- Sequelize 6이 사용하는 `uuid`는 CommonJS `v1`/`v4` 호환이 확인된 11.1.1로 하위 의존성 override

### 근거(왜)

- 빌드 도구와 TypeScript를 최종 이미지에서 제거해 공격 표면 축소
- Debian slim은 현재 Node/Sequelize/PostgreSQL 의존성과의 호환성을 유지하면서 full 이미지보다 작음
- Intel N100의 네이티브 아키텍처인 amd64로 빌드
- Node 프로세스를 PID 1로 직접 실행해 Docker SIGTERM을 애플리케이션 graceful shutdown handler로 전달
- 비밀값은 이미지가 아니라 런타임 환경변수로만 주입

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 최종 이미지에 `.env`, TypeScript, ts-node가 없음
- node 사용자 UID/GID 1000으로 실행
- Docker가 컨테이너 health 상태를 직접 판단 가능
- `npm audit` 기준 전체/운영 의존성 취약점 0건

**트레이드오프**:

- Debian slim 기반 최종 이미지 크기는 약 252MB
- Apple Silicon 로컬 테스트에서는 amd64 에뮬레이션이 사용됨
- `DB_HOST=localhost`는 컨테이너 자신을 가리키므로 환경별 DB 주소 설정 필요
- Sequelize가 uuid 11 이상을 공식 의존성으로 채택하면 override를 제거하고 재검증해야 함

### 구현 위치

- **이미지 정의**: `Dockerfile`
- **빌드 컨텍스트 제외**: `.dockerignore`
- **의존성 보안 기준**: `package.json`, `package-lock.json`
- **서버 health/종료 처리**: `src/index.ts`

### 추후 과제(언제 다시 평가)

- Sequelize 7 전환 또는 Sequelize 6의 uuid 의존성 상향 시 override 제거 검토
- 이미지 전송 전 digest와 파일 크기 기록
- 비공개 실행 환경에서 amd64 네이티브 실행, DB 연결, 메모리 사용량 재검증

---

## ADR-0018: 근무 타입 최종 색상과 기준 색상·농도 분리 저장

### 배경(문제)

Flutter 색상 선택기는 기준 색상을 흰색과 혼합해 농도가 적용된 최종 색상을 만듭니다. 기존 `shift_types.color`에는 최종 색상만 저장되어 같은 설정 화면에 다시 진입할 때 원래 기준 색상과 농도를 정확히 복원할 수 없습니다. 최종 색상 하나는 여러 기준 색상·농도 조합으로 만들 수 있어 역산도 안전하지 않습니다.

### 선택지(대안)

1. 기존 최종 `color`를 유지하고 `base_color`, 정수 `color_intensity`를 추가
2. 최종 `color`를 제거하고 조회마다 기준 색상과 농도로 계산
3. 기존 최종 `color`만 유지하고 클라이언트에서 근사 역산
4. 농도를 부동소수점 `0..1`로 저장

### 결정(무엇을 선택)

**최종 렌더링 색상 `color`를 유지하고 `base_color`, `color_intensity(0..100)`를 함께 저장**합니다.

- 신규 기준 색상은 불투명 `#FFRRGGBB`만 허용
- 최종 색상은 불투명 흰색 `#FFFFFFFF` 기준 채널별 선형 혼합으로 서버가 계산
- 구버전 `color` 단독 쓰기와 레거시 행은 `base_color=color`, `color_intensity=100`으로 해석
- 신규 필드 중 하나만 전달하거나 클라이언트 최종 색상이 서버 계산값과 다르면 요청 거절
- DB 변경은 nullable 컬럼 확장 → 신규 서버 dual-read/dual-write 배포 → 백필·제약 적용 순서로 수행

### 근거(왜)

- 기존 Flutter와 캘린더/친구 캘린더의 `shift_type_color` 계약을 깨지 않음
- 설정 화면은 기준 색상과 농도를 손실 없이 복원 가능
- 정수 퍼센트는 UI 표시 단위와 일치하고 JSON/DB 부동소수점 오차가 없음
- 최종 색상을 서버에서 계산해 세 필드 불일치를 방지
- 확장/백필 분리로 구버전 서버 롤백 기간에도 기존 `color` 쓰기가 실패하지 않음

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 색상 설정 화면 재진입 시 기준 색상과 농도 복원
- 기존 앱과 캘린더 표시 API의 하위 호환 유지
- DB CHECK로 농도 범위와 백필 이후 기준 색상 형식 보장

**트레이드오프**:

- 동일한 색상 의미를 세 컬럼으로 저장하므로 서버의 원자적 갱신 규칙이 필요
- DB 마이그레이션과 서버 배포 순서를 지켜야 함
- 서버 롤백 기간에는 `base_color`를 nullable로 유지해야 하므로 DB만으로 세 컬럼의 완전한 쌍 제약을 강제하지 않음

### 구현 위치

- **모델**: `src/models/ShiftType.ts`
- **요청 검증**: `src/routes/calendarRoutes.ts`
- **오류 매핑**: `src/controllers/calendarController.ts`
- **계산·저장**: `src/services/shiftTemplateService.ts`
- **목록 fallback**: `src/services/calendarService.ts`
- **수동 migration**: `migrations/add_shift_type_color_metadata.sql`, `migrations/backfill_shift_type_color_metadata.sql`

### 추후 과제(언제 다시 평가)

- 구버전 서버 롤백 기간 종료 후 `color`와 `base_color`의 쌍 제약 강화 여부 검토
- 테마 색상 혼합 기준 변경 요구가 생기면 고정 흰색 계산 계약과 데이터 migration 재평가

---

## ADR-0019: 별도 배포 저장소와 GHCR 기반 Blue/Green 운영 배포

> 상태: Blue/Green 배포 결정은 유지하며, 배포 엔진 실행·갱신 trust boundary는 ADR-0028로 대체합니다.

### 배경(문제)

홈서버의 Center Express 인스턴스 3개와 Stage 인스턴스 1개를 같은 이미지로 교체해야 하며, 빌드 실패나 health 실패가 기존 운영 상태를 남기지 않아야 합니다. Self-hosted runner에는 Docker와 Nginx를 변경할 권한이 필요하지만 저장소 워크플로가 임의 root 명령을 실행할 수 있게 해서는 안 됩니다. 또한 애플리케이션 개발 원격과 운영 배포 자동화의 변경 경계를 분리해야 합니다.

### 선택지(대안)

1. 별도 배포 저장소에서 애플리케이션 소스와 고정 배포 자동화를 함께 관리하고 GHCR·Blue/Green 전환 사용
2. 애플리케이션 저장소의 push마다 홈서버에서 직접 pull·build·restart
3. 홈서버에서 SSH 기반 수동 배포
4. Kubernetes 또는 외부 관리형 배포 서비스 도입

### 결정(무엇을 선택)

**`hspark-1/shift_calendar_server-deploy`의 `main`을 운영 배포 기준으로 사용하고, commit SHA 이미지와 홈서버 Blue/Green 전환을 적용**합니다.

- GitHub Actions는 수동 `workflow_dispatch`, `main`, 확인 체크를 검증
- GitHub-hosted runner에서 Node 22 빌드 후 `linux/amd64` 이미지를 `sha-<commit>`으로 GHCR에 push
- 홈서버 self-hosted runner의 sudoers는 root 소유 `/usr/local/sbin/shiftmate-deploy` 경로만 허용하고, 이미지·actor 인자는 스크립트가 엄격히 검증
- pull한 하나의 불변 image digest를 기존 Stage Compose의 API/cache worker/push worker image override에 먼저 적용하고 API readiness와 두 worker health를 확인
- 현재 활성 색상의 반대편 Center API 인스턴스 3개와 cache/push worker에 같은 digest를 적용하고 내부 health를 모두 확인
- Nginx upstream reload 후 Center와 Stage 외부 `/api/v1/health`가 모두 성공해야 배포 상태를 확정
- Center Blue/Green upstream 이름은 `shiftmate_center_api_cluster`, Stage 3201 고정 upstream 이름은 `shiftmate_stage_api_cluster`로 분리
- Center 동적 upstream 교체는 Stage 고정 upstream snippet을 변경하지 않음
- 실패 시 Stage API/worker image override와 컨테이너, Center upstream·상태 파일·신규 API/두 worker 컨테이너를 이전 상태로 복원. 최초 Push Worker 도입 전 override에는 이전 이미지가 없으므로 실패 시 새 Push Worker를 중지·제거하고 기존 API/cache worker만 복원
- 롤백도 과거 commit SHA를 대상으로 같은 배포 경로를 재사용
- DB migration은 이미지 배포와 분리하여 개발자가 수동 실행
- 홈서버 Stage base Compose도 `deploy/compose.stage.yaml`에서 버전 관리하고 root 소유 `/opt/shiftmate-stage/compose.yaml`로 수동 설치

### 근거(왜)

- 빌드 실패는 홈서버 상태를 변경하지 않음
- 신규 인스턴스가 준비된 후에만 트래픽을 전환하므로 중단 시간을 최소화
- commit 태그를 pull한 뒤 digest로 고정해 실제 실행 이미지를 불변으로 유지
- 한 번 빌드한 동일 digest를 Stage와 Center에 적용해 환경별 이미지 차이를 방지
- self-hosted runner를 Docker 그룹에 넣지 않고 검증된 root 스크립트 하나만 허용
- sudoers command argument wildcard·정규식 지원 여부에 의존하지 않고, 수정 불가능한 root 스크립트의 인자 개수·이미지 형식·actor 검증으로 권한 범위를 제한
- 별도 배포 원격으로 운영 자동화 변경과 일반 개발 배포 권한을 구분

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- Stage 1개와 Center 3개의 내부 health 및 양쪽 외부 health를 모두 검증
- 정상 상태의 Stage 1개와 Center 3개가 같은 image digest를 사용
- 배포와 롤백의 절차 및 실패 복구 경로 통일
- 운영 `.env`, DB 암호, JWT secret을 GitHub에 전달하지 않음
- Blue/Green 상태와 이미지 digest를 `/opt/shiftmate/.deploy.env`에서 명시적으로 추적
- 환경별 Firebase service account를 Git·이미지·`.env`와 분리하고, root 전용 `0700` 디렉터리 아래 non-root Worker가 bind mount로 읽을 수 있는 `0444` 파일로 저장해 Push Worker에만 mount

**트레이드오프**:

- 배포 저장소의 애플리케이션 소스를 운영 배포 대상 commit과 동기화해야 함
- 한 번에 두 색상의 컨테이너가 기동되는 동안 추가 CPU·메모리 필요
- Stage는 단일 컨테이너 재생성이므로 배포 중 짧은 중단이 발생할 수 있음
- 이미지 롤백은 DB schema를 되돌리지 못하므로 migration은 하위 호환 순서를 지켜야 함
- 홈서버 runner, Nginx include, sudoers를 최초 1회 수동 구성해야 함
- root 소유 배포 스크립트의 인자 검증이 sudo 권한 안전성의 일부이므로 스크립트 권한과 검증 로직을 함께 유지해야 함

### 구현 위치

- **배포 워크플로**: `.github/workflows/deploy-production.yml`
- **롤백 워크플로**: `.github/workflows/rollback-production.yml`
- **운영 Compose**: `deploy/compose.production.yaml`
- **Stage Compose**: `deploy/compose.stage.yaml`
- **Stage 배포 설정 예시**: `deploy/stage.deploy.env.example`
- **배포 엔진**: `deploy/shiftmate-deploy`
- **최초 전환**: `deploy/shiftmate-bootstrap`
- **Center Nginx upstream**: `deploy/nginx/shiftmate-upstream-blue.conf`, `deploy/nginx/shiftmate-upstream-green.conf`
- **Stage Nginx upstream**: `deploy/nginx/shiftmate-stage-upstream.conf`
- **Runner sudoers**: `deploy/sudoers/github-runner-shiftmate`
- **운영 절차**: `_docs/CI_CD_DEPLOYMENT_GUIDE.md`

### 추후 과제(언제 다시 평가)

- 자동 테스트가 추가되면 이미지 push 전 CI 단계에 포함
- 운영 migration 자동화가 필요해지면 expand/contract 호환성과 별도 승인 단계를 먼저 설계
- 다중 홈서버 또는 지역 이중화가 필요해지면 현재 단일 호스트 Blue/Green 구조 재평가

---

## ADR-0020: 공유 Redis 월별 근무표 캐시와 PostgreSQL Outbox

### 배경(문제)

본인·친구 캘린더가 같은 사용자 근무표를 반복 조회할 때마다 `work_shifts`, `shift_type_schedules`, `shift_types`를 조인합니다. 운영은 API 3개와 Blue/Green 중첩 구조이므로 프로세스 메모리나 동일 볼륨 LevelDB는 인스턴스 전체에서 안전하게 공유·무효화할 수 없습니다.

### 선택지(대안)

1. 공유 Redis 월 snapshot + PostgreSQL revision/Outbox
2. 인스턴스별 LevelDB와 무효화 broadcast
3. LevelDB 전용 서비스
4. PostgreSQL을 매 요청 직접 조회

### 결정(무엇을 선택)

**PostgreSQL을 원본으로 유지하고 환경별 공유 Redis에 `owner_user_id + YYYYMM` 근무표 snapshot을 저장**합니다.

- 기존 기간 API를 유지하고 내부에서 월 snapshot을 병합·필터링
- 친구 관계와 `can_view`는 매 요청 PostgreSQL에서 확인
- 원본 변경, 월 revision 증가, Outbox 삽입을 한 transaction으로 처리
- commit 후 best-effort 즉시 무효화하고 색상별 worker가 durable 재처리
- revision fence와 Redis lock으로 stale 재저장과 cache stampede 방지
- Redis 장애 시 PostgreSQL fallback, 이벤트는 기존 DB 조회 유지

### 근거(왜)

- 모든 API 인스턴스와 Blue/Green 양쪽이 같은 cache key와 fence를 사용
- 캐시는 유실 가능한 최적화 계층이고 PostgreSQL 정합성과 롤백 가능성을 유지
- Outbox가 DB commit과 Redis 장애 사이의 이벤트 유실을 복구
- 친구 권한을 snapshot에 포함하지 않아 공개 설정 변경이 즉시 적용
- 기존 Flutter `start_date/end_date`와 응답 body를 변경하지 않음

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 반복 월 조회의 DB 조인과 네트워크 전송을 Redis hit/ETag 304로 절감
- 빈 달도 캐시하고 batch 변경은 월마다 한 번만 revision 증가
- Redis/worker 장애 중에도 API 가용성을 PostgreSQL로 유지

**트레이드오프**:

- Redis와 worker 운영, 수동 expand migration, Outbox 지연 관측이 추가됨
- commit과 즉시 무효화 사이의 매우 짧은 eventual consistency 구간이 존재
- 근무 타입 표시값 변경도 참조 중인 월 cache를 무효화해야 함

### 구현 위치

- **캐시/Redis**: `src/config/redis.ts`, `src/services/workShiftMonthCacheService.ts`
- **정합성/worker**: `src/services/workShiftCacheInvalidationService.ts`, `src/workers/workShiftCacheWorker.ts`
- **DB**: `migrations/add_work_shift_month_cache_support.sql`
- **배포**: `[private deployment file]`, `[private deployment file]`

### 추후 과제(언제 다시 평가)

- events 조회가 실제 DB 병목으로 확인되면 기간 겹침과 visibility를 별도 설계한 뒤 캐시 범위 확대
- 다중 비공개 실행 환경/Redis HA가 필요해지면 managed Redis 또는 Sentinel/Cluster 전환 검토
- Outbox 지연과 hit ratio를 장기 수집할 관측 시스템 도입

---

## ADR-0021: 기존 친구 ACL을 재사용하는 그룹 aggregate와 P0/P1 단계 배포

### 배경(문제)

Flutter 그룹 목록과 그룹 캘린더 미리보기의 더미 데이터를 서버 계약으로 교체해야 합니다. 그룹 가입 자체가 개인 캘린더 공개 권한을 넓혀서는 안 되며, 최대 20명·100일 조회에서 멤버별 API/SQL 반복이나 기존 owner별 Redis snapshot miss N+1도 피해야 합니다.

### 선택지(대안)

1. 그룹은 멤버십만 관리하고 기존 `friendships + friend_level_settings`를 재사용하며 PostgreSQL set-based aggregate 조회
2. 그룹 가입 시 별도 그룹 캘린더 ACL 자동 생성
3. 그룹 소유 캘린더·일정·근무 테이블 신설
4. 멤버마다 기존 친구 캘린더 API와 Redis 월 snapshot을 반복 호출

### 결정(무엇을 선택)

**그룹은 `groups`, `group_members`, `group_invitations`만 소유하고 개인 캘린더는 기존 친구 ACL로 공개하며, 캘린더 aggregate는 고정 3개 PostgreSQL query로 조회**합니다.

- 본인은 전체 공개, 다른 멤버는 friendship 존재·`can_view=true`일 때 `VISIBLE`, 그 외 `DENIED`
- visible 이벤트는 기존 `friend_level >= visibility_level`, 근무는 고정 visibility 0 규칙 적용
- 그룹 캘린더에서는 owner별 Redis v1 snapshot을 사용하지 않음
- DB 스키마는 P1까지 한 번에 expand하고 P0 7개 endpoint를 먼저 배포한 뒤 같은 스키마에서 P1 관리 endpoint 배포
- 모든 그룹 쓰기는 Sequelize transaction을 사용하고 기존 그룹 변경은 group row를 먼저 잠금
- 비멤버·삭제 그룹은 `404 GROUP_NOT_FOUND`, 활성 멤버의 역할 부족만 `403 GROUP_PERMISSION_DENIED`
- 초대와 처리 결과는 기존 `notifications`를 source of truth인 받은 초대 API와 함께 사용

### 근거(왜)

- 그룹 참여가 사용자 개인 공개 정책을 암묵적으로 변경하지 않음
- 멤버·근무·이벤트 3개 set-based query로 멤버 수에 따른 N+1 제거
- 기존 개인/친구 캘린더 캐시의 owner별 월 key 계약과 무효화 구조를 변경하지 않음
- expand migration을 서버보다 먼저 적용할 수 있고 이전 API는 신규 테이블을 참조하지 않아 하위 호환
- Flutter가 필요한 읽기/초대 계약을 P0에서 먼저 검증하고 관리 기능 위험을 P1로 분리

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 개인 캘린더 공개 의미와 그룹 멤버십 책임 분리
- `DENIED` 멤버를 유지하면서 숨겨진 row 및 개수 비노출
- 그룹 row 잠금으로 멤버 제한, 동시 수락, 역할, 소유권 이전 직렬화
- 이전 API 이미지 우선 복원 후 신규 테이블을 유지하는 운영 롤백 가능

**트레이드오프**:

- 그룹 aggregate는 Redis hit 이점을 사용하지 않고 매 요청 PostgreSQL을 조회
- 그룹 멤버라도 친구가 아니거나 `can_view=false`면 캘린더가 비공개
- 초대 만료는 읽기·재초대·응답 시 정리되며 별도 정기 batch는 이번 범위에 없음

### 구현 위치

- **DB**: `migrations/add_group_feature.sql`, `migrations/rollback_group_feature.sql`
- **모델/서비스**: `src/models/Group*.ts`, `src/services/groupService.ts`
- **HTTP**: `src/routes/groupRoutes.ts`, `src/controllers/groupController.ts`
- **계약 문서**: `src/openapi/groupOpenApi.json`, `_docs/GROUP_API_GUIDE.md`
- **테스트**: `test/groupService.test.cjs`, `test/groupIntegration.test.cjs`

### 추후 과제(언제 다시 평가)

- 격리 환경 측정에서 그룹 aggregate DB query time이 병목일 때만 set-based multi-owner cache 설계
- 외부 push 인프라가 도입되면 `invitation_id` idempotency key 기반 비동기 발송 추가
- 20명·100일 한도나 그룹별 공개 정책 요구가 변경될 때 스키마와 개인정보 노출 위험 재평가

---

## ADR-0022: notifications 원본과 PostgreSQL lease Push Worker 분리

### 배경(문제)

친구 요청·그룹 초대를 앱이 열려 있지 않을 때도 알려야 하지만, 도메인 transaction 안에서 FCM을 직접 호출하면 외부 장애가 API 응답과 DB 정합성에 결합됩니다. 한 사용자의 여러 설치 중 어느 기기에 보낼지, token refresh·logout·재시도·환경 격리도 일관된 정책이 필요합니다.

### 선택지(대안)

1. `notifications + push_jobs` 원자 기록 후 PostgreSQL lease worker가 최신 활성 기기 한 대에 전송
2. API 서비스가 transaction 완료 후 FCM 직접 호출
3. 모든 활성 기기에 fan-out
4. Firebase topic 기반 사용자 구독

### 결정(무엇을 선택)

**인앱 `notifications`를 원본으로 유지하고 같은 transaction에 `push_jobs` snapshot을 기록한 뒤, 독립 Push Worker가 `LATEST_ACTIVE` 기기 한 대를 최초 1회 선택해 FCM으로 전송**합니다.

- API 서버는 FCM을 호출하지 않음
- `FOR UPDATE SKIP LOCKED`와 lease로 다중 worker claim
- 재시도는 같은 device에 고정하고 전송 직전 최신 target 재조회
- 같은 job의 차순위 기기 fallback 없음
- 10초 지수 backoff+jitter, 15분 상한, 6회/1시간 TTL
- 환경별 DB·Firebase project·credential·기기 데이터를 분리
- exactly-once가 아닌 at-least-once를 명시하고 collapse ID+클라이언트 중복 제거 사용

### 근거(왜)

- 도메인 작업과 job 생성 사이 유실 구간을 DB transaction으로 제거
- Firebase 장애가 친구/그룹 API 성공 여부를 직접 결정하지 않음
- `last_seen_at` 기반 한 대 정책으로 중복 노출을 줄이면서 사용자의 현재 기기 변경을 다음 알림부터 반영
- delivery 고정으로 일시 오류 재시도 중 여러 기기에 중복 발송되는 것을 방지
- provider adapter와 `target_type`으로 향후 FID 등 확장 경계를 유지

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 인앱 원본과 push snapshot의 원자성
- lease 만료 복구, retry/TTL/영구 target 비활성화의 명시적 운영 상태
- 환경별 설치/target 유일성과 raw target 비노출
- enqueue/worker 독립 flag를 통한 단계 활성화와 안전한 애플리케이션 rollback

**트레이드오프**:

- worker와 Firebase credential 운영, 신규 테이블/지표가 필요
- FCM 성공 후 DB 반영 전 프로세스 종료 시 중복 가능
- 선택 기기 오류 시 같은 알림을 다른 기기로 보내지 않아 해당 push는 유실될 수 있음
- 고정된 `firebase-admin 13.10.0`의 간접 의존성에 moderate audit advisory가 있으며, 사용자 지정 버전 계약 때문에 14.x 전환은 별도 검증이 필요
- Push Worker까지 Stage/Center 통합 배포·health·rollback 단위에 포함되므로 환경별 service account 파일이 없으면 배포 준비가 실패
- Compose 로컬 file secret은 host bind mount라 image의 non-root `node` 사용자가 읽을 수 있도록 JSON 자체는 `0444`가 필요하며, host 접근 통제는 root 소유 `0700` 상위 디렉터리가 담당

### 구현 위치

- **DB**: `migrations/add_push_notification_support.sql`, `migrations/final_schema.sql`, `schema.drawio`
- **서비스/모델**: `src/services/notificationService.ts`, `src/services/deviceService.ts`, `src/models/UserDevice.ts`, `src/models/PushJob.ts`, `src/models/PushDelivery.ts`
- **Worker/provider**: `src/workers/pushWorker.ts`, `src/services/firebasePushProvider.ts`
- **배포**: `deploy/compose.production.yaml`, `deploy/shiftmate-deploy`, `deploy/stage.deploy.env.example`, `.github/workflows/deploy-production.yml`
- **HTTP/계약**: `src/routes/deviceRoutes.ts`, `src/openapi/deviceOpenApi.json`, `_docs/PUSH_NOTIFICATION_GUIDE.md`

### 추후 과제(언제 다시 평가)

- 실제 운영 중 한 기기 정책으로 중요 알림 유실이 허용되지 않으면 알림별 fan-out 정책을 별도 ADR로 검토
- Firebase Admin 14.x와 Node 호환성 검증 후 audit advisory 해소를 위해 pinned 버전 변경 검토
- FID 기반 전송이 안정화되면 provider adapter와 `target_type`을 확장

---

## ADR-0023: 서버 검증형 Apple 로그인과 계정 삭제 전 이중 feature gate

### 배경(문제)

Flutter에 Apple 로그인 진입점이 준비되어 있지만, Apple authorization code의 짧은 단일 사용 수명, 플랫폼별 client/redirect 차이, nonce/state replay, JWKS 검증, 비공개 relay 이메일, 기존 계정 충돌을 서버 신뢰 경계에서 처리해야 합니다. 또한 앱에서 계정을 만들 수 있으면 App Store 제출 전에 앱 내 계정 삭제와 Apple token revoke가 필요합니다.

### 선택지(대안)

1. 서버가 challenge와 code 교환/JWKS 검증을 담당하고, 로그인 1단계를 비활성 배포한 뒤 계정 삭제/revoke를 2단계로 완료해 이중 gate 활성화
2. Flutter가 identity token만 전달하고 서버가 서명 확인 없이 사용자 정보를 신뢰
3. 기존 이메일 사용자에게 Apple subject를 자동 연결
4. 계정 삭제/revoke 없이 로그인 버튼부터 활성화

### 결정(무엇을 선택)

**서버 검증형 Apple 로그인 1단계를 add-only로 구현하되 `APPLE_AUTH_ENABLED=false`로 배포하고, 계정 삭제/revoke 2단계와 실기기 검증 전에는 Flutter `APPLE_LOGIN_ENABLED`도 활성화하지 않습니다.**

- iOS는 Bundle ID와 redirect 없음, Android는 환경별 Services ID와 exact HTTPS callback을 challenge에 고정
- 32바이트 random state/nonce 원문은 앱에만 반환하고 DB에는 SHA-256 hash만 저장
- 로그인 시작 시 `UPDATE ... RETURNING`으로 challenge를 원자 소비하고 실패해도 되돌리지 않음
- token endpoint는 5초 timeout, 같은 code 자동 재시도 없음
- Apple JWKS RS256, issuer, audience, exp, iat, non-empty sub, raw nonce, verified email을 검증
- token endpoint 결과의 `id_token`을 정본으로 사용하고 client `identity_token`은 선택적 교차 검증
- 같은 검증 이메일의 기존 사용자에게 Apple subject를 자동 연결하지 않고 `ACCOUNT_LINK_REQUIRED`
- 신규 사용자, 기본 템플릿, encrypted OAuth authorization, ShiftMate JWT를 하나의 DB transaction으로 처리
- Apple refresh token은 AES-256-GCM으로 복구 가능하게 저장하고 기존 ShiftMate refresh token hash와 분리
- 최초 `false` 배포는 Apple secret 없는 base Compose로 수행하고, 활성화 직전에 선택적 override로 `.p8`을 API 컨테이너에만 read-only mount하며 cache/push worker에는 제공하지 않음

### 근거(왜)

- code, subject, 이메일, nonce의 신뢰 판정을 앱 변조 경계 밖인 서버에 집중
- 원자 소비로 동시 요청과 replay 중 하나만 Apple 교환에 진입
- Apple code 단일 사용 특성상 네트워크 재시도가 오히려 유효 code를 소모한 불명확 상태를 만들 수 있음
- 검증 이메일만으로 기존 계정을 연결하면 계정 탈취와 공급자 정책 차이를 숨길 수 있음
- 계정 삭제 시 Apple refresh token 원문이 필요하므로 앱 JWT hash 저장소와 다른 암호화 저장 책임이 필요
- 서버와 앱 두 gate를 유지하면 미완성 삭제 경로가 Production 사용자에게 노출되지 않음

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- iOS/Android가 같은 서버 검증·오류·ShiftMate JWT 계약 사용
- raw OAuth credential 비저장과 로그 allowlist로 유출 면적 축소
- add-only DB와 비활성 flag로 이전 API 이미지 롤백 가능
- Apple secret 준비와 무관하게 비활성 서버 이미지를 먼저 배포·회귀 검증 가능
- Stage에서 신규/기존/충돌/replay/callback을 Production 노출 전에 검증 가능

**트레이드오프**:

- `.p8`, 환경별 Services ID/redirect, 영속 AES key의 운영·백업 책임 추가
- Apple upstream 장애 시 로그인은 `502`로 실패하며 자동 재시도하지 않음
- 이메일 충돌 사용자는 향후 별도 계정 연결 UX가 생기기 전 Apple로 로그인할 수 없음
- 계정 삭제/revoke 2단계가 완료될 때까지 구현된 로그인 endpoint와 앱 버튼은 비활성 상태로 유지

### 구현 위치

- **DB**: `migrations/apple_auth_{preflight,postflight}.sql`, `migrations/add_apple_auth_support.sql`, `migrations/rollback_apple_auth_support.sql`
- **서비스/모델**: `src/services/appleService.ts`, `src/models/OAuthLoginChallenge.ts`, `src/models/OAuthAuthorization.ts`
- **HTTP/OpenAPI**: `src/routes/authRoutes.ts`, `src/controllers/authController.ts`, `src/openapi/appleAuthOpenApi.json`
- **배포**: `.env.example`, `deploy/compose{,.apple-auth}.{production,stage}.yaml`, `deploy/shiftmate-deploy`
- **테스트/문서**: `test/appleAuth*.test.cjs`, `_docs/APPLE_SIGN_IN_SERVER_GUIDE.md`

### 추후 과제(언제 다시 평가)

- 2단계에서 실제 데이터 보존·익명화 정책을 확정한 뒤 `DELETE /api/v1/auth/account`와 Apple `/auth/revoke` 구현
- Apple 연결 해제/재연결과 같은 이메일 기존 계정 연결은 재인증 UX·감사 로그를 별도 ADR로 설계
- Stage iOS/Android 실기기와 relay email, 취소, 5분 만료, code replay 검증 완료 후에만 두 feature flag 활성화 승인

## ADR-0023: 서버 검증형 Apple 로그인과 기본 비활성화

### 배경(문제)

클라이언트가 전달한 Apple credential을 신뢰하지 않고 서버가 code와 identity token을 검증해야 하며, replay 방지와 외부 refresh token 보호가 필요합니다.

### 선택지(대안)

1. 서버가 challenge, code 교환, JWKS/claim 검증과 외부 refresh token 암호화를 담당
2. 클라이언트가 검증한 사용자 정보만 서버에 전달
3. 외부 인증 완료 상태를 서버 session에 저장

### 결정(무엇을 선택)

**서버 검증형 Apple 로그인을 구현하고 `APPLE_AUTH_ENABLED=false`를 기본값으로 유지**합니다.

- state/nonce 원문은 저장하지 않고 SHA-256 hash만 저장
- challenge는 만료 시간과 atomic consume으로 재사용 차단
- identity token의 서명, issuer, audience, nonce와 verified email 검증
- 외부 refresh token은 AES-256-GCM 암호문으로 앱 JWT refresh token과 분리
- 동일 이메일 기존 계정은 자동 연결하지 않고 `ACCOUNT_LINK_REQUIRED` 반환
- 신규 사용자와 관련 레코드는 하나의 transaction으로 생성

### 근거(왜)

- 클라이언트 입력 위조와 credential replay를 서버 경계에서 차단
- 외부 refresh token 평문 저장 방지
- 암묵적 이메일 계정 연결로 인한 계정 탈취 위험 제거
- DB 선적용과 애플리케이션 롤백이 가능한 add-only schema 유지

### 결과/영향(좋은 점/트레이드오프)

- Apple 공개키 조회와 외부 token endpoint 장애 처리가 추가됨
- 암호화 키와 private key는 저장소 밖에서 관리해야 함
- 기능 활성화 전 환경변수와 migration 검증이 필요함

### 구현 위치

- `src/services/appleService.ts`
- `src/models/OAuthLoginChallenge.ts`, `src/models/OAuthAuthorization.ts`
- `migrations/add_apple_auth_support.sql`
- `src/openapi/appleAuthOpenApi.json`

### 추후 과제(언제 다시 평가)

- 계정 삭제와 Apple revoke 계약 완료 시 활성화 정책 재검토
- 실제 iOS/Android credential로 end-to-end 검증

---

## ADR-0024: Google ID Token 서버 검증과 이메일 자동 연결 금지

### 배경(문제)

Flutter가 iOS/Android Google 로그인에서 받은 ID Token을 서버로 전달할 수 있지만, 앱이 전달한 사용자 정보나 이메일을 그대로 신뢰하면 issuer·audience·서명·만료·이메일 검증 여부를 서버가 보장할 수 없습니다. 동일 이메일로 이미 가입한 다른 로그인 계정과 Google subject를 자동 연결하는 것도 명시적 재인증 없이 계정 소유권을 합치는 위험이 있습니다.

### 선택지(대안)

1. 서버가 공식 Google 검증 라이브러리로 ID Token을 검증하고 `sub`를 공급자 식별자로 저장하며 이메일 충돌은 별도 계정 연결로 보냄
2. Flutter가 전달한 `sub`, 이메일, 이름, 사진을 서버가 그대로 신뢰
3. 검증된 이메일이 같으면 기존 사용자에 Google subject를 자동 연결
4. 플랫폼별 iOS/Android OAuth Client ID를 서버 audience로 각각 허용

### 결정(무엇을 선택)

**`POST /api/v1/auth/google/token`에서 Google ID Token을 서버가 검증하고, 단일 Web OAuth Client ID를 audience로 사용하며, 같은 이메일의 기존 계정은 자동 연결하지 않습니다.**

- `google-auth-library` singleton의 `verifyIdToken()`으로 서명·issuer·audience·만료를 검증
- `email_verified === true`, 정규화된 이메일, non-empty `sub`만 수용
- 서버 `GOOGLE_SERVER_CLIENT_ID`에는 Flutter의 `serverClientId`와 같은 Web OAuth Client ID를 설정
- `users.google_id` nullable partial unique index를 공급자 subject의 정본으로 사용
- 기존 Google 사용자는 저장된 이름·프로필 사진을 로그인 때 자동 갱신하지 않음
- 같은 이메일의 Google 미연결 사용자는 고정 `ACCOUNT_LINK_REQUIRED` 409 응답
- 신규 사용자·기본 근무 템플릿·ShiftMate JWT 발급을 한 DB transaction에서 수행하고 subject advisory lock과 unique recovery로 동시 가입을 단일화
- `GOOGLE_AUTH_ENABLED=false`를 기본값으로 두고 DB migration·Stage E2E 후에만 활성화
- 서버에는 Google API key·OAuth client secret·`google-services.json`을 요구하지 않음

### 근거(왜)

- 토큰 신뢰 판정을 변조 가능한 앱 경계 밖의 서버에 집중
- Web OAuth Client ID 하나를 backend audience로 고정해 iOS/Android가 같은 서버 계약 사용
- Google `sub`를 이메일과 분리된 불변 공급자 식별자로 사용
- 자동 이메일 연결을 금지해 다른 인증 방식 계정의 재인증 절차를 생략하지 않음
- add-only nullable schema와 기본 false flag로 기존 인증 경로 및 이전 이미지 롤백을 유지

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 위조·잘못된 audience·만료 token과 미검증 이메일을 서버에서 거부
- iOS/Android가 동일한 응답·오류·ShiftMate JWT 계약 사용
- 동시 최초 로그인에도 사용자와 기본 템플릿이 중복 생성되지 않음
- OAuth 설정이 준비되지 않은 환경은 명시적 503으로 안전하게 비활성 유지

**트레이드오프**:

- Google 공개 인증서 조회 장애 시 신규 token 검증이 503으로 실패할 수 있음
- 이메일 충돌 사용자는 향후 별도 계정 연결 UX 전까지 Google로 로그인할 수 없음
- Google Cloud에서 Web/iOS/Android OAuth Client를 환경에 맞게 만들고 Android signing fingerprint를 관리해야 함

### 구현 위치

- **DB**: `migrations/google_auth_{preflight,postflight}.sql`, `migrations/add_google_auth_support.sql`, `migrations/rollback_google_auth_support.sql`, `migrations/{stage,center}_google_auth_apply_pgadmin.sql`, `migrations/final_schema.sql`
- **서비스/모델**: `src/services/googleService.ts`, `src/models/User.ts`
- **HTTP/OpenAPI**: `src/routes/authRoutes.ts`, `src/controllers/authController.ts`, `src/openapi/googleAuthOpenApi.json`
- **환경/로그**: `src/config/environment.ts`, `.env.example`, `src/utils/logger.ts`
- **테스트/문서**: `test/googleAuth*.test.cjs`, `_docs/GOOGLE_SIGN_IN_SERVER_GUIDE.md`

### 추후 과제(언제 다시 평가)

- 명시적 재인증과 감사 로그를 포함한 공급자 계정 연결/해제 UX가 확정되면 `ACCOUNT_LINK_REQUIRED` 이후 흐름을 별도 ADR로 설계
- Stage의 iOS/Android release 서명 실기기에서 신규·기존·충돌·취소·만료 token 검증이 완료된 뒤 환경별 flag 활성화 승인
  Flutter가 전달하는 Google ID Token의 진위를 서버가 확인하고 기존 ShiftMate JWT로 교환해야 하며, 같은 이메일의 기존 계정을 자동 연결할지 결정해야 합니다.

### 선택지(대안)

1. 공식 라이브러리로 ID Token을 검증하고 Google `sub`를 식별자로 저장
2. 클라이언트가 전달한 이메일과 프로필을 신뢰
3. 이메일이 같으면 기존 계정에 자동 연결

### 결정(무엇을 선택)

**`google-auth-library`로 ID Token을 검증하고 검증된 `sub`를 `users.google_id`에 저장하며 이메일 자동 연결은 금지**합니다.

- 서명, issuer, 고정 Web client audience, 만료, verified email 검증
- subject 기준 advisory transaction lock으로 동시 신규 가입 직렬화
- 신규 사용자, 기본 템플릿과 refresh token을 한 transaction으로 생성
- 동일 이메일 기존 계정은 `ACCOUNT_LINK_REQUIRED` 반환
- `GOOGLE_AUTH_ENABLED=false`를 기본값으로 유지

### 근거(왜)

- 사용자 식별을 변경 가능한 이메일이 아니라 공급자 subject에 고정
- 공식 검증 라이브러리로 공개키와 claim 검증 오류를 일관되게 처리
- 명시적 계정 연결 절차 없이 기존 계정에 접근하는 위험 방지

### 결과/영향(좋은 점/트레이드오프)

- 사용자는 동일 이메일 계정 충돌 시 별도 연결 절차가 필요함
- 서버 시작 시 활성화된 환경의 Web client ID 형식을 검증함
- nullable 컬럼과 partial unique index가 추가됨

### 구현 위치

- `src/services/googleService.ts`
- `src/models/User.ts`
- `migrations/add_google_auth_support.sql`
- `src/openapi/googleAuthOpenApi.json`

### 추후 과제(언제 다시 평가)

- 명시적 재인증 기반 계정 연결 기능 설계
- 실제 모바일 client와 end-to-end 검증

---

## ADR-0025: 비동기 회원 탈퇴 worker와 사용자 데이터 물리 삭제

### 배경(문제)

현재 `users`를 참조하는 대부분의 FK는 cascade가 아니고, 그룹 감사 컬럼과 다른 사용자의 알림 JSON snapshot도 탈퇴자를 참조합니다. 또한 Apple revoke와 Kakao unlink는 외부 HTTP라 DB transaction에 포함할 수 없고 Redis 근무표 cache도 PostgreSQL 삭제로 자동 제거되지 않습니다. 단순 사용자 row 삭제나 장시간 동기 HTTP 요청으로는 완전성·재시도·다중 인스턴스 멱등성을 동시에 보장할 수 없습니다.

### 선택지(대안)

1. 사용자 row만 soft delete하고 관련 데이터는 유지
2. HTTP 요청 하나에서 외부 revoke, 모든 DB 삭제와 Redis purge를 동기 처리
3. PostgreSQL 삭제 요청/공급자 task와 lease worker를 사용해 외부 revoke → DB 물리 삭제 → Redis purge를 단계 처리
4. 외부 revoke 성공 여부와 관계없이 즉시 모든 내부 row를 삭제

### 결정(무엇을 선택)

**3번을 선택합니다. 계정을 즉시 사용 불가 상태로 전환한 뒤 전용 worker가 외부 공급자 처리, DB 물리 삭제, Redis purge를 멱등 수행합니다.**

- 접수는 `202 Accepted`, 동일 사용자 active request는 1건만 허용
- Access/Refresh JWT의 최초 `auth_time`을 사용해 10분 이내 최근 재인증 요구
- 접수 transaction에서 `DELETION_PENDING`, Refresh Token revoke와 기기 비활성 처리
- Apple은 저장된 encrypted refresh token으로 `/auth/revoke`, Kakao는 Admin Key와 `kakao_id`로 unlink
- Google/Naver는 현재 서버가 revoke token을 보유하지 않으므로 클라이언트 disconnect와 내부 삭제를 분리
- 사용자 소유 row는 물리 삭제하고 감사자 FK는 nullable `ON DELETE SET NULL`
- 그룹 OWNER는 ADMIN 우선, 그다음 가입이 가장 빠른 MEMBER에게 자동 승계하고 1인 그룹은 삭제
- 알림/push JSON snapshot과 Redis 사용자 월 cache까지 제거한 뒤 완료
- 완료된 작업은 `user_id`를 제거한 최소 운영 상태만 30일 보관

### 근거(왜)

- PostgreSQL 원본에 작업 상태를 남겨 API 응답 유실과 worker 재시작에도 재개 가능
- 외부 네트워크 호출로 업무 transaction과 row lock을 오래 점유하지 않음
- 기존 cache/push worker와 같은 lease·재시도 운영 패턴을 재사용 가능
- Apple이 허용하는 비동기 삭제 안내와 token revoke 요구를 함께 충족
- 그룹 소유권 때문에 사용자의 전체 계정 삭제 권리가 막히지 않음
- 단순 anonymization이 아니라 사용자 생성 콘텐츠를 포함한 실제 물리 삭제를 명시

### 결과/영향(좋은 점/트레이드오프)

**좋은 점**:

- 공급자·Redis 일시 장애에도 요청을 잃지 않고 재시도
- 일반 API는 접수 직후 차단되어 7일 Access Token 잔존 문제 해소
- FK, JSON snapshot, cache까지 삭제 범위를 정적·통합 테스트로 고정
- 동일 요청과 외부 revoke를 멱등 처리

**트레이드오프**:

- 신규 DB 테이블·상태 컬럼·전용 worker와 운영 지표가 필요
- 그룹 감사 FK nullable 변경으로 일부 API DTO가 `string | null` behavior change를 가짐
- Google/Naver의 중앙 revoke는 현재 token 저장 구조로 지원할 수 없어 클라이언트 협력이 필요
- 완료된 물리 삭제는 애플리케이션 rollback으로 복구할 수 없음

### 구현 위치

- 설계 정본: `_docs/ACCOUNT_DELETION_SERVER_DESIGN.md`
- DB: `migrations/{account_deletion_preflight,add_account_deletion_support,account_deletion_postflight,rollback_account_deletion_support}.sql`, `migrations/final_schema.sql`
- 코드: `src/services/accountDeletion*.ts`, `src/workers/accountDeletionWorker.ts`, 인증 route/controller/model/OpenAPI
- 연계 코드: `src/services/appleService.ts`, `src/services/authService.ts`, `src/middlewares/auth.ts`, `src/services/workShiftMonthCacheService.ts`

### 추후 과제(언제 다시 평가)

- Production 활성 전 개인정보 보존 의무와 완료 SLA를 제품·법무에서 확정
- Google/Naver도 서버 중앙 revoke가 필요해지면 provider token 암호화 저장과 기존 사용자 재동의를 별도 ADR로 설계
- Stage Apple/Kakao 실제 계정, Redis 장애와 worker crash E2E를 통과한 뒤에만 환경별 endpoint와 Apple 로그인 gate 활성화

---

## ADR-0026: Apple·Google 로그인 서버 feature flag 제거

### 배경(문제)

Apple 계정 삭제/revoke와 Google 서버 검증 구현이 완료된 뒤에도 `APPLE_AUTH_ENABLED`, `GOOGLE_AUTH_ENABLED`가 남아 있어 환경별 boolean 값과 런타임 활성 상태가 어긋날 수 있었습니다.

### 선택지(대안)

1. 두 boolean feature flag 유지
2. 기본값만 `true`로 변경
3. 두 flag를 제거하고 필수 OAuth 설정을 서버 시작 전에 항상 검증

### 결정(무엇을 선택)

**3번을 선택합니다. Apple·Google 로그인 endpoint는 항상 활성화하고 `.env` boolean 토글을 사용하지 않습니다.**

- Google은 `GOOGLE_SERVER_CLIENT_ID`를 항상 필수 검증
- Apple API는 Team/Key/Client/redirect, `.p8`, 32바이트 encryption key를 항상 필수 검증
- Apple `.p8`은 Stage/Center base Compose에서 API 컨테이너에만 mount
- 배포 스크립트는 boolean 값을 파싱하지 않고 두 환경의 `.p8` 존재·권한을 항상 확인
- 긴급 차단은 feature flag가 아니라 프록시/WAF 또는 이전 이미지 rollback으로 수행

### 근거(왜)

- 배포 설정과 런타임 활성 상태를 하나로 고정해 `true` 문자열 파싱 및 override 누락 실패를 제거
- 잘못 구성된 OAuth를 요청 시점까지 숨기지 않고 시작 전 명확히 실패
- 인증 API 계약에서 도달 불가능한 `*_AUTH_DISABLED` 응답 제거

### 결과/영향(좋은 점/트레이드오프)

- `.env`에 `APPLE_AUTH_ENABLED`, `GOOGLE_AUTH_ENABLED`가 필요하지 않음
- 모든 API 실행 환경에 Apple secret과 Google client ID가 준비되어야 함
- OAuth만 즉시 끄는 애플리케이션 토글은 사라지므로 긴급 차단 절차를 운영 계층에서 수행해야 함

### 구현 위치

- `src/config/environment.ts`
- `src/services/{appleService,googleService}.ts`
- `deploy/compose.{production,stage}.yaml`, `deploy/shiftmate-deploy`
- `src/openapi/{appleAuthOpenApi,googleAuthOpenApi}.json`

### 추후 과제(언제 다시 평가)

- 공급자 장기 장애로 운영 계층 차단이 반복되면 별도 circuit breaker 정책을 검토

---

## ADR-0027: 비정상 Stage를 새 이미지로 복구할 수 있는 배포 사전검사

### 배경(문제)

통합 배포 스크립트가 이미지 pull과 Stage 재생성 전에 기존 `127.0.0.1:3201` readiness를 최대 60초 검사하고 실패 즉시 종료했습니다. 따라서 Stage API가 이미 중지되었거나 시작 실패 상태이면 정상적인 새 이미지가 있어도 복구 배포를 시작할 수 없었고, 로그에는 반복된 `curl` 연결 실패만 남았습니다.

### 선택지(대안)

1. 기존 Stage readiness를 계속 필수 사전 조건으로 유지하고 운영자가 수동 복구한 뒤 재배포
2. 기존 Stage readiness 검사를 완전히 제거
3. 기존 Stage readiness는 단일 진단 검사로 유지하되 실패 시 컨테이너 상태·최근 로그를 남기고 새 이미지 배포를 계속하며, 적용 후 Stage 검증은 필수 gate로 유지

### 결정(무엇을 선택)

**3번을 선택합니다. 기존 Stage 장애는 새 이미지 복구를 차단하지 않지만, 새 Stage API와 두 worker의 검증 실패는 계속 전체 배포를 중단합니다.**

- 배포 시작 시 기존 Stage readiness를 한 번 확인
- 실패하면 Stage API의 Compose 상태와 최근 200줄 로그를 배포 로그에 기록
- GHCR digest 확인, Redis health, 새 Stage API/cache worker/push worker 재생성을 계속 수행
- 새 Stage readiness 또는 worker health 실패 시 기존 image override와 해당 컨테이너를 복원
- 이전 Stage 자체가 이미 unhealthy였으면 복원 health 경고를 명시하고 Center 전환은 수행하지 않음

### 근거(왜)

- 기존 Stage 상태는 배포 전제조건이 아니라 새 버전 검증 대상 환경의 현재 상태임
- 신규 digest 적용 후의 readiness와 worker health가 실제 배포 안전성을 판단하는 신뢰 가능한 gate임
- 기존 상태·로그를 먼저 남겨 포트 미바인딩과 서버 시작 오류를 구분할 수 있음
- Center Blue/Green 전환은 새 Stage 검증 뒤에만 실행되므로 Production 보호 경계는 유지됨

### 결과/영향(좋은 점/트레이드오프)

- Stage가 내려간 상태에서도 정상 새 이미지로 자동 복구 가능
- 반복된 60초 `curl` 오류 대신 즉시 컨테이너 상태와 서버 시작 오류 확인 가능
- 새 이미지도 실패하면 기존의 이미 비정상인 Stage로 복원될 수 있으므로 운영자가 로그 원인을 별도로 해결해야 함

### 구현 위치

- `deploy/shiftmate-deploy`
- `test/deploymentCacheRollout.test.cjs`
- `_docs/CI_CD_DEPLOYMENT_GUIDE.md`, `deploy/DEPLOY_README.md`

### 추후 과제(언제 다시 평가)

- Stage 고가용성 또는 별도 Blue/Green이 필요해지면 단일 3201 재생성 구조를 재평가

---

## ADR-0028: 고정 root launcher와 main 정본 배포 엔진 자동 반영

### 배경(문제)

기존 self-hosted deploy job은 저장소를 checkout하지 않고 홈서버의 root 소유 `/usr/local/sbin/shiftmate-deploy`를 직접 실행했습니다. 애플리케이션 main과 GHCR 이미지는 자동 반영됐지만 배포 엔진 변경은 별도 수동 설치가 필요해, Stage 복구 수정이 main에 있어도 홈서버에서 구버전 엔진이 계속 실행됐습니다.

### 선택지(대안)

1. 배포 엔진을 계속 홈서버에 고정하고 변경 때마다 수동 설치
2. self-hosted runner가 checkout한 저장소 스크립트를 제한 없이 직접 sudo 실행
3. root 소유 고정 launcher만 sudoers에 허용하고, launcher가 exact main checkout과 배포 엔진 blob을 검증한 뒤 root 임시 복사본으로 실행

### 결정(무엇을 선택)

**3번을 선택하고 main push를 자동 배포 trigger로 추가합니다.**

- GitHub-hosted build와 self-hosted deploy job이 같은 `github.sha`를 checkout
- launcher는 `hspark-1/shift_calendar_server-deploy`, actor `hspark-1`, `/opt/actions-runner/_work`의 고정 workspace만 허용
- source SHA, Git HEAD, `deploy/shiftmate-deploy`의 tree mode `100755`와 blob hash를 검증
- 일반 deploy에서는 GHCR image tag SHA와 source SHA 일치를 추가 강제
- rollback에서는 현재 main의 검증된 배포 엔진으로 입력한 과거 SHA 이미지를 배포
- 검증 후 `/run`의 root 전용 임시 복사본과 초기화한 환경으로 배포 엔진 실행
- sudoers는 launcher만 허용하고 저장소 스크립트 직접 sudo 실행은 허용하지 않음
- main PR은 `Validate main / validate`에서 build·정적 계약·Bash·sudoers·YAML·문서 동기화를 통과해야 merge 가능

### 근거(왜)

- main의 배포 엔진 변경이 이미지 배포와 같은 커밋 단위로 자동 반영됨
- runner workspace 파일의 경로·소유자·Git object 일치를 확인하고 root 실행 전 별도 복사해 단순 경로 바꿔치기와 실행 중 변경 범위를 줄임
- 고정 launcher는 최초 1회 설치 후 일상적으로 변경하지 않는 홈서버 trust anchor로 유지
- rollback 동작은 과거의 잠재적으로 오래된 배포 엔진이 아니라 현재 main의 복구 로직을 사용

### 결과/영향(좋은 점/트레이드오프)

- `deploy/shiftmate-deploy` 변경 후 홈서버 수동 동기화가 필요하지 않음
- main push가 앱과 배포 엔진을 자동 배포하므로 장애 수정 반영 시간이 단축됨
- main의 배포 스크립트는 검증 후 root로 실행되므로 main branch와 workflow 변경 권한이 홈서버 root trust boundary에 포함됨
- main 직접 push 제한, PR·필수 status check와 `deploy/**`·workflow 별도 검토가 필수 운영 통제가 됨
- launcher 또는 sudoers 자체 변경에는 의도적으로 홈서버 최초/예외 설치가 필요함

### 구현 위치

- `deploy/shiftmate-deploy-launcher`
- `deploy/sudoers/github-runner-shiftmate`
- `.github/workflows/{deploy-production,rollback-production}.yml`
- `.github/workflows/validate-main.yml`
- `test/deploymentCacheRollout.test.cjs`

### 추후 과제(언제 다시 평가)

- GitHub artifact attestation 또는 commit 서명을 필수화할 때 launcher의 provenance 검증 확장
- runner 설치 경로나 repository 이름 변경 시 고정 workspace 계약을 명시적으로 migration

---

## ADR-0029: exact main base Compose 자동 동기화와 통합 rollback

> 상태: base Compose 결정은 유지하며, feature flag config와 동일 `.env` key 정리는 ADR-0030으로 배포 bundle을 확장합니다.

### 배경(문제)

ADR-0028은 main의 배포 엔진을 자동 반영했지만 Stage/Center base Compose는 운영자가 별도로 설치하는 정책을 유지했습니다. Apple secret mount가 main Compose에는 있어도 홈서버 실행 파일에는 없어 API가 재시작한 사례처럼, 저장소 정본과 `/opt/shiftmate{,-stage}/compose.yaml`의 불일치가 main push 자동 배포를 깨뜨렸습니다.

### 선택지(대안)

1. base Compose 변경마다 운영자가 두 파일을 수동 설치
2. self-hosted runner checkout 파일을 검증 없이 root 운영 경로로 복사
3. 고정 launcher가 exact commit의 배포 엔진과 두 Compose mode/blob을 함께 검증해 root 임시 번들로 만들고, 배포 엔진이 문법·필수 서비스를 검증한 뒤 원자 설치하며 전체 실패 시 직전 파일을 복원

### 결정(무엇을 선택)

**3번을 선택합니다.**

- launcher는 `deploy/shiftmate-deploy`의 `100755`와 `deploy/compose.{production,stage}.yaml`의 `100644` tree mode 및 blob hash를 source SHA 기준으로 검증
- 검증된 세 파일만 `/run/shiftmate-deploy.*` root 전용 임시 번들로 복사하고 초기화한 환경에서 배포 엔진 실행
- 배포 엔진은 Center source를 두 profile과 `/opt/shiftmate` project directory로, Stage source를 `/opt/shiftmate-stage` project directory로 `docker compose config --quiet` 검증
- 기존 두 base Compose를 백업하고 target directory의 임시 파일에서 `root:root 0644`로 설치한 뒤 `mv`로 원자 교체
- Center blue/green 전체 API·worker·Redis와 Stage 네 서비스 존재를 적용 전에 강제
- 배포 실패 시 새 구성으로 시작한 target/Stage 서비스를 먼저 중지하고 두 base Compose, Stage image override, 상태와 upstream을 직전 상태로 복원
- `.env`, `.deploy.env`, Firebase/Apple `secrets/`와 DB migration은 자동 쓰기 범위에서 제외
- rollback workflow도 현재 main의 검증된 base Compose를 사용하며, 과거 이미지는 현재 운영 구성과 하위 호환되어야 함

### 근거(왜)

- main commit 하나가 애플리케이션 이미지, 배포 엔진과 실제 실행 Compose의 정본이 됨
- runner workspace의 임의 파일을 root로 신뢰하지 않고 Git object 일치 검증과 root 임시 복사를 거침
- Compose가 secret 값이 아니라 mount·서비스 topology만 관리하므로 환경별 secret을 보존하면서 자동화 가능
- base Compose 변경과 애플리케이션 변경을 같은 배포 rollback 경계에 포함해야 부분 적용을 방지할 수 있음

### 결과/영향(좋은 점/트레이드오프)

- 이후 두 Compose 변경에는 홈서버 수동 `install`이 필요하지 않음
- 문법 오류, profile/서비스 누락은 컨테이너 변경 전에 중단됨
- Stage 또는 Center 검증 실패 시 저장소의 새 Compose도 적용 전 파일로 되돌아감
- launcher trust boundary가 두 Compose까지 확장되므로 이번 기능을 활성화하려면 고정 launcher를 홈서버에 마지막으로 1회 갱신해야 함
- rollback에서 현재 main Compose와 과거 이미지의 호환성을 유지해야 하며 breaking Compose 변경은 expand/contract 순서를 따라야 함

### 구현 위치

- `deploy/shiftmate-deploy-launcher`
- `deploy/shiftmate-deploy`
- `test/deploymentCacheRollout.test.cjs`
- `_docs/CI_CD_DEPLOYMENT_GUIDE.md`, `deploy/DEPLOY_README.md`

### 추후 과제(언제 다시 평가)

- base Compose 이외 Nginx snippet까지 같은 정본 동기화 경계에 포함할 필요가 생길 때 별도 검증·rollback 정책을 설계
- GitHub artifact attestation 또는 서명 검증을 도입할 때 세 파일 bundle provenance로 확장

---

## ADR-0030: 환경별 feature flag config를 Git 배포 정본으로 관리

### 배경(문제)

Stage/Center의 cache, push, API docs, 회원 탈퇴 활성 플래그를 홈서버 `.env`에서 직접 수정하면 환경·프로세스 간 값 누락, 오타, 적용 대상 재생성 누락과 변경 이력 부재가 발생할 수 있습니다. base Compose와 배포 엔진은 main에서 자동 반영되지만 기능 활성 상태만 홈서버 수동 파일에 남아 배포 commit과 런타임 상태가 분리되어 있었습니다.

### 선택지(대안)

1. 기존처럼 홈서버 `.env`를 직접 수정
2. 애플리케이션 TypeScript 상수로 모든 환경의 flag를 고정
3. 비밀값 없는 Stage/Production flag config를 Git에서 분리 관리하고 exact commit 배포·검증·rollback 경계에 포함

### 결정(무엇을 선택)

**3번을 선택합니다.**

- `deploy/config/feature-flags.production.env`, `feature-flags.stage.env`를 환경별 정본으로 사용
- 관리 key는 `WORK_SHIFT_CACHE_ENABLED`, `PUSH_JOB_ENQUEUE_ENABLED`, `PUSH_WORKER_ENABLED`, `API_DOCS_ENABLED`, `ACCOUNT_DELETION_ENABLED`, `ACCOUNT_DELETION_WORKER_ENABLED` 6개로 제한
- 각 값은 exact lowercase `true` 또는 `false`만 허용하고 누락·중복·미등록 key를 배포 전에 거절
- launcher가 source SHA의 두 config mode/blob을 검증해 root 임시 bundle에 포함
- 배포 엔진이 Compose보다 먼저 `feature-flags.env`를 원자 설치하고 API/worker를 같은 배포에서 재생성
- 최초 전환 때 기존 `.env`의 동일 key line만 자동 제거해 이중 정본을 없애고, 실패 시 정리 전 `.env`와 직전 config를 복원
- secret, URL, credential, 수치형 tuning 값은 계속 홈서버 `.env`에서 관리

### 근거(왜)

- flag 변경을 PR 리뷰, commit 이력, CI 정적 검증과 Stage → Center 배포 절차에 포함할 수 있음
- Stage와 Production 값을 분리하면서도 API와 worker가 같은 환경 config를 공유해 프로세스별 누락을 방지
- TypeScript 상수로 고정하지 않아 환경별 rollout과 enqueue → worker 같은 두 commit 단계 활성화를 유지
- 기존 배포 실패 복원 경계에 config와 `.env` 정리를 포함해 부분 적용을 방지

### 결과/영향(좋은 점/트레이드오프)

- 이후 운영 flag 변경에 홈서버 접속·`sudoedit`이 필요하지 않음
- config-only 변경도 현재 파이프라인 특성상 새 commit SHA 이미지 build와 Stage/Center 전체 검증을 거침
- 첫 적용 commit의 값이 현재 홈서버 값보다 우선하므로 merge 전에 환경별 원하는 상태를 config에서 명시적으로 검토해야 함
- 긴급 flag 변경도 main 배포 경로를 사용하며 GitHub Actions 자체가 불가한 경우에는 별도 수동 복구 절차가 필요함

### 구현 위치

- `deploy/config/feature-flags.{production,stage}.env`
- `deploy/compose.{production,stage}.yaml`
- `deploy/shiftmate-deploy-launcher`, `deploy/shiftmate-deploy`
- `test/deploymentCacheRollout.test.cjs`
- `_docs/CI_CD_DEPLOYMENT_GUIDE.md`, `deploy/DEPLOY_README.md`

### 추후 과제(언제 다시 평가)

- flag별 승인자 또는 예약 활성화가 필요해지면 config schema와 workflow environment approval을 확장
- 이미지 rebuild 없는 config-only 배포가 필요해지면 동일 검증 bundle을 사용하는 별도 workflow를 설계하되 현재 Stage/Center health gate는 유지

---

## ADR-0031: 회원 탈퇴 worker를 config 제어 배포 topology에 포함

### 배경(문제)

회원 탈퇴 API와 worker 플래그는 환경별 Git config에 포함되어 있었지만 Stage/Center Compose와 Blue/Green 배포 대상에는 전용 worker가 없었습니다. 따라서 config에서 worker를 활성화해도 실제 처리 프로세스가 실행되지 않아 접수된 계정 삭제가 `PENDING`에 머무를 수 있었습니다.

### 선택지(대안)

1. API 프로세스 안에서 회원 탈퇴 polling도 함께 실행
2. 운영자가 홈서버에서 worker 컨테이너를 수동 실행
3. Stage와 Center 색상별 전용 worker를 base Compose·health gate·rollback 범위에 포함하고 환경별 config로 실행 여부를 제어

### 결정(무엇을 선택)

**3번을 선택합니다.**

- Stage에 회원 탈퇴 worker 1개, Center Blue/Green에 색상별 1개를 추가
- API·cache·push worker와 동일한 불변 image digest로 배포
- Apple revoke용 `.p8` secret과 worker 전용 `DB_POOL_MAX=2`를 Compose에서 주입
- worker flag가 꺼져도 프로세스는 idle 상태로 배포하고 PostgreSQL·Redis 연결 health를 유지
- worker flag가 켜지면 health에서 탈퇴 테이블과 `users` 탈퇴 컬럼까지 검증
- `ACCOUNT_DELETION_ENABLED=true`인데 worker flag가 `false`인 config는 배포 전 거절
- 최초 도입 배포 실패 시 직전 Compose에 없던 신규 worker 컨테이너를 제거하고 기존 topology로 복원
- main 이미지 build 전에 회원 탈퇴 PostgreSQL 통합 테스트를 실행

### 근거(왜)

- API 접수와 비동기 purge 실행을 분리해 외부 provider 장애와 장시간 삭제가 API 요청 시간을 점유하지 않음
- Git config 변경만으로 Stage/Production의 활성 상태를 감사 가능한 commit 단위로 제어
- API만 켜져 삭제 요청이 처리되지 않는 구성 오류를 사전에 차단
- 기존 Stage 우선·Center Blue/Green health/rollback 경계를 그대로 재사용

### 결과/영향(좋은 점/트레이드오프)

- 두 flag가 `false`인 현재 config에서는 탈퇴 기능은 계속 비활성이고 worker는 idle 상태
- 활성화 전 `add_account_deletion_support.sql`, worker 전용 `KAKAO_ADMIN_KEY_FILE`, Apple/Redis/DB 설정이 필수
- 배포 서비스 수는 Stage 5개, Center 전체 profile 기준 13개로 증가
- 이전 image가 신규 worker command를 포함하지 않는 시점으로 rollback할 때는 현재 Compose와 image 호환성을 확인해야 함

### 구현 위치

- `deploy/compose.{production,stage}.yaml`
- `deploy/shiftmate-deploy`, `deploy/stage.deploy.env.example`
- `src/workers/accountDeletionWorker.ts`
- `.github/workflows/deploy-production.yml`
- `test/{deploymentCacheRollout,appleAuth}.test.cjs`

### 추후 과제(언제 다시 평가)

- 탈퇴 처리량 또는 provider rate limit 때문에 병렬도 분리가 필요해질 때 환경별 replica·batch 설정을 재평가

---

## ADR-0032: 환경별 Kakao 앱과 SDK Access Token 서버 검증 단일화

### 배경(문제)

Flutter는 Kakao Native SDK의 Access Token만 서버에 전달하지만 서버는 `user/me`만 호출해 토큰 발급 앱을 고정하지 않았고, 사용자·기본 템플릿·Refresh Token 생성도 단일 transaction이 아니었습니다. 또한 Kakao Admin Key가 공용 `.env`를 통해 API와 다른 worker에도 노출될 수 있었습니다.

### 선택지(대안)

1. 기존 Web authorization-code와 SDK 경로를 영구 병행
2. SDK token을 사용자 정보 조회만으로 신뢰
3. Stage/Production Kakao 앱을 분리하고 token info의 app ID·회원번호를 검증한 뒤 SDK 경로로 단일화

### 결정(무엇을 선택)

**3번을 선택합니다.**

- 현재 앱은 Production 정본으로 유지하고 신규 Stage Kakao 앱을 사용
- `access_token_info.app_id`와 `KAKAO_APP_ID`, token info와 `user/me`의 회원번호를 DB 접근 전에 검증
- Kakao 사용자 연결, 기본 템플릿, ShiftMate Refresh Token을 advisory lock과 단일 transaction으로 처리
- 기존 이메일의 다른 `kakao_id`는 덮어쓰지 않고 `409 KAKAO_ACCOUNT_CONFLICT`로 거부
- 성공 HTTP 200을 유지하면서 `request_id`, `is_new_user`를 추가
- Admin Key는 account-deletion worker 전용 Docker secret 파일로만 제공
- Web 경로는 1차 배포 후 Stage/Production 7일 무사용을 확인한 다음 별도 2차 배포에서 제거

### 근거(왜)

- 다른 Kakao 앱의 유효 토큰으로 ShiftMate 계정을 생성·연결하는 경계를 차단
- Stage 탈퇴 E2E가 Production 앱 연결과 토큰을 끊는 위험을 제거
- 부분 사용자·템플릿·세션 생성을 rollback하고 동시 로그인 중복을 방지
- Admin Key의 최소 권한·최소 노출 범위를 컨테이너 topology에서 강제

### 결과/영향(좋은 점/트레이드오프)

- API 시작에 환경별 숫자형 `KAKAO_APP_ID`가 필수
- Stage 앱 전환 전에 미완료 Kakao 탈퇴 task 0건, 복원 백업, `users.kakao_id` 초기화가 필요
- 1차 배포 동안 레거시 client ID/secret/redirect 설정과 Web 코드가 일시적으로 남음
- 2차 제거는 7일 무사용 운영 증거 없이는 진행하지 않음

### 구현 위치

- `src/services/kakaoService.ts`, `src/controllers/authController.ts`
- `src/openapi/kakaoAuthOpenApi.json`

### 추후 과제(언제 다시 평가)

- 7일 무사용 증거 확보 후 ADR 상태를 완료로 갱신하고 레거시 Web 경로·환경변수·테스트 페이지를 제거

---

## ADR-0033: 가입 완료 정본과 S3 호환 프로필 이미지 저장

> 저장소의 Stage·Center 분리 방식은 후속 ADR-0034가 대체합니다.

### 배경(문제)

OAuth의 `is_new_user`는 해당 로그인 요청에서 계정을 생성했는지만 나타내므로 앱을 종료한 미완료 사용자의 가입 화면을 복구할 수 없습니다. 서버에는 multipart parser와 영속 이미지 저장소도 없어 Flutter가 보낸 파일을 처리할 수 없습니다.

### 선택지(대안)

1. `is_new_user`를 계속 화면 분기 정본으로 사용하고 이미지는 URL 문자열만 받음
2. 필수 필드 존재 여부를 로그인마다 계산하고 API 컨테이너 로컬 디스크에 이미지 저장
3. `profile_completed_at`을 영속 정본으로 두고 S3 호환 object storage에 검증된 이미지를 UUID key로 저장

### 결정(무엇을 선택)

**3번을 선택합니다.**

- `profile_completed_at IS NULL`만 `requires_profile_setup` 계산 정본으로 사용
- 최초 완료는 `/auth/profile/complete`의 row lock·단일 DB transaction만 담당하며 재전송은 기존 완료 시각 유지
- 일반 `/auth/profile` 편집은 완료 시각을 생성하지 않음
- JPEG/PNG/WebP 1개, 5MB, MIME·magic/컨테이너 구조 일치를 메모리 parser에서 검증
- 환경별 S3 호환 bucket과 CDN HTTPS base URL을 사용하고 원본 파일명은 저장 key에 사용하지 않음
- object 업로드 뒤 DB 실패 시 새 object를 삭제하고 전화번호 unique 경쟁은 409로 반환
- `phone`, `workplace`는 본인 인증/프로필 응답 외 친구·그룹 응답에 공개하지 않음

### 근거(왜)

- 가입 재개 상태를 로그인 공급자와 앱 프로세스 수명에서 분리
- API 컨테이너 교체·Blue/Green 배포와 무관한 영속 URL 보장
- 파일 내용·크기와 PII 노출 경계를 서버에서 일관되게 강제

### 결과/영향(좋은 점/트레이드오프)

- API 시작 전에 환경별 bucket/region/public base URL과 storage 접근 권한이 필요
- object 저장과 DB가 분산 transaction이므로 DB 실패 삭제가 실패하면 운영 정리 대상 orphan이 남을 수 있어 구조화 오류 로그를 감시해야 함
- 기존 `is_new_user`는 호환 필드로 남지만 화면 분기 정본이 아님

### 구현 위치

- `src/services/{profileService,profileImageStorageService}.ts`
- `src/middlewares/profileImageUpload.ts`, `src/openapi/profileAuthOpenApi.json`
- `migrations/*profile_completion*`, `test/profileCompletion*.test.cjs`

### 추후 과제(언제 다시 평가)

- orphan 발생이 관측되면 object tag 또는 outbox 기반 정리 worker를 추가
- CDN signed URL이나 이미지 변환 요구가 생기면 현재 public immutable URL 정책을 재평가

---

## ADR-0034: 단일 프로필 이미지 버킷과 환경별 prefix 권한 격리

### 배경(문제)

최초 설계는 Stage와 Center가 별도 S3 버킷을 사용하는 방식이었으나 운영자는 하나의 버킷을 공유하기로 결정했습니다. 버킷 태그는 버킷 전체에 적용되므로 한 버킷 안의 Stage 객체와 Center 객체를 서로 다른 권한 경계로 나누지 못하며, 객체의 기존 태그 조건은 S3 `DeleteObject` 권한 제한에 사용할 수 없습니다.

### 선택지(대안)

1. Stage와 Center가 별도 버킷 사용
2. 단일 버킷에서 버킷 태그만으로 환경 구분
3. 단일 버킷에서 환경별 key prefix와 별도 IAM 사용자·정책 사용, 버킷 태그는 운영 분류에만 사용

### 결정(무엇을 선택)

**3번을 선택합니다.**

- 객체 key는 `<storage_prefix>/profiles/{user_id}/{uuid}.{ext}`
- Stage prefix는 `stage`, Center prefix는 `center`
- Stage IAM Resource는 `arn:aws:s3:::<bucket>/stage/profiles/*`
- Center IAM Resource는 `arn:aws:s3:::<bucket>/center/profiles/*`
- 버킷 이름·리전만 공유하고 IAM 사용자·정책·Access Key는 분리
- 버킷 태그는 `Environment=shared` 등 비용·운영 식별에만 사용하고 접근 제어 정본으로 사용하지 않음
- `PROFILE_IMAGE_STORAGE_PREFIX`는 `local|test|stage|center`만 허용

### 근거(왜)

- 운영자가 원하는 단일 버킷을 유지하면서 Stage credential의 Center 객체 읽기·쓰기·삭제를 IAM Resource 수준에서 차단
- 객체 태그에 의존한 삭제 권한 경계의 S3 제약을 회피
- key 자체로 환경을 식별해 장애 분석과 수동 복구 시 오조작 범위를 축소

### 결과/영향(좋은 점/트레이드오프)

- 기존 Stage 정책의 `/profiles/*` Resource를 `/stage/profiles/*`로 교체해야 함
- Center 배포 전에 별도 IAM 사용자·정책·Access Key가 필요
- prefix 적용 전 저장된 객체가 생겼다면 자동 이동되지 않으므로 별도 이관이 필요
- 버킷 단위 암호화·퍼블릭 차단·수명주기·장애 영향은 두 환경이 공유

### 구현 위치

- `src/services/profileImageStorageService.ts`, `src/config/environment.ts`
- `.env.example`, `test/profileCompletion*.test.cjs`
- `_docs/PROFILE_COMPLETION_GUIDE.md`

### 추후 과제(언제 다시 평가)

- Stage 작업이 Center 객체나 버킷 공통 설정에 영향을 준 사고가 발생하면 별도 버킷으로 분리
- 비공개 조회 API 구현 시에도 요청 사용자의 환경과 저장 key prefix가 일치하는지 서버에서 강제

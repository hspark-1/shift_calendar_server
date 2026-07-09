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

## ADR-0007: 카카오 OAuth 2가지 방식 지원 (WebView + SDK)

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

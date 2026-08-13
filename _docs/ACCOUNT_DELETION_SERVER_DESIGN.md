# 회원 탈퇴 서버 개발 설계

## 1. 목적과 범위

이 문서는 인증된 사용자가 앱에서 전체 계정 삭제를 요청했을 때 다음 조건을 만족하는 서버 구현 계약을 정의합니다.

- 사용자 계정과 서버가 보유한 사용자 생성 콘텐츠를 물리적으로 삭제한다.
- Apple 로그인 사용자의 서버 보관 refresh token을 Apple `/auth/revoke`로 폐기한다.
- 카카오 로그인 사용자는 서버의 Admin Key 방식 unlink를 수행한다.
- 친구·그룹·알림·근무표·Redis에 탈퇴자 데이터가 남지 않게 한다.
- 외부 공급자나 Redis 장애에도 요청을 잃지 않고 재시도한다.
- 중복 요청, 다중 API 인스턴스, worker 재시작에도 멱등성을 보장한다.

이번 설계는 런타임 코드나 운영 DB를 직접 변경하지 않습니다. 실제 구현은 별도 migration, API/worker 코드, OpenAPI와 테스트 작업으로 진행합니다.

## 2. 확인된 현재 상태

### 인증

- Access Token은 7일, Refresh Token은 30일이며 Access Token 자체 denylist는 없습니다.
- `authMiddleware`는 JWT 검증 후 매 요청마다 `users`를 조회하므로 사용자 물리 삭제 후 기존 Access Token은 즉시 401이 됩니다.
- Refresh Token 원문은 저장하지 않고 `refresh_tokens.token_hash`만 저장합니다.
- Apple refresh token만 `oauth_authorizations`에 AES-256-GCM 암호문으로 보관합니다.
- 카카오·네이버 access/refresh token과 Google OAuth access/refresh token은 서버에 보관하지 않습니다.

### DB와 캐시

- 현재 최종 DDL의 사용자 FK 대부분은 `ON DELETE CASCADE`가 아니므로 `DELETE FROM users`만 실행하면 실패합니다.
- 그룹의 `created_by_user_id`, `added_by_user_id` 등 감사 FK는 다른 사용자가 남아 있는 그룹에서도 탈퇴자를 참조할 수 있습니다.
- 알림의 `payload`, push job의 `data_payload`, 제목·본문에는 FK가 아닌 탈퇴자 UUID·이름·프로필 URL snapshot이 남을 수 있습니다.
- Redis 근무표 snapshot은 `owner_user_id + YYYYMM` 단위이며 PostgreSQL row를 삭제해도 자동 삭제되지 않습니다.
- `Schedule`, `ShiftPattern`, `SharedSchedule` 모델은 export되지만 현재 `migrations/final_schema.sql`과 `schema.drawio`에는 대응 테이블이 없습니다. 실제 환경 preflight에서 남아 있는 legacy FK가 발견되면 삭제를 시작하지 않고 migration 범위를 보완해야 합니다.

### 외부 공급자

- Apple은 서버가 보관한 refresh token, 해당 authorization의 `client_id`, 새 client secret을 사용해 `/auth/revoke`를 호출할 수 있습니다. Apple은 성공 또는 이미 무효인 token에 200을 반환합니다.
- 카카오는 서비스 앱 Admin Key와 저장된 `kakao_id`로 `/v1/user/unlink`를 호출할 수 있습니다.
- Google은 현재 ID Token 로그인만 사용합니다. 서버에 OAuth access/refresh token이 없으며 ID Token 공유 동의 해제는 Google client API 또는 사용자 계정 설정에서 수행합니다.
- 네이버는 현재 서버에 연동 해제에 필요한 token을 보관하지 않습니다. 모바일 SDK의 `disconnect()` 또는 유효한 token을 이용한 별도 흐름이 필요합니다.

공식 근거:

- Apple 계정 삭제 안내: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Apple token revoke: https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens
- Apple 삭제·revoke 기술 문서: https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple
- Kakao unlink REST API: https://developers.kakao.com/docs/en/kakaologin/rest-api
- Google ID Token 공유 동의 해제: https://developers.google.com/identity/gsi/web/guides/revoke
- Naver iOS 연동 해제: https://developers.naver.com/docs/login/ios/

## 3. 핵심 결정

회원 탈퇴는 일반 도메인의 soft delete와 달리 물리 삭제합니다. 단, 외부 revoke와 Redis 정리는 DB transaction 안에서 수행할 수 없으므로 PostgreSQL 원본의 비동기 삭제 요청과 전용 worker를 사용합니다.

```text
DELETE /api/v1/auth/account
  → 인증 + 최근 재인증 + 명시적 확인
  → users row lock
  → account_status=DELETION_PENDING
  → Refresh Token revoke + 기기 비활성 + 삭제 요청/공급자 task 기록
  → 202 Accepted

Account Deletion Worker
  → lease claim
  → Apple revoke / Kakao unlink
  → DB purge transaction
     ├─ 그룹 OWNER 승계 또는 1인 그룹 삭제
     ├─ 개인 콘텐츠·관계·알림 snapshot 삭제
     ├─ 사용자 및 인증정보 물리 삭제
     └─ 삭제 요청 상태를 CACHE_PURGE_PENDING으로 전환
  → Redis tombstone 설정 + 사용자 key 전체 삭제
  → COMPLETE + 요청 row의 user_id 제거
```

이 방식은 외부 HTTP 호출 중 DB transaction을 오래 점유하지 않고, API 응답 유실·worker 종료·공급자 일시 장애에도 같은 작업을 재개할 수 있습니다.

## 4. API 계약

### 4.1 탈퇴 요청

`DELETE /api/v1/auth/account`

필수 조건:

- `Authorization: Bearer <access_token>`
- Access Token의 최초 본인 인증 시각 `auth_time`이 서버 기준 10분 이내
- 요청 본문 `{ "confirmation": true }`
- IP 기준 인증 rate limit 적용

성공 응답은 작업 완료가 아니라 안전하게 접수됐음을 뜻하는 `202 Accepted`입니다.

```json
{
  "success": true,
  "data": {
    "deletion_request_id": "uuid",
    "status": "PENDING",
    "requested_at": "2026-08-14T00:00:00.000Z"
  },
  "request_id": "http-request-id"
}
```

오류 계약:

| HTTP | code | 조건 |
|---|---|---|
| 400 | `ACCOUNT_DELETION_CONFIRMATION_REQUIRED` | `confirmation` 누락/false |
| 401 | `UNAUTHORIZED` | 유효하지 않은 Access Token |
| 403 | `REAUTHENTICATION_REQUIRED` | `auth_time`이 없거나 10분 초과 |
| 409 | `ACCOUNT_DELETION_IN_PROGRESS` | 이미 접수된 요청이 진행 중이며 기존 요청 ID를 함께 반환 |
| 503 | `ACCOUNT_DELETION_DISABLED` | 환경별 feature flag 비활성 |

동일 사용자의 동시 요청은 사용자 row lock과 active request 부분 unique index로 하나만 생성합니다. 첫 요청이 접수되면 모든 일반 API는 `ACCOUNT_DELETION_IN_PROGRESS`로 차단하고 앱은 로컬 credential과 provider SDK credential을 제거합니다.

### 4.2 최근 재인증

- Access/Refresh JWT에 `auth_time`을 추가합니다.
- 패스워드/OAuth 전체 로그인 성공 시 `auth_time=현재 시각`을 기록합니다.
- Refresh Token rotation은 기존 `auth_time`을 그대로 전달하며 새 인증으로 간주하지 않습니다.
- 기존 JWT처럼 `auth_time`이 없는 token은 탈퇴 요청에 사용할 수 없고 사용자가 다시 로그인해야 합니다.

### 4.3 진행 상태

`GET /api/v1/auth/account-deletion`

- `DELETION_PENDING` 사용자에게만 허용하는 전용 인증 미들웨어를 사용합니다.
- 응답은 `PENDING`, `PROCESSING`, `RETRY`, `CACHE_PURGE_PENDING`과 안전한 일반 메시지만 노출합니다.
- 공급자 원문 오류, token, 이메일, provider subject는 반환하지 않습니다.
- DB의 사용자 삭제가 끝난 뒤에는 기존 Access Token으로 인증할 수 없으므로 앱은 접수 응답 후 로그아웃 상태를 정본으로 사용합니다.

## 5. DB 변경 설계

### 5.1 users 상태

`users`에 다음 컬럼을 add-only로 추가합니다.

- `account_status text NOT NULL DEFAULT 'ACTIVE'`
- `deletion_requested_at timestamptz`
- `CHECK (account_status IN ('ACTIVE', 'DELETION_PENDING'))`
- 상태와 시각의 null/non-null 쌍 제약

모든 로그인·Refresh Token rotation·일반 인증은 `ACTIVE` 사용자만 허용합니다. 삭제 요청 endpoint와 상태 조회만 `DELETION_PENDING`을 제한적으로 허용합니다.

### 5.2 삭제 작업 테이블

`account_deletion_requests`

- `deletion_request_id uuid PK`
- `user_id uuid` — 처리 중에만 보관하고 완료 시 null 처리, FK는 두지 않음
- `status`: `PENDING | PROCESSING | RETRY | CACHE_PURGE_PENDING | COMPLETED | FAILED`
- `requested_at`, `available_at`, `claimed_at`, `claim_token`, `attempt_count`
- `db_purged_at`, `cache_purged_at`, `completed_at`, `last_error_code`
- `cache_year_months date[]` — DB purge 전에 확인한 cache key 월 목록이며 완료 시 빈 배열로 제거
- 진행 중 동일 `user_id` 하나만 허용하는 partial unique index
- claim pair, attempt count, 완료 상태/시각 check constraint

`account_deletion_provider_tasks`

- `(deletion_request_id, provider)` unique
- `provider`: 초기 구현은 `APPLE | KAKAO`
- `status`: `PENDING | PROCESSING | RETRY | COMPLETED | FAILED`
- `attempt_count`, `available_at`, lease, `completed_at`, `last_error_code`
- token·provider subject·이메일·이름은 저장하지 않음

요청/작업 테이블은 완료 후 사용자 식별자를 제거한 최소 운영 기록만 30일 보관하고 cleanup합니다. 법적 보존 데이터가 현재 스키마에는 없으므로 별도 승인 없이 사용자 데이터를 익명 보존하지 않습니다.

### 5.3 FK 삭제 정책 migration

서비스 purge와 DB 무결성을 함께 보장하도록 사용자 소유 데이터에는 CASCADE, 단순 감사자에는 SET NULL을 적용합니다.

| 테이블/컬럼 | 정책 |
|---|---|
| `friend_requests.requester_user_id/addressee_user_id` | `ON DELETE CASCADE` |
| `friendships.user_id_a/user_id_b` | `ON DELETE CASCADE` |
| `friend_level_settings.owner_user_id/friend_user_id` | `ON DELETE CASCADE` |
| `events.owner_user_id` | `ON DELETE CASCADE` |
| `events.created_by_user_id/deleted_by_user_id` | nullable + `ON DELETE SET NULL` |
| `work_shifts.owner_user_id` | `ON DELETE CASCADE` |
| `work_shifts.created_by_user_id/deleted_by_user_id` | nullable + `ON DELETE SET NULL` |
| `shift_templates.owner_user_id`와 하위 template FK | `ON DELETE CASCADE`; 서비스가 work shift를 먼저 삭제 |
| `shift_template_versions.created_by_user_id` | nullable + `ON DELETE SET NULL` |
| `work_shift_month_states/outbox.owner_user_id` | `ON DELETE CASCADE` |
| `groups.created_by_user_id/deleted_by_user_id` | nullable + `ON DELETE SET NULL` |
| `group_members.user_id` | `ON DELETE CASCADE` |
| `group_members.added_by_user_id/removed_by_user_id` | nullable + `ON DELETE SET NULL` |
| `group_invitations.inviter_user_id/invitee_user_id` | `ON DELETE CASCADE` |
| `refresh_tokens`, `oauth_authorizations`, `notifications`, `user_devices`, `push_jobs` | 기존 CASCADE 유지 |
| `push_deliveries.device_id` | `ON DELETE CASCADE`로 변경 |

nullable 변경으로 `GroupDetail.created_by_user_id` 등 API 타입도 `string | null`로 바뀝니다. 이 변경은 OpenAPI와 Flutter DTO에 명시해야 하는 behavior change입니다.

### 5.4 실제 환경 preflight

migration 전 `pg_constraint`와 `pg_attribute`를 조회해 `users`를 참조하는 모든 FK와 nullable/delete action을 출력합니다. 설계 allowlist에 없는 FK나 legacy 테이블이 하나라도 있으면 migration과 feature 활성화를 중단합니다. 운영 DB에서는 `final_schema.sql`을 실행하지 않습니다.

## 6. DB purge transaction

worker는 provider task가 모두 완료된 뒤 아래 순서로 단일 transaction을 수행합니다.

1. 삭제 요청과 `users` row를 `FOR UPDATE`로 잠그고 `DELETION_PENDING`을 재확인합니다.
2. 탈퇴자가 OWNER인 활성 그룹을 `group_id` 순서로 잠급니다.
3. 각 그룹에 남은 멤버가 있으면 `ADMIN 우선 → MEMBER → joined_at ASC → user_id ASC`로 새 OWNER를 선정합니다. 후보가 없으면 그룹과 관련 초대·멤버십을 물리 삭제합니다.
4. 탈퇴자와 관련된 `group_invitations` 및 탈퇴자의 모든 membership 이력을 삭제합니다. 그룹 감사 FK는 SET NULL로 남깁니다.
5. 다른 사용자가 받은 알림 중 `payload.related_user_id` 또는 `payload.inviter_user_id`가 탈퇴자 UUID인 알림을 삭제합니다. 알림 삭제는 연결된 push job/delivery snapshot도 함께 삭제합니다.
6. 친구 요청·친구 관계·양방향 공개 설정을 삭제합니다.
7. 사용자 소유 event와 work shift를 삭제합니다.
8. 사용자의 월 cache state/outbox와 shift template 하위 `schedule → type/version → template`을 삭제합니다.
9. 수신 알림·push job·기기·ShiftMate Refresh Token·OAuth authorization을 삭제합니다.
10. `users`를 물리 삭제하고 요청을 `CACHE_PURGE_PENDING`으로 바꿉니다.

그룹 OWNER 승계는 기존 `transferGroupOwner`와 동일하게 group row를 먼저 잠그는 순서를 지켜 그룹 역할 변경·초대 수락과의 교착/경합을 방지합니다. 이름이 들어간 notification `body`까지 제거하기 위해 관련 notification 전체를 삭제하며 payload 일부만 수정하지 않습니다.

## 7. 외부 공급자 처리

### Apple

- `oauth_authorizations`의 활성 row를 잠그지 않은 read 단계에서 읽고 AES-256-GCM으로 refresh token을 복호화합니다.
- 저장된 `client_id`로 client secret을 생성해 `POST https://appleid.apple.com/auth/revoke`를 호출합니다.
- `token_type_hint=refresh_token`, `Content-Type: application/x-www-form-urlencoded`, 5초 timeout, 자동 라이브러리 재시도 비활성으로 고정합니다.
- HTTP 200은 이미 무효인 token도 포함한 성공으로 처리합니다.
- timeout, 429, 5xx는 지수 backoff+jitter로 재시도합니다.
- `invalid_client`와 암호화 키 복호화 실패는 재시도로 회복되지 않는 운영 오류로 분류해 `FAILED`와 경보를 남기되 token 원문은 로그에 기록하지 않습니다.

### Kakao

- `kakao_id`가 있으면 Service app Admin Key로 `/v1/user/unlink`를 호출하고 응답 ID가 요청 ID와 같은지 확인합니다.
- Admin Key는 API/worker 환경변수 secret으로만 주입하고 저장소·로그에 기록하지 않습니다.
- 이미 unlink된 상태를 나타내는 공식 오류만 멱등 성공으로 분류하고, 나머지 4xx는 운영 오류로 둡니다.

### Google과 Naver

- 현재 서버에는 연동 해제에 필요한 OAuth access/refresh token이 없습니다.
- Google ID Token 공유 동의 해제와 Naver SDK `disconnect()`는 Flutter 탈퇴 흐름에서 서버 요청 전에 실행합니다. 이 실패가 서버의 내부 계정 삭제 권리를 막아서는 안 됩니다.
- 서버 중앙 revoke가 제품 필수 조건이 되면 두 공급자의 token을 새로 수집·암호화 저장하는 별도 보안 설계와 기존 사용자 재동의가 필요합니다. 이번 P0에서 ID Token이나 만료 access token을 억지로 저장하지 않습니다.

## 8. Redis와 동시성

- DB purge 전 삭제 대상 `owner_user_id`의 월 목록을 요청 row의 `cache_year_months`에 저장해 commit 이후 worker가 재시작돼도 복구합니다.
- DB commit 직후 `account-deleted:v1:{user_id}` tombstone을 먼저 설정합니다.
- cache read/write 서비스는 tombstone 사용자의 snapshot 생성·fenced write를 거부합니다.
- snapshot, revision, lock key를 정확한 prefix로 삭제하고, `SCAN`은 보조 누락 검사에만 사용합니다.
- Redis 장애 시 DB 삭제를 되돌리지 않고 요청을 `CACHE_PURGE_PENDING`으로 유지해 재시도합니다.
- tombstone TTL은 근무표 snapshot TTL과 lock TTL의 합보다 길게 두고, 마지막 지연 재검사 후 요청을 `COMPLETED`로 전환합니다.
- 완료 시 `account_deletion_requests.user_id`를 null, `cache_year_months`를 빈 배열로 바꿔 운영 기록과 사용자 식별 연결을 끊습니다.

## 9. 코드 구조

구현된 파일 역할은 다음과 같습니다.

- `src/routes/authRoutes.ts`: 탈퇴 요청/상태 route와 validation
- `src/controllers/authController.ts`: HTTP wrapper와 안전한 오류 매핑
- `src/services/accountDeletionService.ts`: 접수 transaction, 재인증, 그룹 승계, DB purge
- `src/services/accountDeletionProviderService.ts`: Apple revoke/Kakao unlink adapter와 오류 분류
- `src/workers/accountDeletionWorker.ts`: lease claim, provider task, DB/Redis 단계 재시도
- `src/models/AccountDeletionRequest.ts`, `AccountDeletionProviderTask.ts`: 작업 상태 모델
- `src/middlewares/auth.ts`: ACTIVE 기본 정책과 삭제 상태 전용 인증
- `src/services/authService.ts`: `auth_time` 발급/전파
- `src/services/appleService.ts`: 기존 client secret·refresh token 복호화 기능을 provider service가 재사용
- `src/services/workShiftMonthCacheService.ts`: 삭제 tombstone 검사와 사용자 전체 key 제거
- `src/openapi/accountDeletionOpenApi.json`: API·오류·202 계약
- `migrations/add_account_deletion_support.sql`: add-only 컬럼/테이블/FK 변경
- `migrations/account_deletion_{preflight,postflight}.sql`: 실제 FK/제약 검증
- `migrations/rollback_account_deletion_support.sql`: 데이터 0건과 비활성 승인 때만 신규 객체 제거

구현은 완료되었으나 기능 플래그는 기본 `false`입니다. 로컬 Docker daemon이 실행 중이 아니어 PostgreSQL/Redis 통합 테스트는 CI 또는 격리 디버그 DB에서 추가로 실행해야 합니다.

### 9.1 신규 파일 의존성·사용 예

- `src/config/accountDeletion.ts`는 공통 환경 파서에만 의존하며 API·worker가 flag/재인증 기간을 공유합니다.
- `src/models/AccountDeletionRequest.ts`와 `AccountDeletionProviderTask.ts`는 `src/config/database.ts`의 Sequelize와 migration의 동명 테이블을 사용합니다. provider task는 request에 `ON DELETE CASCADE`로 속합니다.
- `src/services/accountDeletionService.ts`는 인증 컨트롤러와 worker에서 호출하며 PostgreSQL transaction, 기기 unbind, 그룹 승계/물리 삭제를 담당합니다.
- `src/services/accountDeletionProviderService.ts`는 Apple 암호화 authorization·client secret과 Kakao Admin Key에 의존하며 외부 오류를 retryable/permanent로 분류합니다.
- `src/workers/accountDeletionWorker.ts`는 위 두 service와 Redis cache service를 순서대로 조합합니다. 실행 예는 `npm run build && npm run start:account-deletion-worker`, DB healthcheck는 `node dist/workers/accountDeletionWorker.js --healthcheck`입니다.
- `src/openapi/accountDeletionOpenApi.json`은 `src/openapi.ts`가 기존 문서와 merge하며 `API_DOCS_ENABLED=true`인 환경에서 Swagger로 확인합니다.
- migration 예: 백업·대상 DB 확인 후 `account_deletion_preflight.sql` → `add_account_deletion_support.sql` → `account_deletion_postflight.sql` 순으로 적용합니다. rollback은 `expected_database`와 `confirm_account_deletion_disabled=true`를 명시하고 0건 guard를 통과한 경우에만 사용합니다.
- `test/accountDeletionIntegration.test.cjs`는 `test/fixtures/groupDebug.compose.yml`의 고정 격리 PostgreSQL에서만 schema를 초기화하며, 사용 예는 `npm run test:account-deletion-integration`입니다.

## 10. 테스트 전략

### 단위·정적 테스트

- `auth_time`은 Refresh Token rotation 후에도 갱신되지 않음
- 10분 경계, confirmation, feature flag와 공통 오류 wrapper
- Apple 200/timeout/429/5xx/invalid_client 및 Kakao unlink 오류 분류
- provider token, subject, 이메일, 이름이 로그에 포함되지 않음
- migration의 모든 사용자 FK action과 nullable 계약
- OpenAPI, `schema.drawio`, `PROJECT_CONTEXT` 동기화

### PostgreSQL 통합 테스트

- 동일 사용자의 동시 탈퇴 요청은 request 1건만 생성
- 접수 직후 Refresh Token rotation과 일반 API가 차단됨
- worker 종료 지점별 재실행: provider 성공 전/후, DB commit 전/후, Redis purge 전/후
- 친구 양방향 row, 개인 일정, 근무표, template 계층, 알림/push snapshot이 모두 0건
- 다른 사용자가 받은 탈퇴자 관련 notification body/payload도 제거
- OWNER가 ADMIN에게 승계되고 ADMIN이 없으면 가장 오래된 MEMBER에게 승계
- 1인 그룹은 물리 삭제, 비OWNER 탈퇴는 그룹 유지
- 다른 사용자의 콘텐츠와 그룹은 유지되고 감사 FK만 null
- 처리 완료 후 기존 Access/Refresh Token 모두 사용 불가
- allowlist 밖 legacy FK가 있으면 preflight 실패

### Redis·Stage 검증

- 캐시 hit/miss, in-flight fenced write와 worker 동시 실행에서도 탈퇴자 key가 최종 0건
- Redis 중단 시 `CACHE_PURGE_PENDING`, 복구 후 COMPLETE
- Apple 실제 테스트 계정: 신규 로그인 → 탈퇴 → `/auth/revoke` 200 → 같은 Apple 계정 재가입 시 신규 동의 흐름 확인
- Kakao 실제 테스트 계정: unlink 후 재로그인 동의 흐름 확인
- iOS/Android에서 접수 즉시 로컬 JWT·provider SDK credential 삭제와 비로그인 화면 전환

## 11. 배포와 롤백

1. DB 백업과 FK preflight 결과를 보관합니다.
2. add-only migration을 적용하고 strict postflight를 통과합니다.
3. API와 account deletion worker를 `ACCOUNT_DELETION_ENABLED=false`로 배포합니다.
4. worker에 Apple `.p8`·암호화 키와 Kakao Admin Key를 최소 권한으로 주입합니다. 기존 Apple secret의 “API 전용” 계약은 “API + account deletion worker 전용”으로 변경합니다.
5. Stage에서 provider mock, Redis 장애, 실제 Apple/Kakao 계정 E2E를 완료합니다.
6. Stage endpoint를 활성화한 뒤 Center를 활성화합니다.
7. Apple 로그인은 계정 삭제 E2E와 실기기 검증이 모두 끝난 뒤에만 기존 이중 gate 정책에 따라 활성화합니다.

문제가 생기면 endpoint와 worker flag를 끄고 이전 이미지를 배포하며 add-only schema와 진행 중 요청은 보존합니다. 완료된 물리 삭제는 애플리케이션 rollback으로 복구하지 않습니다. 백업에서 탈퇴자 데이터를 운영계로 되살리는 행위는 개인정보 삭제 의사를 위반할 수 있으므로 별도 법무·보안 승인 없이는 금지합니다.

## 12. 완료 기준

- API/OpenAPI/Flutter 계약이 202 비동기 삭제 흐름으로 일치한다.
- 현재 schema의 모든 사용자 직접·간접 FK가 migration과 통합 테스트에 포함된다.
- Apple revoke와 Kakao unlink가 멱등 재시도된다.
- PostgreSQL, notification/push snapshot, Redis에서 탈퇴자 데이터가 제거된다.
- 그룹 OWNER 탈퇴가 자동 승계 또는 1인 그룹 삭제로 완료되어 사용자 탈퇴를 막지 않는다.
- 기존 Access/Refresh Token으로 일반 API에 접근할 수 없다.
- secret/token/이메일/이름을 포함하지 않는 운영 로그와 실패 경보가 준비된다.
- Stage 실제 계정 E2E 전에는 Production 기능을 활성화하지 않는다.

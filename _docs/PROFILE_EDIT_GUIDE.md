# 일반 프로필 수정·사진 교체 계약 (2026-11-10)

Flutter 전달 요청을 서버 코드에 반영한 문서다. 실제 Stage/Center DB 적용·배포·실기기 연동 완료를 의미하지 않는다. 가입 완료 정본과 인증 이미지 GET은 [PROFILE_COMPLETION_GUIDE.md](PROFILE_COMPLETION_GUIDE.md), 이번 정책은 서버 ADR-0043을 따른다. 전달 요청의 ADR 번호는 Flutter 저장소 기준이며 서버의 같은 번호와 동일한 결정으로 취급하지 않는다.

## 요청·응답

`POST /api/v1/auth/profile`에 Bearer access token을 보낸다. 사진이 없으면 기존 JSON, 사진이 있으면 multipart의 `profile_image` 파일 하나와 변경할 필드만 보낸다. 파일만 전송해도 유효하다. 이름·전화번호·timezone은 생략 시 유지한다. 이름은 trim 후 1~50자이며 null/빈 값은 거절한다. 전화번호는 기존 10~11자리 숫자/하이픈 검증·정규화·unique 규칙을, timezone은 IANA 검증을 유지한다.

`job_type`은 trim 후 1~20자의 자유 문자열이다. 기존 NURSE/DOCTOR/EMT/OTHER도 그대로 허용한다. `workplace`는 trim 후 1~100자다. 두 선택값은 생략 시 유지하고 JSON null 또는 JSON/multipart 빈 문자열·공백이면 삭제한다. 문자열 `"null"`은 일반 문자열이다. 문자의 길이는 Unicode code point 기준이다.

```json
{"name":"새 이름","job_type":"서비스 기획자","workplace":""}
```

사진은 JPEG/PNG/WebP 1개·5MB 이하이며 기존 MIME·컨테이너 구조 검증을 재사용한다. `profile_image` 생략 시 사진을 유지한다. `profile_image_url`은 기존 값 유지 또는 null/빈 문자열 제거만 허용한다. 외부 임의 URL로 교체는 거절한다. 파일과 `profile_image_url`을 함께 보내면 값의 종류와 무관하게 400 `VALIDATION_ERROR`다. multipart boundary는 클라이언트가 생성한다.

`user_id`, `profile_image_key`, 이메일, OAuth ID, `profile_completed_at` 입력은 반영하지 않는다. 인증된 사용자만 수정한다. 성공은 기존 200 `{success:true,data:<최신 전체 본인 프로필>,request_id}`다. 일반 수정은 완료 시각을 생성·변경하지 않고 `requires_profile_setup`을 DB 상태에서 계산한다. key와 완료 시각은 응답에서 제외한다. 관리 이미지 URL은 기존 `/api/v1/profile-images/:user_id`이며 같은 URL에서 최신 바이트를 제공한다. Flutter는 성공 응답으로 본인 상태를 교체하고 사진 전송 시 byte cache를 무효화해야 한다.

## 처리·경합·실패 복구

```text
Router → auth rate limit → JWT/활성 사용자 검사 → multipart parser/이미지 검증
 → Controller → mutateProfile(입력 필드 제한)
 → 이미지 변경 시 account-data session advisory lock + 활성 계정 재검사
 → 필드 검증 → 새 UUID key 정리 작업 선기록 → S3 PutObject (DB transaction 없음)
 → DB transaction: 활성 계정 재검사/row lock/부분 저장
    + 새 key 정리 취소 + 이전 관리 key 정리 예약
 → commit → 이전 파일 정리 시도 → 최신 프로필 응답
```

- 탈퇴 진행 계정의 늦은 이미지 요청은 lock 안 활성 상태 검사를 필드 검증보다 먼저 실행해 기존 UNAUTHORIZED 계약을 유지한다. 모든 필드 검증은 업로드 전에 끝난다.
- 이미지 없는 일반 필드 수정/가입 완료는 기존 DB row lock transaction만 사용하므로 사진 업로드 중에도 다른 필드를 수정할 수 있다. 사진 교체/URL 제거는 session lock을 사용한다.
- 가입 완료도 같은 이미지 조정 서비스를 사용한다. 가입 필수값·최초 완료 시각 정책은 유지한다.
- 업로드 실패·전화 중복·DB 실패는 새 key 작업을 남기고 즉시 정리를 시도한다. 기존 값은 transaction rollback으로 보존한다. 업로드 응답 유실/프로세스 종료도 선기록된 작업으로 복구한다.
- DB commit 이후 삭제 실패는 200 결과를 유지한다. 현재 새 key 작업은 commit과 함께 제거되므로 현재 사진을 삭제하지 않는다. 정리 전에 DB의 현재 key와 소유자를 다시 확인한다. commit 응답 유실로 현재 key 작업이 남아도 파일 삭제 없이 해당 작업만 제거한다.
- 이전 사진은 현재 환경·소유자 key 또는 `legacyProfileImageKey`로 검증된 이전 URL만 정리한다. 외부 OAuth URL을 삭제 key로 사용하지 않는다.
- 업로드·즉시 정리·재시도·탈퇴 worker는 동일 계정 session lock을 공유한다. 동시 사진 변경은 잠금 대기 대신 503으로 재시도를 요청한다. 탈퇴 접수는 row lock으로 상태를 바꾸므로 업로드 중 접수되어도 저장 transaction의 재검사에서 거절하고 새 파일을 정리한다. 탈퇴 purge는 업로드와 같은 session lock을 얻은 뒤 실행한다.
- 재시도는 기존 `accountDeletionWorker`의 매 루프에서 탈퇴 기능 플래그와 무관하게 실행한다. worker 프로세스 자체가 실행되어 있어야 한다. 기본 유휴 폴링은 기존 10분이며 실패 작업의 다음 시도도 10분 뒤다. 한 배치는 최대 10계정, 계정당 10작업이다. 추가 env·새 worker는 없다.
- 큐는 bucket/endpoint/region/path-style fingerprint를 보존한다. 설정이 달라지면 파일을 삭제하지 않고 재시도 상태로 유지한다. 원래 설정 복구 또는 검증된 수동 정리가 필요하다. 버전 관리 비활성 저장소의 기존 단일 객체 삭제 방식을 재사용한다. 버전 관리 저장소의 과거 버전 물리 삭제는 기존 탈퇴 namespace purge가 담당한다.
- 로그는 고정 event/error code와 request ID만 사용한다. 정리 실패는 `profile_image_cleanup_failed` / `PROFILE_IMAGE_CLEANUP_RETRY`다. 이름·전화·직종·소속·이미지·토큰·key를 출력하지 않는다. 성공한 큐 행은 즉시 제거한다. 사용자 purge 뒤에도 미완료 파일을 정리할 수 있도록 큐의 소유자 ID는 FK 없는 논리 참조이며 성공할 때까지 보존한다.

| 상태 | 오류 코드 |
| --- | --- |
| 400 | VALIDATION_ERROR, INVALID_PHONE, INVALID_TIMEZONE, INVALID_JOB_TYPE, INVALID_PROFILE_IMAGE |
| 401 | UNAUTHORIZED |
| 409 | PHONE_ALREADY_EXISTS, ACCOUNT_DELETION_IN_PROGRESS(인증 단계) |
| 413 | PROFILE_IMAGE_TOO_LARGE |
| 429 | AUTH_RATE_LIMIT_EXCEEDED |
| 503 | PROFILE_IMAGE_STORAGE_UNAVAILABLE(저장소 실패/계정 수정 잠금 충돌) |
| 500 | INTERNAL_SERVER_ERROR(DB 등 commit 이전 내부 실패) |

실패 wrapper는 `{success:false,error:{code,message},request_id}`다. 전화번호 사전 검사와 DB unique 경쟁을 모두 409로 매핑한다.

## DB·배포·롤백

기존 가입 완료·비공개 이미지 schema가 적용된 DB가 전제다. `migrations/add_profile_edit_support.sql`은 `ck_users_job_type`만 자유 문자열 길이 CHECK로 바꾸고 재시도 테이블·인덱스를 추가한다. 기존 users 데이터와 완료 상태는 재작성하지 않는다. 추가 seed는 없다. 새 사진 컬럼은 없다.

1. 대상 DB/복원 가능한 백업을 확인하고 Stage에 후속 migration 전체를 실행한다. 초기화용 `final_schema.sql`은 운영에서 실행하지 않는다.
2. API와 기존 탈퇴 worker를 같은 버전으로 배포한다. worker healthcheck는 정리 큐 schema도 검사한다. 기존 storage env/환경별 prefix·IAM Put/Get/Delete 권한을 재사용한다. 비밀값은 기록하지 않는다.
3. Stage에서 JSON·사진 단독·선택값 삭제·완료 상태 보존·실패 재시도와 인증 이미지 조회를 확인한다. 실제 iPhone 사진 선택/취소/권한 거절·401 refresh 재전송·즉시 갱신·재로그인/재실행·친구 최신 사진을 확인한다.
4. Stage 증거를 남긴 뒤 운영에 같은 migration/API/worker를 적용하고 마지막에 Flutter를 제출한다.

검증용 집계(개인정보/key는 출력하지 않는다):

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='public.users'::regclass AND conname='ck_users_job_type';
SELECT count(*) AS pending, min(created_at) AS oldest,
       count(*) FILTER (WHERE last_error_code IS NOT NULL) AS retrying
FROM public.profile_image_cleanup_tasks;
```

자유 직종 저장 이후 enum 제약/구 서버로 단순 복원하면 실패한다. 자유 직종 호환 서버로 복구하고 additive 큐 schema를 유지한다. API와 worker를 함께 복구하며 큐가 비기 전에 worker 처리를 제거하거나 테이블을 삭제하지 않는다. 이전 가입 migration/wrapper를 다시 실행해 enum을 복구하지 않는다. 사용자의 직종을 임의 변환·삭제하지 않는다.

## 파일 역할·의존성·사용 예

| 파일 | 역할·의존성·사용 예 |
| --- | --- |
| `src/services/profileMutationService.ts` | HTTP 입력 allowlist·사전 검증·계정 잠금·업로드/DB/정리 조정. profile/storage/cleanup 서비스 의존. 두 auth controller에서 `mutateProfile(user_id, body, image, complete, request_id)` 호출 |
| `src/services/profileImageCleanupService.ts` | Sequelize SQL 영속 큐·fingerprint·현재 key 보호·삭제 재시도. User/storage/account-data lock 의존. transaction 안 enqueue/cancel, 잠금 안 즉시 정리, worker의 `processProfileImageCleanupBatch()` 호출 |
| `src/services/profileService.ts` | 정규화·row lock·부분 저장·전화 unique 409. 내부 image key 옵션과 transaction callback으로 큐 변경 원자화. HTTP는 mutation 서비스 경유 |
| `migrations/add_profile_edit_support.sql` | 기존 DB 확장 전용. PostgreSQL users/기존 profile schema 의존. 대상 확인 후 pgAdmin 전체 실행 또는 `psql -X -v ON_ERROR_STOP=1 -f migrations/add_profile_edit_support.sql` |
| `migrations/final_schema.sql`, `schema.drawio` | 신규 설치 정본과 데이터 구조. 정리 큐는 사용자에 대한 논리 참조임을 표시 |
| `test/privateProfileImageIntegration.test.cjs` | 고정 격리 PostgreSQL+로컬 S3 HTTP/실제 SDK로 API·rollback·정리·경합 검증. `npm run test:private-profile-integration` (해당 격리 DB의 public schema 초기화) |
| `test/profileCompletion.test.cjs`, `test/accountDeletion.test.cjs` | 공개 OpenAPI/route/migration·기존 worker 루프 회귀. `npm run build && node --test test/profileCompletion.test.cjs test/accountDeletion.test.cjs` |
| 본 문서 | 서버 인수·배포·롤백 계약. 위 모듈/OpenAPI/ADR-0043에 의존. Flutter 연동과 Stage 인수 체크리스트로 사용 |

자동 검증과 실제 환경 인수 결과는 WORKLOG에 구분해 기록한다.

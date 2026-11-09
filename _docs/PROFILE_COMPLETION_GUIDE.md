# 가입 프로필 완료 서버 가이드

## 목적과 정본

`users.profile_completed_at IS NULL`이면 `requires_profile_setup=true`입니다. OAuth 응답의 `is_new_user`는 계정 생성 호환 정보일 뿐 화면 분기 정본이 아닙니다.

요청 흐름은 다음과 같습니다.

```text
auth route → JWT/rate limit → multipart 제한·이미지 검증
  → 공용 mutation service 검증·account-data lock
  → 새 key 정리 작업 선기록 → object upload (열린 DB transaction 없음)
  → profile service DB transaction/row lock + 정리 큐 원자 변경
  → commit 후 이전 object 정리·실패 재시도 → 성공 API URL 응답
```

일반 편집·자유 직종·이미지 교체의 후속 migration/실패 복구·파일 역할은 [PROFILE_EDIT_GUIDE.md](PROFILE_EDIT_GUIDE.md)를 따른다. 가입 완료와 일반 편집은 같은 이미지 조정 서비스를 사용하며 일반 편집은 완료 시각을 생성하지 않는다.

## DB migration

범용 psql 경로:

```bash
psql "$DATABASE_URL" -X -v expected_database=<TARGET_DB> \
  -f migrations/profile_completion_preflight.sql
psql "$DATABASE_URL" -X \
  -f migrations/add_profile_completion_support.sql
psql "$DATABASE_URL" -X -v expected_database=<TARGET_DB> \
  -f migrations/profile_completion_postflight.sql
```

pgAdmin Query Tool에서는 다음 환경별 파일 하나를 전체 실행합니다.

- Stage: `migrations/stage_profile_completion_apply_pgadmin.sql`
- Center: `migrations/center_profile_completion_apply_pgadmin.sql`

두 파일 모두 `backup_reference` placeholder를 복원 시험한 실제 `.backup` 또는 `.dump` 파일명으로 바꿔야 합니다. DB명과 confirmation은 고정되어 있으며 Stage 성공 Data Output을 보존한 뒤 Center를 적용합니다. 실제 DB 적용은 자동 배포에 포함하지 않습니다.

기존 사용자 backfill은 trim 이름 1~50자, `pg_timezone_names`에 존재하는 timezone, 저장 형식 전화번호를 모두 만족할 때만 `created_at`으로 완료 처리합니다.

롤백은 Flutter 배포 전이라도 서버 route를 먼저 제거하지 않습니다. 별도 승인을 받은 경우에만 `rollback_profile_completion_support.sql`로 신규 제약 2개·컬럼 3개를 제거하며 기존 phone은 변경하지 않습니다.

## Object storage 설정

### 2026-08-21 Stage S3 생성 기록

운영자가 프로필 이미지 S3 버킷을 생성했습니다. 최초에는 Stage 전용으로 생성했으나 이후 Stage와 Center가 단일 버킷을 공유하는 것으로 결정했습니다. 확인된 설정은 다음과 같습니다.

- 버전 관리, Object Lock, S3 버킷 키 비활성화
- 퍼블릭 액세스 네 항목 모두 차단
- Object Ownership `Bucket owner enforced`
- 기본 암호화 SSE-S3
- 최초 태그: `Service=shiftmate`, `Environment=stage`, `Purpose=profile-images`, `DataClassification=user-content`

공유 결정 이후 버킷 태그의 `Environment`는 `shared`로 변경하고 필요하면 `StagePrefix=stage`, `CenterPrefix=center`를 운영 식별용으로 추가합니다. 버킷 태그는 객체별 접근 권한을 분리하지 않으므로 보안 경계로 사용하지 않습니다.

실제 버킷 이름과 ARN은 제공되지 않았으므로 Git 문서에 추정값을 기록하지 않습니다. AWS Console의 S3 버킷 `속성`에서 확인한 값을 운영 설정과 IAM 정책에만 사용합니다.

### ARN과 홈서버 IAM 연결

S3 ARN 자체는 애플리케이션 환경변수에 등록하지 않습니다. 현재 Stage API는 AWS workload가 아닌 홈서버 Docker에서 실행되므로 다음 경계를 사용합니다.

1. IAM에서 Stage 전용 정책을 생성합니다.
2. Stage는 버킷 ARN 뒤에 `/stage/profiles/*`, Center는 `/center/profiles/*`를 붙인 객체 ARN을 각 정책 `Resource`에 넣습니다.
3. 정책을 Stage 전용 IAM 사용자에 연결하고 `Application running outside AWS` 용도의 Access Key를 발급합니다.
4. Access Key ID와 Secret Access Key는 Git이 아닌 홈서버 `/opt/shiftmate-stage/.env`에만 저장합니다.

버킷 이름이 `<PROFILE_IMAGE_BUCKET>`이면 Stage 정책은 다음과 같습니다. `HeadObject`도 `s3:GetObject` 권한으로 처리되며 현재 key prefix 밖의 객체와 버킷 목록 권한은 부여하지 않습니다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StageProfileImageObjectAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::<PROFILE_IMAGE_BUCKET>/stage/profiles/*"
    }
  ]
}
```

Center 정책은 같은 action을 사용하되 `Resource`를 `arn:aws:s3:::<PROFILE_IMAGE_BUCKET>/center/profiles/*`로 제한합니다. 퍼블릭 차단을 해제하거나 `Principal: "*"` 읽기 정책을 버킷에 추가하지 않습니다. SSE-S3이므로 KMS 권한은 필요하지 않습니다. Stage와 Center는 버킷만 공유하고 IAM 사용자·정책·Access Key·prefix는 공유하지 않습니다.

홈서버 Stage 설정 위치와 값의 역할은 다음과 같습니다. ARN이 아니라 정확한 버킷 **이름**을 설정합니다.

```bash
sudoedit /opt/shiftmate-stage/.env
```

```env
PROFILE_IMAGE_STORAGE_BUCKET=<STAGE_BUCKET_NAME>
PROFILE_IMAGE_STORAGE_REGION=<BUCKET_REGION>
PROFILE_IMAGE_STORAGE_PREFIX=stage
PROFILE_IMAGE_STORAGE_ENDPOINT=
PROFILE_IMAGE_STORAGE_FORCE_PATH_STYLE=false
AWS_ACCESS_KEY_ID=<STAGE_PROFILE_IMAGE_IAM_ACCESS_KEY_ID>
AWS_SECRET_ACCESS_KEY=<STAGE_PROFILE_IMAGE_IAM_SECRET_ACCESS_KEY>
```

Access Key 원문은 WORKLOG, shell history, Git, 이슈, 로그에 남기지 않습니다. 키가 노출되면 값을 재사용하지 않고 IAM에서 비활성화·삭제한 뒤 새 키로 교체합니다.

> 2026-11-08 구현: 관리 이미지는 서버 인증 후 GetObject로 스트리밍합니다. DB key migration·API origin 설정·기존 URL 전환과 Flutter Authorization 헤더 적용이 배포 선행조건입니다. 실제 Stage 적용은 아래 절차로 검증합니다.

### 현재 구현 환경변수

API 프로세스에 다음 값을 환경별로 설정합니다.

```env
PROFILE_IMAGE_STORAGE_BUCKET=<ENV_BUCKET>
PROFILE_IMAGE_STORAGE_REGION=<REGION_OR_AUTO>
PROFILE_IMAGE_STORAGE_PREFIX=<local|test|stage|center>
PROFILE_IMAGE_STORAGE_ENDPOINT=<S3_COMPATIBLE_ENDPOINT_OR_EMPTY>
PROFILE_IMAGE_STORAGE_FORCE_PATH_STYLE=false
PROFILE_IMAGE_API_BASE_URL=https://<ENV_API_DOMAIN>
# 기존 S3/CDN URL 인식용 이전 origin. 앱 반환 주소가 아님.
PROFILE_IMAGE_PUBLIC_BASE_URL=https://<LEGACY_STORAGE_OR_CDN_DOMAIN>
```

AWS workload role을 사용할 수 없고 S3 호환 공급자가 static credential을 요구할 때만 `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`를 secret으로 주입합니다. bucket은 API에 `PutObject`, 실패 정리에 `DeleteObject` 권한이 필요합니다. CORS 공개 쓰기는 허용하지 않고 CDN/origin은 HTTPS GET만 제공합니다.

## API 계약

- `POST /api/v1/auth/profile/complete`: JSON 또는 `profile_image` 하나가 포함된 multipart, HTTP 200
- `GET /api/v1/auth/profile`: 본인 필드와 `requires_profile_setup`
- `POST /api/v1/auth/profile`: JSON/multipart 부분 수정·사진 단독 교체, 생략 필드 유지, 선택 필드 null/빈 문자열·공백 제거, 완료 시각 불변
- `job_type`: trim 후 1~20자 자유 문자열(기존 4개 코드 허용). 자유 직종 저장 전 후속 `add_profile_edit_support.sql` 적용 필요

이미지는 JPEG/PNG/WebP, 최대 5MB이며 client MIME과 감지 형식이 일치해야 합니다. key는 `<storage_prefix>/profiles/{user_id}/{uuid}.{ext}`이고 원본 파일명은 사용하지 않습니다. 운영 prefix는 Stage `stage`, Center `center`로 고정합니다.

## 배포 순서

1. Stage DB 백업 복원 시험과 사전 phone/timezone 감사
2. Stage pgAdmin migration 전체 실행, backfill Data Output 보존
3. Stage bucket/CDN/credential 구성과 Put/Delete/HTTPS GET smoke test
4. 서버 배포 후 JSON·multipart와 네 OAuth 신규/기존 사용자 E2E
5. Center 백업 복원 시험 후 동일 migration과 storage 구성
6. Center 서버 smoke test
7. 마지막으로 Flutter 배포

## 검증

```bash
npm run build
node --test test/profileCompletion.test.cjs
npm run test:profile-integration
```

통합 테스트는 고정된 폐기 가능 PostgreSQL 16 DB의 `public` schema를 재생성하므로 운영·공유 DB에서 실행하지 않습니다.

## 파일 역할

- `src/services/profileService.ts`: 입력 정규화, 완료/편집 transaction, 전화번호 충돌 매핑
- `src/middlewares/profileImageUpload.ts`: multipart 제한과 이미지 내용 검증
- `src/services/profileImageStorageService.ts`: S3 Put/Get/Delete와 UUID key·인증 이미지 API URL 생성
- `src/openapi/profileAuthOpenApi.json`: 공개 API/오류 정본
- `migrations/*profile_completion*`: 범용·Stage·Center apply와 제한적 rollback
- `test/profileCompletion*.test.cjs`: 정적/단위와 격리 PostgreSQL HTTP·migration 검증


## 비공개 이미지 조회 및 기존 데이터 전환 (2026-11-08)

**Behavior change**: 관리 프로필 이미지의 `profile_image_url`은 서버 API 주소로 바뀐다. S3 bucket은 비공개를 유지한다. API가 인증한 AWS SDK GetObject 응답을 직접 스트리밍하며 S3 URL이나 presigned URL로 리다이렉트하지 않는다. 외부 OAuth 사진은 기존 URL을 유지하며 서버가 임의 외부 URL을 fetch하지 않는다.

### 조회 계약과 권한

`GET /api/v1/profile-images/{user_id}`에 `Authorization: Bearer <access_token>`이 필요하다. 기존 인증 사용자 검색이 친구가 아닌 계정의 기본 아바타도 제공하므로 활성 로그인 사용자에게 활성 계정의 기본 아바타 조회를 허용한다. `can_view`는 캘린더 공개 권한이며 이미지 조회에 재사용하지 않는다. 미인증 401, 잘못된 UUID 400, 탈퇴 중 요청자 409, 대상 미존재/탈퇴 중/관리 이미지 없음/객체 없음 404, 저장소 권한/연결/유효하지 않은 이미지 응답 503이다. DB 존재 여부를 외부 S3 에러 원문으로 구분하지 않는다.

응답은 JPEG/PNG/WebP 바이트, `Cache-Control: private, no-store`, `Vary: Authorization`, `nosniff`이다. 크기 5MB, 핸들러 시작 기준 S3 요청·전달 10초 abort 제한과 클라이언트 연결 종료 시 abort를 적용한다. 스트리밍 시작 후 오류는 연결 종료로 처리한다. 원본의 공개 캐시 헤더·Location·S3 메타데이터는 전달하지 않는다. 새 업로드도 `private, no-store`로 저장한다. 과거 공개 캐시 사본의 회수는 별도 운영 조치다.

객체 key는 `users.profile_image_key`가 정본이며 응답에서 숨긴다. 현재 환경 prefix·소유자 UUID·파일 UUID·확장자를 검증한다. DB CHECK는 소유자/형식을, 읽기 코드는 실제 실행 환경을 검사한다. key 없는 기존 값은 설정된 이전 base URL 또는 현재 bucket의 regional S3 origin과 정확히 일치하는 경로만 호환 조회한다. URL의 query·다른 환경·타인 namespace·임의 경로는 거절한다.

JSON 공통 직렬화는 본인 OAuth/프로필뿐 아니라 raw SQL 친구/그룹과 과거 알림 payload의 `profile_image_url`에도 같은 변환을 적용한다. 식별된 잘못된 관리 원본/S3 URL은 null로 반환한다. 알 수 없는 외부 OAuth URL은 기존대로 유지한다. 사용자가 일반 프로필 수정에 임의 URL을 넣는 경로는 차단하며 기존 URL 유지 또는 null/빈 문자열 제거만 허용한다. `/profile` multipart로 사진만 교체할 수 있고 완료 시각은 유지된다. `/profile/complete`는 가입 필수 필드를 계속 요구한다.

### 적용 순서

1. 대상 DB와 복원 가능한 백업을 확인한다. 초기화용 `final_schema.sql`을 운영에서 실행하지 않는다.
2. pgAdmin에서 `migrations/add_private_profile_images.sql` 전체를 실행한다. 기존 컬럼·URL은 보존하고 nullable key와 검증 제약을 추가한다. idempotent이며 5초 lock timeout의 단일 transaction이다. 새로운 모델을 읽는 API/worker보다 migration을 먼저 적용한다.
3. API 환경에 `PROFILE_IMAGE_API_BASE_URL=https://<실제_API_도메인>`을 넣는다. 경로 없는 서버 HTTPS origin이며 S3 주소가 아니다. production API 시작 시 필수다. 미설정 개발 환경에서는 상대 경로를 반환하므로 앱 API origin에 resolve한다. worker는 이 값을 요구하지 않는다. `PROFILE_IMAGE_PUBLIC_BASE_URL`은 이전 S3/CDN base URL을 인식하는 선택 설정이다. 기존에 저장된 값과 일치하게 유지하며 API 도메인으로 덮어쓰지 않는다.
4. 같은 새 이미지의 제한된 운영 실행 환경에서 아래 명령으로 dry-run 후 적용한다. DB/S3 자격증명이나 사용자 URL을 출력하지 않는다. 이 명령은 S3에 접근하지 않고 DB만 전환한다.

```bash
node dist/scripts/profileImageBackfill.js --dry-run
node dist/scripts/profileImageBackfill.js --apply
```

`eligible`은 검증된 대상, `converted`는 경쟁 없이 갱신된 행, `external_unchanged`는 외부 사진/기타 유지 행, `invalid_managed`는 자동 전환 거절 행이다. invalid가 있으면 종료 코드 2로 끝나며 원본 설정·소유자·환경을 운영 DB에서 확인한다. apply는 행별 조건부 UPDATE로 처리하여 중간 실패 후 재실행 가능하고 동시 이미지 교체를 덮어쓰지 않는다. 검증된 URL만 key+서버 주소로 바꾸며 환경 외 이미지로 강제 전환하지 않는다.

5. 새 API와 worker를 배포한다. backfill 이후 구 API가 원본 URL을 다시 저장할 수 있으므로 업로드를 drain하고 전환하거나 배포 직후 backfill을 재실행한다. 새 서버는 key 없는 검증된 기존 URL도 읽을 수 있다. 신규 업로드·기존 이미지·친구/그룹/알림·탈퇴 사용자 접근을 Stage에서 확인한다. 버킷에는 환경별 GetObject/PutObject/DeleteObject 권한만 필요한 기존 계약을 유지한다. 탈퇴 worker의 목록/버전 삭제 권한은 별도다.
6. Flutter에 아래 인증 이미지 요청을 적용하고 로그인/로그아웃 시 이미지 메모리/디스크 캐시를 사용자별로 분리하거나 비운다. 이미지 교체 후에도 같은 API URL을 사용하므로 해당 NetworkImage provider를 evict하고 다시 표시한다. URL 문자열만 Image.network에 넘기면 401이므로 업로드 성공만으로 E2E 완료로 기록하지 않는다.

```dart
final image_uri = api_origin.resolve(profile_image_url);
// 서버 API 이미지에만 앱 토큰을 보낸다. 외부 OAuth 호스트에는 보내지 않는다.
final is_managed_image = image_uri.origin == api_origin.origin &&
    image_uri.path.startsWith('/api/v1/profile-images/');
Image.network(
  image_uri.toString(),
  headers: is_managed_image
      ? {'Authorization': 'Bearer $access_token'}
      : null,
  errorBuilder: (_, __, ___) => const Icon(Icons.person),
);
```

이미지 요청의 401은 기존 토큰 갱신 정책을 통해 재시도하며 404/503은 기본 아바타로 표시한다. 외부 URL로 토큰을 전송하지 않는다. Flutter Web은 Authorization preflight를 서버 CORS 허용 origin과 함께 확인한다. 사용하는 renderer가 인증 헤더 이미지를 지원하지 않으면 Dio로 인증된 bytes를 받아 Image.memory로 표시한다. 앱에 캐시된 예전 S3 URL은 프로필/친구/그룹 응답을 다시 받아 갱신한다.

### 롤백과 검증

코드 롤백 시 nullable key 컬럼은 유지한다. 구 코드는 서버 이미지 URL을 반환하지만 조회 route가 없으므로 단순 코드 롤백은 이미지 조회 복구를 보장하지 않는다. 필요하면 검증된 key와 원래 base 설정에서 원본 URL을 재생성하되 비공개 직접 읽기 한계가 되돌아온다. 임의 URL을 복원하거나 bucket을 공개로 바꾸지 않는다. 정상 복구는 수정된 API로 전진 배포한다. additive 컬럼 제거는 key 이관/백업과 새 코드 사용 중단을 확인한 별도 작업이며 이번 적용에서는 수행하지 않는다.

로컬: `npm run test:private-profile-integration`은 고정된 격리 PostgreSQL schema를 초기화한다. 로컬 S3 호환 HTTP 서버와 실제 AWS SDK로 업로드·조회 바이트, Authorization 서명, 미인증/탈퇴/환경·소유 경계, AccessDenied/NoSuchKey, dry-run·멱등 전환을 검증한다. 실제 AWS IAM·CDN·Stage 도메인/앱 E2E를 대신하지 않는다.

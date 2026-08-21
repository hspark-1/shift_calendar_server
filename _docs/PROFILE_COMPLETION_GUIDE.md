# 가입 프로필 완료 서버 가이드

## 목적과 정본

`users.profile_completed_at IS NULL`이면 `requires_profile_setup=true`입니다. OAuth 응답의 `is_new_user`는 계정 생성 호환 정보일 뿐 화면 분기 정본이 아닙니다.

요청 흐름은 다음과 같습니다.

```text
auth route → JWT/rate limit → multipart 제한·이미지 검증
  → controller의 object upload → profile service DB transaction/row lock
  → 성공 URL 응답
  → DB 실패 시 새 object 삭제
```

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

> 현재 코드 주의: `src/services/profileImageStorageService.ts`는 아직 `PutObject`/`DeleteObject`와 `PROFILE_IMAGE_PUBLIC_BASE_URL` 기반 공개 URL 생성만 구현되어 있습니다. 비공개 S3 `GetObject`를 스트리밍하는 인증 API와 DB object key 정본 전환은 아직 구현되지 않았습니다. 따라서 임의의 공개 URL을 넣어 우회하지 말고, 비공개 조회 구현을 배포하기 전까지 Stage 이미지 E2E를 완료된 것으로 판단하지 않습니다.

### 현재 구현 환경변수

API 프로세스에 다음 값을 환경별로 설정합니다.

```env
PROFILE_IMAGE_STORAGE_BUCKET=<ENV_BUCKET>
PROFILE_IMAGE_STORAGE_REGION=<REGION_OR_AUTO>
PROFILE_IMAGE_STORAGE_PREFIX=<local|test|stage|center>
PROFILE_IMAGE_STORAGE_ENDPOINT=<S3_COMPATIBLE_ENDPOINT_OR_EMPTY>
PROFILE_IMAGE_STORAGE_FORCE_PATH_STYLE=false
PROFILE_IMAGE_PUBLIC_BASE_URL=https://<ENV_CDN_DOMAIN>
```

AWS workload role을 사용할 수 없고 S3 호환 공급자가 static credential을 요구할 때만 `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`를 secret으로 주입합니다. bucket은 API에 `PutObject`, 실패 정리에 `DeleteObject` 권한이 필요합니다. CORS 공개 쓰기는 허용하지 않고 CDN/origin은 HTTPS GET만 제공합니다.

## API 계약

- `POST /api/v1/auth/profile/complete`: JSON 또는 `profile_image` 하나가 포함된 multipart, HTTP 200
- `GET /api/v1/auth/profile`: 본인 필드와 `requires_profile_setup`
- `POST /api/v1/auth/profile`: 생략 필드 유지, 선택 필드 명시적 null 제거, 완료 시각 불변

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
- `src/services/profileImageStorageService.ts`: S3 Put/Delete와 public URL 생성
- `src/openapi/profileAuthOpenApi.json`: 공개 API/오류 정본
- `migrations/*profile_completion*`: 범용·Stage·Center apply와 제한적 rollback
- `test/profileCompletion*.test.cjs`: 정적/단위와 격리 PostgreSQL HTTP·migration 검증

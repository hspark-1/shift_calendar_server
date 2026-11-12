# Google 소셜 로그인 서버 가이드

## 범위

Flutter가 전달한 Google ID Token을 서버가 공식 `google-auth-library`로 검증한 뒤 기존 ShiftMate Access/Refresh Token을 발급합니다. 로그인 endpoint는 feature flag 없이 항상 활성화됩니다.

## 인증 흐름

1. 클라이언트가 Google Sign-In으로 ID Token을 획득합니다.
2. `POST /api/v1/auth/google/token`에 `id_token`을 전달합니다.
3. 서버가 서명, issuer, Web client audience, 만료 및 verified email을 검증합니다.
4. Google `sub`를 사용자 식별 정본인 `users.google_id`로 저장합니다.
5. 신규 사용자, 기본 근무 템플릿과 ShiftMate refresh token을 한 transaction으로 생성합니다.

검증 이메일이 기존 사용자와 같더라도 자동 연결하지 않고 `ACCOUNT_LINK_REQUIRED`를 반환합니다.

## 사진 수집 중단·선택 전화번호 연동 (2026-11-13)

**Behavior change / ADR-0049**: `picture` claim을 읽지 않고 신규 `profile_image_url`은 null로 저장합니다. 기존 사진/key·사용자 업로드 사진은 보존합니다. 기본 profile 범위 때문에 SDK/ID Token에 사진 정보가 포함될 수 있지만 앱에서 사진을 추출·전송하거나 서버 사용자 필드에 저장하지 않습니다.

```text
Flutter 로그인 → authenticate → ID Token
  → 계정별 authorizationForScopes / 필요 시 authorizeScopes
  → { id_token, access_token? } → POST /api/v1/auth/google/token
  → ID Token 검증 → 같은 access token의 OIDC userinfo.sub 대조
  → People API PROFILE phoneNumbers → 사용자 행 잠금
  → 신규/빈 phone·기본 템플릿·앱 세션 transaction
  → AuthResponse.user.phone → 기존 가입 화면 미리 채움
```

- 요청 예: `{ "id_token": "google-id-token", "access_token": "google-phone-access-token" }`. access_token은 선택이며 구형 ID Token 전용 앱도 지원합니다. 두 토큰은 문자열·trim 후1~16384자입니다. 요청 body phone/사진은 신뢰하지 않습니다.
- Flutter `google_sign_in`7.2.0의 인증 계정 authorizationClient에 기본 OIDC와 `https://www.googleapis.com/auth/user.phonenumbers.read`를 요청합니다. 기존 승인은 재사용하고 추가 동의는 로그인 사용자 액션에서 요청합니다. 선택 권한 취소/거부·SDK 권한 오류는 ID Token 로그인을 유지합니다. 기본 인증 자체의 취소 처리는 유지합니다.
- 서버는 같은 access token으로 `https://openidconnect.googleapis.com/v1/userinfo`의 sub를 검증된 ID Token sub와 대조합니다. 다른 계정은 `401 GOOGLE_INVALID_TOKEN`이며 번호를 조회/저장하지 않습니다. People API에는 `personFields=phoneNumbers&sources=READ_SOURCE_TYPE_PROFILE`만 요청합니다. 연락처/사진 필드는 요청하지 않습니다.
- 선택 token 미제공/만료·외부 API 장애·번호 미제공은 직접 입력으로 진행합니다. 외부 HTTP는 DB transaction 밖에서 호출하며 요청별5초 timeout·64KiB 응답 제한·redirect 금지입니다. Google token/원문 응답은 저장·로그·오류에 포함하지 않습니다.
- canonicalForm 우선으로 국내 휴대전화01x/`+82`만 기존 하이픈 형식으로 변환합니다. 외국/유선/잘못된 번호는 저장하지 않습니다. 유효 번호가 하나면 사용하고 여러 개면 명확한 primary 하나만 사용하며 나머지는 직접 입력합니다. 전역 phone 유틸/DB 정책은 변경하지 않습니다.
- 신규/기존 null phone만 보완하고 기존 번호·이메일·이름·사진/key·profile_completed_at은 보존합니다. 가입 완료는 기존 `/auth/profile/complete`가 담당합니다. 번호를 계정 연결/병합이나 SMS 소유 인증의 근거로 사용하지 않습니다.
- 전화번호 사전 중복/DB unique 경쟁은 `409 PHONE_ALREADY_EXISTS`, 탈퇴 진행은 `409 ACCOUNT_DELETION_IN_PROGRESS`입니다. 사용자 행 잠금으로 프로필 편집과 직렬화하고 번호/계정/기본 템플릿/앱 세션은 한 transaction으로 저장합니다. 이메일 자동 연결 금지는 유지합니다.

### 적용·검증·롤백

사용자가 제공한 콘솔 화면에는 openid·userinfo.email·userinfo.profile·user.phonenumbers.read가 **민감하지 않은 범위**에 등록되어 있습니다. 전화번호 범위를 민감하다고 단정했던 이전 안내는 이 화면의 실제 분류로 정정합니다. People API 활성화·실계정 제공 정보·동의/게시 상태는 이 화면만으로 확정하지 않습니다.

1. 해당 프로젝트 People API 활성화·기존 Web/iOS/Android client를 확인합니다. 새 API key/client secret/서버 env/운영 migration/seed/패키지는 필요 없습니다.
2. 서버를 먼저 배포한 뒤 Flutter 앱을 재빌드/설치합니다. 콘솔 등록만으로 구형 앱에 번호가 생기지는 않습니다.
3. Stage iOS/Android에서 신규 번호·기존 빈 번호·기존 번호/사진 보존·선택 동의 취소/거부·미제공·중복409·다른 계정401·직접 입력 후 프로필 완료·로그아웃/탈퇴를 확인합니다. 모든 Google 사용자의 번호 수신을 보장하지 않습니다.
4. 롤백은 앱 선택 권한 요청과 서버 번호 보완을 이전 코드로 복구하고 저장된 phone/기존 사진은 유지합니다. 기존 Google 사진 일괄 삭제는 수행하지 않습니다.

### 파일 역할·의존성·사용 예

- 기존 `src/services/googleService.ts`: 기존 axios로 OIDC/People API 계정 대조·전화번호 선택/정규화·원자 저장. http_client 주입으로 외부 API를 모의 검증합니다.
- 기존 routes/authRoutes.ts·controllers/authController.ts·openapi/googleAuthOpenApi.json: 선택 access_token validation/전달·응답/오류 계약입니다.
- 기존 test/googleAuth.test.cjs·googleAuthIntegration.test.cjs·fixtures/googleAuthMigrationBaseSchema.sql: 단위/실제 HTTP·격리DB/unique·경합/rollback 검증입니다. fixture의 phone unique/CHECK는 테스트 전용입니다. 확장 HTTP suite의 요청 제한200회도 테스트 프로세스에만 적용합니다.
- Flutter 기존 google_login_service.dart·auth_repository_impl.dart·auth_remote_datasource.dart: 메모리의 GoogleLoginCredential을 서버로 전달하고 앱 JWT만 영구 저장합니다. 기존 User/가입 화면의 phone 미리 채움·사진 null 아바타를 재사용하며 provider 수명·route·테마·UI는 바꾸지 않습니다. 신규 영구 파일은 없습니다.
- 서버: `npm run build`, `node --test test/googleAuth.test.cjs`, 폐기용 전용 PostgreSQL에서 `npm run test:google-integration`. Flutter: `flutter test --no-pub test/features/auth --dart-define=KAKAO_NATIVE_APP_KEY_STAGE=test-stage-key`. 최종 결과·실계정 미검증 한계는 양 프로젝트 WORKLOG를 따릅니다.
- 공식 근거: [Flutter SDK7.2.0](https://pub.dev/packages/google_sign_in/versions/7.2.0), [OIDC userinfo](https://developers.google.com/identity/openid-connect/openid-connect), [People API get](https://developers.google.com/people/api/rest/v1/people/get).

## 최초 수집 정보 조사 기록 (2026-11-13, 위 후속 구현 전)

최초 조사 시 `src/services/googleService.ts`에서 검증된 ID Token으로 사용하던 정보는 다음과 같습니다. 현재 계약은 위 후속 구현 절이 우선합니다.

| Google claim | 처리/저장 |
| --- | --- |
| `sub` | 필수 계정 식별자. `users.google_id`에 저장 |
| `email` | trim/lowercase 후 `users.email`에 신규 저장 |
| `email_verified` | true인지 검증하며 별도 컬럼에는 저장하지 않음 |
| `name` | 유효하면 신규 이름으로 저장. 없거나 부적합하면 이메일 @ 앞부분 사용 |
| `picture` | 유효한 HTTPS URL이면 신규 `profile_image_url`에 저장. 그 외 null |

기존 Google 계정의 이메일·이름·사진은 재로그인 시 자동 갱신하지 않습니다. 신규 `timezone=Asia/Seoul`은 서버 기본값이며 Google에서 가져온 정보가 아닙니다. 현재 Google 로그인 흐름은 전화번호·생년월일·성별·주소·연락처·Google Calendar/Drive 데이터를 가져오지 않습니다.

인접 Flutter 프로젝트의 `_docs/GOOGLE_SIGN_IN_SERVER_GUIDE.md` 9절은 기본 OIDC 프로필만 사용하고 추가 API scope를 요청하지 않는다고 기록합니다. 실제 `lib/features/auth/data/services/google_login_service.dart`도 `GoogleSignIn.instance.initialize()`와 인자 없는 `authenticate()` 후 ID Token만 반환하며 별도 권한 요청을 하지 않습니다.

확인한 문서는 구현 정책이며, 실제 Google Cloud 콘솔에 등록된 scope 목록의 현재 상태를 증명하지는 않습니다. 이번 조사에서 콘솔·실계정 동의 화면·운영 토큰은 조회하지 않았습니다.

콘솔 설정을 확인하려면:

1. [Google Cloud Console](https://console.cloud.google.com/)에서 로그인용 프로젝트를 선택합니다. 프로젝트가 불확실하면 Google Auth platform → Clients에서 Web client ID가 앱/서버의 `GOOGLE_SERVER_CLIENT_ID`와 같은지 확인합니다.
2. Google Auth platform → Data Access(데이터 액세스)에서 등록된 비민감·민감·제한 scope 목록을 확인합니다. 필요하면 Add or Remove Scopes(범위 추가 또는 삭제)를 열어 선택된 항목을 확인합니다.
3. 기본 로그인 범위인 `openid`, `email` 또는 `https://www.googleapis.com/auth/userinfo.email`, `profile` 또는 `https://www.googleapis.com/auth/userinfo.profile`에 대응하는 항목을 확인하고, 다른 scope가 등록되어 있는지도 확인합니다. 이는 확인할 항목의 안내이며 실제 등록 목록을 확정한 기록이 아닙니다.

콘솔에 등록된 범위, 앱이 요청하는 범위, 사용자가 승인한 범위, 서버가 저장하는 필드는 구분해야 합니다. 위 표는 현재 서버 코드의 저장/검증 동작입니다.

공식 근거: [콘솔 Data Access 확인 경로](https://developers.google.com/workspace/guides/configure-oauth-consent), [OIDC scope 및 claim 의미](https://developers.google.com/identity/openid-connect/openid-connect), [Google API scope 목록](https://developers.google.com/identity/protocols/oauth2/scopes).

## 공개 API

- `POST /api/v1/auth/google/token`

상세 request/response와 오류 코드는 `src/openapi/googleAuthOpenApi.json`이 정본입니다. 신규 사용자는 HTTP 201, 기존 사용자는 HTTP 200을 반환하며 `is_new_user`는 항상 boolean입니다.

## DB와 환경변수

- Migration: `migrations/add_google_auth_support.sql`
- 사전 검사: `migrations/google_auth_preflight.sql`
- 사후 검사: `migrations/google_auth_postflight.sql`
- 제한적 롤백: `migrations/rollback_google_auth_support.sql`

`GOOGLE_SERVER_CLIENT_ID`에는 서버가 audience로 검증할 Web application OAuth client ID를 설정합니다. 실제 client ID나 환경별 프로젝트 식별값은 Git에 저장하지 않습니다.

## 검증

```bash
npm test
npm run test:google-integration
```

통합 테스트는 폐기 가능한 격리 PostgreSQL에서만 실행하고 실제 운영 DB를 대상으로 실행하지 않습니다.

## 롤백

프록시/WAF 또는 이전 이미지로 신규 요청을 차단합니다. nullable `google_id` 컬럼과 partial unique index는 애플리케이션 롤백 동안 유지합니다. 연결 데이터가 없고 별도 승인을 받은 경우에만 제공된 rollback SQL을 사용합니다.

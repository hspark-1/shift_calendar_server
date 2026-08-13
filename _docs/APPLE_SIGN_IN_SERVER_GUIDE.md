# Apple 소셜 로그인 서버 가이드

## 범위

서버가 Apple authorization code와 identity token을 검증한 뒤 기존 ShiftMate Access/Refresh Token을 발급합니다. 로그인 endpoint는 feature flag 없이 항상 활성화되며 필요한 DB 스키마와 환경변수를 시작 전에 검증합니다.

## 인증 흐름

1. `POST /api/v1/auth/apple/challenge`가 플랫폼별 일회성 `state`와 `nonce`를 발급합니다.
2. 클라이언트가 Apple 인증을 완료합니다.
3. Android/Web form post는 `POST /api/v1/auth/apple/callback`에서 앱으로 전달할 값만 검증합니다.
4. `POST /api/v1/auth/apple`이 code를 교환하고 JWKS 기반 identity token 검증을 수행합니다.
5. 신규 사용자, 기본 근무 템플릿, OAuth authorization, ShiftMate refresh token을 한 transaction으로 저장합니다.

`state`와 `nonce` 원문은 저장하지 않고 SHA-256 hash만 저장합니다. Apple refresh token은 앱 JWT refresh token과 분리해 AES-256-GCM으로 암호화합니다.

## 공개 API

- `POST /api/v1/auth/apple/challenge`
- `POST /api/v1/auth/apple/callback`
- `POST /api/v1/auth/apple`

상세 request/response와 오류 코드는 `src/openapi/appleAuthOpenApi.json`이 정본입니다. 성공 응답의 `data.is_new_user`는 boolean이며 `data.expires_at`은 Unix epoch milliseconds입니다. 검증 이메일이 기존 사용자와 충돌하면 자동 연결하지 않고 `409 ACCOUNT_LINK_REQUIRED`를 반환합니다.

callback은 `code`, `id_token`, `state`, `user`, `error`만 허용하며 challenge를 소비하거나 앱 세션을 만들지 않습니다. 앱 package, scheme, intent URI 같은 클라이언트 식별값은 공개 서버 문서에 고정하지 않고 환경별 비공개 배포 구성에서 관리합니다.

## DB migration

- 사전 검사: `migrations/apple_auth_preflight.sql`
- 적용: `migrations/add_apple_auth_support.sql`
- 사후 검사: `migrations/apple_auth_postflight.sql`
- 제한적 롤백: `migrations/rollback_apple_auth_support.sql`

환경마다 복원 가능한 백업과 대상 DB를 확인한 뒤 개발자가 psql로 직접 실행합니다. 실제 DB명, 백업 식별자·checksum, 호스트 경로와 환경별 pgAdmin wrapper는 공개 저장소 밖에서 관리합니다.

```bash
psql "$DATABASE_URL" -X \
  -v expected_database=<TARGET_DATABASE> \
  -f migrations/apple_auth_preflight.sql

psql "$DATABASE_URL" -X \
  -f migrations/add_apple_auth_support.sql

psql "$DATABASE_URL" -X \
  -v expected_database=<TARGET_DATABASE> \
  -v expect_apple_tables_empty=true \
  -f migrations/apple_auth_postflight.sql
```

- `oauth_login_challenges`: state/nonce hash, platform/client/redirect, 만료·소비 상태
- `oauth_authorizations`: Apple subject/client와 계정 삭제 revoke용 refresh token 암호문
- 기존 `refresh_tokens`: ShiftMate JWT refresh token SHA-256 hash
- migration은 add-only이며 API 시작 시 자동 실행하지 않습니다.

rollback은 두 신규 테이블이 모두 0건이고 별도 승인을 받은 경우에만 허용합니다. 로그인 데이터가 생긴 뒤에는 테이블을 삭제하지 말고 요청 차단과 이전 이미지로 복구합니다.

## Apple Developer Portal 설정

서버 배포 전에 다음을 확인합니다.

1. 앱의 Primary App ID에서 Sign in with Apple을 활성화합니다.
2. 환경별 Services ID와 HTTPS Return URL을 각각 등록합니다.
3. Sign in with Apple capability가 연결된 private key를 생성하고 Key ID를 보관합니다.
4. Team ID, Key ID, iOS client ID, 환경별 Services ID/redirect URI가 Portal 값과 정확히 일치하는지 확인합니다.
5. Server-to-Server Notification Endpoint는 계정 삭제/revoke 수신 기능을 구현·검증한 뒤 등록합니다.

`.p8`는 한 번만 다운로드할 수 있으므로 안전한 비밀 저장소에 보관합니다. Git, Docker image, 로그, 문서와 `.env`에 원문을 넣지 않습니다. APNs key를 재사용하려면 해당 key에 Sign in with Apple capability와 올바른 Primary App ID 연결이 명시적으로 확인되어야 합니다.

- [Sign in with Apple 구성](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web)
- [Sign in with Apple private key 생성](https://developer.apple.com/help/account/capabilities/create-a-sign-in-with-apple-private-key)

## 환경변수와 secret

필요한 변수 이름과 placeholder는 `.env.example`을 따릅니다.

```env
APPLE_TEAM_ID=<APPLE_TEAM_ID>
APPLE_KEY_ID=<APPLE_KEY_ID>
APPLE_IOS_CLIENT_ID=<IOS_BUNDLE_ID>
APPLE_SERVICE_ID=<ENVIRONMENT_SERVICE_ID>
APPLE_REDIRECT_URI=https://<ENVIRONMENT_API_DOMAIN>/api/v1/auth/apple/callback
APPLE_PRIVATE_KEY_PATH=/run/secrets/apple_signin.p8
APPLE_TOKEN_ENCRYPTION_KEY=<32_RANDOM_BYTES_BASE64>
APPLE_CHALLENGE_TTL_SECONDS=300
APPLE_JWKS_CACHE_SECONDS=21600
```

- 실제 Team ID, Key ID, client ID, 도메인, 암호화 키와 private key는 저장소에 기록하지 않습니다.
- 환경별 Services ID, redirect URI와 encryption key를 분리합니다.
- encryption key는 기존 Apple refresh token 복호화에 필요한 영속 키이므로 백업·복구 절차 없이 교체하지 않습니다.
- API 컨테이너에만 `.p8`을 read-only mount하고 cache/push worker에는 전달하지 않습니다.

## 단계별 배포

1. Portal의 App ID, 환경별 Services ID/Return URL과 private key를 준비합니다.
2. 환경별 DB 백업 후 preflight → migration → postflight를 실행하고 결과를 비공개 운영 기록에 남깁니다.
3. 검증 환경에 Apple secret과 필수 환경변수를 주입한 뒤 이미지를 배포하고 기존 인증과 Apple endpoint를 검증합니다.
4. 검증 완료 후 운영 환경에도 동일한 필수 구성을 준비해 배포합니다.
5. iOS/Android 실기기에서 신규/기존/취소/만료/replay/relay email/callback을 검증합니다.
6. 계정 삭제와 Apple token revoke를 별도 구현·검증한 뒤 운영 활성화를 승인합니다.

## 테스트와 관측

```bash
npm test
npm run test:apple-integration
```

통합 테스트는 폐기 가능한 격리 PostgreSQL에서만 실행하고 공유 개발·운영 DB를 대상으로 실행하지 않습니다. 구조화 로그에는 token, code, email, subject, private key를 기록하지 않습니다.

## 롤백

프록시/WAF 또는 이전 이미지로 신규 요청을 차단하고 이전 애플리케이션 이미지를 복구합니다. 스키마는 add-only이므로 애플리케이션 롤백 동안 유지합니다. OAuth 데이터가 없고 별도 승인을 받은 경우에만 제공된 rollback SQL을 사용합니다.

## 파일 역할

- `src/services/appleService.ts`: challenge, code 교환, JWKS/claim 검증과 refresh token 암복호화
- `src/models/OAuthLoginChallenge.ts`, `src/models/OAuthAuthorization.ts`: Apple 보조 테이블 Sequelize 매핑
- `src/openapi/appleAuthOpenApi.json`: 공개 endpoint와 오류 응답 계약
- `migrations/*apple_auth*`: 공개 가능한 범용 preflight/apply/postflight/제한적 rollback
- `test/appleAuth*.test.cjs`: crypto, HTTP, migration과 transaction 회귀 검증

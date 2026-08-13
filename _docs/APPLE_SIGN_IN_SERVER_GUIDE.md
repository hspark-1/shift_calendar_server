# Apple 소셜 로그인 서버 가이드

## 범위

서버가 Apple authorization code와 identity token을 검증한 뒤 기존 ShiftMate Access/Refresh Token을 발급합니다. 기능은 기본적으로 비활성화되어 있으며 필요한 DB 스키마와 환경변수가 준비된 환경에서만 활성화합니다.

## 인증 흐름

1. `POST /api/v1/auth/apple/challenge`가 플랫폼별 일회성 `state`와 `nonce`를 발급합니다.
2. 클라이언트가 Apple 인증을 완료합니다.
3. Android/Web form post는 `POST /api/v1/auth/apple/callback`에서 검증합니다.
4. `POST /api/v1/auth/apple`이 code를 교환하고 JWKS 기반 identity token 검증을 수행합니다.
5. 신규 사용자, 기본 근무 템플릿, OAuth authorization, ShiftMate refresh token을 한 transaction으로 저장합니다.

`state`와 `nonce` 원문은 저장하지 않고 SHA-256 hash만 저장합니다. Apple refresh token은 앱 JWT refresh token과 분리해 AES-256-GCM으로 암호화합니다.

## 공개 API

- `POST /api/v1/auth/apple/challenge`
- `POST /api/v1/auth/apple/callback`
- `POST /api/v1/auth/apple`

상세 request/response와 오류 코드는 `src/openapi/appleAuthOpenApi.json`이 정본입니다. 검증 이메일이 기존 사용자와 충돌하면 자동 연결하지 않고 `ACCOUNT_LINK_REQUIRED`를 반환합니다.

## DB와 환경변수

- Migration: `migrations/add_apple_auth_support.sql`
- 사전 검사: `migrations/apple_auth_preflight.sql`
- 사후 검사: `migrations/apple_auth_postflight.sql`
- 제한적 롤백: `migrations/rollback_apple_auth_support.sql`

필요한 환경변수 이름은 `.env.example`을 따릅니다. 실제 Team ID, Key ID, client ID, 암호화 키 및 private key는 Git에 저장하지 않습니다. `APPLE_AUTH_ENABLED=false`일 때는 Apple 전용 비밀값 없이 기존 서버가 기동할 수 있어야 합니다.

## 검증

```bash
npm test
npm run test:apple-integration
```

통합 테스트는 폐기 가능한 격리 PostgreSQL에서만 실행하고 실제 운영 DB를 대상으로 실행하지 않습니다.

## 롤백

먼저 `APPLE_AUTH_ENABLED=false`로 신규 요청을 차단합니다. 스키마는 add-only이므로 애플리케이션 롤백 동안 유지합니다. OAuth 데이터가 없고 별도 승인을 받은 경우에만 제공된 rollback SQL을 사용합니다.

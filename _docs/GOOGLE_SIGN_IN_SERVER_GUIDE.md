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

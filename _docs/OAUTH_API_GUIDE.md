# OAuth 소셜 로그인 API 가이드

## 개요

이 문서는 카카오, 네이버, Apple 및 Google 소셜 로그인 기능의 백엔드 API 사용 가이드입니다. Apple·Google 서버 검증 계약은 각각 `_docs/APPLE_SIGN_IN_SERVER_GUIDE.md`, `_docs/GOOGLE_SIGN_IN_SERVER_GUIDE.md`를 따릅니다.

### 기본 정보

- **Base URL**: `/api/v1/auth`
- **Content-Type**: `application/json`
- **인증 방식**: OAuth 2.0 (Authorization Code / Access Token)

### 응답 형식

```typescript
// 성공 응답
{
  "success": true,
  "message": "로그인 성공" | "회원가입이 완료되었습니다.",
  "data": {
    "user": {
      "user_id": "uuid",
      "email": "user@example.com",
      "name": "사용자 이름",
      "profile_image_url": "https://...",
      "phone": "010-1234-5678", // nullable. 네이버 로그인도 지원
      "kakao_id": "카카오 ID (카카오 로그인 시)",
      "apple_id": "Apple 검증 subject (Apple 로그인 시)",
      "google_id": "Google 검증 subject (Google 로그인 시)",
      "naver_id": "네이버 ID (네이버 로그인 시)",
      "timezone": "Asia/Seoul",
      "created_at": "2026-01-11T12:00:00.000Z"
    },
    "access_token": "JWT access token",
    "refresh_token": "JWT refresh token",
    "expires_at": 1234567890000,
    "is_new_user": "Apple·Google 응답에서는 항상 boolean"
  }
}

// 실패 응답
{
  "success": false,
  "message": "에러 메시지"
}
```

---

## Apple 로그인

- `POST /api/v1/auth/apple/challenge`: 플랫폼별 일회성 state/nonce 발급
- `POST /api/v1/auth/apple/callback`: form post 응답 검증 및 앱 callback 전달
- `POST /api/v1/auth/apple`: authorization code와 identity token을 서버에서 검증하고 ShiftMate JWT 발급
- 검증 이메일이 기존 계정과 같아도 자동 연결하지 않고 `409 ACCOUNT_LINK_REQUIRED`를 반환합니다.
- Apple 로그인은 서버에서 항상 활성화되며 필수 환경값과 `.p8`을 시작 전에 검증합니다.

## Google 로그인

- `POST /api/v1/auth/google/token`: Flutter가 전달한 Google ID Token을 서버에서 검증하고 ShiftMate JWT 발급
- 서버는 서명, issuer, audience, 만료 및 verified email을 검증하고 `sub`를 사용자 식별자로 저장합니다.
- 검증 이메일이 기존 계정과 같아도 자동 연결하지 않고 `409 ACCOUNT_LINK_REQUIRED`를 반환합니다.
- Google 로그인은 서버에서 항상 활성화되며 `GOOGLE_SERVER_CLIENT_ID`를 시작 전에 검증합니다.
- **2026-11-13 Behavior change**: 사진 claim은 신규 수집하지 않습니다. 선택 `access_token`으로 같은 Google 계정을 대조하고 People API 번호를 신규/기존 빈 phone에만 저장합니다. 번호 미제공·선택 동의 거부는 직접 입력으로 진행합니다. 기존 사진·번호·완료 상태는 보존하며 충돌409/계약·배포 순서는 Google 서버 가이드 상단을 따릅니다.

---

## 네이버 OAuth 로그인

### 사진 동의 제거·휴대전화번호 추가 (2026-11-13)

- 서버는 `GET https://openapi.naver.com/v1/nid/me`의 `response.mobile`만 정규화해 저장한다. 사진은 반환되어도 사용하지 않는다. 신규 사용자의 사진은 null이며 기존 사진/업로드 key는 유지한다.
- 신규 가입과 기존 `users.phone IS NULL` 계정만 번호를 저장한다. 기존 번호는 덮어쓰지 않고 전화번호를 계정 연결 기준으로 쓰지 않는다. 기존 이메일 연결은 유지하되 다른 naver_id가 이미 연결되었으면409 NAVER_ACCOUNT_CONFLICT다.
- 저장 형식은 `010-1234-5678` 등의 기존 하이픈 형식이다. 10~11자리 숫자도 정규화하며 누락/지원하지 않는 형식·국제번호는 null로 두고 기존 가입 입력 화면을 이용한다. 네이버 전화번호 필수/선택 설정과 실제 기존 사용자 제공 여부는 개발자센터·실기기에서 확인한다.
- `data.user.phone`은 nullable string, `data.user.profile_image_url`은 nullable string이다. `data.requires_profile_setup`은 profile_completed_at 정본을 유지하며 번호 수신만으로 false가 되지 않는다.
- 두 URL/code·access_token 요청,200 성공 wrapper/JWT 필드를 유지한다. 전화번호 중복은409 PHONE_ALREADY_EXISTS, 탈퇴 진행은409 ACCOUNT_DELETION_IN_PROGRESS다. 명시적 인증 오류401·외부 장애503·내부 오류500에는 안전한 문구만 반환한다. 기존 앱 호환을 위해 최상위 `message`와 `error: {code,message}`, `request_id`를 함께 반환한다. route validation400에는 중첩 error와 request_id를 사용한다.
- Flutter 확인 결과: `naver_login_service.dart`는 SDK 토큰만 전달하며 프로필 사진/번호 동의를 직접 요구하지 않는다. User는 nullable phone/사진을 파싱하고 ProfileSetupPage는 phone 미리 채움·기본 아바타·직접 입력을 지원한다. 네이버 DataSource는 최상위 message를 Exception으로 전달하고 Provider/LoginPage가 표시하므로 필수 앱 수정은 없다. 오류 code/request_id를 이용한 분기가 필요할 때 공통 `handleApiError()` 적용을 별도 검토한다. 앱 코드/SDK 설정은 이번에 변경하지 않았다.
- 실기기 인수: 신규/기존 동의 계정, 번호 제공/미제공, 기존 번호·사진 보존, 번호 중복 안내를 Stage에서 확인한다. 기존 거부 항목의 재동의는 [네이버 개발가이드](https://developers.naver.com/docs/login/devguide/devguide.md)의 별도 인증 흐름이며 서버가 설정 변경만으로 과거 동의를 획득했다고 간주하지 않는다.
- 파일 역할/의존성/사용 예: `src/openapi/naverAuthOpenApi.json`은 두 네이버 URL의 요청·응답/오류와 기존 OwnProfile을 참조하며 `src/openapi.ts`가 병합한다. `API_DOCS_ENABLED=true`에서 `/api-docs/openapi.json`으로 확인한다. `test/naverAuth.test.cjs`는 Axios 모의 응답으로 mobile/사진/외부 오류를 확인하며 build 후 `node --test test/naverAuth.test.cjs`로 실행한다. `test/naverAuthIntegration.test.cjs`는 최종 DDL·실제 route/Sequelize/PostgreSQL에 의존하고 외부 네이버만 모의 처리한다. 전용 DB에서만 schema reset을 허용한다.

격리 DB 검증 예(운영/공유 DB에서는 실행하지 않는다):

```bash
docker run --name shiftmate-naver-test -e POSTGRES_DB=shift_calendar_naver_test -e POSTGRES_USER=naver_test -e POSTGRES_PASSWORD=naver_test_local_only -p 127.0.0.1:55433:5432 -d postgres:16-alpine
# PostgreSQL 준비 완료 후 실행
npm run test:naver-integration
docker rm -f -v shiftmate-naver-test
```

- 배포 영향/롤백: 모델/DDL 기준 DB migration·추가 env·seed가 없다. 기존 서버로 복구 시 수집된 phone/기존 사진을 삭제하지 않는다. 운영 반영 전 실제 대상 DB의 기존 phone CHECK/unique를 확인하고 서버를 배포한다. 기존 사진 정리는 별도 정책 없이 일괄 수행하지 않는다.

### 1. 네이버 로그인 (WebView 방식 - Authorization Code)

네이버 OAuth 인증 페이지에서 받은 authorization code를 사용하여 로그인합니다.

#### 사전 준비

1. **네이버 개발자 센터** (https://developers.naver.com) 접속
2. 애플리케이션 등록 및 Client ID, Client Secret 발급
3. Callback URL 등록 (예: `http://localhost:3000/test/callback.html`)
4. 제공 정보 동의 항목 설정: 이메일 제공 필요, 프로필 사진 제외, 휴대전화번호 추가. 전화번호 필수/선택 여부는 실제 서비스 설정에 맞춰 확인한다.

#### OAuth 인증 흐름

```mermaid
sequenceDiagram
    participant Client as 클라이언트
    participant Naver as 네이버 OAuth
    participant API as 백엔드 API

    Client->>Naver: 1. 인증 요청 (Client ID, Redirect URI)
    Naver->>Client: 2. 사용자 로그인 및 동의
    Naver->>Client: 3. Authorization Code 반환
    Client->>API: 4. POST /auth/naver (code, redirect_uri)
    API->>Naver: 5. 토큰 교환 (code → access_token)
    API->>Naver: 6. 사용자 정보 조회
    API->>Client: 7. JWT 토큰 + 사용자 정보 반환
```

#### Request

```
POST /api/v1/auth/naver
```

**Headers**

```
Content-Type: application/json
```

**Body**

```json
{
  "code": "네이버에서 받은 authorization code",
  "redirect_uri": "등록된 redirect URI",
  "state": "CSRF 방지 토큰 (선택)"
}
```

| 파라미터       | 타입   | 필수 | 설명                                                          |
| -------------- | ------ | ---- | ------------------------------------------------------------- |
| `code`         | string | Y    | 네이버 OAuth 인증 후 받은 authorization code                  |
| `redirect_uri` | string | Y    | 네이버 개발자 센터에 등록된 Callback URL (정확히 일치해야 함) |
| `state`        | string | N    | CSRF 공격 방지를 위한 랜덤 문자열 (권장)                      |

#### Response

**성공 (200 OK)**

```json
{
  "success": true,
  "message": "로그인 성공",
  "data": {
    "user": {
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "name": "홍길동",
      "profile_image_url": "https://ssl.pstatic.net/static/pwe/address/img_profile.png",
      "naver_id": "네이버_고유_ID",
      "timezone": "Asia/Seoul",
      "created_at": "2026-01-11T12:00:00.000Z"
    },
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_at": 1704974400000
  }
}
```

**실패 (400 Bad Request)**

```json
{
  "success": false,
  "message": "Authorization code가 필요합니다."
}
```

```json
{
  "success": false,
  "message": "네이버 계정에 이메일 정보가 없습니다. 이메일 제공에 동의해주세요."
}
```

#### 에러 코드

| HTTP 상태 | 메시지                                       | 설명                       |
| --------- | -------------------------------------------- | -------------------------- |
| 400       | "Authorization code가 필요합니다."           | code 파라미터 누락         |
| 400       | "redirect_uri가 필요합니다."                 | redirect_uri 파라미터 누락 |
| 400       | "네이버 토큰 교환에 실패했습니다."           | 네이버 API 토큰 교환 실패  |
| 400       | "네이버 계정에 이메일 정보가 없습니다."      | 이메일 제공 동의 필요      |
| 500       | "네이버 로그인 처리 중 오류가 발생했습니다." | 서버 내부 오류             |

#### 사용 예시

**JavaScript (브라우저)**

```javascript
// 1. 네이버 OAuth 인증 페이지로 이동
const clientId = "YOUR_NAVER_CLIENT_ID";
const redirectUri = "http://localhost:3000/test/callback.html";
const state = Math.random().toString(36).substring(2, 15);

const naverAuthUrl = new URL("https://nid.naver.com/oauth2.0/authorize");
naverAuthUrl.searchParams.set("client_id", clientId);
naverAuthUrl.searchParams.set("redirect_uri", redirectUri);
naverAuthUrl.searchParams.set("response_type", "code");
naverAuthUrl.searchParams.set("state", state);

window.location.href = naverAuthUrl.toString();

// 2. Callback에서 authorization code 받기
const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get("code");
const returnedState = urlParams.get("state");

// 3. 서버 API 호출
const response = await fetch("http://localhost:3000/api/v1/auth/naver", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    code: code,
    redirect_uri: redirectUri,
    state: returnedState,
  }),
});

const data = await response.json();
if (data.success) {
  console.log("로그인 성공:", data.data.user);
  // JWT 토큰 저장
  localStorage.setItem("access_token", data.data.access_token);
  localStorage.setItem("refresh_token", data.data.refresh_token);
}
```

**cURL**

```bash
curl -X POST http://localhost:3000/api/v1/auth/naver \
  -H "Content-Type: application/json" \
  -d '{
    "code": "네이버에서_받은_authorization_code",
    "redirect_uri": "http://localhost:3000/test/callback.html",
    "state": "랜덤_문자열"
  }'
```

---

### 2. 네이버 로그인 (SDK 방식 - Access Token 직접 전송)

네이버 SDK에서 받은 access_token을 직접 전송하여 로그인합니다.

#### Request

```
POST /api/v1/auth/naver/token
```

**Headers**

```
Content-Type: application/json
```

**Body**

```json
{
  "access_token": "네이버 SDK에서 받은 access token"
}
```

| 파라미터       | 타입   | 필수 | 설명                                 |
| -------------- | ------ | ---- | ------------------------------------ |
| `access_token` | string | Y    | 네이버 SDK에서 발급받은 access token |

#### Response

**성공 (200 OK)**

```json
{
  "success": true,
  "message": "로그인 성공",
  "data": {
    "user": {
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "name": "홍길동",
      "profile_image_url": "https://ssl.pstatic.net/static/pwe/address/img_profile.png",
      "naver_id": "네이버_고유_ID",
      "timezone": "Asia/Seoul",
      "created_at": "2026-01-11T12:00:00.000Z"
    },
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_at": 1704974400000
  }
}
```

**실패 (400 Bad Request)**

```json
{
  "success": false,
  "message": "access_token이 필요합니다."
}
```

#### 사용 예시

**JavaScript (네이버 SDK)**

```javascript
// 네이버 SDK 초기화
NaverLogin.init({
  clientId: "YOUR_NAVER_CLIENT_ID",
  callbackUrl: "YOUR_CALLBACK_URL",
  isPopup: false,
  loginButton: { color: "green", type: 3, height: 58 },
});

// 로그인 버튼 클릭 시
NaverLogin.getLoginStatus(function (status) {
  if (status) {
    // 이미 로그인된 경우
    const accessToken = NaverLogin.accessToken.accessToken;
    loginWithNaverToken(accessToken);
  } else {
    // 로그인 필요
    NaverLogin.reprompt();
  }
});

// Access Token으로 서버 로그인
async function loginWithNaverToken(naverAccessToken) {
  const response = await fetch(
    "http://localhost:3000/api/v1/auth/naver/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        access_token: naverAccessToken,
      }),
    }
  );

  const data = await response.json();
  if (data.success) {
    console.log("로그인 성공:", data.data.user);
    localStorage.setItem("access_token", data.data.access_token);
    localStorage.setItem("refresh_token", data.data.refresh_token);
  }
}
```

**cURL**

```bash
curl -X POST http://localhost:3000/api/v1/auth/naver/token \
  -H "Content-Type: application/json" \
  -d '{
    "access_token": "네이버_SDK에서_받은_access_token"
  }'
```

---

## 카카오 SDK Access Token 로그인

운영 정본은 `POST /api/v1/auth/kakao/token`입니다. 서버는 Kakao token info의 `app_id`가 환경별 `KAKAO_APP_ID`와 같은지 확인하고 token info와 `user/me`의 회원번호를 교차 검증한 뒤에만 DB transaction을 시작합니다.

### 1. Deprecated 카카오 Web 로그인 (Authorization Code)

이 경로는 1차 배포의 Stage/Production 7일 무사용 관찰 동안만 유지합니다. 신규 클라이언트는 사용하지 않으며 관찰 통과 후 별도 배포에서 제거합니다.

#### Request

```
POST /api/v1/auth/kakao
```

**Headers**

```
Content-Type: application/json
```

**Body**

```json
{
  "code": "카카오에서 받은 authorization code",
  "redirect_uri": "등록된 redirect URI"
}
```

| 파라미터       | 타입   | 필수 | 설명                                         |
| -------------- | ------ | ---- | -------------------------------------------- |
| `code`         | string | Y    | 카카오 OAuth 인증 후 받은 authorization code |
| `redirect_uri` | string | Y    | 카카오 개발자 콘솔에 등록된 Redirect URI     |

#### Response

**성공 (200 OK)**

```json
{
  "success": true,
  "message": "로그인 성공",
  "data": {
    "user": {
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "name": "홍길동",
      "profile_image_url": "https://...",
      "kakao_id": "카카오_고유_ID",
      "timezone": "Asia/Seoul",
      "created_at": "2026-01-11T12:00:00.000Z"
    },
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_at": 1704974400000
  }
}
```

---

### 2. 운영 카카오 로그인 (SDK Access Token)

카카오 SDK에서 받은 access_token을 직접 전송하여 로그인합니다.

#### Request

```
POST /api/v1/auth/kakao/token
```

**Headers**

```
Content-Type: application/json
```

**Body**

```json
{
  "access_token": "카카오 SDK에서 받은 access token"
}
```

| 파라미터       | 타입   | 필수 | 설명                                 |
| -------------- | ------ | ---- | ------------------------------------ |
| `access_token` | string | Y    | 카카오 SDK에서 발급받은 access token |

#### Response

**성공 (200 OK)**

```json
{
  "success": true,
  "message": "로그인 성공",
  "data": {
    "user": {
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "name": "홍길동",
      "profile_image_url": "https://...",
      "kakao_id": "카카오_고유_ID",
      "timezone": "Asia/Seoul",
      "created_at": "2026-01-11T12:00:00.000Z"
    },
    "access_token": "ShiftMate JWT",
    "refresh_token": "ShiftMate Refresh Token",
    "expires_at": 1704974400000,
    "is_new_user": false
  },
  "request_id": "request-id"
}
```

공개 오류 코드는 `KAKAO_INVALID_TOKEN`, `KAKAO_TOKEN_APP_MISMATCH`, `KAKAO_TOKEN_SUBJECT_MISMATCH`, `KAKAO_EMAIL_UNAVAILABLE`, `KAKAO_ACCOUNT_CONFLICT`, `KAKAO_INVALID_UPSTREAM_RESPONSE`, `KAKAO_UPSTREAM_UNAVAILABLE`입니다. 상세 HTTP status와 schema는 `/api-docs/openapi.json`을 정본으로 사용합니다.

---

## 공통 기능

### 사용자 계정 연결

같은 이메일로 다른 OAuth 제공자(카카오/네이버)로 로그인한 경우, 기존 계정에 자동으로 연결됩니다.

**예시 시나리오**:

1. 사용자가 카카오로 회원가입 (email: `user@example.com`)
2. 동일한 이메일로 네이버 로그인 시도
3. 서버가 기존 계정을 찾아 네이버 ID를 연결
4. 이후 카카오 또는 네이버로 모두 로그인 가능

### 신규 사용자 처리

- 신규 사용자 자동 회원가입
- 기본 근무 템플릿 자동 생성
- 기본 타임존: `Asia/Seoul`

### JWT 토큰 관리

로그인 성공 시 발급되는 토큰:

- **Access Token**: 7일 만료, API 인증에 사용
- **Refresh Token**: 30일 만료, 토큰 갱신에 사용 (DB에 해시값 저장)

**토큰 사용 방법**:

```
Authorization: Bearer {access_token}
```

**토큰 갱신**:

```
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refresh_token": "refresh_token_값"
}
```

---

## 테스트 페이지

개발 환경에서 테스트할 수 있는 HTML 페이지가 제공됩니다:

- **네이버 로그인**: `http://localhost:3000/test/naver-login.html`
- **카카오 Web 로그인(deprecated 관찰용)**: `http://localhost:3000/test/kakao-login.html`
- **공통 Callback**: `http://localhost:3000/test/callback.html`

### 테스트 페이지 사용 방법

1. 서버 실행 (`npm run dev`)
2. 브라우저에서 테스트 페이지 접속
3. OAuth Client ID 및 Redirect URI 입력
4. 로그인 버튼 클릭
5. OAuth 제공자(네이버/카카오) 로그인 및 동의
6. 자동으로 서버 API 호출 및 결과 표시

---

## 환경변수 설정

서버 측 환경변수 설정이 필요합니다:

```env
# 네이버 OAuth
NAVER_CLIENT_ID=your-naver-client-id
NAVER_CLIENT_SECRET=your-naver-client-secret

# 카카오 OAuth
KAKAO_CLIENT_ID=your-kakao-client-id
KAKAO_CLIENT_SECRET=your-kakao-client-secret
KAKAO_APP_ID=123456
KAKAO_ADMIN_KEY_FILE=/run/secrets/kakao_admin_key
```

---

## 주의사항

### 네이버 OAuth

1. **Redirect URI 일치**: 네이버 개발자 센터에 등록된 Callback URL과 요청 시 전송하는 `redirect_uri`가 정확히 일치해야 합니다.
2. **이메일 필수**: 네이버 API에서 이메일 정보 제공 동의가 필요합니다. 이메일이 없으면 로그인 실패합니다.
3. **State 파라미터**: CSRF 공격 방지를 위해 `state` 파라미터 사용을 권장합니다.
4. **Client Secret**: 서버에서만 사용하고 클라이언트에 노출하지 마세요.

### 카카오 SDK 로그인

1. **환경별 앱 분리**: 현재 앱은 Production, 신규 앱은 Stage 정본으로 사용하며 두 환경의 `KAKAO_APP_ID`가 달라야 합니다.
2. **Native 플랫폼 설정**: Stage/Production Native App Key별 Android package/key hash와 iOS Bundle ID를 등록합니다.
3. **Scope 설정**: `profile_nickname`, `account_email` 등 필요한 사용자 정보 동의를 설정합니다.
4. **Redirect URI**: 운영 SDK 경로에는 Stage/Production API URL을 Kakao Web Redirect URI로 등록하지 않습니다. 기존 Redirect URI는 deprecated Web 경로 제거 시 함께 삭제합니다.

### 공통

1. **HTTPS 권장**: 프로덕션 환경에서는 반드시 HTTPS를 사용하세요.
2. **토큰 보안**: Access Token과 Refresh Token을 안전하게 저장하세요 (httpOnly 쿠키 권장).
3. **에러 처리**: 모든 API 호출에 대한 적절한 에러 처리를 구현하세요.

---

## FAQ

### Q: 네이버 로그인 시 "이메일 정보가 없습니다" 오류가 발생합니다.

A: 네이버 개발자 센터에서 애플리케이션 설정의 "제공 정보"에서 이메일 제공 동의를 활성화해야 합니다.

### Q: Redirect URI가 일치하지 않는다는 오류가 발생합니다.

A: 네이버/카카오 개발자 센터에 등록된 Callback URL과 API 요청 시 전송하는 `redirect_uri` 값이 정확히 일치해야 합니다. 대소문자, 슬래시, 쿼리 파라미터까지 모두 일치해야 합니다.

### Q: 같은 이메일로 여러 OAuth 제공자를 사용할 수 있나요?

A: 네, 가능합니다. 같은 이메일로 다른 OAuth 제공자(카카오/네이버)로 로그인하면 기존 계정에 자동으로 연결됩니다.

### Q: Access Token은 어디에 저장해야 하나요?

A: 보안을 위해 httpOnly 쿠키에 저장하는 것을 권장합니다. localStorage나 sessionStorage는 XSS 공격에 취약합니다.

### Q: Refresh Token은 어떻게 사용하나요?

A: Access Token이 만료되면 Refresh Token을 사용하여 새로운 Access Token을 발급받을 수 있습니다. `POST /api/v1/auth/refresh` 엔드포인트를 사용하세요.

---

## 참고 자료

- [네이버 개발자 센터](https://developers.naver.com)
- [카카오 개발자 콘솔](https://developers.kakao.com)
- [OAuth 2.0 공식 문서](https://oauth.net/2/)

---

**문서 버전**: 1.0  
**최종 업데이트**: 2026-01-11

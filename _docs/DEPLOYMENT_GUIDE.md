# 서버 배포 가이드

## 개요

이 문서는 Shift Calendar Server를 프로덕션 환경에 배포하는 방법을 설명합니다.

---

## 배포 전 체크리스트

### 1. 필수 환경변수 확인

`.env` 파일에 다음 환경변수가 모두 설정되어 있는지 확인하세요:

```bash
# 필수 환경변수
JWT_SECRET=                    # ⚠️ 반드시 설정 필요!
JWT_REFRESH_SECRET=            # ⚠️ 반드시 설정 필요!
DB_HOST=
DB_PORT=
DB_NAME=
DB_USER=
DB_PASSWORD=
DB_POOL_MAX=10
DB_POOL_MIN=0
TRUST_PROXY_HOPS=1
CORS_ALLOWED_ORIGINS=https://shift-calendar.co.kr
NAVER_CLIENT_ID=               # 네이버 로그인 사용 시
NAVER_CLIENT_SECRET=           # 네이버 로그인 사용 시
KAKAO_CLIENT_ID=               # 카카오 로그인 사용 시
KAKAO_CLIENT_SECRET=           # 카카오 로그인 사용 시
```

**중요**: 필수값 누락, 두 JWT secret의 동일 설정, `DB_SYNC=true`는 서버 시작 단계에서 거부됩니다.

### 2. 환경변수 생성 방법

```bash
# JWT Secret 생성 (강력한 랜덤 문자열)
openssl rand -base64 32

# .env 파일 생성
cp .env.example .env
# .env 파일을 열어서 실제 값으로 채우기
```

---

## 배포 절차

### 1. 코드 업데이트

```bash
# Git에서 최신 코드 가져오기
git pull origin main

# 또는 특정 브랜치
git pull origin production
```

### 2. 의존성 설치

```bash
# lockfile 기준으로 빌드 의존성까지 설치
npm ci
```

### 3. TypeScript 빌드

```bash
# TypeScript를 JavaScript로 컴파일
npm run build

# 빌드 결과 확인
ls -la dist/

# 빌드 후 런타임 의존성만 유지할 경우
npm prune --omit=dev
```

**⚠️ 중요**: `dist/` 폴더가 없거나 비어있으면 서버가 실행되지 않습니다!

### 4. 데이터베이스 변경

1. 운영 DB 백업
2. 개발자가 `migrations/`의 대상 SQL과 롤백 방법 확인
3. SQL을 운영 DB에 직접 1회 실행
4. 결과와 검증 내용을 `_docs/WORKLOG.md`에 기록
5. 그 후 API 인스턴스 실행

`migrations/`는 배포 자동화 대상이 아니며 API 컨테이너 시작 시 실행하지 않습니다. `final_schema.sql`은 `DROP SCHEMA`가 포함된 로컬 초기화 전용이므로 운영 DB에 실행하면 안 됩니다.

### 5. 환경변수 확인

```bash
# .env 파일이 존재하는지 확인
ls -la .env

# 환경변수 로드 확인 (서버 시작 시 로그 확인)
# JWT_SECRET, JWT_REFRESH_SECRET이 설정되어 있는지 확인
```

### 6. 서버 재시작

```bash
# PM2 사용 시
pm2 restart shift_calendar_server

# 또는
pm2 reload shift_calendar_server

# systemd 사용 시
sudo systemctl restart shift_calendar_server

# 직접 실행 시
npm start
```

---

## 인증 토큰 오류 해결

### 오류 메시지

```
인증 토큰이 없다
JWT_SECRET이 설정되지 않았습니다
```

### 원인

1. **`.env` 파일이 없음**
2. **`JWT_SECRET` 또는 `JWT_REFRESH_SECRET` 환경변수가 설정되지 않음**
3. **환경변수가 로드되지 않음** (dotenv 설정 문제)
4. **서버가 재시작되지 않음** (이전 환경변수 사용 중)

### 해결 방법

#### 1단계: .env 파일 확인

```bash
# .env 파일 존재 확인
ls -la .env

# .env 파일 내용 확인 (민감 정보 주의!)
cat .env | grep JWT
```

#### 2단계: 환경변수 설정

```bash
# .env 파일에 추가
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 32)" >> .env
```

또는 직접 `.env` 파일을 편집:

```env
JWT_SECRET=your-strong-random-secret-key-here
JWT_REFRESH_SECRET=your-strong-random-refresh-secret-key-here
```

#### 3단계: dotenv 로드 확인

`src/index.ts` 파일 상단에 다음이 있는지 확인:

```typescript
import dotenv from "dotenv";
dotenv.config();
```

#### 4단계: 서버 재시작

```bash
# 서버 완전히 종료 후 재시작
pm2 stop shift_calendar_server
pm2 start shift_calendar_server

# 또는
npm start
```

#### 5단계: 로그 확인

서버 시작 시 다음 로그가 나오는지 확인:

```
Server is running on port 3000
```

에러가 있다면 로그를 확인:

```bash
# PM2 로그
pm2 logs shift_calendar_server

# 직접 실행 시 콘솔 로그 확인
```

---

## 환경별 설정

### 개발 환경

```env
NODE_ENV=development
DB_SSL=false
TRUST_PROXY_HOPS=0
```

### 프로덕션 환경

```env
NODE_ENV=production
DB_SSL=true    # RDS 등 외부 DB 사용 시
TRUST_PROXY_HOPS=1
CORS_ALLOWED_ORIGINS=https://shift-calendar.co.kr
DB_POOL_MAX=10
DB_POOL_MIN=0
```

`DB_SYNC=true`는 개발/운영 구분 없이 허용하지 않습니다.

---

## PM2를 사용한 프로세스 관리

### PM2 설치

```bash
npm install -g pm2
```

### PM2 설정

```bash
# 서버 시작
pm2 start dist/index.js --name shift_calendar_server

# 또는 ecosystem 파일 사용
pm2 start ecosystem.config.js
```

### ecosystem.config.js 예시

```javascript
module.exports = {
  apps: [
    {
      name: "shift_calendar_server",
      script: "./dist/index.js",
      instances: 2,
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
```

### PM2 명령어

```bash
# 서버 시작
pm2 start shift_calendar_server

# 서버 재시작
pm2 restart shift_calendar_server

# 서버 중지
pm2 stop shift_calendar_server

# 서버 삭제
pm2 delete shift_calendar_server

# 로그 확인
pm2 logs shift_calendar_server

# 상태 확인
pm2 status

# 자동 시작 설정 (서버 재부팅 시)
pm2 startup
pm2 save
```

---

## 데이터베이스 변경 기록

- 실행 SQL 파일명과 체크섬
- 대상 DB/환경
- 백업 위치와 복구 방법
- 실행 시각과 실행자
- 실행 결과 및 검증 쿼리
- 롤백 SQL

위 내용을 `_docs/WORKLOG.md`에 남깁니다. DB 변경 실패는 무시하고 배포를 계속할 수 없습니다.

---

## 로그 관리

### 로그 파일 위치

```bash
# PM2 사용 시
~/.pm2/logs/

# 직접 실행 시
# 콘솔 출력 또는 별도 로그 파일 설정
```

### 로그 로테이션

PM2 모듈 사용:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## 모니터링

### 서버 상태 확인

```bash
# PM2 모니터링
pm2 monit

# 프로세스 상태
pm2 status
```

### 헬스 체크

```bash
# 프로세스 생존
curl --fail http://localhost:3000/api/v1/health/live

# DB 연결까지 포함한 준비 상태
curl --fail http://localhost:3000/api/v1/health/ready

# 또는
curl http://localhost:3000/api/v1/auth/profile \
  -H "Authorization: Bearer {access_token}"
```

---

## 트러블슈팅

### 문제: 서버가 시작되지 않음

**확인 사항**:

1. `dist/` 폴더가 존재하는가? → `npm run build` 실행
2. `.env` 파일이 존재하는가?
3. 포트가 이미 사용 중인가? → `lsof -i :3000`
4. Node.js 버전이 맞는가? → `node --version`

### 문제: DB 연결 실패

**확인 사항**:

1. DB 서버가 실행 중인가?
2. `.env`의 DB 설정이 올바른가?
3. 방화벽 설정이 올바른가?
4. DB SSL 설정이 올바른가? (`DB_SSL=true/false`)

### 문제: OAuth 로그인 실패

**확인 사항**:

1. OAuth Client ID/Secret이 올바른가?
2. Redirect URI가 개발자 센터에 등록되어 있는가?
3. 네트워크 연결이 정상인가?

### 문제: 인증 토큰 오류

**확인 사항**:

1. `JWT_SECRET`과 `JWT_REFRESH_SECRET`이 설정되어 있는가?
2. 서버가 재시작되었는가?
3. `.env` 파일이 올바른 위치에 있는가? (프로젝트 루트)

---

## 보안 체크리스트

- [ ] `.env` 파일이 `.gitignore`에 포함되어 있는가?
- [ ] `JWT_SECRET`과 `JWT_REFRESH_SECRET`이 강력한 랜덤 문자열인가?
- [ ] `DB_SYNC`가 없거나 `false`이며 런타임 DB 변경이 없는가?
- [ ] `3 × DB_POOL_MAX`가 PostgreSQL 연결 한도와 운영 예약 연결을 침범하지 않는가?
- [ ] Nginx 1단 프록시 기준 `TRUST_PROXY_HOPS=1`인가?
- [ ] CORS origin이 정확한 운영 도메인으로 제한되어 있는가?
- [ ] HTTPS가 설정되어 있는가? (프로덕션)
- [ ] 방화벽이 올바르게 설정되어 있는가?
- [ ] 불필요한 포트가 열려있지 않은가?

---

## 배포 후 확인 사항

- [ ] 서버가 정상적으로 시작되었는가?
- [ ] liveness와 readiness가 모두 정상인가?
- [ ] API 엔드포인트가 세 인스턴스에서 동일하게 작동하는가?
- [ ] `SIGTERM` 시 기존 요청 완료 후 정상 종료되는가?
- [ ] 데이터베이스 연결이 정상인가?
- [ ] OAuth 로그인이 정상 작동하는가?
- [ ] 로그에 에러가 없는가?

---

**문서 버전**: 1.1
**최종 업데이트**: 2026-07-19

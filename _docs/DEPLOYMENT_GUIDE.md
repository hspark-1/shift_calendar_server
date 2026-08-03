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
INSTANCE_NAME=shiftmate-api-1
REQUEST_BODY_LIMIT=100kb
AUTH_RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX=10
WORK_SHIFT_CACHE_ENABLED=false # migration/Redis/worker 확인 후 true
REDIS_URL=                     # redis://:<password>@<service>:6379
REDIS_PASSWORD=                # Redis Compose와 REDIS_URL에 같은 값 사용
CACHE_KEY_PREFIX=              # Stage/Center에서 서로 다른 값
WORK_SHIFT_CACHE_TTL_SECONDS=86400
WORK_SHIFT_CACHE_TTL_JITTER_SECONDS=3600
WORK_SHIFT_CACHE_LOCK_MS=5000
WORK_SHIFT_CACHE_WAIT_MS=500
REDIS_CONNECT_TIMEOUT_MS=500
REDIS_COMMAND_TIMEOUT_MS=100
CACHE_OUTBOX_POLL_MS=1000
CACHE_OUTBOX_BATCH_SIZE=100
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

### 프로덕션 환경(현재 홈서버 내부 Docker PostgreSQL 16)

```env
NODE_ENV=production
DB_SSL=false   # 홈서버 내부 Docker PostgreSQL 16
TRUST_PROXY_HOPS=1
CORS_ALLOWED_ORIGINS=https://shift-calendar.co.kr
DB_POOL_MAX=10
DB_POOL_MIN=0
INSTANCE_NAME=shiftmate-api-1
REQUEST_BODY_LIMIT=100kb
AUTH_RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX=10
```

PostgreSQL 접속 경로에 TLS를 별도로 구성한 경우에만 `DB_SSL=true`로 변경합니다.

`DB_SYNC=true`는 개발/운영 구분 없이 허용하지 않습니다.

---

## Docker 이미지 빌드 및 로컬 검증

### Intel N100용 이미지 빌드

```bash
docker buildx build \
  --platform linux/amd64 \
  --load \
  -t shiftmate-api:1.0.0 \
  .
```

멀티 스테이지 빌드의 builder는 TypeScript와 개발 의존성을 사용해 `dist/`를 만들고, runtime 이미지는 `npm ci --omit=dev`로 운영 의존성만 설치합니다. `.env*`는 `.dockerignore`로 빌드 컨텍스트에서 제외됩니다.

### 로컬 실행

```bash
docker run --rm \
  --platform linux/amd64 \
  --name shiftmate-test \
  --env-file .env \
  -e INSTANCE_NAME=local-test \
  -p 3000:3000 \
  shiftmate-api:1.0.0
```

`.env`의 DB 주소가 `localhost` 또는 `127.0.0.1`이고 PostgreSQL이 Docker Desktop 호스트에서 실행 중이면 다음 override를 추가합니다.

```bash
-e DB_HOST=host.docker.internal
```

운영과 같은 설정을 확인할 때는 `.env`에 `NODE_ENV=production`을 설정하거나 `-e NODE_ENV=production`을 추가합니다.

### 검증

```bash
curl --fail http://127.0.0.1:3000/health
docker inspect shiftmate-test --format '{{.Config.User}} {{.State.Health.Status}}'
docker exec shiftmate-test id
docker stop --timeout 15 shiftmate-test
```

기대 결과:

- 이미지 플랫폼: `linux/amd64`
- 실행 사용자: `node`, UID/GID `1000:1000`
- 실행 명령: `node dist/index.js`
- `/health`: `{"status":"ok","instance":"local-test"}`
- 종료 로그: `SIGTERM 수신` 후 서버와 DB 연결 정상 종료

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
# 컨테이너 프로세스와 인스턴스 이름
curl --fail http://localhost:3000/health

# 프로세스 생존
curl --fail http://localhost:3000/api/v1/health/live

# DB 연결까지 포함한 준비 상태
curl --fail http://localhost:3000/api/v1/health/ready

# 또는
curl http://localhost:3000/api/v1/auth/profile \
  -H "Authorization: Bearer {access_token}"
```

readiness는 HTTP 상태뿐 아니라 응답의 `cache` 값을 확인합니다.

- `ready`: Redis 캐시 사용 가능
- `degraded`: Redis 장애로 PostgreSQL fallback 중
- `disabled`: `WORK_SHIFT_CACHE_ENABLED=false`

### 월별 근무표 캐시 확인

1. `WORK_SHIFT_CACHE_ENABLED=true` 적용 후 API와 worker를 함께 재생성합니다.
2. `GET /api/v1/health/ready`에서 `cache=ready`를 확인합니다.
3. 유효한 Bearer access token과 `start_date/end_date`를 포함해 자기 또는 친구 캘린더를 조회합니다.
4. Redis에서는 `KEYS *` 대신 환경 prefix로 `SCAN`합니다.

```bash
curl -i \
  -H "Authorization: Bearer {access_token}" \
  "http://localhost:3000/api/v1/work-shifts?start_date=2026-07-01&end_date=2026-07-31"
```

snapshot key 형식:

```text
{CACHE_KEY_PREFIX}:work-shifts:v1:{owner_user_id}:{YYYYMM}
```

- 자기 조회와 친구 조회는 같은 소유자·월 key를 공유합니다.
- 빈 달도 빈 배열 snapshot으로 저장합니다.
- 이미 존재하는 key의 재조회는 `DBSIZE`를 늘리지 않습니다.
- 개인 일정 `events`는 Redis 캐시 대상이 아닙니다.
- cache worker는 snapshot을 생성하지 않고 변경된 월의 snapshot을 무효화합니다.

Outbox 적체 확인:

```sql
SELECT
  COUNT(*) FILTER (WHERE processed_at IS NULL) AS pending,
  MAX(now() - created_at)
    FILTER (WHERE processed_at IS NULL) AS oldest_pending_age
FROM work_shift_cache_outbox;
```

### 로컬 API에서 Stage DB·Redis 확인

- Stage Redis에 외부 포트를 열지 않고 SSH local forwarding으로 PostgreSQL·Redis에 접근합니다.
- `.env.stage.local`에 터널 포트와 Stage 자격증명을 저장하고 `CACHE_KEY_PREFIX=shiftmate:stage-local:<개발자>`처럼 실제 Stage와 다른 namespace를 사용합니다.
- Node 22에서는 다음처럼 별도 환경파일로 API만 실행합니다.

```bash
node \
  --env-file=.env.stage.local \
  --inspect \
  -r ts-node/register \
  src/index.ts
```

- 로컬 API의 쓰기 요청은 실제 Stage DB를 변경하므로 읽기 전용 DB 계정과 기존 Stage access token을 우선 사용합니다.
- **Stage DB를 바라보는 로컬 환경에서 `npm run start:cache-worker`를 실행하면 안 됩니다.** 로컬 worker가 Stage Outbox를 claim해 실제 Stage namespace의 무효화 이벤트를 유실시킬 수 있습니다.

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

### 문제: 근무표를 조회했는데 Redis key가 없음

**확인 사항**:

1. access log의 상태가 `200`인가? `401`은 인증 단계, `400`은 날짜 validation 단계에서 종료되어 캐시를 생성하지 않습니다.
2. 요청에 `Authorization: Bearer ...`, `start_date`, `end_date`가 모두 있는가?
3. readiness 응답이 단순 HTTP 200이 아니라 `cache=ready`인가?
4. API 컨테이너가 변경된 `.env`로 재생성되었는가?
5. API의 `REDIS_URL`이 지금 확인 중인 Redis 인스턴스를 가리키는가?
6. `CACHE_KEY_PREFIX`를 포함한 `SCAN` 결과를 확인했는가?

친구가 기존 소유자·월 snapshot을 재사용하면 정상적으로 캐시 hit가 발생해도 `DBSIZE`는 증가하지 않습니다.

### 문제: Redis는 정상인데 Outbox pending이 계속 증가함

**확인 사항**:

1. cache worker 컨테이너가 API와 같은 image/env를 사용하는가?
2. worker health가 PostgreSQL과 Redis 모두에 대해 성공하는가?
3. `WORK_SHIFT_CACHE_ENABLED=true`가 API와 worker에 함께 적용됐는가?
4. `last_error_code`, `attempt_count`, `next_attempt_at`, `claimed_at`을 조회했는가?
5. 같은 Stage DB를 바라보는 로컬 worker가 실행 중이지 않은가?

---

## 보안 체크리스트

- [ ] `.env` 파일이 `.gitignore`에 포함되어 있는가?
- [ ] `JWT_SECRET`과 `JWT_REFRESH_SECRET`이 강력한 랜덤 문자열인가?
- [ ] `DB_SYNC`가 없거나 `false`이며 런타임 DB 변경이 없는가?
- [ ] `3 × DB_POOL_MAX`가 PostgreSQL 연결 한도와 운영 예약 연결을 침범하지 않는가?
- [ ] Nginx 1단 프록시 기준 `TRUST_PROXY_HOPS=1`인가?
- [ ] CORS origin이 정확한 운영 도메인으로 제한되어 있는가?
- [ ] 세 컨테이너의 `INSTANCE_NAME`이 서로 다른가?
- [ ] Nginx에 3개 인스턴스 전체 공통 로그인 `limit_req`가 설정되어 있는가?
- [ ] access log에 Request ID가 있으며 비밀번호/토큰이 없는가?
- [ ] HTTPS가 설정되어 있는가? (프로덕션)
- [ ] 방화벽이 올바르게 설정되어 있는가?
- [ ] 불필요한 포트가 열려있지 않은가?

---

## 배포 후 확인 사항

- [ ] 서버가 정상적으로 시작되었는가?
- [ ] liveness와 readiness가 모두 정상인가?
- [ ] 루트 `/health`에 해당 컨테이너 `INSTANCE_NAME`이 반환되는가?
- [ ] API 엔드포인트가 세 인스턴스에서 동일하게 작동하는가?
- [ ] `SIGTERM` 시 기존 요청 완료 후 정상 종료되는가?
- [ ] 데이터베이스 연결이 정상인가?
- [ ] OAuth 로그인이 정상 작동하는가?
- [ ] 로그에 에러가 없는가?

---

## 그룹 기능 P0/P1 배포

### 환경변수

```env
GROUP_MEMBER_LIMIT=20
GROUP_INVITATION_TTL_DAYS=7
GROUP_CALENDAR_MAX_RANGE_DAYS=100
# Local/Stage=true, Center=false
API_DOCS_ENABLED=false
```

### Stage P0

1. Stage PostgreSQL 백업과 복원 가능 여부를 확인합니다.
2. pgAdmin Query Tool을 사용하면 `migrations/pgadmin_stage_add_group_feature.sql` 상단의 DB명·백업 식별자·확인 문자열을 입력하고 전체 SQL을 한 번에 실행합니다.
3. psql을 사용하면 실제 Stage DB 이름을 `expected_database`로 전달해 `migrations/stage_group_feature_preflight.sql`을 read-only 실행하고 결과를 보관합니다.
4. `migrations/add_group_feature.sql`의 SHA-256이 승인값 `0f5e86cbd607257d23a91581f8abc20a77390ff7273c9a3d96df4a4f7046f92a`인지 확인합니다.
5. psql 경로에서는 백업 식별자, checksum, 명시적 승인을 전달해 `migrations/stage_apply_group_feature.sql`만 수동 실행합니다.
6. 두 실행 경로 모두 postflight의 27개 컬럼, 20개 제약, 11개 index, COMMENT, 신규 데이터 0건을 확인하고 전체 출력을 WORKLOG에 기록합니다.
7. P0 API 이미지를 배포합니다. Swagger는 Stage에서만 `API_DOCS_ENABLED=true`로 재생성해 `/api-docs/openapi.json`과 실제 P0 계약을 확인합니다.
8. SELF, level 2, `can_view=false`, 친구 아님, soft-delete fixture를 확인합니다.
9. 20명·100일 요청의 DB query time, 전체 duration, 비압축 응답 byte와 query count 3 이하를 기록합니다.
10. Flutter가 Stage 계약을 확인한 뒤 그룹 더미 데이터를 제거합니다.

구체적인 psql 명령과 실패 조건은 `_docs/GROUP_API_GUIDE.md`의 `Stage 실행`을 사용합니다. `final_schema.sql`과 `groupIntegrationBaseSchema.sql`은 Stage에서 실행하지 않습니다.

### P1과 Center

P1은 신규 migration 없이 같은 스키마에서 관리 path를 활성화합니다. Stage 역할 변경·제거·나가기·소유권 이전·삭제를 검증한 다음 Center DB 백업과 migration 적용 후 기존 Blue/Green 경로로 배포합니다. 이전 API는 그룹 테이블을 참조하지 않으므로 migration 선적용은 하위 호환입니다.

### 롤백

장애 시 이전 API 이미지를 먼저 복원하고 그룹 테이블은 유지합니다. 신규 그룹 데이터 폐기가 명시적으로 승인된 경우에만 DB 백업과 데이터 건수 확인 후 다음을 실행합니다.

```bash
psql "$DATABASE_URL" \
  -v confirm_group_feature_drop=true \
  -f migrations/rollback_group_feature.sql
```

DB 초대·알림은 Push Worker 활성 여부와 관계없이 source of truth입니다.

---

## Push Worker 단계 배포

### 사전 준비

- Stage/Production Firebase project와 Android/iOS 앱 등록
- Apple Developer APNs key와 Firebase 연결
- 환경별 최소 권한 service account를 `/run/secrets/firebase.json`에 read-only mount
- `migrations/add_push_notification_support.sql` 적용 전 DB 백업과 전체 API+worker pool 연결 여유 확인
- Flutter iOS 최소 15.0, Android 최소 API 24 빌드 준비 (`flutter_local_notifications 22.2.0`의 공식 최소)

### 기본 환경변수

```env
PUSH_JOB_ENQUEUE_ENABLED=false
PUSH_WORKER_ENABLED=false
PUSH_APP_ENVIRONMENT=STAGE
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase.json
FIREBASE_PROJECT_ID=<stage-firebase-project-id>
PUSH_JOB_POLL_MS=1000
PUSH_JOB_BATCH_SIZE=20
PUSH_JOB_LEASE_SECONDS=120
PUSH_MAX_ATTEMPTS=6
PUSH_JOB_TTL_SECONDS=3600
PUSH_TERMINAL_RETENTION_DAYS=30
DB_POOL_MAX=2
```

실제 project ID는 환경 secret에서 주입하고 문서 예시값을 그대로 사용하지 않습니다. Production은 `PUSH_APP_ENVIRONMENT=PROD`와 별도 DB·service account·Firebase project를 사용합니다.

### 활성화

1. expand migration을 적용하고 `user_devices`, `push_jobs`, `push_deliveries` 제약/인덱스와 기존 알림 무-backfill을 확인합니다.
2. API와 push worker 이미지를 두 flag가 `false`인 상태로 배포합니다.
3. `node dist/workers/pushWorker.js --healthcheck`로 DB와 credential access token readiness를 확인합니다.
4. Stage Flutter 실기기에서 `PUT /api/v1/devices/current` 등록과 환경값을 확인합니다.
5. API의 `PUSH_JOB_ENQUEUE_ENABLED=true`를 먼저 적용한 뒤 job이 쌓이는지 확인합니다.
6. worker의 `PUSH_WORKER_ENABLED=true`를 적용하고 6개 알림 타입 E2E를 수행합니다.
7. Production 앱 배포 후 기기 등록 기간을 확보하고 같은 순서를 반복합니다.

### 활성화 기준과 rollback

정상 부하에서 oldest pending job 60초 미만, 환경 간 오발송 0건, 중복 job 0건, raw target/title/body/payload 로그 0건이어야 합니다. 장애 시 enqueue를 먼저 끄고 worker를 중지한 다음 이전 API 이미지를 복원합니다. 신규 테이블과 job은 보존하며 별도 데이터 폐기 승인 없이 drop하지 않습니다.

상세 worker·API·보안 계약은 `_docs/PUSH_NOTIFICATION_GUIDE.md`를 참조합니다.

**문서 버전**: 1.6
**최종 업데이트**: 2026-08-03

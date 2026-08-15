# ShiftMate 홈서버 CI/CD 적용 가이드

작성 기준: 2026-08-16
대상: `hspark-1/shift_calendar_server-deploy`, `main`, GitHub Free, Ubuntu 26.04 x86_64

## 1. 최종 구조

```text
배포 저장소 main push 또는 수동 Run workflow
  -> GitHub-hosted runner: npm ci, unit/integration test, TypeScript build, linux/amd64 이미지 build
  -> Private GHCR: sha-<40자리 commit SHA> 태그로 push
  -> 홈서버 self-hosted runner: 같은 commit을 exact checkout
  -> root 소유 고정 launcher가 repository/workspace/commit/image와 배포 엔진·두 base Compose·두 flag config blob을 검증
  -> 검증된 main의 배포 엔진과 Stage/Center base Compose를 root 임시 번들로 실행
  -> 두 flag config schema와 두 base Compose 문법·서비스 계약 검증 후 홈서버 실행 경로에 원자 동기화
  -> 기존 Stage readiness 실패 시 상태·로그를 기록하고 새 이미지 복구를 계속 시도
  -> 환경별 공유 Redis health 확인
  -> Stage 3201 API와 cache/push/회원 탈퇴 worker를 같은 image digest로 재생성하고 readiness/health 확인
  -> 현재 비활성 Blue 또는 Green에 API 3개와 worker 3개 시작
  -> API 3개의 PostgreSQL readiness와 세 worker health 확인
  -> Nginx upstream을 원자적으로 전환하고 reload
  -> Center와 Stage의 외부 /api/v1/health 확인
  -> 성공 시 이전 Center 컨테이너 중지
  -> 실패 시 Stage image override, Stage/Center base Compose와 Center 상태를 함께 이전 버전으로 자동 복원
```

현재 운영 정보에 맞춘 포트:

| 용도         | Blue          | Green     |
| ------------ | ------------- | --------- |
| API 1        | 3101          | 3111      |
| API 2        | 3102          | 3112      |
| API 3        | 3103          | 3113      |
| Cache worker | 1개           | 1개       |
| Push worker  | 1개           | 1개       |
| 탈퇴 worker  | 1개           | 1개       |
| Stage        | 단일 컨테이너 | 3201 고정 |

GitHub Actions는 이미지를 한 번만 빌드하며 Stage API/세 worker와 Center API 3개/세 worker가 정확히 같은 GHCR digest를 실행한다. Center와 Stage는 각각 별도 Redis를 사용하고 `CACHE_KEY_PREFIX`도 분리한다. main의 두 base Compose와 `deploy/config/feature-flags.{production,stage}.env`는 홈서버의 Compose 및 `feature-flags.env`로 함께 자동 동기화하고, `/opt/shiftmate-stage/compose.deploy.yaml`에서는 Stage API와 세 worker의 `image`만 덮어쓴다. 기존 `.deploy.env`, `secrets/`와 PostgreSQL migration은 자동 변경 대상이 아니다. `.env`의 secret·접속 설정은 보존하되 관리 대상 6개 flag line은 최초 전환 때 자동 제거한다.

### Redis, cache worker, Push Worker 사전 조건

Center와 Stage의 애플리케이션 `.env`에는 환경별 secret과 접속값만 설정한다. 실제 비밀번호는 문서나 Git에 기록하지 않는다.

```dotenv
REDIS_URL=redis://:<환경별_비밀번호>@<환경별_Redis_서비스명>:6379
REDIS_PASSWORD=<환경별_비밀번호>
CACHE_KEY_PREFIX=shiftmate:center

PUSH_APP_ENVIRONMENT=PROD
FIREBASE_PROJECT_ID=<Production_Firebase_project_id>
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase.json
PUSH_JOB_POLL_MS=1000
PUSH_JOB_BATCH_SIZE=20
PUSH_JOB_LEASE_SECONDS=120
PUSH_MAX_ATTEMPTS=6
PUSH_JOB_TTL_SECONDS=3600
PUSH_TERMINAL_RETENTION_DAYS=30
```

Stage는 `CACHE_KEY_PREFIX=shiftmate:stage`, `PUSH_APP_ENVIRONMENT=STAGE`, Stage Firebase project ID를 사용한다. 기능 flag는 `.env`가 아니라 환경별 `deploy/config/feature-flags.*.env`에서 관리하며, migration과 Redis/worker health가 확인되기 전에는 관련 flag를 `false`로 유지한다. Cache worker health는 PostgreSQL·Redis를 확인하고, Push Worker health는 `PUSH_WORKER_ENABLED=true`일 때 PostgreSQL과 Firebase credential access token까지 확인하되 메시지는 보내지 않는다. 회원 탈퇴 worker는 flag가 켜지면 탈퇴 migration schema, PostgreSQL과 Redis까지 health에서 확인한다. Center Redis는 `shiftmate_cache` singleton이고 외부 포트를 열지 않으며, snapshot만 TTL/eviction 대상이 되도록 `volatile-lru`를 사용한다.

```dotenv
# deploy/config/feature-flags.production.env 또는 feature-flags.stage.env
WORK_SHIFT_CACHE_ENABLED=false
PUSH_JOB_ENQUEUE_ENABLED=false
PUSH_WORKER_ENABLED=false
API_DOCS_ENABLED=false
ACCOUNT_DELETION_ENABLED=false
ACCOUNT_DELETION_WORKER_ENABLED=false
```

회원 탈퇴는 API와 worker를 함께 켜야 합니다. 배포 검증은 `ACCOUNT_DELETION_ENABLED=true`인데 `ACCOUNT_DELETION_WORKER_ENABLED=false`인 config를 거절합니다. 두 flag를 켜기 전에 `add_account_deletion_support.sql`을 적용하고, 홈서버 `.env`에 `KAKAO_ADMIN_KEY`와 Apple/Redis/DB 필수 secret·접속값을 준비합니다. Stage에서 실제 provider revoke·DB purge·Redis tombstone E2E를 통과한 다음 Production config를 별도 commit으로 활성화합니다.

Firebase Admin service account JSON은 `.env`에 내용을 넣지 않는다. 환경별 secret 디렉터리는 `root:root 0700`, JSON은 `root:root 0444`로 저장하고 Compose secret으로 `/run/secrets/firebase.json`에 읽기 전용 mount한다. Compose의 로컬 file secret은 bind mount이므로 호스트 파일 권한이 유지되며, image의 non-root `node` 사용자가 읽으려면 파일 read bit가 필요하다. 호스트의 다른 사용자는 `0700` 상위 디렉터리를 통과할 수 없어 JSON에 접근할 수 없다.

```text
/opt/shiftmate-stage/secrets/firebase.json  # Stage Firebase project
/opt/shiftmate/secrets/firebase.json        # Production Firebase project
```

`DB_POOL_MAX=2`는 Push Worker와 회원 탈퇴 worker 서비스의 `environment`에만 둔다. 공용 `.env`에 넣으면 API의 DB pool까지 2로 줄어드므로 넣지 않는다. `GoogleService-Info.plist`와 `google-services.json`은 앱 설정 파일이며 서버 credential이 아니다. APNs `.p8` 키는 Firebase Console에 업로드하고 홈서버에 배치하지 않는다.

### Apple 로그인 API secret 사전 조건

Sign in with Apple client secret 서명용 `.p8`은 APNs용 키와 역할이 다릅니다. Apple 로그인과 탈퇴 시 revoke에 필요하므로 base Compose가 API와 회원 탈퇴 worker의 `/run/secrets/apple_signin.p8`로 항상 mount합니다. cache/push worker에는 mount하지 않습니다.

```text
/opt/shiftmate-stage/secrets/apple_signin.p8  # Stage Services ID/return URL
/opt/shiftmate/secrets/apple_signin.p8        # Production Services ID/return URL
```

두 애플리케이션 `.env`에는 환경별 Services ID, exact HTTPS callback, 서로 다른 영속 AES key를 필수 설정합니다. 실제값은 Git·문서·image에 넣지 않습니다. 배포 스크립트는 `.p8`이 없거나 `root:root 0444`가 아니면 이미지 변경 전에 중단합니다.

```dotenv
APPLE_TEAM_ID=<Apple_Team_ID>
APPLE_KEY_ID=<Sign_in_with_Apple_Key_ID>
APPLE_IOS_CLIENT_ID=com.hspark.shiftmate
APPLE_SERVICE_ID=<환경별_Services_ID>
APPLE_REDIRECT_URI=https://<환경별_API_도메인>/api/v1/auth/apple/callback
APPLE_PRIVATE_KEY_PATH=/run/secrets/apple_signin.p8
APPLE_TOKEN_ENCRYPTION_KEY=<32_random_bytes_base64>
APPLE_CHALLENGE_TTL_SECONDS=300
APPLE_JWKS_CACHE_SECONDS=21600
```

DB는 이미지보다 먼저 수동 적용합니다. pgAdmin은 환경별 `stage_apple_auth_apply_pgadmin.sql` 또는 `center_apple_auth_apply_pgadmin.sql` 단일 transaction 경로를, psql은 preflight → `add_apple_auth_support.sql` → strict postflight 경로를 사용하며 같은 DB에 두 경로를 중복 실행하지 않습니다. Stage에서 Apple challenge/login과 기존 인증 회귀를 검증한 뒤 Center에 배포합니다.

Stage Compose의 저장소 정본은 `deploy/compose.stage.yaml`이며 최초 bootstrap 때 홈서버 `/opt/shiftmate-stage/compose.yaml`에 설치하고, 이후 main 배포부터 검증 후 자동 동기화한다. 다음 다섯 서비스를 고정한다.

- Redis: 외부 포트 없음, password와 healthcheck 설정
- API: 기존 3201 포트 서비스
- cache worker: API와 같은 env/image, command `node dist/workers/workShiftCacheWorker.js`, health command에 `--healthcheck`
- push worker: API와 같은 env/image, 외부 포트 없음, command `node dist/workers/pushWorker.js`, `DB_POOL_MAX=2`, Firebase secret, health command에 `--healthcheck`
- 회원 탈퇴 worker: API와 같은 env/image, 외부 포트 없음, command `node dist/workers/accountDeletionWorker.js`, `DB_POOL_MAX=2`, Apple secret, health command에 `--healthcheck`

## 2. 먼저 확정해야 하는 정책

### 저장소를 Private으로 변경

Self-hosted runner는 홈서버에서 명령을 실행할 수 있다. GitHub도 public 저장소에는 self-hosted runner 사용을 권장하지 않으므로, 현재 public 저장소라면 먼저 Private으로 바꾼다.

1. GitHub 저장소 `Settings`
2. `General`
3. 아래쪽 `Danger Zone`
4. `Change repository visibility`
5. `Change to private`

GitHub Free에서도 private 저장소와 self-hosted runner를 사용할 수 있다. main push는 자동 배포되므로 main 직접 push를 제한하고 PR·필수 status check를 적용한다. `workflow_dispatch`의 확인 체크박스는 동일 main을 수동 재실행할 때 사용한다.

저장소를 계속 Public으로 유지하려면 이 문서의 self-hosted runner를 설치하지 않는다.

## 3. 배포 저장소 구조

`shift_calendar_server-deploy`는 애플리케이션 소스와 배포 자동화 파일을 함께 유지한다. GitHub-hosted build runner와 홈서버 deploy runner는 같은 `main` commit을 checkout한다. 홈서버의 고정 launcher는 checkout된 `deploy/shiftmate-deploy`, `deploy/compose.production.yaml`, `deploy/compose.stage.yaml`이 commit tree의 mode·blob과 일치할 때만 root 임시 번들로 실행한다.

```text
shift_calendar_server-deploy/
├── .github/
│   └── workflows/
│       ├── validate-main.yml
│       ├── deploy-production.yml
│       └── rollback-production.yml
├── deploy/
│   ├── compose.production.yaml
│   ├── compose.stage.yaml
│   ├── config/
│   │   ├── feature-flags.production.env
│   │   └── feature-flags.stage.env
│   ├── deploy.env.example
│   ├── stage.deploy.env.example
│   ├── shiftmate-bootstrap
│   ├── shiftmate-deploy
│   ├── shiftmate-deploy-launcher
│   ├── nginx/
│   │   ├── shiftmate-upstream-blue.conf
│   │   ├── shiftmate-upstream-green.conf
│   │   └── shiftmate-stage-upstream.conf
│   └── sudoers/
│       └── github-runner-shiftmate
├── Dockerfile
├── package-lock.json
└── package.json
```

현재 `Dockerfile`은 그대로 사용한다. 다음 조건이 이미 맞는다.

- Node 22 multi-stage build
- `npm ci`
- 런타임에서 개발 의존성 제외
- `/health` Docker HEALTHCHECK
- non-root `node` 사용자
- `linux/amd64` 빌드는 워크플로에서 지정

`.dockerignore` 끝에는 다음 두 줄을 유지해 배포 파일이 애플리케이션 이미지에 포함되지 않게 한다.

```text
.github
deploy
```

`package.json`의 단위 테스트를 포함해 CI는 다음 순서로 검증한다.

```text
npm ci
npm test
npm run test:integration  # CI PostgreSQL/Redis service에서 실행
npm run test:push-integration  # CI 전용 PostgreSQL 16 service에서 실행
docker build
```

`npm test`는 TypeScript 빌드를 선행하며 월 분할, 캐시 키, ETag 계약과 배포 순서를 검증한다. 두 integration 명령은 각각 전용 PostgreSQL의 `public` schema를 테스트 fixture로 재생성하므로 CI 또는 폐기 가능한 로컬 DB에서만 실행한다. Cache integration은 Redis 장애 복구와 cache worker 동시 claim 등을, Push integration은 migration·기기 선택·claim·retry·영구 오류 처리를 검증한다.

로컬 파일 업로드 여부는 제공된 `package.json`에 Multer 등의 업로드 의존성이 없고 현재 컨테이너가 `read_only: true`로 정상 실행되므로, 로컬 영구 파일을 쓰지 않는 구성으로 판단했다. 그래도 최초 반영 전에 저장소 루트에서 한 번 확인한다.

```bash
rg -n 'multer|formidable|busboy|writeFile|appendFile|createWriteStream|fs\.' \
  src package.json
```

실제 업로드 저장 코드가 검색되면 배포 전에 해당 경로를 bind mount 또는 object storage로 분리해야 한다. 검색 결과가 없으면 현재 Compose를 그대로 사용한다.

배포 자동화 변경은 애플리케이션 원격 `origin`이 아니라 배포 원격 `deploy`의 `main`에 반영한다.

```bash
git add .github deploy .dockerignore _docs/CI_CD_DEPLOYMENT_GUIDE.md
git commit -m "ci: add production blue-green deployment"
git push deploy main
```

워크플로 파일은 default branch인 `main`에 있어야 main push 자동 배포와 `Run workflow` 수동 재실행을 함께 사용할 수 있다. main은 PR과 `Validate main / validate` 필수 status check로 보호하고 `deploy/**`, `.github/workflows/**` 변경은 별도 검토한다.

## 4. 홈서버 파일 백업

다음 단계는 서비스 상태를 변경하지 않고 파일만 백업한다.

```bash
cd /opt/shiftmate

sudo cp -a compose.yaml compose.pre-cicd.yaml
sudo cp -a \
  /opt/shiftmate-stage/compose.yaml \
  /opt/shiftmate-stage/compose.pre-push-worker.yaml
sudo cp -a \
  /etc/nginx/conf.d/shiftmate-global.conf \
  /etc/nginx/conf.d/shiftmate-global.conf.pre-cicd

sudo cp -a \
  /etc/nginx/snippets/shiftmate-proxy.conf \
  /etc/nginx/snippets/shiftmate-proxy.conf.pre-cicd
```

백업 확인:

```bash
sudo ls -l \
  /opt/shiftmate/compose.pre-cicd.yaml \
  /opt/shiftmate-stage/compose.pre-push-worker.yaml \
  /etc/nginx/conf.d/shiftmate-global.conf.pre-cicd \
  /etc/nginx/snippets/shiftmate-proxy.conf.pre-cicd
```

주의: 실제 파일명은 `compose.yaml`이다. 기존에 실행했던 `-f compose.yml` 명령은 파일명이 달랐고, `.env`가 root 600이어서 일반 사용자 명령으로는 읽을 수 없었다. 이후 운영 Compose 명령은 문서대로 `sudo`와 `compose.yaml`을 사용한다.

## 5. 배포 파일을 홈서버로 전송

개발 PC의 저장소 루트에서 실행한다. 서버 주소는 내부 네트워크 주소로 바꾼다.

```bash
scp \
  deploy/compose.production.yaml \
  deploy/compose.stage.yaml \
  deploy/deploy.env.example \
  deploy/stage.deploy.env.example \
  deploy/shiftmate-bootstrap \
  deploy/shiftmate-deploy-launcher \
  deploy/nginx/shiftmate-upstream-blue.conf \
  deploy/nginx/shiftmate-upstream-green.conf \
  deploy/nginx/shiftmate-stage-upstream.conf \
  deploy/sudoers/github-runner-shiftmate \
  hyunseo@<홈서버_내부_IP>:~/
```

홈서버에서 설치한다.

```bash
sudo install -o root -g root -m 0644 \
  ~/compose.production.yaml \
  /opt/shiftmate/compose.yaml

sudo install -o root -g root -m 0644 \
  ~/compose.stage.yaml \
  /opt/shiftmate-stage/compose.yaml

sudo install -o root -g root -m 0600 \
  ~/deploy.env.example \
  /opt/shiftmate/.deploy.env

if ! sudo test -f /opt/shiftmate-stage/.deploy.env; then
  sudo install -o root -g root -m 0600 \
    ~/stage.deploy.env.example \
    /opt/shiftmate-stage/.deploy.env
fi

sudo install -o root -g root -m 0755 \
  ~/shiftmate-bootstrap \
  /usr/local/sbin/shiftmate-bootstrap

sudo install -o root -g root -m 0755 \
  ~/shiftmate-deploy-launcher \
  /usr/local/sbin/shiftmate-deploy-launcher

sudo install -o root -g root -m 0644 \
  ~/shiftmate-upstream-blue.conf \
  /etc/nginx/snippets/shiftmate-upstream-active.conf

sudo install -o root -g root -m 0644 \
  ~/shiftmate-stage-upstream.conf \
  /etc/nginx/snippets/shiftmate-stage-upstream.conf
```

Firebase Console에서 각 환경의 service account private key JSON을 별도로 발급해 안전한 경로로 전송한 뒤 설치한다. 아래의 로컬 파일명은 예시이며 두 환경의 파일을 서로 바꾸면 안 된다.

```bash
# 개발 PC에서 실행
scp ~/Downloads/shiftmate-stage-firebase-admin.json \
  hyunseo@<홈서버_내부_IP>:~/firebase-stage.json
scp ~/Downloads/shiftmate-production-firebase-admin.json \
  hyunseo@<홈서버_내부_IP>:~/firebase-production.json

# 홈서버에서 실행
sudo install -d -o root -g root -m 0700 \
  /opt/shiftmate-stage/secrets /opt/shiftmate/secrets
sudo install -o root -g root -m 0444 \
  ~/firebase-stage.json /opt/shiftmate-stage/secrets/firebase.json
sudo install -o root -g root -m 0444 \
  ~/firebase-production.json /opt/shiftmate/secrets/firebase.json
rm -f ~/firebase-stage.json ~/firebase-production.json
```

Apple override 파일은 이 단계에서 홈 디렉터리로 전송만 하고 `/opt`에는 설치하지 않습니다. `.p8` 전송·설치도 첫 `false` 배포가 검증된 뒤 수행합니다. 따라서 비활성 최초 배포에는 Apple 키가 필요하지 않습니다.

각 애플리케이션 `.env`를 편집한다. 기존 DB/JWT/Redis 값을 보존하고 아래 Push 접속·동작 설정만 환경에 맞게 추가한다. boolean flag는 넣지 않는다. `FIREBASE_PROJECT_ID`는 Firebase Console의 Project ID이며 앱 nickname이나 App ID가 아니다.

```bash
sudoedit /opt/shiftmate-stage/.env
sudoedit /opt/shiftmate/.env
```

Stage `/opt/shiftmate-stage/.env`:

```dotenv
PUSH_APP_ENVIRONMENT=STAGE
FIREBASE_PROJECT_ID=<Stage_Firebase_Project_ID>
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase.json
PUSH_JOB_POLL_MS=1000
PUSH_JOB_BATCH_SIZE=20
PUSH_JOB_LEASE_SECONDS=120
PUSH_MAX_ATTEMPTS=6
PUSH_JOB_TTL_SECONDS=3600
PUSH_TERMINAL_RETENTION_DAYS=30
```

Center `/opt/shiftmate/.env`는 같은 항목을 사용하되 `PUSH_APP_ENVIRONMENT=PROD`, Production Firebase Project ID로 설정한다. 아직 Production Firebase service account를 준비하지 않았다면 Center Compose를 이 버전으로 교체하기 전에 먼저 준비해야 한다. `DB_POOL_MAX`와 service account JSON 본문은 두 `.env` 어디에도 넣지 않는다.

Stage API/cache worker/push worker/회원 탈퇴 worker/Redis 서비스명은 저장소 Compose에 고정되어 있다. Push Worker와 회원 탈퇴 worker에는 외부 port가 없고 각각 필요한 Firebase/Apple Compose secret과 `DB_POOL_MAX=2`가 반영되어 있다. base image `shiftmate-api:1.0.2`는 bootstrap fallback이고, 실제 자동 배포는 `compose.deploy.yaml`에서 API와 세 worker를 같은 불변 digest로 덮어쓴다.

```bash
sudo docker compose \
  --project-directory /opt/shiftmate-stage \
  --file /opt/shiftmate-stage/compose.yaml \
  config --services

sudoedit /opt/shiftmate-stage/.deploy.env
```

파일에는 다음 여섯 값을 둔다. 서비스명 다섯 개는 `deploy/compose.stage.yaml`의 정본과 일치해야 한다. 기존 서버에 신규 key가 아직 없어도 배포 엔진은 아래 기본 서비스명을 사용하지만, 운영 정본에는 명시적으로 추가합니다.

```dotenv
STAGE_SERVICE=shiftmate_stage_api
STAGE_WORKER_SERVICE=shiftmate_stage_cache_worker
STAGE_PUSH_WORKER_SERVICE=shiftmate_stage_push_worker
STAGE_ACCOUNT_DELETION_WORKER_SERVICE=shiftmate_stage_account_deletion_worker
STAGE_REDIS_SERVICE=shiftmate_stage_cache
STAGE_EXTERNAL_HEALTH_URL=https://<실제_Stage_도메인>/api/v1/health
```

서비스명과 3201 바인딩을 함께 확인한다.

```bash
sudo docker compose \
  --project-directory /opt/shiftmate-stage \
  --file /opt/shiftmate-stage/compose.yaml \
  ps

curl -fsS http://127.0.0.1:3201/health
```

이 단계에서는 기존 컨테이너가 계속 실행되며 Nginx도 아직 기존 upstream을 사용한다. `compose.deploy.yaml`은 첫 자동 배포 때 생성된다.

Compose 문법과 최종 이미지/포트 해석을 확인한다.

```bash
sudo docker compose \
  --project-directory /opt/shiftmate-stage \
  --file /opt/shiftmate-stage/compose.yaml \
  config --quiet

sudo docker compose \
  --project-directory /opt/shiftmate-stage \
  --file /opt/shiftmate-stage/compose.yaml \
  config --services

sudo docker compose \
  --project-name shiftmate \
  --env-file /opt/shiftmate/.deploy.env \
  --file /opt/shiftmate/compose.yaml \
  --profile blue \
  --profile green \
  config --quiet

sudo docker compose \
  --project-name shiftmate \
  --env-file /opt/shiftmate/.deploy.env \
  --file /opt/shiftmate/compose.yaml \
  --profile blue \
  --profile green \
  config --services
```

Stage는 API, cache worker, push worker, 회원 탈퇴 worker, Redis 총 5개, Center는 API 6개, worker 6개, Redis 1개로 총 13개 서비스가 나오고 각 `config --quiet`가 출력 없이 종료 코드 0이면 정상이다.

Stage 배포 설정과 최초 배포에 필요한 Firebase secret의 소유권·권한을 확인한다.

```bash
sudo stat -c '%U:%G %a %n' \
  /opt/shiftmate-stage/.deploy.env \
  /opt/shiftmate-stage/secrets \
  /opt/shiftmate-stage/secrets/firebase.json \
  /opt/shiftmate/secrets \
  /opt/shiftmate/secrets/firebase.json
```

`.deploy.env`는 `root:root 600`, 두 `secrets` 디렉터리는 `root:root 700`, `firebase.json`은 `root:root 444`여야 한다. `600` secret 파일은 non-root 컨테이너의 `/run/secrets/*`에서도 읽을 수 없으므로 사용하지 않는다.

## 6. Center·Stage Nginx upstream을 분리

Center는 Blue/Green 전환 대상으로 `shiftmate_center_api_cluster`, Stage는 3201 고정 대상으로 `shiftmate_stage_api_cluster`를 사용한다. 기존 정의 위치를 먼저 확인한다.

```bash
sudo nginx -T 2>&1 \
  | grep -nE 'upstream shiftmate_(api|center_api|stage_api)_cluster|proxy_pass'
```

기존 설정에는 다음과 같은 upstream 블록이 있을 수 있다.

```nginx
upstream shiftmate_center_api_cluster {
    least_conn;
    server 127.0.0.1:3101 ...;
    server 127.0.0.1:3102 ...;
    server 127.0.0.1:3103 ...;
    keepalive 32;
}

upstream shiftmate_stage_api_cluster {
    server 127.0.0.1:3201 ...;
    keepalive 8;
}
```

다음 명령으로 파일을 연다.

```bash
sudoedit /etc/nginx/conf.d/shiftmate-global.conf
```

위 두 upstream 블록을 기존 정의 파일에서 삭제하고, `/etc/nginx/conf.d/shiftmate-global.conf`의 같은 위치에 다음 두 줄을 넣는다.

```nginx
include /etc/nginx/snippets/shiftmate-upstream-active.conf;
include /etc/nginx/snippets/shiftmate-stage-upstream.conf;
```

Center server의 `proxy_pass`는 `http://shiftmate_center_api_cluster`, Stage server의 `proxy_pass`는 `http://shiftmate_stage_api_cluster`여야 한다. 기존 `shiftmate_api_cluster` 참조가 남아 있으면 해당 server block의 용도에 맞는 이름으로 교체한다.

중요: 기존 upstream 블록과 include를 동시에 남기면 동일 이름 중복 오류가 발생한다. 이 Nginx 전환 단계에서는 Stage 3201 컨테이너를 재생성하지 않으며 고정 upstream 정의만 별도 snippet으로 이동한다. 이후 자동 배포는 이 upstream을 유지한 채 Stage 컨테이너 이미지만 교체한다.

검사하고 반영한다. active 파일은 아직 기존 Blue 포트 3101~3103을 가리키므로 트래픽 대상은 바뀌지 않는다.

```bash
sudo nginx -t
sudo systemctl reload nginx

curl -fsS http://127.0.0.1:3101/health
curl -fsS http://127.0.0.1:3201/health
curl -fsS https://api.shiftmate.co.kr/api/v1/health

sudo nginx -T 2>&1 \
  | grep -nE 'upstream shiftmate_(center_api|stage_api)_cluster|proxy_pass'
```

`shiftmate-proxy.conf`의 기존 `proxy_next_upstream_tries 3`과 timeout 설정은 그대로 둔다. Blue/Green 전환은 해당 재시도에 의존하지 않지만 일반 장애 대응에는 유효하다. `non_idempotent` 옵션은 POST 중복 처리 위험이 있으므로 추가하지 않는다.

## 7. 기존 운영 구성을 무중단 Blue/Green 구조로 1회 전환

현재 3101~3103 컨테이너를 Blue로 보고, 같은 `shiftmate-api:1.0.2` 이미지를 Green 3111~3113에 먼저 띄운다. bootstrap 스크립트는 다음을 자동 수행한다.

1. 공유 Redis와 Green API 컨테이너 3개 시작
2. 3111, 3112, 3113의 `/api/v1/health/ready` 확인
3. Nginx를 Green으로 전환 후 설정 검사와 reload
4. 외부 HTTPS health 확인
5. 35초 drain 후 기존 컨테이너 중지
6. 실패 시 Blue upstream 복원

이 1회 bootstrap은 기존 `shiftmate-api:1.0.2` API를 Blue/Green 구조로 옮기는 단계라 worker를 시작하지 않는다. 첫 자동 배포부터 비활성 색상의 세 worker를 API와 같은 digest로 시작하고 각 health를 확인한다.

실행 전 상태를 다시 확인한다.

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
sudo cat /opt/shiftmate/.deploy.env
```

`ACTIVE_COLOR=blue`, 양쪽 이미지가 `shiftmate-api:1.0.2`여야 한다.

전환 실행:

```bash
sudo /usr/local/sbin/shiftmate-bootstrap
```

완료 후 검증:

```bash
sudo cat /opt/shiftmate/.deploy.env

for port in 3111 3112 3113; do
  curl -fsS "http://127.0.0.1:${port}/api/v1/health/ready"
done

curl -fsS https://api.shiftmate.co.kr/api/v1/health

sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
sudo nginx -T 2>&1 | grep -nE '127\.0\.0\.1:31(0|1)[1-3]'
```

정상 결과:

- `.deploy.env`: `ACTIVE_COLOR=green`
- 3111~3113: HTTP 200
- 외부 API health: HTTP 200
- 이전 `shiftmate_api_1~3` 컨테이너: stopped
- PostgreSQL 및 Stage 컨테이너: 변화 없음

## 8. 전용 Self-hosted Runner 설치

Runner를 설치하기 전에 저장소가 Private인지 다시 확인한다.

홈서버에서 전용 사용자를 만든다. 기존 `hyunseo` 계정이나 root로 runner를 실행하지 않는다.

```bash
sudo useradd --create-home --shell /bin/bash github-runner
sudo install -d -o github-runner -g github-runner /opt/actions-runner
```

GitHub 저장소에서 다음으로 이동한다.

```text
Settings -> Actions -> Runners -> New self-hosted runner
Linux -> x64
```

화면에 표시되는 다운로드와 압축 해제 명령은 버전이 바뀌므로 그대로 사용한다. `/opt/actions-runner`에서 `github-runner` 사용자로 실행한다.

```bash
sudo -iu github-runner
cd /opt/actions-runner

# 여기서 GitHub 화면의 curl 및 tar 명령 실행

./config.sh \
  --url https://github.com/hspark-1/shift_calendar_server-deploy \
  --token <GitHub_화면의_일회용_등록_토큰> \
  --name homeserver-firebat-n100 \
  --labels shiftmate-production \
  --unattended

exit
```

등록 토큰은 비밀값이며 문서나 저장소에 남기지 않는다.

서비스로 설치한다.

```bash
cd /opt/actions-runner
sudo ./svc.sh install github-runner
sudo ./svc.sh start
sudo ./svc.sh status
```

`github-runner`를 `docker` 그룹에 추가하지 않는다. Docker와 Nginx 권한은 검증된 고정 스크립트 하나에만 sudo로 허용한다.

sudoers 파일 설치 및 검사:

```bash
sudo install -o root -g root -m 0440 \
  ~/github-runner-shiftmate \
  /etc/sudoers.d/github-runner-shiftmate

sudo visudo -cf /etc/sudoers.d/github-runner-shiftmate
```

sudoers에는 root 소유 launcher 경로만 허용한다. launcher는 `deploy|rollback` mode, 고정 repository/actor/workspace, source SHA, 이미지 commit tag, Git HEAD와 배포 엔진·두 Compose·두 feature flag config의 tree mode/blob hash를 거부 우선 방식으로 검증한다. 검증된 다섯 파일을 `/run`의 root 전용 임시 번들로 복사하고 환경을 초기화한 뒤 실행한다. 저장소 스크립트 자체는 sudoers 직접 실행 대상이 아니다.

```bash
sudo stat -c '%U:%G %a %n' \
  /usr/local/sbin/shiftmate-deploy-launcher \
  /etc/sudoers.d/github-runner-shiftmate

sudo -l -U github-runner
```

두 파일은 각각 `root:root 755`, `root:root 440`이어야 한다. feature flag config bundle 검증을 지원하는 launcher를 한 번 설치한 이후에는 배포 엔진, 두 base Compose와 두 flag config 변경에 추가 홈서버 설치가 필요하지 않다.

GitHub의 Runners 화면에서 다음 상태를 확인한다.

```text
Name: homeserver-firebat-n100
Status: Idle
Labels: self-hosted, Linux, X64, shiftmate-production
```

Runner는 GitHub로 outbound 연결하므로 홈서버 SSH를 외부에 공개할 필요가 없다.

## 9. 첫 배포와 이후 자동 배포

launcher/sudoers를 설치한 커밋을 `deploy/main`에 push하면 자동 배포가 시작된다. 같은 main commit을 수동 재실행할 때만 다음 순서를 사용한다.

```text
Actions
-> Deploy production
-> Run workflow
-> Branch: main
-> confirm 체크
-> Run workflow
```

워크플로 동작:

1. main push 또는 수동 실행의 `main`과 확인 체크 검증
2. Node 22에서 `npm ci`, unit/cache/push/회원 탈퇴 integration test
3. `linux/amd64` Docker 이미지 생성
4. `ghcr.io/hspark-1/shift_calendar_server:sha-<commit SHA>` push
5. 홈서버가 같은 commit을 checkout하고 launcher가 repository/workspace/commit/image와 배포 엔진·두 Compose blob을 검증
6. root 임시 번들의 두 Compose를 홈서버 project directory 기준으로 검증하고 직전 파일 백업 후 실행 경로에 원자 설치
7. 검증된 main의 배포 엔진이 해당 이미지를 pull하고 digest로 고정
8. Stage/Center Redis health 확인
9. `/opt/shiftmate-stage/compose.deploy.yaml`에 같은 digest를 기록하고 Stage API와 세 worker 재생성
10. Stage API readiness와 세 worker health 확인
11. 비활성 Center 색상 API 3개와 세 worker 시작 후 API readiness와 세 worker health 확인
12. Nginx를 새 Center 색상으로 전환
13. Center와 Stage 외부 health를 모두 확인한 뒤 이전 Center API/세 worker 중지

Stage API는 단일 컨테이너라 재생성 중 짧은 중단이 발생할 수 있다. Center는 비활성 색상 API 3개와 세 worker를 준비한 뒤 전환한다. 어느 단계든 실패하면 Stage API/세 worker, Center API/세 worker, 두 base Compose, 두 flag config, flag 정리 전 `.env`, upstream과 상태 파일을 배포 전 상태로 함께 복원한다. 최초 도입 배포가 실패하면 직전 Compose에 없던 탈퇴 worker 컨테이너도 제거한다. `.deploy.env`와 `secrets/`는 설치·복원 대상에 포함하지 않는다.

추가 PAT나 Repository Secret은 필요 없다. 같은 저장소에서 발급되는 짧은 수명의 `GITHUB_TOKEN`을 push와 pull에 사용한다. 홈서버의 `.env`, DB 암호, JWT secret은 GitHub로 전달하지 않는다.

첫 push 후 GitHub 프로필의 `Packages`에서 `shift_calendar_server` 패키지를 확인한다.

- Visibility: Private
- Repository access: `hspark-1/shift_calendar_server-deploy`

GHCR package가 기존 애플리케이션 저장소에 연결되어 있거나 build/pull 권한 오류가 발생하면 Package settings의 `Manage Actions access`에 `hspark-1/shift_calendar_server-deploy`를 추가하고 Write 권한을 준다. Write는 build job의 push와 deploy/rollback job의 pull을 모두 허용한다.

배포 후 서버 검증:

```bash
sudo cat /opt/shiftmate/.deploy.env
sudo cat /opt/shiftmate-stage/.deploy.env
sudo cat /opt/shiftmate-stage/compose.deploy.yaml
sudo tail -n 200 /var/log/shiftmate-deploy.log

curl -fsS https://api.shiftmate.co.kr/api/v1/health
curl -fsS https://<실제_Stage_도메인>/api/v1/health

sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
sudo docker network inspect shiftmate_center_internal
```

첫 자동 배포에서는 Stage API/세 worker를 먼저 같은 이미지로 교체하고, Center는 Green에서 Blue로 전환되어 3101~3103과 Blue 세 worker가 새 이미지로 실행된다. 정상 상태에서는 Stage API/세 worker와 Center API 3개/세 worker가 같은 digest를 사용하며 Redis는 환경별 singleton으로 유지된다.

Apple 로그인 배포 전 두 호스트의 `.p8`과 필수 환경값을 확인합니다. Stage 배포 후 challenge/login과 카카오·네이버·refresh 인증 회귀가 정상인지 확인합니다.

```bash
sudo stat -c '%U:%G %a %n' /opt/shiftmate-stage/secrets/apple_signin.p8
sudo stat -c '%U:%G %a %n' /opt/shiftmate/secrets/apple_signin.p8
curl -sS -X POST 'https://<실제_Stage_도메인>/api/v1/auth/apple/challenge' \
  -H 'Content-Type: application/json' \
  --data '{"platform":"ios"}'
```

키 파일 내용은 shell history나 `.env`에 복사하지 않습니다. 다음 방식으로 각 환경의 키를 설치합니다.

```bash
# 개발 PC
scp ~/Downloads/AuthKey_Stage.p8 \
  hyunseo@<홈서버_내부_IP>:~/apple-signin-stage.p8

# 홈서버
sudo install -o root -g root -m 0444 \
  ~/apple-signin-stage.p8 /opt/shiftmate-stage/secrets/apple_signin.p8
rm -f ~/apple-signin-stage.p8
sudo stat -c '%U:%G %a %n' \
  /opt/shiftmate-stage/secrets/apple_signin.p8
sudo docker compose \
  --project-directory /opt/shiftmate-stage \
  --file /opt/shiftmate-stage/compose.yaml \
  config --quiet
```

Stage `.env`에 Apple 실제 설정을 넣고 배포합니다. 실기기 E2E 승인 뒤 Center에도 같은 절차로 환경별 값을 설치하고 배포합니다.

## 10. 롤백

이전 버전의 40자리 commit SHA를 GitHub의 이전 배포 workflow 또는 commit 화면에서 복사한다.

```text
Actions
-> Roll back production
-> Run workflow
-> Branch: main
-> commit_sha 입력
-> confirm 체크
-> Run workflow
```

롤백도 같은 통합 배포 경로를 사용한다. 지정한 이전 이미지를 Stage API/세 worker에 먼저 적용해 health를 확인하고, Center 비활성 색상 API/세 worker에 올린 뒤 Nginx를 전환한다. 캐시 기능 자체를 긴급 중단할 때는 대상 환경의 versioned config에서 `WORK_SHIFT_CACHE_ENABLED=false`로 변경해 배포한다. Push 긴급 중단은 `PUSH_JOB_ENQUEUE_ENABLED=false`를 먼저 배포한 뒤 필요하면 `PUSH_WORKER_ENABLED=false`도 후속 배포한다. 탈퇴 긴급 중단은 접수 차단을 위해 `ACCOUNT_DELETION_ENABLED=false`를 먼저 배포하고, 대기 작업 처리 정책을 확인한 후에만 worker flag를 끕니다. 신규 테이블과 기존 job은 별도 승인 없이 삭제하지 않는다.

긴급하게 Actions를 사용할 수 없을 때는 `read:packages` 권한의 GitHub PAT classic을 일시적으로 입력해 같은 스크립트를 호출할 수 있다. 토큰을 명령행 인자나 파일에 저장하지 않는다.

```bash
read -rsp 'GHCR token: ' GHCR_TOKEN
printf '\n'

source_sha="$(sudo -u github-runner git \
  -C /opt/actions-runner/_work/shift_calendar_server-deploy/shift_calendar_server-deploy \
  rev-parse HEAD)"

printf '%s\n' "$GHCR_TOKEN" \
  | sudo /usr/local/sbin/shiftmate-deploy-launcher \
      rollback \
      /opt/actions-runner/_work/shift_calendar_server-deploy/shift_calendar_server-deploy \
      ghcr.io/hspark-1/shift_calendar_server:sha-<40자리_commit_SHA> \
      "$source_sha" \
      hspark-1 \
      hspark-1/shift_calendar_server-deploy

unset GHCR_TOKEN source_sha
```

## 11. 장애 발생 시 확인 순서

### Build 실패

```text
npm ci 실패      -> package-lock.json과 package.json 불일치 확인
npm run build 실패 -> TypeScript 오류 수정
Docker build 실패  -> Dockerfile COPY 대상과 .dockerignore 확인
GHCR push 실패     -> workflow packages: write 및 저장소 Actions 권한 확인
```

Build가 실패하면 홈서버에는 아무 변경도 없다.

### Deploy가 queued 상태

```bash
cd /opt/actions-runner
sudo ./svc.sh status
sudo journalctl -u 'actions.runner*' -n 200 --no-pager
```

GitHub Runner 화면에서 `Idle`과 `shiftmate-production` label을 확인한다.

### 내부 health 실패

Stage 실패면 이전 Stage override를 복원하고 기존 이미지로 재생성한다. Center 실패면 Nginx를 전환하지 않고 새 색상을 중지하며, 앞서 변경한 Stage도 이전 이미지로 복원한다. 확인:

```bash
sudo tail -n 300 /var/log/shiftmate-deploy.log

sudo docker compose \
  --project-directory /opt/shiftmate-stage \
  --file /opt/shiftmate-stage/compose.yaml \
  --file /opt/shiftmate-stage/compose.deploy.yaml \
  logs --tail=200

sudo docker compose \
  --project-name shiftmate \
  --env-file /opt/shiftmate/.deploy.env \
  --file /opt/shiftmate/compose.yaml \
  --profile blue \
  --profile green \
  logs --tail=200
```

DB 오류라면 `shiftmate_center_internal` 안에 PostgreSQL alias `postgres`와 API 컨테이너가 같이 있는지 확인한다.

Stage 자동 배포가 시작되기 전에 실패하면 설정을 확인한다.

```bash
sudo cat /opt/shiftmate-stage/.deploy.env
sudo docker compose \
  --project-directory /opt/shiftmate-stage \
  --file /opt/shiftmate-stage/compose.yaml \
  config --services
curl -fsS http://127.0.0.1:3201/api/v1/health/ready
```

`STAGE_SERVICE`, `STAGE_WORKER_SERVICE`, `STAGE_PUSH_WORKER_SERVICE`, `STAGE_REDIS_SERVICE`가 `config --services` 결과와 정확히 일치해야 하며 `STAGE_EXTERNAL_HEALTH_URL`은 HTTPS `/api/v1/health` 주소여야 한다.

기존 Stage readiness 실패 자체는 새 이미지 배포를 막지 않는다. 배포 스크립트는 기존 Stage 컨테이너 상태와 최근 API 로그를 남긴 뒤 새 digest로 Stage API와 세 worker를 재생성한다. 새 Stage readiness 또는 worker health까지 실패한 경우에만 이전 override를 복원하며, 이전 Stage도 이미 unhealthy였다면 복원 후 경고가 남을 수 있다. 새 이미지 적용 전 원인을 즉시 확인해야 할 때는 위의 `logs --tail=200` 출력에서 `server_start_failed`와 환경변수·DB 연결 오류를 먼저 확인한다.

### Nginx 또는 외부 health 실패

스크립트가 기존 upstream, `.deploy.env`, 두 base Compose, 두 flag config와 flag 정리 전 `.env`를 자동 복원한다. 확인:

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo cat /etc/nginx/snippets/shiftmate-upstream-active.conf
sudo cat /etc/nginx/snippets/shiftmate-stage-upstream.conf
sudo cat /opt/shiftmate/.deploy.env
sudo cat /opt/shiftmate-stage/compose.deploy.yaml
curl -fsS https://api.shiftmate.co.kr/api/v1/health
curl -fsS https://<실제_Stage_도메인>/api/v1/health
```

## 12. 비용과 이미지 보존

GitHub Free의 private Packages 기본 포함량은 저장공간 500MB, 월 데이터 전송 1GB다. 현재 로컬 Docker 이미지 표시 크기 550MB는 registry 압축 저장량과 동일하지 않지만, 여러 버전을 계속 쌓으면 한도를 넘을 수 있다.

초기 운영 원칙:

- 현재 버전과 직전 2개 이상은 롤백용으로 유지
- 동일 base/dependency layer는 재사용되지만 사용량을 GitHub Billing에서 확인
- 한도에 가까워지면 오래된 package version부터 GitHub Packages 화면에서 삭제
- `latest` 태그는 사용하지 않고 `sha-<commit>`만 사용
- 서버에서는 `docker image prune`으로 dangling image만 제거하며 현재/이전 이미지는 유지

Private 저장소의 GitHub-hosted build는 GitHub Free 월 2,000분 안에서 사용되고, self-hosted runner 실행 시간은 무료다. 작은 사이드 프로젝트의 수동 배포에는 일반적으로 충분하지만 Billing의 사용량과 예산을 확인한다.

## 13. DB migration 원칙

현재 migration은 수동이므로 이 자동화에도 넣지 않았다. 공유 캐시 배포 전 DB 백업 후 `migrations/add_work_shift_month_cache_support.sql`을 1회 적용하고, state 백필 건수와 미처리 Outbox 인덱스를 확인한다. 이미지 롤백은 DB schema를 되돌리지 못한다.

이번 캐시는 다음 순서로 활성화한다.

1. DB 백업과 expand migration 수동 적용
2. Stage/Center Redis와 worker 정의 및 환경별 key prefix 설정
3. `WORK_SHIFT_CACHE_ENABLED=false`로 신규 이미지 배포
4. Stage feature flag config를 true로 변경·배포하고 hit/304/worker health 확인
5. Production feature flag config를 true로 변경·배포한 후 Outbox 지연과 DB fallback 관찰

Push는 cache migration과 별개로 아래 순서로 활성화한다. `migrations/add_push_notification_support.sql`은 컨테이너 이미지에 포함되지 않으므로 개발 PC의 검토된 파일을 pgAdmin Query Tool 또는 별도 관리 연결에서 수동 실행한다. `migrations/final_schema.sql`은 `DROP SCHEMA`가 있으므로 Stage/Production에 실행하면 안 된다.

1. DB backup 식별자를 기록하고 Stage DB가 맞는지 `current_database()`, `current_user`, `version()`을 다시 확인한다.
2. 기존 `notifications` 건수와 `to_regclass('public.user_devices')`, `push_jobs`, `push_deliveries`가 모두 `NULL`인지 확인한다.
3. `migrations/add_push_notification_support.sql` 전체를 transaction/오류 중단으로 1회 실행한다. 기존 `notifications` row는 수정하거나 backfill하지 않는다.
4. 신규 세 테이블, 제약, 인덱스와 `push_jobs=0`, `push_deliveries=0`을 확인한다.
5. 두 push flag가 `false`인 이미지와 worker를 배포한다.
6. Firebase readiness를 메시지 전송 없이 확인한다.

```bash
sudo docker compose \
  --project-directory /opt/shiftmate-stage \
  --file /opt/shiftmate-stage/compose.yaml \
  --file /opt/shiftmate-stage/compose.deploy.yaml \
  run --rm --no-deps \
  -e PUSH_WORKER_ENABLED=true \
  <실제_Stage_push_worker_서비스명> \
  node dist/workers/pushWorker.js --healthcheck
```

7. Stage 앱에서 로그인 후 `user_devices` 등록을 확인한다.
8. Stage feature flag config의 `PUSH_JOB_ENQUEUE_ENABLED=true`를 먼저 커밋·배포해 새 알림의 pending job 생성을 확인한다.
9. 다음 커밋에서 `PUSH_WORKER_ENABLED=true`를 적용·배포한 뒤 6개 알림 E2E를 수행한다.
10. Production은 Production 앱 배포로 기기 등록 기간을 확보한 뒤 같은 순서를 반복한다.

Push rollback은 enqueue 비활성화 → Push Worker 중지 → 이전 API 이미지 배포 순서다. 신규 세 테이블과 job은 보존한다.

향후 migration도 다음 순서를 사용한다.

1. 이전 버전과 새 버전이 모두 동작하는 확장형 schema 변경
2. 새 애플리케이션 Blue/Green 배포
3. 데이터 backfill
4. 충분히 검증한 다음 이전 column/constraint 제거

column 삭제·rename처럼 이전 버전을 깨뜨리는 migration과 애플리케이션 배포를 한 번에 실행하지 않는다.

## 14. 이 적용에서 바꾸지 않는 것

- `/srv/postgres/compose.yml` 및 PostgreSQL bind mount
- `/srv/postgres-stage/compose.yml`
- 기존 Stage 애플리케이션 `.env`의 secret·접속 실제값과 Firebase/Apple secret 실제값
- `shiftmate_center_internal` 네트워크
- 운영 `/opt/shiftmate/.env`의 secret·접속 실제값(관리 대상 flag line만 자동 제거)
- Nginx TLS 인증서
- 127.0.0.1 DB/API 바인딩 원칙

`https://www.shiftmate.co.kr/health`의 TLS SNI 오류는 `api.shiftmate.co.kr` 운영 배포와 별개의 인증서/server_name 문제다. Center 검증에는 정상 확인된 `https://api.shiftmate.co.kr/api/v1/health`를 사용하고, Stage 검증에는 `/opt/shiftmate-stage/.deploy.env`에 지정한 별도 HTTPS URL을 사용한다.

Stage/Center base Compose와 feature flag의 저장소 정본은 각각 `deploy/compose.{stage,production}.yaml`, `deploy/config/feature-flags.{stage,production}.env`이다. 자동 배포는 launcher가 exact main blob을 검증한 뒤 직전 파일을 백업하고 `/opt/shiftmate{,-stage}`의 Compose와 `feature-flags.env`에 원자 동기화한다. 실패하면 config와 Compose를 함께 복원한다. `/opt/shiftmate{,-stage}/.env`의 secret·접속값, `.deploy.env`, `secrets/firebase.json`, `secrets/apple_signin.p8`의 실제 값은 운영자가 계속 관리한다. 관리 대상 6개 flag line만 중복 정본 제거를 위해 `.env`에서 자동 삭제되며 실패 시 원복된다.

## 15. 최종 체크리스트

```text
[ ] GitHub repository를 Private으로 변경
[ ] 저장소에 .github/workflows와 deploy 파일 추가
[ ] .dockerignore에 .github, deploy 추가
[ ] main에 commit/push
[ ] 운영 Compose/Nginx 파일 백업
[ ] 서버에 새 Compose, state, script, upstream 파일 설치
[ ] DB 백업 후 add_work_shift_month_cache_support.sql 수동 적용
[ ] Center/Stage .env에 서로 다른 REDIS_URL, REDIS_PASSWORD, CACHE_KEY_PREFIX 설정
[ ] Stage/Production Firebase project와 service account JSON을 각각 준비
[ ] /opt/shiftmate{,-stage}/secrets 디렉터리는 root:root 700, firebase.json은 root:root 444
[ ] Stage/Center Apple .p8을 root:root 444로 설치하고 필수 환경값 설정
[ ] DB 백업·복원 확인 후 Stage pgAdmin 단일 transaction 또는 psql Apple migration 경로 중 하나만 실행하고 checksum·초기 0건 기록
[ ] Center/Stage .env에 Push 접속·동작 변수를 추가하고 versioned config의 최초 두 flag는 false
[ ] DB 백업 후 add_push_notification_support.sql 수동 적용 및 기존 notifications 무변경 확인
[ ] 최초 bootstrap용 두 base Compose를 운영 경로에 설치
[ ] /opt/shiftmate-stage/.deploy.env에 정본의 다섯 서비스명과 외부 health URL 설정
[ ] Stage 3201 기존 내부 health 성공
[ ] Nginx 기존 Center·Stage upstream 블록을 include 두 줄로 교체
[ ] Center/Stage proxy_pass가 각각 분리된 cluster 이름을 참조
[ ] nginx -t 및 기존 외부 health 성공
[ ] shiftmate-bootstrap 성공, Redis와 Green API 3111~3113 활성(첫 자동 배포부터 세 worker 활성)
[ ] 전용 github-runner 사용자와 repository runner 설치
[ ] runner에 shiftmate-production label 지정
[ ] Compose bundle 검증을 지원하는 root launcher와 sudoers 설치 후 소유권·권한·visudo 검사 성공
[ ] main branch protection에서 PR·`Validate main / validate` 필수 check·직접 push 제한 설정
[ ] main push 자동 배포 또는 Deploy production 수동 재실행 성공
[ ] GHCR package가 Private이고 배포 저장소 Actions access가 Write로 연결
[ ] Stage/Center Redis·cache worker·push worker·회원 탈퇴 worker health, API 내부 readiness 및 양쪽 외부 health 성공
[ ] Stage API/세 worker와 Center API 3개/세 worker가 동일 image digest를 사용하는지 확인
[ ] Stage 배포 후 Apple challenge/login과 기존 인증 회귀 성공
[ ] Stage Flutter 기기 등록 후 enqueue → worker 순차 활성화와 6개 알림 E2E 성공
[ ] 계정 삭제/revoke와 iOS/Android 실기기 E2E 확인 후 Apple 앱 버튼 노출
[ ] PostgreSQL 및 두 DB Compose 무변경 확인
[ ] Roll back production 화면 확인
[ ] GitHub Billing에서 Actions/Packages 사용량 확인
```

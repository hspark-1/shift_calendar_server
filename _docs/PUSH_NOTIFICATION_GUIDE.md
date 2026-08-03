# Push Worker 기반 푸시 알림 가이드

## 1. 책임과 전달 보장

`notifications`가 인앱 알림의 원본이고 FCM은 새 알림의 존재를 알려주는 보조 전달 수단입니다. API 서버는 FCM을 직접 호출하지 않습니다.

```text
도메인 Service
  → Sequelize transaction
     ├─ notifications INSERT
     └─ push_jobs INSERT
  → Push Worker
  → user_devices 최신 활성 기기 1대
  → push_deliveries 고정
  → Firebase Admin sendEach()
```

- 지원 알림: `FRIEND_REQUEST`, `FRIEND_ACCEPTED`, `FRIEND_REJECTED`, `GROUP_INVITATION`, `GROUP_INVITATION_ACCEPTED`, `GROUP_INVITATION_REJECTED`
- 대상 정책: `LATEST_ACTIVE` 한 대
- 보장: at-least-once. FCM 성공 직후 DB 기록 전 종료되면 중복 가능
- 완화: Android notification tag/collapse key, iOS `apns-collapse-id`, Flutter `notification_id` 영속 중복 제거
- 과거 `notifications`는 migration이나 기능 활성화 때 backfill하지 않음

## 2. DB migration

적용 파일은 `migrations/add_push_notification_support.sql`입니다.

- `user_devices`: 환경별 설치 UUID, 사용자 귀속, 플랫폼, 권한/활성 상태, FCM target, 앱 버전과 활동 시각
- `push_jobs`: 알림 snapshot, 수신자, TTL, 시도/가용 시각, lease, 취소/오류 상태
- `push_deliveries`: 최초 선택한 단일 기기와 provider 결과

핵심 제약은 다음과 같습니다.

- `UNIQUE(app_environment, installation_id)`
- target이 있을 때 `UNIQUE(app_environment, provider, provider_target)`
- `UNIQUE(push_jobs.notification_id)`
- `UNIQUE(push_deliveries.push_job_id, device_id)` 및 `UNIQUE(push_deliveries.push_job_id)`
- pending/lease/latest-active 부분 인덱스

migration은 expand-only이며 기존 테이블이나 데이터를 삭제하지 않습니다. 애플리케이션 rollback 시 신규 테이블과 기록도 보존합니다. 실제 DB 적용 전 백업, 예상 DB명, PostgreSQL 연결 여유를 검증해야 합니다.

## 3. 기기 API

### PUT `/api/v1/devices/current`

Bearer 인증이 필요하며 같은 환경·설치 UUID 요청은 멱등입니다.

```json
{
  "installation_id": "5dcad980-2f25-4e2e-9bc7-245382c3ff42",
  "platform": "IOS",
  "provider_target": "fcm-registration-token-or-null",
  "push_permission_enabled": true,
  "app_version": "1.0.0+1"
}
```

서버는 `user_id`, `provider=FCM`, `target_type=FCM_TOKEN`, `app_environment`를 결정합니다. 응답에는 `device_id`, 설치 UUID, 플랫폼, 권한/활성 상태, `last_seen_at`만 있고 raw target은 없습니다.

- 권한 거부 또는 token 미발급: `provider_target=null`, `push_permission_enabled=false`
- 같은 target이 다른 설치/사용자에 있으면 advisory transaction lock으로 이전 row를 비활성화하고 현재 설치에 귀속
- target이 없거나 권한이 꺼져 있으면 기기는 비활성 상태

### 로그아웃

- `POST /api/v1/auth/logout`: 기존 body를 계속 허용하며 선택 `installation_id`가 있으면 refresh token 폐기와 그 설치 해제를 한 transaction에서 수행
- `POST /api/v1/auth/logout-all`: 사용자의 refresh token 전체 폐기와 모든 등록 기기 해제를 한 transaction에서 수행
- 설치 UUID는 서버 귀속 해제 후에도 Flutter secure storage에 남아 다음 로그인에서 재사용

## 4. 알림 생성과 stale job 취소

친구/그룹 서비스는 `createNotificationWithPushJob()`을 호출자의 기존 Sequelize transaction에 전달합니다. 지원 타입이고 `PUSH_JOB_ENQUEUE_ENABLED=true`이면 `notifications`와 `push_jobs` 중 하나라도 실패할 때 도메인 transaction 전체가 rollback됩니다.

job은 다음 문자열 data snapshot을 저장합니다.

```json
{
  "schema_version": "1",
  "notification_id": "<uuid>",
  "notification_type": "FRIEND_REQUEST",
  "destination": "NOTIFICATIONS"
}
```

친구 요청·그룹 초대 원본이 수락, 거절, 취소, 만료될 때 새 원본 푸시는 만들지 않습니다. `PENDING`/`RETRY` job은 즉시 `CANCELED`, `PROCESSING` job은 `cancel_requested_at`을 기록합니다. provider 호출이 이미 시작된 경우 취소는 best-effort입니다. 처리 결과 알림은 별도 notification/job으로 정상 발송됩니다.

## 5. Worker 계약

### claim과 선택

- `FOR UPDATE SKIP LOCKED`, `locked_by`, `lease_until`
- 기본 batch 20, lease 120초, poll 1초
- 선택 조건: 같은 수신자/환경, 활성, 권한 허용, FCM token 보유
- 정렬: `last_seen_at DESC`, `target_updated_at DESC NULLS LAST`, `device_id ASC`
- 최초 선택을 `push_deliveries`에 저장하고 재시도도 같은 device 사용
- 재시도 직전 `user_devices`의 최신 token을 다시 읽음
- 선택 기기 해제/권한 철회/영구 오류 시 같은 job에서 fallback하지 않고 `NO_TARGET`/`FAILED` 종료

만료 lease는 다시 claim합니다. 취소, TTL, 최대 시도 조건을 만족한 만료 lease는 job과 delivery를 함께 terminal 상태로 회수합니다.

### FCM payload

- notification: job snapshot `title`, `body`
- data: 위 schema v1 문자열 4개
- Android: high priority, `shiftmate_high`, 기본 sound, tag/collapse key=`notification_id`
- iOS: 기본 sound, `apns-collapse-id=notification_id`, priority 10
- TTL: job 잔여 만료 시간, 생성 기준 최대 1시간

### retry와 영구 오류

- 일시 오류: 429/5xx 계열 Firebase 코드, provider/network 오류
- 지연: 10초 지수 backoff + 0.8~1.2 jitter, 최대 15분
- `Retry-After`가 있으면 우선하되 15분 상한 적용
- 최대 6회 또는 생성 후 1시간 중 먼저 도달하는 조건으로 종료
- 등록 해제/잘못된 token은 기기를 비활성화
- `messaging/invalid-argument`는 서버가 고정 schema·payload를 생성하고 내부 검증을 통과한 메시지이므로 target 영구 오류로 취급

terminal job/delivery는 기본 30일 후 job 삭제 시 FK cascade로 정리합니다.

## 6. 실행과 readiness

Node 22와 정확히 고정한 `firebase-admin 13.10.0`을 사용합니다.

```bash
npm run build
npm run start:push-worker
node dist/workers/pushWorker.js --healthcheck
```

readiness는 PostgreSQL 연결과 Firebase credential access token을 확인하며 실제 메시지를 보내지 않습니다. worker 컨테이너의 `DB_POOL_MAX`는 2로 제한합니다.

```text
PUSH_JOB_ENQUEUE_ENABLED=false
PUSH_WORKER_ENABLED=false
PUSH_APP_ENVIRONMENT=STAGE|PROD
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase.json
FIREBASE_PROJECT_ID=<environment-project>
PUSH_JOB_POLL_MS=1000
PUSH_JOB_BATCH_SIZE=20
PUSH_JOB_LEASE_SECONDS=120
PUSH_MAX_ATTEMPTS=6
PUSH_JOB_TTL_SECONDS=3600
PUSH_TERMINAL_RETENTION_DAYS=30
DB_POOL_MAX=2
```

service account는 Git/image/log에 넣지 않고 read-only secret으로 mount합니다. Stage와 Production은 DB, Firebase project, service account를 완전히 분리합니다.

## 7. 배포와 rollback

1. 환경별 Firebase 앱, APNs key, service account와 DB 백업/연결 여유를 준비합니다.
2. expand migration을 적용합니다.
3. API와 worker를 두 flag가 모두 `false`인 상태로 배포합니다.
4. Stage 실기기 등록 확인 후 enqueue, worker 순서로 켭니다.
5. Production 앱의 기기 등록 기간을 확보한 뒤 Production enqueue, worker 순서로 켭니다.

rollback은 `PUSH_JOB_ENQUEUE_ENABLED=false` → worker 중지 → 이전 API 이미지 복귀 순서입니다. 신규 테이블은 승인 없이 drop하지 않습니다.

## 8. 관측과 보안

필수 지표는 pending 수, oldest pending age, sent/retry/failed/no-target/expired/canceled, lease 회수, 비활성화 기기 수, FCM 지연, worker heartbeat입니다.

운영 활성화 조건은 정상 부하에서 oldest pending 60초 미만, 환경 간 오발송 0건, 중복 job 0건, 로그의 raw target/title/body/payload 0건입니다. access/error log에는 request body나 provider target을 넣지 않고 delivery에는 target SHA-256 hash만 저장합니다.

## 9. 검증 범위

- 자동: TypeScript build, 서버 전체 테스트, retry/lease/migration/OpenAPI 계약, `git diff --check`
- Stage DB: migration 제약/인덱스/무-backfill, 동시 claim/lease 복구
- 실기기: Android/iOS 6개 타입, 최신 한 대 전환, 권한/로그아웃/환경 격리, token 영구 오류 후 다음 알림의 차순위 선택, worker 중단 복구, stale 원본 push 취소

Firebase/APNs 자격 증명과 실제 Stage/Production 기기는 저장소 외부 자원이므로 자동 테스트가 이를 대체하지 않습니다.

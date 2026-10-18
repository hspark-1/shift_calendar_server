# 개인정보 삭제·보관 운영 절차

기준일: 2026-10-18. 적용 대상: 이번 변경을 배포한 API, 회원 탈퇴 worker, Push Worker. 운영 적용 전에는 기존 홈서버 동작을 설명하는 문서로 사용하지 않습니다. 공개 페이지 주소는 `https://www.shiftmate.co.kr/privacy`입니다.

## 승인 정책과 실제 처리 주기

- 탈퇴 처리 목표: 최초 요청부터 7일 이내. 자동 완료 보장이 아님.
- 실패 또는 24시간 대기: 경보. 7일 경과: 목표 초과. 30일 경과: 운영자 최종 처리 의무 위반 경보.
- 연결 해제된 기기: 해제 및 마지막 변경 모두 30일 경과 시 정리. 사용자·푸시 연결이 없고 비활성인 행만 삭제. 진행 중 푸시 참조는 복구를 위해 보류하고 원인 해결 후 정리.
- 완료 탈퇴 기록 및 종료 푸시 작업: 완료 시각부터 30일 경과 후 정리. 기존 두 retention env가 30 외의 값이면 worker/cleanup이 오류로 중단하므로 적용 전에 30으로 맞춤.
- 정리 작업은 worker 시작 시와 이후 24시간마다 실행. 30일은 삭제 대상 선정 기준이며 실제 삭제는 다음 성공 주기에 수행. 장애 지연은 감시/수동 복구 대상.
- 미완료 탈퇴·provider 자격정보는 기간만으로 삭제하지 않음. 원인 해결 후 완료하고, 완료 기록은 30일 기준 정리. 30일 내 해결 불가능한 예외는 운영자가 책임자·원인·최소 보존 항목·다음 검토일을 기록하고 즉시 조치. 무기한 방치나 자동 provider 성공 간주는 금지.
- 로그 최대 30일, 백업 최대 30일 순환, 문의 완료 후 1년은 승인 정책이나 실제 서버/메일 설정 증거는 별도 수집 필요.

## BE-01 처리와 호환 경계

```text
접수 transaction: user=DELETION_PENDING + image_scope 저장 + 세션/기기 해제
worker: 사용자 advisory lock
  → Apple/Kakao 해제
  → 관리 이미지의 객체·이전 버전·delete marker 삭제 및 빈 목록 확인
  → images_purged_at 저장
  → DB purge
  → Redis purge
  → COMPLETED, user_id/image_scope/cache_year_months 제거
```

`image_scope`에는 신뢰한 환경의 bucket, `<local|test|stage|center>/profiles/{uuid}/`, endpoint/region/path-style을 포함한 설정 fingerprint만 저장합니다. 클라이언트 URL은 삭제 경로로 사용하지 않습니다. 다른 사용자·환경 prefix와 외부 소셜 사진에는 접근하지 않습니다. 재시도 중 저장소 설정 변경은 `ACCOUNT_IMAGE_STORAGE_CHANGED`로 중단하므로 실제 이관 여부를 확인하여 원래 설정을 복원해야 합니다. 작업의 scope를 임의로 바꿔 성공시키지 않습니다.

`ListBucket`, `GetBucketVersioning`, `DeleteObject` 및 버전 사용 시 `ListBucketVersions`, `DeleteObjectVersion` 권한이 필요합니다. bucket 목록 권한에는 해당 환경의 `profiles/*` prefix 조건을 사용하고 객체 삭제 권한은 같은 환경 객체 경로로 제한합니다. Object Lock/MFA delete/보존 정책이 막으면 실패 상태를 유지합니다. 요청당 1,000개, 한 시도당 최대 20 page를 지우며 남은 객체는 다음 재시도에서 처리합니다. 없는 객체/버전은 멱등 성공입니다.

기존 `PENDING/RETRY/FAILED/CACHE_PURGE_PENDING` 작업은 user_id가 보존되어 있으면 scope를 생성해 이어갈 수 있습니다. `FAILED`는 원인 해결 후 운영 재처리 필요. 이미 `COMPLETED`이고 user_id가 제거된 과거 작업은 자동 추적 불가입니다. 기존 prefix 도입 전의 `profiles/{uuid}/`, 다른 bucket/이관 전 경로는 자동 삭제하지 않습니다. 배포 전 운영자가 저장소 이력과 실제 소유권을 대조하여 별도 이관/정리 계획을 기록해야 합니다.

신규 업로드와 worker는 같은 사용자 session advisory lock을 사용합니다. worker는 네트워크 작업 동안 DB transaction을 열어두지 않습니다. lock 전용 연결 외에 일반 DB 연결이 필요하므로 DB_POOL_MAX는 2 이상입니다. API 동시 lock 수를 pool 절반으로 제한하여 연결 고갈 교착을 방지하고 경합은 재시도 가능한 업로드 503으로 처리합니다. 탈퇴 접수 이후 업로드는 활성 사용자 재검사로 차단됩니다.

현재 이미지 응답은 `public, max-age=31536000, immutable`입니다. 원본/버전 삭제는 CDN·프록시·브라우저·이미 다운로드한 파일의 즉시 회수를 보장하지 않습니다. 실제 CDN/홈서버 캐시 purge, 이전 URL 검사, 백업 30일 회전 증거는 운영자가 별도로 확보합니다. URL의 404만으로 모든 캐시 사본 삭제를 주장하지 않습니다.

## 배포 순서

1. 현재 API/worker image digest와 실제 env 허용 목록을 기록하고 진행 중 탈퇴 건수, 저장소 위치·prefix·versioning·권한을 확인합니다. 기존 API의 in-flight 업로드를 drain합니다.
2. 구버전 회원 탈퇴 worker를 모두 중지합니다. 새 API/구 worker의 혼합 실행은 금지합니다. 구 worker는 새 이미지 삭제 단계를 건너뛸 수 있습니다. Push Worker도 migration 전에 정지합니다.
3. 환경을 확인한 DB 연결에서 백업 후 다음 순서로 실행합니다. **운영에 final_schema.sql을 실행하지 않습니다.**

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f migrations/privacy_deletion_preflight.sql
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f migrations/add_privacy_deletion_controls.sql
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f migrations/privacy_deletion_postflight.sql
```

`DATABASE_URL` 값은 공유하거나 로그에 출력하지 않습니다. pgAdmin은 각 SQL에서 psql의 `\set` 줄을 제외한 SQL을 대상 DB 확인 후 실행합니다. preflight는 재적용/부분 적용을 거절하며 add migration은 하나의 transaction입니다.

4. 탈퇴 worker에도 API와 일치하는 PROFILE_IMAGE_STORAGE_* 설정, 읽기/삭제 credential을 주입합니다. credential은 secret 저장소로 관리합니다. storage credential 내용을 복사해 회신하지 않습니다.
5. `ACCOUNT_DELETION_RETENTION_DAYS=30`, `PUSH_TERMINAL_RETENTION_DAYS=30`, 두 worker flag와 API flag가 의도대로 활성인지 확인합니다. config 예시/저장소 값은 실제 컨테이너 적용 증거를 대신하지 않습니다.
6. API와 두 worker를 같은 새 revision으로 배포합니다. Stage에서 실제 저장소·provider·Redis 장애·이미지 이전 URL을 검사한 뒤 Production에 적용합니다.
7. 아래 독립 모니터를 설치하고 실제 경보 메일 수신 및 복구 알림을 확인합니다. 별도 비공개 배포 저장소의 Compose/secret/health/CI는 그 담당자가 반영해야 합니다.

## 실패 조회와 수동 재처리

신규 HTTP 관리자 endpoint는 없습니다. DB 접근 권한을 가진 관리 실행 환경에서 다음 CLI를 사용합니다. API 컨테이너의 명령 경로도 동일합니다.

```bash
node dist/scripts/accountDeletionOps.js monitor
node dist/scripts/accountDeletionOps.js attention
node dist/scripts/accountDeletionOps.js inspect REQUEST_UUID
```

monitor는 성공 0, 조치 대상 2, DB/프로그램 오류 1로 종료합니다. request ID 없는 건수·최장 대기·heartbeat만 출력합니다. attention은 가장 오래된 100개 작업 ID/상태를 반환하며 운영자 내부에서만 사용합니다. heartbeat가 5분 이상 갱신되지 않으면 worker 중단/정체로 봅니다. 탈퇴/푸시 worker가 모두 대상입니다. 24시간 이상 미완료 푸시도 경보에 포함합니다.

원인을 먼저 해결한 뒤 root로 실행합니다. 웹 사용자·일반 앱 JWT로 호출할 수 없습니다. root 실행 권한·DB 자격정보·컨테이너 exec 권한은 운영자에게만 부여하고 임의 인자를 허용하는 공개 sudo wrapper는 만들지 않습니다.

```bash
node dist/scripts/accountDeletionOps.js retry REQUEST_UUID EXPECTED_USER_UUID FAILED 12 STORAGE_FIXED
```

허용 사유: `PROVIDER_FIXED`, `STORAGE_FIXED`, `REDIS_FIXED`, `WORKER_RECOVERED`. 상태/시도 횟수는 inspect 결과와 일치해야 합니다. 사용자 UUID는 운영 DB의 해당 요청에서 확인하여 본인확인 자료와 대조하며 외부 회신에는 포함하지 않습니다. 상태는 FAILED/RETRY/PROCESSING/CACHE_PURGE_PENDING만 허용합니다. 최근 5분 이내 claim은 거절하며 실행 중 사용자 lock과도 충돌하면 거절합니다.

요청 ID·소유자·상태·시도 횟수 일치, DB purge 이전에는 사용자 DELETION_PENDING을 검증합니다. 재처리는 요청 attempt budget만 재설정하고 최초 요청 시각, 완료된 provider/이미지/DB/Redis 단계는 보존합니다. 미완료 provider task만 재개하며 감사 테이블에 actor/reason/기존 상태·시도 횟수를 기록합니다. 연속 실행은 상태 충돌로 거절합니다. 성공 후 inspect의 COMPLETED 및 monitor 감소를 확인합니다.

- Apple 복호화/자격 오류: 원래 암호화 키·client/secret을 복구합니다. provider 실패를 성공으로 수동 변경하지 않습니다.
- Kakao 권한 오류: worker 전용 Admin Key와 앱 연결을 확인합니다.
- 저장소 오류: bucket/prefix·권한·versioning·보존 설정 확인 후 재시도합니다.
- DB purge 실패: FK/잠금 오류 원인을 해결합니다. 이미지 삭제는 이미 완료되었을 수 있습니다.
- Redis 오류: DB 삭제를 되돌리지 않고 Redis 복구 후 재시도합니다.
- 30일 내 해결 책임: 비공개 운영 설정에 지정한 담당자. 경보 수신 후 최초 확인/원인/조치/완료 증거를 운영 일지에 남깁니다.

## 독립 메일 감시 설치

선택 채널: 비공개 운영 설정에 지정한 운영 메일. 홈서버 systemd timer가 5분마다 **API/ops 컨테이너**에서 monitor를 실행합니다. 탈퇴 worker 안에서 감시를 실행하지 않습니다. 같은 장애는 1시간 간격, 정상 복구 시 1회 알립니다. DB/컨테이너 접근 실패도 경보입니다. 외부 메시지 발송은 이번 로컬 작업에서 수행하지 않았습니다.

- `_docs/privacy_ops/privacy-monitor.py`: 호스트 Python 3 + `/usr/bin/docker` + `/usr/sbin/sendmail` 사용. 민감 원문 stdout/stderr를 메일에 전달하지 않음.
- `privacy-monitor.env.example`: 감시할 활성 API 컨테이너명, 받는 주소, 인증된 발신 주소 설정. 실제 파일은 `/etc/shiftmate/privacy-monitor.env`, root:root 0600.
- `.service.example`, `.timer.example`: 설치 후 `.example` 확장자를 제거. 실제 Docker 실행 경로가 다르면 운영 설정에서 수정.
- SMTP 계정/앱 암호는 시스템 메일 전송기 또는 msmtp의 `/etc/msmtprc`(root:root 0600)에 보관합니다. 제공한 sandbox service에서는 root 홈 설정이나 파일 로그를 쓰는 MTA 대신 시스템 설정으로 직접 SMTP 전송하는 sendmail 호환 msmtp 구성을 권장하며, 기존 MTA를 쓸 경우 queue 경로 권한과 service 제한을 실제 시험합니다. 저장소나 이 env 예시에 넣지 않습니다. sendmail 전달 접수 성공과 수신함 도착은 별개이므로 실제 수신을 확인합니다.

```bash
sudo install -d -m 755 /usr/local/libexec /etc/shiftmate
sudo install -m 755 _docs/privacy_ops/privacy-monitor.py /usr/local/libexec/shiftmate-privacy-monitor.py
# 최초 설치에서만 예시 복사 후 실제 컨테이너/발신자 값을 편집
sudo install -m 600 _docs/privacy_ops/privacy-monitor.env.example /etc/shiftmate/privacy-monitor.env
sudoedit /etc/shiftmate/privacy-monitor.env
sudo install -m 644 _docs/privacy_ops/shiftmate-privacy-monitor.service.example /etc/systemd/system/shiftmate-privacy-monitor.service
sudo install -m 644 _docs/privacy_ops/shiftmate-privacy-monitor.timer.example /etc/systemd/system/shiftmate-privacy-monitor.timer
sudo systemctl daemon-reload
sudo systemctl start shiftmate-privacy-monitor.service
sudo systemctl enable --now shiftmate-privacy-monitor.timer
sudo systemctl status shiftmate-privacy-monitor.timer --no-pager
sudo journalctl -u shiftmate-privacy-monitor.service -n 20 --no-pager
```

Stage에서 worker를 정지해 stale/복구 수신을 시험합니다. 운영 DB의 requested_at을 시험용으로 변조하지 않습니다. Blue/Green 전환 때 감시 컨테이너명을 갱신해야 합니다. 호스트 전체/네트워크/메일 전송기 장애는 같은 호스트의 감시로 알릴 수 없으므로 외부 uptime 감시를 후속 구성합니다. 메일 실패는 systemd 실패 상태로 남고 다음 주기에 재시도됩니다.

## OPS 증거 수집: 비밀값 제외

각 실제 API/탈퇴/푸시 컨테이너에서:

```bash
node dist/scripts/privacyEvidence.js
```

명시한 flag·retention 값·endpoint/public URL의 hostname만 출력합니다. bucket credential, 전체 URL/path/query, 토큰, 환경변수 전체를 출력하지 않습니다. hostname만으로 국내 위치를 증명할 수 없으므로 실제 스토리지/CDN 자산 근거를 추가합니다.

운영 담당자 수집 항목:

| 영역 | 필요한 증거 | 상태 |
| --- | --- | --- |
| 실행 revision | 컨테이너 image digest, 배포 시각, worker health, 최근 privacy_cleanup_completed / privacy_push_cleanup_completed | 미수집 |
| 일반 로그 30일 | Nginx logrotate의 주기·rotate/maxage·실행 timer, Docker stdout rotation, journald 보관·용량, 오래된 실제 파일 시각 | 미수집 |
| 백업 30일 | 실제 저장 위치·암호화/접근, lifecycle/cron, 가장 오래된 backup, 복원 후 삭제 요청 재반영 절차·훈련 | 미수집 |
| Gmail 1년 | 문의 완료일 기록 위치, 월별 만료 검색·삭제 담당자, 휴지통 최종 파기, 예외 승인 기록 | 미수집 |
| 이미지 국내 저장 | 실제 endpoint/스토리지 서버 위치·CDN 경유 여부, 원본·버전 및 캐시 purge 결과 | 운영자 국내 자체 저장 진술, 기술 증거 미수집 |
| 외부 서비스 | 법인·국가·항목·목적·전달 시점/방법·기간·계약/근거·거부 절차 | 계약·계정 자료 필요 |

기간은 logrotate의 `rotate 30`만으로 증명되지 않습니다. 회전 주기·실행 성공·압축/별도 복사본까지 대조합니다. 로그 명령 출력에 사용자 IP/이름/토큰이 섞이지 않도록 원문을 공유하지 않습니다. 법정 별도 접근기록 정책은 일반 로그와 구분합니다.

## 롤백

1. 새 API 업로드·탈퇴 접수와 두 worker를 drain/중지합니다.
2. 코드만 복구할 때 additive schema와 진행 중 작업을 유지합니다. 구 탈퇴 worker를 다시 활성화하면 이미지 삭제를 건너뛰므로 삭제 기능은 비활성으로 두고 복구 후 새 worker로 재개합니다.
3. 스키마 제거가 꼭 필요한 경우에만 `rollback_privacy_deletion_controls.sql`을 실행합니다. 미완료/이미지 checkpoint/감사 이력이 있으면 거절합니다. 복구 맥락을 삭제하여 guard를 우회하지 않습니다.
4. 이미 삭제한 이미지/DB/기기/작업 데이터는 코드 롤백으로 복원되지 않습니다. 백업 복원 시 탈퇴 정보를 재반영해야 합니다.

## 재현 가능한 로컬 검증

PostgreSQL은 `test/fixtures/groupDebug.compose.yml`의 고정 격리 DB만 사용하며 schema 초기화를 명시적으로 승인하는 실행 명령입니다. 공유 개발 DB나 운영 DB에 적용하지 않습니다.

```bash
docker compose -f test/fixtures/groupDebug.compose.yml up -d --wait
python3 -m venv /tmp/shiftmate-privacy-test-venv
/tmp/shiftmate-privacy-test-venv/bin/pip install 'moto[server]==5.1.17'
# 별도 터미널에서 실행
/tmp/shiftmate-privacy-test-venv/bin/moto_server -H 127.0.0.1 -p 55900
# 저장소 터미널에서 실행
npm run test:privacy-integration
python3 test/privacyMonitor.test.py
```

Moto는 S3 프로토콜 에뮬레이터입니다. 실제 IAM 서명/권한·Object Lock·운영 CDN 검증을 대신하지 않습니다. 기존 `test:account-deletion-integration`도 신규 worker 경로 때문에 같은 S3 테스트 endpoint가 필요합니다. CI에도 격리 S3 서비스를 먼저 준비해야 합니다.

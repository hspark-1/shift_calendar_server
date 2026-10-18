# 개인정보 삭제·보관·가입 정책 작업 결과 전달서

작성일: 2026-10-18. 구현 기준 revision: `1c6ce8d`. 구현 커밋은 이 문서의 Git 이력으로 확인하며 PR은 생성하지 않았습니다.
수신 대상: 서버 운영·FE·공개 페이지 담당자. 외부 담당자에게 전송하지 않았습니다.

**BE-01~04 프로그램과 운영 도구를 작성하고 로컬 검증했습니다. 실제 홈서버 배포·설정 조회·메일 발송은 수행하지 않았으므로 운영 적용 완료가 아닙니다.** 공개 개인정보처리방침의 최종 문장은 운영 증거 확보 후 반영합니다.

## 이번 작업에서 확정된 정책

- 기존 승인: 탈퇴 7일 이내 목표, 일반 로그 최대 30일, 백업 최대 30일, 문의 완료 후 1년, 만 14세 미만 미허용. 자체 저장은 국내 홈서버라는 운영자 진술.
- 추가 승인: 연결 해제된 기기 기록 30일 보관 후 정리.
- 추가 승인: 완료 탈퇴·종료 푸시 기록 30일, 미완료 탈퇴 7일 초과 경보 및 30일 이내 운영자 최종 처리 의무. 복구 중 자격정보를 자동 파기하지 않음.
- 경보 채널 선택 위임에 따라 운영 이메일을 수신자로 선택(실제 수신 설정은 비공개 main에서 관리). SMTP/발신자 설정·실제 수신은 운영 적용 필요.

## BE-01 / 프로필 이미지 삭제

- **상태:** 구현 완료·로컬 검증, 운영 적용 대기.
- **변경 및 영향:** 접수 시 관리 bucket/사용자 namespace/config fingerprint를 저장. worker가 provider 해제 후 이미지 객체·이전 버전·delete marker를 지우고 빈 목록을 확인한 다음 DB/Redis 정리. 업로드와 삭제가 같은 사용자 lock을 공유. 이미지 실패는 완료 처리하지 않음.
- **실제 적용값:** 로컬 테스트는 `test/profiles/{uuid}/`. 운영 bucket/endpoint/IAM/versioning은 미확인. API와 worker 설정 일치가 필수.
- **테스트 증거:** 격리 PostgreSQL 16 + Moto S3 HTTP에서 관리 이미지·이전 업로드, 무이미지/외부 URL, 없는 객체 반복 삭제, 다른 사용자 보호, 저장소 503 후 재개, DB 삭제 실패 후 별도 Node 프로세스 재시작, DB 삭제 후 Redis 오류, 버전·delete marker 제거, 원본 GET 200→404 확인.
- **남는 개인정보·예외:** 외부 소셜 사진, namespace 도입 이전 객체/이관 전 bucket, 이미 완료되어 user_id를 잃은 과거 작업, CDN·프록시·클라이언트·백업 사본은 별도 확인 대상. 저장소 설정 drift를 자동 우회하지 않음. 실제 IAM/Object Lock은 에뮬레이터로 검증하지 못함.
- **정책 반영 문장(운영 검증 후):** “탈퇴 시 운영자가 관리하는 프로필 이미지 원본과 저장소 버전을 삭제합니다. 외부 로그인 제공자가 관리하는 사진과 이미 전달된 사본의 처리는 해당 제공자 및 저장 위치의 정책을 따릅니다.”
- **롤백·호환성:** additive migration 선행, 구 탈퇴 worker 중지 필수. 구버전/신버전 혼합 실행 금지. 진행 중 요청은 보존하며 실제 삭제 데이터는 코드 롤백으로 복구 불가.
- **다음 담당자:** 서버 운영자 — 실제 저장소 권한·기존 namespace·이전 URL/CDN purge·백업 검증.

## BE-02 / 감시·7일 목표·수동 재처리

- **상태:** 구현 완료·로컬 검증, systemd/메일 설치 대기.
- **변경 및 영향:** 실패·24시간 대기·7일/30일 초과 집계, 두 worker heartbeat 5분 지연 탐지, 장기 미처리 푸시 탐지. root 전용 CLI 재처리는 요청·소유자·상태·시도 횟수·활성 claim을 검증하고 감사 기록을 남김. 완료된 단계·최초 요청일 유지.
- **실제 적용값:** 처리 목표 7일, 장기 대기 24시간, 최종 조치 기한 30일, 외부 timer 5분, 동일 장애 메일 1시간 간격 및 복구 시 1회. 아직 운영 timer/메일 적용 증거 없음.
- **테스트 증거:** 일시/영구 provider 오류 후 DB 보존, 재시도 12회 한도, 소유자 오입력·중복 재처리 거절, 감사 기록, worker stale/복구, 7일 초과 조회, Redis 장애, lock 중복 실행 차단. 외부 provider는 오류 주입이며 실제 Apple/Kakao revoke는 Stage 필요.
- **남는 개인정보·예외:** FAILED/진행 중 작업은 user_id·진행 맥락과 provider 해제 자격정보 보존. 30일 내 운영자 최종 조치 필요. 감시와 메일이 같은 홈서버에 있어 호스트 전체 장애는 외부 uptime 감시 필요.
- **정책 반영 문장:** “탈퇴 요청 접수 후 통상 7일 이내 처리를 목표로 합니다. 오류나 외부 인증 해제 지연 시 운영자가 확인·조치하며 처리 상태는 지원 이메일로 문의할 수 있습니다.”
- **롤백·호환성:** 신규 공개 관리자 API 없음. CLI·호스트 권한은 운영자 전용. 복구 맥락 삭제나 provider 실패 무시는 허용하지 않음.
- **다음 담당자:** 서버 운영자 — SMTP 전송기/발신자 설정, timer 설치, 실제 경보 수신·복구 훈련.

## BE-03 / 연결 해제 기기

- **상태:** 30일 정책 승인, 구현 완료·로컬 검증, 운영 적용 대기.
- **변경 및 영향:** user_id/provider_target=null, 비활성·권한 해제, disabled_at/updated_at 모두 30일 경과한 행만 삭제. 진행 중 푸시 참조는 보류. row 조건 재검사로 재연결 사용자 보호.
- **실제 적용값:** 30일 경과 대상, 탈퇴 worker 시작 시 및 이후 일 1회 정리. 장애가 없으면 다음 정리 주기에 반영. 별도 env로 임의 기간 확장 불가.
- **테스트 증거:** 30일 경계·29일 보호·활성·다른 사용자 재연결·동시 row update·실제 upsert·진행 중 delivery 보호·종료 후 정리.
- **남는 개인정보:** 해제 후 정리 전 installation_id, platform, app_version, 상태·시각 등. user_id와 raw push token은 해제 시 null. 실제 정리 후 해당 행 및 관련 delivery 참조는 사라짐.
- **정책 반영 문장(운영 적용 후):** “로그아웃·탈퇴 시 기기의 사용자 연결과 푸시 토큰을 제거합니다. 연결 해제된 설치 기록은 재연결 대응을 위해 30일간 보관한 뒤 정기 정리하며, 진행 중 처리에 필요한 기록은 해당 처리 종료 후 정리합니다.”
- **롤백:** cleanup 호출 중지로 추가 삭제 중단. 이미 지운 설치 행은 되살리지 않고 재로그인 시 신규 등록. DB 변경은 성능용 partial index만 추가.

## BE-04 / 작업 기록

- **상태:** 정책 승인·검증 보완 완료, 운영 적용값/cleanup 증거 대기.
- **변경 및 영향:** `ACCOUNT_DELETION_RETENTION_DAYS`, `PUSH_TERMINAL_RETENTION_DAYS`는 30만 허용. 완료 탈퇴 정리 시 provider task/운영 재처리 감사 기록 CASCADE. 종료 푸시 정리 시 delivery CASCADE. pending/processing/retry는 정리하지 않음. 실행 성공 시 민감정보 없는 cleanup 로그 제공.
- **실제 적용값:** 저장소 `.env.example` 및 코드 기본값 30. 홈서버의 실제 값이라고 회신할 수 없음. `privacyEvidence.js`를 각 실제 컨테이너에서 실행해 확인.
- **테스트 증거:** 완료 31일 정리와 감사 연쇄, pending 보호, 종료 FAILED 푸시와 delivery 연쇄, 정리 재실행.
- **남는 개인정보:** 실패 탈퇴의 user_id·provider 자격정보, 별도 인앱 notifications, 완료 이전 push title/body/data 및 수신자, 기기 행(별도 BE-03), Redis tombstone(TTL), 운영 로그/백업/문의는 각 정책에 따름. push job 정리가 인앱 notification 자체를 지우는 것은 아님.
- **정책 반영 문장(운영 확인 후):** “완료된 탈퇴 작업 및 종료된 알림 전송 작업 기록은 완료일부터 30일간 보관한 뒤 정기 정리합니다. 미완료 작업은 복구를 위해 보존하며 운영자가 처리 상태를 확인하여 종결합니다.”
- **예외/책임:** 미완료 작업을 완료 행처럼 자동 파기하지 않음. 30일 내 최종 조치 의무는 운영 프로세스이며 코드가 외부 오류를 강제 해결한다는 뜻이 아님.

## BE-05 / 연령·정책 계약

- **상태:** 합의안 작성 완료, FE/운영 합의 대기. 신규 가입 필드·migration·강제 차단 미구현.
- **결과:** 최소 수집 자기 확인, 정책 버전·서버 확인 시각, 실제 동의 항목 분리, 기존 사용자 미확인 유지, 구버전/재가입/프로필 재개 및 호환 배포안을 작성.
- **다음 담당자:** FE·운영 책임자 최종 계약 승인 후 BE 구현. [합의안](PRIVACY_FE_CONTRACT_PROPOSAL.md).

## Google/Naver 및 OPS

Flutter 소스에서 Google disconnect → Naver disconnect → 서버 DELETE 순서를 확인했습니다. Naver 토큰이 없으면 해제를 건너뛰며 SDK 오류가 서버 접수를 막을 수 있습니다. 서버 신규 revoke는 추가하지 않았고 세션 만료·해제 성공 후 서버 실패·앱 접근 불가 수동 신규 탈퇴의 처리 합의를 문서에 남겼습니다. root CLI는 기존 요청 재처리만 지원합니다.

로그 30일, 백업 30일, 문의 완료 후 1년, 국내 저장·외부 서비스 계약 자료는 **운영 증거 미수집**입니다. 실제 홈서버 접속 정보가 제공되지 않아 컨테이너 revision, 전체 운영 설정, 예약 작업을 읽거나 변경하지 않았습니다. 수집 허용 목록과 명령은 [운영 절차](PRIVACY_OPERATIONS_RUNBOOK.md)에 있습니다.

## 검증 및 전달 상태

- TypeScript build 통과.
- 개인정보 통합 테스트 13개 통과: 실제 격리 PostgreSQL + Moto 5.1.17 HTTP 저장소. 운영 저장소 테스트 아님.
- 기존 그룹 소유권 승계·탈퇴 PostgreSQL 통합 1개 통과. 탈퇴·환경 검증 회귀 10개 통과, 호스트 감시 Python 테스트 3개 통과.
- migration preflight → apply → postflight → 빈 데이터 rollback → 재적용을 격리 DB에서 실행.
- 전체 `npm test`: 91개 중 64 pass / 18 fail / 9 skip. 변경 전 `1c6ce8d`를 임시 디렉터리에 추출하여 실행한 결과도 같은 실패 18개(90개 중 62 pass / 18 fail / 10 skip)였으며 신규 실패 없음. 기존 배포 Compose/launcher/workflow·프로필 migration 부재, Apple Portal 가이드 정적 기준이 원인입니다. 별도 배포 저장소의 파일을 이 작업에서 임의 복원하지 않았습니다.
- git diff --check 통과. 저장소에 lint script가 없어 TypeScript strict build 및 Python 구문/실행 테스트로 검사했습니다.
- 공개 HTML·운영 DB·Nginx·메일 수신함은 변경하지 않았습니다. PR·배포·담당자 전송 미수행.

## 파일 역할·의존성·사용 예

| 파일 | 역할·의존성·사용 예 |
| --- | --- |
| `src/services/accountDeletionImageService.ts` | AWS SDK S3 목록/버전/삭제, 신뢰한 scope 검증. worker에서 `purgeAccountImages(user_id, scope)` |
| `src/utils/accountDataLock.ts` | PostgreSQL session advisory lock, Sequelize pool. 업로드/worker/ops가 동일 사용자 직렬화 |
| `src/services/accountDeletionOperationsService.ts` | PostgreSQL 집계·조회·권한 있는 재처리 서비스. CLI에서 호출 |
| `src/scripts/accountDeletionOps.ts` | `monitor`, `attention`, `inspect`, root 전용 `retry`. 실행 예는 운영 절차 |
| `src/scripts/privacyEvidence.ts` | secret 제외 환경 증거 출력. 실제 컨테이너에서 `node dist/scripts/privacyEvidence.js` |
| `src/config/privacy.ts` | 승인된 30일 retention drift 거부. 두 worker/cleanup에서 사용 |
| `migrations/privacy_deletion_preflight.sql` | 기존 탈퇴 schema·중복 적용 검사. apply 전 실행 |
| `migrations/add_privacy_deletion_controls.sql` | 이미지 checkpoint·heartbeat·감사 테이블·기기 정리 index 추가. worker 정지 후 적용 |
| `migrations/privacy_deletion_postflight.sql` | 신규 컬럼/테이블/제약 확인. 적용 후 실행 |
| `migrations/rollback_privacy_deletion_controls.sql` | 복구/감사 상태가 없는 경우만 schema rollback. 일반 rollback은 schema 유지 |
| `_docs/privacy_ops/*` | Python 호스트 감시, systemd service/timer/env 예시. 메일 전송기·운영 권한 필요 |
| `test/privacyDeletionIntegration.test.cjs` | 고정 격리 DB·55900 S3 테스트 서비스 필요. `npm run test:privacy-integration` |
| `test/privacyMonitor.test.py` | 경보 반복/복구·컨테이너 장애·민감 출력 배제. `python3 test/privacyMonitor.test.py` |
| `PRIVACY_OPERATIONS_RUNBOOK.md` | 적용·관측·재처리·OPS 증거·롤백 정본 |
| `PRIVACY_FE_CONTRACT_PROPOSAL.md` | FE 합의 전 설계와 SDK 경계 전달 |

외부 전달 시 이 보고서를 기준으로 운영 적용 시각·환경·image digest·실제 적용값·Stage E2E·메일 수신·cleanup 로그를 추가한 후, 정책 MD/HTML·앱·App Privacy를 동기화합니다.

# 작업 일지

## 2026-08-01

### [DONE] 그룹 기능 원격 재현성 및 커밋 전 검증 정리

- **목적**: 그룹 P0/P1 서버 구현, PostgreSQL 16 검증 환경, OpenAPI와 프론트 연동 문서를 하나의 재현 가능한 커밋으로 정리해 `origin/develop` 반영을 준비
- **변경**:
  - staged/unstaged/untracked 변경 범위와 비밀값·로컬 산출물 포함 여부 감사
  - 홈서버 Docker PostgreSQL 16 환경에 맞게 공유 환경변수 예시를 `DB_SSL=false`로 교정하고 백업 식별자는 실제 `pg_dump`/pgAdmin 백업 파일명을 사용하도록 명시
  - gitignore 대상인 migration 파일이 원격 체크아웃에 전부 없으면 정적 테스트를 명시적으로 skip하고 일부만 있으면 실패하도록 기준선 보정
  - 격리된 PostgreSQL 16·Redis 컨테이너에서 그룹 및 기존 캐시 통합 테스트를 실행하고 종료 후 검증 컨테이너 제거
- **영향범위**: 그룹 기능 전체 변경의 Git 이력과 커밋 전 검증. 실제 Stage/Center DB migration 또는 API 배포는 수행하지 않음
- **파일**: 이번 그룹 기능 관련 tracked 변경 전체. `migrations/`, `AGENTS.md`, draw.io와 `.vscode`는 기존 gitignore 정책에 따라 로컬 산출물로 유지
- **테스트**:
  - `npm test`: TypeScript build 성공, 13건 성공, 인프라/별도 저장소 3건 의도된 skip
  - `npm run test:group-integration`: PostgreSQL 16에서 8건 성공
  - `npm run test:integration`: PostgreSQL 16·Redis 7.4에서 기존 캐시 통합 23건 성공
  - migration 파일이 없는 원격 체크아웃 모사: 그룹 단위 테스트 7건 성공, migration 정적 테스트 2건 의도된 skip
  - `npm audit --audit-level=high`: high 이상 취약점 0건
- **롤백**: 커밋 후 문제가 발견되면 새 revert 커밋으로 되돌린다. 실제 DB는 이번 작업에서 변경하지 않음
- **다음**: 커밋과 `origin/develop` push 후 Stage DB 백업·migration·P0 이미지 배포를 별도 승인 절차로 수행

### [DONE] 프론트팀용 그룹 API 연동 가이드 작성

- **목적**: Flutter 프론트팀이 그룹 목록·상세·캘린더·초대·관리 화면을 실제 서버 API에 연결할 수 있도록 배포 단계, 인증, 요청/응답 DTO, 오류 처리와 화면별 호출 흐름을 하나의 전달 문서로 제공
- **변경**:
  - 실제 `groupRoutes`, `groupController`, `groupService`, 공통 타입과 OpenAPI를 기준으로 P0/P1 endpoint 계약 정리
  - Flutter 전용 DTO/상태 모델, `owner_user_id`·`calendar_access` 보존 규칙, 페이지네이션·날짜·색상·nullable 처리 기준 추가
  - 초대 수락/거절과 알림 카드의 즉시 갱신, 역할별 UI 노출 및 오류 코드별 UX 처리 기준 추가
  - 화면별 호출·갱신 흐름, Dio datasource 경계, 더미 제거 전 Stage 인수 테스트 체크리스트 추가
  - 서버 운영 가이드와 PROJECT_CONTEXT에 프론트 가이드 역할·의존성·사용 예를 연결하고 기존 Swagger 미구현 설명을 그룹 전용 OpenAPI 구현 상태로 교정
- **영향범위**: 문서만 변경하며 서버 API·DB 스키마·배포 동작에는 영향 없음
- **파일**: `_docs/GROUP_FRONTEND_API_GUIDE.md`, `_docs/GROUP_API_GUIDE.md`, `_docs/PROJECT_CONTEXT.md`, `_docs/WORKLOG.md`
- **문서 checksum (SHA-256)**: `_docs/GROUP_FRONTEND_API_GUIDE.md` `59ad882c09eaca6ea8b4f0dc69696afbf71a6edf73c02a8f695d2813e4bbef07`
- **테스트**:
  - `npm test`: TypeScript build 성공, 13건 성공, 인프라/별도 저장소 3건 의도된 skip
  - OpenAPI path 10개와 그룹 도메인 오류 코드 19개가 가이드에 모두 존재함을 자동 대조
  - JSON 예제 19개 파싱, Markdown fence 84개 균형, 참조 파일 8개 존재 확인
  - `git diff --check` 성공
- **롤백**: 신규 프론트 가이드와 기존 문서의 연결 항목 및 본 작업 일지 항목 제거
- **다음**: Stage Base URL·배포된 phase를 서버팀과 확정한 뒤 Flutter 더미 데이터를 API datasource로 교체

## 2026-07-29

### [DONE] pgAdmin용 Stage 그룹 단일 migration 쿼리 준비

- **목적**: psql meta-command를 사용할 수 없는 pgAdmin Query Tool에서 기존 Stage DB에 그룹 migration을 단일 SQL로 안전하게 적용
- **변경**:
  - `BEGIN/COMMIT`, transaction-local timeout/search path, 실행 context, preflight, public schema DDL, strict postflight를 한 파일에 결합
  - 파일 상단에서 실제 Stage DB 이름, 복원 가능한 백업 식별자, `APPLY_GROUP_FEATURE_TO_STAGE` 확인 문자열을 요구
  - PostgreSQL 16·primary/write 가능 상태·권한·기반 relation/컬럼·부분 적용·index 충돌을 DDL 전에 확인
  - transaction advisory lock 뒤 그룹 테이블 3개와 FK/CHECK/partial unique/index/COMMENT 생성
  - commit 전에 27개 컬럼, 20개 validated 제약, 11개 valid/ready index, partial unique 속성, COMMENT, 초기 데이터 0건 강제 판정
  - pgAdmin 실행 절차를 그룹 API/배포 가이드와 PROJECT_CONTEXT에 반영하고 정적 계약 테스트 추가
- **영향범위**: pgAdmin migration 산출물, 그룹 배포 문서와 정적 테스트. 실제 Stage DB에는 연결하거나 적용하지 않음.
- **파일**:
  - `migrations/pgadmin_stage_add_group_feature.sql`
  - `test/groupService.test.cjs`
  - `_docs/GROUP_API_GUIDE.md`, `_docs/DEPLOYMENT_GUIDE.md`, `_docs/PROJECT_CONTEXT.md`, `_docs/WORKLOG.md`
- **SQL checksum (SHA-256)**: `812866a06470a3c3d0d686836c874d87e8f80d229977dc726d30d15f39e1a936`
- **실제 PostgreSQL 16 검증**:
  - placeholder 원본 실행은 preflight에서 실패하고 연결 종료 후 영구 그룹 테이블 0개 확인
  - 세 설정값 입력 후 단일 실행에서 27개 컬럼, 20개 제약, 11개 index, 데이터 0건을 확인하고 commit 성공
  - 같은 SQL 재실행은 기존 그룹 relation을 감지해 DDL 전에 실패
  - 검증용 tmpfs PostgreSQL과 network 제거
- **테스트**: `npm test`, pgAdmin SQL 정적 계약, PostgreSQL 16 실제 apply/postflight/reapply 차단, `git diff --check`
- **롤백**: pgAdmin 전용 SQL과 문서·테스트 항목을 제거한다. 운영 장애 시에는 이전 API 이미지를 먼저 복원하고 그룹 테이블은 유지한다.
- **다음**: 실제 Stage DB 이름과 백업 식별자를 입력한 파일을 pgAdmin에서 전체 Execute(F5)하고 Data Output을 증거로 저장

### [DONE] 기존 Stage DB 그룹 migration 실행 쿼리 준비

- **목적**: 기존 Stage PostgreSQL에 그룹 스키마를 안전하게 선적용할 수 있도록 대상 DB 확인, 의존 객체·부분 적용 감사, 실제 apply, 강제 postflight 검증을 분리한 실행 쿼리를 마련
- **변경**:
  - `stage_group_feature_preflight.sql`: 실제 DB 이름, PostgreSQL 16, primary/write 가능 상태, schema/table 권한, `pgcrypto`, 그룹 API 기반 relation·컬럼, 부분 적용 relation과 index 이름 충돌을 read-only 감사
  - `stage_apply_group_feature.sql`: 명시적 승인, 복원 가능한 백업 식별자, 승인된 DDL checksum, advisory lock, 5초 DDL lock timeout과 `search_path=public,pg_catalog`을 강제하고 기존 `add_group_feature.sql`을 정본으로 호출
  - `stage_group_feature_postflight.sql`: 27개 컬럼, 20개 validated 제약, 11개 valid/ready index, partial/unique 속성, 필수 COMMENT와 API 배포 전 초기 데이터 0건을 예외 기반으로 판정
  - PostgreSQL 16 `psql`이 `\quit 3` 인자를 무시하는 사실을 실제 실행에서 확인해 신규 guard와 기존 rollback guard를 `RAISE EXCEPTION + ON_ERROR_STOP`으로 변경
  - 그룹 API/배포 가이드와 PROJECT_CONTEXT에 Stage 실행 명령, 실패 조건, 신규 파일 역할·의존성·사용 예 반영
  - Stage wrapper 정적 계약 테스트 추가
- **영향범위**: migration 실행 보조 SQL, rollback 승인 실패의 종료 코드, 그룹 배포 문서와 정적 테스트. 실제 Stage DB에는 연결하거나 적용하지 않음.
- **파일**:
  - `migrations/stage_group_feature_preflight.sql`
  - `migrations/stage_apply_group_feature.sql`
  - `migrations/stage_group_feature_postflight.sql`
  - `migrations/rollback_group_feature.sql`
  - `test/groupService.test.cjs`
  - `_docs/GROUP_API_GUIDE.md`, `_docs/DEPLOYMENT_GUIDE.md`, `_docs/PROJECT_CONTEXT.md`, `_docs/WORKLOG.md`
- **SQL checksum (SHA-256)**:
  - `add_group_feature.sql`: `0f5e86cbd607257d23a91581f8abc20a77390ff7273c9a3d96df4a4f7046f92a`
  - `rollback_group_feature.sql`: `42887d46435d8ff00b5f82af202712c8b41c9f9d8cbd1f1a741a5fc52fb5043a`
  - `stage_group_feature_preflight.sql`: `0e27ecd6e753042d1185f3dfd4aa6a91053095057fbc13513d15ceff9608df20`
  - `stage_apply_group_feature.sql`: `f94dfab277d4e9a392176a4741fcd2cac7c871269d24da0bbd783d9a2969aa74`
  - `stage_group_feature_postflight.sql`: `762bea586ac187ae5b6eb1b2a36783c0ee6a719f5dd11192fdd0c7d784fe7778`
- **실제 PostgreSQL 16 검증**:
  - 승인 누락, 잘못된 `expected_database`, 기존 그룹 테이블 재적용을 각각 DDL 전에 종료 코드 3으로 차단
  - read-only preflight 단독 성공 및 정상 wrapper의 preflight → apply → strict postflight 성공
  - 초기 `search_path=pg_catalog` 연결에서도 public에 테이블 생성, 27개 컬럼·20개 제약·11개 index·COMMENT·데이터 0건 확인
  - rollback 승인 누락이 종료 코드 3을 반환하고 기존 그룹 테이블을 유지함을 확인
  - 검증용 tmpfs PostgreSQL 컨테이너와 network 제거
- **테스트**:
  - `npm test`: 13건 성공, 인프라/별도 저장소 3건 의도된 skip
  - `npm run test:group-integration`: migration apply/rollback/reapply 포함 8건 성공
  - `git diff --check` 성공
- **롤백**: 신규 Stage SQL 3개와 문서·정적 테스트를 제거하고 rollback guard를 이전 형태로 복원한다. 운영 장애 시에는 SQL rollback이 아니라 이전 API 이미지를 먼저 복원하고 그룹 테이블은 유지한다.
- **다음**: Stage 백업 식별자와 실제 DB 이름을 확인한 뒤 read-only preflight 결과를 먼저 검토하고, 별도 승인 후 wrapper를 1회 수동 실행

### [DONE] 그룹 실제 동작 검증 체크리스트 및 디버깅 준비

- **목적**: 그룹 기능을 문서·정적 테스트 수준이 아니라 실제 PostgreSQL/Express 런타임과 디버거에서 재현·검증할 수 있는 기준과 안전한 실행 환경을 마련
- **변경**:
  - migration, P0/P1 API, transaction·잠금 경쟁, 공개 ACL·날짜 경계·3-query aggregate, 알림·OpenAPI·로그·롤백을 Local/Stage 증거로 판정하는 실제 동작 체크리스트 추가
  - PostgreSQL 16을 `127.0.0.1:55432`와 tmpfs로만 실행하는 그룹 디버그 Compose와 up/down npm script 추가
  - 그룹 integration은 명시적 reset 승인, 고정 host·port·DB·user가 모두 일치할 때만 파괴적 fixture에 진입하도록 보호
  - fixture setup 실패 시 생성되지 않은 HTTP server를 닫아 2차 오류가 발생하지 않도록 teardown 보정
  - VS Code/DebugMCP에 build source map 기반 `Debug group integration (isolated PostgreSQL 16)` 구성과 D1~D5 line-content/locals/watch 시나리오 추가
  - PROJECT_CONTEXT와 그룹 API 가이드에 신규 파일 역할·의존성·실행·정리 순서 반영
- **영향범위**: 그룹 검증 문서, 로컬 디버그 PostgreSQL, 그룹 integration 실행 안전장치. 그룹 공개 API와 운영 DB 스키마 동작은 변경하지 않음.
- **파일**:
  - `_docs/GROUP_RUNTIME_VERIFICATION_CHECKLIST.md`
  - `test/fixtures/groupDebug.compose.yml`
  - `test/groupIntegration.test.cjs`
  - `package.json`
  - `.vscode/launch.json`(gitignore 대상 로컬 디버그 설정)
  - `_docs/PROJECT_CONTEXT.md`, `_docs/GROUP_API_GUIDE.md`, `_docs/WORKLOG.md`
- **검증 산출물 checksum (SHA-256)**:
  - `_docs/GROUP_RUNTIME_VERIFICATION_CHECKLIST.md`: `60397230757b83eaf7c0fd0ecef81c87c8ba4a57078e5910ac7483c910aea5f0`
  - `test/fixtures/groupDebug.compose.yml`: `43c0e68755e6562d706868530b6be1223aeaa307e7393510083c69d2d903586a`
  - `.vscode/launch.json`: `8a684c381cde58a8d3ec902ae8e23ec98bb2d4dd00d63e16d206a07d83af6ccc`
- **실제 동작 확인**:
  - reset 승인 누락과 DB 이름 불일치에서 각각 DB module import·연결 전에 명시적 실패 확인
  - DB 식별값 `shift_calendar_group_debug/group_debug`, PostgreSQL `16.14`, publish `127.0.0.1:55432` 확인
  - DebugMCP가 `src/services/groupService.ts:739`에 source-map breakpoint로 도달해 `Atomic Failure`와 `Ward Team` 입력의 actor, creator/final timezone, invitee locals 확인
  - 중단점 2개 제거, 디버그 세션 정상 종료, 종료 후 통합 테스트 재통과 및 tmpfs 컨테이너·전용 network 제거
- **테스트**:
  - `npm test`: 12건 성공, 인프라/별도 저장소 3건 의도된 skip
  - `npm run test:group-integration`: 디버깅 전·후 각 8건 전부 성공
  - launch JSON parse, Compose config, TypeScript build, `git diff --check` 성공
- **롤백**: 신규 체크리스트·Compose 파일·npm script·launch 구성을 제거하고 integration guard/teardown을 이전 상태로 복원한다. DB는 `npm run debug:group-db:down`으로 제거한다.
- **다음**: 체크리스트 D2~D5에 따라 초대 수락 lock 경쟁, ACL query 결과, 소유권 이전, 그룹 삭제 transaction을 DebugMCP로 각각 추적하고 Stage P0 실제 요청·20명/100일 측정 증거를 기록

### [DONE] 그룹 기능 DB Migration 및 P0/P1 서버 API 구현

- **목적**: Flutter 그룹 목록·상세·캘린더 화면의 더미 데이터를 제거하고, 기존 친구 공개 규칙을 재사용하는 그룹 관리·초대·캘린더 API를 단계 배포 가능한 형태로 제공
- **변경**:
  - `groups`, `group_members`, `group_invitations` expand migration에 부분 적용 preflight, FK/CHECK/partial unique/index/COMMENT와 postflight 감사를 추가하고 명시적 데이터 폐기 승인 rollback SQL 작성
  - Group/GroupMember/GroupInvitation 모델, 공통 DTO·캘린더 직렬화 유틸, 기존 Controller–Service–Model 구조의 P0 7개 및 P1 관리 endpoint 구현
  - 그룹 row 선잠금, 동시 초대 수락, 20명 제한, 만료·재초대, soft-delete 재가입, 역할·소유권 이전·삭제 transaction invariant 적용
  - friendship·소유자→조회자 `can_view`와 기존 visibility view를 재사용하고 멤버/근무/이벤트 최대 3-query aggregate 구현
  - 기존 notifications의 그룹 초대·수락·거절·취소·만료 terminal 상태, 그룹 전용 개인정보 비기록 구조화 로그 추가
  - `API_DOCS_ENABLED=true`에서 그룹 OpenAPI 3.0.3 JSON과 Swagger UI를 노출하고 high 취약점이 생기지 않도록 dependency 잠금 갱신
  - 배포 파일이 별도 저장소로 모두 이동한 경우 정적 테스트를 명시적으로 skip하고 일부만 존재하면 실패하도록 기준선 보정
  - ADR-0021, PROJECT_CONTEXT, 그룹 API/배포 가이드, 최종 DDL, AGENTS DDL, schema/visibility draw.io 동기화
- **영향범위**: PostgreSQL 스키마, Express 그룹 API, 알림, 환경변수, API 문서, 테스트·운영 문서
- **파일**:
  - DB/모델: `migrations/add_group_feature.sql`, `migrations/rollback_group_feature.sql`, `migrations/final_schema.sql`, `src/models/Group.ts`, `src/models/GroupMember.ts`, `src/models/GroupInvitation.ts`
  - API: `src/types/group.ts`, `src/utils/calendarSerialization.ts`, `src/services/groupService.ts`, `src/controllers/groupController.ts`, `src/routes/groupRoutes.ts`, `src/openapi.ts`, `src/openapi/groupOpenApi.json`
  - 테스트: `test/groupService.test.cjs`, `test/groupIntegration.test.cjs`, `test/fixtures/groupIntegrationBaseSchema.sql`, `test/deploymentCacheRollout.test.cjs`
  - 문서/설정: `.env.example`, `_docs/GROUP_API_GUIDE.md`, `_docs/PROJECT_CONTEXT.md`, `_docs/DECISIONS.md`, `_docs/DEPLOYMENT_GUIDE.md`, `AGENTS.md`, `schema.drawio`, `visibility_flow.drawio`
- **운영 로컬 산출물 checksum (SHA-256)**:
  - `migrations/add_group_feature.sql`: `0f5e86cbd607257d23a91581f8abc20a77390ff7273c9a3d96df4a4f7046f92a`
  - `migrations/rollback_group_feature.sql`: `42887d46435d8ff00b5f82af202712c8b41c9f9d8cbd1f1a741a5fc52fb5043a`
  - `migrations/final_schema.sql`: `589ab0e967340aec161f2cecd0007bcffd50b9d6912b2d18d0c4565256e9a083`
  - `AGENTS.md`: `bdb3e02b572ffaaf6920d1888af0808435610204937cf488ae55e2fd41677fd3`
  - `schema.drawio`: `968b25cc7f3f53cde6b8dbbc296f8bb917333a5f45b884baa061a6c4cc520afb`
  - `visibility_flow.drawio`: `4ae55697affc7f87dfe5397bf19bffcf90417e3c78f09429a739f9b34e301561`
- **적용 대상/결과**: 실제 Stage/Center DB에는 적용하지 않음. 폐기 가능한 로컬 PostgreSQL 16 컨테이너에 expand apply → 기존 객체 preflight 중단 → rollback → reapply와 `final_schema.sql` 전체 적용을 확인한 뒤 컨테이너·임시 데이터를 삭제
- **테스트**:
  - `npm test`: build 성공, 그룹/캐시 단위 12건 성공, 격리 인프라 진입점 2건과 별도 배포 저장소 정적 테스트 1건은 의도대로 skip
  - PostgreSQL 16 `npm run test:group-integration`: migration, 원자성, partial unique, 동시 수락, 제한·만료, P1 관리, OpenAPI/인증/권한/개인정보 계약, 20명·100일·timezone 경계·soft-delete·3-query 공개 회귀 8건 성공
  - PostgreSQL 16/Redis 7.4 `npm run test:integration`: 기존 월 캐시·Outbox 회귀 23건 성공
  - `npm audit --audit-level=high`: 취약점 0건
  - OpenAPI JSON parse, draw.io 2개 XML parse, `git diff --check` 성공
- **롤백**: 이전 API 이미지를 먼저 복원하고 신규 그룹 테이블은 유지한다. 그룹 데이터 폐기가 별도 승인된 경우에만 백업·명시적 확인 후 rollback SQL을 실행
- **다음**: Stage DB 백업 → checksum 대조 → migration preflight/apply/postflight → P0 이미지 배포와 Swagger·20명/100일 측정 → Flutter 계약 확인 → P1/Center 배포

## 2026-07-23

### [DONE] 공유 Redis 월별 근무표 캐시 전략 FigJam 기록

- **목적**: 본인·친구 캘린더 조회가 동일한 사용자·월 snapshot을 사용하는 흐름과 쓰기·Outbox 무효화 정합성을 한눈에 확인할 수 있도록 시각화
- **변경**:
  - `근무표 캐시 조회 전략`: 인증·날짜 validation, 친구 권한 DB 검사, 월 분할, Redis hit/miss·stampede lock·DB fallback, revision fence, 개인 일정 비캐시, ETag 범위 시각화
  - `근무표 캐시 쓰기 및 무효화 전략`: 근무표·근무 타입 변경 월 결정, 원본·revision·Outbox 단일 transaction, commit 후 즉시 무효화, worker claim·재시도·회수·정리 시각화
  - `PROJECT_CONTEXT.md`에 [ShiftMate 근무표 캐시 전략 FigJam](https://www.figma.com/board/7U2SsaPGC6I670W7DQnEP1) 정본 링크 추가
- **영향범위**: Figma 외부 문서와 프로젝트 문서 링크만 변경하며 API·DB·Redis 동작에는 영향 없음
- **파일**: Figma FigJam, `_docs/PROJECT_CONTEXT.md`, `_docs/WORKLOG.md`
- **테스트**: Figma API에서 첫 다이어그램 생성과 같은 파일의 두 번째 다이어그램 추가 성공, 흐름을 현재 코드·ADR-0020·프로젝트 컨텍스트와 대조, `git diff --check` 확인
- **롤백**: 생성한 FigJam 파일을 삭제하고 `PROJECT_CONTEXT.md` 링크 및 이 작업 일지 항목을 제거

### [DONE] 월별 근무표 캐시 운영 확인·Stage 로컬 디버깅 문서 보강

- **목적**: 인증 실패 요청의 캐시 미생성, 본인·친구 조회의 동일 월 key 공유, 로컬 API의 Stage 자원 연결 시 Outbox worker 위험을 운영자가 오해하지 않도록 확인 절차와 안전 경계를 문서화
- **변경**:
  - `PROJECT_CONTEXT.md`에 캐시 적용 API, 소유자·월 key 공유, events 비캐시, `401`/`400` 미생성, `DBSIZE` 해석 계약 추가
  - Stage PostgreSQL·Redis를 SSH tunnel로 사용하는 로컬 API는 별도 prefix와 읽기 전용 DB 계정을 사용하고 local worker를 실행하지 않는 안전 경계 추가
  - `DEPLOYMENT_GUIDE.md`에 Redis/cache 환경변수, readiness 상태, 인증 조회·snapshot·Outbox 검증 및 장애 확인 절차 추가
- **영향범위**: 문서만 변경하며 API·DB·Redis·배포 동작에는 영향 없음
- **파일**: `_docs/PROJECT_CONTEXT.md`, `_docs/DEPLOYMENT_GUIDE.md`, `_docs/WORKLOG.md`
- **테스트**: Markdown fence 균형, 캐시 key·라우트·환경변수·worker 실행 명령을 현재 코드와 대조, `git diff --check` 성공
- **롤백**: 이번 문서 섹션과 작업 일지 항목만 제거

## 2026-07-22

### [DONE] 공유 Redis 캐시 완료 감사 및 경쟁 조건 검증 보강

- **목적**: 승인된 구현 계획의 각 요구사항을 현재 코드와 직접 대응시키고, 기존 테스트가 간접적으로만 검증한 다월/트랜잭션/권한/동시 worker 경로를 재현해 완료 근거 강화
- **변경**:
  - Redis Lua read/write/invalidate에서 손상된 snapshot revision과 비숫자 fence를 안전하게 거부·복구
  - Sequelize `readOnly`가 실제 PostgreSQL 쓰기를 막지 않는 동작을 확인하고 월 DB 로드에 `SET TRANSACTION READ ONLY`를 명시해 `REPEATABLE READ`와 함께 적용
  - 다월 병합·기간 필터, 공통 calendar range/day cache hit, 단건/배치 rollback, 자정 넘김, stampede lock, 실제 read/write 경합, 친구 삭제, ETag, Redis 복구, worker 동시 claim·60초 재시도·7일 정리 테스트 추가
  - 배포 순서·통합 rollback 정적 테스트를 추가하고 API 전환 판단을 PostgreSQL readiness로 변경
  - 1회 bootstrap은 기존 이미지에 없는 worker를 시작하지 않고, 첫 캐시 코드 자동 배포부터 API와 같은 digest의 worker를 시작하도록 스크립트·가이드 정합성 교정
- **영향범위**: 월별 근무표 캐시와 Outbox worker의 경계 조건, API readiness 기반 배포 판단, CI 회귀 테스트와 운영 문서
- **파일**: `src/services/workShiftMonthCacheService.ts`, `test/cacheIntegration.test.cjs`, `test/deploymentCacheRollout.test.cjs`, `deploy/shiftmate-deploy`, `deploy/shiftmate-bootstrap`, `_docs/PROJECT_CONTEXT.md`, 루트/정본 배포 가이드
- **테스트**:
  - `npm test`: TypeScript build, 단위·배포 정적 테스트 9건 성공(통합 테스트 진입점 1건은 의도대로 skip)
  - 격리 PostgreSQL 16/Redis 7.4 `npm run test:integration`: 23건 전부 성공
  - expand migration은 soft delete 포함 월 백필과 재실행 멱등성을 확인했고, 최종 스키마 SQL 전체 적용 성공
  - Center Blue/Green Compose 9개 서비스 해석, 배포/bootstrap Bash 문법, workflow YAML, 루트/정본 가이드 byte 일치 성공
  - 최종 Docker image build와 worker PostgreSQL·Redis health 성공; API readiness는 Redis 정상 `ready`, Redis 장애 `degraded` 모두 PostgreSQL 기준 200 확인
  - `git diff --check` 성공
- **롤백**: 이번 감사의 Lua 방어·PostgreSQL read-only·readiness 변경과 추가 테스트/문서를 이전 상태로 복원. 기능 전체 롤백은 아래 캐시 구현 항목의 절차를 사용

### [DONE] 공유 Redis 기반 월별 근무표 캐시 구현

- **목적**: 다중 API 인스턴스에서 본인·친구의 월별 근무표 조회를 공유 Redis로 재사용하고, PostgreSQL Outbox로 변경 정합성을 보장해 반복 DB 조회 비용 절감
- **변경**:
  - `work_shift_month_states`, `work_shift_cache_outbox` expand migration과 기존 근무표 월별 revision 1 백필 추가
  - 월 snapshot/빈 달 캐시, 24시간 TTL+jitter, 5초 token lock, revision fence Lua, 손상 schema 제거, DB fallback 구현
  - 단건/수정/삭제/배치 근무표 변경과 근무 타입 표시값 변경을 업무 데이터·revision·Outbox 단일 transaction으로 통합
  - 본인/캘린더/친구 근무표 조회를 공통 월 캐시로 통합하고 친구 관계·`can_view`는 매 요청 DB 재검사
  - `GET /work-shifts` ETag/304와 CORS 노출, readiness `cache=ready|degraded|disabled` 추가
  - Outbox claim/월 병합/지수 재시도/stale claim 회수/7일 정리 worker 추가
  - Center 공유 Redis와 색상별 worker, Stage API/worker/Redis 설정, health 및 통합 rollback 배포 절차 반영
  - ADR-0020, 프로젝트 컨텍스트, 루트/정본 배포 가이드, 최종 DDL, `AGENTS.md`, 두 draw.io 동기화
- **영향범위**: 근무표/캘린더/친구 캘린더 조회, 근무표·근무 타입 쓰기, DB 스키마, 운영 환경변수, Center/Stage Compose와 CI/CD
- **파일**:
  - `src/config/redis.ts`, `src/services/workShiftMonthCacheService.ts`, `src/services/workShiftCacheInvalidationService.ts`
  - `src/workers/workShiftCacheWorker.ts`, `src/models/WorkShiftMonthState.ts`, `src/models/WorkShiftCacheOutbox.ts`
  - `migrations/add_work_shift_month_cache_support.sql`, `migrations/final_schema.sql`, `AGENTS.md`, `schema.drawio`, `visibility_flow.drawio`
  - `deploy/compose.production.yaml`, `deploy/shiftmate-deploy`, `deploy/shiftmate-bootstrap`, `.github/workflows/deploy-production.yml`
  - `test/workShiftMonthCacheService.test.cjs`, `test/cacheIntegration.test.cjs`, `test/deploymentCacheRollout.test.cjs`, `test/fixtures/cacheIntegrationSchema.sql`
- **테스트**:
  - `npm test`: TypeScript build와 단위·배포 정적 테스트 9건 성공
  - 격리 PostgreSQL 16/Redis 7.4 `npm run test:integration`: cache hit, 다월/read-only transaction/경합/권한/ETag/fallback/worker 포함 23건 성공
  - 정본 schema 적용 및 expand migration 2회 연속 실행 성공; 실제 운영 DB에는 적용하지 않음
  - 최종 Docker image build 성공, 캐시 flag `false`/`true` 양쪽 worker PostgreSQL·Redis health 성공
  - Blue/Green Compose 양 profile 9개 서비스 config, Bash 문법, workflow YAML, draw.io XML, 가이드 일치, Markdown fence, `git diff --check` 성공
  - `npm audit --audit-level=high`: 취약점 0건
- **롤백**: `WORK_SHIFT_CACHE_ENABLED=false`로 API/worker 재생성 → worker 중지 → 이전 API image 배포 → 환경별 Redis namespace 폐기. 신규 DB 테이블은 이전 서버와 충돌하지 않으므로 유지하고 백업·별도 승인 후에만 삭제
- **다음**: DB 백업 후 expand migration 적용 → Redis/worker 준비 → 캐시 비활성 이미지 배포 → Stage 활성화/관찰 → Center 활성화 순서로 운영 rollout

### [DONE] Runner sudoers·Compose profile 검증 교정

- **목적**: 홈서버 sudo가 인자 wildcard/정규식을 지원하지 않는 환경에서도 Runner가 검증된 배포 스크립트만 호출하게 하고, profile 기반 Center 서비스 6개를 문서 명령으로 정확히 검증
- **변경**:
  - sudoers 원본에서 지원되지 않는 인자 wildcard를 제거하고 root 소유 배포 스크립트의 엄격한 인자 검증을 보안 경계로 명시
  - Center Compose 검증·장애 로그 명령에 `blue`, `green` profile 추가
  - 루트/정본 가이드, 프로젝트 컨텍스트, ADR-0019 동기화
- **영향범위**: Self-hosted Runner sudo 권한 설치 및 Center Compose 운영 검증
- **테스트**:
  - 로컬 `visudo -cf deploy/sudoers/github-runner-shiftmate` 파싱 성공
  - `--profile blue --profile green config --services`에서 Center 서비스 6개 모두 확인
  - 배포·bootstrap Bash 문법 및 workflow·Compose YAML 파싱 성공
  - `DEPLOY_README.md`와 정본 가이드 내용 일치, Markdown code fence 80개 균형 확인
  - wildcard 레거시 규칙 제거와 대상 파일 `git diff --check` 통과
- **파일**:
  - `deploy/sudoers/github-runner-shiftmate`
  - `DEPLOY_README.md`
  - `_docs/CI_CD_DEPLOYMENT_GUIDE.md`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **롤백**: sudoers와 가이드·설계 문서를 이전 커밋 상태로 복원

### [DONE] 루트 배포 가이드 최신화

- **목적**: 오래된 `DEPLOY_README.md`를 현재 Stage 1개·Center 3개 동일 이미지 자동 배포 흐름과 배포 전용 저장소 기준으로 교정
- **변경**:
  - 배포 저장소, 홈서버 파일 설치, Stage 설정, Center·Stage Nginx upstream, 첫 배포·롤백·장애 대응 절차를 정본 가이드와 동기화
  - `PROJECT_CONTEXT.md`에 루트 배포 가이드의 역할·의존성·사용 예 기록
- **영향범위**: 홈서버 CI/CD 작업자가 실행하는 배포 준비 및 검증 명령
- **테스트**:
  - `cmp DEPLOY_README.md _docs/CI_CD_DEPLOYMENT_GUIDE.md` 내용 일치 확인
  - 잘못된 `git push origin main`과 애플리케이션 저장소 Runner URL 제거 확인
  - Stage 설정 예시, Center·Stage upstream, 배포 전용 저장소 및 총 4개 API 컨테이너 검증 절차 포함 확인
  - Markdown 코드 fence 78개가 짝수로 닫히고 대상 파일 `git diff --check` 통과
- **파일**:
  - `DEPLOY_README.md`
  - `_docs/CI_CD_DEPLOYMENT_GUIDE.md`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/WORKLOG.md`
- **롤백**: `DEPLOY_README.md`와 관련 문서 변경을 이전 내용으로 복원

## 2026-07-21

### [DONE] Stage·Center 동일 이미지 통합 자동 배포

- **목적**: GitHub Actions가 한 번 빌드한 불변 GHCR digest를 Stage 1개와 Center 3개에 순차 적용하고 실패 시 두 환경을 이전 상태로 함께 복원
- **변경**:
  - 기존 Stage Compose와 애플리케이션 `.env`를 보존하면서 지정 서비스의 image만 덮어쓰는 root 관리 `compose.deploy.yaml` 생성 기능 추가
  - 실제 Stage Compose 서비스명과 외부 health URL을 홈서버에서 확정하도록 `stage.deploy.env.example` 추가 및 `root:root 600` 검증 적용
  - 배포 스크립트에 Stage 선배포, 3201 내부 health, Center Blue/Green 연속 배포, 양쪽 외부 health, 통합 rollback 추가
  - 부분적인 `docker compose up` 실패도 복구하도록 Stage·Center 변경 플래그를 실행 전에 설정
  - 배포·롤백 workflow timeout과 표시 문구, 홈서버 설치·검증·복구 가이드, 프로젝트 컨텍스트와 ADR-0019 갱신
- **영향범위**:
  - Stage 3201 컨테이너 재생성
  - Center Blue/Green 3개 전환
  - 운영 및 Stage rollback
- **테스트**:
  - `bash -n deploy/shiftmate-deploy`, `bash -n deploy/shiftmate-bootstrap` 성공
  - Ruby YAML parser로 배포·롤백 workflow와 운영 Compose 파싱 성공
  - `npm run build` TypeScript 컴파일 성공
  - `--profile blue --profile green`을 명시한 `docker compose config --quiet`, `config --services`로 Center 6개 서비스 구성 검증 성공
  - 임시 Stage Compose와 생성형 override 병합 후 최종 image가 지정 GHCR digest인지 확인
  - Stage/Center 부분 기동, Nginx 전환, 외부 health 실패별 복원 플래그와 실행 순서 정적 검증
- **파일**:
  - `.github/workflows/deploy-production.yml`
  - `.github/workflows/rollback-production.yml`
  - `deploy/shiftmate-deploy`
  - `deploy/stage.deploy.env.example`
  - `_docs/CI_CD_DEPLOYMENT_GUIDE.md`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **롤백**:
  - 통합 배포 스크립트와 Stage 설정을 이전 커밋으로 복원하고 생성된 Stage override 제거 후 기존 Compose 이미지로 재생성
- **다음**:
  - 홈서버에서 Stage 실제 Compose 서비스명과 HTTPS health URL을 확인해 `/opt/shiftmate-stage/.deploy.env`를 설정한 뒤 첫 workflow를 수동 실행

### [DONE] Center·Stage Nginx upstream 이름 분리

- **목적**: 운영 Center Blue/Green과 고정 Stage 프록시가 각각 `shiftmate_center_api_cluster`, `shiftmate_stage_api_cluster`를 사용하도록 Nginx upstream 이름을 명시적으로 분리
- **변경**:
  - Center Blue/Green 정적 snippet과 bootstrap/deploy 동적 렌더링을 `shiftmate_center_api_cluster`로 통일
  - 기존 Stage 3201을 `shiftmate_stage_api_cluster`로 제공하는 고정 `shiftmate-stage-upstream.conf` 추가
  - 홈서버에서 Center active snippet과 Stage fixed snippet을 각각 설치·include하고 용도별 `proxy_pass`를 사용하는 절차 추가
  - PROJECT_CONTEXT의 파일 역할·의존성과 ADR-0019의 Nginx 라우팅 계약 갱신
- **영향범위**:
  - Nginx Center/Stage upstream 정의
  - 최초 bootstrap 및 이후 Blue/Green 배포·롤백
- **테스트**:
  - `bash -n deploy/shiftmate-bootstrap`, `bash -n deploy/shiftmate-deploy` 성공
  - 배포 파일에서 레거시 `shiftmate_api_cluster`가 제거되고 Center/Stage 이름만 생성되는 것을 검색으로 확인
  - `nginx:latest`에서 Blue+Stage, Green+Stage snippet 조합 각각 `nginx -t` 성공
- **파일**:
  - `deploy/shiftmate-bootstrap`
  - `deploy/shiftmate-deploy`
  - `deploy/nginx/shiftmate-upstream-blue.conf`
  - `deploy/nginx/shiftmate-upstream-green.conf`
  - `deploy/nginx/shiftmate-stage-upstream.conf`
  - `_docs/CI_CD_DEPLOYMENT_GUIDE.md`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **롤백**:
  - Stage snippet/include를 제거하고 Center upstream 이름과 proxy_pass를 변경 전 이름으로 복원
- **다음**:
  - 홈서버 실제 Nginx 설정에서 Center/Stage server block의 `proxy_pass`를 확인한 뒤 가이드 순서로 두 snippet 설치 및 `nginx -t` 수행

### [DONE] 배포 자동화 전용 저장소 분리

- **목적**: GitHub Actions 및 홈서버 Blue/Green 배포 파일을 애플리케이션 저장소와 분리하여 `hspark-1/shift_calendar_server-deploy`의 `main` 브랜치에서 관리
- **변경**:
  - `shiftmate-cicd-bundle/repository/`의 GitHub Actions, Compose, Nginx, 서버 스크립트를 저장소 루트 `.github/workflows/`, `deploy/`로 이전
  - 번들 README를 `_docs/CI_CD_DEPLOYMENT_GUIDE.md`로 이전하고 배포 전용 저장소·원격 기준으로 수정
  - `.dockerignore`에 `.github`, `deploy`를 추가해 운영 이미지 빌드 컨텍스트에서 자동화 파일 제외
  - 존재하지 않는 `actions/checkout@v7`, `actions/setup-node@v7`을 공식 현재 major인 `@v6`으로 수정
  - `PROJECT_CONTEXT.md`에 운영 CI/CD 파일 역할·의존성·사용 예를 추가하고 ADR-0019에 별도 배포 저장소와 Blue/Green 정책 기록
  - 이전 완료 후 `shiftmate-cicd-bundle/` 디렉터리 제거
- **영향범위**:
  - GitHub Actions 배포·롤백
  - GHCR 이미지 빌드 및 홈서버 Blue/Green 배포
  - 배포 자동화 문서
- **파일**:
  - `.dockerignore`
  - `.github/workflows/deploy-production.yml`
  - `.github/workflows/rollback-production.yml`
  - `deploy/compose.production.yaml`
  - `deploy/deploy.env.example`
  - `deploy/shiftmate-bootstrap`
  - `deploy/shiftmate-deploy`
  - `deploy/nginx/shiftmate-upstream-blue.conf`
  - `deploy/nginx/shiftmate-upstream-green.conf`
  - `deploy/sudoers/github-runner-shiftmate`
  - `_docs/CI_CD_DEPLOYMENT_GUIDE.md`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - 원격 `deploy/main`이 작업 전 `791498a7af689a6275846b0f1e5fd5ad9ce4320d`임을 확인
  - 공개 GitHub API가 배포 저장소에 404를 반환하고 인증된 `git ls-remote`는 성공하여 Private 원격 접근 상태 확인
  - GitHub 공식 Action 저장소 기준 `actions/checkout@v6`, `actions/setup-node@v6`, `docker/login-action@v4`, `docker/setup-buildx-action@v4`, `docker/build-push-action@v7` 유효성 확인
  - `npm run build` 성공
  - GitHub Actions 2개와 Compose YAML 파싱 성공
  - `bash -n deploy/shiftmate-bootstrap`, `bash -n deploy/shiftmate-deploy` 성공
  - `docker compose ... config --quiet` 성공
  - 배포 스크립트 실행 권한과 `shiftmate-cicd-bundle/` 제거 확인
- **롤백**:
  - `deploy/main`을 이번 배포 자동화 커밋의 부모로 되돌리고 필요 시 제거한 번들 구조로 파일 복원
- **다음**:
  - GitHub 저장소에서 Private 여부, GHCR Actions access, self-hosted runner label을 확인하고 가이드에 따라 최초 bootstrap 수행

## 2026-07-20

### [DONE] 프론트팀용 근무 타입 색상 메타데이터 API 가이드 작성

- **목적**: Flutter 프론트팀이 신규 `base_color`, `color_intensity` 계약을 정확히 연동할 수 있는 요청/응답·호환·오류 처리 가이드 제공
- **변경**:
  - 색상 필드 역할, 흰색 기준 농도 계산식, 인증·응답 계약 문서화
  - 조회·생성·수정 요청/응답 예시와 수정 조합별 서버 동작 정리
  - 레거시 데이터 fallback 및 구버전 `color` 단독 요청 호환 정책 명시
  - 오류 코드별 Flutter 처리 기준과 실제 프론트 영향 파일·구현 예시 추가
  - DB expand migration 선적용을 포함한 배포·연동 체크리스트 제공
- **영향범위**:
  - `GET/POST /api/v1/shift-types`
  - `PUT /api/v1/shift-types/:shift_type_id`
  - Flutter 근무 타입 API 모델·요청 모델·색상 선택 상태
- **파일**:
  - `_docs/SHIFT_TYPE_COLOR_API_GUIDE.md`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - 서버 route/controller/service/model 구현과 필드·검증·오류 코드 직접 대조
  - 현재 Flutter 모델·서비스·색상 선택 화면과 영향 범위 직접 대조
  - 가이드 내 JSON 코드 블록 9개 파싱 성공
  - `npm run build` 성공
  - `git diff --check` 성공
- **롤백**: 신규 가이드와 관련 문서 항목 제거
- **다음**:
  - 서버 DB에 `add_shift_type_color_metadata.sql` 적용 후 API 계약 확인
  - 프론트에서 기준 색상·농도 상태 보존 및 요청 모델 반영
  - Flutter 모델·서비스·위젯 테스트에 신규/레거시 응답 사례 추가

### [DONE] 색상 메타데이터 배포 후 캘린더 API 500 원인 확인

- **목적**: `GET /shift-types`, `GET /calendar/range`에서 발생한 `SequelizeDatabaseError`의 실제 DB 원인을 확인
- **변경**:
  - DebugMCP 중단점과 디버그 세션 상태 확인 후 정리
  - 현재 `.env`가 연결한 `shift_calendar.public.shift_types` 컬럼과 제약을 읽기 전용 조회
  - 누락 컬럼 직접 SELECT로 PostgreSQL 오류 코드 확인
- **영향범위**:
  - `GET /api/v1/shift-types`
  - `GET /api/v1/calendar/range`
  - PostgreSQL `shift_types`
- **파일**: `_docs/WORKLOG.md`
- **테스트**:
  - 실제 DB `shift_types`에 `base_color`, `color_intensity`가 없음을 확인
  - `SELECT base_color, color_intensity FROM shift_types`가 PostgreSQL `42703`, `column "base_color" does not exist`를 반환함을 확인
  - `GET /shift-types` 직접 조회와 `GET /calendar/range`의 `ShiftType` include 모두 Sequelize 기본 attribute 선택으로 신규 컬럼을 참조하는 코드 경로 확인
- **롤백**: 문서 항목만 되돌리기
- **다음**:
  - DB 백업 후 `migrations/add_shift_type_color_metadata.sql`을 먼저 수동 적용
  - 신규 서버 API 확인 후 `migrations/backfill_shift_type_color_metadata.sql` 적용

## 2026-07-19

### [DONE] 근무 타입 색상 메타데이터 서버 계약 및 DB 마이그레이션 추가

- **목적**: 근무 타입의 최종 색상뿐 아니라 기준 색상과 농도를 저장·복원할 수 있도록 서버 로직과 수동 PostgreSQL 마이그레이션을 추가
- **변경**:
  - `ShiftType` 모델에 nullable `base_color`와 기본값 100의 `color_intensity` 추가
  - 신규 기준 색상 `#FFRRGGBB`, 정수 농도 `0..100` route validation 및 안정적인 오류 코드 매핑
  - 불투명 흰색 기준 채널 혼합 계산과 생성/수정 공통 색상 메타데이터 해석 추가
  - 신규 메타데이터 요청은 최종 `color`를 서버에서 계산하고, 함께 전달된 값이 다르면 `COLOR_METADATA_MISMATCH`로 거절
  - 구버전 `color` 단독 쓰기와 레거시 조회는 `base_color=color`, `color_intensity=100`으로 처리
  - 기본 근무 템플릿 생성도 세 색상 값을 함께 저장
  - 운영 DB용 expand SQL과 backfill/constraint SQL을 분리해 추가
  - 최종 DDL, `AGENTS.md`, `schema.drawio`, 프로젝트 컨텍스트, ADR-0018 동기화
- **영향범위**:
  - `GET/POST /api/v1/shift-types`
  - `PUT /api/v1/shift-types/:shift_type_id`
  - PostgreSQL `shift_types`
- **파일**:
  - `src/models/ShiftType.ts`
  - `src/routes/calendarRoutes.ts`
  - `src/controllers/calendarController.ts`
  - `src/services/shiftTemplateService.ts`
  - `src/services/calendarService.ts`
  - `migrations/add_shift_type_color_metadata.sql`
  - `migrations/backfill_shift_type_color_metadata.sql`
  - `migrations/final_schema.sql`
  - `AGENTS.md`
  - `schema.drawio`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - 색상 계산 0%/50%/100% 예상값 확인
  - 색상 계산·메타데이터 해석 9개 사례 확인: 농도 0%/50%/100%, 신규 계산, 구버전 color 단독, null 삭제, 무변경, 부분 메타데이터, 최종값 불일치
  - `git diff --check` 성공
  - PostgreSQL 임시 테이블 SQL 검증을 시도했으나 로컬 `localhost:5432`가 실행 중이지 않아 `ECONNREFUSED`; 대상 DB에는 migration을 실행하지 않음
- **롤백**:
  - 서버/문서 변경을 이전 상태로 복원
  - 구버전 서버로 먼저 롤백한 뒤 SQL 파일의 rollback 구문으로 신규 CHECK 제약과 두 컬럼 제거
  - 컬럼 제거 전 기준 색상·농도 데이터 백업 필수
- **다음**:
  - 대상 DB 백업 및 Phase 0 감사 결과 기록
  - `add_shift_type_color_metadata.sql` 수동 적용 후 신규 서버 배포/API 검증
  - 모든 인스턴스 교체 확인 후 `backfill_shift_type_color_metadata.sql` 수동 적용 및 결과 기록

### [DONE] ts-node 개발 실행의 Express Request 타입 확장 로딩 수정

- **목적**: `npm run dev`에서 `src/types/express.d.ts`가 로드되지 않아 `request_id` 속성 컴파일이 실패하는 문제 해결
- **변경**:
  - `tsconfig.json`에 `ts-node.files=true`를 추가해 `include: ["src/**/*"]`의 ambient 선언 파일 로딩 활성화
  - 프로젝트 컨텍스트에 `express.d.ts`의 `request_id` 확장과 ts-node 설정 의존성 기록
- **영향범위**:
  - 로컬 개발 실행 및 디버거 기동
  - 운영 빌드/런타임 동작 변경 없음
- **파일**:
  - `tsconfig.json`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - 기존과 동일한 `node --inspect -r ts-node/register src/index.ts` 컴파일에서 TS2339 미발생
  - 실제 `npm run dev` 디버거 기동 및 PostgreSQL 연결 성공
  - `PORT=13105`, `INSTANCE_NAME=ts-node-check`에서 `GET /health` 200 및 인스턴스 이름 확인
  - SIGINT 수신 후 HTTP 서버와 DB pool 정상 종료 확인
  - `git diff --check`, `git diff --cached --check` 성공
- **롤백**:
  - tsconfig의 ts-node 선언 파일 로딩 설정 제거

### [DONE] Intel N100용 Express Docker 이미지 구성 및 검증

- **목적**: TypeScript 빌드와 운영 의존성만 포함하는 `linux/amd64` 이미지를 만들고 비루트 실행, health check, graceful shutdown을 검증
- **변경**:
  - Node 22 Debian slim 멀티 스테이지 `Dockerfile` 추가
  - builder에서 TypeScript를 `dist/`로 컴파일하고 runtime에는 `npm ci --omit=dev` 결과와 `dist/`만 복사
  - runtime을 `USER node`, `CMD node dist/index.js`, `STOPSIGNAL SIGTERM`으로 구성
  - 루트 `/health`를 사용하는 Docker `HEALTHCHECK` 추가
  - `.dockerignore`에서 `.env*`, Git, `node_modules`, `dist`, migration, 문서/개발 자료 제외
  - 운영 의존성 감사에서 발견한 Axios/Express/Sequelize 등 취약 패키지를 호환 패치 버전으로 갱신
  - Sequelize 6 하위 `uuid`를 CommonJS `v1`/`v4` 호환 11.1.1로 override
  - Docker 빌드/로컬 실행/DB loopback 주의사항을 프로젝트 컨텍스트와 배포 가이드에 기록
  - ADR-0017에 이미지 기반·아키텍처·보안·종료 정책 기록
- **영향범위**:
  - Docker 이미지 빌드 및 컨테이너 실행
  - Node 런타임 의존성 버전과 lockfile
  - 애플리케이션 TypeScript 소스 동작은 변경하지 않음
- **파일**:
  - `Dockerfile`
  - `.dockerignore`
  - `package.json`
  - `package-lock.json`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DEPLOYMENT_GUIDE.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - `npm audit` 및 `npm audit --omit=dev` 취약점 0건
  - `docker buildx build --check --platform linux/amd64 .` 경고 없음
  - `docker buildx build --platform linux/amd64 --load -t shiftmate-api:1.0.0 .` 성공
  - 최종 이미지 ID `sha256:2e8ce42e6e12958a10d704a8ec798c944b66d698c174e4aac63de9641e3ac9d8`
  - 이미지 플랫폼 `amd64/linux`, 크기 251,805,497 bytes
  - 이미지 설정 `User=node`, `WorkingDir=/app`, `Cmd=node dist/index.js`, `StopSignal=SIGTERM` 확인
  - 컨테이너 UID/GID `1000:1000`
  - `/app/dist/index.js` 존재, `/app/.env`·TypeScript·ts-node 미포함 확인
  - 최초 `.env` 실행은 `DB_HOST`가 loopback이라 DB 연결 거부됨을 확인
  - Docker Desktop 테스트에서 `DB_HOST=host.docker.internal` override 후 PostgreSQL 연결 성공
  - `GET /health` → `{"status":"ok","instance":"local-test"}`, Docker health `healthy`
  - `docker stop`의 SIGTERM 수신 후 HTTP 서버와 DB pool 정상 종료 확인
  - `--rm`으로 테스트 컨테이너 자동 삭제 및 호스트 3000 포트 해제 확인
  - `git diff --check`, `git diff --cached --check` 성공
- **롤백**:
  - `Dockerfile`, `.dockerignore` 제거
  - `package.json`, `package-lock.json`의 이번 의존성 패치와 uuid override를 이전 버전으로 복원
  - 이번 작업의 PROJECT_CONTEXT/DEPLOYMENT_GUIDE/DECISIONS/WORKLOG 변경 제거
- **다음**:
  - 홈서버에서 `linux/amd64` 이미지를 로드하고 DB 주소/메모리 사용량 확인
  - 검증된 동일 이미지로 Express 컨테이너 3개 실행

### [DONE] Express 운영 보안·관측 기능 추가

- **목적**: 컨테이너별 식별 가능한 루트 health check와 외부 바인딩, 요청 제한, Request ID, 민감정보 안전 로그를 운영 기준으로 적용
- **변경**:
  - 루트 `GET /health`에서 `status=ok`, `instance=INSTANCE_NAME` 반환
  - Express listen 주소를 `0.0.0.0`으로 명시하고 시작 로그에 인스턴스 이름 포함
  - JSON/form 본문에 `REQUEST_BODY_LIMIT` 적용
  - 로그인/회원가입/카카오/네이버/Refresh Token 요청에 인스턴스별 IP rate limit 적용
  - `X-Request-ID` 검증·생성·응답 전파 및 모든 morgan access log 연결
  - 전역 오류 응답에 `request_id` 포함
  - 운영 5xx 응답의 내부 메시지와 stack 제거
  - 인증/캘린더/친구/스케줄 Controller와 OAuth/친구 서비스의 오류 객체 원문 로그를 `logError()`로 교체
  - `logError()`는 Axios config/request/response, 오류 message/stack 전체를 직렬화하지 않고 안전한 메타데이터만 기록
  - access log는 쿼리 문자열, 요청 본문, Authorization, referrer를 기록하지 않는 경로 기반 형식으로 제한
  - OAuth 성공 로그의 이메일을 `user_id`로 대체
  - 카카오 `redirect_uri`와 Refresh Token 요청에 route validation 추가
  - 인증 route의 express-validator 결과를 Controller 전에 차단하는 `validateRequestMiddleware` 추가
  - `.env.example`, 프로젝트 컨텍스트, 배포 가이드, ADR-0016에 운영 정책 반영
- **영향범위**:
  - 서버 기동과 health check
  - 인증 라우트
  - HTTP 요청/오류 로그
  - 공통 요청 body parsing
- **파일**:
  - `src/index.ts`
  - `src/config/environment.ts`
  - `src/routes/authRoutes.ts`
  - `src/middlewares/errorHandler.ts`
  - `src/middlewares/rateLimit.ts`
  - `src/middlewares/requestContext.ts`
  - `src/middlewares/validateRequest.ts`
  - `src/utils/logger.ts`
  - `src/types/express.d.ts`
  - `src/controllers/authController.ts`
  - `src/controllers/calendarController.ts`
  - `src/controllers/friendController.ts`
  - `src/controllers/scheduleController.ts`
  - `src/services/friendService.ts`
  - `src/services/kakaoService.ts`
  - `src/services/naverService.ts`
  - `.env.example`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DEPLOYMENT_GUIDE.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - 최초 `npm run build`에서 morgan `IncomingMessage.request_id` 타입 오류 확인 후 Express `Request` cast로 수정
  - 수정 후 `npm run build` 성공
  - `git diff --check` 성공
  - `PORT=3000`, `INSTANCE_NAME=shiftmate-api-test` 운영 실행:
    - `GET /health` → 200, `{"status":"ok","instance":"shiftmate-api-test"}`
    - listen 주소 `*:3000`으로 `0.0.0.0` 바인딩 확인
  - 유효한 `X-Request-ID` 응답 전파 및 access log 포함 확인
  - access log에 요청 query와 민감 테스트 문자열이 포함되지 않음 확인
  - `REQUEST_BODY_LIMIT=1kb` 검증에서 초과 JSON 요청 413
  - `AUTH_RATE_LIMIT_MAX=2` 검증에서 로그인 요청 상태 `400, 400, 429`
  - 잘못된 카카오 OAuth 입력은 외부 호출 전 400 `VALIDATION_ERROR`로 차단되고 입력 원문은 응답/로그에 미포함
  - 운영 5xx 응답의 stack 미포함 및 일반화된 메시지 확인
  - 민감 테스트 문자열이 오류/access log에 포함되지 않음 확인
  - `SIGTERM`과 `SIGINT`에서 HTTP 서버 종료 후 DB pool 정상 종료 확인
- **롤백**:
  - 신규 `requestContext.ts`, `rateLimit.ts`, `validateRequest.ts`, `logger.ts` 제거
  - `src/index.ts`, 인증 라우트/컨트롤러/OAuth 서비스, 문서를 이번 작업 이전으로 되돌리기
- **다음**:
  - Docker liveness는 `/health`, readiness는 `/api/v1/health/ready` 사용
  - Nginx에 3개 인스턴스 전체 공통 인증 `limit_req`와 Request ID 전달 설정

### [DONE] Express 다중 인스턴스 운영 안전성 보완

- **목적**: 동일 Express 서버 3개를 로드밸런서 뒤에서 실행할 때 인증·도메인 동시성과 컨테이너 기동/종료 안전성을 확보
- **변경**:
  - Access/Refresh Token에 무작위 `jti`를 추가해 같은 사용자의 동시 발급 토큰도 고유하게 생성
  - Refresh Token rotation에서 대상 row를 `FOR UPDATE`로 잠그고 기존 토큰 무효화와 신규 토큰 저장을 단일 트랜잭션으로 처리
  - 로그아웃의 단일 Refresh Token 무효화를 조건부 원자 UPDATE로 변경
  - 사용자 기본 템플릿 생성을 사용자 ID 기반 PostgreSQL advisory transaction lock으로 직렬화
  - 친구 요청 생성을 정렬된 사용자 쌍 advisory transaction lock과 단일 트랜잭션으로 처리해 반대 방향 동시 요청 방지
  - 친구 요청 수락/거절 시 `friend_requests` row lock 적용
  - 신규 `src/config/environment.ts`에서 필수 환경변수, JWT secret 분리, 숫자/boolean 설정 검증
  - DB pool을 `DB_POOL_MAX`, `DB_POOL_MIN`, `DB_POOL_ACQUIRE_MS`, `DB_POOL_IDLE_MS`로 환경변수화
  - 서버 시작 경로에서 `sequelize.sync()`를 제거하고 `DB_SYNC=true`면 시작 거부
  - `/health/live`, `/health/ready`를 분리하고 기존 `/health` 호환 유지
  - `SIGTERM`/`SIGINT`에서 HTTP 서버 종료 후 Sequelize pool을 닫는 graceful shutdown 추가
  - CORS Origin을 정확 일치 방식으로 변경하고 운영 `trust proxy`, production combined log, 개발 전용 `/test` 정책 적용
  - 잘못된 자동 migration/seed package script, 미사용 `sequelize-cli` 의존성, 배포 가이드 명령 제거
  - `migrations/` Git 제외 정책은 개발자 수동 실행·기록 목적이라는 사용자 방침에 따라 유지
  - 비밀값이 없는 `.env.example`은 신규 운영 환경변수 예시를 공유할 수 있도록 Git 추적 대상으로 전환
  - `PROJECT_CONTEXT.md`, `DEPLOYMENT_GUIDE.md`, ADR-0015에 다중 인스턴스 운영 계약 반영
- **영향범위**:
  - 서버 기동/종료
  - JWT 발급 및 Refresh Token 갱신
  - 로그인 시 기본 근무 템플릿 보장
  - 친구 요청 응답
  - 헬스 체크 및 운영 프록시 설정
- **파일**:
  - `src/config/environment.ts`
  - `src/config/database.ts`
  - `src/index.ts`
  - `src/routes/index.ts`
  - `src/middlewares/auth.ts`
  - `src/services/authService.ts`
  - `src/services/shiftTemplateService.ts`
  - `src/services/friendService.ts`
  - `package.json`
  - `package-lock.json`
  - `.gitignore`
  - `.env.example`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DEPLOYMENT_GUIDE.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - `git diff --check` 성공
  - 환경변수 실패 검증 성공:
    - 빈 `JWT_SECRET` 시작 거부
    - `DB_SYNC=true` 시작 거부
    - `DB_POOL_MAX=0` 시작 거부
  - Refresh Token 검증:
    - 같은 사용자 연속 발급 Refresh Token이 서로 다름
    - 동일 Refresh Token 동시 rotation 2건 중 정확히 1건만 성공
  - 임시 사용자 동시성 검증 후 데이터 정리:
    - 기본 템플릿 동시 보장 3건 실행 결과 활성 템플릿 1건
    - 반대 방향 친구 요청 동시 실행 결과 1건만 성공
    - 동일 친구 요청 수락/거절 동시 실행 결과 1건만 성공
  - 운영 모드 3개 인스턴스 통합 검증:
    - 13101/13102/13103 모두 `/health/ready` 200
    - 동일 JWT 프로필 응답 SHA-256 일치
    - 정확한 운영 Origin 200, 유사 악성 Origin CORS 헤더 없음
    - `SIGTERM` graceful shutdown 성공
  - 최종 `dist/index.js` 3개 동시 실행 및 DB readiness 성공
- **롤백**:
  - 이번 작업에서 변경한 코드/문서를 이전 상태로 되돌리고 신규 `src/config/environment.ts` 제거
  - 운영 롤백 시 신규 선택 환경변수는 제거 가능하지만 기존 필수 DB/JWT 환경변수는 유지
- **다음**:
  - Dockerfile/.dockerignore 및 컨테이너 healthcheck 추가
  - 홈서버 PostgreSQL `max_connections` 확인 후 `3 × DB_POOL_MAX` 예산 확정
  - Nginx upstream과 3개 컨테이너 구성

## 2026-07-09

### [DONE] 근무표 삭제 후 같은 날짜 재등록 복구

- **목적**: soft delete된 근무표를 같은 날짜에 다시 등록했을 때 캘린더 조회에서 누락되지 않도록 저장 동작 보정
- **변경**:
  - 단건 근무표 upsert 시 `deleted_at`, `deleted_by_user_id`를 `null`로 설정해 기존 soft-deleted row를 활성 상태로 복구
  - 배치 근무표 upsert 시에도 동일하게 삭제 필드를 초기화
  - `PROJECT_CONTEXT.md`에 `(owner_user_id, work_date)` unique 기준 재등록 복구 정책 추가
  - `DECISIONS.md`에 ADR-0014로 soft-deleted row 복구 결정 기록
- **영향범위**:
  - `POST /api/v1/work-shifts`
  - `POST /api/v1/work-shifts/batch`
  - `GET /api/v1/calendar/range`, `GET /api/v1/work-shifts`의 재등록 데이터 조회 결과
- **파일**:
  - `src/services/calendarService.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
- **롤백**:
  - 이번 작업에서 추가한 `deleted_at`, `deleted_by_user_id` 초기화와 문서 변경을 이전 상태로 되돌리기
- **다음**:
  - 실제 계정으로 근무표 삭제 후 같은 날짜 재등록 API 호출 및 캘린더 재조회 확인

### [DONE] calendarController 400 응답 원인 DebugMCP 확인

- **목적**: `src/controllers/calendarController.ts` 경로에서 400 응답이 반환되는 실제 런타임 원인을 DebugMCP로 확인
- **변경**:
  - DebugMCP 조건부 중단점을 Express `res.status()`에 설정해 `code === 400` 응답 지점 확인
  - 400 응답이 `calendarController.createShiftType()`의 validation 실패 분기에서 발생함을 확인
  - 요청 정보 확인: `POST /api/v1/shift-types`, 인증 사용자 `acae546f-cc5a-4aae-9e13-4226ac2d8258`
  - 요청 body 확인: `{ "code": "ㅂ", "name": "ㅂㅂ", "color": 4278215076 }`
  - express-validator 컨텍스트 확인 결과 `color` 필드만 실패:
    - `value=4278215076`
    - `msg=색상은 #AARRGGBB 형식이어야 합니다.`
    - `path=color`
- **영향범위**:
  - 캘린더/근무표/일정 API 디버깅
- **파일**:
  - `_docs/WORKLOG.md`
- **테스트**:
  - DebugMCP `Debug npm run dev` 세션으로 런타임 요청 확인
  - `req.originalUrl`, `req.body`, `req['express-validator#contexts']` 평가로 validation 실패 원문 확인
  - DebugMCP 세션 종료 완료
- **롤백**:
  - 문서 작업 항목만 되돌리기
- **다음**:
  - Flutter에서 `color`를 숫자 `Color.value`가 아니라 `#AARRGGBB` 문자열로 전송하도록 맞추거나, 백엔드 validation 계약을 숫자 허용으로 변경할지 결정

## 2026-07-08

### [DONE] work_shifts owner_user_id 조회 조건 DebugMCP 확인

- **목적**: 현재 hit된 breakpoint에서 `work_shifts` 조회가 어떤 `owner_user_id` 조건으로 실행되는지 DebugMCP 런타임 값으로 확인
- **변경**:
  - DebugMCP 현재 세션의 `calendarController.getCalendarRange` breakpoint에서 `req.user`, `req.query`, `originalUrl` 확인
  - 컨트롤러가 `calendarService.getCalendarRange(user_id, start_date, end_date)`에 전달하는 인자 확인
  - `calendarService.getWorkShifts()` 내부 `WorkShift.findAll` 직전 breakpoint에서 `user_id`, `start_date`, `end_date` 로컬 변수 확인
  - `WorkShift.findAll` 실행 후 반환된 `work_shifts` 11건의 `owner_user_id`, `work_date`, `deleted_at`, `schedule_id`, 근무 타입 조인 결과 확인
  - 서버 DB 연결 정보가 `localhost:5432/shift_calendar`임을 확인
- **영향범위**:
  - 캘린더/근무표 조회 API 디버깅
- **파일**:
  - `_docs/WORKLOG.md`
- **테스트**:
  - DebugMCP 런타임 확인:
    - 최초 요청: `/api/v1/calendar/range?start_date=2026-06-01&end_date=2026-08-31`
    - 인증 사용자: `acae546f-cc5a-4aae-9e13-4226ac2d8258`
    - `WorkShift.findAll` 조건: `owner_user_id=user_id`, `work_date BETWEEN start_date AND end_date`, `deleted_at=null`
    - 반환 결과: 11건, 모두 `owner_user_id=acae546f-cc5a-4aae-9e13-4226ac2d8258`, `deleted_at=null`
    - 반환 날짜: `2026-07-05`~`2026-07-16`
- **롤백**:
  - 문서 작업 항목만 되돌리기
- **다음**:
  - 필요 시 Sequelize SQL logging을 일시 활성화해 실제 SQL 문자열까지 확인

### [DONE] 친구 요청 처리 완료 알림 actions 제거

- **목적**: 친구 요청 수락/거절 처리 후 반환되는 알림에 확인 버튼 액션을 포함하지 않도록 `actions`를 빈 배열로 변경
- **변경**:
  - 처리 완료된 원본 친구 요청 알림 갱신 시 `actions: []`를 저장하도록 변경
  - 친구 요청 거절 결과 알림 생성 시 `actions: []`를 저장하도록 변경
  - `NotificationAction` 타입 주석에서 더 이상 사용하지 않는 `dismiss` 예시 제거
  - 프로젝트 컨텍스트, 친구 API 가이드, ADR의 처리 완료 알림 계약을 `actions=[]`로 갱신
- **영향범위**:
  - 친구 요청 응답 API
  - 알림 목록 API
  - `actions` 배열 기반으로 버튼을 렌더링하는 프론트 알림 UI
- **파일**:
  - `src/services/friendService.ts`
  - `src/models/Notification.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/FRIEND_API_GUIDE.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - `rg -n "dismiss" src` 결과 없음
- **롤백**:
  - 이번 작업에서 수정한 코드/문서 변경을 이전 상태로 되돌리기
- **다음**:
  - 실제 수락/거절 API 호출 후 신규/갱신 알림의 `actions`가 `[]`로 내려오는지 확인

### [DONE] 친구 요청 알림 actions 반환값 DebugMCP 확인

- **목적**: DB에서 임의 수정한 `notifications.actions` 값과 달리 API 응답에서 `[{ type: "dismiss", label: "확인" }]`이 반환되는 이유를 DebugMCP 런타임 디버깅으로 확인
- **변경**:
  - DebugMCP 기존 중단점 정리 후 `getNotifications()` 반환 직전과 친구 요청 응답 갱신 지점에 중단점 설정
  - `GET /notifications` 요청이 `src/services/friendService.ts`의 `const notifications = rows.map(...)` 지점에 도달하는 것을 확인
  - 런타임 `rows` 값 확인 결과 `notification_id=c666e7eb-c234-4c02-8583-50d593b4310b`의 `actions`가 이미 `[{ type: "dismiss", label: "확인" }]`으로 조회됨
  - 런타임 DB 연결 정보가 `localhost:5432/shift_calendar`, `DB_USER=postgres`, `DB_SSL=false`임을 확인
  - `serializeNotification()` 결과도 `rows.actions`와 동일하게 `dismiss`를 반환하는 것을 확인
- **영향범위**:
  - 알림 목록 API
  - 친구 요청 응답 API
- **파일**:
  - `_docs/WORKLOG.md`
- **테스트**:
  - DebugMCP `start_debugging`으로 `Debug npm run dev` 세션 연결 성공
  - `getNotifications()` 런타임 변수 평가로 `rows[0].actions`와 직렬화 결과 확인
  - DebugMCP 중단점 정리 완료
- **롤백**:
  - 문서 작업 항목만 되돌리기
- **다음**:
  - DB 툴에서 수정한 대상 DB/스키마가 서버의 `.env` 연결 정보와 같은지 확인
  - 필요하면 해당 row를 같은 DB에서 다시 수정한 뒤 `GET /notifications` 재호출로 확인

### [DONE] 친구 요청 알림 처리 후 표시 상태 갱신

- **목적**: 알림 화면의 친구 요청 카드에서 수락/거절 버튼을 누른 뒤 같은 알림이 처리 완료 상태로 보이도록 백엔드 응답/알림 데이터를 갱신
- **변경**:
  - `respondToFriendRequest()`에서 친구 요청 상태 변경, 원본 알림 갱신, 요청자 결과 알림 생성을 하나의 트랜잭션으로 처리
  - 요청 수신자의 원본 `FRIEND_REQUEST` 알림을 수락 시 `FRIEND_REQUEST_ACCEPTED`, 거절 시 `FRIEND_REQUEST_REJECTED`로 갱신
  - 처리 완료 원본 알림의 `actions`를 `[{ type: "dismiss", label: "확인" }]`로 변경해 수락/거절 버튼이 다시 표시되지 않도록 계약 고정
  - `payload.request_status`, `payload.responded_at`을 추가해 프론트가 처리 결과를 명시적으로 확인 가능하게 함
  - 친구 요청 응답 API의 `data.notification`에 갱신된 원본 알림을 포함해 프론트가 재조회 없이 기존 카드를 교체할 수 있도록 함
  - `NotificationInfo` 직렬화 함수를 추가해 알림 조회 응답과 응답 API의 알림 객체 구조를 통일
  - 친구 API 가이드, 프로젝트 컨텍스트, ADR에 새 알림 타입/응답 계약 반영
- **영향범위**:
  - 친구 요청 응답 API
  - 알림 목록 API
  - 알림 화면에서 `actions` 또는 `notification_type` 기반으로 버튼을 표시하는 프론트 UI
- **파일**:
  - `src/services/friendService.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/FRIEND_API_GUIDE.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - 코드 확인: 원본 알림 조회는 `notifications.payload->>'request_id'`와 수신자 `user_id` 기준으로 수행
  - 코드 확인: `friend_requests.status` 변경, 원본 알림 갱신, 요청자 결과 알림 생성이 동일 트랜잭션 안에서 수행
- **롤백**:
  - 이번 작업에서 수정한 코드/문서 변경을 이전 상태로 되돌리기
- **다음**:
  - 실제 access token과 친구 요청 fixture로 수락/거절 후 알림 카드가 `확인` 상태로 교체되는지 Flutter 연동 확인

### [DONE] 개인 일정 생성 API 구현

- **목적**: Flutter 메인 캘린더의 일정 추가 모달에서 개인 일정을 생성할 수 있도록 `POST /api/v1/events` 계약 구현
- **변경**:
  - `POST /api/v1/events` 라우트 추가
  - 요청 validation 추가: `title` trim 후 필수, `all_day` boolean, `start_at`/`end_at` UTC `Z` ISO 문자열 및 `start_at < end_at`, `visibility_level` 0~5
  - 컨트롤러에서 validation/service 오류를 `INVALID_TITLE`, `INVALID_EVENT_TIME`, `INVALID_VISIBILITY_LEVEL`로 매핑
  - 서비스에서 인증 사용자 기준 `owner_user_id`, `created_by_user_id`를 설정해 `events` insert 후 `EventApiModel` 반환
  - 개인 캘린더 이벤트 조회 응답을 `EventApiModel` 공통 직렬화로 정리해 `created_at`, `updated_at` 포함
  - 인증 실패 응답에 `UNAUTHORIZED` error code 추가
  - `PROJECT_CONTEXT.md`에 개인 일정 생성 API 계약과 이벤트 응답 필드 반영
- **영향범위**:
  - 개인 일정 생성 API
  - 개인 캘린더 이벤트 조회 응답의 추가 필드(`created_at`, `updated_at`)
  - 인증 실패 응답 포맷에 `error.code=UNAUTHORIZED` 추가
- **파일**:
  - `src/routes/calendarRoutes.ts`
  - `src/controllers/calendarController.ts`
  - `src/services/calendarService.ts`
  - `src/middlewares/auth.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - 코드 확인: 생성 API는 JWT 인증 라우터 아래에서만 접근 가능
  - 코드 확인: `owner_user_id`, `created_by_user_id`는 요청 body가 아니라 인증 사용자 `user_id`로 설정
- **롤백**:
  - 이번 작업에서 수정한 라우트/컨트롤러/서비스/인증 미들웨어/문서 변경을 이전 상태로 되돌리기
- **다음**:
  - 실제 access token으로 정상 생성, title 공백, 시간 역전, visibility 범위 초과, 토큰 없음 케이스 API 호출 검증

## 2026-07-07

### [DONE] FE 캘린더 근무표 응답 계약 점검 및 보강

- **목적**: Flutter 캘린더가 서버 응답의 근무 타입 이름/색상/시간을 화면 표시 기준으로 사용하므로, 캘린더/근무표 API 응답 계약과 사용자별 조회 조건을 안정화
- **변경**:
  - `WorkShiftApiModel` 응답 직렬화를 `calendarService` 공통 함수로 정리
  - `GET /calendar/range`, `GET /work-shifts`, `POST /work-shifts`, `PUT /work-shifts/:work_shift_id`, `POST /work-shifts/batch`의 근무표 응답 필드를 동일하게 유지
  - 단건 생성/수정 응답 상세 조회에 `owner_user_id = current_user.user_id`와 `deleted_at = null` 조건 추가
  - 근무표 배치 응답 상세 조회에도 현재 사용자 소유 조건 추가
  - `shift_type_color` 응답을 `#AARRGGBB` 또는 `null`로 정규화
  - `start_time`, `end_time` 응답을 `HH:mm:ss` 또는 `null`로 정규화
  - `POST/PUT /shift-types`의 `color` 입력 validation을 `#AARRGGBB` 형식으로 고정
  - 개인/친구 캘린더 이벤트 기간 조회를 `start_at < end_date + 1 day` AND `end_at > start_date` overlap 조건으로 통일
  - `/api` 응답에 `Cache-Control: private, no-store`, `Vary: Authorization` 헤더 추가
  - API 계약을 프로젝트 컨텍스트/친구 API 가이드/ADR에 반영
- **영향범위**:
  - 캘린더/근무표 API 응답
  - 친구 캘린더 응답
  - 인증 API 캐시 헤더
- **파일**:
  - `src/services/calendarService.ts`
  - `src/controllers/calendarController.ts`
  - `src/routes/calendarRoutes.ts`
  - `src/services/friendService.ts`
  - `src/index.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/FRIEND_API_GUIDE.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - 코드 확인: 개인 캘린더/근무표 조회는 JWT 현재 사용자 `owner_user_id` 조건 사용
  - 코드 확인: 삭제는 `work_shift_id`와 현재 사용자 `owner_user_id` 조건으로 soft delete
- **롤백**:
  - 이번 작업에서 수정한 코드/문서 변경을 이전 상태로 되돌리기
- **다음**:
  - FE 연동 환경에서 계정 전환 색상 표시 확인
  - 실제 access token과 A/B 계정 fixture로 `/api/v1/calendar/range` 색상/시간 응답 확인

## 2026-07-06

### [DONE] 친구 캘린더 기간 조회 API 구현

- **목적**: 친구 목록에서 선택한 친구의 읽기 전용 캘린더 데이터를 `can_view`와 `friend_level` 기준으로 필터링해 반환
- **변경**:
  - `GET /api/v1/friends/:friend_user_id/calendar/range` 라우트 추가
  - `friend_user_id`, `start_date`, `end_date` 검증 추가
  - 친구 관계 확인 후 친구가 조회자에게 설정한 `friend_level_settings`의 `can_view`를 확인
  - `v_visible_work_shifts_for_friend`, `v_visible_events_for_friend` 뷰 기준으로 공개 조건을 통과한 근무표/개인 일정만 조회
  - 근무표 응답에 근무 타입 코드/이름/색상 및 시작/종료 시간을 포함
  - 에러 코드 `FRIEND_NOT_FOUND`, `CALENDAR_ACCESS_DENIED`, `INVALID_DATE_RANGE` 추가
  - 친구 API 가이드와 프로젝트 컨텍스트에 엔드포인트/공개 규칙 반영
- **영향범위**:
  - 친구 API 라우터/컨트롤러/서비스
  - 친구 API 문서 및 프로젝트 컨텍스트
- **파일**:
  - `src/routes/friendRoutes.ts`
  - `src/controllers/friendController.ts`
  - `src/services/friendService.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/FRIEND_API_GUIDE.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
- **롤백**:
  - 이번 작업에서 추가한 친구 캘린더 라우트/컨트롤러/서비스 함수와 문서 변경을 되돌리기
- **다음**:
  - 실제 access token과 친구/공개 설정 fixture로 정상 조회, `can_view=false`, 날짜 오류 케이스 API 호출 검증

## 2026-07-05

### [DONE] 전화번호 저장 형식 및 DB 제약 강화

- **목적**: 사용자 전화번호를 중복 불가로 유지하면서 `000-000-0000` 또는 `000-0000-0000` 형식으로만 저장/검색되도록 강제
- **변경**:
  - 신규 `src/utils/phone.ts`에서 전화번호 검증/정규화 공통화
  - 프로필 수정 요청에서 10~11자리 숫자 또는 하이픈 형식 전화번호만 허용하고 저장 전 하이픈 형식으로 정규화
  - 프로필 저장 전 동일 전화번호 사용자 존재 여부를 확인해 `PHONE_ALREADY_EXISTS`로 거절
  - `User` 모델에 전화번호 형식 validation 추가
  - 친구 검색에서 전화번호 검색어를 저장 형식으로 정규화한 뒤 `users.phone` 조회
  - `users.phone` DB CHECK 제약을 `final_schema.sql`, `add_phone_and_notifications.sql`, `enforce_users_phone_format.sql`에 반영
  - 전화번호 저장 정책 ADR 추가
- **파일**:
  - `src/utils/phone.ts`
  - `src/routes/authRoutes.ts`
  - `src/controllers/authController.ts`
  - `src/models/User.ts`
  - `src/services/friendService.ts`
  - `migrations/final_schema.sql`
  - `migrations/add_phone_and_notifications.sql`
  - `migrations/enforce_users_phone_format.sql`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/FRIEND_API_GUIDE.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - `dist/utils/phone.normalizePhoneNumber()` 수동 확인:
    - `0101234567` → `010-123-4567`
    - `01012345678` → `010-1234-5678`
    - `010-123-4567` → `010-123-4567`
    - `010-1234-5678` → `010-1234-5678`
    - `+821012345678` → `null`
    - `010-12-3456` → `null`
    - `010-12-345678` → `null`
- **롤백**:
  - 코드 롤백: 이번 작업에서 수정/추가한 파일을 이전 상태로 되돌리기
  - DB 롤백: `ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_phone_format;`
- **다음**:
  - 기존 DB에 `migrations/enforce_users_phone_format.sql` 적용 전 invalid phone 조회 쿼리 실행

### [DONE] 사용자 검색 이메일/전화번호 형식 분기 강화

- **목적**: `GET /api/v1/users/search?query=...`에서 이메일 형식은 `users.email`, 전화번호 형식은 `users.phone`으로만 검색하고 그 외 입력은 거절
- **변경**:
  - `friendService.getUserSearchField()` 추가로 검색어 타입을 `email`/`phone`/invalid로 명시 판정
  - 이메일 형식은 `users.email`, 전화번호 형식은 `users.phone` 조건으로 `User.findOne()` 조회
  - 이메일/전화번호 형식이 아니면 컨트롤러와 서비스에서 `INVALID_QUERY`로 거절
  - 친구 API 문서와 프로젝트 컨텍스트에 사용자 검색 입력 규칙 반영
- **파일**:
  - `src/controllers/friendController.ts`
  - `src/services/friendService.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/FRIEND_API_GUIDE.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
- **롤백**:
  - 이번 작업에서 수정한 파일을 이전 상태로 되돌리기
- **다음**:
  - 실제 access token으로 이메일/전화번호/invalid query 케이스 API 호출 검증

### [DONE] TypeScript moduleResolution deprecation 대응

- **목적**: IDE에서 표시되는 `moduleResolution=node10` deprecation 진단을 현재 빌드와 호환되는 방식으로 해소
- **변경**:
  - `tsconfig.json`의 `moduleResolution`을 deprecated alias인 `node`에서 `node16`으로 변경
  - TypeScript 요구사항에 맞춰 `module`을 `commonjs`에서 `Node16`으로 변경
  - `ignoreDeprecations: "6.0"`은 현재 로컬 TypeScript `5.9.3`에서 유효하지 않아 적용하지 않음
- **파일**:
  - `tsconfig.json`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `node -p "require('typescript').version"` 결과 `5.9.3`
  - `npm run build` 성공
  - `dist/index.js`가 기존과 같은 CommonJS 출력(`require`, `exports`) 형태임을 확인
- **롤백**:
  - `tsconfig.json`의 `module`을 `commonjs`, `moduleResolution`을 `node`로 되돌리기
- **다음**:
  - TypeScript 6.x 이상으로 업그레이드할 때 `ignoreDeprecations` 임시 설정이 필요한지 재검토

### [DONE] auth 카카오/프로필 디버깅 중단점 설정 및 정적 분석

- **목적**: `/api/v1/auth/kakao`, `/api/v1/auth/kakao/token`, `/api/v1/auth/profile` 흐름을 DebugMCP 중단점과 코드 기반 정적 분석으로 확인
- **변경**:
  - DebugMCP에서 VS Code launch 구성 `Debug npm run dev`로 디버그 세션 시작
  - 인증/프로필/카카오 OAuth 흐름 주요 경계에 중단점 9개 설정
  - `/auth/profile` 요청이 `src/middlewares/auth.ts`의 JWT 인증 미들웨어 중단점에 도달하는 것 확인
  - 정적 분석으로 라우트, 컨트롤러, 카카오 서비스, JWT 토큰 발급 흐름 확인
- **파일**:
  - `src/routes/authRoutes.ts`
  - `src/controllers/authController.ts`
  - `src/services/kakaoService.ts`
  - `src/middlewares/auth.ts`
  - `src/services/authService.ts`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - DebugMCP `start_debugging` 성공: `Debug npm run dev` 구성 사용, `authMiddleware` 21라인에서 중단 확인
  - `POST /api/v1/auth/kakao/token` 런타임 확인:
    - 카카오 사용자 정보 API 응답 200 확인
    - `kakao_account.email` 추출 성공
    - `kakao_id` 기준 기존 사용자 없음
    - 이메일 기준 기존 사용자 없음
    - 신규 `users` 생성 성공
    - `ensureDefaultTemplate(user.user_id)` 성공
    - `.env`의 `JWT_SECRET`, `JWT_REFRESH_SECRET` 사용 확인
    - `refresh_tokens` 저장 성공
    - `res.json({ success: true, ... })` 응답 전송 지점까지 예외 없이 도달
- **롤백**:
  - DebugMCP 중단점은 `clear_all_breakpoints`로 제거
  - `_docs/WORKLOG.md`의 이번 작업 항목 되돌리기
- **다음**:
  - 발급된 access token으로 `GET /api/v1/auth/profile`을 호출해 `authMiddleware`의 JWT 검증 및 `getProfile` 응답 확인
  - 필요 시 authorization code 방식 `POST /api/v1/auth/kakao`도 별도 재현

### [DONE] 헬스 체크 공개 라우트 순서 수정

- **목적**: `GET /api/v1/health`가 인증 토큰 없이 서버 상태를 확인할 수 있도록 라우터 등록 순서 수정
- **변경**:
  - `src/routes/index.ts`에서 health 라우트를 인증 미들웨어가 적용된 `calendarRoutes`, `friendRoutes`, `scheduleRoutes`보다 먼저 등록
  - 기존 인증 필요 API의 인증 정책은 유지
- **파일**:
  - `src/routes/index.ts`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `npm run build` 성공
  - `curl -i http://localhost:3000/api/v1/health` 결과 `HTTP/1.1 200 OK` 확인
- **롤백**:
  - `src/routes/index.ts`의 health 라우트 위치를 이전 순서로 되돌리기
- **다음**:
  - Flutter/외부 클라이언트에서 동일 URL로 헬스 체크 확인

### [DONE] 최종 DB DDL 실행 파일화

- **목적**: `AGENTS.md`에 문서화된 shift_calendar 최종 PostgreSQL DDL을 로컬 Docker PostgreSQL에서 바로 실행 가능한 SQL 파일로 정리
- **변경**:
  - 신규: `migrations/final_schema.sql`
    - `AGENTS.md`의 FINAL SCHEMA를 실행 가능한 PostgreSQL SQL 파일로 정리
    - 문서용으로 깨져 있던 주석 표기와 마지막 불필요한 `$$`를 제거
    - `\set ON_ERROR_STOP on` 추가로 DDL 실패 시 즉시 중단
  - 수정: `_docs/PROJECT_CONTEXT.md`
    - Docker PostgreSQL 초기화 절차 추가
    - `migrations/final_schema.sql` 파일 역할/의존성/사용 예 추가
    - 로컬 `.env` 예시를 Docker DB 기준으로 갱신
- **파일**:
  - `migrations/final_schema.sql`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - `docker exec -i shift-calendar-postgres psql -U postgres -d shift_calendar < migrations/final_schema.sql` 성공
  - 생성 객체 확인: `users`, `events`, `work_shifts` 등 12개 테이블 + `v_visible_events_for_friend`, `v_visible_work_shifts_for_friend` 2개 뷰
  - `npm run build` 성공
- **롤백**:
  - 파일 변경 롤백: `migrations/final_schema.sql`, `_docs/PROJECT_CONTEXT.md`, `_docs/WORKLOG.md` 되돌리기
  - DB 롤백: 로컬 Docker DB를 다시 초기화하거나 `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;` 후 필요한 이전 스키마 재적용
- **다음**:
  - `.env`가 Docker DB(`DB_HOST=localhost`, `DB_PASSWORD=postgres`, `DB_SSL=false`)를 바라보는지 확인 후 `npm run dev` 실행

## 2026-01-11

### [DONE] 프로필 수정 API 구현 (POST 방식)

- **목적**: 사용자 프로필 수정 API를 POST 방식으로 구현. GET/POST 중심의 API 설계로 전환
- **변경**:
  - `src/controllers/authController.ts`: `updateProfile()` 함수 추가
    - 선택적 필드만 수정 가능 (name, timezone, profile_image_url, phone)
    - JWT 토큰으로 사용자 식별 (Body에 user_id 불필요)
  - `src/routes/authRoutes.ts`: `POST /api/v1/auth/profile` 라우트 추가
    - 인증 미들웨어 적용
    - express-validator로 선택적 필드 validation
  - `_docs/PROJECT_CONTEXT.md`: API 스펙 업데이트
- **파일**:
  - `src/controllers/authController.ts`
  - `src/routes/authRoutes.ts`
  - `_docs/PROJECT_CONTEXT.md`
- **API 엔드포인트**:
  - `POST /api/v1/auth/profile` - 내 정보 수정 (인증 필요)
- **요청 형식**:
  ```json
  {
    "name": "새 이름", // 선택적
    "timezone": "Asia/Seoul", // 선택적
    "profile_image_url": "...", // 선택적
    "phone": "+821012345678" // 선택적
  }
  ```
- **응답 형식**:
  ```json
  {
    "success": true,
    "message": "프로필이 수정되었습니다.",
    "data": {
      "user_id": "...",
      "email": "...",
      "name": "...",
      ...
    }
  }
  ```
- **테스트**: 린터 에러 없음 확인
- **롤백**: 변경된 파일들을 이전 커밋으로 되돌리기
- **다음**: 실제 API 테스트 및 클라이언트 연동

## 2026-01-11

### [DONE] 배포 가이드 및 스크립트 작성

- **목적**: 서버 배포 시 필요한 절차 및 인증 토큰 오류 해결 가이드 제공
- **변경**:
  - 신규: `_docs/DEPLOYMENT_GUIDE.md` - 서버 배포 가이드 문서
  - 신규: `deploy.sh` - 자동 배포 스크립트
- **파일**:
  - `_docs/DEPLOYMENT_GUIDE.md`
  - `deploy.sh`
- **내용**:
  - 배포 전 체크리스트 (환경변수 확인)
  - 배포 절차 (git pull, npm install, build, migrate, restart)
  - 인증 토큰 오류 해결 방법
  - PM2 프로세스 관리
  - 트러블슈팅 가이드
- **테스트**: 배포 스크립트 실행 권한 부여 완료
- **다음**: 실제 배포 환경에서 테스트

### [DONE] OAuth API 가이드 문서 작성

- **목적**: 네이버/카카오 OAuth 로그인 API 사용 가이드 제공
- **변경**:
  - 신규: `_docs/OAUTH_API_GUIDE.md` - OAuth 소셜 로그인 API 가이드 문서
- **파일**:
  - `_docs/OAUTH_API_GUIDE.md`
- **내용**:
  - 네이버 OAuth 로그인 API (WebView/SDK 방식)
  - 카카오 OAuth 로그인 API (WebView/SDK 방식)
  - 요청/응답 형식, 에러 코드, 사용 예시
  - 테스트 페이지 사용 방법
  - 환경변수 설정, 주의사항, FAQ
- **테스트**: 문서 검토 완료
- **다음**: 실제 API 테스트 및 피드백 반영

### [DONE] 네이버 OAuth 2.0 소셜 로그인 추가

- **목적**: 네이버 계정을 통한 소셜 로그인 지원
- **변경**:
  - DB: users 테이블에 naver_id 컬럼 추가 (마이그레이션)
  - 신규: `src/services/naverService.ts` - 네이버 OAuth 처리 (토큰 교환 + 사용자 정보 조회)
  - 수정: `src/controllers/authController.ts` - naverLogin, naverLoginWithToken 함수 추가
  - 수정: `src/routes/authRoutes.ts` - 네이버 OAuth 라우트 추가
  - 수정: `src/models/User.ts` - naver_id 필드 추가
  - 문서: `_docs/PROJECT_CONTEXT.md`, `_docs/WORKLOG.md` 업데이트
- **파일**:
  - `migrations/add_naver_id_to_users.sql`
  - `src/services/naverService.ts`
  - `src/controllers/authController.ts`
  - `src/routes/authRoutes.ts`
  - `src/models/User.ts`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/WORKLOG.md`
- **API 엔드포인트**:
  - `POST /api/v1/auth/naver` - 네이버 OAuth 로그인 (WebView 방식 - authorization code)
  - `POST /api/v1/auth/naver/token` - 네이버 OAuth 로그인 (SDK 방식 - access_token 직접 전송)
- **환경변수**:
  - `NAVER_CLIENT_ID`: 네이버 OAuth Client ID
  - `NAVER_CLIENT_SECRET`: 네이버 OAuth Client Secret
- **테스트**: Postman 또는 테스트 HTML 페이지로 두 가지 방식 모두 검증 필요
- **롤백**: 마이그레이션 롤백 SQL (`ALTER TABLE users DROP COLUMN naver_id;`) + 코드 되돌리기
- **다음**: 테스트 페이지 작성 (선택), 실제 네이버 개발자 센터 설정 확인

## 2026-01-04

### [DONE] 친구 관리 API 구현

- **목적**: 친구 관리 기능의 백엔드 API 구현 (친구 목록, 친구 요청, 알림 등)
- **변경**:
  - `migrations/add_phone_and_notifications.sql`: DDL 마이그레이션 파일 추가
    - users 테이블에 phone 컬럼 추가
    - notifications 테이블 생성 (동적 액션 지원, notification_type 제약 없음)
  - `src/models/User.ts`: phone 필드 추가
  - `src/models/FriendRequest.ts`: 친구 요청 모델 생성
  - `src/models/Friendship.ts`: 친구 관계 모델 생성
  - `src/models/FriendLevelSetting.ts`: 친구 레벨 설정 모델 생성
  - `src/models/Notification.ts`: 알림 모델 생성 (동적 액션 지원, 타입 확장 가능)
  - `src/models/index.ts`: 새 모델 export 추가
  - `src/services/friendService.ts`: 친구 관련 비즈니스 로직
    - getFriends(): 친구 목록 조회
    - searchUser(): 사용자 검색 (이메일/전화번호)
    - sendFriendRequest(): 친구 요청 보내기
    - getReceivedRequests(): 받은 요청 목록
    - getSentRequests(): 보낸 요청 목록
    - respondToFriendRequest(): 요청 수락/거절
    - cancelFriendRequest(): 요청 취소
    - updateFriendSettings(): 친구 레벨 설정 변경
    - deleteFriend(): 친구 삭제
    - getNotifications(): 알림 목록 조회 (조회 시 자동 읽음 처리)
    - getUnreadNotificationCount(): 미읽음 알림 개수 조회 (읽음 처리 없음)
  - `src/controllers/friendController.ts`: 친구 관련 컨트롤러
  - `src/routes/friendRoutes.ts`: 친구 관련 라우트
  - `src/routes/index.ts`: friendRoutes 등록
  - `AGENTS.md`: notifications 테이블 스키마 추가
  - `_docs/FRIEND_API_GUIDE.md`: API 가이드 문서 생성
- **파일**:
  - `migrations/add_phone_and_notifications.sql`
  - `src/models/User.ts`
  - `src/models/FriendRequest.ts`
  - `src/models/Friendship.ts`
  - `src/models/FriendLevelSetting.ts`
  - `src/models/Notification.ts`
  - `src/models/index.ts`
  - `src/services/friendService.ts`
  - `src/controllers/friendController.ts`
  - `src/routes/friendRoutes.ts`
  - `src/routes/index.ts`
  - `AGENTS.md`
  - `_docs/FRIEND_API_GUIDE.md`
- **API 엔드포인트**:
  - `GET /api/v1/friends` - 친구 목록 조회
  - `PUT /api/v1/friends/:friend_user_id/settings` - 친구 레벨 설정 변경
  - `DELETE /api/v1/friends/:friend_user_id` - 친구 삭제
  - `GET /api/v1/users/search` - 사용자 검색
  - `POST /api/v1/friend-requests` - 친구 요청 보내기
  - `GET /api/v1/friend-requests/received` - 받은 요청 목록
  - `GET /api/v1/friend-requests/sent` - 보낸 요청 목록
  - `PUT /api/v1/friend-requests/:request_id/respond` - 요청 응답
  - `PUT /api/v1/friend-requests/:request_id/cancel` - 요청 취소
  - `GET /api/v1/notifications` - 알림 목록 조회 (자동 읽음 처리)
  - `GET /api/v1/notifications/unread-count` - 미읽음 알림 개수 조회
- **테스트**:
  - 린터 에러 없음 확인
  - DB 마이그레이션 필요: `migrations/add_phone_and_notifications.sql` 실행
- **롤백**:
  - 변경된 파일들을 이전 커밋으로 되돌리기
  - DB 롤백: notifications 테이블 삭제, users.phone 컬럼 삭제
- **다음**:
  - DB 마이그레이션 실행
  - 실제 API 테스트
  - 푸시 알림 연동 (추후)

---

### [DONE] 일정 삭제 API 구현

- **목적**: 일정(Event)을 삭제할 수 있는 API 엔드포인트 추가. 일정의 UUID를 전달받아 하나씩 삭제 가능하도록 구현
- **변경**:
  - `src/services/calendarService.ts`:
    - `deleteEvent(user_id, event_id)` 함수 추가
    - Soft delete 방식으로 `deleted_at`, `deleted_by_user_id` 설정
    - 본인 일정만 삭제 가능하도록 `owner_user_id` 검증
    - 이미 삭제된 일정(`deleted_at IS NOT NULL`)은 삭제 불가
  - `src/controllers/calendarController.ts`:
    - `deleteEvent(req, res)` 컨트롤러 함수 추가
    - `EVENT_NOT_FOUND` 에러 처리 (404 응답)
    - 성공 시 삭제된 `event_id` 반환
  - `src/routes/calendarRoutes.ts`:
    - `DELETE /api/v1/events/:event_id` 라우트 추가
    - 인증 미들웨어 자동 적용 (모든 라우트에 적용됨)
- **파일**:
  - `src/services/calendarService.ts`
  - `src/controllers/calendarController.ts`
  - `src/routes/calendarRoutes.ts`
- **테스트**:
  - 린터 에러 없음 확인
  - 실제 API 테스트는 클라이언트 구현 후 진행 예정
- **롤백**:
  - 변경된 파일들을 이전 커밋으로 되돌리기
- **다음**:
  - 실제 API 테스트로 동작 확인
  - 일정 생성/수정 API 구현 검토

---

## 2026-01-04

### [DONE] shift_type 생성 시 시간 정보 없어도 스케줄 생성하도록 수정

- **목적**: 시간 정보 없이 shift_type을 생성해도 work_shift 생성 시 `SCHEDULE_NOT_FOUND` 에러가 발생하지 않도록 수정
- **변경**:
  - `src/services/shiftTemplateService.ts`:
    - `createShiftType()` 함수에서 시간 정보가 없어도 기본 스케줄(`ShiftTypeSchedule`)을 생성하도록 수정
    - 시간 정보가 없으면 `start_time: null`, `end_time: null`, `crosses_midnight: false`, `duration_minutes: 0`으로 스케줄 생성
    - work_shift 생성 시 `schedule_id`가 필수이므로 항상 스케줄을 생성해야 함
  - `src/services/calendarService.ts`:
    - `batchUpsertWorkShifts()` 함수에서 스케줄이 없을 때 자동으로 기본 스케줄을 생성하도록 수정 (기존에 생성된 shift_type 대응)
    - `upsertWorkShift()` 함수에서도 동일하게 수정
    - `updateWorkShift()` 함수에서도 동일하게 수정
    - 이미 생성된 shift_type에 스케줄이 없어도 work_shift 생성/수정이 가능하도록 보완
- **파일**:
  - `src/services/shiftTemplateService.ts`
  - `src/services/calendarService.ts`
- **테스트**:
  - 린터 에러 없음 확인
  - 시간 정보 없이 shift_type 생성 후 work_shift 생성 테스트 필요
  - 기존에 생성된 shift_type으로 work_shift 생성 테스트 필요
- **롤백**:
  - 변경된 파일을 이전 커밋으로 되돌리기
- **다음**:
  - 실제 API 테스트로 동작 확인
  - 시간 정보 없이 생성한 shift_type으로 work_shift 생성 테스트

---

### [DONE] 근무 템플릿당 최대 10개 shift_type 제한 검증 로직 추가

- **목적**: 한 템플릿에 최대 10개까지의 근무 타입만 추가할 수 있도록 서버 측 검증 로직 추가
- **변경**:
  - `src/services/shiftTemplateService.ts`:
    - `MAX_SHIFT_TYPES_PER_TEMPLATE = 10` 상수 추가
    - `createShiftType()` 함수에서 shift_type 생성 전에 현재 템플릿의 shift_types 개수 확인
    - 10개 이상이면 `MAX_SHIFT_TYPES_EXCEEDED` 에러 발생
  - `src/controllers/calendarController.ts`:
    - `createShiftType()` 컨트롤러에서 `MAX_SHIFT_TYPES_EXCEEDED` 에러 처리 추가 (400 응답)
- **파일**:
  - `src/services/shiftTemplateService.ts`
  - `src/controllers/calendarController.ts`
- **테스트**:
  - 린터 에러 없음 확인
  - 실제 API 테스트는 클라이언트 구현 후 진행 예정
- **롤백**:
  - 변경된 파일들을 이전 커밋으로 되돌리기
- **다음**:
  - 클라이언트에서 10개 제한 시 UI 처리 (버튼 비활성화 등)
  - API 통합 테스트

---

## 2026-01-04

### [DONE] shift_types 코드 중복 제한 제거

- **목적**: 같은 템플릿 내에서 동일한 code를 가진 근무 타입을 여러 개 생성할 수 있도록 허용
- **변경**:
  - `src/services/shiftTemplateService.ts`: 코드 중복 체크 로직 제거
  - `src/models/ShiftType.ts`: Sequelize 모델의 unique 인덱스 제거 (`template_id`, `code` 조합)
  - `src/controllers/calendarController.ts`: `DUPLICATE_CODE` 에러 처리 제거
  - `migrations/remove_shift_types_unique_constraint.sql`: DB unique constraint 제거 마이그레이션 SQL 추가
- **파일**:
  - `src/services/shiftTemplateService.ts`
  - `src/models/ShiftType.ts`
  - `src/controllers/calendarController.ts`
  - `migrations/remove_shift_types_unique_constraint.sql`
- **테스트**:
  - 린터 에러 없음 확인
  - DB 마이그레이션 필요: `migrations/remove_shift_types_unique_constraint.sql` 실행 필요
- **롤백**:
  - 코드 변경 사항 되돌리기
  - DB에 unique constraint 재생성: `ALTER TABLE shift_types ADD CONSTRAINT uq_shift_types_code UNIQUE (template_id, code);`
- **다음**:
  - DB 마이그레이션 실행
  - 동일한 code로 여러 근무 타입 생성 테스트

---

## 2025-01-XX (최근 작업)

### [DONE] 개인별 근무 세팅 페이지 API 구현

- **목적**: 사용자가 자신의 근무 템플릿과 근무 타입을 관리할 수 있는 설정 페이지를 위한 서버 API 구현
- **변경**:
  - `src/services/shiftTemplateService.ts`: 새로운 서비스 함수 추가
    - `getCurrentTemplate()`: 현재 사용자의 활성 템플릿 조회
    - `updateTemplateName()`: 템플릿 이름 변경
    - `createShiftType()`: 근무 타입 추가 (시간 계산 로직 포함)
    - `updateShiftType()`: 근무 타입 수정 (시간 스케줄 업데이트)
    - `deleteShiftType()`: 근무 타입 삭제 (Soft Delete, 사용 중 체크)
    - `calculateTimeInfo()`: 시간 계산 유틸리티 (crosses_midnight, duration_minutes)
    - `getCurrentVersion()`: 현재 활성 버전 조회 헬퍼 함수
  - `src/controllers/calendarController.ts`: 새로운 컨트롤러 함수 추가
    - `getCurrentTemplate()`: GET `/api/v1/shift-templates/current`
    - `updateCurrentTemplate()`: PUT `/api/v1/shift-templates/current`
    - `createShiftType()`: POST `/api/v1/shift-types`
    - `updateShiftType()`: PUT `/api/v1/shift-types/:shift_type_id`
    - `deleteShiftType()`: DELETE `/api/v1/shift-types/:shift_type_id`
  - `src/routes/calendarRoutes.ts`: 새로운 라우트 등록
    - 템플릿 조회/수정 라우트
    - 근무 타입 CRUD 라우트
    - Validation 미들웨어 적용
- **파일**:
  - `src/services/shiftTemplateService.ts`
  - `src/controllers/calendarController.ts`
  - `src/routes/calendarRoutes.ts`
- **테스트**:
  - 린터 에러 수정 완료
  - 타입 에러 수정 완료
  - 실제 API 테스트는 클라이언트 구현 후 진행 예정
- **롤백**:
  - 변경된 파일들을 이전 커밋으로 되돌리기
  - 또는 각 함수를 주석 처리
- **다음**:
  - 클라이언트 구현 (Flutter)
  - API 통합 테스트
  - 에러 케이스 추가 테스트

---

## 2025-01-XX (최근 작업)

### [DONE] Express 백엔드 문서화

- **목적**: 프로젝트 구조와 아키텍처를 문서화하여 유지보수성 향상
- **변경**:
  - `_docs/PROJECT_CONTEXT.md`: Express 백엔드 상세 문서 작성
    - 요청 처리 흐름
    - 에러 처리 규칙
    - Validation 규칙
    - 인증/인가
    - DB 접근 규칙
    - API 스펙
    - 로깅/모니터링
    - 환경변수 표
  - `_docs/DECISIONS.md`: 아키텍처 결정 기록 (ADR) 작성
    - ADR-0001: Express + Sequelize + PostgreSQL 스택 선택
    - ADR-0002: JWT 기반 인증 + Refresh Token Rotation
    - ADR-0003: express-validator를 사용한 요청 검증
    - ADR-0004: Controller-Service-Model 계층 구조
    - ADR-0005: Sequelize 트랜잭션 사용
    - ADR-0006: Refresh Token을 DB에 해시값으로 저장
    - ADR-0007: 카카오 OAuth 2가지 방식 지원
    - ADR-0008: 근무 템플릿 버전 관리 시스템
    - ADR-0009: Global Error Handler 사용
    - ADR-0010: Soft Delete 사용
  - `_docs/WORKLOG.md`: 작업 일지 템플릿 작성
- **파일**:
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**: 문서 내용 검증 (코드베이스와 일치 확인)
- **롤백**: 문서 삭제 또는 이전 버전으로 복원
- **다음**:
  - Swagger/OpenAPI 문서화 추가
  - 단위 테스트 작성
  - 에러 로깅 중앙화 (Winston 등)

---

## 작업 템플릿

### [TODO] 작업 제목

- **목적**: 왜 이 작업을 하는지
- **변경**: 무엇을 변경했는지
- **파일**: 변경된 파일 목록
- **테스트**: 무엇을 테스트했는지
- **롤백**: 어떻게 되돌릴지
- **다음**: 다음 단계 작업

### [IN_PROGRESS] 작업 제목

- **목적**: ...
- **변경**: ...
- **파일**: ...
- **테스트**: ...
- **롤백**: ...
- **다음**: ...

### [DONE] 작업 제목

- **목적**: ...
- **변경**: ...
- **파일**: ...
- **테스트**: ...
- **롤백**: ...
- **다음**: ...

---

## 작업 규칙

1. **작업 시작 시**: `[TODO]` 상태로 항목 생성
2. **작업 중**: `[IN_PROGRESS]` 상태로 변경
3. **작업 완료**: `[DONE]` 상태로 변경 및 결과 기록
4. **날짜별 섹션**: 최근 작업이 위에 오도록 정렬
5. **상세 기록**: 목적, 변경, 파일, 테스트, 롤백, 다음 단계 모두 기록

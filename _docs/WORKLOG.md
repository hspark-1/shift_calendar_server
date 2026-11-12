## merge test

# 작업 일지

## 2026-11-13

### [TODO] Google 로그인 커밋·푸시와 develop 병합 배포

- 목적: 사용자 요청에 따라 검증한 Google 변경을 커밋/푸시하고, develop을 비공개 main에 실제 병합한 뒤 서버를 배포한다. 이후 배포도 선별 cherry-pick 대신 develop→main 병합을 기본으로 한다.
- 변경/영향: Google 관련 변경과 의존 관계만 확인해 커밋하고 기존 다른 미커밋 작업은 보존한다. 공개 develop의 민감정보 제외·배포용 main의 비공개 설정을 유지한다. Flutter 변경도 관련 범위만 커밋/푸시한다.
- 검증: 원격/병합 이력과 전체 배포 대상 차이·운영 DB 기존 제약을 읽기 전용 확인하고, 병합 결과 테스트/CI·Stage/운영 readiness·OpenAPI를 확인한다. Google 자체에는 신규 migration이 없으나 병합에 따라오는 기존 변경의 DB 영향은 별도로 확인한다.
- 롤백: 검증된 직전 서버 이미지/배포 커밋으로 복구하며 사용자 phone/기존 사진과 기존 미커밋 작업을 보존한다.
- 사전 확인: 원격 최신 상태·전체 병합 차이를 확인했다. Stage/운영에 읽기 전용으로 phone 컬럼/unique·events1~5 CHECK/default1·레벨0/범위 밖0건을 확인해 이번 병합에는 신규 SQL 실행이 필요 없다. Google 변경만 별도 작업 트리에 구성하고 다른 네이버/그룹 미커밋 변경은 제외했다. 검증 뒤 develop을 main에 실제 merge하며 실행 식별자/로그는 비공개 배포 기록에서 관리한다.

### [DONE] Google 사진 수집 중단·전화번호 선택 동의 연동

- 목적: 승인된 Google 동의 범위에 맞춰 사진을 신규 수집하지 않고 전화번호를 가입 정보에 제공한다.
- 변경/영향: Google 로그인 API의 선택 access_token·동일 계정 검증·People API 조회·신규/빈 번호 저장과 Flutter SDK/전송/가입 미리 채움을 구현한다. 번호 미제공/동의 거부는 기존 직접 입력으로 진행한다. 기존 미커밋 작업과 기존 번호·사진·가입 완료 상태를 보존한다.
- 변경 결과: 기존 Google endpoint의 선택 access_token·서버 userinfo.sub 대조/People API PROFILE phoneNumbers·국내01x/+82 정규화·신규/빈 번호만 원자 저장·전화번호 중복/탈퇴 진행409를 구현했다. picture는 읽지 않고 신규 사진은 null이다. 기존 번호/사진/key/프로필 완료·구형 ID Token 전용 앱을 보존하며 body phone은 무시한다. OAuth token은 저장/로그하지 않는다.
- 파일: src/services/googleService.ts·src/routes/authRoutes.ts·src/controllers/authController.ts·src/openapi/googleAuthOpenApi.json·test/googleAuth.test.cjs·test/googleAuthIntegration.test.cjs·기존 Google fixture와 GOOGLE_SIGN_IN_SERVER_GUIDE/OAUTH_API_GUIDE/PROJECT_CONTEXT/DECISIONS(ADR-0049)/WORKLOG. 기존 controller/문서의 네이버 등 미커밋 변경은 보존했다. 신규 영구 파일/패키지/env/운영 migration은 없다.
- 서버 검증: strict TypeScript build 통과. Google16개 포함 인증/프로필 단위·계약49 pass/0 fail/기존 비공개 배포 SQL1 skip. 새 폐기용 PostgreSQL16에서 실제 Express HTTP·신규/기존 번호·기존 이미지/key·완료 상태 보존·token 계정 불일치401·선택 token validation400·조회 실패 직접 입력·중복409·동일 번호 경합·신규/기존 갱신 rollback·탈퇴 진행409 등16 pass/0 fail. Google 외부 API만 mock이며 실제 Google 계정은 사용하지 않았다.
- Flutter 검증: 인접 프로젝트 SDK/Repository/DataSource와 기존 관련 테스트·가입 위젯을 직접 수정했다. 선택 동의 실패 fallback·앱 JWT 저장/실패 정리·phone 파싱·가입 미리 채움/사진 null·로그아웃/탈퇴 포함 인증 전체117 pass/0 fail. Dart7개 analyze 진단0·format 변경0·범위 diff 공백 검사 통과. 문서/ADR-0081/WORKLOG도 갱신했다.
- 검증 중 보완: 서버 확장 HTTP 테스트가 기존 인증 제한10회를 넘겨429가 된 것을 실제 rateLimit 코드와 응답으로 확인하고 테스트 프로세스만200회로 설정했다. Flutter 신규 아바타 검증은 화면 전체 같은 아이콘2개를 세던 테스트를 실제 아바타 하위로 제한해 해결했다. 운영 rate limit·제품 UI는 변경하지 않았다. 최종 OpenAPI JSON·CJS 구문·문서 diff를 확인한다.
- 롤백: 이번 Google 코드/문서 변경만 복구하며 이미 저장한 phone과 기존 이미지는 유지한다.
- 결과/다음: 서버와 Flutter 로컬 구현·회귀·문서화를 완료했다. 사용자의 콘솔 화면에서는 phone scope가 비민감 범위에 등록되어 있음을 확인했으며 People API 활성화/실계정 동의·번호 수신·실기기/배포는 미검증이다. 서버 선배포 후 앱 재빌드/설치와 Stage iOS/Android 인수가 필요하다. 운영 DB/사용자 데이터/설정·커밋/푸시/배포는 수행하지 않았다. 상세 사용 예·배포/롤백은 Google 서버 가이드 상단을 따른다.

### [DONE] Google 소셜 로그인 수집 정보와 콘솔 확인 경로 조사

- 목적: 문서·실제 코드의 Google 제공 정보와 개발자 콘솔 설정 확인 범위를 구분한다.
- 변경/영향범위: 읽기 전용 조사 후 Google 서버 가이드와 이 작업 일지만 보완한다. 제품 코드·DB·OAuth 설정은 변경하지 않는다.
- 확인: 서버 Google 가이드·ADR-0024·서비스와 인접 Flutter Google 가이드·SDK 호출을 대조하고 Google 공식 문서에서 Data Access 경로를 확인한다.
- 결과: 검증된 sub/email/name/picture의 신규 저장과 email_verified 검증, 기존 프로필 자동 갱신 없음·Google 전화번호 수집 없음·앱 추가 권한 요청 없음을 코드로 확인했다. 콘솔 실제 등록 목록은 미조회이며 기본 OIDC 정책과 구분해 가이드에 명시했다.
- 파일: `_docs/GOOGLE_SIGN_IN_SERVER_GUIDE.md`, `_docs/WORKLOG.md`. 기존 Google 가이드의 수집 항목·확인 경로만 보완하며 설계/정책 변경이 없어 ADR 추가는 없다.
- 테스트: 서버 서비스/route/controller·인접 Flutter SDK 호출과 가이드·ADR-0024·schema.drawio/공개 흐름을 대조했다. Google 공식 문서의 Data Access 경로와 OIDC claim 의미를 확인했다. 문서 diff 공백 검사를 수행하며 제품 코드 변경이 없어 build/실행 테스트는 하지 않는다.
- 롤백: 이번 조사로 추가한 문서 문단만 제거한다.

## 2026-11-12

### [DONE] 그룹 비친구 근무표 Stage/운영 배포

- 목적: 사용자의 후속 배포 요청에 따라 같은 그룹 비친구 근무표 공개 기능을 서버에 적용한다.
- 변경/영향: 공개30add46 그룹 기능만 기존 비공개 main에 선별 반영하고 기존 Stage→운영 자동 배포를 완료했다. 별도 개인 일정1~5/기존0 보정796f532는 포함하지 않았다. 그룹 기능에 DB migration/env/seed는 없으며 실제 사용자 데이터는 변경하지 않았다.
- 테스트: 배포용 main strict build·전체131 pass/0 fail/14 skip, 개인 일정/그룹 공개 PostgreSQL·실제 HTTP10 pass, 그룹20명/100일8 pass, monitor3개·Bash/YAML·문서 cmp·diff 검사 통과. 기존 CI의 캐시/Redis·개인 일정·Push·Apple/Google/Kakao·프로필·탈퇴/개인정보 통합·이미지 빌드·배포가 모두 성공했다. 양 환경 readiness HTTP200/success=true/cache=ready, 새 그룹 OpenAPI 정책 및 무인증 그룹 조회401을 확인했다.
- 보완 항목: 기존 변경 없는 잠금파일의 audit22건은 의존성 별도 보완으로 기록했다. 실사용자 인증 데이터 조회/생성과 Flutter 실기기 인수는 수행하지 않았다.
- 롤백: 직전 검증된 private 호환 이미지로 복구하고 DB 데이터/private 필터를 보존한다. 이번 배포는 성공해 롤백하지 않았다.
- 결과/다음: 서버 배포 완료. 세부 실행 식별자/이미지·환경별 결과는 비공개 작업 일지에서 관리한다. 이번 검증 전용 DB 컨테이너/네트워크·임시 SQL/의존성 symlink는 정리했다. 실기기 그룹 캘린더 인수는 후속이다.

### [DONE] 그룹 레벨0 근무표 변경 커밋·푸시

- 목적: 사용자 요청에 따라 검증된 그룹 비친구 근무표 공개 변경을 origin/develop에 반영한다.
- 변경/영향: 관련 소스·OpenAPI·테스트·도면·문서만 커밋한다. develop은 다른 worktree에서 사용 중이므로 현재 origin/develop 기반 codex/private-events에서 커밋하고 HEAD:develop으로 명시적으로 push한다.
- 테스트: 커밋 전 strict build·CJS 구문·OpenAPI JSON/도면 XML·diff 검사를 통과했다. fetch 후 HEAD와 origin/develop 이력 차이는0이다. 기존 구현의 관련37개 통과·전체 기존17개 실패 동일 결과를 유지하며 이번에는 DB/전체 테스트를 재실행하지 않았다.
- 롤백: 해당 기능 커밋의 그룹 조회/계약 변경을 복구한다. DB 데이터와 개인 일정 보호는 유지한다.
- 결과/다음: 기능 커밋 [30add46](https://github.com/hspark-1/shift_calendar_server/commit/30add46)을 origin/develop으로 push 완료했다(021d19c→30add46). 현재 checkout은 codex/private-events를 유지하며 결과 기록은 후속 문서 커밋으로 반영한다. Stage/운영 배포·DB 변경은 수행하지 않았다.

### [DONE] 그룹 비친구 멤버의 레벨0 근무표 열람

- 목적: 같은 그룹의 활성 멤버가 친구 관계 없이도 레벨0에 해당하는 근무표를 조회하게 한다.
- 변경/영향: 그룹 기간 캘린더의 멤버 접근 상태·근무 조회만 변경하고 개인 일정은 기존 친구/ACL/레벨/private 규칙을 유지한다. 사용자 답변에 따라 소유자→조회자 명시적 can_view=false 차단을 친구 여부와 관계없이 유지한다.
- 파일: src/services/groupService.ts·src/openapi/groupOpenApi.json·test/eventPrivacyIntegration.test.cjs·test/groupIntegration.test.cjs·schema/visibility_flow.drawio·그룹 API/프론트/실행검증 가이드·PROJECT_CONTEXT/DECISIONS(ADR-0047)/WORKLOG. 새 영구 파일은 없다.
- 변경 상세: 비친구/설정 없는 활성 멤버는 VISIBLE, 명시적 차단은 DENIED로 유지한다. 근무 SQL에서 활성 그룹·조회자/소유자 멤버십을 재확인하고 날짜/soft delete를 유지한다. 개인 일정 view·친구 API·Redis는 보존한다. 기존 그룹 통합 테스트는 migration/rollback 검증 후 현재 final_schema로 Google/Push 의존성을 준비하고 이벤트 fixture의 과거0을1로 맞췄다. 제품 schema 변경은 없다.
- 테스트: strict build·관련 서비스/인증 HTTP18 pass·격리 PostgreSQL/실제 HTTP11 pass·그룹20명/100일 통합8 pass. 비친구의 잔존 고레벨/설정 없음·차단 방향/비친구 명시적 차단·친구 삭제 후 근무만·개인 일정/private 비노출·탈퇴/제거/삭제 그룹/기간/soft delete·집계3 query를 확인했다. 초기 localhost EPERM은 허용 환경 재실행으로 해소했고 HTTP 전체 query6에는 각 router 인증3회가 포함되어 서비스 집계3회와 분리 검증했다. DebugMCP 세션이 중단점에 도달하지 못해 실제 route/auth 코드로 원인을 확인했으며 임시 진입점/중단점을 정리했다. JSON/XML·CJS 구문·diff 검사 통과. 별도 lint 명령/설정은 없다.
- 전체 회귀: 현재123개93 pass/17 fail/13 skip, 변경 전 HEAD 별도 사본도93/17/13이며 실패 이름17개가 동일해 신규 실패0개다. 기존 실패는 Apple 계약과 비공개 배포 파일 누락 관련으로 목표 밖 파일은 수정하지 않았다.
- 롤백: 그룹 조회 변경을 되돌린다. 친구 관계/설정·DB schema·개인 일정 공개 view는 변경하지 않는다.
- 결과/다음: 로컬 구현/검증·문서 갱신 완료. DB migration/env/seed는 없다. origin/develop과 동일한 HEAD에서 시작한 기존 codex/private-events checkout을 유지했다. 커밋/푸시·Stage/운영 배포·실기기 인수는 수행하지 않았다. 이번 작업 전용 DB 컨테이너/네트워크와 baseline 소스 사본은 정리 완료했다.

### [DONE] 개인 일정 공개 레벨 변경 커밋·푸시

- 목적: 사용자 요청에 따라 개인 일정 공개 레벨1~5 변경을 공개 origin/develop에 반영한다.
- 변경/영향: 현재 관련 소스·증분 SQL·OpenAPI·도면·테스트·문서만 커밋한다. develop은 다른 worktree에서 사용 중이므로 현재 codex/private-events에서 커밋하고 origin/develop으로 명시적으로 push한다.
- 테스트: 이번 커밋 전 TypeScript build·개인 일정 서비스/HTTP9개(0 fail)·OpenAPI JSON/도면 XML 파싱을 통과했다. HTTP 리스닝의 sandbox EPERM은 localhost 허용 환경 재실행으로 해소했다. fetch 후 HEAD와 origin/develop 이력 차이는0이다. diff 검사도 수행한다. 전체/격리 DB 검증은 아래 구현 작업 기록을 참조하며 이번에는 재실행하지 않았다.
- 롤백:1~5·private/ACL을 유지하는 호환 수정 커밋으로 복구하며 보정된 데이터를0으로 되돌리지 않는다.
- 결과/다음: 기능 커밋 [796f532](https://github.com/hspark-1/shift_calendar_server/commit/796f532)을 origin/develop으로 push 완료했다(880c37e→796f532). 현재 checkout은 codex/private-events를 유지한다. Stage/Center 서버 배포와 DB SQL 실행은 수행하지 않았다. 해당 환경 적용 및 실기기 인수는 후속이다.

### [DONE] 개인 일정 공개 레벨1~5 및 레벨0 근무 전용 정책

- 목적: 개인 일정0을 금지하고 레벨0 친구에게 근무표만 노출한다.
- 변경/영향: 생성/수정 route·service 범위1~5, Event 모델 min1/max5/default1·OpenAPI의 개인 일정 범위·신규 DDL/정본 도면을 맞췄다. 기존0→1/default/DB 제약 증분 SQL과 명시적 gitignore 예외를 추가했다. private/소유자/시각/근무표0·친구0~5/ACL·공개 view는 보존한다. 구형0 요청400과 운영 배포/migration 필요성을 문서화했다.
- 신규 파일 역할/의존성/사용 예: migrations/restrict_event_visibility_levels.sql은 PostgreSQL events의0만1로 보정하고 기본값/ck_events_visibility를 고정한다. transaction·5초 lock_timeout·예상 밖 범위 preflight/재실행을 제공한다. _docs/EVENT_VISIBILITY_GUIDE.md는 적용 예/배포 순서·역호환·검증·안전 롤백을 제공하며 PROJECT_CONTEXT·ADR-0046·기존 수정/비공개 가이드에 연결했다. SQL/가이드에는 실제 비밀/사용자 데이터가 없다.
- 테스트: strict build·서비스/인증 HTTP12 pass, 실제 격리 PostgreSQL/HTTP9 pass.0/-1/6 전송/DB 거절·1/5/private 허용·원본값 보존·0 보정/기본1/재실행·이상값 preflight 원자 거절·친구/그룹 레벨0에서 근무만 조회와 기존 수정/삭제 경합을 확인했다. 전체93 pass/17 fail/13 skip, 변경 전91 pass/17 fail/13 skip과 실패 이름이 같아 신규 실패0개다. 기존 비공개 배포 파일 누락/Apple 계약 실패는 범위 밖이다. JSON/drawio 파싱·diff 검사를 확인한다.
- 결과/한계: 로컬 구현/검증 완료. 이번 전용 event-level-audit-20261112 PostgreSQL 컨테이너/네트워크는 정리했다. 기존 컨테이너/원격 DB는 변경하지 않았다. Stage/운영 배포·운영 데이터 migration·실기기 인수/커밋/푸시는 수행하지 않았다. 현재 codex/private-events checkout을 유지했다.
- 롤백:1~5·private/ACL을 유지하는 호환 소스로 복구하며 보정된1을0으로 되돌려 개인정보를 다시 노출하지 않는다.

### [DONE] 개인 일정 전체 편집 API 커밋·배포

- 목적: 사용자 요청에 따라 검증된 수정 API를 공개 develop과 비공개 배포 main에 반영한다.
- 변경/영향: 관련 소스·OpenAPI·테스트·문서를 커밋하고 기존 자동 배포로 Stage/운영 API와 worker를 갱신한다. DB migration·환경변수 변경은 없다.
- 테스트: 비공개 main 통합 코드 strict build·전체 131 pass/0 fail/14 명시적 skip, 개인 일정 PostgreSQL/실제 HTTP 8 pass/0 fail, Python monitor 3개·Bash/YAML·문서 cmp·diff check 통과. 배포 CI의 전체 통합 검사·이미지 빌드·배포 success. Stage/운영 readiness HTTP 200/success=true/cache=ready 및 실제 OpenAPI PUT·8개 필수 필드 반영을 확인했다.
- 롤백: 직전 private 호환 이미지로 복구하며 사용자 데이터와 private 필터를 유지한다.
- 결과/다음: 기능 744b106을 origin/develop에 push하고 기존 비공개 main에 충돌 없이 통합해 Stage/운영 자동 배포를 완료했다. DB SQL·실제 env·사용자 데이터는 직접 변경하지 않았다. 실제 실행 정보는 비공개 배포 브랜치에만 기록한다. Flutter 실기기 수정/재조회 인수는 후속이며 이번 배포 확인에는 포함하지 않는다. 임시 격리 DB 컨테이너·네트워크를 정리했다.
- 보완 항목: npm audit --audit-level=high는 기존 잠금파일에서 22건(낮음 1·보통 13·높음 7·치명적 1)으로 실패했다. 이번 변경은 package.json/package-lock.json을 바꾸지 않았으며 의존성 보완은 별도 작업으로 남긴다.

### [DONE] 개인 일정 전체 편집 API

- 목적: Flutter 메인 개인 일정 탭 수정에 필요한 PUT /api/v1/events/{event_id}를 제공한다.
- 변경/영향: route/controller/service·OpenAPI·관련 테스트/문서. JWT 소유자·활성 행만 갱신하고 private 필터와 기존 생성/삭제 계약을 보존한다.
- 변경 상세/파일: calendar route/controller/service·calendarOpenApi와 새 test/eventEditing.test.cjs·기존 eventPrivacyIntegration·EVENT_EDIT_GUIDE/PROJECT_CONTEXT/DECISIONS(ADR-0045)/WORKLOG. null 삭제/엄격 타입·소유권/soft-delete·RETURNING·timestamps 보정·본문 없는 오류 로그를 구현했다. 새 파일 역할/의존성/사용 예는 가이드에 기록했다.
- 테스트: strict build·수정/생성/삭제/private HTTP·서비스10 pass, PostgreSQL16/실제HTTP8 pass. 전체91 pass/17 fail/13 skip이며 변경 전 HEAD 사본86 pass/17 fail/15 skip과 실패17개 이름 동일·신규 실패0개. 기존 비공개 배포/Apple 계약 실패와 로컬 Git 제외 파일 차이를 보존했다. JSON/내부참조·diff 검사도 확인한다. 별도 lint 명령은 없다.
- 검증 보완: 실제 DB 반환 created_at 누락을 debug-live로 추적해 fieldAttributeMap의 createdAt/updatedAt 매핑을 확인하고 수정 응답에 한정해 fallback을 추가했다. 임시 진입점·중단점/세션은 정리했다. 격리 테스트 컨테이너는 검증 후 정리한다.
- 결과/한계: 로컬 구현·검증 완료. 새 DB migration/env·Stage/운영 배포/원격·실기기 인수·커밋/푸시는 미수행. 기존 codex/private-events checkout에서 관련 diff만 추가했다.
- 롤백: 신규 PUT 경로만 비활성화하며 사용자 데이터/private 컬럼·필터는 보존한다.

## 2026-11-11

### [DONE] 개인 일정 나만 보기 커밋 정리·배포

- 목적: 사용자가 승인한 비공개 일정 변경을 공개 develop과 비공개 배포 main에 반영한다.
- 변경: 기능 `10cdc03`을 origin/develop에 push하고 private main에 통합했다. 배포용 schema 사전 검사와 개인 일정 PostgreSQL CI 통합 검사를 추가한 뒤 자동 배포를 완료했다. 비공개 실행 정보는 private main 작업 일지에 기록한다.
- 영향범위: 개인 일정 API·응답·DB view와 배포 전 검사. 사용자가 Stage 정상 및 Center migration 적용 완료를 확인했고 DB SQL은 재실행하지 않았다. 환경변수·사용자 데이터를 직접 변경하지 않았다.
- 테스트: 최종 배포용 main strict build·전체 **128 pass/0 fail/14 skip**, 격리 PostgreSQL/HTTP 개인 일정 **7 pass/0 fail**과 실제 배포 catalog/view SELECT 통과. CI 단위·cache/Redis·개인 일정·Push·Apple/Google/Kakao·프로필·탈퇴·개인정보 통합과 monitor, 이미지 빌드·배포 모두 success. 배포 시 Stage/Center 새 컬럼/뷰 필터 검사 성공을 확인했다. 배포 후 두 환경 readiness HTTP 200/success=true/cache=ready 및 Stage OpenAPI 요청 default=false·본인/친구/그룹 응답 계약 반영을 확인했다.
- 롤백: private 데이터를 유지하는 호환 서버로 복구한다. 컬럼·private 차단 필터를 제거하지 않는다.
- 결과/다음: 공개 기능 반영 및 Stage/Center 서버 배포 완료. 실제 인증 사용자 A/B/C의 권한별 실응답·실기기 인수와 Flutter 활성화는 별도 후속 작업이다. 결과 기록은 문서만 변경하며 실행 소스에는 영향이 없다.

### [DONE] 개인 일정 나만 보기 서버 로컬 구현·검증

- **목적**: 레벨과 독립적인 `is_private`로 개인 일정 전체 행의 타인 노출을 차단한다.
- **변경**: NOT NULL/default false 모델·증분 migration·정본 DDL, route와 service의 엄격한 boolean 검증, 생성/본인/친구/그룹 DTO, 공통 공개 view 필터를 반영했다. 기존 15개 view 컬럼 이름·타입·순서를 preflight로 확인하고 viewer_user_id 뒤에 새 컬럼을 추가한다. OpenAPI·ADR-0044·가이드·로컬 AGENTS·서버 도면을 동기화했다.
- **영향범위**: **Behavior change**: true 개인 일정은 레벨 5·can_view=true·같은 그룹 OWNER/ADMIN도 전체 행을 볼 수 없다. 기존 데이터/요청 생략은 false로 유지하며 visibility_level 필수 0~5, 시간/soft delete/소유자 삭제·근무표 공개/캐시는 보존한다. 신규 env/인덱스/seed는 없다.
- **파일**: `src/models/Event.ts`, calendar route/controller/service, friend/group service·group types, calendar/group OpenAPI, `migrations/{add_event_privacy,final_schema}.sql`, `package.json`, `.gitignore`, `test/eventPrivacy{,Integration}.test.cjs`, 기존 cache/group 통합 초기화, `schema.drawio`, `visibility_flow.drawio`, `_docs/{EVENT_PRIVACY_GUIDE,PROJECT_CONTEXT,DECISIONS,FRIEND_API_GUIDE,GROUP_API_GUIDE,WORKLOG}.md`. 신규 파일 역할·의존성·사용 예는 [EVENT_PRIVACY_GUIDE.md](EVENT_PRIVACY_GUIDE.md)에 기록했다. AGENTS는 기존 Git 제외 정책을 유지하고 로컬 DDL만 갱신했다.
- **테스트**: strict TypeScript build·CJS 구문·OpenAPI JSON/내부 참조·draw.io XML·git diff --check 통과. 단위/인증 HTTP/병합 OpenAPI/삭제 회귀 **7 pass/0 fail**. 고정 격리 PostgreSQL 16+실제 HTTP **7 pass/0 fail**: 기존 행 false, view 컬럼 순서·타입·OID·권한·종속 view, 중복/동명 컬럼/drift 거절·원자성, 신규/증분 view 정의 동일성, 구형 INSERT/SELECT/API, owner 위조, timed/종일/다일·레벨 0/2/3/5·soft delete·배타적 경계, 본인 4경로·친구·그룹 관리자·차단/비친구·권한 철회·private 삭제 확인. 기존 notSelf validator가 bulk 부분 update에서 두 ID 없이 실행되는 테스트 fixture 오류는 기존 서비스와 같은 인스턴스 update로 수정했다. DebugMCP 세션이 시작되지 않아 모델·Sequelize 실제 build/validate 경로와 실패 stack을 직접 확인했으며 제품 모델은 변경하지 않았다.
- **전체 회귀**: 최종 npm test **88 pass/17 fail/13 skip**. 별도 `origin/develop` 기준 4f452bf 원본 사본은 **82 pass/17 fail/14 skip**이며 실패 이름 17개가 동일하여 **신규 실패 0개**다. 기존 실패는 비공개 배포 파일·Apple Stage SQL 누락/가이드 문구 assertion이며 목표 밖 파일은 수정하지 않았다. skip 차이는 로컬 Git 제외 파일의 존재에 따른 기존 테스트 조건과 새 통합 opt-in 항목이다. 별도 lint 명령/설정은 없다.
- **롤백**: private 행이 있으면 컬럼·타인 차단 view를 제거하지 않는다. 신규 private 생성만 중지하거나 private 호환 서버로 복구한다. 다운 migration은 제공하지 않는다.
- **결과/다음**: `origin/develop`이 다른 worktree에서 사용 중이므로 이 checkout은 `codex/private-events`로 전환했다. 로컬 구현·검증 완료, commit/push·Stage/운영 DB 변경/배포·실사용자 인수·Flutter 활성화는 미수행이다. 이번 검증용 격리 테스트 컨테이너·네트워크는 제거했다. 서버 배포 시 백업/실제 view 확인 → add_event_privacy.sql → 서버 → A/B/C 권한별 인수 → 운영 인수 후 Flutter 활성화 순서로 진행한다.


## 2026-11-10

### [DONE] 프로필 편집 변경 커밋 정리·배포

- 목적: 사용자가 DB 쿼리 적용 완료를 알리고 커밋 정리와 배포를 요청했다.
- 변경: 기능 `9efe7d8`과 탈퇴 계정 이미지 요청 오류 우선순위 수정 `4765e44`를 공개 develop에 반영했다. 배포용 브랜치에 통합하고 기존 S3 객체 태그를 보존했으며 DB schema 사전 검사와 프로필 CI 통합 검증을 추가했다. 비공개 실행 정보는 배포 브랜치 작업 일지에 기록한다.
- 영향범위: 본인 프로필 API·기존 탈퇴 worker 배포와 배포 전 검사. DB SQL은 사용자 적용 완료를 기준으로 재실행하지 않았다. 환경변수·사용자 프로필 데이터는 직접 변경하지 않았다.
- 테스트: 최종 배포용 코드의 strict build·전체 117 pass/0 fail/13 명시적 skip, 가입 완료 격리 PostgreSQL 8 pass·이미지/편집 실제 SDK 통합 21 pass, Python monitor 3개와 배포 구문 검사 통과. 최초 CI의 탈퇴 계정 오류 우선순위 회귀는 수정했고 재실행에서 기존 인증·캐시·푸시·탈퇴/개인정보 및 프로필 통합 검사를 모두 통과했다. 배포 후 양 환경 readiness와 Stage의 JSON/multipart·자유 직종 20자 OpenAPI 반영을 확인했다.
- 롤백: 자유 직종·큐 schema를 지원하는 호환 서버로 복구한다. 사용자 직종을 enum으로 변환하지 않으며 큐가 비기 전에 정리 처리를 제거하지 않는다.
- 결과/다음: 공개 develop 반영과 배포 완료. 실기기 사진 선택/교체·재로그인·친구 화면 최신 이미지 인수는 별도이며 이번 서버 배포 검증에 포함하지 않는다. 결과 기록 후속 커밋은 문서만 변경한다.

### [DONE] 일반 프로필 부분 수정·사진 교체·자유 직종 지원

- 목적: 전달받은 Flutter 프로필 편집 계약을 기존 JSON/가입 완료·비공개 이미지 계약과 호환되게 구현한다.
- 변경: 일반 multipart 파일 단독/부분 수정, 자유 직종 1~20자와 선택값 삭제, 내부 필드 allowlist·파일/URL 동시 입력 거절을 구현했다. 가입/편집 공용 이미지 조정 서비스가 업로드→DB 저장→정리까지 계정 session lock을 보유하고 I/O 중 DB transaction은 열지 않는다. 새 key 작업 선기록·DB commit 안 새 작업 취소/이전 소유 key 예약·영속 재시도를 추가했다. 기존 탈퇴 worker가 비활성 플래그와 무관하게 정리하며 healthcheck도 새 schema를 검사한다. 완료 시각/boolean·인증 이미지 GET·개인정보 공개 범위는 보존한다.
- 영향범위: 본인 수정·가입 이미지 공용 처리, 기존 탈퇴 worker의 이미지 정리, users 직종 CHECK와 새 정리 큐. 이미지 없는 필드 수정은 기존 row lock transaction을 유지한다. 새 env/사진 컬럼/seed는 없다. **Behavior change**: 일반 수정 rate limit·multipart·자유 직종, 파일+URL 400 및 동시 이미지 수정 잠금 충돌 503.
- 파일: `src/services/{profileMutationService,profileImageCleanupService,profileService,profileImageStorageService}.ts`, auth controller/routes·upload middleware·User·profile OpenAPI, `src/workers/accountDeletionWorker.ts`, `migrations/{add_profile_edit_support,final_schema}.sql`, `.gitignore`, `schema.drawio`, profile/private-image/worker 테스트, `_docs/{PROFILE_EDIT_GUIDE,PROFILE_COMPLETION_GUIDE,PROJECT_CONTEXT,DECISIONS,WORKLOG}.md`. 신규 파일 역할·의존성·사용 예는 [PROFILE_EDIT_GUIDE.md](PROFILE_EDIT_GUIDE.md)에 기록했다. `visibility_flow.drawio`는 현재 checkout에 없어 공개 범위는 실제 모델/조회 코드와 기존 문서로 확인했다.
- 테스트: strict TypeScript build, OpenAPI JSON·draw.io XML 파싱, `git diff --check` 성공. 격리 PostgreSQL 16+로컬 S3 호환 HTTP/실제 AWS SDK 통합 **21 pass/0 fail**: migration 멱등·기존 데이터 보존, JSON/multipart/사진 단독·선택값 삭제·Unicode/자료형 경계, 완료 시각/내부 key 비노출, MIME/손상/미지원/5MB/다중 파일/part, 401/탈퇴 상태, DB rollback·storage 503·unique 경쟁 409, commit 후 삭제 실패·재시도·현재 key 보호·fingerprint 변경 거절, commit 후 lock 정리 예외, 중단 고아 객체 복구, legacy/OAuth, 동시 교체/텍스트 수정·실제 탈퇴 접수/worker lock 경합을 검증했다. 관련 회귀 7파일 **52 pass/0 fail/1 skip**(공개 checkout에 없는 과거 비공개 가입 배포 SQL만 명시적 skip). 전체 `npm test`는 **83 pass/17 fail/12 skip**이며 `origin/develop` 원본 임시 사본의 기존 실패 18개와 비교해 **신규 실패 0개**다. 관련 profile 테스트를 공개/비공개 검증으로 분리해 1개 누락 실패를 해소했고, 남은 17개는 범위 밖 비공개 배포 파일/Apple Stage SQL 누락 및 기존 Apple Portal 문구 assertion이다. 운영 파일을 공개 브랜치로 복사해 우회하지 않았다.
- 롤백: 자유 직종 호환 서버로 복구하고 additive schema/미완료 정리 큐를 유지한다. 사용자의 자유 직종을 enum으로 변환하거나 삭제하지 않는다. API와 worker를 함께 복구하며 큐가 비기 전에 처리 경로를 제거하지 않는다.
- 결과/다음: `origin/develop` 기반 `codex/profile-edit`에 로컬 구현·검증·ADR-0043·서버 인수 가이드 완료. 실제 Stage/운영 DB 변경·배포·실기기 E2E·commit/push는 수행하지 않았다. 대상 DB/백업 확인→후속 migration→API/기존 worker 동시 배포→Stage 실기기 인수→운영 순서로 진행한다.

## 2026-11-09

### [DONE] 미커밋 Stage 개발 실행 기능 검토·정리

- 목적: main에 남은 Markdown·JSON·CJS 변경을 확인하고 공개 가능한 로컬 개발 기능을 develop에서 관리한다.
- 변경: 일반 SSH 터널/nodemon 실행 스크립트와 npm dev:stage 명령을 추가하고 파일 역할·필수/기본 설정·사용 예·종료 절차를 문서화했다. 내부 장애 조사·실제 환경 기록은 private main에서 별도 정리한다.
- 영향범위: 로컬 개발 실행만. 실제 서버 env·DB·API 동작 변경 없음. .vscode와 .env.stage.local은 Git 제외 상태 유지.
- 테스트: node --check, package.json/개인 launch.json 파싱·명령 연결, strict TypeScript build, git diff --check 통과. 실제 SSH 대신 VM 모의 실행으로 성공·터널 실패·필수 env 누락·SIGINT·SIGTERM·터널 유실·nodemon spawn 오류의 7개 경로와 소유 socket 정리를 검증했다. 실제 Stage 접속·DB 변경은 수행하지 않았다.
- 롤백: 본 커밋 revert. 기존 수동 터널과 npm run dev 사용.
- 결과/다음: 검토 완료한 공개 기능을 develop에 커밋한다. 사용자 요청에 따라 기존 미전송 앱 정책/10분 폴링 커밋과 함께 origin/develop에 push하며, 비공개 main 변경은 자동 배포 없이 별도 반영한다.

### [DONE] 회원 탈퇴 워커 유휴 폴링을 10분으로 변경

- 목적: 탈퇴 요청이 드문 환경에서 반복 선점 SQL과 heartbeat 쓰기를 줄인다.
- 변경: 기본 폴링·환경 예시 600000ms, 탈퇴 heartbeat stale 기준 15분, AbortController로 유휴·비활성·오류 대기 취소, 시작 로그 poll_ms 추가. 관련 회귀·ADR-0042·설계/운영 문서를 갱신했다.
- 영향범위: 탈퇴 워커 유휴·오류 후 대기와 탈퇴 감시. 푸시 워커·탈퇴 접수/삭제 단계·DB schema 변경 없음. 기존 환경변수 값은 기본값보다 우선한다.
- 파일: `src/workers/accountDeletionWorker.ts`, `src/config/environment.ts`, `.env.example`, `src/services/accountDeletionOperationsService.ts`, 관련 테스트와 `_docs/` 문서.
- 테스트: develop strict TypeScript build와 탈퇴 11개 테스트(신규 5개) 통과. 실제 컴파일된 루프·Node 타이머를 자식 프로세스에서 실행해 기본/override, 빈 큐·비활성·오류·작업 연속 처리, SIGTERM/SIGINT 즉시 종료를 확인했다. develop 전체 테스트는 비공개 배포 파일/운영 로컬 SQL 누락 및 sandbox HTTP bind 제한으로 실패하여, private main 853be8d 기반 임시 검증 사본에 이번 src/test/.env.example diff와 기존 로컬 SQL만 결합하고 로컬 HTTP를 허용해 npm test 전체 124개 중 113 pass/0 fail/11 명시적 통합 skip으로 검증했다. Python 개인정보 monitor 3개와 git diff --check도 통과했다. 감시 통합 테스트는 탈퇴 6·14분 정상/15분 stale 및 푸시 6분 stale 경계를 갱신했으나 Docker daemon 미실행으로 실제 PostgreSQL·스토리지 통합은 미수행.
- 롤백: 본 작업 diff 복원 및 기존 ACCOUNT_DELETION_POLL_MS 재설정 후 컨테이너 재생성. DB migration 불필요.
- 결과/다음: develop 작업 트리 `/private/tmp/shiftmate-app-policy-develop`에서 완료. 원래 main의 미커밋 문서·package·scripts를 보존했다. 실제 서버 env 변경·배포·push는 미수행이며 기존 override가 있으면 운영 env를 600000으로 맞추고 worker와 API/ops 이미지를 함께 재생성해야 한다. Docker healthcheck의 별도 30초 DB 조회는 유지되므로 전체 DB 부하가 600분의 1이 되었다고 주장하지 않는다.

## 2026-11-08

### [DONE] 앱 호환 정책을 소스 코드 정본으로 전환

- 목적: 사용자 요청에 따라 환경변수 대신 Git으로 플랫폼별 정책을 관리한다.
- 변경: typed source config에 최소값·스토어 URL·문구를 모으고 service/startup 검증·OpenAPI·회귀를 전환한다. 현재 로컬 요청값인 양 플랫폼 1을 유지한다.
- 영향범위: 정책 조회와 설정 오류 로그. DB/기존 인증 계약 변경 없음. 실제 재배포는 수행하지 않는다.
- 테스트: strict TypeScript build 및 정책 10개+기존 환경/Google/푸시 18개, 선택 회귀 28개 전부 통과. source 정본 불변성·DTO 분리, 과거 env override 무시, 0/null과 정수/URL/문구 경계, source 오류 503·configuration_field 안전 로그, 실제 시작 전 오류 거절, 생성 OpenAPI·무인증 HTTP·DB 비의존·2→0 복원 검증. git diff --check 통과. 전체 private main 회귀는 통합 작업 트리에서 별도로 확인한다.
- 롤백: 소스 최소값을 0으로 낮춰 재빌드·재배포하고 endpoint를 유지한다.
- 파일: src/config/appVersionPolicy.ts(플랫폼 타입·불변 정본, 외부 의존성 없음; 최소값 수정 후 build/정책 테스트), src/services/appVersionPolicyService.ts, src/index.ts, src/utils/logger.ts, src/openapi/appVersionPolicyOpenApi.json, test/appVersionPolicy.test.cjs, .env.example, _docs/{APP_VERSION_POLICY,PROJECT_CONTEXT,DECISIONS,WORKLOG}.md.
- 결과/다음: 기존 로컬 env의 임시 정책 키를 제거하고 기존 미커밋 작업을 보존하여 작업 트리에 반영한다. 재배포는 하지 않으며 기존 실행 서비스 0과 다음 코드 배포 시 1의 차이를 ADR-0041에 기록했다.

### [DONE] 전달된 앱 호환 정책 검토 및 develop 반영

- 목적: 준비된 커밋 `90ece07`을 검토하고 중복 적용 없이 develop에 반영한다.
- 변경: 준비 커밋을 중복 적용 없이 develop에 fast-forward 반영한다. Android 중복 package id 거절, OpenAPI 400/503 오류 DTO·헤더, 실제 앱 라우팅/시작 전 검증을 보완했다.
- 영향범위: API 호환 정책과 관련 문서. 기존 main 미커밋 작업 보존, DB 변경 없음.
- 테스트: npm ci --ignore-scripts 및 strict TypeScript build 통과. 전달된 선택 회귀 4파일의 27개 테스트 전부 통과(신규 정책 9개+기존 18개). 실제 앱 HTTP 무인증/양 플랫폼/JSON/no-store/request ID, DB 비의존, 2→0 응답 복원, query 배열·객체 거절, 시작 전 설정 오류 종료·안전 로그, 생성 OpenAPI 검증. 로컬 HTTP는 sandbox listen EPERM을 확인한 뒤 포트 허용 실행으로 통과. git diff --check 통과. 전체 npm test·실기기·실제 배포 검증은 미수행.
- 롤백: 최소값 0 정책의 정상 응답을 먼저 확보하고 endpoint를 유지한다.
- 파일: src/services/appVersionPolicyService.ts, src/openapi/appVersionPolicyOpenApi.json, test/appVersionPolicy.test.cjs, _docs/{APP_VERSION_POLICY,DECISIONS,PROJECT_CONTEXT,WORKLOG}.md.
- 결과/다음: 기본 iOS/Android 최소값 0 유지. 공개 develop 반영 후 배포용 private main 기반 별도 작업 트리에 전달한다. 실제 배포 env/DB 변경 및 Store 이동·복귀·차단 해제 E2E는 완료로 기록하지 않는다.

### [DONE] 앱 API 호환 버전 정책 조회 추가

- 목적: 스토어 버전과 독립적인 앱 내부 호환 번호의 최소 지원값을 운영한다.
- 변경: develop 기반 codex/app-compatibility-policy 작업 트리에 공개 정책 API·환경 설정·OpenAPI·테스트를 추가한다.
- 영향범위: 신규 조회 API와 선택 환경변수. DB 변경·기존 API 인가 변경·실제 배포 없음.
- 테스트: strict TypeScript build 통과. 신규 설정/실제 HTTP 5개와 기존 환경·Google·푸시 선택 회귀를 합쳐 23개 통과. query 배열/누락/잘못된 플랫폼, no-store·무인증 조회, 범위/URL 검증·오류 원문 비노출 확인. git diff --check 통과. 전체 npm test·운영 배포·실제 스토어 E2E 미수행.
- 롤백: 플랫폼 최소 호환 번호를 0으로 낮추고 API 프로세스를 재생성해 정상 200 응답으로 기존 차단을 해제한다. endpoint는 유지하며 코드 제거부터 진행하지 않는다.
- 결과: 플랫폼별 최소 정수·스토어 URL·메시지 환경 설정, 공개 API·시작 검증·OpenAPI·문서/ADR-0040 추가. 초기 기본값 0으로 차단 비활성. 기존 main의 미커밋 작업은 보존했다.
- 다음: develop 기반 작업을 검토/병합하여 API 배포 후 앱 스토어 공개를 확인한다. 대응 앱 공개 전 최소값을 인상하지 않으며 코드 롤백 전에는 0 정책을 먼저 응답시킨다.

### [DONE] 비공개 프로필 이미지 서버 조회 구현

- **목적**: 앱의 S3 직접 조회 AccessDenied를 해결하고 저장소 주소를 API 응답에서 제거한다.
- **변경**: nullable 객체 key·소유자 CHECK migration/초기 schema, 인증된 GetObject 스트리밍 API, ORM/raw SQL/알림 공통 이미지 URL 직렬화와 key 비노출, 검증된 기존 URL dry-run/멱등 전환 CLI, 임의 URL 교체 차단과 기존 값 유지/제거, API origin 환경 검증, OpenAPI·Flutter 토큰/캐시·배포 문서 및 회귀 테스트를 구현했다. 기존 작업은 `1b6d990`으로 origin/develop push 완료 후 본 구현을 진행했다.
- **영향범위**: 프로필 이미지 업로드/조회와 본인·친구·그룹·알림의 이미지 URL 응답. 외부 OAuth 이미지 URL은 유지한다. 이미지 조회는 기존 사용자 검색에서 제공하는 기본 아바타와 같이 활성 로그인 사용자에게 허용하며 캘린더 ACL과 분리한다.
- **테스트**: strict TypeScript build, 신규 URL/JSON/환경 단위 3개 + 기존 탈퇴/Kakao/환경 20개 + 기존 프로필 관련 선택 5개 통과. PostgreSQL 16/로컬 S3 호환 HTTP/실제 AWS SDK 통합 6개 통과(업로드→DB→동일 bytes 조회, 인증/탈퇴/UUID/환경/소유 경계, AccessDenied/NoSuchKey 안전 응답, MIME/5MB 거절, 기존 URL 호환·dry-run·멱등 전환·URL 제거). migration 2회 적용 확인. 전체 npm test는 67 pass/18 fail/11 skip이며 변경 전 `1b6d990`의 임시 archive를 별도 build/test해 동일한 실패 18개(누락된 비공개 배포/프로필·Apple migration 및 기존 문서 기준)를 확인했다. 신규 실패 없음. JSON parse·diff 검사 통과. 실제 AWS IAM/Stage/Flutter E2E 미수행.
- **롤백**: 서버 코드 복구 시 additive key 컬럼 유지. 기존 원본 URL 복원은 검증된 key와 원래 저장소 설정으로만 수행. 삭제된 객체는 복구되지 않는다.
- **파일**: `src/{controllers/profileImageController.ts,routes/profileImageRoutes.ts,scripts/profileImageBackfill.ts,utils/profileImageLocation.ts}`, User/환경/프로필 storage·service·controller/라우팅/직렬화/OpenAPI, `migrations/{add_private_profile_images,final_schema}.sql`, 관련 테스트/fixture, `.env.example`, `.gitignore`, `package.json`, `_docs/{PROFILE_COMPLETION_GUIDE,PROJECT_CONTEXT,DECISIONS,WORKLOG}.md`.
- **다음**: 별도 구현 커밋을 develop에 push. Stage는 key migration→실제 API origin 설정→검증된 backfill→새 서버 배포와 Flutter Bearer/이미지 캐시 연동이 필요하며 실제 운영 적용은 수행하지 않았다.

### [DONE] Stage 프로필 이미지 AccessDenied 원인 조사

- **목적**: 업로드 후 앱 이미지 조회 거부 원인을 확인한다.
- **변경**: 저장·URL 생성·프로필 응답·라우트와 기존 저장소 정책 문서를 대조한다. 운영 설정·코드 변경 없음.
- **영향범위**: 조사 기록만.
- **테스트**: `profileImageStorageService.ts` 전체 및 auth route를 확인했다. PutObject 후 `PROFILE_IMAGE_PUBLIC_BASE_URL/key`를 서명 없이 저장·반환하며 GetObject API/presign 구현은 없다. 기존 가이드는 퍼블릭 차단 유지 및 인증 조회 API 미구현을 명시한다. 사용자가 제공한 DB URL이 서명 없는 S3 직접 URL임을 확인했다. 앱의 해당 URL 직접 사용 시 비공개 읽기가 거부되는 구조이며 인증된 서버 조회 경로가 미구현임을 확인했다.
- **롤백**: 이 조사 항목 제거.
- **다음**: 사용자 승인에 따라 인증된 서버 이미지 스트리밍과 DB 객체 key 정본 전환을 구현한다. 공개 버킷 전환·S3 리다이렉트는 사용하지 않는다.

### [DONE] 탈퇴 DB purge의 그룹 감사 FK·CHECK 충돌 수정

- **목적**: 삭제/제거 이력의 실행자 계정 탈퇴 시 SET NULL과 CHECK 충돌로 DB purge가 롤백되는 문제 해결.
- **변경**: worker 삭제 흐름과 final schema의 SET NULL FK·CHECK를 확인했다. 그룹 삭제·멤버 제거 시각을 보존하고 감사자 NULL을 허용하도록 기존 DB용 `fix_account_deletion_audit_constraints.sql`, 최초 탈퇴 migration, 초기 schema를 일치시켰다. 실제 worker 회귀 테스트, 전용 npm 명령, ADR-0037·프로젝트 컨텍스트·운영 복구 절차를 추가했다. 원인은 CHECK와 기존 FK의 충돌이므로 worker의 삭제 순서와 retry 로직은 유지했다.
- **영향범위**: 그룹 삭제/멤버 제거 감사 이력과 탈퇴 DB purge. 실제 Stage 변경 없음.
- **테스트**: TypeScript build 성공. 격리 PostgreSQL 16 회귀 1개 통과(그룹/멤버 각각 구 CHECK의 23514·RETRY·로그인 차단 재현 → migration 2회 적용 → 실제 worker 완료·멱등 재실행 → 감사 시각·타인 계정 보존·감사자 NULL → 같은 이메일 신규 사용자 및 토큰 발급). 기존 탈퇴/Kakao/환경 테스트 20개 통과, `git diff --check` 통과. 실제 카카오 provider·이미지/Redis 외부 연동은 이번 회귀에서 수행하지 않았다.
- **롤백**: worker를 중지하고 코드 복구. 익명화된 감사자를 임의 복원하거나 삭제 시각을 제거하지 않음.
- **파일**: `.gitignore`, `package.json`, `migrations/{fix_account_deletion_audit_constraints,add_account_deletion_support,final_schema}.sql`, `test/accountDeletionAuditIntegration.test.cjs`, `_docs/{PROJECT_CONTEXT,DECISIONS,PRIVACY_OPERATIONS_RUNBOOK,WORKLOG}.md`.
- **다음**: Stage worker 중지·백업·대상 DB 확인 후 신규 fix migration만 실행하고 worker 재개. FAILED는 기존 운영 CLI의 현재 상태/횟수 검증 재처리를 사용하며 실제 Kakao 재가입을 확인한다. Stage 접속 대상이 없어 운영 적용은 미수행.

### [DONE] Stage 카카오 회원가입 실패 로그 조사

- **목적**: 실제 실패 요청의 로그와 서버 처리 흐름을 대조해 원인을 확인한다.
- **변경**: 프로젝트·배포 문서와 Kakao 인증 및 프로필 완료 오류 로그 경로 확인. 코드·운영 설정 변경 없음.
- **영향범위**: 조사 기록만. Stage SSH 접속 대상과 실제 실패 로그는 아직 확보되지 않았다.
- **테스트**: 로그 context와 오류 코드 기록 구현, 문서의 Stage Compose 로그 조회 명령을 확인했다. 실제 실패 원인은 미확정.
- **롤백**: 이 작업 일지 항목을 제거한다.
- **다음**: Stage 접속 정보 또는 실패 시각·로그를 확보해 request_id 기준으로 인증과 프로필 완료 실패를 추적한다.
- **추가 확인**: 제공된 07:54:01 UTC Kakao 500과 07:54:04 UTC 탈퇴 worker `SequelizeDatabaseError`는 서로 다른 실행 로그로 동일 사용자 연관성은 미확인. 코드상 탈퇴 접수는 사용자를 `DELETION_PENDING`으로 바꾸고 `generateTokens()`는 이 상태에서 일반 Error(`ACCOUNT_DELETION_IN_PROGRESS`)를 throw하며 Kakao controller는 이를 500으로 반환한다. 실제 사용자 상태와 탈퇴 요청의 `last_error_code` 조회가 필요하다. 탈퇴 완료 후 동일 정보 재가입을 영구 차단하는 조건은 Kakao 로그인 흐름에 없다.
- **최종 결과**: 운영자가 제공한 DB 조회에서 해당 사용자의 `DELETION_PENDING`, 탈퇴 요청 `RETRY`, `ACCOUNT_DB_PURGE_FAILED`, 이미지 단계 완료·DB 단계 미완료를 확인했다. PostgreSQL 로그는 `DELETE FROM users`의 FK 참조 처리로 `groups.deleted_by_user_id=NULL`이 설정될 때, 이미 `deleted_at`이 존재하는 그룹에서 `ck_groups_deleted_pair`가 위반됨을 명시했다. DB purge transaction 실패 → 사용자 잔존 → 토큰 발급 차단 → Kakao 공통 500 경로가 확인됐다. 실제 DB/운영 코드 수정·재처리는 수행하지 않았다. 후속 작업은 탈퇴 후 삭제자 NULL을 허용하는 감사 정책·관련 제약 정합성 수정과 안전한 재처리, 로그인 오류 매핑 보완이다.

## 2026-10-18

### [DONE] 개발 변경 커밋 준비 및 배포 브랜치 분리

- **목적**: 개발 변경은 develop, 실제 배포 설정은 비공개 main에서 관리
- **변경**: 공개 개발 산출물과 환경별 설정 분리. 경보 수신자와 개인정보 초안은 비공개 main에만 보관. main 자동 배포는 migration 선행 확인 조건 적용 예정
- **테스트**: 개발 diff와 원격 추적 확인, TypeScript build·Python monitor 3개·diff 검사 통과. 기존 통합/회귀 검증 결과는 아래 기록 참조
- **롤백**: 각 브랜치의 해당 커밋을 revert. DB·이미지 삭제는 Git으로 복구되지 않음
- **다음**: 개발 커밋·푸시 후 비공개 main 병합·설정 커밋·푸시

### [DONE] 개인정보 삭제·보관·가입 정책 BE-01~04 로컬 구현 및 전달 보고

- **목적**: 관리 이미지 탈퇴 삭제 누락 보완 및 실패·7일 목표 초과 관측/재처리 제공
- **변경**: 관리 이미지 namespace/버전 삭제 checkpoint·업로드 경합 잠금·실패/7일/30일 감시·root 재처리·30일 기기 정리·작업 retention 검증 구현. BE-03/04 정책 추가 승인 반영. FE 합의안·결과 보고·운영 절차·ADR-0036·OpenAPI·schema 동기화
- **영향범위**: 프로필 업로드와 탈퇴 worker, 운영 명령, 문서. 실제 홈서버 접속 정보 미제공으로 운영 증거 별도 필요
- **테스트**: strict build, PostgreSQL 16 + Moto HTTP 통합 13개, 기존 그룹 승계/탈퇴 통합 1개, 탈퇴/환경 회귀 10개, Python monitor 3개, migration 적용/빈 상태 rollback/재적용, diff 검사 통과. 전체 테스트 64 pass/18 fail/9 skip이며 baseline 1c6ce8d에도 같은 실패 18개 확인(배포/프로필 migration 누락 및 기존 문서 정적 기준). 실제 저장소·CDN·provider·메일 실수신·홈서버 적용 미검증
- **롤백**: worker 정지 후 이전 코드 복구와 additive schema 유지. 삭제된 객체는 코드 롤백으로 복구되지 않음
- **다음**: `_docs/PRIVACY_IMPLEMENTATION_REPORT.md` 전달 → 운영 담당자가 `_docs/PRIVACY_OPERATIONS_RUNBOOK.md`에 따라 Stage/Production 적용 증거와 SMTP 수신 검증. BE-05는 FE 합의 후 구현. PR·외부 전송 미수행


### [DONE] 고객지원·개인정보 페이지 홈서버 전달 준비

- **목적**: 제공받은 HTML을 API와 분리된 Nginx 공개 경로에 배치할 수 있도록 전달 자료 준비
- **변경**: 고객지원 원본, 비공개 개인정보 초안, Nginx location 예시와 운영 절차 준비
- **영향범위**: 정적 문서 전달 자료만. API·DB·실제 홈서버 변경 없음
- **테스트**: 두 HTML byte 단위 원본 일치, 개인정보 초안의 drafts 분리와 공개용 privacy.html 부재 확인. 실제 Nginx·HTTP/TLS·실기기 검증 미수행
- **롤백**: 이번 전달 자료와 문서 항목 제거. 서버 적용 후에는 가이드의 백업 복구 절차 사용
- **다음**: 실제 Nginx 설정 확인 및 운영 정책 확정 후 서버 적용


## 2026-08-26

### [DONE] 개인 일정 삭제 API 보완 구현 및 Flutter 연동 가이드 작성

- **목적**: 승인된 개인 일정 삭제 설계를 실제 서버 계약으로 구현하고 Flutter에서 안전하게 연동할 수 있는 전달 문서를 제공
- **변경**:
  - `event_id` UUID path validation과 `400 INVALID_EVENT_ID` 응답 추가
  - JWT 사용자와 `owner_user_id`, `deleted_at IS NULL`을 한 `Event.update()` 조건에 포함하고 영향 row가 0이면 `EVENT_NOT_FOUND`로 처리
  - 성공 응답의 기존 `data.event_id`를 유지하면서 메시지를 추가하고 404 code를 일반 `NOT_FOUND`에서 `EVENT_NOT_FOUND`로 통일
  - `Calendar / DELETE /events/{event_id}` OpenAPI와 통합 Swagger 병합 추가
  - 서비스 원자적 update·not-found, route/controller/OpenAPI 계약 테스트 3건 추가
  - Flutter용 Dio DTO/Repository, AppError mapping, Riverpod 상태 흐름, 화면 UX, QA 체크리스트 가이드 작성
  - 설계 문서·ADR-0035·`PROJECT_CONTEXT.md`를 구현 상태로 동기화
- **영향범위**: 개인 일정 삭제 route/controller/service, 통합 OpenAPI, 테스트와 프론트 전달 문서. DB schema, Redis, 환경변수는 변경하지 않음
- **파일**: `src/{routes/calendarRoutes.ts,controllers/calendarController.ts,services/calendarService.ts,openapi.ts,openapi/calendarOpenApi.json}`, `test/eventDeletion.test.cjs`, `_docs/{EVENT_DELETION_API_DESIGN,EVENT_DELETION_FRONTEND_API_GUIDE,PROJECT_CONTEXT,DECISIONS,WORKLOG}.md`
- **테스트**: `npm run build` 성공, `node --test test/eventDeletion.test.cjs` 3 pass/0 fail, OpenAPI JSON parse 성공, `git diff --check` 성공. 전체 `npm test`에서 신규 일정 삭제 테스트는 통과했으나 현재 checkout에 없는 기존 Apple Stage migration·배포 Compose/workflow·프로필 migration과 기존 Apple Portal 문구 기준선 때문에 기존 무관 테스트가 실패함
- **롤백**: 이번 코드·OpenAPI·테스트·가이드·프로젝트 문서 변경을 되돌림. 이미 soft delete된 데이터는 코드 롤백으로 복구되지 않으므로 별도 운영 승인과 DB 복구 절차 필요
- **다음**: Stage에서 실제 JWT로 정상·잘못된 UUID·타인·중복 삭제와 본인·친구·그룹 캘린더 비노출 E2E를 확인하고 Flutter에 `EVENT_NOT_FOUND` mapping과 가이드를 전달

### [DONE] 개인 일정 삭제 API 현행 감사 및 보완 설계

- **목적**: 기존 개인 일정 삭제 구현의 HTTP 계약, 소유권 검증, soft delete, 멱등성, 동시성, 조회 비노출, 테스트 범위를 확인하고 구현 가능한 보완 설계를 확정
- **변경**:
  - 저장소에 이미 `DELETE /api/v1/events/:event_id`가 있음을 확인하고 중복 endpoint가 아닌 현행 보완 설계로 범위를 확정
  - UUID path 선검증, JWT 사용자와 `owner_user_id` 기준 권한, `event_id + owner_user_id + deleted_at IS NULL` 단일 원자적 update를 삭제 정본으로 결정
  - 미존재·타인 소유·이미 삭제를 `404 EVENT_NOT_FOUND`로 통합하고 최초 삭제만 `200`, 반복 삭제는 `404`인 strict 계약을 정의
  - 이벤트 비캐시와 본인·친구·그룹 조회의 `deleted_at IS NULL` 흐름을 확인해 DB migration·Redis 무효화·Outbox가 불필요함을 명시
  - HTTP 계약, 계층별 구현, 보안·정합성, OpenAPI, 동시성·공개 회귀 테스트, 배포·롤백, 완료 기준을 설계 문서에 기록
  - ADR-0035와 `PROJECT_CONTEXT.md`의 API·도메인·신규 문서 역할을 동기화
- **영향범위**: 개인 일정 삭제 API의 후속 구현 기준과 프로젝트 문서만 변경. 애플리케이션 코드·DB·Redis·환경변수는 변경하지 않음
- **파일**: `_docs/EVENT_DELETION_API_DESIGN.md`, `_docs/PROJECT_CONTEXT.md`, `_docs/DECISIONS.md`, `_docs/WORKLOG.md`
- **테스트**: `schema.drawio`, `visibility_flow.drawio`, `Event` 모델, 최종 DDL/view, 본인·친구·그룹 조회 코드를 정적 대조. `git diff --check`와 `npm run build` 성공
- **롤백**: 신규 설계 문서를 삭제하고 이번 `PROJECT_CONTEXT.md`, `DECISIONS.md`, `WORKLOG.md` 변경을 되돌림. soft delete 데이터나 실행 환경에는 영향 없음
- **다음**: 설계 승인 후 별도 구현 작업에서 route/controller/service, `calendarOpenApi.json`, 단위·격리 PostgreSQL 통합 테스트와 Flutter `EVENT_NOT_FOUND` mapping 반영

## 2026-08-21

### [DONE] 기존 Migration allowlist·테스트 fixture Git 추적 복원

- **목적**: 이번에 추가한 `migrations/`, `test/fixtures/` 전체 제외를 취소하되, 기존 migration allowlist 정책은 그대로 유지해 원래 커밋 대상이던 SQL과 테스트 fixture만 다시 Git 변경에 포함한다.
- **변경**: `.gitignore`를 기존 `migrations/*` + 명시적 허용 파일 목록으로 복원하고 `test/fixtures/` 전체 제외 규칙을 제거했다. staged deletion 상태였던 기존 migration과 fixture는 파일 내용 변경 없이 Git 추적 상태로 복원했다. 현재 SQL에서 실제 운영 credential·private key는 발견되지 않았고, 격리 DB의 `group_debug_local_only`만 테스트 전용 고정값으로 확인했다.
- **영향범위**: `.gitignore`, Git index의 기존 migration·fixture 추적 상태, 작업 기록. 기존 allowlist에 없는 migration은 계속 ignore된다.
- **롤백**: 이번 `.gitignore`와 문서 변경을 revert한다.
- **테스트**: credential/private-key 패턴 점검, `git check-ignore`와 `git status`로 기존 허용 파일·fixture는 추적되고 allowlist 외 migration은 계속 제외되는지 확인한다.
- **보안 기준**: migration에 실제 비밀번호, API·Access Key, private key, 운영 token 또는 실제 개인정보가 필요해지는 경우 해당 값을 SQL에 기록하지 않고 placeholder·환경별 비밀 저장소로 분리한다. 이미 커밋·푸시된 비밀은 `.gitignore`만 추가하지 말고 즉시 자격증명을 폐기·교체하고 Git 이력 정리 필요성을 별도로 검토한다.
- **다음**: 새 migration을 원격에 올려야 할 때만 `.gitignore` allowlist에 해당 파일을 명시적으로 추가하고, 추가 전 민감정보 점검을 수행한다.

### [DONE] 단일 S3 버킷의 Stage·Center prefix 격리

- **목적**: 운영자 결정에 따라 프로필 이미지 버킷은 Stage와 Center가 공유하되, 버킷 태그가 제공하지 못하는 객체 쓰기·삭제 권한 경계를 환경별 prefix와 IAM Resource로 강제한다.
- **변경**: 저장 key를 `<storage_prefix>/profiles/{user_id}/{uuid}.{ext}`로 변경하고 `PROFILE_IMAGE_STORAGE_PREFIX`를 `local|test|stage|center`로 제한했다. Stage는 `stage/profiles/*`, Center는 `center/profiles/*`만 접근하도록 IAM 예시를 수정하고, 단일 버킷 공유·별도 IAM credential·버킷 태그의 운영 분류 전용 원칙을 ADR-0034와 가이드에 기록했다.
- **영향범위**: 프로필 이미지 S3 key, IAM 정책 예시, 환경변수, 테스트와 설계 문서. 실제 AWS 정책·태그·홈서버 환경은 자동 변경하지 않는다.
- **롤백**: 코드·문서 변경을 revert하고 아직 이미지가 저장되지 않은 경우에만 기존 `profiles/*` 정책으로 되돌린다. 객체 저장 이후 prefix 제거는 별도 데이터 이관 계획 없이 수행하지 않는다.
- **파일**: `src/{services/profileImageStorageService.ts,config/environment.ts}`, `.env.example`, `test/profileCompletion*.test.cjs`, `_docs/{PROFILE_COMPLETION_GUIDE,PROJECT_CONTEXT,DECISIONS,WORKLOG}.md`.
- **테스트**: `npm run build` 성공, 프로필 단위·정적 테스트 6 pass/0 fail, `test` prefix가 포함된 Put/Delete 동일 key와 허용되지 않은 prefix 거절을 확인했고 `git diff --check`를 통과했다. 실제 AWS 정책과 홈서버 환경은 변경하지 않았다.
- **다음**: 생성된 Stage IAM 정책 Resource를 `<bucket>/stage/profiles/*`로 교체하고 홈서버 Stage에 `PROFILE_IMAGE_STORAGE_PREFIX=stage`를 설정한다. Center는 별도 IAM 사용자·정책으로 `<bucket>/center/profiles/*`만 허용하고 `PROFILE_IMAGE_STORAGE_PREFIX=center`를 사용한다.

### [DONE] Stage 프로필 이미지 전용 IAM 사용자·정책 생성 확인

- **목적**: 홈서버 Stage API가 비공개 S3의 `profiles/*` 객체에만 접근하도록 장기 자격증명의 권한 경계를 확정한다.
- **확인된 외부 변경**: 운영자가 콘솔 로그인이 없는 `shiftmate-stage-profile-images-api` IAM 사용자를 생성하고 고객 관리형 `ShiftMateProfileImagesAccess` 정책을 연결했다. 정책은 Stage 프로필 이미지 버킷의 `profiles/*`에 `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`만 허용한다. Access Key 사용 사례는 홈서버 배포에 맞게 `AWS 외부에서 실행되는 애플리케이션`으로 선택했다.
- **보안 확인**: 실제 버킷 이름·전체 ARN·Access Key ID·Secret Access Key는 문서에 기록하지 않는다. 정책 JSON의 객체 ARN은 공백·말줄임표·이스케이프 없이 `arn:aws:s3:::<STAGE_BUCKET>/profiles/*` 형식이어야 한다.
- **영향범위**: AWS Stage IAM 사용자·고객 관리형 정책과 향후 홈서버 API credential. 저장소 코드·DB·실제 홈서버 환경은 이번 확인에서 변경하지 않는다.
- **롤백**: 발급 전에는 IAM 사용자 또는 연결 정책을 제거한다. 발급 후에는 Access Key를 먼저 비활성화하고 사용 여부를 확인한 다음 삭제하며, 버킷과 객체는 별도 승인 없이 삭제하지 않는다.
- **테스트**: 제공된 IAM 검토 화면에서 콘솔 암호 없음, 정책 1개 연결, 외부 애플리케이션 Access Key 용도 선택을 확인했다. 실제 정책 원문과 S3 API smoke test는 credential을 공유받지 않았으므로 수행하지 않았다.
- **다음**: Access Key 발급 뒤 원문을 노출하지 않고 `/opt/shiftmate-stage/.env`에 설치한다. 비공개 조회 API 구현 후 Put/Get/Delete 최소 권한 smoke test를 수행한다.

### [DONE] Stage 프로필 이미지 S3 비공개 버킷 생성 기록과 IAM 연결 안내

- **목적**: 운영자가 생성한 Stage 프로필 이미지 S3 버킷의 확정 보안 설정을 기록하고, API 서버가 객체에 최소 권한으로 접근할 IAM 연결 위치를 명확히 한다.
- **확인된 외부 변경**: 운영자가 Stage 프로필 이미지 전용 S3 버킷을 생성했다. 버전 관리·Object Lock·S3 버킷 키는 비활성화하고, 퍼블릭 액세스 네 항목은 모두 차단했으며, Object Ownership은 Bucket owner enforced, 기본 암호화는 SSE-S3로 구성했다. `Service=shiftmate`, `Environment=stage`, `Purpose=profile-images`, `DataClassification=user-content` 태그를 적용했다.
- **변경**: 홈서버 Docker 배포에서는 S3 ARN을 애플리케이션 환경변수에 넣지 않고 `arn:aws:s3:::<STAGE_BUCKET>/profiles/*`를 Stage 전용 IAM 정책의 객체 `Resource`에 사용하도록 정리했다. `GetObject`/`PutObject`/`DeleteObject` 최소 권한, 전용 IAM 사용자와 외부 실행용 Access Key, `/opt/shiftmate-stage/.env`의 버킷 이름·리전·credential 위치를 가이드에 추가했다. 현재 코드는 공개 URL 생성만 지원하고 인증된 비공개 조회 스트리밍은 미구현이라는 배포 차단 조건도 명시했다.
- **영향범위**: AWS IAM 정책 연결 위치, 서버 환경변수와 프로필 완료 운영 문서. 이 작업에서는 AWS 콘솔·IAM·실제 서버 환경을 직접 변경하지 않는다.
- **미확인 값**: 실제 버킷 이름·버킷 ARN·API 서버 실행 IAM 주체는 제공되지 않아 문서나 코드에 추정값을 기록하지 않는다.
- **롤백**: 문서 변경을 revert한다. AWS 버킷 삭제나 정책 변경은 별도 승인과 객체 존재 확인 없이는 수행하지 않는다.
- **파일**: `_docs/PROFILE_COMPLETION_GUIDE.md`, `_docs/WORKLOG.md`.
- **테스트**: 홈서버 Stage 배포 경로와 현재 storage 환경 검증·SDK 동작을 코드/문서에서 대조했고 `git diff --check`를 통과했다. 실제 S3/IAM smoke test는 버킷 이름·ARN·credential이 제공되지 않아 수행하지 않았다.
- **다음**: 운영자가 실제 Stage 버킷 이름으로 IAM 정책을 생성·전용 사용자에 연결하고 Access Key를 홈서버에 설치한다. 비공개 이미지 조회 API와 DB object key 전환을 구현한 뒤에만 Stage 이미지 업로드·조회·교체·삭제 E2E를 수행한다.

## 2026-08-20

### [DONE] 가입 프로필 완료 API와 Stage/Center DB migration

- **목적**: OAuth 신규 사용자가 앱 재시작 뒤에도 가입 프로필 필요 상태를 복구하고, 이름·전화번호·타임존과 선택 근무 정보를 원자적으로 완료하며 검증된 프로필 이미지를 object storage에 저장한다.
- **변경**: `users.job_type`, `workplace`, `profile_completed_at` expand/backfill/down migration과 Stage/Center pgAdmin 승인형 단일 실행 쿼리를 추가했다. 가입 완료·일반 편집을 service transaction/row lock으로 이동하고 `requires_profile_setup`, phone unique 409, JSON·multipart, JPEG/PNG/WebP 내용 검증, 5MB/1파일 제한, S3 호환 UUID key 저장과 DB 실패 object 삭제를 구현했다. 네 OAuth·본인 프로필 응답, 친구 목록 phone 비노출, OpenAPI·환경 검증·정본 schema/draw.io·운영 가이드를 동기화했다.
- **영향범위**: 인증·본인 프로필 API, `users` 모델/스키마, 환경변수와 배포 선행조건, 친구 목록 개인정보 응답, 문서와 테스트. 실제 Stage/Center DB 적용과 서버 배포는 수행하지 않는다.
- **파일**: `src/{models/User.ts,services/profileService.ts,services/profileImageStorageService.ts,middlewares/profileImageUpload.ts,controllers/authController.ts,routes/authRoutes.ts,openapi.ts,openapi/profileAuthOpenApi.json}`, OAuth OpenAPI·환경·친구/fixture 연계 파일, `migrations/*profile_completion*`, `migrations/final_schema.sql`, `test/profileCompletion*.test.cjs`, `schema.drawio`, `.env.example`, `_docs/{PROFILE_COMPLETION_GUIDE,PROJECT_CONTEXT,DECISIONS,WORKLOG}.md`, package manifest/lockfile.
- **롤백**: Flutter 배포 전에는 신규 route를 호환 유지한 채 이전 서버 이미지로 복귀하고 add-only 컬럼은 보존한다. 신규 컬럼 제거는 사전 데이터 감사와 별도 승인형 rollback SQL로만 수행한다.
- **테스트**: TypeScript build 성공. 관련 회귀 53 pass/8 명시적 integration skip/0 fail, profile 단위·정적 6 pass, 격리 PostgreSQL 16 profile 통합 8 pass(범용 up/backfill/down, Stage·Center pgAdmin 전체 commit, 완료 멱등·rollback, multipart 400/413/200, object cleanup·503), OpenAPI JSON·draw.io XML parse와 `git diff --check` 성공. `npm audit --omit=dev --audit-level=high`은 high/critical 0, 기존 Firebase Admin 간접 `uuid` moderate 8을 보고했다. 전체 `npm test`는 이번 변경과 무관하게 현재 checkout에 없는 Apple Stage SQL·배포 Compose/workflow를 읽는 기존 테스트와 Apple Portal 문구 기준선에서 실패하므로 결과를 분리했다. 테스트용 Docker PostgreSQL 컨테이너·volume은 종료·삭제했다.
- **다음**: 운영자는 가이드 순서대로 Stage 백업 복원 시험 → Stage SQL의 backup placeholder 교체·전체 실행 → 환경별 bucket/CDN Put/Delete/HTTPS GET smoke → 서버·네 OAuth·Flutter 가입 재개 E2E를 완료한 뒤 Center와 Flutter Production을 순차 배포한다. 이번 작업에서 실제 Stage/Center DB와 object storage는 변경하지 않았다.

## 2026-08-17

### [DONE] Kakao Admin Key plain-text secret 예시 추가

- **목적**: 운영자가 Admin Key를 가공하지 않고 올바른 파일명·한 줄 형식으로 설치하면서 실제 credential은 Git에서 차단하도록 한다.
- **변경**: main 전용 `deploy/secrets/kakao_admin_key.example`에 가짜 placeholder 한 줄을 추가하고, 실제 `deploy/secrets/*` credential은 ignore하되 예시만 추적하도록 했다. 실제 파일에는 Admin Key 원문만 넣고 `KakaoAK` 접두사·따옴표·공백을 넣지 않는 규칙을 문서와 테스트에 고정했다.
- **영향범위**: 배포 예시·문서·정적 테스트만 변경하며 실제 Stage/Production secret 파일은 생성하거나 수정하지 않는다.
- **롤백**: 예시와 문서·테스트 변경을 revert한다. 실제 홈서버 secret에는 영향이 없다.
- **파일**: `deploy/secrets/kakao_admin_key.example`, `.gitignore`, `test/deploymentCacheRollout.test.cjs`, `_docs/{PROJECT_CONTEXT,CI_CD_DEPLOYMENT_GUIDE,WORKLOG}.md`, `deploy/DEPLOY_README.md`.
- **테스트**: `npm test` 83건 중 76 pass/7 explicit integration skip/0 fail, 실제 secret ignore·예시 추적 확인, 두 배포 문서 byte 일치, `git diff --check` 성공.
- **다음**: 운영자는 예시 파일을 직접 수정하지 않고 환경별 홈서버의 확장자 없는 `secrets/kakao_admin_key` 파일을 별도로 생성해 `root:root 0444`로 설치한다.

### [DONE] Kakao 변경의 develop 공통 코드와 main 배포 보안 자산 분리

- **목적**: Kakao SDK 토큰 로그인 공통 구현은 develop을 통해 main에 병합하고, 운영 topology와 secret preflight 등 배포 보안 자산은 main에만 유지한다.
- **변경 예정**: 공통 소스·OpenAPI·테스트·개발 문서를 develop에 커밋한 뒤 main에 병합하고, Compose·배포 workflow/script·Stage 전환 SQL·운영 문서를 main 전용 커밋으로 분리한다.
- **영향범위**: `develop`, `main` 로컬 브랜치의 커밋 이력과 Kakao 인증/배포 문서. 실제 Stage/Production 배포와 외부 Kakao 앱 설정은 수행하지 않는다.
- **롤백**: develop 공통 커밋과 main merge/main 전용 커밋을 각각 revert하며, 실제 운영 secret이나 DB는 이번 Git 작업에서 변경하지 않는다.
- **테스트 예정**: 브랜치별 파일 존재 경계, develop `npm test`, main 전체 테스트·배포 정적 계약·문법·diff 검증.

## 2026-08-16

### [DONE] 카카오 SDK Access Token 로그인 공통 코드

- **목적**: Flutter 카카오 SDK 토큰 로그인에서 토큰 발급 앱과 회원번호를 서버가 검증하고, 사용자 provisioning·JWT 발급과 탈퇴 Admin Key를 안전한 단일 운영 경계로 정리한다.
- **변경**: `access_token_info`의 App ID·회원번호와 `user/me` 회원번호를 DB 진입 전에 검증하고, 5초 timeout·무재시도·공개 오류 매핑을 적용했다. 사용자 연결/생성, 기본 템플릿, Refresh Token을 advisory lock·row lock이 포함된 단일 transaction으로 묶고 성공 응답에 `request_id`·`is_new_user`를 추가했다. Admin Key는 탈퇴 worker가 파일에서만 읽도록 바꾸고 Kakao OpenAPI·통합 fixture·레거시 7일 관찰 로그를 추가했다.
- **영향범위**: 카카오 공개 인증 API, 인증 DB transaction, 환경 검증, 회원 탈퇴 provider, OpenAPI와 개발 문서. DB 스키마와 친구/캘린더 공개 규칙은 변경하지 않는다.
- **롤백**: 공통 구현 커밋을 revert하되 App ID 검증 장애는 검증을 해제하지 않고 환경별 앱 설정을 수정한다.
- **파일**: `src/{config/environment,controllers/authController,routes/authRoutes,services/kakaoService,services/accountDeletionProviderService,utils/logger,openapi}.ts`, `src/openapi/kakaoAuthOpenApi.json`, `test/{kakaoAuth,kakaoAuthIntegration,environmentValidation}.test.cjs`, `test/fixtures/kakaoAuthIntegrationSchema.sql`, `.env.example`, `_docs/{PROJECT_CONTEXT,DECISIONS,OAUTH_API_GUIDE,WORKLOG}.md`.
- **테스트**: TypeScript build, `test/{kakaoAuth,environmentValidation}.test.cjs` 14 pass/0 fail, Kakao 검증 순서·공개 오류·로그 비노출·unlink와 OpenAPI 계약, `git diff --check` 성공. develop 전체 `npm test`는 이 변경과 무관하게 main 전용 Apple Stage migration·Compose/workflow가 없는 기존 브랜치에서 해당 파일을 읽는 테스트가 실패하므로 main 병합 후 전체 검증한다. 격리 PostgreSQL 통합 테스트는 Docker DB가 있을 때 `npm run test:kakao-integration`으로 실행한다.
- **다음**: develop 공통 커밋을 main에 병합한 후 main 전용 Compose·배포 workflow/script·Stage 전환 SQL과 운영 문서를 별도 커밋한다.

### [DONE] 프로세스별 worker secret 환경 검증 분리

- **목적**: Stage worker flag 활성화 시 API·cache worker까지 Firebase/Kakao worker 전용 secret을 요구하며 전체 서비스가 시작 실패하는 문제를 해결한다.
- **변경**: 공통 환경 검증에서 push/회원 탈퇴 worker 전용 필수값 검사를 분리해 각 worker 엔트리포인트에서만 실행하고, 누락 key를 secret 값 없이 구조화 로그에 남긴다.
- **영향범위**: API/cache/push/회원 탈퇴 worker 시작 검증과 배포 장애 진단. feature flag 값과 secret 자체는 변경하지 않는다.
- **파일**: `src/config/environment.ts`, `src/utils/logger.ts`, `src/workers/{pushWorker,accountDeletionWorker}.ts`, `test/environmentValidation.test.cjs`, `_docs/{PROJECT_CONTEXT,WORKLOG}.md`.
- **테스트**: TypeScript build, 공통/Push/회원 탈퇴 프로세스 환경 검증·안전 로그와 기존 회원 탈퇴 테스트 10건, `git diff --check` 성공. develop에는 main 전용 배포 파일이 없어 전체 테스트는 main 병합 후 실행한다.
- **롤백**: 변경을 revert하고 worker 전용 secret을 모든 프로세스에 주입해야 한다.
- **다음**: main 병합 후 전체 테스트와 Stage의 API·세 worker health를 다시 확인한다. 탈퇴 worker가 `KAKAO_ADMIN_KEY` 누락으로 실패하면 새 구조화 로그의 `environment_variable`을 기준으로 호스트 secret을 보완한다.

### [DONE] 전체 schema의 초기화 역할 이식성 수정

- **목적**: `POSTGRES_USER=group_debug` 격리 DB에 존재하지 않는 `postgres` 역할로 GRANT해 회원 탈퇴 통합 테스트가 실패하는 문제를 해결한다.
- **변경**: 전체 초기화 DDL의 schema 권한 대상을 고정 역할 대신 `CURRENT_USER`로 변경하고, 통합 hook 오류에 PostgreSQL 원문 메시지를 보존한다.
- **영향범위**: 파괴적 로컬/CI 전체 schema 초기화와 회원 탈퇴 통합 테스트 진단. 증분 운영 migration은 변경하지 않는다.
- **파일**: `migrations/final_schema.sql`, `test/{accountDeletion,accountDeletionIntegration}.test.cjs`, `_docs/WORKLOG.md`.
- **테스트**: TypeScript build, 회원 탈퇴 단위·정적 테스트 6건, `final_schema.sql`의 고정 DB 역할 잔존 검사, `git diff --check` 성공. 실제 PostgreSQL 통합 시나리오는 main CI에서 재확인한다.
- **롤백**: 변경을 revert하되 실행 DB에 `postgres` 역할이 존재해야 한다.
- **다음**: develop 병합 후 main CI에서 전체 schema 초기화와 삭제 시나리오를 다시 실행한다.

### [DONE] 회원 탈퇴 통합 테스트의 psql 메타 명령 분리

- **목적**: Sequelize가 `final_schema.sql`의 psql 전용 `\set`을 SQL로 실행해 CI가 실패하는 문제를 해결한다.
- **변경**: 통합 테스트 fixture 로더가 줄 시작의 psql 메타 명령을 제거한 뒤 PostgreSQL protocol로 실행하도록 제한한다.
- **영향범위**: 회원 탈퇴 PostgreSQL 통합 테스트의 스키마 초기화 경로만 변경하며 migration 정본은 유지한다.
- **파일**: `test/accountDeletionIntegration.test.cjs`, `_docs/WORKLOG.md`.
- **테스트**: TypeScript build, 회원 탈퇴 단위 테스트 6건, driver 전달 SQL의 psql meta command 제거 검사, `git diff --check` 성공. 로컬 PostgreSQL 55432가 없어 실제 통합 실행은 CI 재실행으로 확인한다.
- **롤백**: 해당 테스트 loader 변경을 revert한다.
- **다음**: develop 병합 후 main CI에서 schema 초기화와 전체 삭제 시나리오가 완료되는지 확인한다.

### [DONE] config 기반 회원 탈퇴 API·worker 배포 제어

- **목적**: 호스트 `.env`가 아닌 저장소 추적 `deploy/config/feature-flags.{stage,production}.env`를 정본으로 회원 탈퇴 API 접수와 전용 worker 처리를 환경별 제어한다.
- **변경**: Stage 1개와 Center Blue/Green 색상별 account deletion worker를 추가하고 tracked feature flag config, Apple secret, worker 전용 DB pool, migration-aware healthcheck를 연결했다. 동일 image 적용·health gate·최초 도입 호환 rollback에 worker를 포함하고, 탈퇴 API만 켜지는 위험한 config 조합을 배포 전에 거절한다. main 이미지 build 전에 회원 탈퇴 PostgreSQL 통합 테스트도 실행한다.
- **영향범위**: 환경별 6개 feature flag 정본, Stage/Center Compose topology, 배포 엔진 rollback, worker health, CI와 운영 문서.
- **파일**: `deploy/compose.{stage,production}.yaml`, `deploy/shiftmate-deploy`, `deploy/stage.deploy.env.example`, `src/workers/accountDeletionWorker.ts`, `.github/workflows/deploy-production.yml`, `test/{accountDeletion,appleAuth,deploymentCacheRollout}.test.cjs`, `_docs/{PROJECT_CONTEXT,DECISIONS,CI_CD_DEPLOYMENT_GUIDE,WORKLOG}.md`, `deploy/DEPLOY_README.md`.
- **테스트**: `npm test` 60 pass/6 skip, `bash -n`, Ruby YAML parse, Stage/Center `docker compose config --quiet`, 배포 문서 `cmp`, `git diff --check` 성공. 로컬 Docker daemon과 PostgreSQL 55432가 없어 destructive fixture를 쓰는 회원 탈퇴 integration은 로컬에서 실행하지 않았고 main build job에서 필수 실행하도록 추가했다.
- **롤백**: config에서 `ACCOUNT_DELETION_ENABLED=false`, `ACCOUNT_DELETION_WORKER_ENABLED=false`를 선행 배포하고 이전 이미지로 rollback한다. DB 스키마와 진행 요청은 보존한다.
- **다음**: Stage/Center DB migration과 secret 준비 후 Stage config의 두 탈퇴 flag를 함께 활성화해 실제 Apple/Kakao·DB purge·Redis tombstone E2E를 검증한다. 현재 두 config 값은 모두 `false`로 유지한다.

### [DONE] Git 정본 feature flag config 자동 배포

- **목적**: 홈서버의 Stage/Center `.env`를 사람이 직접 수정하지 않고, 저장소의 환경별 feature flag config 변경을 main 배포와 같은 검증·원자 적용·롤백 경로로 반영한다.
- **변경**:
  - Stage/Production별 `deploy/config/feature-flags.*.env`를 추가하고 cache, push enqueue/worker, API docs, 회원 탈퇴 API/worker의 정확한 6개 boolean key만 허용
  - launcher가 두 config의 exact source SHA tree mode/blob을 검증하고 root 임시 bundle에 포함
  - 배포 엔진이 key 누락·중복·미등록 key·`true|false` 외 값을 거절한 뒤 두 config와 base Compose를 원자 설치
  - Compose가 `.env` 다음에 `feature-flags.env`를 읽어 API/cache worker/push worker에 같은 환경별 flag를 주입
  - 최초 전환 때 홈서버 `.env`의 동일 6개 key line만 값 노출 없이 자동 제거하고, 전체 실패 시 직전 config·Compose·정리 전 `.env`를 함께 복원
  - 로컬 `.env.example`, PROJECT_CONTEXT, ADR-0030과 동일한 CI/CD 운영 문서를 새 정본 계약으로 갱신
- **영향범위**: 배포 config/launcher/Compose/rollback, 정적 테스트, 환경변수 예시와 운영 문서. DB 스키마와 secret 값은 변경하지 않는다.
- **파일**: `deploy/config/*`, `deploy/{compose.production.yaml,compose.stage.yaml,shiftmate-deploy-launcher,shiftmate-deploy}`, `test/deploymentCacheRollout.test.cjs`, `.env.example`, `_docs/{PROJECT_CONTEXT,DECISIONS,CI_CD_DEPLOYMENT_GUIDE,WORKLOG}.md`, `deploy/DEPLOY_README.md`
- **테스트**:
  - `npm test`: 59 pass, 명시적 integration 6 skip, 0 fail
  - 배포 정적 계약 16 pass, launcher/deploy/bootstrap `bash -n`, sudoers `visudo -cf` 통과
  - Docker Compose v2.38.2로 임시 Stage/Center project와 실제 두 flag config를 합성해 `config --quiet` 통과
  - workflow/Compose YAML parse, 두 CI/CD 문서 byte 일치, `git diff --check` 통과
- **롤백**: 변경 커밋을 revert해 `.env` 기반 flag 주입으로 복귀한다. 배포 도중 실패하면 배포 엔진이 직전 Compose와 환경별 flag config를 함께 자동 복원하도록 한다.
- **다음**: 첫 배포 전에 Stage/Production 파일의 6개 값이 현재 의도한 운영 상태인지 검토하고, 변경된 bundle 계약 때문에 홈서버 고정 launcher를 1회 갱신한 뒤 main 배포를 실행한다.

### [DONE] main 정본 Stage/Center base Compose 자동 동기화

- **목적**: `deploy/compose.stage.yaml`과 `deploy/compose.production.yaml` 변경을 main 배포 시 홈서버 실행 경로에 자동 반영해 수동 `install` 작업과 정본 불일치를 제거한다.
- **변경**:
  - launcher가 exact source SHA에서 배포 엔진 `100755`와 Stage/Center Compose `100644`의 mode·blob을 검증하고 root 전용 `/run` 임시 번들로 복사
  - 배포 엔진이 두 source Compose를 실제 홈서버 project directory 기준으로 문법 검사하고 Center blue/green 전체 서비스와 Stage 네 서비스 존재를 설치 전에 강제
  - 기존 두 base Compose를 백업하고 target directory 임시 파일에 `root:root 0644`로 쓴 뒤 `mv`로 원자 교체
  - 배포 실패 시 새 구성의 target/Stage 서비스를 먼저 중지하고 두 base Compose, Stage override, 상태와 upstream을 직전 상태로 복원
  - `.env`, `.deploy.env`, `secrets/`, DB는 자동 쓰기 범위에서 제외하고 PROJECT_CONTEXT, ADR-0029와 동일한 CI/CD 가이드를 갱신
- **영향범위**: root launcher 검증 경계, Stage/Center base Compose 설치·rollback, 배포 정적 테스트와 CI/CD 운영 문서. `.env`, `.deploy.env`, `secrets/`, DB는 변경하지 않는다.
- **파일**: `deploy/{shiftmate-deploy-launcher,shiftmate-deploy}`, `test/deploymentCacheRollout.test.cjs`, `_docs/{PROJECT_CONTEXT,DECISIONS,CI_CD_DEPLOYMENT_GUIDE,WORKLOG}.md`, `deploy/DEPLOY_README.md`
- **테스트**:
  - `npm test`: 58 pass, 명시적 integration 6 skip, 0 fail
  - launcher/deploy `bash -n`, 배포 정적 테스트 15 pass
  - Docker Compose v2.38.2로 임시 Center/Stage project directory와 source Compose `config --quiet` 통과
  - Compose/workflow YAML parse, CI/CD 정본과 배포 README byte 일치, `git diff --check` 통과
  - 로컬에 `shellcheck`가 없어 별도 실행하지 못했으며 `Validate main` workflow의 Bash 검증으로 보완
- **롤백**: 변경 커밋을 revert하고 기존 수동 base Compose 설치 정책으로 복귀한다. 배포 중 실패 시 스크립트가 서버의 직전 Compose 파일을 자동 복원한다.
- **다음**: 커밋을 main에 push한 뒤 홈서버 runner checkout의 SHA를 확인하고 고정 launcher를 1회 갱신한다. 첫 자동 run이 구형 launcher 인자 계약으로 실패하면 갱신 후 failed job을 재실행하며, 이후 Compose 변경은 자동 반영된다.

## 2026-08-15

### [DONE] main 정본 배포 엔진 자동 반영 launcher 전환

- **목적**: 홈서버의 배포 엔진을 매번 수동 교체하지 않고, main의 정확한 커밋에 포함된 `deploy/shiftmate-deploy`가 자동 배포와 수동 롤백에 사용되게 한다.
- **변경**:
  - root 소유 고정 launcher가 repository/actor/workspace/source SHA/Git tree mode·blob/image SHA를 검증하고 `/run`의 root 임시 복사본만 초기화한 환경으로 실행
  - Deploy workflow에 main push trigger와 self-hosted exact-SHA checkout을 추가하고, 수동 실행 confirm 경로도 유지
  - Rollback workflow는 현재 main의 검증된 배포 엔진으로 지정한 과거 SHA 이미지를 배포
  - sudoers 직접 실행 대상을 기존 배포 엔진에서 launcher로 축소하고 main branch protection·최초 1회 설치·긴급 rollback 절차 문서화
  - main PR에서 build·정적 계약·Bash·sudoers·YAML·문서 동기화를 확인하는 `Validate main` 필수 check 추가
  - 배포 정적 테스트, PROJECT_CONTEXT와 ADR-0028 갱신
- **영향범위**: GitHub Actions 배포/롤백 workflow, 홈서버 sudo trust boundary, 배포 스크립트 실행 경로와 운영 문서. 애플리케이션 런타임과 DB 스키마는 변경하지 않는다.
- **파일**: `deploy/{shiftmate-deploy-launcher,sudoers/github-runner-shiftmate}`, `.github/workflows/{validate-main,deploy-production,rollback-production}.yml`, `test/deploymentCacheRollout.test.cjs`, `_docs/{PROJECT_CONTEXT,DECISIONS,CI_CD_DEPLOYMENT_GUIDE,WORKLOG}.md`, `deploy/DEPLOY_README.md`
- **테스트**:
  - `npm test`: 57 pass, 명시적 integration 6 skip, 0 fail
  - launcher/deploy/bootstrap `bash -n` 통과
  - `visudo -cf deploy/sudoers/github-runner-shiftmate` 통과
  - Validate/Deploy/Rollback workflow와 Stage/Center Compose YAML parse 통과
  - CI/CD 정본과 배포 README byte 일치, `git diff --check` 통과
- **롤백**: launcher 호출과 checkout을 revert하고 기존 root 소유 `/usr/local/sbin/shiftmate-deploy` 직접 실행 정책으로 복귀한다. 홈서버 sudoers 복원은 별도 승인된 root 작업으로 수행한다.
- **다음**: main push 전에 홈서버에 launcher와 새 sudoers를 최초 1회 설치하고 branch protection을 설정한다. 이후 `deploy/shiftmate-deploy` 변경은 main commit checkout을 통해 자동 반영한다.

## 2026-08-14

### [DONE] 비정상 Stage가 배포 복구를 차단하는 사전 health gate 수정

- **목적**: 기존 Stage API가 중지·재시작 중이거나 unhealthy인 경우에도 새 불변 이미지로 Stage를 복구하고, 새 Stage 검증 실패 시에만 기존 상태로 롤백할 수 있게 한다.
- **변경**:
  - 기존 Stage readiness의 30회 재시도·즉시 실패를 단일 진단 검사로 변경
  - 실패 시 Stage API Compose 상태와 최근 200줄 로그를 남기고 GHCR pull 및 새 Stage 적용을 계속
  - 새 Stage API readiness와 cache/push worker health는 기존 필수 gate로 유지하고 실패 시 이전 override 복원
  - 정적 회귀 테스트, PROJECT_CONTEXT, ADR-0027과 동일한 두 CI/CD 운영 문서를 갱신
- **영향범위**: `deploy/shiftmate-deploy`의 배포 시작 전 Stage 검사, 배포 정적 테스트, CI/CD 문서. 애플리케이션 런타임과 DB 스키마는 변경하지 않는다.
- **파일**: `deploy/shiftmate-deploy`, `test/deploymentCacheRollout.test.cjs`, `_docs/{PROJECT_CONTEXT,DECISIONS,CI_CD_DEPLOYMENT_GUIDE,WORKLOG}.md`, `deploy/DEPLOY_README.md`
- **테스트**:
  - `npm test`: 55 pass, 명시적 integration 6 skip, 0 fail
  - `bash -n deploy/shiftmate-deploy` 통과
  - CI/CD 정본과 배포 README byte 일치 확인
- **롤백**: 해당 배포 스크립트·테스트·문서 변경을 revert하고 기존 Stage 사전 readiness 필수 정책으로 복귀한다.
- **다음**: 변경을 배포 `main`에 반영한 뒤 홈서버의 root 소유 `/usr/local/sbin/shiftmate-deploy`를 새 파일로 교체하고 workflow를 새로 실행한다. 새 Stage도 실패하면 이제 출력되는 `server_start_failed`와 환경변수·DB 오류를 기준으로 원인을 해결한다.

### [DONE] Apple·Google 로그인 상시 활성화와 배포 빌드 검증

- **목적**: Apple·Google 로그인을 `.env` boolean feature flag 없이 항상 사용할 수 있게 하고, 배포 시 `true` 환경값 처리 때문에 빌드가 실패하지 않도록 검증한다.
- **변경**:
  - 인증 서비스와 시작 환경 검증에서 `APPLE_AUTH_ENABLED`, `GOOGLE_AUTH_ENABLED` 분기 및 비활성 오류 계약을 제거하고 두 로그인을 항상 활성화
  - `.env`/`.env.example`에서 두 boolean 변수를 제거하고 Apple/Google 필수 설정을 시작 전에 항상 검증
  - Apple 선택적 Compose override 2개를 제거하고 Stage/Center base Compose가 API에만 `.p8`을 상시 mount하도록 변경
  - 배포 스크립트의 boolean 파싱과 `true`/override 분기를 제거하고 두 환경 `.p8` 존재·`root:root 0444`를 항상 사전 검증
  - OpenAPI의 `APPLE_AUTH_DISABLED`/`GOOGLE_AUTH_DISABLED` 계약, 관련 테스트·운영 가이드 제거 및 ADR-0026 추가
- **영향범위**: Apple·Google public 인증 endpoint, API 시작 전 환경 검증, Stage/Center Compose 및 배포 preflight, 인증 계약 테스트와 문서.
- **브랜치 적용 경계**:
  - `develop`: `.env.example`, `src/config`, `src/services`, `src/openapi`, 범용 migration, Apple·Google 인증 테스트와 공개 프로젝트/OAuth 문서
  - 배포 `main`: `develop` 대상 전체에 더해 `deploy/`, `_docs/CI_CD_DEPLOYMENT_GUIDE.md`, 배포 전용 Stage migration·정적 테스트를 포함한 완전한 배포 이미지 정본
- **파일**: `src/{config/environment.ts,services/appleService.ts,services/googleService.ts,openapi/appleAuthOpenApi.json,openapi/googleAuthOpenApi.json}`, `deploy/{compose.production.yaml,compose.stage.yaml,shiftmate-deploy}`, 삭제된 `deploy/compose.apple-auth.{production,stage}.yaml`, `.env.example`, 인증·배포 테스트, OAuth migration 안내문, `_docs/{PROJECT_CONTEXT,DECISIONS,APPLE_SIGN_IN_SERVER_GUIDE,GOOGLE_SIGN_IN_SERVER_GUIDE,OAUTH_API_GUIDE,DEPLOYMENT_GUIDE,CI_CD_DEPLOYMENT_GUIDE,WORKLOG}.md`, `deploy/DEPLOY_README.md`
- **테스트**:
  - `npm test`: 54 pass, 명시적 integration 6 skip, 0 fail
  - `APPLE_AUTH_ENABLED=true GOOGLE_AUTH_ENABLED=true npm run build`: 성공. 구형 `true` 값이 남아 있어도 빌드 경로가 읽지 않음을 확인
  - Stage/Center `docker compose config --quiet`, Bash 문법, OpenAPI JSON parse, 배포 문서 byte 일치, `git diff --check`: 모두 통과
  - 실제 `linux/amd64` Docker image build는 로컬 Docker daemon 미실행으로 수행하지 못함. Dockerfile은 build 단계에서 런타임 OAuth 환경변수를 읽지 않음
- **롤백**: 본 변경 파일을 revert하고 기존 feature flag 기반 활성화 정책으로 복원한다.
- **다음**: 배포 호스트의 Stage/Center `.env`에서도 두 구형 변수를 제거하고, 두 환경의 Apple `.p8` 및 필수 OAuth 값을 준비한 뒤 CI의 `linux/amd64` image build와 Stage 실기기 로그인을 확인한다.

### [DONE] develop 브랜치 Apple·Google 로그인 상시 활성화 적용

- **목적**: 배포 `main` 전용 파일을 제외하고 Apple·Google 로그인 상시 활성화 개발 변경을 공개 `develop` 브랜치에 반영한다.
- **변경**:
  - Apple·Google 서비스의 boolean gate와 `*_AUTH_DISABLED` 오류를 제거하고 항상 활성화
  - `.env.example`에서 두 flag를 제거하고 필수 OAuth 설정을 시작 전에 항상 검증
  - OpenAPI, 범용 Google rollback 안내, 단위·통합 테스트와 공개 Apple/Google/OAuth 문서를 상시 활성 계약으로 동기화
  - ADR-0026으로 feature flag 제거와 운영 계층 긴급 차단 정책을 기록
- **영향범위**: 공개 애플리케이션 코드와 문서. 비공개 `deploy/`, 환경별 pgAdmin 파일, CI/CD 운영 정보는 제외한다.
- **파일**: `.env.example`, `src/{config/environment.ts,services/appleService.ts,services/googleService.ts,openapi/appleAuthOpenApi.json,openapi/googleAuthOpenApi.json}`, `migrations/rollback_google_auth_support.sql`, `test/{appleAuth,appleAuthIntegration,googleAuth,googleAuthIntegration}.test.cjs`, `_docs/{PROJECT_CONTEXT,DECISIONS,APPLE_SIGN_IN_SERVER_GUIDE,GOOGLE_SIGN_IN_SERVER_GUIDE,OAUTH_API_GUIDE,WORKLOG}.md`
- **테스트**: `npm test` 41 pass, 명시적 integration 6 skip, 0 fail. TypeScript build와 공개 인증 계약 테스트 통과.
- **롤백**: develop 전용 커밋을 revert한다.
- **다음**: develop 전용 diff에 `deploy/`, 환경별 pgAdmin/CI/CD 파일이 없음을 재확인하고 `origin/develop`에 커밋·푸시한다.

### [DONE] 회원 탈퇴 서버 기능 구현

- **목적**: 승인된 회원 탈퇴 설계를 실제 migration, API, worker, provider 연동, Redis purge와 회귀 테스트로 구현한다.
- **변경**:
  - `users.account_status/deletion_requested_at`, 삭제 요청·provider task 테이블, 소유 FK `CASCADE`/감사 FK `SET NULL`의 preflight/apply/postflight/승인형 rollback과 정본 DDL 추가
  - JWT `auth_time` 10분 재인증, `DELETE /api/v1/auth/account`, 접수 즉시 Refresh Token revoke·기기 unbind·일반 API 차단, 상태 조회/OpenAPI 구현
  - Apple refresh token revoke·Kakao Admin Key unlink, lease/backoff/max-attempt worker, ADMIN 우선 그룹 OWNER 승계/단독 그룹 삭제, DB 물리 purge 구현
  - Redis 삭제 tombstone으로 in-flight cache 재생성을 차단하고 사용자 월 key를 exact delete + SCAN purge하도록 추가
  - 완료 request의 `user_id`를 null로 익명화하고 30일 보존 후 cleanup
- **영향범위**: 인증 API·JWT, 사용자 FK, 그룹 응답 nullable 감사 필드, 신규 worker와 secret/환경변수, PostgreSQL·Redis·외부 OAuth 연동.
- **파일**: `src/{config/accountDeletion.ts,models/AccountDeletion*,services/accountDeletion*,workers/accountDeletionWorker.ts,openapi/accountDeletionOpenApi.json}` 및 인증·캐시·모델 연계 파일, `migrations/{account_deletion_*,add_account_deletion_support,rollback_account_deletion_support,final_schema}.sql`, `test/accountDeletion*.test.cjs`, 기존 PostgreSQL `test/fixtures/*Schema.sql`, `schema.drawio`, `.env.example`, `_docs/{ACCOUNT_DELETION_SERVER_DESIGN,PROJECT_CONTEXT,DECISIONS,WORKLOG}.md`
- **테스트**: `npm test` 54 pass, 명시적 통합 6 skip, 0 fail. TypeScript build, OpenAPI JSON parse, draw.io XML parse, `git diff --check` 통과. 로컬 Docker daemon 미실행으로 신규 PostgreSQL 통합 시나리오는 실행하지 못했으며 `npm run test:account-deletion-integration`으로 격리 DB에서 실행 가능.
- **롤백**: `ACCOUNT_DELETION_ENABLED=false`, `ACCOUNT_DELETION_WORKER_ENABLED=false`로 접수/처리를 먼저 멈추고 이전 이미지를 배포한다. 요청/task과 pending user가 0건인 경우에만 승인형 rollback SQL을 사용하며 이미 물리 삭제된 데이터는 복구하지 않는다.
- **다음**: Stage DB 백업·preflight/apply/postflight 후 worker secret을 주입하고 provider mock, Redis 장애, 실제 Apple/Kakao 계정 E2E를 통과한 뒤만 플래그를 활성화한다.

### [DONE] 회원 탈퇴 서버 개발 설계

- **목적**: 현재 인증·OAuth·친구·그룹·캘린더·알림·캐시 데이터 구조를 기준으로 안전하고 재시도 가능한 회원 탈퇴 서버 계약을 확정한다.
- **변경**:
  - 최근 재인증과 명시적 확인을 거쳐 `202 Accepted`로 접수하고 즉시 일반 API·세션을 차단하는 계약 확정
  - PostgreSQL lease worker가 Apple revoke·Kakao unlink, 그룹 OWNER 자동 승계, DB 물리 삭제, Redis tombstone/purge를 멱등 처리하도록 설계
  - 사용자 소유 FK는 CASCADE, 감사자 FK는 nullable SET NULL로 변경하고 알림/push JSON snapshot까지 삭제 범위에 포함
  - Google/Naver는 현재 서버에 revoke token이 없음을 확인하고 클라이언트 disconnect와 내부 계정 삭제를 분리
  - 구현 예정 파일, migration preflight/postflight, 통합·장애·Stage E2E와 비가역 rollback 원칙 문서화
- **영향범위**: 설계 문서와 프로젝트 컨텍스트·ADR·작업 일지. 런타임 코드, DB schema, draw.io와 운영 환경은 변경하지 않았다.
- **파일**: `_docs/{ACCOUNT_DELETION_SERVER_DESIGN,PROJECT_CONTEXT,DECISIONS,WORKLOG}.md`
- **테스트**: 현재 코드·`migrations/final_schema.sql`·두 draw.io의 사용자 FK/인증/cache 구조를 대조하고 공식 Apple/Kakao/Google/Naver 문서를 확인했다. Markdown diff whitespace와 draw.io XML parse를 검증했다.
- **롤백**: 이번 문서 변경을 revert한다. 구현·운영 데이터 변경은 없으므로 별도 DB rollback은 필요 없다.
- **다음**: 설계의 개인정보 보존 기간·완료 SLA를 승인한 뒤 migration/preflight → model/service/worker → OpenAPI → 격리 PostgreSQL/Redis 통합 테스트 순서로 구현한다.

## 2026-08-13

### [DONE] Google 컬럼 통합 테스트 fixture 동기화

- **목적**: `User` 모델의 `google_id` 추가 후 구형 최소 DB fixture에서 통합 테스트가 사용자 생성 단계에 실패하는 문제 해결
- **변경**: 현재 사용자 모델을 사용하는 캐시·그룹·Push·Apple fixture에 nullable `google_id`를 추가하고 Google 정적 계약으로 고정. Google migration 전 상태를 검증하는 전용 fixture는 의도적으로 유지
- **영향범위**: 격리 PostgreSQL 통합 테스트 fixture와 Google 정적 테스트만 변경하며 운영 DB와 런타임 코드에는 영향 없음
- **파일**: `test/fixtures/{cacheIntegrationSchema,groupIntegrationBaseSchema,pushIntegrationBaseSchema,appleAuthMigrationBaseSchema}.sql`, `test/googleAuth.test.cjs`, `_docs/WORKLOG.md`
- **테스트**: `npm test` 49 pass, 5개의 명시적 integration skip, 0 fail. `git diff --check` 통과. PostgreSQL 통합 테스트는 로컬 Docker daemon 미실행으로 수행하지 못했으며 CI 격리 서비스에서 확인 필요
- **롤백**: 본 fixture·테스트·작업 일지 변경을 revert
- **다음**: `main` 반영 후 CI의 캐시 23건과 Push·Apple·Google PostgreSQL 통합 테스트 결과 확인

### [DONE] Google 인증 CI의 gitignore 파일 의존성 제거

- **목적**: 깨끗한 원격 체크아웃에 존재하지 않는 `AGENTS.md` 때문에 Google 인증 정적 계약 테스트가 실패하지 않도록 저장소 추적 파일만 검증한다.
- **변경**: Google 스키마 동기화 검사에서 gitignore 대상인 `AGENTS.md` 의존성과 테스트명 표기를 제거하고, 원격에 추적되는 모델·실행 DDL·schema.drawio 검증은 유지했다.
- **영향범위**: Google 인증 정적 계약 테스트만 변경하며 런타임 코드와 DB에는 영향이 없다.
- **파일**: `test/googleAuth.test.cjs`, `_docs/WORKLOG.md`
- **테스트**: `npm test` 47 pass, 7개의 명시적 integration skip, 0 fail. `git diff --check` 통과.
- **롤백**: 본 테스트 및 작업 일지 변경을 revert한다.
- **다음**: 배포 저장소 `main`에 반영한 뒤 실패한 workflow를 재실행한다.

## 2026-08-11

### [DONE] Google ID Token 기반 소셜 로그인 서버 구현

- **목적**: Flutter가 전달하는 Google ID Token을 서버에서 검증하고 기존 ShiftMate JWT를 발급하는 `/api/v1/auth/google/token` 계약을 구현한다.
- **완료일**: 2026-08-12
- **변경**:
  - 공식 `google-auth-library`로 ID Token 서명·issuer·audience·만료와 verified email을 검증하고 Google `sub`를 사용자 식별 정본으로 사용
  - `/api/v1/auth/google/token`의 rate limit·validation, 신규 201/기존 200, 명시적 `is_new_user`, 공통 오류/request ID, 민감정보 제외 구조화 로그와 OpenAPI 추가
  - 같은 이메일의 기존 계정 자동 연결을 금지하고, 신규 사용자·기본 템플릿·refresh token을 한 transaction으로 생성하며 subject advisory lock으로 동시 가입 단일화
  - nullable `users.google_id`와 partial unique index의 preflight/apply/postflight/승인형 rollback, Stage/Center pgAdmin 단일 transaction 파일, 정본 schema·draw.io 동기화
  - 기본 false feature flag, Web OAuth Client ID 시작 검증, CI 실DB 통합 테스트, Google Cloud 발급·배포·인수·롤백 가이드와 ADR-0024 추가
- **영향범위**: 인증 public API, `users` 스키마/모델, 환경변수, OpenAPI, 테스트와 배포 문서. 기존 카카오·네이버·Apple 로그인 및 캘린더 공개 규칙은 변경하지 않는다.
- **파일**: `src/{services/googleService.ts,controllers/authController.ts,routes/authRoutes.ts,models/User.ts,config/environment.ts,utils/logger.ts,index.ts,openapi.ts}`, `src/openapi/googleAuthOpenApi.json`, `migrations/*google*`, `migrations/final_schema.sql`, `test/googleAuth*.test.cjs`, `test/fixtures/googleAuthMigrationBaseSchema.sql`, `.env.example`, `.github/workflows/deploy-production.yml`, `package*.json`, `schema.drawio`, `_docs/{GOOGLE_SIGN_IN_SERVER_GUIDE,PROJECT_CONTEXT,DECISIONS,WORKLOG}.md`
- **롤백**: `GOOGLE_AUTH_ENABLED=false`로 신규 Google 로그인을 차단하고 이전 서버 이미지를 배포하며 nullable `google_id` 컬럼/index는 유지한다. 데이터가 0건이고 별도 승인을 받은 경우에만 rollback SQL을 사용한다.
- **테스트**:
  - `npm test`: 49 pass, 5개의 명시적 integration skip, 0 fail
  - `npm run test:google-integration`: 격리 PostgreSQL 16에서 migration·HTTP 201·transaction·기존 profile 불변·이메일 충돌·동시성·rollback 7 pass
  - 격리 PostgreSQL 16.14에서 psql preflight/apply/postflight, 데이터 존재 rollback 차단과 0건 승인 rollback, Stage/Center pgAdmin 단일 파일, 정본 `final_schema.sql` 실행 검증
  - Google OpenAPI/package JSON, schema/visibility draw.io XML, GitHub Actions YAML parse와 `git diff --check` 통과
  - `npm audit --audit-level=high`: high/critical 0건. 고정 `firebase-admin 13.10.0` 간접 의존성의 기존 moderate 8건은 별도 버전 전환 대상
- **다음**: 운영자가 `_docs/GOOGLE_SIGN_IN_SERVER_GUIDE.md`에 따라 Web/iOS/Android OAuth Client ID와 Android 실제 서명 fingerprint를 준비하고, Stage DB 백업·migration 후 서버를 false로 먼저 배포한다. 실제 Stage/Center DB 적용과 feature flag 활성화는 이번 작업에서 수행하지 않았다.

## 2026-08-06

### [DONE] Apple Developer Portal 생성 절차 문서 보강

- **목적**: 운영자가 별도 질의 없이 Stage/Center Services ID와 Sign in with Apple key를 생성하고 서버 환경변수·secret에 정확히 연결할 수 있게 한다.
- **변경**: Primary App ID 활성화와 endpoint 보류 사유, Stage/Center Services ID·Domain·Return URL, Sign in with Apple 전용 key 생성·Configure·Key ID/`.p8` 1회 다운로드 보관, APNs key 재사용 조건, 환경변수와 호스트 secret 경로를 운영 가이드에 추가하고 필수 문구를 회귀 테스트로 고정했다.
- **영향범위**: Apple 운영 문서와 문서 회귀 테스트. API·DB·배포 환경·Apple Developer 계정은 변경하지 않는다.
- **파일**: `_docs/APPLE_SIGN_IN_SERVER_GUIDE.md`, `test/appleAuth.test.cjs`, `_docs/WORKLOG.md`
- **테스트**: `npm test` 39 pass/4 의도된 integration skip, `git diff --check` 통과. Stage/Center exact 값, key 생성 단계, secret 경로와 endpoint 보류 문구를 정적 검증했다.
- **롤백**: 문서 및 회귀 테스트 변경 커밋을 revert한다.
- **다음**: 운영자가 가이드 5장의 Portal 생성 절차를 완료하고 실제 Key ID와 `.p8`을 안전하게 보관한다. 앞선 Stage 배포 오류는 별도로 환경 검증을 통과하기 전까지 재배포하지 않는다.

### [DONE] Apple Stage pgAdmin 단일 migration 실행 파일

- **목적**: 홈서버 원격 접근이 복구되기 전에도 운영자가 Apple DB 선적용을 누락 없이 한 transaction으로 실행하고 결과 증거를 전달할 수 있게 한다.
- **변경**: PostgreSQL 16/대상 DB/복원 시험 백업 식별자/승인문구/primary·권한/`users.apple_id` index/기존 객체를 검증한 뒤 Apple OAuth DDL과 21개 컬럼·11개 제약·6개 index·COMMENT·0건 strict postflight를 같은 transaction에서 수행하는 pgAdmin Query Tool 전용 SQL 추가. 원본 migration SHA-256과 DB/backup/초기 건수를 Data Output에 남기고 psql 경로와의 중복 실행 금지를 문서화했다.
- **영향범위**: Stage DB migration 실행 절차와 문서·정적 테스트. 실제 Stage/Center DB, API 배포, Apple feature flag와 앱 버튼은 변경하지 않는다.
- **파일**: `migrations/stage_apple_auth_apply_pgadmin.sql`, `.gitignore`, `test/appleAuth.test.cjs`, `_docs/{APPLE_SIGN_IN_SERVER_GUIDE,PROJECT_CONTEXT,DEPLOYMENT_GUIDE,CI_CD_DEPLOYMENT_GUIDE,WORKLOG}.md`, `deploy/DEPLOY_README.md`
- **테스트**: `npm test` 38 pass/4 의도된 integration skip, `npm run test:apple-integration` 8 pass. 격리 PostgreSQL 16.14에서 정상 apply와 21컬럼/11제약/6 index/checksum/0건 출력 통과, 재실행은 기존 relation preflight에서 exit 3으로 차단되고 기존 두 테이블 0건 보존, 승인문구 누락은 exit 3 후 대상 relation 0개로 전체 rollback됨을 확인했다.
- **롤백**: 실행 파일과 문서·테스트 커밋을 revert한다. 실제 적용 후에는 테이블을 즉시 drop하지 않고 API를 `APPLE_AUTH_ENABLED=false`로 유지한다.
- **다음**: 운영자가 복원 시험 완료 백업을 확보해 이 파일을 실제 Stage에 적용하고 Data Output을 보존한 뒤 false 배포 선행 조건으로 연결한다.

### [TODO] Apple 로그인 서버 1단계 false 배포

- **목적**: 검증된 Apple 로그인 서버 이미지를 Stage → Center에 `APPLE_AUTH_ENABLED=false`로 배포하고 기존 인증 및 `503 APPLE_AUTH_DISABLED`를 확인한다.
- **현재 상태**:
  - 서버 1단계와 선택적 Apple secret override를 `a69445b`(`feat(auth): add gated Apple sign-in server`)로 커밋하고 `shift_calendar_server-deploy/main`에 push 완료
  - GitHub Actions 최근 성공 배포는 `1e7abea`, self-hosted runner `homeserver-firebat-n100`은 online·idle임을 GitHub API에서 확인
  - 첨부 가이드가 요구하는 실제 Stage/Center DB 백업·Apple preflight/migration/postflight 결과는 아직 확보되지 않음
  - 문서에 기록된 `hyunseo@192.168.0.5` SSH는 host key 변경 없이 batch mode로 확인했으나 port 22 timeout으로 연결되지 않음
- **영향범위**: 실제 Stage/Center DB와 API/worker 이미지. Flutter Production `APPLE_LOGIN_ENABLED`와 Center Apple flag/override는 변경하지 않는다.
- **테스트**: 배포 전 로컬 `npm test` 38 pass/4 skip, Apple PostgreSQL 통합 8 pass, actual Compose base/override 4개 조합과 `git diff --check` 통과. 원격 배포 검증은 대기 중이다.
- **롤백**: GitHub의 기존 성공 이미지 `1e7abea`를 Stage → Center 통합 rollback 경로로 재배포하고 OAuth add-only 테이블은 보존한다.
- **다음**: 홈서버 접근 경로를 복구하거나 운영자가 `_docs/APPLE_SIGN_IN_SERVER_GUIDE.md`의 DB 백업·preflight/migration/postflight 결과를 제공한 뒤 `Deploy production` workflow를 실행·감시한다.

### [DONE] Apple 비활성 최초 배포와 secret 주입 순서 교정

- **목적**: `APPLE_AUTH_ENABLED=false` 이미지가 Apple `.p8` 없이 먼저 배포되고, Stage 활성화 직전에만 API 전용 secret을 주입하도록 원래 rollout 순서를 복원한다.
- **변경**:
  - Stage/Center base Compose에서 Apple secret을 제거해 `false` 최초 배포가 `.p8` 없이 해석·기동되도록 수정
  - `compose.apple-auth.{stage,production}.yaml`을 추가해 활성화할 환경의 API에만 `.p8`을 mount하고 worker에는 전달하지 않음
  - root 배포 스크립트가 두 `.env`의 flag를 값을 노출하지 않고 읽어 `true`이면 override를 강제하며, override가 있을 때만 `.p8` 존재와 `root:root 0444`를 검증
  - 원래 rollout인 DB 선적용 → secret 없는 `false` 배포/503 회귀 → Stage secret·override 주입/활성화 → 2단계 뒤 Center 활성화 순서로 문서·ADR 교정
- **영향범위**: Stage/Center Compose 조합, root 배포 스크립트의 preflight, Apple 배포 문서와 정적 회귀 테스트. API·DB 동작은 변경하지 않는다.
- **파일**: `deploy/compose.apple-auth.{stage,production}.yaml`, `deploy/compose.{stage,production}.yaml`, `deploy/shiftmate-deploy`, `test/{appleAuth,deploymentCacheRollout}.test.cjs`, `_docs/{APPLE_SIGN_IN_SERVER_GUIDE,CI_CD_DEPLOYMENT_GUIDE,DEPLOYMENT_GUIDE,PROJECT_CONTEXT,DECISIONS,WORKLOG}.md`, `deploy/DEPLOY_README.md`
- **롤백**: 선택적 override와 조건부 검증을 제거하고 기존 base Compose secret mount로 되돌린다.
- **테스트**: `npm test` 38 pass/4 의도된 integration skip, `npm run test:apple-integration` 8 pass, Bash 문법, 4개 Compose와 Workflow YAML parse, base/선택적 override 실제 Compose 병합 4개 조합, API 전용 secret 대상, 가이드 byte 일치, `git diff --check` 통과.
- **다음**: 실제 Stage/Center DB 백업·migration과 두 `.env`의 false를 확인한 뒤 Apple secret/override 없이 첫 이미지를 배포하고 `503 APPLE_AUTH_DISABLED` 및 기존 인증 회귀를 기록한다.

### [DONE] Apple 소셜 로그인 서버 1단계 구현

- **목적**: 서버가 Apple authorization code와 identity token을 직접 검증한 뒤 기존 ShiftMate JWT를 발급하되, 계정 삭제/revoke 2단계가 완료되기 전에는 기능을 비활성 상태로 배포한다.
- **변경**:
  - iOS/Android별 일회성 state/nonce challenge, Android form callback의 고정 intent allowlist, challenge atomic consume 구현
  - Apple ES256 client secret, token endpoint 5초 timeout·무재시도, JWKS RS256/issuer/audience/nonce/claim 검증 구현
  - 검증 이메일 자동 계정 연결을 금지하고 신규 사용자·기본 템플릿·OAuth authorization·ShiftMate JWT를 단일 transaction으로 처리
  - Apple refresh token을 앱 JWT refresh token과 분리해 AES-256-GCM 암호화 저장하고 신규 authorization refresh token 누락 시 전체 rollback
  - `oauth_login_challenges`, `oauth_authorizations` add-only migration과 read-only preflight, strict postflight, 0건 전용 rollback 추가
  - 3개 endpoint OpenAPI, Apple 공통 오류 wrapper, 민감값 없는 구조화 로그, API 시작 전 환경 검증 추가
  - 비활성 최초 배포 후 선택적 Stage/Center override로 Sign in with Apple `.p8`을 API 컨테이너에만 mount하고 배포 스크립트가 활성 환경의 파일 권한을 검증
  - CI image build 전에 Apple PostgreSQL 통합 테스트를 추가하고 `APPLE_AUTH_ENABLED=false` 기본값 및 계정 삭제 전 이중 gate를 ADR-0023으로 고정
- **영향범위**: 인증 public API, PostgreSQL OAuth 보조 테이블, API 컨테이너 secret, OpenAPI/CI/배포 문서. 기존 카카오·네이버 로그인 동작은 변경하지 않는다. `visibility_flow.drawio`의 친구 공개 규칙은 변경하지 않고 `schema.drawio`에 OAuth 테이블만 추가했다.
- **파일**: `src/{config/environment,index,controllers/authController,routes/authRoutes,services/appleService,openapi}.ts`, `src/models/{OAuthLoginChallenge,OAuthAuthorization,index}.ts`, `src/openapi/appleAuthOpenApi.json`, `migrations/*apple_auth*`, `migrations/final_schema.sql`, `AGENTS.md`, `schema.drawio`, `.env.example`, `.gitignore`, `deploy/{compose.production,compose.stage,shiftmate-deploy}`, `.github/workflows/deploy-production.yml`, `test/appleAuth*.test.cjs`, `test/fixtures/appleAuthMigrationBaseSchema.sql`, `_docs/{APPLE_SIGN_IN_SERVER_GUIDE,OAUTH_API_GUIDE,PROJECT_CONTEXT,DECISIONS,DEPLOYMENT_GUIDE,CI_CD_DEPLOYMENT_GUIDE,WORKLOG}.md`, `deploy/DEPLOY_README.md`
- **테스트**:
  - `npm test`: 38 pass, 4 의도된 integration skip, 0 fail
  - `npm run test:apple-integration`: PostgreSQL 16에서 8 pass, 0 fail(공개 HTTP 계약, 신규 transaction, atomic consume/replay, invalid_grant 무재시도, 이메일 충돌, refresh token 누락 rollback, 기존 authorization, Android callback)
  - 실제 PostgreSQL 16에서 `apple_auth_preflight.sql` → migration → `apple_auth_postflight.sql`(21컬럼/제약/6 index/초기 0건) → 빈 테이블 rollback 전 과정 통과
  - OAuth DDL을 포함한 `migrations/final_schema.sql` 전체를 격리 PostgreSQL 16에서 실행 통과
  - TypeScript build, Compose/API-only secret 정적 계약, ES256/AES-GCM/JWKS 단위 검증 통과
  - 배포 shell `bash -n`, JSON/YAML/drawio XML parse, 배포 가이드 byte 일치, `git diff --check` 통과
- **롤백**: Flutter 버튼을 계속 숨기고 `APPLE_AUTH_ENABLED=false`로 API를 재생성한 뒤 이전 이미지를 배포한다. 신규 테이블과 `users.apple_id`는 보존한다. 두 OAuth 테이블이 모두 0건이고 별도 승인이 있을 때만 `rollback_apple_auth_support.sql`을 사용한다.
- **다음**: 계정 삭제 데이터 보존·익명화 정책을 별도 감사한 뒤 Apple `/auth/revoke`와 인증된 `DELETE /api/v1/auth/account`를 2단계로 구현하고 iOS/Android 실기기 E2E를 완료한다. Flutter `AuthResponse.fromJson()`의 integer `expires_at` milliseconds 경로에서 잘못된 `* 1000`도 제거하고 회귀 테스트를 추가한다. 그 전에는 Flutter Production `APPLE_LOGIN_ENABLED`와 Center `APPLE_AUTH_ENABLED`를 활성화하지 않는다.

## 2026-08-05

### [DONE] Stage Push Worker healthcheck 및 최초 rollback 수정

- **목적**: `Deploy production #6`에서 새 Push Worker가 시작된 뒤 healthcheck에 실패하고, 최초 도입 rollback이 구버전 fallback worker를 재생성해 추가 경고를 만든 문제를 수정한다.
- **변경**:
  - Compose 로컬 file secret이 host bind mount라 `root:root 600` JSON을 non-root `node` Worker가 읽지 못하는 권한 원인을 확인
  - 환경별 `secrets` 디렉터리는 `root:root 700`, `firebase.json`은 `root:root 444`로 배포 전 검증해 host 사용자 접근은 차단하면서 Worker 읽기를 허용
  - worker health 실패 시 container log와 별도로 Docker healthcheck subprocess의 exit code/output을 배포 로그에 출력
  - 기존 Stage image override에 Push Worker가 없었던 최초 도입 실패는 신규 Push Worker를 중지·제거하고 기존 API/cache worker만 복원
  - 배포 정적 테스트, ADR/프로젝트 컨텍스트, Push/CI/CD 운영 가이드의 권한·rollback 계약 갱신
- **영향범위**: Stage/Center Firebase secret host permission, Push Worker health 진단, 첫 도입 rollback. 앱·DB schema는 변경하지 않는다.
- **파일**: `deploy/shiftmate-deploy`, `test/deploymentCacheRollout.test.cjs`, `deploy/DEPLOY_README.md`, `_docs/{CI_CD_DEPLOYMENT_GUIDE,DEPLOYMENT_GUIDE,PROJECT_CONTEXT,PUSH_NOTIFICATION_GUIDE,DECISIONS,WORKLOG}.md`
- **테스트**:
  - `npm test`: 28 pass, 3 의도된 integration skip, 0 fail
  - `bash -n deploy/shiftmate-deploy deploy/shiftmate-bootstrap` 통과
  - Ruby Psych로 Stage/Center Compose와 GitHub Actions workflow YAML parse 통과
  - 정본/배포 README byte 일치, `git diff --check` 통과
- **롤백**: 배포 스크립트·문서·테스트를 이전 버전으로 revert하고 Push Worker flag를 비활성 상태로 유지한다.
- **다음**: 홈서버의 두 secret 디렉터리와 JSON 권한을 새 계약으로 교정하고, 새 `shiftmate-deploy`를 root 경로에 설치한 뒤 최신 `main`으로 새 workflow를 실행한다. 실패한 #6 재실행은 이전 commit을 사용하므로 선택하지 않는다.

### [DONE] Deploy production npm ci lockfile 불일치 수정

- **목적**: GitHub Actions `Deploy production #4` build가 `@opentelemetry/api@1.9.1` 누락으로 `npm ci`에서 중단된 문제를 재현하고 lockfile을 Node 22/npm 기준으로 동기화한다.
- **변경**:
  - 버전 없이 남아 npm 10 Arborist를 중단시킨 nested `@opentelemetry/api` placeholder 제거
  - npm 10.9.4로 optional `@opentelemetry/api@1.9.1`의 정상 version/resolved/integrity metadata 생성
  - 직접·일반 dependency에 잘못 남은 `peer` 표시를 npm 10 dependency graph 기준으로 정규화
  - 모든 non-link lockfile package에 version이 있고 OpenTelemetry metadata가 완성됐는지 회귀 테스트 추가
- **영향범위**: npm lockfile과 CI 재현성. 런타임 코드·DB·서버 파일은 변경하지 않는다.
- **파일**: `package-lock.json`, `test/deploymentCacheRollout.test.cjs`, `_docs/WORKLOG.md`
- **테스트**:
  - GitHub Actions 계열 npm 10.9.4 `npm ci`: 353 package clean install 성공
  - `npm test`: 27 pass, 3 의도된 integration skip, 0 fail
  - `npm audit --omit=dev`: high/critical 0, 기존 Firebase Admin 간접 의존성 moderate 8
  - `git diff --check` 통과
- **롤백**: lockfile 수정 커밋을 revert하고 이전 dependency graph로 복귀한다.
- **다음**: 수정 커밋 push 후 Actions에서 최신 `main`을 선택해 새 `Run workflow`를 실행한다. `Re-run all jobs`는 실패한 실행의 이전 commit SHA를 그대로 사용하므로 선택하지 않는다.

### [DONE] Stage Compose 저장소 정본 추가

- **목적**: 홈서버에만 있던 `/opt/shiftmate-stage/compose.yaml`을 배포 저장소에서 관리하고 Center Compose와 같은 변경·검증·설치 경로를 제공한다.
- **변경**:
  - 전달받은 Stage API/cache worker/Redis 구성과 resource/security 설정을 보존한 `deploy/compose.stage.yaml` 추가
  - port 없는 Push Worker, worker 전용 `DB_POOL_MAX=2`, Stage Firebase Compose secret 추가
  - Stage 서비스명을 정본 Compose와 `stage.deploy.env.example`에서 동일하게 고정
  - 배포 정적 테스트·YAML parse와 설치·백업·롤백 문서에 Stage Compose 계약 포함
- **영향범위**: 배포 저장소와 홈서버 Stage Compose 설치 절차. 이번 변경에서 실제 홈서버 파일이나 컨테이너는 직접 수정하지 않는다.
- **파일**: `deploy/compose.stage.yaml`, `deploy/stage.deploy.env.example`, `test/deploymentCacheRollout.test.cjs`, `_docs/{CI_CD_DEPLOYMENT_GUIDE,DEPLOYMENT_GUIDE,PUSH_NOTIFICATION_GUIDE,PROJECT_CONTEXT,DECISIONS,WORKLOG}.md`, `deploy/DEPLOY_README.md`
- **테스트**:
  - `npm test`: 26 pass, 3 의도된 integration skip, 0 fail
  - Ruby Psych로 Stage/Center Compose와 GitHub Actions YAML parse 통과
  - `bash -n` 배포 스크립트, 배포 가이드 byte 일치, `git diff --check` 통과
- **롤백**: 홈서버의 기존 Compose 백업을 복원하고 저장소 Stage Compose 파일과 관련 문서·테스트를 revert한다.
- **다음**: `deploy/compose.stage.yaml`을 root 소유 `/opt/shiftmate-stage/compose.yaml`로 설치하고 `.deploy.env`의 외부 health URL만 실제 Stage 도메인으로 설정한다.

### [DONE] Push Worker Stage/Center 배포 자동화 완성

- **목적**: 배포 저장소 `main`의 API/Cache Worker 전용 Blue/Green 경로에 Push Worker와 환경별 Firebase secret을 추가하고, Stage부터 비활성 상태로 안전하게 배포할 수 있게 한다.
- **변경**:
  - Center Blue/Green Push Worker를 Firebase Compose secret과 함께 정의하고 `/dev/null` credential fallback 제거
  - Stage Push Worker 서비스명을 `.deploy.env`, image override, 배포·health·rollback 단위에 추가
  - Stage/Center Firebase Admin JSON의 `root:root 600` 파일을 배포 전 검증하고 worker 전용 `DB_POOL_MAX=2` 경계를 고정
  - CI에 격리 PostgreSQL 16 Push integration을 이미지 build 이전 단계로 추가
  - 홈서버 `.env`, `/opt/shiftmate{,-stage}/secrets/firebase.json`, Stage Compose와 순차 feature flag 활성화 절차 문서화
- **영향범위**: 별도 배포 저장소의 Compose, 배포 스크립트·테스트·운영 문서. 실제 홈서버 파일과 Stage/Center 컨테이너는 이번 코드 변경에서 직접 수정하지 않는다.
- **파일**: `deploy/compose.production.yaml`, `deploy/shiftmate-deploy`, `deploy/stage.deploy.env.example`, `.github/workflows/deploy-production.yml`, `test/deploymentCacheRollout.test.cjs`, `.env.example`, `_docs/{CI_CD_DEPLOYMENT_GUIDE,DEPLOYMENT_GUIDE,PUSH_NOTIFICATION_GUIDE,PROJECT_CONTEXT,DECISIONS,WORKLOG}.md`
- **테스트**:
  - `npm test`: 25 pass, 3 의도된 integration skip, 0 fail
  - Ruby Psych로 Center Compose와 GitHub Actions YAML parse 통과
  - `bash -n deploy/shiftmate-deploy deploy/shiftmate-bootstrap`, 배포 가이드 byte 일치, `git diff --check` 통과
  - 로컬 Docker daemon이 실행 중이지 않아 Push PostgreSQL integration은 재실행하지 못했으며, 배포 CI가 격리 PostgreSQL 16에서 `npm run test:push-integration`을 image build 전에 필수 실행하도록 고정
- **롤백**: Push Worker 서비스·secret·배포 스크립트 확장을 제거하고 API/Cache Worker 전용 배포 경로로 복귀한다.
- **다음**: 운영자가 Stage/Production Firebase Admin JSON과 홈서버 파일을 준비하고, DB migration 후 두 flag `false`로 배포한 다음 Stage에서 enqueue → worker 순서로 활성화한다.

## 2026-08-13

### [DONE] Apple 공개 문서와 migration 테스트 경계 복구

- **목적**: 현재 작업트리의 Apple 문서·테스트 변경을 공개 `develop` 정책과 깨끗한 원격 체크아웃에서 재현 가능한 상태로 정리
- **변경**: 범용 Apple migration 계약과 Portal 절차는 유지하고 환경별 pgAdmin 파일·운영 식별자·누락 파일 의존성은 제거
- **영향범위**: Apple 운영 가이드, migration 정적 테스트, gitignore와 작업 기록. 런타임 코드와 DB에는 영향 없음
- **파일**: `_docs/{APPLE_SIGN_IN_SERVER_GUIDE,WORKLOG}.md`, `test/appleAuth.test.cjs`
- **테스트**: `npm test` 36 pass, 5개의 명시적 integration skip, 0 fail. `git diff --check`와 운영 DB명·백업 증거·Team ID·환경 도메인·호스트 경로 패턴 검사 통과
- **롤백**: 본 정리 커밋을 revert
- **다음**: 환경별 pgAdmin wrapper와 실제 배포값은 비공개 운영 저장소에서 별도로 유지

### [DONE] 공개 저장소 운영 식별자 정리

- **목적**: 기존 공개 `develop` 문서와 테스트에 남아 있는 비공개 배포 저장소·호스트 경로·환경별 식별자를 현재 branch tip에서 제거
- **변경**:
  - 운영 전용 배포 가이드를 공개/비공개 경계, 범용 검증·DB 변경·롤백 원칙만 담은 문서로 교체
  - 비공개 배포 저장소 구조를 기록한 ADR-0019와 별도 저장소 파일을 전제로 한 배포 정적 테스트 제거
  - PROJECT_CONTEXT의 환경별 CI/CD 상세를 공개 저장소 배포 경계로 교체
  - 기존 WORKLOG·그룹 문서·ADR의 저장소명, 호스트 경로, DB/upstream/runner 식별자와 환경별 파일명을 일반화
- **영향범위**: 공개 문서와 배포 정적 테스트만 변경하며 런타임 코드에는 영향 없음
- **파일**: `_docs/{DEPLOYMENT_GUIDE,PROJECT_CONTEXT,DECISIONS,WORKLOG,GROUP_API_GUIDE,GROUP_RUNTIME_VERIFICATION_CHECKLIST}.md`, `test/deploymentCacheRollout.test.cjs`
- **테스트**:
  - `npm test`: 36 pass, 5개의 명시적 integration skip, 0 fail
  - 금지한 저장소명·호스트 경로·DB/upstream/runner 식별자와 private key/token 패턴 미검출
  - `git diff --check` 통과
- **롤백**: 본 문서 정리 커밋을 revert
- **다음**: 과거 Git commit에 남은 값이 실제 credential인지 확인하고, 실제 값이면 먼저 회전한 뒤 별도 승인된 history rewrite 수행

### [DONE] 공개 develop 브랜치용 인증 기능 복구

- **목적**: 별도 비공개 브랜치에서 구현된 Apple·Google 인증 기능 중 애플리케이션 코드와 공개 가능한 기술 문서만 공개 `develop` 기준으로 재구성
- **변경**:
  - `origin/develop`에서 별도 복구 브랜치를 만들고 혼합 커밋을 cherry-pick하지 않은 채 Apple·Google 인증 코드, 범용 migration, OpenAPI와 테스트만 선별 이식
  - 배포 자동화, 환경별 실행 SQL, 실제 인프라 식별값, 운영 실행 기록과 배포 정적 테스트는 신규 이력에서 제외
  - `.env.example`의 DB·Redis·Firebase·OAuth 값을 로컬 placeholder 또는 빈 값으로 교체하고 signing key·service account ignore 규칙 추가
  - Apple·Google 공개 기술 가이드, PROJECT_CONTEXT 파일 역할, ADR-0023/0024를 현재 코드 기준으로 작성
  - Apple·Google 단위 테스트에서 별도 배포 저장소 파일에 대한 의존성을 제거
- **영향범위**: 인증 API, 사용자/OAuth DB 스키마, 환경변수 검증, OpenAPI, 테스트와 공개 개발 문서
- **파일**: `src/services/{appleService,googleService}.ts`, 인증 controller/routes/config/models/OpenAPI, `migrations/*apple_auth*`, `migrations/*google_auth*`, `test/appleAuth*.test.cjs`, `test/googleAuth*.test.cjs`, `.env.example`, `.gitignore`, `_docs/{APPLE_SIGN_IN_SERVER_GUIDE,GOOGLE_SIGN_IN_SERVER_GUIDE,OAUTH_API_GUIDE,PROJECT_CONTEXT,DECISIONS,WORKLOG}.md`
- **테스트**:
  - `npm test`: 36 pass, 6개의 명시적 integration skip, 0 fail
  - `npm run build`, `git diff --check`, OpenAPI JSON parse, `xmllint --noout schema.drawio` 통과
  - 신규·변경 파일의 private key/token 형식과 환경별 배포 식별자 패턴 검사 결과 신규 노출 없음
  - `npm audit --audit-level=high`: high/critical 0, 기존 Firebase Admin 간접 의존성 moderate 8
  - Apple·Google PostgreSQL 통합 테스트는 로컬 Docker daemon이 실행 중이지 않아 fixture 기동 전에 중단되었으며 DB 변경은 발생하지 않음
- **롤백**: 공개 반영 전에는 복구 브랜치를 폐기하고 `origin/develop`으로 복귀. 반영 후에는 본 커밋을 revert하고 add-only DB 컬럼·테이블은 보존
- **다음**: Docker 사용 가능한 격리 환경에서 Apple·Google PostgreSQL 통합 테스트를 실행한 뒤 공개 원격의 복구 브랜치로 push하고 PR에서 최종 파일 목록을 검토

## 2026-08-03

### [DONE] Push Worker 기반 푸시 알림 구현

- **목적**: 도메인 알림과 같은 트랜잭션에 push job을 기록하고 별도 worker가 수신자의 최신 활성 Android/iOS 기기 한 대에 FCM 알림을 전달한다.
- **변경**:
  - `user_devices`, `push_jobs`, `push_deliveries` expand migration·Sequelize 모델·최종 schema·draw.io를 추가하고 과거 알림은 backfill하지 않도록 고정
  - 인증 `PUT /api/v1/devices/current` 멱등 upsert, 환경별 설치/target 격리, target 충돌 재귀속, raw target 비노출 OpenAPI 구현
  - logout의 선택 `installation_id`, logout-all의 refresh token·기기 동시 비활성화를 같은 transaction으로 연결
  - 친구/그룹 6개 결과 알림을 공통 `notifications + push_jobs` transaction 서비스로 통합하고 응답/취소/만료 원본 job을 best-effort 취소
  - PostgreSQL `SKIP LOCKED` lease worker, 최신 한 대 고정·token 재조회·무-fallback, sendEach payload, retry/jitter/TTL/영구 오류/30일 정리와 readiness 구현
  - Node 22 `firebase-admin 13.10.0` 고정, push worker 실행 명령·DB pool 2·credential 경로·독립 feature flag와 운영 문서/ADR-0022 추가
- **영향범위**: 알림 생성 transaction, 인증 logout, DB migration, 독립 worker 및 배포 구성. 기존 알림 조회 API와 인앱 원본 역할은 유지한다.
- **파일**: `migrations/add_push_notification_support.sql`, `src/models/{UserDevice,PushJob,PushDelivery}.ts`, `src/services/{deviceService,notificationService,firebasePushProvider}.ts`, `src/workers/pushWorker.ts`, `src/routes/deviceRoutes.ts`, `src/openapi/deviceOpenApi.json`, `test/push*.test.cjs`, `_docs/PUSH_NOTIFICATION_GUIDE.md`
- **테스트**:
  - `npm test`: 18 pass, 4 skip, 0 fail
  - 격리 PostgreSQL 16 `npm run test:push-integration`: 7 pass, 0 fail. migration 무-backfill/인덱스, 기기 멱등·target 재귀속, transaction rollback, 최신 기기·token refresh, 무-fallback, 동시 claim·lease 복구, 영구 오류/logout 검증
  - `xmllint --noout schema.drawio`, TypeScript build, `git diff --check` 통과
  - `npm audit`: high/critical 0, moderate 8. 모두 고정한 Firebase Admin의 간접 의존성이며 자동 해소는 14.2.0 major 변경을 요구하므로 ADR-0022 후속 검토로 기록
- **롤백**: `PUSH_JOB_ENQUEUE_ENABLED=false` → worker 중지 → 이전 API 이미지 복귀 순서로 수행하고 신규 테이블과 기록은 보존한다.
- **다음**: 환경별 Firebase/APNs credential과 실제 Stage 앱을 준비한 뒤 6개 알림, 최신 한 대 전환, 권한/환경/logout/stale job 시나리오를 실기기 E2E로 확인한다.

## 2026-08-01

### [DONE] 그룹 기능 원격 재현성 및 커밋 전 검증 정리

- **목적**: 그룹 P0/P1 서버 구현, PostgreSQL 16 검증 환경, OpenAPI와 프론트 연동 문서를 하나의 재현 가능한 커밋으로 정리해 `origin/develop` 반영을 준비
- **변경**:
  - staged/unstaged/untracked 변경 범위와 비밀값·로컬 산출물 포함 여부 감사
  - 비공개 실행 환경 Docker PostgreSQL 16 환경에 맞게 공유 환경변수 예시를 `DB_SSL=false`로 교정하고 백업 식별자는 실제 `pg_dump`/pgAdmin 백업 파일명을 사용하도록 명시
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
- **파일**: `src/services/workShiftMonthCacheService.ts`, `test/cacheIntegration.test.cjs`, `test/deploymentCacheRollout.test.cjs`, `[private deployment file]`, `[private deployment file]`, `_docs/PROJECT_CONTEXT.md`, 루트/정본 배포 가이드
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
  - `[private deployment file]`, `[private deployment file]`, `[private deployment file]`, `[private workflow]`
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

- **목적**: 비공개 실행 환경 sudo가 인자 wildcard/정규식을 지원하지 않는 환경에서도 Runner가 검증된 배포 스크립트만 호출하게 하고, profile 기반 Center 서비스 6개를 문서 명령으로 정확히 검증
- **변경**:
  - sudoers 원본에서 지원되지 않는 인자 wildcard를 제거하고 root 소유 배포 스크립트의 엄격한 인자 검증을 보안 경계로 명시
  - Center Compose 검증·장애 로그 명령에 `blue`, `green` profile 추가
  - 루트/정본 가이드, 프로젝트 컨텍스트, ADR-0019 동기화
- **영향범위**: 비공개 runner sudo 권한 설치 및 Center Compose 운영 검증
- **테스트**:
  - 로컬 `visudo -cf [private deployment file]` 파싱 성공
  - `--profile blue --profile green config --services`에서 Center 서비스 6개 모두 확인
  - 배포·bootstrap Bash 문법 및 workflow·Compose YAML 파싱 성공
  - `DEPLOY_README.md`와 정본 가이드 내용 일치, Markdown code fence 80개 균형 확인
  - wildcard 레거시 규칙 제거와 대상 파일 `git diff --check` 통과
- **파일**:
  - `[private deployment file]`
  - `DEPLOY_README.md`
  - `[private deployment guide]`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **롤백**: sudoers와 가이드·설계 문서를 이전 커밋 상태로 복원

### [DONE] 루트 배포 가이드 최신화

- **목적**: 오래된 `DEPLOY_README.md`를 현재 Stage 1개·Center 3개 동일 이미지 자동 배포 흐름과 배포 전용 저장소 기준으로 교정
- **변경**:
  - 배포 저장소, 비공개 실행 환경 파일 설치, Stage 설정, Center·Stage Nginx upstream, 첫 배포·롤백·장애 대응 절차를 정본 가이드와 동기화
  - `PROJECT_CONTEXT.md`에 루트 배포 가이드의 역할·의존성·사용 예 기록
- **영향범위**: 비공개 실행 환경 CI/CD 작업자가 실행하는 배포 준비 및 검증 명령
- **테스트**:
  - `cmp DEPLOY_README.md _docs/CI_CD_DEPLOYMENT_GUIDE.md` 내용 일치 확인
  - 잘못된 `git push origin main`과 애플리케이션 저장소 Runner URL 제거 확인
  - Stage 설정 예시, Center·Stage upstream, 배포 전용 저장소 및 총 4개 API 컨테이너 검증 절차 포함 확인
  - Markdown 코드 fence 78개가 짝수로 닫히고 대상 파일 `git diff --check` 통과
- **파일**:
  - `DEPLOY_README.md`
  - `[private deployment guide]`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/WORKLOG.md`
- **롤백**: `DEPLOY_README.md`와 관련 문서 변경을 이전 내용으로 복원

## 2026-07-21

### [DONE] Stage·Center 동일 이미지 통합 자동 배포

- **목적**: GitHub Actions가 한 번 빌드한 불변 GHCR digest를 Stage 1개와 Center 3개에 순차 적용하고 실패 시 두 환경을 이전 상태로 함께 복원
- **변경**:
  - 기존 Stage Compose와 애플리케이션 `.env`를 보존하면서 지정 서비스의 image만 덮어쓰는 root 관리 `compose.deploy.yaml` 생성 기능 추가
  - 실제 Stage Compose 서비스명과 외부 health URL을 비공개 실행 환경에서 확정하도록 `[private deployment config]` 추가 및 `root:root 600` 검증 적용
  - 배포 스크립트에 Stage 선배포, 3201 내부 health, Center Blue/Green 연속 배포, 양쪽 외부 health, 통합 rollback 추가
  - 부분적인 `docker compose up` 실패도 복구하도록 Stage·Center 변경 플래그를 실행 전에 설정
  - 배포·롤백 workflow timeout과 표시 문구, 비공개 실행 환경 설치·검증·복구 가이드, 프로젝트 컨텍스트와 ADR-0019 갱신
- **영향범위**:
  - Stage 3201 컨테이너 재생성
  - Center Blue/Green 3개 전환
  - 운영 및 Stage rollback
- **테스트**:
  - `bash -n [private deployment file]`, `bash -n [private deployment file]` 성공
  - Ruby YAML parser로 배포·롤백 workflow와 운영 Compose 파싱 성공
  - `npm run build` TypeScript 컴파일 성공
  - `--profile blue --profile green`을 명시한 `docker compose config --quiet`, `config --services`로 Center 6개 서비스 구성 검증 성공
  - 임시 Stage Compose와 생성형 override 병합 후 최종 image가 지정 GHCR digest인지 확인
  - Stage/Center 부분 기동, Nginx 전환, 외부 health 실패별 복원 플래그와 실행 순서 정적 검증
- **파일**:
  - `[private workflow]`
  - `[private workflow]`
  - `[private deployment file]`
  - `[private deployment file]`
  - `[private deployment guide]`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **롤백**:
  - 통합 배포 스크립트와 Stage 설정을 이전 커밋으로 복원하고 생성된 Stage override 제거 후 기존 Compose 이미지로 재생성
- **다음**:
  - 비공개 실행 환경에서 Stage 실제 Compose 서비스명과 HTTPS health URL을 확인해 `[private deployment path]`를 설정한 뒤 첫 workflow를 수동 실행

### [DONE] Center·Stage Nginx upstream 이름 분리

- **목적**: 운영 Center Blue/Green과 고정 Stage 프록시가 각각 `[private upstream]`, `[private upstream]`를 사용하도록 Nginx upstream 이름을 명시적으로 분리
- **변경**:
  - Center Blue/Green 정적 snippet과 bootstrap/deploy 동적 렌더링을 `[private upstream]`로 통일
  - 기존 Stage 3201을 `[private upstream]`로 제공하는 고정 `shiftmate-stage-upstream.conf` 추가
  - 비공개 실행 환경에서 Center active snippet과 Stage fixed snippet을 각각 설치·include하고 용도별 `proxy_pass`를 사용하는 절차 추가
  - PROJECT_CONTEXT의 파일 역할·의존성과 ADR-0019의 Nginx 라우팅 계약 갱신
- **영향범위**:
  - Nginx Center/Stage upstream 정의
  - 최초 bootstrap 및 이후 Blue/Green 배포·롤백
- **테스트**:
  - `bash -n [private deployment file]`, `bash -n [private deployment file]` 성공
  - 배포 파일에서 레거시 `shiftmate_api_cluster`가 제거되고 Center/Stage 이름만 생성되는 것을 검색으로 확인
  - `nginx:latest`에서 Blue+Stage, Green+Stage snippet 조합 각각 `nginx -t` 성공
- **파일**:
  - `[private deployment file]`
  - `[private deployment file]`
  - `[private deployment file]`
  - `[private deployment file]`
  - `[private deployment file]`
  - `[private deployment guide]`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **롤백**:
  - Stage snippet/include를 제거하고 Center upstream 이름과 proxy_pass를 변경 전 이름으로 복원
- **다음**:
  - 비공개 실행 환경 실제 Nginx 설정에서 Center/Stage server block의 `proxy_pass`를 확인한 뒤 가이드 순서로 두 snippet 설치 및 `nginx -t` 수행

### [DONE] 배포 자동화 전용 저장소 분리

- **목적**: GitHub Actions 및 비공개 실행 환경 Blue/Green 배포 파일을 애플리케이션 저장소와 분리하여 `[private deployment repository]`의 `main` 브랜치에서 관리
- **변경**:
  - 비공개 배포 번들의 workflow, Compose, proxy, 서버 스크립트를 별도 비공개 저장소 구조로 이전
  - 번들 README를 `[private deployment guide]`로 이전하고 배포 전용 저장소·원격 기준으로 수정
  - `.dockerignore`에 `.github`, `deploy`를 추가해 운영 이미지 빌드 컨텍스트에서 자동화 파일 제외
  - 존재하지 않는 `actions/checkout@v7`, `actions/setup-node@v7`을 공식 현재 major인 `@v6`으로 수정
  - `PROJECT_CONTEXT.md`에 운영 CI/CD 파일 역할·의존성·사용 예를 추가하고 ADR-0019에 별도 배포 저장소와 Blue/Green 정책 기록
  - 이전 완료 후 `shiftmate-cicd-bundle/` 디렉터리 제거
- **영향범위**:
  - GitHub Actions 배포·롤백
  - GHCR 이미지 빌드 및 비공개 실행 환경 Blue/Green 배포
  - 배포 자동화 문서
- **파일**:
  - `.dockerignore`
  - `[private workflow]`
  - `[private workflow]`
  - `[private deployment file]`
  - `[private deployment file]`
  - `[private deployment file]`
  - `[private deployment file]`
  - `[private deployment file]`
  - `[private deployment file]`
  - `[private deployment file]`
  - `[private deployment guide]`
  - `_docs/PROJECT_CONTEXT.md`
  - `_docs/DECISIONS.md`
  - `_docs/WORKLOG.md`
- **테스트**:
  - 원격 `[private deployment branch]`이 작업 전 `791498a7af689a6275846b0f1e5fd5ad9ce4320d`임을 확인
  - 공개 GitHub API가 배포 저장소에 404를 반환하고 인증된 `git ls-remote`는 성공하여 Private 원격 접근 상태 확인
  - GitHub 공식 Action 저장소 기준 `actions/checkout@v6`, `actions/setup-node@v6`, `docker/login-action@v4`, `docker/setup-buildx-action@v4`, `docker/build-push-action@v7` 유효성 확인
  - `npm run build` 성공
  - GitHub Actions 2개와 Compose YAML 파싱 성공
  - `bash -n [private deployment file]`, `bash -n [private deployment file]` 성공
  - `docker compose ... config --quiet` 성공
  - 배포 스크립트 실행 권한과 `shiftmate-cicd-bundle/` 제거 확인
- **롤백**:
  - `[private deployment branch]`을 이번 배포 자동화 커밋의 부모로 되돌리고 필요 시 제거한 번들 구조로 파일 복원
- **다음**:
  - GitHub 저장소에서 Private 여부, GHCR Actions access, private runner label을 확인하고 가이드에 따라 최초 bootstrap 수행

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
  - 비공개 실행 환경에서 `linux/amd64` 이미지를 로드하고 DB 주소/메모리 사용량 확인
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
  - 비공개 실행 환경 PostgreSQL `max_connections` 확인 후 `3 × DB_POOL_MAX` 예산 확정
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

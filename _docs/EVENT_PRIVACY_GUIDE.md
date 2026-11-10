# 개인 일정 나만 보기 서버 계약

작성일: 2026-11-11 (Asia/Seoul). 공개 기능 `10cdc03` 반영·격리 PostgreSQL 검증·Stage/운영 서버 배포 완료. migration은 사용자 적용 완료를 확인했고 배포 전 컬럼/뷰 검사 및 배포 후 readiness·Stage OpenAPI를 확인했다. 실제 인증 사용자별 실응답·실기기 인수와 Flutter 활성화는 후속 작업이다.

## 목적과 요청 흐름

개인 일정의 `is_private=true`는 소유자만 조회할 수 있다. 레벨 5, `can_view=true`, 같은 그룹 가입 및 OWNER/ADMIN 역할도 이 조건을 우회하지 못한다. 근무표 정책은 변경하지 않는다.

```text
Router(auth + express-validator) → Controller(wrapper) → Service → Sequelize/PostgreSQL → DTO
본인: events.owner_user_id = JWT user_id AND deleted_at IS NULL
타인: v_visible_events_for_friend
      → is_private=false AND deleted_at IS NULL
      → friendships EXISTS AND owner→viewer can_view=true
      → friend_level >= visibility_level
그룹: 활성 그룹/멤버 확인 → 본인 events UNION ALL 타인 공개 view
```

개인 일정은 캐시하지 않는다. 친구·그룹 응답은 필터된 행만 반환하며 별도 숨겨진 개수/날짜 마커는 제공하지 않는다. 새 상세·검색·공유·수정 경로를 만들 때도 동일한 서버 판정을 적용해야 한다. 구조 정본은 루트 `schema.drawio`, 공개 판정 정본은 루트 `visibility_flow.drawio`다. 인접 Flutter 저장소의 구형 calendars/calendar_shares 도면은 이 서버의 정본이 아니다.

## API 계약과 호환성

`POST /api/v1/events`는 JWT, JSON, HTTP 201 및 `{success,data,message}` 응답을 유지한다.

```json
{
  "title": "개인 약속",
  "all_day": false,
  "start_at": "2026-11-11T00:00:00.000Z",
  "end_at": "2026-11-11T01:00:00.000Z",
  "visibility_level": 0,
  "is_private": true
}
```

- `is_private` 생략은 false. 실제 JSON boolean만 허용한다. null·문자열·숫자·배열·객체는 route와 서비스 직접 호출 모두 거절한다. `Boolean(value)` 또는 `.toBoolean()` 변환은 적용하지 않는다.
- 오류는 HTTP 400, `{success:false,error:{code:"INVALID_EVENT_PRIVACY",message:"공개 범위가 올바르지 않습니다."}}`다. 기존 제목·시간·레벨 오류와 wrapper는 유지한다.
- `visibility_level`은 private여도 기존 필수 0~5다. 비공개가 레벨보다 우선하며 레벨을 덮어쓰지 않는다.
- owner/created_by는 JWT 사용자로만 저장한다. 요청의 소유자 ID는 대상 변경에 사용하지 않는다.
- memo/place trim·빈 값 null, UTC ISO 시간·배타적 종료, soft delete·소유자 삭제 정책은 유지한다.
- 생성·본인 목록/기간/날짜·그룹 응답은 `is_private`를 포함한다. 친구/그룹의 타인 응답에는 private 행 전체가 없으며 공개 행은 false를 포함한다. 기존 응답 필드를 제거하지 않는다.
- `/calendar/day`는 해당 날짜에 **시작하는** 일정만 조회하는 기존 동작이다. 기간 조회는 overlap 조건을 유지한다.
- 새 환경변수·인덱스·seed는 없다. 신규 Flutter 파서는 누락된 응답 필드를 false로 해석해야 하며 요청/선택 활성화는 서버 인수 후 진행한다.

| 조회 | 공개 일정 | private 일정 |
| --- | --- | --- |
| 소유자 목록·기간·날짜·그룹 본인 행 | 기존 기간/날짜 조건으로 포함 | 동일 조건으로 포함 |
| 친구 관계 + can_view=true + 충분한 레벨 | 포함, is_private=false | 전체 행 제외 |
| 레벨 5 친구/같은 그룹 관리자 | 기존 ACL 조건으로 포함 | 전체 행 제외 |
| can_view=false 또는 친구 아님 | 친구 API 403/404, 그룹 행 제외 | 동일하게 제외 |

OpenAPI는 `src/openapi/calendarOpenApi.json`의 생성·본인·친구 스키마와 `groupOpenApi.json`의 그룹 이벤트를 병합한다. 확인 경로는 `/api-docs`, `/api-docs/openapi.json`이다.

## DB 전환과 배포 순서

**Behavior change**: true로 생성한 일정은 레벨 조건과 무관하게 타인 조회에서 제외된다. 필드 생략과 기존 데이터는 false로 기존 공개 동작을 유지한다.

1. 대상 DB/환경·백업·실행 권한을 확인한다. 운영 DB를 테스트에 사용하지 않는다.
2. 아래 쿼리로 기존 테이블·뷰 컬럼과 정의, 소유자·권한·종속성을 확인하고 기록한다.
3. `migrations/add_event_privacy.sql` 전체를 **1회** 실행하고 migration 이력을 외부 배포 기록에 남긴다. SQL은 단일 transaction이며 실패 시 전체 rollback한다. pgAdmin에서 오류로 중단한 세션은 `ROLLBACK` 후 원인을 확인한다.
4. 기존 행 false·NOT NULL/default false·viewer_user_id 순서와 UUID 타입·추가된 마지막 boolean·기존 권한/종속성을 재확인한다.
5. 서버를 Stage에 배포하고 A(private 소유자), B(레벨 5 허용 친구), C(같은 그룹 사용자)로 모든 응답에서 private ID 및 본문 정보 누락을 확인한다. 생성 응답 true만으로 공개 필터 완료를 판단하지 않는다.
6. 운영에도 migration → 서버 → 권한별 인수를 순서대로 진행하고 적용 커밋·migration 이름·결과를 기록한다.
7. 모든 인수 완료 후 Flutter 요청/응답 필드와 나만 보기 선택을 활성화한다. 반복·알림·참석자·색상은 이번 범위에 포함하지 않는다.

```sql
SELECT column_name, data_type, is_nullable, column_default, ordinal_position
FROM information_schema.columns
WHERE table_schema='public' AND table_name='events'
ORDER BY ordinal_position;

SELECT pg_get_viewdef('public.v_visible_events_for_friend'::regclass, true);
SELECT column_name, data_type, ordinal_position
FROM information_schema.columns
WHERE table_schema='public' AND table_name='v_visible_events_for_friend'
ORDER BY ordinal_position;

SELECT pg_get_userbyid(relowner) AS owner, relacl
FROM pg_class WHERE oid='public.v_visible_events_for_friend'::regclass;
SELECT * FROM information_schema.view_table_usage
WHERE view_schema='public' AND table_name='v_visible_events_for_friend';
```

증분 migration은 기존 15개 뷰 컬럼 이름·타입·순서를 검사하고 차이가 있으면 preflight 오류로 중단한다. 실제 환경에 다른 컬럼/뷰 정책이 있으면 그 내용을 보존하도록 SQL을 검토해야 한다. 기존 동명 컬럼을 `IF NOT EXISTS`로 넘기지 않으며 중복 적용도 실패한다. events 테이블에 ACCESS EXCLUSIVE 잠금이 필요하므로 적용 시간과 요청 지연을 고려한다.

`CREATE OR REPLACE VIEW`는 기존 컬럼 15개를 그대로 두고 `is_private`를 **viewer_user_id 뒤 마지막**에 추가한다. `SELECT e.*` 재사용이나 `DROP VIEW CASCADE`는 하지 않는다. 새 설치 DDL도 같은 순서다. `final_schema.sql`은 schema 삭제를 포함하는 **로컬 신규 설치 전용**이며 배포 DB에는 실행하지 않는다.

## 파일 역할·의존성·사용 예

| 파일 | 역할 / 의존성 | 사용 예 |
| --- | --- | --- |
| `migrations/add_event_privacy.sql` | 기존 public.events·friendships·friend_level_settings·공개 뷰를 확장하고 private를 차단하는 1회 transaction | 사전 점검·백업 후 psql `-v ON_ERROR_STOP=1 -f migrations/add_event_privacy.sql` 또는 pgAdmin 전체 실행 |
| `visibility_flow.drawio` | 단일 캘린더·본인/타인·private·ACL·레벨·근무표 판정 도면, diagrams.net XML | 일정 조회 endpoint 추가 전 공개 규칙 확인 |
| `test/eventPrivacy.test.cjs` | build된 dist, Node test, 실제 HTTP/인증 route 및 DB 쓰기 대체로 타입·정규화·위조 방지·OpenAPI 검증 | `npm run build && node --test test/eventPrivacy.test.cjs test/eventDeletion.test.cjs` |
| `test/eventPrivacyIntegration.test.cjs` | 실제 Sequelize/PostgreSQL 뷰·HTTP 라우트, 기존 group fixture 및 final DDL, 고정 격리 DB에서만 reset | 아래 통합 명령 실행 |
| `_docs/EVENT_PRIVACY_GUIDE.md` | 이번 API/DB/배포/인수·안전 롤백 정본 | Flutter 활성화와 서버 배포 인수 기준으로 사용 |

기존 `groupIntegration`·`cacheIntegration` fixture는 변경 전 스키마를 유지하고 각 테스트 초기화에서 새 증분 migration을 적용한다. 다른 통합 테스트와 같은 고정 DB를 공유하므로 schema reset 테스트를 동시에 실행하지 않는다.

```sh
npm run debug:group-db:up
npm run test:event-privacy-integration
npm test
npm run debug:group-db:down
```

## 검증 기록 (2026-11-11)

- strict TypeScript build 성공. 별도 lint 명령/설정은 이 저장소에 없다.
- 단위·인증 HTTP·병합 OpenAPI·기존 삭제 테스트: 7 pass / 0 fail.
- 격리 PostgreSQL 16 및 실제 HTTP: 7 pass / 0 fail. 기존 행 false, view 컬럼 이름/순서/타입·OID·SELECT 권한·의존 view, 중복/동명 컬럼/drift 실패, 신규 DDL과 증분 적용 view 정의의 동일성, 구형 INSERT/SELECT/API, owner 위조, timed/종일/다일·레벨 0/2/3/5·soft delete·배타적 경계, 본인 4경로, 레벨 5/2 친구·그룹, 차단/비친구/관리자·다음 요청 권한 철회, private 삭제를 검증했다.
- 전체 npm test는 원본 develop에서도 존재하는 비공개 배포 파일·Apple Stage SQL 누락 및 Apple 가이드 문구 assertion 실패 17개가 있다. 별도 원본 사본과 실패 이름을 비교해 이번 변경의 신규 실패는 0개다. 최종 건수는 WORKLOG를 따른다. 범위 밖 배포 파일을 공개 브랜치로 복사하지 않았다.
- 통합 테스트의 권한 변경 fixture는 기존 모델의 bulk 부분 update가 IDs 없이 notSelf 검증을 실행하는 문제를 피하도록 조회한 인스턴스를 갱신한다. 기존 서비스와 같은 방식이며 제품 모델은 변경하지 않는다.
- Stage/운영 DB migration은 사용자 적용 완료 보고를 기준으로 재실행하지 않았다. 배포 시 두 DB 컬럼/뷰 필터 검사와 배포 후 두 환경 외부 readiness, Stage 병합 OpenAPI 반영을 확인했다. 실제 인증 사용자 A/B/C 실응답·실기기 인수 및 외부 캐시/프록시 구성은 별도이며 Flutter 파일은 수정하지 않았다.

## 롤백

private 데이터가 존재하면 컬럼 삭제 또는 private 차단 조건 제거를 하지 않는다. 새 private 생성만 중지하거나 private를 지원하는 호환 서버로 복구한다. 기존 DB 컬럼·뷰는 그대로 유지하고 데이터 보존/삭제는 별도 명시 정책으로 처리한다. 이 이유로 다운 migration은 제공하지 않는다. 문서·도면·테스트는 해당 diff로 되돌릴 수 있으나 DB 필터 유지 여부를 먼저 확인한다.

## 요청서 인수 상태

- [x] 증분 migration·정본 DDL·로컬 AGENTS·서버 도면 동기화
- [x] 모델·검증·생성·응답·친구/그룹 SELECT 반영
- [x] 관련 단위·격리 PostgreSQL·구형 요청 호환·병합 OpenAPI 검증
- [x] Stage/운영 migration 적용 사용자 확인·서버 자동 배포·컬럼/뷰 검사·readiness 확인
- [ ] 실제 인증 사용자 A/B/C 권한별 실응답·실기기 인수
- [ ] Flutter 요청/응답 필드·나만 보기 활성화(인접 저장소 후속 작업)

Stage/운영 기록에는 적용 커밋, `add_event_privacy.sql` 실행 시각/환경, 본인·친구·그룹별 결과를 남긴다. 사용자가 Stage 정상 및 Center migration 실행 완료를 보고했고 서버 배포·DB 스키마 사전 검사·외부 readiness·Stage OpenAPI 반영을 확인했다. 세부 검증 결과는 WORKLOG를 따른다. migration은 재실행하지 않았다.

# 그룹 기능 실제 동작 검증 체크리스트

## 1. 목적과 증거 기준

이 문서는 그룹 기능을 실제 PostgreSQL 16, Express HTTP 요청, VS Code/DebugMCP 중단점으로 확인할 때 사용하는 실행 체크리스트다. 코드 존재나 mock 성공만으로 완료 처리하지 않는다.

- `[ ]`: 미확인
- `[x]`: 실제 실행 증거를 남기고 통과
- `[!]`: 실패 또는 판단 보류. 증거와 원인을 함께 기록
- 증거는 실행 일시, 환경, 명령/요청, HTTP status·error code, DB 조회 결과, 로그의 `request_id`, 필요 시 디버거 변수 값을 포함한다.
- Local 결과와 Stage 결과를 구분한다. Local 통과만으로 Stage 적용 완료를 표시하지 않는다.
- 개인정보와 그룹명·메모·장소·초대 메시지는 증거 로그에 복사하지 않는다.

### 실행 기록

| 구분 | 값 |
|---|---|
| 검증 환경 | Local / Stage / Center |
| API commit/image digest |  |
| migration SHA-256 |  |
| PostgreSQL 버전/DB 이름 |  |
| 실행자/실행 시각 |  |
| 테스트 `request_id` |  |
| 결과 증거 위치 |  |

### 2026-07-29 Local 준비 smoke 결과

- [x] reset 승인 누락과 잘못된 DB 이름을 각각 주입했을 때 DB module import·연결 전에 안전 테스트가 실패
- [x] 격리 DB 식별: `shift_calendar_group_debug`, `group_debug`, PostgreSQL `16.14`, host publish `127.0.0.1:55432`
- [x] `npm test`: 12건 성공, 인프라/별도 저장소 테스트 3건 의도된 skip
- [x] `npm run test:group-integration`: migration/rollback/reapply와 그룹 실제 동작 8건 성공
- [x] DebugMCP가 source map을 통해 `src/services/groupService.ts:739`의 transaction 진입점에 도달
- [x] 실패 생성 입력 `Atomic Failure`와 정상 생성 입력 `Ward Team`에서 actor, creator timezone, 최종 timezone, invitee locals 확인
- [x] DebugMCP 중단점 2개 제거와 세션 정상 종료
- [x] 디버깅 종료 후 전체 integration 8건 재통과
- [x] tmpfs PostgreSQL 컨테이너와 전용 Compose network 제거
- [ ] D2~D5 잠금·ACL·소유권·삭제 심층 디버깅 증거는 다음 실제 검증 세션에서 기록

## 2. 파괴 작업 안전 확인

`test/groupIntegration.test.cjs`는 `public` 스키마를 삭제하고 재생성한다. Local 전용 격리 DB 이외에는 실행하지 않는다.

- [ ] `DB_HOST=127.0.0.1`, `DB_PORT=55432`, `DB_NAME=shift_calendar_group_debug`, `DB_USER=group_debug`인지 확인
- [ ] `SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), version();` 결과 저장
- [ ] `GROUP_INTEGRATION_ALLOW_SCHEMA_RESET=true`가 격리 테스트 프로세스에만 주입되는지 확인
- [ ] `.env`의 Stage/Center endpoint가 테스트 프로세스에 사용되지 않는지 확인
- [ ] `WORK_SHIFT_CACHE_ENABLED=false`이고 cache worker를 실행하지 않았는지 확인
- [ ] 테스트 종료 후 `npm run debug:group-db:down`으로 임시 DB가 제거되는지 확인
- [ ] Stage/Center migration 전 백업 식별자와 복원 가능 상태를 확인

안전장치 자체의 합격 기준:

- [ ] reset 승인 변수가 없으면 통합 테스트가 DB 연결·schema 삭제 전에 실패
- [ ] DB 이름, host, port, user 중 하나라도 다르면 DB 연결·schema 삭제 전에 실패
- [ ] 고정된 격리 DB 설정에서는 PostgreSQL 16 healthcheck 이후 실행

## 3. Migration 실제 적용

### Preflight와 apply

- [ ] 대상 세 테이블이 모두 없을 때 `add_group_feature.sql`이 한 번에 적용
- [ ] 세 테이블 중 하나만 미리 만들면 preflight가 부분 적용 가능성을 알리고 중단
- [ ] 세 테이블이 모두 존재해도 자동 skip하지 않고 중단
- [ ] apply 실패 시 세 테이블이 일부만 남지 않음
- [ ] PostgreSQL 16에서 따옴표 없는 `groups` 테이블 생성과 조회 성공
- [ ] `pgcrypto`와 기존 `users` 의존성이 없을 때 명확하게 실패

### Postflight

- [ ] `groups`, `group_members`, `group_invitations` 컬럼·타입·nullable·default 대조
- [ ] FK, CHECK, active member/OWNER/PENDING partial unique 제약 대조
- [ ] 수신함·그룹별·활성 멤버 조회 인덱스 대조
- [ ] 세 테이블 COMMENT와 주요 컬럼 COMMENT 조회
- [ ] migration 파일 checksum이 배포 승인값과 일치

### Rollback drill

- [ ] 승인 변수 없이 rollback SQL이 drop 전에 종료
- [ ] `confirm_group_feature_drop=false`에서 drop하지 않음
- [ ] 승인 전 세 테이블 데이터 건수를 출력
- [ ] 별도 승인과 백업이 있는 격리 환경에서만 `group_invitations → group_members → groups` 순서 drop
- [ ] rollback 후 migration 재적용 성공
- [ ] 운영 장애 롤백은 API 이미지부터 복원하고 테이블을 유지하는 절차 확인

## 4. 서버 기동·환경변수·문서 노출

- [ ] `GROUP_MEMBER_LIMIT`, `GROUP_INVITATION_TTL_DAYS`, `GROUP_CALENDAR_MAX_RANGE_DAYS`가 0·음수·문자열이면 기동 실패
- [ ] 설정 누락 시 각각 20, 7일, 양 끝 포함 100일 기본값 사용
- [ ] `API_DOCS_ENABLED=false`에서 `/api-docs`, `/api-docs/openapi.json` 미노출
- [ ] `API_DOCS_ENABLED=true`에서 Swagger UI와 OpenAPI 3.0.3 JSON 응답
- [ ] `/health/live` 200과 `/health/ready`의 PostgreSQL 상태 확인
- [ ] Redis 장애 또는 비활성 상태가 그룹 aggregate를 막지 않음
- [ ] 종료 신호 후 HTTP server와 PostgreSQL 연결 정상 종료

## 5. P0 API 실제 요청

모든 API는 무토큰 `401 UNAUTHORIZED`, 유효한 bearer token의 성공 wrapper, 잘못된 UUID/본문의 고정 error code를 함께 확인한다.

### `POST /api/v1/groups`

- [ ] 이름 trim 및 1자·50자 경계 성공, 빈 문자열·51자 실패
- [ ] 유효한 명시 timezone 저장
- [ ] timezone 누락 시 유효한 생성자 timezone 사용
- [ ] 생성자 timezone이 누락/무효면 `Asia/Seoul` 사용
- [ ] 무효한 명시 timezone은 `400 INVALID_GROUP_TIMEZONE`
- [ ] group과 active OWNER 정확히 한 건 생성
- [ ] 친구인 초기 초대 대상별 PENDING 초대와 `GROUP_INVITATION` 알림 생성
- [ ] 친구가 아닌 대상 하나가 포함되면 group·OWNER·모든 초대·알림이 전부 rollback
- [ ] 중복 대상 bulk 요청은 전부 실패하고 부분 초대가 남지 않음

### `GET /api/v1/groups`

- [ ] active membership이 있는 삭제되지 않은 그룹만 반환
- [ ] `updated_at DESC` 정렬과 page/limit/total/total_pages 일치
- [ ] preview 최대 4명, `OWNER → ADMIN → MEMBER`, 같은 역할은 `joined_at ASC`
- [ ] `my_role`, `member_count`, UTC ISO timestamp 일치
- [ ] email·phone·비공개 사용자 필드 미노출

### `GET /api/v1/groups/:group_id`

- [ ] active 멤버는 멤버 전체와 본인 역할 조회
- [ ] 비멤버·나간 멤버·삭제 그룹은 모두 `404 GROUP_NOT_FOUND`
- [ ] 멤버 정렬과 nullable `profile_image_url` 계약 일치
- [ ] email·phone 미노출

### 초대 생성·수신함·응답

- [ ] `POST /groups/:group_id/invitations`은 OWNER/ADMIN만 성공
- [ ] MEMBER는 `403 GROUP_PERMISSION_DENIED`, 비멤버는 `404 GROUP_NOT_FOUND`
- [ ] 친구만 초대 가능하며 self·active member·동일 PENDING은 고정 `409`/`400` 코드
- [ ] `expires_at`이 생성 시각 기준 설정 TTL과 일치
- [ ] 초대 생성·취소만으로 `groups.updated_at`이 바뀌지 않음
- [ ] `GET /group-invitations/received` pagination/status filter와 만료 정리 동작
- [ ] 수락 시 원래 초대자와 대상의 friendship을 다시 확인
- [ ] 수락 시 active MEMBER 생성, 초대 ACCEPTED, group `updated_at` 갱신
- [ ] 거절 시 membership 미생성, 초대 REJECTED
- [ ] 만료 초대 응답은 `409 GROUP_INVITATION_EXPIRED`
- [ ] 이미 처리된 초대 재응답은 `409 GROUP_INVITATION_ALREADY_PROCESSED`

## 6. P1 관리 API 실제 요청

- [ ] `PATCH /groups/:group_id`: OWNER/ADMIN 이름·timezone 수정과 group `updated_at` 갱신
- [ ] `DELETE /groups/:group_id`: OWNER만 soft-delete
- [ ] `GET /groups/:group_id/invitations`: OWNER/ADMIN 목록·status filter·pagination
- [ ] `PUT /group-invitations/:invitation_id/cancel`: 권한·PENDING 확인과 CANCELED 처리
- [ ] `DELETE /groups/:group_id/members/:user_id`: OWNER가 ADMIN/MEMBER 제거
- [ ] ADMIN은 MEMBER만 제거하고 OWNER/ADMIN 대상은 `403`
- [ ] OWNER 제거 시도는 `409 GROUP_OWNER_CANNOT_BE_REMOVED`
- [ ] `PATCH /groups/:group_id/members/:user_id`: OWNER만 ADMIN/MEMBER 변경
- [ ] active OWNER를 일반 역할 변경 API로 변경할 수 없음
- [ ] `POST /groups/:group_id/leave`: MEMBER/ADMIN 탈퇴와 group `updated_at` 갱신
- [ ] OWNER 탈퇴는 `409 GROUP_OWNER_CANNOT_LEAVE`
- [ ] `PUT /groups/:group_id/owner`: active ADMIN/MEMBER에게만 이전
- [ ] 이전 후 기존 OWNER=ADMIN, 새 OWNER=OWNER이고 active OWNER가 정확히 한 명
- [ ] 제거/탈퇴 후 재초대·수락 시 새 membership 이력이 생성되고 이전 row는 보존
- [ ] 그룹 삭제 시 active membership 제거, PENDING 초대 취소, 관련 알림 terminal 처리

## 7. Transaction·잠금·동시성

- [ ] 그룹 생성 중 알림 생성 실패를 주입하면 group·OWNER·초대가 모두 rollback
- [ ] 기존 그룹 쓰기에서 group row `FOR UPDATE`가 membership/invitation 잠금보다 먼저 획득
- [ ] 동일 invitation 동시 수락 2건 중 정확히 1건만 성공
- [ ] 동시 수락 후 active membership은 1건이고 PENDING은 0건
- [ ] 20번째/21번째 수락 경쟁에서 active member가 20명을 넘지 않음
- [ ] 동일 그룹 동시 소유권 이전 후 active OWNER가 정확히 한 명
- [ ] unique 위반이 DB 원문 대신 계약된 그룹 error code로 매핑
- [ ] rollback 후 `groups.updated_at`, 알림, 초대 상태가 부분 변경되지 않음

## 8. 그룹 캘린더 공개·날짜·직렬화

### 접근 상태

- [ ] 조회자 본인은 `SELF`
- [ ] 다른 멤버가 friendship 존재 + 소유자→조회자 `can_view=true`이면 `VISIBLE`
- [ ] `can_view=false`, friendship 없음, 설정 없음은 `DENIED`
- [ ] `DENIED` 멤버는 members에 유지되며 해당 owner row와 숨겨진 개수는 미반환
- [ ] `VISIBLE` event는 `friend_level >= visibility_level`만 반환
- [ ] `VISIBLE` work shift는 기존 visibility view의 레벨 0 규칙 적용
- [ ] 그룹 가입/탈퇴가 friendship·friend_level_settings를 생성·변경하지 않음

### 범위와 반환 계약

- [ ] 양 끝 포함 1일·100일 성공, 101일은 `400 GROUP_CALENDAR_RANGE_TOO_LARGE`
- [ ] 잘못된 날짜·역순 범위는 `400 INVALID_DATE_RANGE`
- [ ] 윤년 2월, 월 경계, 연도 경계 일수 계산
- [ ] group timezone 시작일 00:00과 종료 다음 날 00:00 UTC 변환
- [ ] event `start_at < end_boundary AND end_at > start_boundary`의 end-exclusive 동작
- [ ] soft-deleted event/work shift 미반환
- [ ] `work_date`가 timezone 변환 없이 원래 `YYYY-MM-DD` 문자열로 유지
- [ ] 모든 shift/event에 올바른 `owner_user_id`
- [ ] timestamp는 UTC ISO 문자열
- [ ] shift 시간 nullable 및 `#AARRGGBB` 색상 형식 일치
- [ ] members는 조회자 우선, 이후 역할·가입일 순서

### Query 수와 성능

- [ ] 활성 멤버·접근 상태 1 query
- [ ] work shift + schedule/type 1 query
- [ ] event 1 query
- [ ] 20명·100일 fixture에서도 calendar DB SELECT가 3회 이하
- [ ] 그룹 aggregate에서 Redis owner-month snapshot을 읽거나 쓰지 않음
- [ ] Stage에서 DB query time, 전체 duration, member/row count, 비압축 response byte 기록

## 9. 알림·HTTP 계약·로그

- [ ] 원본 `GROUP_INVITATION`은 PENDING에서 accept/reject action 제공
- [ ] ACCEPTED/REJECTED/CANCELED 원본 알림은 terminal 타입, `actions=[]`, 읽음 완료
- [ ] EXPIRED 원본 알림은 타입 유지, `payload.invitation_status=EXPIRED`, `actions=[]`, 읽음 완료
- [ ] accept/reject 시 초대자 결과 알림 생성
- [ ] 응답 API가 갱신된 원본 notification 반환
- [ ] OpenAPI path와 실제 P0/P1 라우트·method·status 일치
- [ ] 성공/오류 wrapper, nullable 필드, pagination schema 일치
- [ ] 비멤버와 삭제 그룹의 `404`, 역할 부족 active 멤버의 `403` 구분
- [ ] 그룹 구조화 로그에 request_id, actor, group, action, result, duration 기록
- [ ] 캘린더 로그에 range_days, member/row count, 비압축 response byte 기록
- [ ] 로그에 제목·메모·장소·초대 메시지·email·phone 미기록

## 10. 디버거 검증 시나리오

### 공통 준비

```bash
npm run debug:group-db:up
```

VS Code/DebugMCP에서 `Debug group integration (isolated PostgreSQL 16)` 구성을 선택한다. 이 구성은 build된 JavaScript source map을 `src/**/*.ts`에 연결한다.

디버깅은 항상 다음 순서로 수행한다.

1. 아래 line-content에 중단점을 먼저 설정한다.
2. 디버그 세션을 시작한다.
3. locals와 watch expression으로 기대값을 확인한다.
4. 한 단계씩 진행해 commit 또는 rollback 이후 DB 결과까지 추적한다.
5. 모든 중단점을 제거하고 세션을 종료한다.
6. `npm run debug:group-db:down`으로 격리 DB를 제거한다.

### D1. 그룹 생성 원자성

- 시작 중단점: `src/services/groupService.ts`의 `const result = await sequelize.transaction(async (transaction) => {` (`createGroup`)
- 확인 변수: `actor_user_id`, `name`, `creator_timezone`, `timezone`, `invitee_user_ids`
- 진행 중단점: `Group.create`, `GroupMember.create`, `createInvitations` 호출 직후
- 합격 기준: non-friend 예외 후 같은 transaction의 group/member/invitation/notification row가 0

### D2. 초대 수락 잠금과 경쟁

- 시작 중단점: `respondToInvitation`의 group 조회와 invitation 조회
- 확인 변수: `initial_invitation.group_id`, `group.group_id`, `invitation.status`, `action`
- watch: `member_count`, `getMemberLimit()`, `invitation.inviter_user_id`, `actor_user_id`
- DB 보조 조회: `pg_stat_activity`, `pg_locks`, active membership/PENDING count
- 합격 기준: group lock 다음 invitation lock 순서, 두 수락 중 하나만 commit

### D3. ACL과 3-query aggregate

- 시작 중단점: `getGroupCalendarRange`의 `const members = await sequelize.query<CalendarMemberRow>(`
- 진행 중단점: `const [work_shift_rows, event_rows] = await Promise.all([`
- 확인 변수: `range_days`, `members`, `member_user_ids`, `group_timezone`, `work_shift_rows`, `event_rows`
- watch:
  - `members.map(({ user_id, role, calendar_access }) => ({ user_id, role, calendar_access }))`
  - `work_shift_rows.map(({ owner_user_id, work_date }) => ({ owner_user_id, work_date }))`
  - `event_rows.map(({ owner_user_id, title, visibility_level }) => ({ owner_user_id, title, visibility_level }))`
- 합격 기준: SELF/VISIBLE/DENIED가 fixture와 일치하고 DENIED owner row가 없으며 query count가 3

### D4. 소유권 이전

- 시작 중단점: `transferGroupOwner`의 두 membership 조회 이후
- 확인 변수: `actor_member.role`, `new_owner.role`, `actor_user_id`, `new_owner_user_id`
- 합격 기준: 한 transaction 안에서 기존 OWNER→ADMIN 후 새 OWNER→OWNER, commit 후 active OWNER count=1

### D5. 그룹 삭제 terminal 처리

- 시작 중단점: `deleteGroup`의 group lock 이후
- 확인 변수: `actor_member.role`, PENDING invitation 수, active member 수
- 합격 기준: group soft-delete, membership 제거, PENDING 취소, 알림 완료가 같은 commit에 반영

## 11. 최종 판정

- [x] `npm test`
- [x] `npm run debug:group-db:up`
- [x] `npm run test:group-integration`
- [x] DebugMCP D1 smoke: breakpoint 도달, locals 평가, 중단점 제거와 정상 종료
- [ ] DebugMCP D2~D5 시나리오별 증거 기록
- [ ] 기존 PostgreSQL/Redis `npm run test:integration`
- [ ] `npm audit --audit-level=high`
- [ ] `git diff --check`
- [ ] Stage Swagger/P0 계약/20명·100일 측정
- [ ] Flutter Stage 계약 확인
- [ ] Center 백업·migration·Blue/Green·rollback 준비 승인

모든 필수 항목의 실제 증거가 있고 `[!]`가 해소되기 전에는 Center 배포 완료로 판정하지 않는다.

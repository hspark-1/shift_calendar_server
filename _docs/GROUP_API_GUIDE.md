# 그룹 API 개발·운영 가이드

## 목적과 범위

Flutter 그룹 목록·상세·캘린더 미리보기의 서버 계약입니다. 그룹은 멤버십과 초대만 소유하며 그룹 일정, 그룹 근무, 그룹별 캘린더 ACL은 만들지 않습니다. 개인 캘린더 공개는 기존 friendship과 `friend_level_settings`가 계속 결정합니다.

프론트팀이 실제 앱에 연결할 때 필요한 화면별 호출 순서, DTO/nullability, 캘린더 상태 모델링, 오류 UX와 Stage 인수 체크리스트는 `_docs/GROUP_FRONTEND_API_GUIDE.md`를 사용합니다. 이 문서는 서버 설계·migration·운영 계약을 다룹니다.

## 요청 처리 흐름

```text
Request
  → groupRoutes (authMiddleware, express-validator)
  → groupController (HTTP wrapper/error/log)
  → groupService (transaction, permission, set-based SQL)
  → Sequelize model / PostgreSQL view
```

모든 actor는 JWT의 `req.user.user_id`만 사용합니다. 그룹 변경 transaction은 group row를 먼저 잠급니다. 초대 수락은 group → invitation → 멤버십 순서로 재검증하며, 소유권 이전은 기존 OWNER를 ADMIN으로 바꾼 후 새 OWNER를 설정해 commit 시 active OWNER가 정확히 한 명이 되게 합니다.

## 환경 기본값

| 변수 | 기본값 | 의미 |
| --- | ---: | --- |
| `GROUP_MEMBER_LIMIT` | 20 | 활성 멤버 상한 |
| `GROUP_INVITATION_TTL_DAYS` | 7 | 초대 유효 기간 |
| `GROUP_CALENDAR_MAX_RANGE_DAYS` | 100 | 양 끝 포함 최대 기간 |
| `API_DOCS_ENABLED` | false | Swagger UI/OpenAPI JSON 노출 |

Local/Stage만 `API_DOCS_ENABLED=true`를 명시하고 Center는 기본 비활성으로 유지합니다.

## 공개 endpoint

### P0

| Method | Path | 역할 |
| --- | --- | --- |
| `POST` | `/api/v1/groups` | 그룹+OWNER+초대 원자적 생성 |
| `GET` | `/api/v1/groups` | 내 활성 그룹 목록 |
| `GET` | `/api/v1/groups/:group_id` | 그룹 상세 |
| `GET` | `/api/v1/groups/:group_id/calendar/range` | 그룹 캘린더 3-query 집계 |
| `POST` | `/api/v1/groups/:group_id/invitations` | OWNER/ADMIN bulk 초대 |
| `GET` | `/api/v1/group-invitations/received` | 받은 초대 목록 |
| `PUT` | `/api/v1/group-invitations/:invitation_id/respond` | 초대 수락/거절 |

### P1

| Method | Path | 역할 |
| --- | --- | --- |
| `PATCH` / `DELETE` | `/api/v1/groups/:group_id` | 정보 수정 / OWNER soft-delete |
| `GET` | `/api/v1/groups/:group_id/invitations` | OWNER/ADMIN 초대 목록 |
| `PUT` | `/api/v1/group-invitations/:invitation_id/cancel` | OWNER/ADMIN 대기 초대 취소 |
| `DELETE` / `PATCH` | `/api/v1/groups/:group_id/members/:user_id` | 제거 / OWNER 역할 변경 |
| `POST` | `/api/v1/groups/:group_id/leave` | ADMIN/MEMBER 나가기 |
| `PUT` | `/api/v1/groups/:group_id/owner` | OWNER 소유권 이전 |

완전한 request/response schema와 HTTP 예시는 `API_DOCS_ENABLED=true` 환경의 `/api-docs` 또는 `/api-docs/openapi.json`에서 확인합니다. 이 OpenAPI는 그룹 API만 포함하며 기존 API의 전체 문서가 아닙니다.

## 역할 매트릭스

| 작업 | OWNER | ADMIN | MEMBER |
| --- | --- | --- | --- |
| 목록·상세·캘린더 | O | O | O |
| 이름/timezone 수정 | O | O | X |
| 초대 생성·목록·취소 | O | O | X |
| MEMBER 제거 | O | O | X |
| ADMIN 제거·역할 변경 | O | X | X |
| 나가기 | 이전/삭제 후 | O | O |
| 소유권 이전·삭제 | O | X | X |

비멤버·삭제 그룹은 존재 여부를 숨기기 위해 `404 GROUP_NOT_FOUND`, 멤버 역할 부족만 `403 GROUP_PERMISSION_DENIED`입니다.

## 캘린더 공개와 정렬

1. Query 1은 활성 그룹·actor membership·모든 활성 멤버와 `SELF/VISIBLE/DENIED`를 계산합니다.
2. Query 2는 본인 `work_shifts`와 다른 멤버의 `v_visible_work_shifts_for_friend`를 union하고 schedule/type을 조인합니다.
3. Query 3은 본인 `events`와 `v_visible_events_for_friend`를 union하고 그룹 timezone overlap을 적용합니다.

이벤트 조건은 `start_at < 종료일 다음 날 00:00`과 `end_at > 시작일 00:00`이며 end-exclusive입니다. `work_date`는 사용자 날짜 문자열을 변환하지 않습니다. 모든 shift/event에는 `owner_user_id`가 있습니다.

- members: 조회자 우선 → OWNER → ADMIN → MEMBER → joined_at
- work_shifts: work_date → owner_user_id
- events: start_at → event_id
- `DENIED` 멤버는 members에 남지만 해당 owner의 row나 숨겨진 개수는 없습니다.

## 초대와 알림

- 초대 대상은 초대자와 현재 수락된 친구여야 하며 수락 시 다시 확인합니다.
- bulk 초대는 하나라도 실패하면 group 생성 또는 전체 초대를 rollback합니다.
- 읽기·재초대·응답·취소 시 만료된 PENDING을 EXPIRED로 정리합니다.
- 원본 `GROUP_INVITATION` 알림은 수락/거절/취소 시 terminal 타입, 만료 시 기존 타입을 유지한 채 `payload.invitation_status`, `actions=[]`, 읽음 상태로 갱신합니다.
- 수락/거절은 초대자에게 결과 알림을 추가합니다.
- 외부 push는 이번 범위 밖이며 받은 초대 API와 DB 알림이 source of truth입니다.

## Migration과 롤백

운영 DB에 `final_schema.sql`을 실행하지 않습니다.

### Stage 실행

#### pgAdmin Query Tool

pgAdmin에서 실행할 때는 psql wrapper 대신 아래 단일 SQL을 사용합니다.

```text
migrations/pgadmin_stage_add_group_feature.sql
```

파일 상단 `INSERT INTO stage_group_migration_context`의 다음 세 값만 변경하고, 부분 선택하지 않은 상태에서 전체 파일을 Execute(F5)합니다.

- `REPLACE_WITH_ACTUAL_STAGE_DB_NAME` → pgAdmin에서 선택한 실제 Stage DB 이름
- `REPLACE_WITH_RESTORABLE_BACKUP_ID` → 비공개 실행 환경 Docker PostgreSQL에서 실제 생성하고 복원 확인한 `pg_dump` 백업 파일명. 예: `pg_dump:[private database].backup` (랜덤값 금지)
- `REPLACE_WITH_APPLY_GROUP_FEATURE_TO_STAGE` → `APPLY_GROUP_FEATURE_TO_STAGE`

이 SQL은 psql meta-command 없이 하나의 transaction에서 preflight → public schema DDL → strict postflight를 수행합니다. 중간 검증이 실패하면 마지막 `COMMIT`은 적용되지 않고 전체 DDL이 rollback됩니다. Data Output의 대상 DB, DB 사용자, PostgreSQL 버전, 백업 식별자, 데이터 건수와 제약/index 결과를 저장합니다.

#### psql

먼저 read-only preflight만 실행하고 결과를 저장합니다. `<actual-stage-db-name>`은 연결 URL의 DB 이름을 추정하지 말고 Stage 설정에서 확인한 실제 값을 사용합니다.

```bash
psql "$STAGE_DATABASE_URL" \
  -X \
  -v expected_database='<actual-stage-db-name>' \
  -L '<secure-path>/group-preflight.log' \
  -f migrations/stage_group_feature_preflight.sql
```

DB 백업과 복원 가능 여부를 확인하고 정본 DDL checksum을 대조합니다. 현재 운영 환경은 AWS RDS가 아니라 비공개 실행 환경 Docker `postgres:16`이므로 `backup_reference`에는 RDS snapshot ID가 아닌 실제 `pg_dump`/pgAdmin Custom 백업 파일명을 기록합니다.

```bash
shasum -a 256 migrations/add_group_feature.sql
```

승인된 checksum은 `0f5e86cbd607257d23a91581f8abc20a77390ff7273c9a3d96df4a4f7046f92a`입니다. 적용은 wrapper만 실행합니다.

```bash
psql "$STAGE_DATABASE_URL" \
  -X \
  -v expected_database='<actual-stage-db-name>' \
  -v confirm_stage_group_migration=true \
  -v backup_reference='<restorable-stage-backup-id>' \
  -v migration_sha256='0f5e86cbd607257d23a91581f8abc20a77390ff7273c9a3d96df4a4f7046f92a' \
  -L '<secure-path>/group-apply.log' \
  -f migrations/stage_apply_group_feature.sql
```

`stage_apply_group_feature.sql`은 advisory lock을 획득하고 `search_path=public,pg_catalog`을 강제한 뒤 `stage_group_feature_preflight.sql → add_group_feature.sql → stage_group_feature_postflight.sql` 순서로 실행합니다. 기존 대상 relation, 기반 객체/컬럼 불일치, PostgreSQL 16이 아닌 서버, read replica/read-only 연결, 권한 부족, index 이름 충돌, 승인·백업·checksum 누락이면 DDL 전에 비정상 종료합니다.

postflight는 27개 컬럼, 20개 제약, 11개 index, partial/unique 속성, 필수 COMMENT와 API 배포 전 데이터 0건을 강제로 판정합니다. 출력과 SQL checksum, 대상 DB, 백업 식별자, 실행 결과를 WORKLOG에 기록합니다.

장애 시 이전 API 이미지를 먼저 복원하고 그룹 테이블은 유지합니다. 데이터 폐기가 별도 승인되고 백업된 경우에만 실행합니다.

```bash
psql "$STAGE_DATABASE_URL" \
  -X \
  -v confirm_group_feature_drop=true \
  -f migrations/rollback_group_feature.sql
```

## 검증

```bash
npm run debug:group-db:up
npm test
npm run test:group-integration
npm run test:integration
npm audit --audit-level=high
git diff --check
npm run debug:group-db:down
```

그룹 통합 테스트는 `test/fixtures/groupIntegrationBaseSchema.sql`이 public schema를 삭제합니다. `npm run test:group-integration`은 host·port·DB·user와 명시적 reset 승인값을 고정한 `test/fixtures/groupDebug.compose.yml` 전용 DB에서만 실행되며, 다른 연결값이면 schema 접근 전에 실패합니다. reset 승인값은 `.env`에 상시 저장하지 않습니다.

실제 migration, P0/P1 HTTP, 잠금·동시성, 공개 ACL, 3-query aggregate, 알림·로그·롤백의 판정 항목과 DebugMCP 중단점은 `_docs/GROUP_RUNTIME_VERIFICATION_CHECKLIST.md`를 사용합니다.

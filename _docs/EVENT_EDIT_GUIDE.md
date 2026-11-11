# 개인 일정 전체 수정 API

작성일: 2026-11-12 (Asia/Seoul). 구현·검증 및 Stage/운영 배포 완료. Flutter 실기기 인수는 후속.

## 목적과 요청 흐름

Flutter 메인에서 본인 개인 일정을 탭해 편집한 값을 저장한다.
`Router(auth + express-validator) → Controller(wrapper) → Service → Sequelize/PostgreSQL UPDATE RETURNING → DTO`.
근무표/개인 일정 생성·삭제 계약과 private 공개 필터를 유지한다.

## 계약

`PUT /api/v1/events/{event_id}`. Bearer JWT·application/json 필수.

```json
{"title":"수정한 약속","memo":null,"place":null,"all_day":false,"start_at":"2026-11-12T09:00:00.000Z","end_at":"2026-11-12T10:00:00.000Z","visibility_level":2,"is_private":true}
```

- 위8개 필드 모두 필수. title trim 후 비어 있지 않아야 한다. memo/place는 string 또는 null이며 빈 문자열은 null로 정규화한다. 생략은400이다.
- all_day/is_private는 실제 JSON boolean, visibility_level은 실제 정수0~5. 문자열/숫자 boolean 변환을 하지 않는다.
- 시작/종료는 유효한 UTC ISO Z, start<end. 종일 end_at도 기존 배타적 종료다. route와 서비스 직접 호출에서 검증한다.
- 쓰기 조건은 event_id·owner_user_id=JWT 사용자·deleted_at IS NULL. owner/creator/created_at/deleted_at은 요청으로 변경하지 않는다. 단일 조건부 UPDATE의 RETURNING 결과로 응답하므로 삭제 경합으로 일정이 부활하지 않는다.
- HTTP200 `{success:true,data:EventApiModel,message:"일정이 수정되었습니다."}`. ID/created_at은 보존하고 updated_at을 갱신한다. data는 기존 전체 필드와 is_private를 포함한다.
- Sequelize bulk UPDATE RETURNING은 중복 timestamp DB field를 createdAt/updatedAt으로 매핑하는 현행 모델 특성이 있다. 수정 응답은 해당 getter를 fallback으로 사용해 created_at/updated_at 누락을 방지한다. 다른 모델/생성 경로는 변경하지 않았다.
- 400: INVALID_EVENT_ID, INVALID_TITLE, INVALID_EVENT_TIME, INVALID_VISIBILITY_LEVEL, INVALID_EVENT_PRIVACY, VALIDATION_ERROR. 401 인증 오류. 404 EVENT_NOT_FOUND는 타인/미존재/삭제 행 동일. 500 INTERNAL_SERVER_ERROR. `{success:false,error:{code,message}}` wrapper 유지.
- 마지막 성공 저장 적용 정책. 충돌 version/If-Match·Undo는 제공하지 않는다. private=true는 수정 후에도 본인만 조회 가능하고 친구/그룹 타인 행에서 제외된다. 개인 일정은 서버 비캐시다.
- 실패 로그는 request_id/구조화 logger를 사용하며 예상치 못한 DB 오류의 원본 입력값/일정 본문을 기록하지 않는다.
- DB migration/seed·새 env가 없다. 기존 private 컬럼·뷰를 전제로 한다. 병합 OpenAPI는 `/api-docs/openapi.json`이다.

## 파일 역할·의존성·사용 예

| 파일 | 역할/의존성 | 사용 예 |
| --- | --- | --- |
| `test/eventEditing.test.cjs` | 새 Node test. build된 dist, Express/JWT, 모델 쓰기 대체로 서비스·실제 HTTP 검증 | `npm run build && node --test test/eventEditing.test.cjs test/eventDeletion.test.cjs test/eventPrivacy.test.cjs` |
| 기존 `test/eventPrivacyIntegration.test.cjs` | 전용 PostgreSQL/실제 HTTP·기존 사용자/친구/그룹 fixture에 수정 인수 추가 | `npm run test:event-privacy-integration` |
| `_docs/EVENT_EDIT_GUIDE.md` | 이 API/검증/배포·롤백 계약 정본. 현행 events/private 정책에 의존 | Flutter 연결·서버 배포 전 인수 검토 |

수정한 기존 제품 파일은 calendarRoutes/calendarController/calendarService, calendarOpenApi.json이다. 새 엔티티/테이블/도면 구조 변경은 없다.

## 검증과 배포

- strict TypeScript build 통과. 별도 lint 설정/명령은 없다.
- 신규 수정·기존 생성/private/삭제 단위·실제 인증 HTTP 10 pass/0 fail.
- 고정 격리 PostgreSQL16 및 실제 HTTP 8 pass/0 fail: 기존7개+수정 소유권/선택정보 null 삭제·기간 이동·전체 timestamps·공개↔private/친구·그룹 차단·삭제 경합 인수.
- 전체 npm test:91 pass/17 fail/13 skip. 변경 전 HEAD 사본은86 pass/17 fail/15 skip. 실패 이름17개가 같고 신규 실패0개다. 비공개 배포 파일·기존 Apple SQL/문서 assertion 실패는 변경 범위 밖으로 보존했다. 로컬 Git 제외 파일 존재에 따라 pass/skip 수가 다르다.
- 디버거에서 UPDATE 반환 timestamp getter/fieldAttributeMap을 직접 확인해 응답 누락을 수정했다. 임시 진입점/중단점·세션은 정리했다.
- 후속 배포 검증: 비공개 main 통합 코드 strict build·전체 131 pass/0 fail/14 명시적 skip, 개인 일정 PostgreSQL/실제 HTTP 8 pass/0 fail 및 배포 CI의 캐시·푸시·인증·프로필·탈퇴/개인정보 통합 검사·이미지 빌드·배포가 통과했다.
- 기능 `744b106`을 공개 develop에 push하고 기존 자동 배포로 Stage/운영 반영을 완료했다. 양 환경 readiness HTTP 200/success=true/cache=ready 및 실제 OpenAPI의 PUT과 8개 필수 필드를 확인했다. DB SQL·실제 환경변수·사용자 데이터를 직접 변경하지 않았다. 실제 사용자 Flutter 실기기 수정/재조회 인수는 후속이다.
- `npm audit --audit-level=high`는 기존 잠금파일의 22건(낮음 1·보통 13·높음 7·치명적 1)으로 실패했다. 이번 API 변경의 의존성 diff는 없으며 보완은 별도 작업이다.

## Behavior change와 롤백

새 PUT으로 본인 개인 일정의 편집 필드를 변경할 수 있다. 기존 GET/POST/DELETE는 유지한다.
롤백은 신규 PUT route를 비활성화하거나 직전 호환 서버로 복구한다. 이미 수정된 사용자 데이터와 private 컬럼/필터는 유지한다. 코드·테스트/문서만 이번 diff로 되돌리고 사용자 데이터를 임의 복구하지 않는다.

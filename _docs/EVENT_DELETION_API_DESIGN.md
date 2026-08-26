# 개인 일정 삭제 API 설계

## 1. 목적과 현행 감사 결과

Flutter 개인 캘린더에서 사용자가 자신이 등록한 개인 일정 1건을 삭제할 수 있는 서버 계약을 확정합니다.

저장소에는 이미 `DELETE /api/v1/events/:event_id`가 구현되어 있습니다. 따라서 이 문서의 구현 목표는 중복 endpoint 추가가 아니라 다음 현행 결함을 보완해 운영 계약을 완성하는 것입니다.

- 라우트에 `event_id` UUID validation이 없어 잘못된 값이 서비스와 PostgreSQL까지 전달될 수 있음
- 서비스가 활성 row 조회 후 별도 update를 실행해 동시 삭제 요청 사이에 경쟁 구간이 있음
- 서비스 내부 오류는 `EVENT_NOT_FOUND`인데 HTTP 오류 코드는 일반 `NOT_FOUND`로 반환되어 계약이 불명확함
- 삭제 endpoint의 OpenAPI와 자동화된 삭제 회귀 테스트가 없음

## 2. 범위

### 포함

- 인증 사용자가 자신이 소유한 활성 개인 일정 1건을 soft delete
- UUID path parameter 검증
- 소유권·활성 상태를 포함한 단일 원자적 조건부 update
- 성공/validation/인증/not-found/서버 오류 응답 계약
- 본인·친구·그룹 캘린더에서 삭제 직후 비노출 확인
- OpenAPI와 단위·통합 테스트

### 제외

- 일정 수정 API
- 일정 복구 API와 휴지통 UI
- 일정 일괄 삭제
- 친구 또는 그룹 관리자의 타인 일정 삭제
- 물리 삭제와 삭제 데이터 보존 기간 정책
- 반복 일정의 단건/이후 일정 삭제 규칙

현재 `events`에는 반복 일정 모델이 없으므로 이 endpoint는 `event_id`가 가리키는 row 1건만 처리합니다.

## 3. 근거가 되는 현재 구조

- `events.event_id`는 UUID PK입니다.
- 일정 소유자는 `events.owner_user_id`이고 생성자는 `created_by_user_id`입니다. 삭제 권한은 생성자가 아니라 현재 소유자를 기준으로 판단합니다.
- soft delete 감사 컬럼은 `deleted_at`, `deleted_by_user_id`입니다.
- 본인 일정 조회와 `v_visible_events_for_friend`는 `deleted_at IS NULL`만 반환합니다.
- 그룹 캘린더도 본인 `events`와 `v_visible_events_for_friend`를 합쳐 조회하므로 같은 삭제 조건이 적용됩니다.
- 개인 일정은 Redis 월 캐시에 저장하지 않습니다.

따라서 schema, migration, Redis key 또는 Outbox 변경은 필요하지 않습니다.

## 4. HTTP 계약

### 요청

```http
DELETE /api/v1/events/{event_id}
Authorization: Bearer <access_token>
```

- `event_id`: 필수 UUID 문자열
- request body: 없음
- 인증: 기존 `authMiddleware` 필수

### 성공 응답

HTTP `200 OK`

```json
{
  "success": true,
  "data": {
    "event_id": "2f0d8f41-4589-4f70-8d1f-fbf3fc274f98"
  },
  "message": "일정이 삭제되었습니다."
}
```

현재 클라이언트가 사용 가능한 `data.event_id`를 유지하고 선택 필드인 `message`만 추가하므로 하위 호환입니다. `204 No Content`는 공통 성공 wrapper와 삭제 대상 식별자를 잃기 때문에 사용하지 않습니다.

### 오류 응답

| HTTP | `error.code` | 조건 | 클라이언트 처리 |
|---|---|---|---|
| 400 | `INVALID_EVENT_ID` | `event_id`가 UUID가 아님 | 요청 생성 오류로 처리, 목록은 유지 |
| 401 | `UNAUTHORIZED` | Access Token 없음·만료·무효 | 로그인/토큰 갱신 흐름 |
| 404 | `EVENT_NOT_FOUND` | 일정 없음, 타인 소유, 이미 삭제됨 | 로컬 일정 제거 후 목록 재조회 가능 |
| 500 | `INTERNAL_SERVER_ERROR` | 예상하지 못한 서버/DB 오류 | 일정 유지, 재시도 안내 |

타인 일정의 존재 여부를 노출하지 않기 위해 미존재·타인 소유·이미 삭제를 구분하지 않고 같은 `404 EVENT_NOT_FOUND`로 반환합니다.

반복 DELETE는 첫 요청만 `200`, 이후 요청은 `404`인 strict delete 계약으로 고정합니다. 이는 기존 근무표 삭제와 현재 일정 삭제 동작을 유지합니다.

## 5. 처리 흐름

```text
DELETE /api/v1/events/:event_id
  → authMiddleware: JWT 사용자 확인
  → express-validator: event_id UUID 확인
  → calendarController.deleteEvent
  → calendarService.deleteEvent
  → events 단일 조건부 UPDATE
       WHERE event_id = :event_id
         AND owner_user_id = :current_user_id
         AND deleted_at IS NULL
       SET deleted_at = now(),
           deleted_by_user_id = :current_user_id,
           updated_at = now()
  → affected row = 1: 200
  → affected row = 0: 404 EVENT_NOT_FOUND
```

단일 SQL 문 자체가 원자적이므로 별도 transaction이나 선행 `SELECT ... FOR UPDATE`는 필요하지 않습니다. 동시에 같은 일정을 삭제해도 조건부 update에 성공한 요청은 하나뿐이며 나머지는 `404`가 됩니다.

## 6. 계층별 구현 설계

### Router

대상: `src/routes/calendarRoutes.ts`

- `express-validator`의 `param`을 import
- `param("event_id").isUUID()` validation 추가
- 기존 전역 `authMiddleware` 아래에 route 유지

### Controller

대상: `src/controllers/calendarController.ts`

- `validationResult(req)`로 path validation 결과 확인
- 실패 시 `400 INVALID_EVENT_ID`
- 성공 시 `200`, `data.event_id`, 성공 메시지 반환
- 서비스의 `EVENT_NOT_FOUND`를 `404 EVENT_NOT_FOUND`로 그대로 매핑
- 예상하지 못한 오류만 `500 INTERNAL_SERVER_ERROR`로 매핑
- 로그에는 request ID와 내부 오류만 남기며 JWT나 요청 헤더는 남기지 않음

### Service

대상: `src/services/calendarService.ts`

- 선행 `Event.findOne()` 제거
- `Event.update()`에 `event_id`, `owner_user_id`, `deleted_at: null` 조건을 모두 포함
- `deleted_at`, `deleted_by_user_id`, `updated_at` 갱신
- 영향 row가 0이면 `EVENT_NOT_FOUND`
- 반환 타입은 기존 `Promise<void>` 유지

### Model/DB/View

대상: `src/models/Event.ts`, `migrations/final_schema.sql`, `schema.drawio`, `visibility_flow.drawio`

- 코드·DDL·다이어그램의 현재 컬럼과 공개 흐름을 그대로 사용
- DB migration과 인덱스 추가 없음
- PK인 `event_id`로 대상을 찾으므로 삭제용 추가 인덱스 없음
- 본인·친구·그룹 조회의 `deleted_at IS NULL` 계약 유지

### OpenAPI

`src/openapi/calendarOpenApi.json`을 `src/openapi.ts`에서 통합 OpenAPI에 병합합니다.

- Bearer 인증
- UUID path parameter
- `200`, `400`, `401`, `404`, `500` 예시
- `EventDeleteSuccess`, `EventErrorResponse` schema

파일의 역할·의존성·사용 예는 `PROJECT_CONTEXT.md`에 기록합니다.

## 7. 정합성·보안·캐시

- 권한 판단은 요청의 사용자 ID나 `created_by_user_id`가 아니라 JWT 사용자와 `owner_user_id` 일치 여부로만 수행합니다.
- `404` 응답은 타인 일정 존재 여부를 숨깁니다.
- soft delete 성공 후 원본 row와 감사 값은 DB에 남습니다.
- 개인 일정은 Redis 비캐시 대상이므로 캐시 무효화나 Outbox 기록이 없습니다.
- 본인 `GET /events`, `GET /calendar/day`, `GET /calendar/range`, 친구 캘린더, 그룹 aggregate는 다음 DB 조회부터 삭제 일정을 반환하지 않습니다.
- 삭제 알림과 Push job은 생성하지 않습니다.

## 8. 테스트 설계

### Controller/계약 테스트

- 유효 UUID와 인증 사용자: `200`, 동일 `event_id`
- 잘못된 UUID: `400 INVALID_EVENT_ID`, 서비스 미호출
- 토큰 없음·만료·무효: `401 UNAUTHORIZED`
- 서비스 `EVENT_NOT_FOUND`: `404 EVENT_NOT_FOUND`
- 예기치 않은 오류: `500 INTERNAL_SERVER_ERROR`

### PostgreSQL 통합 테스트

- 본인 활성 일정: `deleted_at`과 `deleted_by_user_id` 설정, `updated_at` 갱신
- 존재하지 않는 일정: `404`
- 타인 소유 일정: `404`, row 불변
- 이미 삭제된 일정: `404`, 최초 삭제 감사 값 불변
- 같은 일정 동시 삭제: 정확히 1건 성공, 나머지는 not found
- 삭제 후 본인 이벤트/일·기간 캘린더 조회에서 제외
- 삭제 후 친구 공개 view와 그룹 aggregate 조회에서 제외
- 다른 일정과 근무표는 영향 없음

### 필수 검증 명령

```bash
npm run build
npm test
```

격리 PostgreSQL fixture와 실행 스크립트를 추가한 경우 해당 일정 삭제 통합 테스트도 필수로 실행합니다. 공유 개발·운영 DB에서 schema reset fixture를 실행하지 않습니다.

## 9. 배포와 롤백

- DB migration, seed, 환경변수, feature flag 변경 없음
- endpoint path와 성공 응답의 `data.event_id`는 유지하므로 하위 호환
- 오류 코드는 일반 `NOT_FOUND`에서 `EVENT_NOT_FOUND`로 구체화되므로 Flutter의 error mapping을 서버 배포 전에 추가
- Stage에서 정상/타인/중복 삭제와 본인·친구·그룹 비노출을 확인한 뒤 Production 배포
- 애플리케이션 롤백은 관련 route/controller/service/OpenAPI 변경을 이전 버전으로 되돌림
- 이미 soft delete된 데이터는 코드 롤백으로 복구되지 않으며, 복구가 필요하면 운영 승인 후 `deleted_at`, `deleted_by_user_id`를 검증하여 별도 DB 복구 절차로 처리

## 10. 구현 완료 기준

- [x] UUID validation이 DB 접근 전에 동작
- [x] 삭제가 소유자·활성 조건을 포함한 단일 SQL update로 처리
- [x] 성공/오류 응답이 본 문서와 일치
- [x] 본인·친구·그룹 조회의 기존 `deleted_at IS NULL` 비노출 경로 유지
- [x] 영향 row 기반 동시 삭제 계약을 서비스 테스트로 고정
- [x] OpenAPI와 `PROJECT_CONTEXT.md` 최신화
- [x] `WORKLOG.md`에 구현 목적·변경·영향·테스트·롤백 기록
- [x] `npm run build`, 삭제 API 단위·정적 계약 테스트 통과

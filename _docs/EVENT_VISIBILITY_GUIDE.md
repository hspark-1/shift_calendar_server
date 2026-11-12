# 개인 일정 공개 레벨1~5 정책

## 목적과 계약

사용자 기획은 친구 레벨0에서 근무표만 열람하고, 개인 일정은1부터 공개하는 것이다. 개인 일정 POST/PUT은 공개 여부와 무관하게 정수 범위1~5를 요구한다. 생성 route는 기존 숫자 문자열 변환 계약을 유지하고 수정은 실제 JSON 정수만 허용한다. 범위 밖/누락은 기존400 INVALID_VISIBILITY_LEVEL 응답이다. private=true는 여전히 소유자 전용이며 레벨5를 나만 보기로 해석하지 않는다. 근무표 visibility_level=0과 친구 friend_level=0~5는 바꾸지 않는다.

요청 처리: calendarRoutes validation → calendarController 기존 오류 매핑 → calendarService create/update 검증 → Event 모델(min1/max5/default1) → PostgreSQL CHECK/default. 본인 조회와 친구/그룹의 공개 view·ACL·레벨 비교는 유지하며 별도 개인 일정 캐시는 없다.

## 파일 역할·의존성·사용 예

- src/routes/calendarRoutes.ts·src/services/calendarService.ts·src/models/Event.ts: HTTP/직접 서비스/ORM의 새 개인 일정 저장 범위를 고정한다. 기존 오류 코드와 응답 wrapper를 사용한다.
- src/openapi/calendarOpenApi.json·groupOpenApi.json: 생성/수정·본인/친구/그룹 개인 일정의 범위를1~5로 명시한다. 신규 DDL 및 schema.drawio/visibility_flow.drawio도 같은 규칙이다.
- migrations/restrict_event_visibility_levels.sql: 기존 events의 레벨0만1로 보정하고 default1·ck_events_visibility BETWEEN1AND5를 적용하는 증분 SQL이다. PostgreSQL과 기존 events에 의존하며 is_private·소유자/ID·시각/생성·수정·삭제 메타데이터와 근무표/친구 설정은 변경하지 않는다. 적용 예는 해당 환경의 기존 PostgreSQL 연결로 `psql ... -v ON_ERROR_STOP=1 -f migrations/restrict_event_visibility_levels.sql`을 실행하는 것이다. 접속 비밀은 문서에 넣지 않는다.
- migration은 transaction·5초 lock_timeout·테이블 쓰기 잠금을 사용한다.5초는 잠금 획득 대기 제한이며 전체 실행/잠금 유지 시간 상한은 아니다. 예상 밖 레벨(<0/>5)이 있으면 preflight에서 전체를 거절하며 자동 보정하지 않는다. 재실행은0 대상이 없으면 데이터 변경 없이 동일 제약/기본값을 유지한다. 소프트 삭제된0도 새 제약에 맞게1로 보정한다. updated_at은 보존한다.
- .gitignore는 비밀을 포함하지 않는 이번 증분 SQL만 명시적으로 예외 처리한다.
- test/eventPrivacy.test.cjs·eventEditing.test.cjs: 생성/수정의0 거절·1/5 허용·private/소유권·OpenAPI 범위·근무표 기본0을 검증한다. eventPrivacyIntegration.test.cjs는 전용 고정 로컬 PostgreSQL에서 실제 migration/HTTP/친구·그룹 레벨0 열람을 확인한다. DB reset은 기존 명시적 guard 안에서만 실행한다.

## 배포 및 기존 데이터

**Behavior change**: 구형 앱이 개인 일정 레벨0을 보내면400이다. Flutter는 기본1·선택1~5·로컬 전송 전 검증을 사용하고 기존0 편집은 저장 시1 이상 보정 안내를 표시한다. 새로운 Flutter의1~5 요청은 기존 서버 범위에도 포함되므로 앱을 먼저 제공할 수 있다.

1. 해당 환경에서 기존 레벨 범위를 먼저 점검한다.0~5 밖의 값은 별도 검토하고 배포 중 writes/잠금 시간을 고려한다.
2. 개인 일정1~5를 검증하는 서버를 배포한다. 기존 레벨0 조회 데이터는 SQL 적용 전까지 기존 공개 규칙에 남으므로 마이그레이션을 함께 적용한다.
3. 증분 SQL을 적용해 기존0→1과 기본값/제약을 확정한다. 최종 DDL은 신규 설치용이며 운영 DB에 final_schema.sql을 실행하지 않는다.
4. 레벨0 친구가 친구/그룹에서 근무표만 조회하고,1/5 공개 및 private·ACL 조건이 유지되는지 인수한다. 환경변수/새 인덱스·seed는 없다.

이번 작업은 로컬 구현/격리 DB 검증까지다. Stage/운영 배포·운영 데이터 보정·실기기 인수는 수행하지 않았다.

## 테스트와 롤백

- TypeScript strict build 및 관련 서비스/인증 HTTP12개 통과.
- 이번 전용 PostgreSQL/실제 HTTP9개 통과:0→1 외 필드 동일·예상 밖6 preflight 원자 거절·재실행·기본1·DB0/-1/6 차단·친구/그룹 레벨0 근무만 조회와 기존 private/수정/삭제 경합 보존.
- 서버 전체는 변경 전91 pass/17 fail/13 skip, 변경 후93 pass/17 fail/13 skip이며 실패 이름 집합이 같아 신규 실패는 없다. 기존 비공개 배포 파일 누락/Apple 계약 실패 등 목표 밖 실패는 보존했다.
- 격리 DB 컨테이너/네트워크는 검증 후 제거했다. 기존 사용자 컨테이너/원격 DB에는 연결하지 않았다.
- 롤백은1~5 저장과 private/ACL을 보존하는 호환 소스로 복구한다. 변환된1을0으로 되돌리거나 DB 제약을 제거해 레벨0 개인 일정을 다시 노출하지 않는다. 기존1과 보정된1을 구분할 수 없으므로 일괄1→0 다운 SQL은 제공하지 않는다.

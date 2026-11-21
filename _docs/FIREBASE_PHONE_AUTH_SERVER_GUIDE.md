# Firebase Phone Auth 서버 계약

작성/개정: 2026-11-21. 서버 ADR-0052 / 모바일 요청서 ADR-0088 대응.
이 문서는 구현 계약과 출시 인수를 구분한다. 로컬 검증은 운영 설정·배포 완료를 의미하지 않는다.

## 요청 흐름과 API

`Flutter → 앱 JWT + challenge 생성 → Firebase SDK 번호 인증 → ID token 교환 → 앱 저장 증명 + 프로필 저장`

서버 내부는 `Router → IP 제한/auth/express-validator → Controller → PhoneVerificationService → FirebasePhoneTokenVerifier / Sequelize`다. Firebase I/O 동안 DB transaction을 열지 않는다. 프로필은 기존 계정 session lock(이미지/멱등 요청) → User UPDATE lock → challenge UPDATE lock → 영수증 순서로 처리한다. 이미지 외부 I/O는 session lock만 유지하고 DB transaction 밖에서 수행한다.

모든 경로 prefix는 `/api/v1`. 인증은 기존 ShiftMate Bearer JWT다. Firebase ID token을 Authorization에 넣지 않는다. 성공 `{success:true,data,request_id}`, 실패 `{success:false,error:{code,message},request_id}`, `Cache-Control: private, no-store`를 사용한다. OpenAPI는 `API_DOCS_ENABLED=true`일 때 `/api-docs/openapi.json`에 병합된다.

| API | 입력 | 결과 |
| --- | --- | --- |
| POST /auth/phone/challenges | `phone`, `purpose: SIGNUP/PHONE_CHANGE`, UUID Idempotency-Key | 200 challenge_id/phone(숫자)/phone_e164/purpose/server_now/expires_at |
| POST /auth/phone/verify | `challenge_id`, `firebase_id_token`, UUID Idempotency-Key | 200 phone_verification_token/phone(숫자)/purpose/server_now/expires_at |
| POST /auth/profile/complete | 기존 필수 프로필 + phone_verification_token + UUID Idempotency-Key | 미완료 계정의 SIGNUP 증명 소비 후 본인 프로필 |
| POST /auth/profile | 기존 부분 수정 + 번호가 다르거나 proof를 보냈다면 PHONE_CHANGE 증명·UUID Idempotency-Key | 최신 본인 프로필 |

예: challenge body `{"phone":"01012345678","purpose":"SIGNUP"}`. Firebase 번호는 `+821012345678`이며 `+82010…`은 거절한다. DB와 본인 프로필은 `010-1234-5678` 형식이다. 신규 인증/프로필 입력은 기존 Google 번호 정책의 `01[016789]` 10~11자리를 따른다. 01X의 Firebase 실제 제공 가능 여부는 Stage 인수 대상이다. 해외 지원은 추가하지 않는다.

JSON/multipart 모두 proof를 받으며 기존 `profile_image` 파일 1개/5MB·MIME·magic 검증을 유지한다. 내부 계정 ID·이미지 key·완료/인증 시각·generation은 입력으로 반영하지 않는다. 번호 null/빈 값은 INVALID_PHONE, 생략은 유지다.

## 확정 시간·제한·멱등성

| 항목 | 기본값 / 경계 |
| --- | --- |
| challenge TTL | 600초, 양의 정수·최대3600 |
| 최근 Firebase 인증 | now−auth_time ≤300초, 설정 상한600초 |
| challenge 이전 인증 허용 오차 | floor(created_at/1000)−5초 이상. 미래 auth_time/iat도 최대5초까지만 허용 |
| proof TTL | 교환 승인부터300초, 양의 정수·최대3600 |
| challenge 제한 | 사용자10회/IP30회, UTC 시각의 고정1시간 구간 |
| exchange 제한 | 사용자30회/IP100회, UTC 시각의 고정10분 구간 |
| 보관 | 세션: challenge/proof 만료 후 최소24시간, 영수증: commit 후24시간, 이벤트 HMAC: 교환 후24시간 |

기존 프로세스별 authRateLimit도 적용한다. 신규 공통 제한은 PostgreSQL UPSERT/transaction이므로 Redis 캐시 flag/재시작과 독립이며 모든 API 인스턴스가 공유한다. 실패·재시도도 카운터에 포함하고 초과 시429 PHONE_VERIFICATION_RATE_LIMITED + Retry-After/오류 retry_after_seconds를 반환한다. 고정 구간 경계에서 순간 요청이 늘 수 있으므로 rolling window/SMS 비용 한도로 해석하지 않는다. DB 제한 처리 장애는503이며 무제한 fallback하지 않는다.

challenge/verify 각각 `(user_id, operation, key)`에 대해 복구한다. challenge는 **현재도 유효한 세션에만** 기존 ID/기한을 그대로 반환해 만료를 연장하지 않는다. 기존 key의 fingerprint를 확인한 뒤 동일 User→challenge 잠금 안에서 취소/만료/소비·proof 기한·현재 가입 목적·번호 점유를 재검사한다. 취소400 PHONE_VERIFICATION_INVALID, 세션 만료410 PHONE_CHALLENGE_EXPIRED, 증명 만료410 PHONE_VERIFICATION_EXPIRED, 소비409 PHONE_VERIFICATION_USED, 현재 목적 불일치400 PHONE_VERIFICATION_PURPOSE_INVALID, 번호 점유409 PHONE_ALREADY_EXISTS는200으로 복구하지 않는다. 앱은 이러한 확정 실패와 IDEMPOTENCY_KEY_REUSED/PHONE_VERIFICATION_INVALID_RESPONSE에서 요청 key를 폐기하고 다음 사용자 시도에 새 key를 발급한다. 응답 유실·일시적 네트워크/503·429 재시도는 같은 key를 유지한다. 오류 응답에서는 Firebase SDK 발송을 시작하지 않는다. verify fingerprint는 검증된 project/uid/auth_time/번호/challenge이며 token 문자열 refresh를 새 이벤트로 취급하지 않는다. 만료·취소·소비된 proof는 재발급하지 않는다.

프로필 영수증은 `(user_id,key)` PK + operation + 정규화한 필드/사진 SHA-256·MIME/확장자/proof의 HMAC fingerprint를 보관한다. 같은 key에 다른 본문·작업은409 IDEMPOTENCY_KEY_REUSED다. 같은 key의 commit 결과는 재저장/재업로드 없이 **최신 본인 프로필**을 응답한다. 최소24시간 복구를 지원하며 정리 이후 복구는 보장하지 않는다. 동일 번호라도 소비된 proof가 포함된 새 key는409 PHONE_VERIFICATION_USED다. proof를 보내지 않은 동일 번호/타 필드 편집은 계속 허용한다.

## Firebase와 DB 경계

API 전용 named Admin app `shiftmate-phone-auth-{project}`를 ADC로 초기화한다. push worker flag와 무관하게 API 시작 시 project/키 파일/시간 설정을 검사하고 신규 DB schema도 확인한다. `getAuth(app).verifyIdToken(token,true)`로 서명/aud/iss/exp와 폐기·비활성 사용자를 확인한다. Firebase phone provider·비어 있지 않은 일치 sub/uid·번호·auth_time/iat/exp를 추가 검증하며 tenant 토큰은 지원하지 않는다. iat refresh로 auth_time freshness를 대체하지 않는다.

Admin13.10.0은 서명키 조회 장애도 `auth/argument-error`로 래핑할 수 있다. 설치 SDK 소스를 확인하고 알려진 토큰 검증 오류 prefix만400으로 분류한다. 그 외 argument-error/네트워크·ADC·IAM·Auth 조회 장애는503이다. 원문 오류는 응답/로그에 전달하지 않는다. 실제 SDK RSA 검증에서 외부 cert fetch만 대체한 회귀로 이 구분을 확인한다.

검증 성공은 번호 소유 증거일 뿐 ShiftMate 로그인/계정 연결이 아니다. UID/이메일로 앱 계정을 찾지 않으며 Firebase token 자체가 앱 사용자·challenge nonce를 증명한다고 설명하지 않는다. 서버 교환 시 앱 JWT 사용자/challenge/목적/번호에 귀속시킨다.

인증 이벤트는 project+uid+auth_time을 용도 분리 HMAC으로 만들고 `phone_verification_events.event_hash`의 전역 PK로 한 번만 claim한다. 같은 초의 동일 UID는 보수적으로 한 이벤트다. 키 회전 중 모든 지원 키 digest를 같은 transaction에서 INSERT하고 하나라도 충돌하면 모두 rollback한다. token refresh/다른 사용자/다른 challenge로 재사용할 수 없다. SDK 호출 후 User/challenge 상태와 중복 번호를 잠금 안에서 다시 확인한다.

User.phone/phone_verified_at/profile_completed_at, proof.consumed_at, 영수증은 하나의 PostgreSQL transaction이다. 실패 시 모두 rollback하고 준비한 이미지는 기존 영속 정리 큐가 처리한다. Firebase signOut/계정 삭제를 DB commit 보장에 포함하지 않는다. proof는 랜덤 UUID proof_id + 용도 분리 HMAC이며 DB에는 digest/key version만 저장한다. ID token·refresh token·proof 원문·UID 원문은 저장하지 않는다.

## 회원 이행·접근 허용 목록

- 기존 완료 회원은 phone_verified_at=null이어도 로그인·업무 API·미변경 번호의 타 필드 편집을 허용한다. 기존/OAuth 번호·완료 시각으로 인증 시각을 backfill하지 않는다. Google/Naver는 신규/빈 번호만 채우고 인증 시각을 쓰지 않는다.
- 가입은 OAuth 번호가 있어도 SIGNUP 증명이 필수다. 완료 계정의 새로운 complete mutation은409 PROFILE_ALREADY_COMPLETED이며 성공 영수증만 복구한다.
- 미완료 계정의 일반 `/auth/profile`에서 phone을 보내면400 PROFILE_SETUP_REQUIRED다. 타 필드/사진 편집은 완료 상태를 만들지 않는다.
- 미완료 계정은 auth 라우트(로그인/refresh/logout/phone/profile 조회·완료·계정 삭제/탈퇴 상태) 및 공개 health/앱 호환 정책, 인증된 `/profile-images/:user_id`, `PUT /devices/current`를 이용할 수 있다. 그 외 calendar/schedule/friend/group 등 업무 라우트는 공통 gate에서400 PROFILE_SETUP_REQUIRED로 차단한다. 탈퇴 진행 계정 차단은 먼저 적용한다.
- 가입 중 push 등록은 허용한다. 기존 권한/token 없을 때 비활성 target 처리 계약을 유지하며 push 실패를 가입 완료 transaction에 연결하지 않는다. Flutter 실제 가입/FCM 재시작 인수는 별도다.
- phone_verified_at은 본인 프로필/OAuth User에만 추가한다. 친구 정확 일치 검색·목록·그룹의 전화/인증 시각 비노출을 유지한다. 검색을 검증 완료 회원만으로 제한하는 정책은 이번에 도입하지 않는다.

## 설정·migration·키 회전

API 필수: `PHONE_AUTH_FIREBASE_PROJECT_ID`, `PHONE_VERIFICATION_HMAC_KEY_FILE`, API에서 사용할 ADC. 프로젝트는 Stage/운영별 실제 허용 ID를 각각 제공하며 임의 추정/자동 FCM fallback을 사용하지 않는다. Google ADC workload identity 또는 `GOOGLE_APPLICATION_CREDENTIALS` 파일을 사용한다. Auth 사용자 조회/폐기 확인에 필요한 IAM과 실제 네트워크/credential 동작은 담당 환경에서 인수한다. FCM worker credential을 자동 공유하지 않는다.

비밀 파일 형식은 `{"current":"v2","keys":{"v1":"<32바이트 base64>","v2":"<새 32바이트 base64>"}}`다. `crypto.randomBytes(32)`로 생성해 secret 저장소에 보관하며 문서/앱 define/Git에 실제 값을 넣지 않는다. 파일 권한은 서비스 계정 읽기만 허용한다. proof/event/request fingerprint/rate-limit 키는 HMAC으로 용도 분리 파생한다. API 재시작으로 반영하며, 먼저 모든 인스턴스에 새+이전 키를 배포한 뒤 current를 바꾼다. 마지막 이전 키 사용 이후 **24시간 + 최대 challenge/proof TTL(안전하게26시간)** 동안 이전 키를 유지하고 worker 정리 지연·살아 있는 영수증 확인 후 제거한다. 인스턴스 간 지원 키 집합이 겹치지 않는 교체는 금지한다.

TTL·한도 환경변수 이름/기본값은 `.env.example`과 위 표를 따른다. `FIREBASE_AUTH_EMULATOR_HOST`는 모든 실제 API 환경에서 시작 거부한다(Stage 포함). 테스트는 격리된 constructor 주입으로만 emulator를 사용하며 HTTP flag로 검증을 우회하지 않는다. 서버 시간 동기화를 확인한다. `TRUST_PROXY_HOPS`는 실제 신뢰 proxy 경로와 일치시켜 외부가 API에 직접 연결하거나 다른 짧은 경로로 X-Forwarded-For를 위조하지 못하게 한다. 정확한 인프라 신뢰 범위는 출시 인수다.

DB 적용은 백업/대상 확인 후 `migrations/add_phone_verification.sql`만 실행한다. 기존 phone/index/완료 시각을 보존하고 `phone_verified_at` nullable 및 내부 단조 증가 `phone_verification_generation`을 추가한다. generation은 User JSON 모델에 포함하지 않아 외부에 노출하지 않으며 오래된 challenge를 정리해도 초기화되지 않는다. 새4테이블·인덱스·CHECK·cascade를 추가하며 seed는 없다. `migrations/final_schema.sql`은 로컬 bootstrap/격리 테스트용이며 공용·운영 DB에 실행하지 않는다.

계정 삭제 시 FK cascade로 challenge/proof/영수증을 삭제한다. 이벤트 HMAC은 계정/UID/번호 컬럼 없이24시간 재사용 차단 tombstone으로 남긴다. 기존 account-deletion worker는 API 탈퇴 flag가 꺼져도 루프마다 만료 자료를 각1000건까지 정리한다. 해당 worker 실행·정리 처리량·지연을 확인해야 한다. 정리 장애는 TTL을 연장하거나 인증을 허용하지 않는다.

장애 시 가입/번호 변경은503으로 막고 기존 조회/미변경 편집을 보존한다. 인증 해제/SENS fallback/인증 없는 구앱 rollback은 사용하지 않는다. 인증 가능한 수정판으로 복구한다. `rollback_phone_verification.sql`은 소비 코드 중지·영향 검토 후 `shiftmate.phone_rollback_confirmed=true`를 명시하고 인증 데이터/영수증/이벤트/인증 시각이 전혀 없는 사전 인수 DB에서만 동작한다. 사용 이력이 있으면 forward recovery 오류로 철회를 거절한다. 기존 phone/index/완료 컬럼은 철회 대상이 아니다.

## 오류 계약

400: VALIDATION_ERROR, INVALID_PHONE, PHONE_VERIFICATION_PURPOSE_INVALID, PHONE_FIREBASE_TOKEN_INVALID, PHONE_VERIFICATION_REQUIRED, PHONE_VERIFICATION_INVALID, PROFILE_SETUP_REQUIRED.
410: PHONE_FIREBASE_AUTH_TOO_OLD, PHONE_CHALLENGE_EXPIRED, PHONE_VERIFICATION_EXPIRED.
409: PHONE_FIREBASE_AUTH_REUSED, PHONE_VERIFICATION_USED, PHONE_ALREADY_EXISTS, IDEMPOTENCY_KEY_REUSED, PROFILE_ALREADY_COMPLETED, ACCOUNT_DELETION_IN_PROGRESS.
429: PHONE_VERIFICATION_RATE_LIMITED(공통 DB 제한), AUTH_RATE_LIMIT_EXCEEDED(기존 IP 제한).
503: PHONE_VERIFICATION_UNAVAILABLE 또는 기존 PROFILE_IMAGE_STORAGE_UNAVAILABLE.
401 UNAUTHORIZED는 ShiftMate JWT/계정 미존재에 사용한다. DB 인증 조회 장애도401로 변환하지 않고503을 반환한다.

## 파일 역할·의존성·사용 예

| 파일 | 역할·의존성·사용 예 |
| --- | --- |
| src/config/phoneVerification.ts | env·키 ring·용도 분리 HMAC/안전 비교. Node fs/crypto·environment 의존. API initialize/getPhoneConfig 호출 |
| src/services/phoneVerificationError.ts | 안전한 상태/code·재시도 지연 타입. phoneUnavailable()은 원문 없이503 생성 |
| src/services/firebasePhoneTokenVerifier.ts | Firebase Admin named app/ADC/검증 adapter. FirebasePhoneTokenVerifier.verify(token) |
| src/services/phoneVerificationService.ts | challenge/교환/이벤트 claim/소비/영수증/DB 제한·만료 정리. Sequelize·User·신규 모델·verifier·키 ring 의존. createChallenge→verify, profile transaction에서 consumePhoneProof 호출 |
| src/models/PhoneVerification.ts | 세션/증명 Sequelize 모델·PhonePurpose. PostgreSQL migration과 동일 필드 |
| src/models/ProfileMutationReceipt.ts | composite PK 영수증 모델. 저장 transaction의 createProfileReceipt에서 사용 |
| src/controllers/phoneVerificationController.ts | JWT 사용자·key·공통 제한·service 호출·안전 HTTP 응답. 모델/SDK 직접 호출 없음 |
| src/middlewares/profileSetup.ts | auth 이후 가입 완료 gate. routes/index의 업무 router 앞에 mount |
| src/openapi/phoneVerificationOpenApi.json | 신규 JSON API/header/시간/오류 계약. openapi.ts에서 병합 |
| migrations/add_phone_verification.sql / rollback_phone_verification.sql | additive 정방향·보호형 철회 SQL. 위 적용/복구 절차 참조 |
| test/phoneVerification.test.cjs | fake Admin/실제 SDK RSA+외부 I/O 대체 단위 검증. node --test로 실행 |
| test/phoneVerificationIntegration.test.cjs | fake verifier + 실제 PostgreSQL/Express/S3 mock·경합·rollback·정리·키 회전. npm run test:phone-integration |
| test/phoneAuthEmulatorIntegration.test.cjs | 공식 Emulator + 실제 Admin/DB. npm run test:phone-emulator-integration |
| test/fixtures/phoneAuth.firebase.json | localhost 전용 Auth59099/hub59400/log59450·UI off. demo-shiftmate-phone으로 실행 |
| test/phoneVerificationFixture.cjs | 기존 프로필/이미지 suite에 실제 DB proof를 준비하는 테스트 전용 fake 외부 경계. issuePhoneProof(user_id,phone) |
| _docs/FIREBASE_PHONE_AUTH_SERVER_GUIDE.md | 구현 계약/실행·출시 인수 설명. PROJECT_CONTEXT/ADR/WORKLOG와 함께 사용 |

기존 User/model·profile service/mutation/controller/routes·auth 오류/CORS·worker·schema fixture를 갱신했다. 기존 Flutter 파일은 수정하지 않았다.

## 검증 재현과 출시 인수

전용 DB: PostgreSQL16, localhost55434, DB `shift_calendar_phone_test`, user `phone_test`, test password `phone_test_local_only`. `docker run --detach --name shiftmate-phone-auth-test --publish 127.0.0.1:55434:5432 --env POSTGRES_DB=shift_calendar_phone_test --env POSTGRES_USER=phone_test --env POSTGRES_PASSWORD=phone_test_local_only --tmpfs /var/lib/postgresql/data postgres:16`으로 일회용 환경을 만든다. 테스트는 고정 연결·명시적 reset flag 이외의 DB 초기화를 거절한다.

`npm run build`, `node --test test/phoneVerification.test.cjs`, `npm run test:phone-integration`을 실행한다. Emulator는 공식 firebase-tools15.37.0으로 `firebase emulators:start --only auth --project demo-shiftmate-phone --config test/fixtures/phoneAuth.firebase.json`을 별도 실행한 뒤 `npm run test:phone-emulator-integration`을 실행한다. repo 의존성에 firebase-tools를 추가하지 않았다. 실제 사용한 CLI는 임시 폴더 설치다. 테스트 환경 번호/코드도 운영 데이터와 혼동하지 않는다.

자동 검증 결과·전체 회귀의 기존 private 파일 누락 실패·실행 날짜는 WORKLOG에 기록한다. Emulator는 SMS를 보내지 않고 unsigned token을 사용하므로 실문자/운영 서명키·ADC/IAM·앱 확인 검증과 구분한다. RSA 단위 회귀는 실제 SDK 서명 검증을 실행하지만 인증서/Auth 조회 I/O는 대체한다.

출시 전 담당 인수(현재 미수행):

- Stage/운영 실제 project ID/ADC/IAM·환경별 격리와 checkRevoked 네트워크 확인. production에 테스트 번호·app verification 우회·emulator 없음 확인.
- Firebase Phone provider·결제/지역/플랫폼 등록·APNs/reCAPTCHA·Android 앱 확인/자동·수동 인증·실문자·쿼터/남용/사용량·예산 알림 확인. App Check 적용 범위는 실제 지원을 확인하고 비용 차단으로 단정하지 않는다.
- 프록시/APM body 수집 해제. 애플리케이션 로그는 안정된 code/request_id만 사용하고 번호·UID·토큰·credential을 기록하지 않는다. 외부 SDK 발송은 서버 challenge 제한으로 전체 비용을 통제할 수 없다.
- Google 번호 처리 고지/동의·수탁/국외 처리·보관/스토어 공개사항을 담당 검토 후 반영. 법적 근거/기간은 이 구현이 확정하지 않는다.
- Firebase phone-only 사용자는 앱 사용자와 동일 identity로 가정하지 않는다. 이번 서버는 UID를 저장하지 않으며 Firebase 계정을 삭제하지 않는다. 소유/다른 앱 사용자 영향·Google 보관 정책을 확인한 별도 정리 절차와 책임자/보관 기간을 출시 전에 확정한다. Firebase signOut은 사용자 삭제가 아니다.
- 서버/DB/secret 준비 → Stage 연동 → Firebase 대응 앱 실제 제공 → 기존 앱 호환 정책 갱신 → 강제 서버 배포 순서. 이 소스는 배포 시 인증을 강제하므로 준비 전 운영에 올리지 않는다. client 버전/flag로 인증을 면제하지 않는다.

공식 근거: [ID token 검증](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [DecodedIdToken](https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.decodedidtoken), [Auth Emulator](https://firebase.google.com/docs/emulator-suite/connect_auth). 이 구현의 실제 SDK 버전은 package-lock의 firebase-admin13.10.0이다.

# 앱 API 호환 버전과 강제 업데이트

## 목적과 버전 구분

2026-11-08 사용자 요청: 서버 배포로 구버전 앱과 호환되지 않을 때 앱 이용을 차단하고 업데이트로 안내한다. 판정 기준은 App Store 출시 여부가 아닌 별도 API 호환 번호다.

| 값 | 현재 값 | 변경 시점 |
|---|---|---|
| `AppConstants.api_compatibility_version` | `1` | 앱이 새로운 서버 호환 규격을 지원하도록 구현했을 때 코드와 함께 증가 |
| 사용자에게 표시하는 앱 버전 | `1.0.0` | 스토어 새 버전 출시 |
| iOS 빌드 번호 | `2` | 새 제출용 바이너리 생성 |
| 서버 최소 호환 번호 | 기본 `0` | 운영자가 해당 호환 번호 이상의 앱만 허용할 때 변경 |

`앱 호환 번호 < 서버 최소 호환 번호`이면 필수 업데이트다. 같은 값은 허용한다. 서버값 `0`은 차단 비활성이다. 빌드 번호만 올려도 API 호환 번호가 자동으로 증가하지 않는다.

## 흐름과 상태 수명

```text
CupertinoApp.builder → AppUpdateGate (Navigator 전체를 감쌈)
  → AppUpdateController.check()
  → AppUpdateRepository → 공개 Dio GET /app/version-policy?platform=IOS
  → AppUpdatePolicy 검증/비교
      ├─ 지원: 기존 로그인/캘린더/현재 route 표시
      └─ 미지원: 전체 업데이트 화면, 스토어 이동·다시 확인만 제공
```

- 앱 시작과 foreground 복귀 시 확인하며 동시에 발생한 확인은 같은 Future를 공유한다. 상시 서버 polling은 하지 않으므로 계속 foreground인 앱의 다음 검사는 복귀/재실행 시점이다.
- 최초 확인 중에는 기존 Navigator 자식 진입을 보류한다. 확인 후 이미 열린 상세·다이얼로그도 게이트 뒤로 숨기며 우회 가능한 닫기/나중에 버튼은 없다. 기존 route 상태는 유지한다.
- 정책/비교 결과는 앱 전체 domain state로 `StateNotifierProvider`에 유지하며 `autoDispose`는 사용하지 않는다. `ProviderScope` 종료 시 notifier가 dispose되고 뒤늦은 응답은 상태를 바꾸지 않는다. 화면의 스토어 열기 상태·실패 메시지는 위젯 UI state다.
- 정책 요청은 public endpoint로 인증·토큰 갱신을 하지 않는다. 5초 제한·timeout 취소·redirect 금지·no-cache 요청을 적용한다. Dio 오류는 기존 `ApiException` 매핑을 거친다.
- 정상 정책은 SharedPreferences에 API base URL+플랫폼별로 저장한다. 서버가 최소값을 낮추거나 `0`을 반환하면 저장된 차단도 해제한다.
- 조회/파싱 실패 시 이미 알고 있는 차단 정책은 유지한다. 캐시도 없는 최초 조회 실패(미배포 404 포함)는 앱을 허용한다. 따라서 이 게이트는 서버의 인증/인가나 구 API 차단을 대체하지 않으며 오프라인 최초 사용의 강제 차단을 보장하지 않는다. 캐시 저장 장애가 현재 수신한 차단 정책을 무효화하지는 않는다.
- 업데이트는 `url_launcher 6.3.2`의 externalApplication으로 연다. 6.3.3은 Dart 3.11을 요구해 현재 3.10.4와 호환되지 않으므로 6.3.2를 고정했다. 열기 실패는 차단 화면 안에서 재시도를 안내한다.

## 서버 계약

`GET /api/v1/app/version-policy?platform=IOS` (`IOS` 또는 `ANDROID`, 인증 없음).

```json
{
  "success": true,
  "data": {
    "schema_version": 1,
    "platform": "IOS",
    "minimum_compatibility_version": 1,
    "update_url": "https://apps.apple.com/kr/app/id6831957246",
    "message": "안정적인 서비스 이용을 위해 최신 앱으로 업데이트해 주세요."
  }
}
```

- `schema_version=1`, 일치하는 플랫폼, 0~2147483647 정수와 최대 300자 메시지를 검증한다. 최소값이 양수면 스토어 주소가 필수다.
- 스토어 주소는 HTTPS, credential/fragment/비표준 port 금지. iOS는 `apps.apple.com`의 확인된 ID `6831957246`, Android는 `play.google.com/store/apps/details?id=com.hspark.shiftmate`만 허용한다. App ID를 바꿀 때는 양쪽 검증 코드도 함께 변경한다.
- 잘못된 query는 400 `VALIDATION_ERROR`, 잘못된 운영 설정은 안전한 503 `APP_VERSION_POLICY_UNAVAILABLE`이다. 서버는 no-store 응답·request ID·설정 이름만 담은 구조화 오류 로그를 사용하며 DB를 읽거나 쓰지 않는다.
- 서버 구현은 기존 main 작업 보존을 위해 `develop` 기반 `codex/app-compatibility-policy` 분리 작업 트리에 준비했다. 실제 배포/운영 env 변경/DB 변경은 수행하지 않았다.

## 서버 환경변수

아래 이름의 `IOS`를 `ANDROID`로 바꾸어 별도로 설정한다. 로컬·Stage·운영은 각 프로세스의 env를 사용하며 서로 정책을 공유하지 않는다.

| 환경변수 | 필수/기본값 | 예시·역할 |
|---|---|---|
| `APP_UPDATE_IOS_MIN_COMPATIBILITY_VERSION` | 선택, `0` | `1`: 현재 호환 번호 1 이상 허용, `2`: 번호 1 차단 |
| `APP_UPDATE_IOS_URL` | 선택, 확인된 App Store URL | `https://apps.apple.com/kr/app/id6831957246` |
| `APP_UPDATE_IOS_MESSAGE` | 선택, 공용 한국어 문구 | 최대 300자 업데이트 안내 |
| `APP_UPDATE_ANDROID_MIN_COMPATIBILITY_VERSION` | 선택, `0` | Android 별도 최소값 |
| `APP_UPDATE_ANDROID_URL` | 최소값 양수일 때 필수 | 해당 package의 Google Play HTTPS URL |
| `APP_UPDATE_ANDROID_MESSAGE` | 선택, 공용 한국어 문구 | Android 별도 안내 |

서버 API 시작 시 설정을 검증하며 잘못된 설정으로 시작하지 않는다. env 변경 후에는 새 env를 읽도록 API 프로세스/컨테이너를 재생성하고 공개 API 응답을 확인한다. 사용자 DB migration은 필요 없다.

## 적용 순서·영향·롤백

1. 신규 서버 API를 최소값 `0`으로 배포하고 Stage/운영 공개 GET 200을 확인한다.
2. 게이트가 포함된 이번 앱(스토어 1.0.0, 빌드 2, 호환 번호 1)을 테스트하고 배포한다. 기존 빌드 1처럼 이 기능이 없는 앱에는 사후 차단을 소급 적용할 수 없다.
3. 추후 호환되지 않는 서버 변경이 필요하면 해당 규격을 지원하는 앱의 내부 번호를 예컨대 `2`로 올리고 새 스토어 버전을 먼저 출시한다.
4. 대한민국 스토어에서 사용자가 실제 새 앱을 받을 수 있음을 확인한 뒤 서버 최소값을 `2`로 올린다. `1` 차단·`2` 허용·업데이트 이동·스토어 복귀를 확인한다. 새 앱이 제공되기 전에 최소값을 올리지 않는다.
5. 긴급 완화는 최소값을 이전 허용값 또는 `0`으로 낮추고 API 프로세스를 재생성한다. 앱의 ‘다시 확인’/복귀에서 200 정책을 받으면 차단이 풀린다.

**Behavior change**: 앱 최초 진입에 최대 5초 정책 확인이 추가되고 미지원 호환 번호는 현재 route 전체에서 이용이 차단된다. 로그아웃·DB 삭제는 하지 않는다. 서버 롤백 시에는 먼저 `0` 응답으로 차단을 해제하고 API를 유지한다. 차단 캐시가 있는 상태에서 endpoint부터 제거하면 404에도 차단이 유지된다. 앱 코드 롤백은 builder의 게이트 연결·신규 feature·public API 항목·상수·의존성을 되돌리고 기존 코드 변경은 보존한다.

## 신규 파일 역할·의존성·사용 예

| 파일 | 역할 / 의존성 / 사용 예 |
|---|---|
| `lib/features/app_update/domain/app_update_policy.dart` | Dart 순수 DTO/도메인·URL/스키마 검증·정수 비교. 예: `requiresUpdate(AppConstants.api_compatibility_version)`. |
| `lib/features/app_update/data/app_update_repository.dart` | Dio·SharedPreferences 의존 조회/환경별 캐시. 예: `fetchPolicy()`, `readCachedPolicy()`. |
| `lib/features/app_update/application/app_update_controller.dart` | Riverpod 상태·중복 합치기·캐시/실패 정책. 예: 시작/복귀 `check()`. |
| `lib/features/app_update/presentation/app_update_gate.dart` | Cupertino·AppTheme·url_launcher 의존 전체 화면 게이트. 예: `CupertinoApp.builder`에서 Navigator 감싸기. |
| `test/features/app_update/app_update_test.dart` | 가짜 HTTP/저장소/launcher로 정수 비교·계약·실패·회귀·중첩 화면 차단 검증. 예: `flutter test --dart-define=KAKAO_NATIVE_APP_KEY_STAGE=test-key test/features/app_update`. |
| `_docs/APP_VERSION_POLICY.md` | FE/BE 계약·설정·배포 및 롤백 기준. 예: 최소 호환 번호 인상 전 순서 점검. |

서버의 신규 service/controller/route/OpenAPI/test 파일 역할은 같은 서버 문서 정본에 기록한다. 실제 기기 Store 이동·정책 endpoint 배포와 최종 IPA 검증 결과는 WORKLOG와 출시 체크리스트에 기록한다.


## 서버 신규 파일 역할·의존성·사용 예

| 파일 | 역할 / 의존성 / 사용 예 |
|---|---|
| `src/services/appVersionPolicyService.ts` | env·플랫폼/URL 검증·DTO. DB 의존 없음. 예: `getAppVersionPolicy("IOS")`, API 시작 시 `validateAppVersionPolicyEnvironment()`. |
| `src/controllers/appVersionPolicyController.ts` | Express 응답·구조화 오류·request ID. 예: 공개 GET handler. |
| `src/routes/appVersionPolicyRoutes.ts` | express-validator query 검증과 Controller 연결. 예: v1 router에 mount. |
| `src/openapi/appVersionPolicyOpenApi.json` | 공개 요청·응답·400/503 명세. 예: openapi.ts가 기존 Swagger에 합침. |
| `test/appVersionPolicy.test.cjs` | Node test와 실제 로컬 Express HTTP로 공개 접근·query·설정/URL 경계·오류 비노출 검사. 예: 빌드 후 `node --test test/appVersionPolicy.test.cjs`. |

서버 요청은 Router → query validateRequestMiddleware → Controller → env Service 순서다. query 오류는 400 VALIDATION_ERROR, 서비스 설정 오류는 503 APP_VERSION_POLICY_UNAVAILABLE이며 기존 logError가 변수 이름·코드·request ID만 기록한다. API 시작 시 설정을 검증한다. strict TypeScript build와 신규 5개+기존 선택 회귀를 합친 23개 테스트 통과. 전체 npm test 및 실제 운영 배포·스토어 E2E는 수행하지 않았다.

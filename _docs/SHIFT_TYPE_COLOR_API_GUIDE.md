# 근무 타입 색상 메타데이터 API 가이드

## 1. 목적

이 문서는 Flutter 프론트팀이 근무 타입의 최종 색상뿐 아니라 기준 색상과 농도를 저장하고 복원하기 위한 API 계약을 설명합니다.

대상 API:

- `GET /api/v1/shift-types`
- `POST /api/v1/shift-types`
- `PUT /api/v1/shift-types/:shift_type_id`

캘린더와 근무표 API의 `shift_type_color` 계약은 변경되지 않습니다. `GET /calendar/range`, `GET /work-shifts`, 친구 캘린더는 계속 최종 렌더링 색상만 `#AARRGGBB`로 반환합니다.

## 2. 연동 전제

### 공통 요청 정보

- Base URL: `/api/v1`
- 인증: `Authorization: Bearer {access_token}`
- Content-Type: `application/json`
- 요청/응답 필드명: `snake_case`

### 백엔드 배포 선행 조건

신규 서버는 Sequelize 조회 시 `shift_types.base_color`, `shift_types.color_intensity`를 참조합니다. 백엔드에서 컬럼 확장 migration을 적용하기 전에 신규 서버를 실행하면 다음 API가 PostgreSQL `42703` 오류로 500을 반환할 수 있습니다.

- `GET /shift-types`
- `GET /calendar/range`
- `GET /work-shifts`
- `ShiftType`을 include하는 기타 근무표 조회

프론트 배포 전 백엔드팀이 최소한 `migrations/add_shift_type_color_metadata.sql` 적용과 API 정상 응답을 완료해야 합니다.

## 3. 색상 필드 계약

| 필드 | JSON 타입 | null | 형식 | 의미 |
| --- | --- | --- | --- | --- |
| `color` | string | 허용 | `#AARRGGBB` | 농도가 적용된 최종 렌더링 색상 |
| `base_color` | string | 허용 | 신규 요청은 `#FFRRGGBB` | 농도 적용 전 기준 색상 |
| `color_intensity` | integer | 불허 | `0..100` | 기준 색상 농도 퍼센트 |

핵심 규칙:

- 신규 프론트는 `base_color`와 `color_intensity`를 항상 함께 전송합니다.
- `base_color`는 불투명 알파 `FF`를 사용합니다.
- `color_intensity`는 문자열이나 실수가 아닌 JSON 정수로 전송합니다.
- 서버는 색상 문자열을 대문자 `#AARRGGBB`로 정규화해 응답합니다.
- 신규 요청에서는 `color`를 생략하는 방식을 권장합니다. 서버가 최종 색상을 계산하므로 클라이언트와 서버의 반올림 차이를 피할 수 있습니다.

## 4. 최종 색상 계산 규칙

서버는 테마 색상이 아니라 고정된 불투명 흰색 `#FFFFFFFF`를 혼합 기준으로 사용합니다.

각 RGB 채널 계산:

```text
result_channel =
  round(255 + (base_channel - 255) * color_intensity / 100)
```

알파 채널은 항상 `FF`입니다.

예시:

```text
base_color      = #FF4355B8
color_intensity = 50
color           = #FFA1AADC
```

농도 경계값:

| 농도 | 결과 |
| --- | --- |
| `0` | `#FFFFFFFF` |
| `100` | `base_color`와 동일 |
| `1..99` | 흰색과 기준 색상의 혼합값 |

Flutter 미리보기도 같은 고정 흰색과 정수 퍼센트 규칙을 사용해야 합니다. `AppTheme.surface_color`에 계산을 의존하면 추후 테마 변경 시 서버 결과와 달라질 수 있습니다.

## 5. 근무 타입 목록 조회

### Request

```http
GET /api/v1/shift-types
Authorization: Bearer {access_token}
```

### Response

```json
{
  "success": true,
  "data": {
    "template_id": "88d66f36-b4b7-4a03-9e9a-3e7739f7da48",
    "template_name": "기본 3교대",
    "shift_types": [
      {
        "shift_type_id": "da41ca11-54e0-4ec2-9280-934876339075",
        "code": "N",
        "name": "나이트",
        "color": "#FFA1AADC",
        "base_color": "#FF4355B8",
        "color_intensity": 50,
        "sort_order": 3,
        "start_time": "22:30:00",
        "end_time": "07:00:00",
        "crosses_midnight": true,
        "duration_minutes": 510
      }
    ]
  }
}
```

### 레거시 행 fallback

기존 DB 행에 `base_color`가 없으면 서버는 다음 값으로 응답합니다.

```text
base_color      = color
color_intensity = 100
```

`color`도 `null`이면 다음과 같습니다.

```json
{
  "color": null,
  "base_color": null,
  "color_intensity": 100
}
```

프론트도 방어적으로 같은 fallback을 적용하는 것을 권장합니다.

## 6. 근무 타입 생성

### 권장 Request

최종 `color`는 보내지 않고 기준 색상과 농도만 전송합니다.

```http
POST /api/v1/shift-types
Authorization: Bearer {access_token}
Content-Type: application/json
```

```json
{
  "code": "N",
  "name": "나이트",
  "base_color": "#FF4355B8",
  "color_intensity": 50,
  "start_time": "22:30:00",
  "end_time": "07:00:00",
  "sort_order": 3
}
```

필드:

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `code` | string | Y | 근무 타입 코드 |
| `name` | string | Y | 근무 타입 이름 |
| `base_color` | string | 색상 사용 시 Y | `#FFRRGGBB` |
| `color_intensity` | integer | 색상 사용 시 Y | `0..100` |
| `color` | string | N | 보내는 경우 서버 계산값과 정확히 일치해야 함 |
| `start_time` | string/null | N | `HH:mm:ss` |
| `end_time` | string/null | N | `HH:mm:ss` |
| `sort_order` | integer | N | 0 이상의 정수 |

### Response

성공 상태는 `201 Created`입니다.

```json
{
  "success": true,
  "data": {
    "shift_type_id": "da41ca11-54e0-4ec2-9280-934876339075",
    "code": "N",
    "name": "나이트",
    "color": "#FFA1AADC",
    "base_color": "#FF4355B8",
    "color_intensity": 50,
    "sort_order": 3,
    "start_time": "22:30:00",
    "end_time": "07:00:00",
    "crosses_midnight": true,
    "duration_minutes": 510,
    "created_at": "2026-07-20T00:00:00.000Z"
  }
}
```

### 색상을 사용하지 않는 생성

색상 관련 필드를 모두 생략할 수 있습니다.

```json
{
  "code": "VAC",
  "name": "휴가"
}
```

응답 색상 메타데이터:

```json
{
  "color": null,
  "base_color": null,
  "color_intensity": 100
}
```

## 7. 근무 타입 수정

### Request

```http
PUT /api/v1/shift-types/:shift_type_id
Authorization: Bearer {access_token}
Content-Type: application/json
```

기준 색상과 농도 수정:

```json
{
  "base_color": "#FF4355B8",
  "color_intensity": 75
}
```

성공 상태는 `200 OK`이며 응답 객체 형식은 생성 응답과 같습니다. 생성 응답의 `created_at` 대신 `updated_at`이 포함됩니다.

### 부분 수정 규칙

| 전달한 색상 필드 | 서버 처리 |
| --- | --- |
| 색상 필드 없음 | 기존 `color`, `base_color`, `color_intensity` 모두 유지 |
| `base_color` + `color_intensity` | 서버가 최종 `color`를 재계산하고 세 값을 함께 저장 |
| 위 두 값 + `color` | `color`가 계산값과 일치할 때만 저장 |
| `color`만 전달 | 구버전 요청으로 처리하고 `base_color=color`, 농도 `100` 저장 |
| `color: null`만 전달 | `color`, `base_color`를 `null`, 농도를 `100`으로 저장 |
| 신규 필드 중 하나만 전달 | `400 INVALID_COLOR_METADATA` |

이름만 수정하면서 색상을 유지하려면 색상 필드를 보내지 않습니다.

```json
{
  "name": "야간"
}
```

색상을 제거하려면 JSON에 `color: null`을 명시해야 합니다. Dart의 nullable 필드를 단순히 `if (color != null)`로 직렬화하면 명시적 `null`과 미전달을 구분할 수 없으므로 별도의 삭제 플래그나 명시적 필드 포함 방식을 사용해야 합니다.

## 8. 오류 응답

공통 형식:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_COLOR_METADATA",
    "message": "base_color와 color_intensity는 함께 전달해야 합니다."
  }
}
```

색상 관련 오류:

| HTTP | 코드 | 발생 조건 |
| --- | --- | --- |
| 400 | `INVALID_COLOR_FORMAT` | `color`이 `#AARRGGBB` 형식이 아님 |
| 400 | `INVALID_BASE_COLOR_FORMAT` | `base_color`이 불투명 `#FFRRGGBB` 형식이 아님 |
| 400 | `INVALID_COLOR_INTENSITY` | 농도가 JSON 정수가 아니거나 `0..100` 범위 밖 |
| 400 | `INVALID_COLOR_METADATA` | `base_color`, `color_intensity` 중 하나만 전달 |
| 400 | `COLOR_METADATA_MISMATCH` | 함께 전달한 `color`가 서버 계산 결과와 다름 |

기타 관련 오류:

| HTTP | 코드 | 설명 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | code/name/time/sort_order 등의 요청 검증 실패 |
| 400 | `MAX_SHIFT_TYPES_EXCEEDED` | 활성 템플릿의 근무 타입이 이미 10개 |
| 403 | `FORBIDDEN` | 다른 사용자의 근무 타입 수정 시도 |
| 404 | `SHIFT_TYPE_NOT_FOUND` | 수정 대상 근무 타입 없음 |
| 404 | `TEMPLATE_NOT_FOUND` | 활성 템플릿 없음 |
| 500 | `INTERNAL_SERVER_ERROR` | 서버 또는 DB 오류 |

## 9. Flutter 적용 가이드

현재 Flutter 코드의 `ShiftTypeApiModel`, `CreateShiftTypeRequest`, `UpdateShiftTypeRequest`는 최종 `color`만 처리하므로 아래 변경이 필요합니다.

현재 코드 기준 주요 영향 파일:

- `lib/features/calendar/data/models/shift_type_api_model.dart`
- `lib/features/calendar/data/services/shift_type_service.dart`
- `lib/features/calendar/presentation/widgets/shift_color_picker_page.dart`
- `lib/features/calendar/presentation/widgets/shift_type_form_modal.dart`
- 관련 provider 및 widget/model 테스트

### 9.1 API 모델

권장 필드:

```dart
final int? color;
final int? baseColor;
final int colorIntensity;
```

응답 파싱:

```dart
final color = parseApiColorValue(json['color']);
final parsedBaseColor = parseApiColorValue(json['base_color']);

return ShiftTypeApiModel(
  // 기존 필드 생략
  color: color,
  baseColor: parsedBaseColor ?? color,
  colorIntensity: json['color_intensity'] as int? ?? 100,
);
```

`base_color`가 없거나 `null`인 레거시 응답은 `color`, 농도 `100`으로 복원합니다.

### 9.2 생성·수정 요청 모델

권장 필드:

```dart
final int? baseColor;
final int? colorIntensity;
```

직렬화:

```dart
if (baseColor != null && colorIntensity != null) {
  json['base_color'] = formatApiColorValue(baseColor!);
  json['color_intensity'] = colorIntensity;
}
```

두 필드 중 하나만 있는 상태는 API 호출 전에 프론트에서 차단합니다.

신규 요청에서는 최종 `color`를 생략하는 것을 권장합니다. 화면 미리보기와 서버 응답을 비교하려면 저장 성공 후 응답의 `data.color`를 최종 기준값으로 사용합니다.

### 9.3 색상 선택 결과 객체

현재 색상 선택 화면이 최종 `Color` 하나만 반환한다면 다음 세 값을 가진 결과 객체로 변경합니다.

```dart
class ShiftColorSelection {
  final int finalColor;
  final int baseColor;
  final int colorIntensity;

  const ShiftColorSelection({
    required this.finalColor,
    required this.baseColor,
    required this.colorIntensity,
  });
}
```

편집 화면 진입 초기값:

```dart
final initialBaseColor = shiftType.baseColor ?? shiftType.color;
final initialIntensity = shiftType.colorIntensity;
```

### 9.4 슬라이더 값

- API 단위는 `0..100` 정수입니다.
- UI 내부에서 `0.0..1.0`을 쓰더라도 저장 전 `(value * 100).round()`로 1% 단위 양자화합니다.
- API 응답 복원 시 `colorIntensity / 100.0`을 사용합니다.
- 프리셋 또는 커스텀 기준 색상을 새로 선택하면 농도를 `100`으로 초기화하는 현재 UX를 유지할 수 있습니다.

### 9.5 미리보기 계산

서버와 같은 채널 계산을 사용합니다.

```dart
int mixChannel(int channel, int intensity) {
  return (255 + (channel - 255) * intensity / 100).round();
}

Color calculateShiftColor(Color baseColor, int intensity) {
  final argb = baseColor.toARGB32();
  final red = (argb >> 16) & 0xFF;
  final green = (argb >> 8) & 0xFF;
  final blue = argb & 0xFF;

  return Color.fromARGB(
    255,
    mixChannel(red, intensity),
    mixChannel(green, intensity),
    mixChannel(blue, intensity),
  );
}
```

이 계산은 테마 색상을 읽지 않고 고정 흰색 채널값 `255`를 사용합니다.

## 10. 기존 앱 호환성

구버전 앱:

- 신규 응답 필드를 무시해도 기존 `color` 표시가 유지됩니다.
- `color`만 보내면 서버가 100% 메타데이터로 저장합니다.
- 기준 색상과 농도 복원은 지원하지 않습니다.

신규 앱:

- 신규 서버와 expand migration이 모두 적용된 환경에서 배포해야 합니다.
- `base_color`, `color_intensity`를 함께 보내야 합니다.
- 최종 렌더링에는 서버 응답의 `color`를 사용합니다.
- 편집 화면 복원에는 `base_color`, `color_intensity`를 사용합니다.

## 11. 프론트 검증 체크리스트

- [ ] `GET /shift-types`에서 신규 두 필드 파싱
- [ ] 레거시 응답의 `base_color ?? color`, `color_intensity ?? 100` fallback
- [ ] 생성 요청에 `base_color`, `color_intensity` 동시 포함
- [ ] 수정 요청에서 색상 무변경 시 세 색상 필드 모두 생략
- [ ] `color: null` 명시 전송과 필드 미전달 구분
- [ ] 농도 0%, 50%, 100% 왕복 저장
- [ ] 저장 후 응답의 최종 `color`로 화면 상태 갱신
- [ ] 기준 색상과 농도로 편집 화면 재진입 상태 복원
- [ ] 프리셋·커스텀 색상 변경 시 농도 초기화 정책 확인
- [ ] `INVALID_*`, `COLOR_METADATA_MISMATCH` 사용자 메시지 처리
- [ ] `GET /calendar/range`의 기존 `shift_type_color` 회귀 없음

## 12. 배포 확인

프론트 릴리스 전에 백엔드팀으로부터 다음 항목을 확인합니다.

- `shift_types.base_color`, `shift_types.color_intensity` 컬럼 존재
- `GET /api/v1/shift-types` 200 응답
- 신규 POST/PUT 요청 성공
- `GET /calendar/range`와 `GET /work-shifts` 200 응답
- 레거시 근무 타입이 `base_color=color`, `color_intensity=100`으로 조회됨

현재 서버 저장소에는 Swagger/OpenAPI가 구현되어 있지 않으므로 이 Markdown 문서를 색상 메타데이터 연동 계약의 기준으로 사용합니다.

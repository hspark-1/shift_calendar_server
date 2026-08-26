# 개인 일정 삭제 API — Flutter 연동 가이드

## 1. 한눈에 보기

개인 일정 상세 또는 편집 화면에서 아래 API를 호출하면 됩니다.

```http
DELETE /api/v1/events/{event_id}
Authorization: Bearer <access_token>
```

- 본인 소유 일정만 삭제할 수 있습니다.
- 삭제는 soft delete이며 성공 직후 본인·친구·그룹 캘린더 조회에서 제외됩니다.
- request body는 없습니다.
- 일정은 서버 Redis 캐시 대상이 아니므로 별도 cache-busting parameter가 필요 없습니다.

## 2. 요청과 응답

### 성공: 200

```json
{
  "success": true,
  "data": {
    "event_id": "2f0d8f41-4589-4f70-8d1f-fbf3fc274f98"
  },
  "message": "일정이 삭제되었습니다."
}
```

성공 시 `data.event_id`를 기준으로 현재 화면의 일정 목록과 선택 상태에서 해당 항목을 제거합니다.

### 실패

| HTTP | `error.code` | 의미 | 권장 UX |
|---|---|---|---|
| 400 | `INVALID_EVENT_ID` | 잘못된 UUID | 일반 오류 표시 후 목록 재조회 |
| 401 | `UNAUTHORIZED` | 인증 없음·만료·무효 | 기존 refresh/login 흐름 사용 |
| 404 | `EVENT_NOT_FOUND` | 없음·타인 소유·이미 삭제 | 로컬 항목 제거 후 “이미 삭제된 일정입니다” 안내 |
| 500 | `INTERNAL_SERVER_ERROR` | 서버 오류 | 로컬 항목 유지, 재시도 안내 |

`404`는 타인 일정 존재 여부를 숨기기 위해 원인을 구분하지 않습니다. 앱도 사용자에게 소유권 여부를 추측하는 문구를 표시하지 않아야 합니다.

## 3. Dio 연동 예시

프로젝트의 기존 Dio client와 Access Token interceptor를 그대로 사용합니다.

```dart
class DeleteEventResult {
  const DeleteEventResult({required this.event_id});

  final String event_id;

  factory DeleteEventResult.fromJson(Map<String, dynamic> json) {
    return DeleteEventResult(event_id: json['event_id'] as String);
  }
}

Future<DeleteEventResult> deleteEvent(String event_id) async {
  final response = await dio.delete<Map<String, dynamic>>(
    '/api/v1/events/$event_id',
  );
  final response_data = response.data!;
  return DeleteEventResult.fromJson(
    response_data['data'] as Map<String, dynamic>,
  );
}
```

기존 공통 `AppError` mapping에 다음 코드를 추가합니다.

```dart
AppError mapEventDeleteError(DioException error) {
  final response_data = error.response?.data as Map<String, dynamic>?;
  final error_data = response_data?['error'] as Map<String, dynamic>?;
  final error_code = error_data?['code'] as String?;

  switch (error_code) {
    case 'INVALID_EVENT_ID':
      return const AppError.validation('일정 정보가 올바르지 않습니다.');
    case 'EVENT_NOT_FOUND':
      return const AppError.notFound('이미 삭제되었거나 찾을 수 없는 일정입니다.');
    case 'UNAUTHORIZED':
      return const AppError.unauthorized();
    default:
      return const AppError.server('일정을 삭제하지 못했습니다.');
  }
}
```

## 4. 상태관리 권장 흐름

```text
삭제 버튼
  → 확인 다이얼로그
  → 중복 탭 방지 loading 상태
  → DELETE 요청
     ├─ 200: 로컬 목록/선택 상태에서 event_id 제거 → 성공 안내 → 화면 닫기
     ├─ 404 EVENT_NOT_FOUND: 로컬 항목 제거 → 이미 삭제 안내 → 화면 닫기
     ├─ 401: 기존 인증 복구 흐름
     └─ 기타: 로컬 항목 유지 → 오류 안내 → 재시도 허용
```

- 요청 중에는 삭제 버튼을 비활성화합니다.
- `200` 또는 `404 EVENT_NOT_FOUND`에서는 서버의 최종 활성 상태가 “해당 일정 없음”이므로 로컬 항목을 제거합니다.
- `500`이나 네트워크 오류에서는 낙관적 삭제를 확정하지 말고 기존 항목을 유지합니다.
- 목록을 다시 조회할 경우 기존 `GET /events`, `GET /calendar/day`, `GET /calendar/range` 중 화면 범위에 맞는 API를 사용합니다.

## 5. Riverpod 예시

프로젝트의 실제 Notifier와 Repository 이름에 맞게 적용합니다.

```dart
Future<void> deleteEvent(String event_id) async {
  if (state.deleting_event_ids.contains(event_id)) return;

  state = state.copyWith(
    deleting_event_ids: {...state.deleting_event_ids, event_id},
  );

  try {
    await event_repository.deleteEvent(event_id);
    state = state.copyWith(
      events: state.events
          .where((event) => event.event_id != event_id)
          .toList(),
    );
  } on AppError catch (error) {
    if (error.code == 'EVENT_NOT_FOUND') {
      state = state.copyWith(
        events: state.events
            .where((event) => event.event_id != event_id)
            .toList(),
      );
      return;
    }
    rethrow;
  } finally {
    state = state.copyWith(
      deleting_event_ids: state.deleting_event_ids
          .where((id) => id != event_id)
          .toSet(),
    );
  }
}
```

## 6. 화면별 적용

### 일정 상세/편집 화면

- 본인 일정에만 삭제 버튼 노출
- 삭제 전 일정 제목을 포함한 확인 다이얼로그 표시 가능
- 성공 또는 `EVENT_NOT_FOUND` 후 이전 화면으로 이동

### 개인 캘린더

- 반환된 `event_id`로 월/주/일 화면의 같은 일정을 제거
- 선택된 일정이면 detail sheet·selection 상태도 함께 해제

### 친구·그룹 캘린더

- 타인의 일정에는 삭제 동작을 제공하지 않음
- 내 일정이 그룹 aggregate에 표시된 상태에서 삭제했다면 다음 조회부터 자동 제외됨

## 7. QA 체크리스트

- [ ] 본인 일정 삭제 시 `200`이고 즉시 화면에서 사라짐
- [ ] 삭제 후 개인 기간/일 캘린더 재조회에서 반환되지 않음
- [ ] 친구가 조회하던 공개 일정도 다음 조회부터 반환되지 않음
- [ ] 그룹 캘린더의 내 일정도 다음 조회부터 반환되지 않음
- [ ] 같은 삭제를 다시 요청하면 `404 EVENT_NOT_FOUND`로 처리되고 UI가 복구됨
- [ ] 타인 `event_id` 삭제 요청은 `404`이며 타인 일정은 유지됨
- [ ] 잘못된 UUID는 `400 INVALID_EVENT_ID`
- [ ] 요청 중 삭제 버튼 중복 탭이 차단됨
- [ ] 네트워크/500 오류 시 로컬 일정이 유지되고 재시도 가능
- [ ] 401은 기존 Access Token refresh 또는 로그인 흐름으로 연결됨

## 8. 서버 배포 의존성

- DB migration 없음
- 신규 환경변수 없음
- 서버의 `EVENT_NOT_FOUND` 오류 코드 배포와 Flutter mapping을 같은 릴리스 범위에서 확인
- Swagger가 활성화된 환경에서는 `/api-docs`의 `Calendar / DELETE /events/{event_id}`에서 계약 확인 가능

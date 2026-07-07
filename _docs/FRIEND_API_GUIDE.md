# 친구 관리 API 가이드

## 개요

이 문서는 친구 관리 기능의 백엔드 API 사용 가이드입니다.

### 기본 정보

- **Base URL**: `/api/v1`
- **인증**: Bearer Token (JWT)
- **Content-Type**: `application/json`

### 응답 형식

```typescript
// 성공 응답
{
  "success": true,
  "data": { ... },
  "message": "성공 메시지"
}

// 실패 응답
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "사용자 친화적 에러 메시지"
  }
}
```

---

## 친구 관련 API

### 1. 친구 목록 조회

내 친구 목록을 조회합니다.

#### Request

```
GET /api/v1/friends
```

**Headers**

```
Authorization: Bearer {access_token}
```

**Query Parameters**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `page` | number | N | 페이지 번호 (기본값: 1) |
| `limit` | number | N | 페이지당 항목 수 (기본값: 20, 최대: 100) |

#### Response

```json
{
  "success": true,
  "data": {
    "friends": [
      {
        "user_id": "uuid",
        "name": "홍길동",
        "email": "hong@email.com",
        "phone": "010-1234-5678",
        "profile_image_url": "https://...",
        "friend_level": 2,
        "can_view": true,
        "created_at": "2026-01-04T12:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "total_pages": 1
    }
  }
}
```

---

### 2. 친구 캘린더 기간 조회

친구 목록에서 선택한 친구의 읽기 전용 캘린더 데이터를 기간 기준으로 조회합니다. 서버는 캘린더 소유자인 친구가 현재 사용자에게 설정한 `can_view`와 `friend_level` 기준으로 근무표와 개인 일정을 필터링하며, 프론트는 추가 필터링을 하지 않습니다.

#### Request

```
GET /api/v1/friends/:friend_user_id/calendar/range
```

**Headers**

```
Authorization: Bearer {access_token}
```

**Path Parameters**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `friend_user_id` | uuid | Y | 조회할 친구 사용자 ID |

**Query Parameters**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `start_date` | string | Y | 조회 시작일, `YYYY-MM-DD` |
| `end_date` | string | Y | 조회 종료일, `YYYY-MM-DD` |

#### Response

```json
{
  "success": true,
  "data": {
    "work_shifts": [
      {
        "work_shift_id": "uuid",
        "work_date": "2026-07-05",
        "shift_type_code": "D",
        "shift_type_name": "데이",
        "shift_type_color": "#FF34C759",
        "start_time": "07:00:00",
        "end_time": "15:00:00",
        "note": null,
        "created_at": "2026-07-01T00:00:00.000Z",
        "updated_at": "2026-07-01T00:00:00.000Z"
      }
    ],
    "events": [
      {
        "event_id": "uuid",
        "title": "약속",
        "memo": null,
        "place": "서울",
        "all_day": false,
        "start_at": "2026-07-05T10:00:00.000Z",
        "end_at": "2026-07-05T11:00:00.000Z",
        "visibility_level": 1
      }
    ]
  }
}
```

#### 공개 레벨 규칙

- 조회자: 현재 인증 사용자(`viewer_user_id`)
- 캘린더 소유자: `friend_user_id`
- 접근 설정: `friend_level_settings.owner_user_id = :friend_user_id` AND `friend_level_settings.friend_user_id = :viewer_user_id`
- 근무표 노출: `can_view = true`인 친구 관계이면 조회 가능 (`work_shifts.visibility_level = 0`)
- 개인 일정 노출: `can_view = true` AND `friend_level_settings.friend_level >= events.visibility_level`
- 근무표 응답 필드는 개인 캘린더와 동일하며, `shift_type_color`는 `#AARRGGBB`, `start_time`/`end_time`은 `HH:mm:ss`로 반환

#### Error Codes

| 코드 | 메시지 | 설명 |
|------|--------|------|
| `FRIEND_NOT_FOUND` | 친구 관계를 찾을 수 없습니다. | 친구가 아니거나 존재하지 않는 사용자 |
| `CALENDAR_ACCESS_DENIED` | 친구 캘린더를 볼 수 없습니다. | 친구가 현재 사용자에게 `can_view=false`로 설정 |
| `INVALID_DATE_RANGE` | 조회 기간이 올바르지 않습니다. | 날짜 형식 오류 또는 시작일이 종료일보다 늦음 |

---

### 3. 친구 레벨 설정 변경

특정 친구의 레벨 설정을 변경합니다.

#### Request

```
PUT /api/v1/friends/:friend_user_id/settings
```

**Headers**

```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Path Parameters**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `friend_user_id` | uuid | Y | 친구 사용자 ID |

**Body**

```json
{
  "friend_level": 3,
  "can_view": true
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `friend_level` | number | N | 친구 레벨 (0~5) |
| `can_view` | boolean | N | 내 캘린더 공유 여부 |

#### Response

```json
{
  "success": true,
  "data": {
    "owner_user_id": "uuid",
    "friend_user_id": "uuid",
    "friend_level": 3,
    "can_view": true,
    "updated_at": "2026-01-04T12:30:00.000Z"
  },
  "message": "친구 설정을 변경했습니다."
}
```

#### Error Codes

| 코드 | 메시지 | 설명 |
|------|--------|------|
| `NOT_FRIENDS` | 친구 관계가 아닙니다. | 친구 관계 없음 |
| `INVALID_LEVEL` | 친구 레벨은 0~5 사이여야 합니다. | 레벨 범위 초과 |

---

### 4. 친구 삭제

친구 관계를 삭제합니다.

#### Request

```
DELETE /api/v1/friends/:friend_user_id
```

**Headers**

```
Authorization: Bearer {access_token}
```

**Path Parameters**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `friend_user_id` | uuid | Y | 친구 사용자 ID |

#### Response

```json
{
  "success": true,
  "data": null,
  "message": "친구를 삭제했습니다."
}
```

#### Error Codes

| 코드 | 메시지 | 설명 |
|------|--------|------|
| `NOT_FRIENDS` | 친구 관계가 아닙니다. | 친구 관계 없음 |

---

## 사용자 검색 API

### 5. 사용자 검색 (친구 추가용)

이메일 또는 전화번호로 사용자를 검색합니다. 이메일 형식이면 `users.email`, 전화번호 형식이면 `users.phone`에서만 검색합니다. 전화번호는 서버에서 `000-000-0000` 또는 `000-0000-0000` 저장 형식으로 정규화하며, 두 형식 모두 아니면 요청을 거절합니다.

#### Request

```
GET /api/v1/users/search
```

**Headers**

```
Authorization: Bearer {access_token}
```

**Query Parameters**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `query` | string | Y | 이메일 또는 전화번호. 이메일 예: `spp8585@naver.com`, 전화번호 예: `010-1234-5678` |

#### Response

```json
{
  "success": true,
  "data": {
    "user": {
      "user_id": "uuid",
      "name": "홍길동",
      "email": "hong@email.com",
      "profile_image_url": "https://...",
      "is_friend": false,
      "has_pending_request": false,
      "pending_request_direction": null
    }
  }
}
```

**필드 설명**
| 필드 | 타입 | 설명 |
|------|------|------|
| `is_friend` | boolean | 이미 친구 관계인지 여부 |
| `has_pending_request` | boolean | 대기중인 요청이 있는지 여부 |
| `pending_request_direction` | string? | 대기중인 요청 방향 ("sent" / "received" / null) |

#### Error Codes

| 코드 | 메시지 | 설명 |
|------|--------|------|
| `USER_NOT_FOUND` | 해당 사용자를 찾을 수 없습니다. | 검색 결과 없음 |
| `INVALID_QUERY` | 올바른 이메일 또는 전화번호를 입력해주세요. | 입력값 유효성 검증 실패 |

---

## 친구 요청 API

### 6. 친구 요청 보내기

새로운 친구 요청을 생성합니다.

#### Request

```
POST /api/v1/friend-requests
```

**Headers**

```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Body**

```json
{
  "addressee_user_id": "uuid",
  "message": "친구가 되어주세요!"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `addressee_user_id` | uuid | Y | 요청 받을 사용자 ID |
| `message` | string | N | 메시지 (최대 200자) |

#### Response

```json
{
  "success": true,
  "data": {
    "request_id": "uuid",
    "requester_user_id": "uuid",
    "addressee_user_id": "uuid",
    "status": "PENDING",
    "message": "친구가 되어주세요!",
    "created_at": "2026-01-04T12:00:00.000Z",
    "responded_at": null
  },
  "message": "친구 요청을 보냈습니다."
}
```

#### Error Codes

| 코드 | 메시지 | 설명 |
|------|--------|------|
| `SELF_REQUEST` | 자기 자신에게 친구 요청을 보낼 수 없습니다. | 자기 자신에게 요청 |
| `ALREADY_FRIENDS` | 이미 친구 관계입니다. | 이미 친구인 사용자 |
| `PENDING_REQUEST_EXISTS` | 이미 대기 중인 요청이 있습니다. | 중복 요청 |
| `USER_NOT_FOUND` | 해당 사용자를 찾을 수 없습니다. | 존재하지 않는 사용자 |

---

### 7. 받은 친구 요청 목록 조회

내가 받은 친구 요청 목록을 조회합니다.

#### Request

```
GET /api/v1/friend-requests/received
```

**Headers**

```
Authorization: Bearer {access_token}
```

**Query Parameters**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `status` | string | N | 필터링할 상태 (PENDING / ACCEPTED / REJECTED) |
| `page` | number | N | 페이지 번호 (기본값: 1) |
| `limit` | number | N | 페이지당 항목 수 (기본값: 20) |

#### Response

```json
{
  "success": true,
  "data": {
    "requests": [
      {
        "request_id": "uuid",
        "requester": {
          "user_id": "uuid",
          "name": "박철수",
          "email": "park@email.com",
          "profile_image_url": "https://..."
        },
        "status": "PENDING",
        "message": "친구가 되어주세요!",
        "created_at": "2026-01-04T12:00:00.000Z",
        "responded_at": null
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 3,
      "total_pages": 1
    }
  }
}
```

---

### 8. 보낸 친구 요청 목록 조회

내가 보낸 친구 요청 목록을 조회합니다.

#### Request

```
GET /api/v1/friend-requests/sent
```

**Headers**

```
Authorization: Bearer {access_token}
```

**Query Parameters**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `status` | string | N | 필터링할 상태 (PENDING / ACCEPTED / REJECTED / CANCELED) |
| `page` | number | N | 페이지 번호 (기본값: 1) |
| `limit` | number | N | 페이지당 항목 수 (기본값: 20) |

#### Response

```json
{
  "success": true,
  "data": {
    "requests": [
      {
        "request_id": "uuid",
        "addressee": {
          "user_id": "uuid",
          "name": "이영수",
          "email": "lee@email.com",
          "profile_image_url": "https://..."
        },
        "status": "PENDING",
        "message": null,
        "created_at": "2026-01-04T12:00:00.000Z",
        "responded_at": null
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 2,
      "total_pages": 1
    }
  }
}
```

---

### 9. 친구 요청 응답 (수락/거절)

받은 친구 요청에 대해 수락 또는 거절합니다.

#### Request

```
PUT /api/v1/friend-requests/:request_id/respond
```

**Headers**

```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Path Parameters**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `request_id` | uuid | Y | 요청 ID |

**Body**

```json
{
  "action": "accept"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `action` | string | Y | "accept" 또는 "reject" |

#### Response (수락 시)

```json
{
  "success": true,
  "data": {
    "request_id": "uuid",
    "status": "ACCEPTED",
    "responded_at": "2026-01-04T12:30:00.000Z",
    "friendship": {
      "user_id_a": "uuid",
      "user_id_b": "uuid",
      "created_at": "2026-01-04T12:30:00.000Z"
    },
    "notification": {
      "notification_id": "uuid",
      "notification_type": "FRIEND_REQUEST_ACCEPTED",
      "title": "친구 요청 수락",
      "body": "박철수님의 친구 요청을 수락했습니다.",
      "payload": {
        "related_user_id": "uuid",
        "request_id": "uuid",
        "user_name": "박철수",
        "profile_image_url": "https://...",
        "request_status": "ACCEPTED",
        "responded_at": "2026-01-04T12:30:00.000Z"
      },
      "actions": [],
      "is_read": true,
      "read_at": "2026-01-04T12:30:00.000Z",
      "created_at": "2026-01-04T12:00:00.000Z"
    }
  },
  "message": "친구 요청을 수락했습니다."
}
```

#### Response (거절 시)

```json
{
  "success": true,
  "data": {
    "request_id": "uuid",
    "status": "REJECTED",
    "responded_at": "2026-01-04T12:30:00.000Z",
    "notification": {
      "notification_id": "uuid",
      "notification_type": "FRIEND_REQUEST_REJECTED",
      "title": "친구 요청 거절",
      "body": "박철수님의 친구 요청을 거절했습니다.",
      "payload": {
        "related_user_id": "uuid",
        "request_id": "uuid",
        "user_name": "박철수",
        "profile_image_url": "https://...",
        "request_status": "REJECTED",
        "responded_at": "2026-01-04T12:30:00.000Z"
      },
      "actions": [],
      "is_read": true,
      "read_at": "2026-01-04T12:30:00.000Z",
      "created_at": "2026-01-04T12:00:00.000Z"
    }
  },
  "message": "친구 요청을 거절했습니다."
}
```

응답의 `data.notification`은 수신자 알림 목록에 있던 원본 `FRIEND_REQUEST` 알림을 갱신한 결과입니다. 프론트엔드는 이 객체로 기존 알림 카드를 즉시 교체할 수 있고, 알림 목록을 다시 조회해도 같은 처리 완료 상태가 반환됩니다.

#### Error Codes

| 코드 | 메시지 | 설명 |
|------|--------|------|
| `REQUEST_NOT_FOUND` | 친구 요청을 찾을 수 없습니다. | 존재하지 않는 요청 |
| `NOT_ADDRESSEE` | 이 요청에 응답할 권한이 없습니다. | 요청 수신자가 아님 |
| `NOT_PENDING` | 이미 처리된 요청입니다. | PENDING 상태가 아님 |
| `INVALID_ACTION` | 올바른 응답을 선택해주세요. | accept/reject가 아님 |

---

### 10. 친구 요청 취소

내가 보낸 친구 요청을 취소합니다.

#### Request

```
PUT /api/v1/friend-requests/:request_id/cancel
```

**Headers**

```
Authorization: Bearer {access_token}
```

**Path Parameters**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `request_id` | uuid | Y | 요청 ID |

#### Response

```json
{
  "success": true,
  "data": {
    "request_id": "uuid",
    "status": "CANCELED",
    "responded_at": "2026-01-04T12:30:00.000Z"
  },
  "message": "친구 요청을 취소했습니다."
}
```

#### Error Codes

| 코드 | 메시지 | 설명 |
|------|--------|------|
| `REQUEST_NOT_FOUND` | 친구 요청을 찾을 수 없습니다. | 존재하지 않는 요청 |
| `NOT_REQUESTER` | 이 요청을 취소할 권한이 없습니다. | 요청 발신자가 아님 |
| `NOT_PENDING` | 이미 처리된 요청입니다. | PENDING 상태가 아님 |

---

## 알림 API

### 11. 알림 목록 조회

알림 목록을 조회합니다. **조회 시 자동으로 읽음 처리됩니다.**

#### Request

```
GET /api/v1/notifications
```

**Headers**

```
Authorization: Bearer {access_token}
```

**Query Parameters**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `page` | number | N | 페이지 번호 (기본값: 1) |
| `limit` | number | N | 페이지당 항목 수 (기본값: 20, 최대: 100) |

#### Response

```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "notification_id": "uuid",
        "notification_type": "FRIEND_REQUEST",
        "title": "친구 요청",
        "body": "홍길동님이 친구 요청을 보냈습니다.",
        "payload": {
          "related_user_id": "uuid",
          "request_id": "uuid",
          "user_name": "홍길동",
          "profile_image_url": "https://..."
        },
        "actions": [
          { "type": "accept", "label": "수락" },
          { "type": "reject", "label": "거절" }
        ],
        "is_read": true,
        "read_at": "2026-01-04T12:30:00.000Z",
        "created_at": "2026-01-04T12:00:00.000Z"
      },
      {
        "notification_id": "uuid",
        "notification_type": "FRIEND_REQUEST_ACCEPTED",
        "title": "친구 요청 수락",
        "body": "홍길동님의 친구 요청을 수락했습니다.",
        "payload": {
          "related_user_id": "uuid",
          "request_id": "uuid",
          "user_name": "홍길동",
          "profile_image_url": "https://...",
          "request_status": "ACCEPTED",
          "responded_at": "2026-01-04T12:30:00.000Z"
        },
        "actions": [],
        "is_read": true,
        "read_at": "2026-01-04T12:30:00.000Z",
        "created_at": "2026-01-04T12:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "total_pages": 1
    }
  }
}
```

---

### 12. 미읽음 알림 개수 조회

미읽음 알림 개수를 조회합니다. **읽음 처리하지 않습니다.**

> 메인 페이지 등에서 알림 뱃지 표시용으로 사용합니다.

#### Request

```
GET /api/v1/notifications/unread-count
```

**Headers**

```
Authorization: Bearer {access_token}
```

#### Response

```json
{
  "success": true,
  "data": {
    "unread_count": 3
  }
}
```

---

## 알림 타입 및 액션 가이드

### 알림 타입 (notification_type)

알림 타입은 확장 가능하며, 프론트엔드에서 타입에 따라 UI를 다르게 표시할 수 있습니다.

| 타입 | 설명 | 예시 |
|------|------|------|
| `FRIEND_REQUEST` | 친구 요청 받음 | 수락/거절 버튼 표시 |
| `FRIEND_REQUEST_ACCEPTED` | 받은 친구 요청을 내가 수락함 | 버튼 없음 |
| `FRIEND_REQUEST_REJECTED` | 받은 친구 요청을 내가 거절함 | 버튼 없음 |
| `FRIEND_ACCEPTED` | 내 친구 요청이 수락됨 | 친구 목록 보기 버튼 |
| `FRIEND_REJECTED` | 내 친구 요청이 거절됨 | 버튼 없음 |
| `SCHEDULE_SHARED` | 일정 공유됨 | (추후 확장) |
| `SYSTEM` | 시스템 알림 | 확인 버튼 |
| `GENERAL` | 일반 알림 | 확인 버튼 |

### 액션 타입 (actions)

프론트엔드에서 액션 타입에 따라 버튼 동작을 구현합니다.

| 액션 타입 | 설명 | 필드 |
|----------|------|------|
| `accept` | 수락 버튼 | `type`, `label` |
| `reject` | 거절 버튼 | `type`, `label` |
| `navigate` | 화면 이동 | `type`, `label`, `route` |

### 프론트엔드 구현 예시

```dart
// Flutter 예시
Widget buildNotificationActions(Notification notification) {
  return Row(
    children: notification.actions.map((action) {
      return ElevatedButton(
        onPressed: () => handleAction(action, notification),
        child: Text(action.label),
      );
    }).toList(),
  );
}

Future<void> handleAction(NotificationAction action, Notification notification) async {
  switch (action.type) {
    case 'accept':
      // 친구 요청 수락 API 호출
      final requestId = notification.payload['request_id'];
      final result = await friendRequestApi.respond(requestId, 'accept');
      // result.notification으로 기존 알림 카드를 처리 완료 상태로 교체
      break;
    case 'reject':
      // 친구 요청 거절 API 호출
      final requestId = notification.payload['request_id'];
      final result = await friendRequestApi.respond(requestId, 'reject');
      // result.notification으로 기존 알림 카드를 처리 완료 상태로 교체
      break;
    case 'navigate':
      // 해당 route로 이동
      Navigator.pushNamed(context, action.route!);
      break;
  }
}
```

---

## DB 마이그레이션

### 실행 필요 SQL

```bash
psql -U postgres -d your_database -f migrations/add_phone_and_notifications.sql
```

### 마이그레이션 내용

1. `users` 테이블에 `phone` 컬럼 추가
2. `notifications` 테이블 생성

### 롤백 방법

```sql
-- notifications 테이블 삭제
DROP TABLE IF EXISTS notifications CASCADE;

-- users.phone 컬럼 삭제
ALTER TABLE users DROP COLUMN IF EXISTS phone;
DROP INDEX IF EXISTS idx_users_phone;
```

---

## 프론트엔드 API Constants

```dart
// api_constants.dart

// 친구 관련
static const String friends = '/friends';
static const String friendSettings = '/friends'; // PUT /:friend_user_id/settings
static const String usersSearch = '/users/search';

// 친구 요청 관련
static const String friendRequests = '/friend-requests';
static const String friendRequestsReceived = '/friend-requests/received';
static const String friendRequestsSent = '/friend-requests/sent';
// 응답: PUT /friend-requests/:request_id/respond
// 취소: PUT /friend-requests/:request_id/cancel

// 알림 관련
static const String notifications = '/notifications';
static const String notificationsUnreadCount = '/notifications/unread-count';
```

---

## 에러 코드 전체 목록

| 코드 | HTTP 상태 | 메시지 |
|------|----------|--------|
| `SELF_REQUEST` | 400 | 자기 자신에게 친구 요청을 보낼 수 없습니다. |
| `ALREADY_FRIENDS` | 400 | 이미 친구 관계입니다. |
| `PENDING_REQUEST_EXISTS` | 400 | 이미 대기 중인 요청이 있습니다. |
| `USER_NOT_FOUND` | 404 | 해당 사용자를 찾을 수 없습니다. |
| `REQUEST_NOT_FOUND` | 404 | 친구 요청을 찾을 수 없습니다. |
| `NOT_ADDRESSEE` | 403 | 이 요청에 응답할 권한이 없습니다. |
| `NOT_REQUESTER` | 403 | 이 요청을 취소할 권한이 없습니다. |
| `NOT_PENDING` | 400 | 이미 처리된 요청입니다. |
| `INVALID_ACTION` | 400 | 올바른 응답을 선택해주세요. |
| `NOT_FRIENDS` | 400 | 친구 관계가 아닙니다. |
| `INVALID_LEVEL` | 400 | 친구 레벨은 0~5 사이여야 합니다. |
| `INVALID_QUERY` | 400 | 올바른 이메일 또는 전화번호를 입력해주세요. |

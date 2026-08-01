# Flutter 그룹 API 연동 가이드

## 1. 문서 목적

이 문서는 Flutter의 그룹 목록, 그룹 상세, 그룹 캘린더, 그룹 초대와 관리 화면을 실제 ShiftMate 서버 API에 연결하기 위한 프론트팀 전달 문서입니다.

계약 기준일은 2026-08-01이며, 다음 서버 구현을 직접 대조한 결과를 기준으로 합니다.

- `src/routes/groupRoutes.ts`
- `src/controllers/groupController.ts`
- `src/services/groupService.ts`
- `src/types/group.ts`
- `src/openapi/groupOpenApi.json`

서버 내부 migration 및 운영 절차는 `_docs/GROUP_API_GUIDE.md`, 실제 동작 검증은 `_docs/GROUP_RUNTIME_VERIFICATION_CHECKLIST.md`를 사용합니다.

## 2. 연동 전 서버팀 확인값

아래 값은 저장소만으로 확정할 수 없으므로 서버팀이 Stage 배포 후 채워서 전달합니다.

| 항목 | 전달값 |
| --- | --- |
| Stage origin | `{STAGE_ORIGIN}` |
| API base URL | `{STAGE_ORIGIN}/api/v1` |
| 배포 단계 | `P0` 또는 `P0+P1` |
| DB migration | `groups`, `group_members`, `group_invitations` postflight 통과 여부 |
| API readiness | `GET {STAGE_ORIGIN}/api/v1/health/ready`가 `200`인지 |
| Swagger | `{STAGE_ORIGIN}/api-docs` (`API_DOCS_ENABLED=true`일 때만 노출) |
| OpenAPI JSON | `{STAGE_ORIGIN}/api-docs/openapi.json` |

코드에 endpoint가 있더라도 Stage 이미지와 DB migration이 배포되지 않았다면 앱에서 사용할 수 없습니다. Flutter 더미 데이터 제거는 Stage P0 실제 호출이 통과한 뒤 진행합니다.

## 3. 공통 통신 계약

### 3.1 요청

```http
Authorization: Bearer {access_token}
Content-Type: application/json
Accept: application/json
```

- 모든 그룹 API는 JWT 인증이 필요합니다.
- JSON 키는 `snake_case`입니다. Dart 필드명은 기존 프로젝트 규칙에 맞게 `camelCase`를 사용하고 직렬화 키만 매핑합니다.
- UUID는 JSON 문자열입니다.
- 모바일 앱처럼 `Origin` 헤더가 없는 요청은 CORS에서 허용됩니다.

### 3.2 성공 응답

```json
{
  "success": true,
  "data": {},
  "message": "선택적 성공 메시지"
}
```

`message`는 없는 응답도 있으므로 nullable로 처리하고, 화면 상태 갱신은 `data`를 기준으로 합니다.

### 3.3 실패 응답

```json
{
  "success": false,
  "error": {
    "code": "GROUP_NOT_FOUND",
    "message": "그룹을 찾을 수 없습니다."
  }
}
```

요청 validation 실패 시 최상위 `errors` 배열이 추가될 수 있습니다. 앱 분기는 `error.code`를 기준으로 하고 `errors` 원문에 의존하지 않습니다.

### 3.4 인증 만료

토큰 누락, 만료, 잘못된 사용자 모두 다음 형식의 `401 UNAUTHORIZED`입니다.

```json
{
  "success": false,
  "message": "로그인이 필요합니다.",
  "error": {
    "code": "UNAUTHORIZED",
    "message": "로그인이 필요합니다."
  }
}
```

기존 인증 인터셉터에서 Refresh Token rotation을 한 번 수행한 뒤 원 요청을 한 번만 재시도합니다. 재시도도 401이면 로그인 화면으로 이동합니다.

### 3.5 값 직렬화

| 값 | 서버 형식 | Flutter 처리 |
| --- | --- | --- |
| timestamp | UTC ISO 8601, 예: `2026-08-01T03:00:00.000Z` | `DateTime.parse()` 후 화면 timezone으로 표시 |
| `work_date` | `YYYY-MM-DD` | 시간대로 변환하지 않고 날짜 전용 값으로 유지 |
| `start_date`, `end_date` | `YYYY-MM-DD` | 그룹 timezone 기준 양 끝 포함 범위 |
| 근무 시작/종료 시간 | `HH:mm:ss` 또는 `null` | OFF/휴무 계열의 null 허용 |
| 근무 색상 | `#AARRGGBB` 또는 `null` | 기존 API 색상 parser 재사용 |
| 프로필 이미지 | URL 문자열 또는 `null` | null/로드 실패 fallback 이미지 표시 |

## 4. 배포 단계별 endpoint

### 4.1 P0 — 더미 데이터 교체에 필요한 API

| Method | Path | 화면/기능 |
| --- | --- | --- |
| `POST` | `/groups` | 그룹 생성 |
| `GET` | `/groups` | 내 그룹 목록 |
| `GET` | `/groups/{group_id}` | 그룹 상세 |
| `GET` | `/groups/{group_id}/calendar/range` | 그룹 캘린더 |
| `POST` | `/groups/{group_id}/invitations` | 친구 초대 |
| `GET` | `/group-invitations/received` | 받은 초대함 |
| `PUT` | `/group-invitations/{invitation_id}/respond` | 초대 수락/거절 |

### 4.2 P1 — 그룹 관리 API

| Method | Path | 화면/기능 |
| --- | --- | --- |
| `PATCH` | `/groups/{group_id}` | 그룹명/timezone 수정 |
| `DELETE` | `/groups/{group_id}` | 그룹 삭제 |
| `GET` | `/groups/{group_id}/invitations` | 그룹이 보낸 초대 목록 |
| `PUT` | `/group-invitations/{invitation_id}/cancel` | 대기 초대 취소 |
| `DELETE` | `/groups/{group_id}/members/{user_id}` | 멤버 제거 |
| `PATCH` | `/groups/{group_id}/members/{user_id}` | 역할 변경 |
| `POST` | `/groups/{group_id}/leave` | 그룹 나가기 |
| `PUT` | `/groups/{group_id}/owner` | 소유권 이전 |

서버 route에는 P1도 포함되어 있으나 Flutter에서 노출하기 전 해당 Stage 이미지가 배포되었는지 확인합니다.

## 5. 공통 enum과 DTO

### 5.1 Enum

```dart
enum GroupRole { owner, admin, member }

enum GroupInvitationStatus {
  pending,
  accepted,
  rejected,
  canceled,
  expired,
}

enum CalendarAccess { self, visible, denied }
```

JSON 값은 각각 대문자 `OWNER/ADMIN/MEMBER`, `PENDING/...`, `SELF/VISIBLE/DENIED`입니다. 알 수 없는 enum 값이 추가될 가능성에 대비해 생성 코드의 unknown fallback 정책을 적용합니다.

### 5.2 사용자·멤버

| 필드 | 타입 | null | 비고 |
| --- | --- | --- | --- |
| `user_id` | string(UUID) | N | 사용자 식별자 |
| `name` | string | N | 표시 이름 |
| `profile_image_url` | string | Y | 이메일·전화번호는 그룹 응답에 없음 |
| `role` | `GroupRole` | N | 멤버 객체에만 존재 |
| `joined_at` | UTC ISO string | N | 멤버 객체에만 존재 |

### 5.3 `GroupSummary`

| 필드 | 타입 | null | 비고 |
| --- | --- | --- | --- |
| `group_id` | string(UUID) | N | 그룹 식별자 |
| `name` | string | N | trim 후 1~50자 |
| `timezone` | string | N | IANA timezone |
| `my_role` | `GroupRole` | N | 현재 사용자의 역할 |
| `member_count` | int | N | 활성 멤버 수 |
| `members_preview` | `GroupUserSummary[]` | N | 최대 4명 |
| `created_at` | UTC ISO string | N | 생성 시각 |
| `updated_at` | UTC ISO string | N | 목록 정렬 기준 |

목록은 `updated_at DESC`, 같은 값이면 `group_id DESC`입니다. 초대 생성/취소만으로는 `updated_at`이 바뀌지 않습니다.

### 5.4 `GroupDetail`

`GroupSummary`의 기본 필드에 아래가 추가되며 `members_preview` 대신 전체 `members`를 가집니다.

| 필드 | 타입 | null |
| --- | --- | --- |
| `members` | `GroupMember[]` | N |
| `created_by_user_id` | string(UUID) | N |

멤버 정렬은 `OWNER → ADMIN → MEMBER`, 같은 역할은 `joined_at ASC`, 마지막 tie-breaker는 `user_id ASC`입니다.

### 5.5 `Pagination`

```json
{
  "page": 1,
  "limit": 20,
  "total": 37,
  "total_pages": 2
}
```

- `page`: 기본 1, 최소 1
- `limit`: 기본 20, 1~100
- `total_pages`가 0이면 다음 페이지 요청을 만들지 않습니다.
- 새로고침은 page 1을 교체하고, 다음 페이지는 `page < total_pages`일 때만 append합니다.

## 6. P0 API 상세

아래 경로는 모두 `{STAGE_ORIGIN}/api/v1` 뒤에 붙입니다.

### 6.1 그룹 생성

```http
POST /groups
```

```json
{
  "name": "우리 병동",
  "timezone": "Asia/Seoul",
  "invitee_user_ids": [
    "31d1890d-c132-4668-8daf-bff2942b4ac0"
  ]
}
```

| 필드 | 필수 | 규칙 |
| --- | --- | --- |
| `name` | Y | 서버에서 trim, Unicode 기준 1~50자 |
| `timezone` | N | 유효한 IANA timezone. 생략 시 사용자 timezone, 무효/누락된 사용자 timezone이면 `Asia/Seoul` |
| `invitee_user_ids` | N | UUID 배열, request validator 최대 100명, 중복/본인/친구 아님 거절 |

활성 멤버 상한은 기본 20명입니다. 초대 API가 100개까지 입력을 받더라도 수락 시점에 20명 제한을 다시 검사하므로, UI에서는 남은 활성 좌석 수를 안내하고 초과 수락 실패를 처리해야 합니다.

성공은 `201 Created`입니다.

```json
{
  "success": true,
  "data": {
    "group": {
      "group_id": "2b1fdc0b-4240-4e6e-95f5-cdbed7530a2f",
      "name": "우리 병동",
      "timezone": "Asia/Seoul",
      "my_role": "OWNER",
      "member_count": 1,
      "members": [
        {
          "user_id": "2a2d9f60-c51e-4f15-bd47-b5b0bac86a73",
          "name": "박현서",
          "profile_image_url": null,
          "role": "OWNER",
          "joined_at": "2026-08-01T03:00:00.000Z"
        }
      ],
      "created_by_user_id": "2a2d9f60-c51e-4f15-bd47-b5b0bac86a73",
      "created_at": "2026-08-01T03:00:00.000Z",
      "updated_at": "2026-08-01T03:00:00.000Z"
    },
    "invitations": [
      {
        "invitation_id": "1f412f3f-7f9f-4ac5-acf7-44c2e3f47a16",
        "invitee_user_id": "31d1890d-c132-4668-8daf-bff2942b4ac0",
        "status": "PENDING",
        "expires_at": "2026-08-08T03:00:00.000Z"
      }
    ]
  },
  "message": "그룹이 생성되었습니다."
}
```

그룹, OWNER 멤버십, 모든 초대와 DB 알림은 한 transaction입니다. 한 명이라도 실패하면 그룹 생성 전체가 실패하므로 부분 성공 UI를 만들지 않습니다.

### 6.2 내 그룹 목록

```http
GET /groups?page=1&limit=20
```

```json
{
  "success": true,
  "data": {
    "groups": [
      {
        "group_id": "2b1fdc0b-4240-4e6e-95f5-cdbed7530a2f",
        "name": "우리 병동",
        "timezone": "Asia/Seoul",
        "my_role": "OWNER",
        "member_count": 2,
        "members_preview": [
          {
            "user_id": "2a2d9f60-c51e-4f15-bd47-b5b0bac86a73",
            "name": "박현서",
            "profile_image_url": null
          },
          {
            "user_id": "31d1890d-c132-4668-8daf-bff2942b4ac0",
            "name": "김민수",
            "profile_image_url": "https://example.com/profile.png"
          }
        ],
        "created_at": "2026-08-01T03:00:00.000Z",
        "updated_at": "2026-08-01T04:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "total_pages": 1
    }
  }
}
```

빈 목록도 정상 응답이며 `groups=[]`, `total=0`, `total_pages=0`입니다.

### 6.3 그룹 상세

```http
GET /groups/{group_id}
```

성공은 다음 wrapper입니다.

```json
{
  "success": true,
  "data": {
    "group": {
      "group_id": "2b1fdc0b-4240-4e6e-95f5-cdbed7530a2f",
      "name": "우리 병동",
      "timezone": "Asia/Seoul",
      "my_role": "MEMBER",
      "member_count": 2,
      "members": [
        {
          "user_id": "2a2d9f60-c51e-4f15-bd47-b5b0bac86a73",
          "name": "박현서",
          "profile_image_url": null,
          "role": "OWNER",
          "joined_at": "2026-08-01T03:00:00.000Z"
        },
        {
          "user_id": "31d1890d-c132-4668-8daf-bff2942b4ac0",
          "name": "김민수",
          "profile_image_url": null,
          "role": "MEMBER",
          "joined_at": "2026-08-01T04:00:00.000Z"
        }
      ],
      "created_by_user_id": "2a2d9f60-c51e-4f15-bd47-b5b0bac86a73",
      "created_at": "2026-08-01T03:00:00.000Z",
      "updated_at": "2026-08-01T04:00:00.000Z"
    }
  }
}
```

비멤버, 탈퇴/제거된 사용자, 삭제된 그룹은 모두 `404 GROUP_NOT_FOUND`입니다.

### 6.4 그룹 캘린더 범위

```http
GET /groups/{group_id}/calendar/range?start_date=2026-07-01&end_date=2026-09-30
```

- 날짜는 양 끝 포함입니다.
- 기본 최대 범위는 100일입니다.
- Flutter 월 화면은 전월 1일~다음월 말일을 요청할 수 있지만, 호출 전에 inclusive 일수를 계산해 100일 이하인지 확인합니다.
- 조회 기준 timezone은 응답 `group.timezone`입니다.

```json
{
  "success": true,
  "data": {
    "group": {
      "group_id": "2b1fdc0b-4240-4e6e-95f5-cdbed7530a2f",
      "name": "우리 병동",
      "timezone": "Asia/Seoul"
    },
    "range": {
      "start_date": "2026-07-01",
      "end_date": "2026-09-30"
    },
    "members": [
      {
        "user_id": "31d1890d-c132-4668-8daf-bff2942b4ac0",
        "name": "김민수",
        "profile_image_url": null,
        "role": "MEMBER",
        "joined_at": "2026-08-01T04:00:00.000Z",
        "calendar_access": "SELF"
      },
      {
        "user_id": "2a2d9f60-c51e-4f15-bd47-b5b0bac86a73",
        "name": "박현서",
        "profile_image_url": null,
        "role": "OWNER",
        "joined_at": "2026-08-01T03:00:00.000Z",
        "calendar_access": "VISIBLE"
      },
      {
        "user_id": "f3ea04a6-332a-49bd-b634-cddaee851d25",
        "name": "이지연",
        "profile_image_url": null,
        "role": "MEMBER",
        "joined_at": "2026-08-01T05:00:00.000Z",
        "calendar_access": "DENIED"
      }
    ],
    "work_shifts": [
      {
        "owner_user_id": "2a2d9f60-c51e-4f15-bd47-b5b0bac86a73",
        "work_shift_id": "fb75f070-53c2-44f5-a178-6abc93a0e14a",
        "work_date": "2026-08-02",
        "shift_type_code": "D",
        "shift_type_name": "데이",
        "shift_type_color": "#FFFF9500",
        "start_time": "07:00:00",
        "end_time": "15:00:00",
        "note": null,
        "created_at": "2026-08-01T03:00:00.000Z",
        "updated_at": "2026-08-01T03:00:00.000Z"
      }
    ],
    "events": [
      {
        "owner_user_id": "2a2d9f60-c51e-4f15-bd47-b5b0bac86a73",
        "event_id": "543035ca-7e94-4669-ac65-92e31a8e12d9",
        "title": "병원 예약",
        "memo": null,
        "place": "서울",
        "all_day": false,
        "start_at": "2026-08-02T00:30:00.000Z",
        "end_at": "2026-08-02T01:30:00.000Z",
        "visibility_level": 1
      }
    ]
  }
}
```

#### 캘린더 상태 해석

| `calendar_access` | 의미 | UI 처리 |
| --- | --- | --- |
| `SELF` | 조회자 본인 | 본인 근무·일정 전체 표시 |
| `VISIBLE` | 친구 관계와 소유자→조회자 `can_view=true` | 서버가 공개한 row만 표시 |
| `DENIED` | 친구가 아니거나 `can_view=false` | `공개 안 함`/잠금 상태 표시 |

중요 규칙:

- `DENIED` 멤버도 `members` 배열에 남습니다.
- 해당 사용자의 row와 숨겨진 개수는 `work_shifts`, `events`에 포함되지 않습니다.
- `DENIED`를 근무 없음/일정 없음으로 표시하지 않습니다.
- `VISIBLE`이어도 visibility level이 높은 이벤트는 서버에서 제거됩니다. 앱에서 추가 ACL 필터링을 하지 않습니다.
- 모든 근무와 이벤트는 `owner_user_id`로 멤버와 연결합니다.
- 기존 1인용 `CalendarRangeState`로 변환하면서 `owner_user_id`를 버리면 안 됩니다.
- 이벤트 `start_at`/`end_at`은 UTC timestamp이므로 날짜·시간 배치는 기기 timezone이 아니라 응답 `group.timezone`으로 변환합니다. `work_date`는 변환하지 않습니다.

권장 상태 구조:

```dart
class GroupCalendarRangeState {
  final GroupCalendarHeader group;
  final String startDate; // YYYY-MM-DD
  final String endDate; // YYYY-MM-DD
  final Map<String, GroupCalendarMember> membersByUserId;
  final Map<String, List<GroupCalendarWorkShift>> shiftsByDate;
  final List<GroupCalendarEvent> events;

  const GroupCalendarRangeState({
    required this.group,
    required this.startDate,
    required this.endDate,
    required this.membersByUserId,
    required this.shiftsByDate,
    required this.events,
  });
}
```

집계 숫자는 응답에 실제 포함된 row만 기준으로 계산합니다. 숨겨진 데이터가 있다고 추정하는 문구나 숫자를 표시하지 않습니다.

### 6.5 그룹에 친구 초대

```http
POST /groups/{group_id}/invitations
```

권한은 `OWNER`, `ADMIN`입니다.

```json
{
  "invitee_user_ids": [
    "31d1890d-c132-4668-8daf-bff2942b4ac0"
  ],
  "message": "우리 병동 그룹에 참여해주세요."
}
```

- `invitee_user_ids`: 1~100개 UUID
- `message`: 선택, null 허용, 최대 200자. 공백 문자열은 서버에서 null로 처리
- 초대 대상은 요청자와 수락된 친구여야 합니다.
- 이미 활성 멤버이거나 같은 그룹에 PENDING 초대가 있으면 전체 요청이 409로 실패합니다.
- bulk 요청은 부분 성공하지 않습니다.

성공은 `201 Created`이며 `data.invitations`는 간략 객체 배열입니다.

```json
{
  "success": true,
  "data": {
    "invitations": [
      {
        "invitation_id": "1f412f3f-7f9f-4ac5-acf7-44c2e3f47a16",
        "invitee_user_id": "31d1890d-c132-4668-8daf-bff2942b4ac0",
        "status": "PENDING",
        "expires_at": "2026-08-08T03:00:00.000Z"
      }
    ]
  },
  "message": "그룹 초대를 보냈습니다."
}
```

### 6.6 받은 그룹 초대 목록

```http
GET /group-invitations/received?status=PENDING&page=1&limit=20
```

`status`는 생략하거나 `PENDING`, `ACCEPTED`, `REJECTED`, `CANCELED`, `EXPIRED` 중 하나를 사용합니다.

```json
{
  "success": true,
  "data": {
    "invitations": [
      {
        "invitation_id": "1f412f3f-7f9f-4ac5-acf7-44c2e3f47a16",
        "group": {
          "group_id": "2b1fdc0b-4240-4e6e-95f5-cdbed7530a2f",
          "name": "우리 병동",
          "member_count": 1
        },
        "inviter": {
          "user_id": "2a2d9f60-c51e-4f15-bd47-b5b0bac86a73",
          "name": "박현서",
          "profile_image_url": null
        },
        "invitee_user_id": "31d1890d-c132-4668-8daf-bff2942b4ac0",
        "status": "PENDING",
        "message": "우리 병동 그룹에 참여해주세요.",
        "expires_at": "2026-08-08T03:00:00.000Z",
        "created_at": "2026-08-01T03:00:00.000Z",
        "responded_at": null
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "total_pages": 1
    }
  }
}
```

목록 조회 시 만료 시간이 지난 PENDING 초대는 서버가 `EXPIRED`로 변경합니다. PENDING 필터 결과에서 사라질 수 있으므로 로컬에서 임의로 PENDING을 유지하지 않습니다.

### 6.7 초대 수락/거절

```http
PUT /group-invitations/{invitation_id}/respond
```

수락:

```json
{
  "action": "accept"
}
```

거절:

```json
{
  "action": "reject"
}
```

성공 응답에는 처리된 원본 알림이 있으면 `notification`으로 함께 반환됩니다. 원본 알림이 없는 데이터도 허용하므로 nullable로 파싱합니다.

```json
{
  "success": true,
  "data": {
    "invitation": {
      "invitation_id": "1f412f3f-7f9f-4ac5-acf7-44c2e3f47a16",
      "status": "ACCEPTED",
      "responded_at": "2026-08-01T04:00:00.000Z"
    },
    "group": {
      "group_id": "2b1fdc0b-4240-4e6e-95f5-cdbed7530a2f",
      "name": "우리 병동",
      "timezone": "Asia/Seoul",
      "my_role": "MEMBER",
      "member_count": 2
    },
    "notification": {
      "notification_id": "f37173ca-f0d4-4426-b995-613cffec5a2e",
      "notification_type": "GROUP_INVITATION_ACCEPTED",
      "title": "그룹 초대",
      "body": "박현서님이 우리 병동 그룹에 초대했습니다.",
      "payload": {
        "invitation_id": "1f412f3f-7f9f-4ac5-acf7-44c2e3f47a16",
        "group_id": "2b1fdc0b-4240-4e6e-95f5-cdbed7530a2f",
        "group_name": "우리 병동",
        "inviter_user_id": "2a2d9f60-c51e-4f15-bd47-b5b0bac86a73",
        "inviter_name": "박현서",
        "profile_image_url": null,
        "invitation_status": "ACCEPTED",
        "expires_at": "2026-08-08T03:00:00.000Z"
      },
      "actions": [],
      "is_read": true,
      "read_at": "2026-08-01T04:00:00.000Z",
      "created_at": "2026-08-01T03:00:00.000Z"
    }
  },
  "message": "그룹 초대를 수락했습니다."
}
```

거절 성공 시 차이점:

- `invitation.status=REJECTED`
- `group.my_role=null`
- 그룹 멤버십이 생기지 않음
- `notification.notification_type=GROUP_INVITATION_REJECTED`
- message는 `그룹 초대를 거절했습니다.`

수락 직후에는 받은 초대 카드를 응답 데이터로 교체하고 그룹 목록 page 1을 새로 조회합니다. 거절 직후에는 카드만 terminal 상태로 교체합니다.

## 7. P1 API 요약 계약

P1은 Stage 배포 확인 후 UI를 노출합니다.

### 7.1 그룹 수정

```http
PATCH /groups/{group_id}
```

권한은 `OWNER`, `ADMIN`이며, `name`과 `timezone` 중 최소 하나가 필요합니다. null은 허용하지 않습니다.

```json
{
  "name": "응급실 A팀",
  "timezone": "Asia/Seoul"
}
```

성공 데이터는 `{ "group": GroupDetail }`입니다.

### 7.2 그룹 삭제

```http
DELETE /groups/{group_id}
```

`OWNER`만 가능합니다. 성공 데이터는 `group_id`, `deleted_at`이며 성공 후 목록과 상세/캘린더 캐시에서 해당 그룹을 제거합니다.

### 7.3 그룹 초대 목록과 취소

```http
GET /groups/{group_id}/invitations?status=PENDING&page=1&limit=20
PUT /group-invitations/{invitation_id}/cancel
```

`OWNER`, `ADMIN`만 가능합니다. 목록 객체는 받은 초대 목록과 같은 `GroupInvitation`입니다. 취소 성공 데이터는 다음 필드입니다.

```json
{
  "invitation_id": "1f412f3f-7f9f-4ac5-acf7-44c2e3f47a16",
  "status": "CANCELED",
  "responded_at": "2026-08-01T04:00:00.000Z",
  "notification": null
}
```

`notification`은 처리된 원본 알림 객체 또는 null입니다.

### 7.4 멤버 제거

```http
DELETE /groups/{group_id}/members/{user_id}
```

성공 데이터는 `group_id`, `user_id`, `removed_at`입니다. 성공 후 상세와 캘린더를 새로 조회합니다.

### 7.5 역할 변경

```http
PATCH /groups/{group_id}/members/{user_id}
```

`OWNER`만 가능하며 body의 `role`은 `ADMIN` 또는 `MEMBER`입니다.

```json
{
  "role": "ADMIN"
}
```

성공 데이터는 `{ "member": GroupMember, "group_updated_at": UTC_ISO }`입니다.

### 7.6 그룹 나가기

```http
POST /groups/{group_id}/leave
```

`ADMIN`, `MEMBER`가 사용합니다. 성공 데이터는 `group_id`, 현재 `user_id`, `removed_at`이며 성공 후 목록·상세·캘린더 캐시에서 제거합니다. `OWNER`는 먼저 소유권을 이전하거나 그룹을 삭제해야 합니다.

### 7.7 소유권 이전

```http
PUT /groups/{group_id}/owner
```

현재 `OWNER`만 가능합니다.

```json
{
  "new_owner_user_id": "31d1890d-c132-4668-8daf-bff2942b4ac0"
}
```

기존 OWNER는 `ADMIN`, 대상 활성 멤버는 `OWNER`가 됩니다. 성공 데이터는 `{ "group": GroupDetail }`입니다.

## 8. 역할별 UI 노출

| 작업 | OWNER | ADMIN | MEMBER |
| --- | --- | --- | --- |
| 목록·상세·캘린더 | 표시 | 표시 | 표시 |
| 그룹명/timezone 수정 | 표시 | 표시 | 숨김 |
| 초대 생성·목록·취소 | 표시 | 표시 | 숨김 |
| MEMBER 제거 | 표시 | 표시 | 숨김 |
| ADMIN 제거 | 표시 | 숨김 | 숨김 |
| 역할 변경 | 표시 | 숨김 | 숨김 |
| 나가기 | 소유권 이전/삭제 안내 | 표시 | 표시 |
| 소유권 이전·삭제 | 표시 | 숨김 | 숨김 |

클라이언트의 버튼 숨김은 UX 최적화일 뿐입니다. 서버가 최종 권한을 검사하므로 `403 GROUP_PERMISSION_DENIED`가 오면 상세를 새로 조회해 최신 `my_role`로 UI를 다시 구성합니다.

## 9. 오류 코드와 권장 UX

| HTTP | `error.code` | 권장 처리 |
| --- | --- | --- |
| 400 | `INVALID_GROUP_NAME` | 이름 입력 오류 표시 |
| 400 | `INVALID_GROUP_TIMEZONE` | timezone 선택값 재확인 |
| 400 | `INVALID_DATE_RANGE` | 날짜 범위 재계산 |
| 400 | `GROUP_CALENDAR_RANGE_TOO_LARGE` | 100일 이하로 축소 후 재요청 |
| 400 | `INVALID_GROUP_INVITATION_ACTION` | 클라이언트 오류 기록, 버튼 값 확인 |
| 400 | `INVALID_GROUP_MEMBER_ROLE` | 클라이언트 오류 기록, enum 값 확인 |
| 401 | `UNAUTHORIZED` | Refresh 1회 후 재시도, 실패 시 로그인 |
| 403 | `GROUP_PERMISSION_DENIED` | 권한 변경 안내 후 상세 새로고침 |
| 404 | `GROUP_NOT_FOUND` | 상세/캘린더 종료 후 목록 새로고침 |
| 404 | `GROUP_MEMBER_NOT_FOUND` | 멤버 목록 새로고침 |
| 404 | `GROUP_INVITATION_NOT_FOUND` | 초대 카드 제거 또는 목록 새로고침 |
| 409 | `GROUP_MEMBER_ALREADY_EXISTS` | 이미 가입됨 안내 후 그룹 목록 새로고침 |
| 409 | `GROUP_INVITATION_ALREADY_PENDING` | 중복 초대 안내 후 초대 목록 새로고침 |
| 409 | `GROUP_INVITATION_ALREADY_PROCESSED` | 중복 탭 방지, 초대 목록 새로고침 |
| 409 | `GROUP_INVITATION_EXPIRED` | 만료 상태로 교체하고 버튼 제거 |
| 409 | `GROUP_INVITEE_NOT_FRIEND` | 친구 관계 확인 안내 |
| 409 | `GROUP_MEMBER_LIMIT_REACHED` | 정원 초과 안내, 수락/초대 버튼 비활성화 |
| 409 | `GROUP_OWNER_CANNOT_LEAVE` | 소유권 이전 또는 삭제 선택 안내 |
| 409 | `GROUP_OWNER_CANNOT_BE_REMOVED` | OWNER 제거 불가 안내 |
| 409 | `INVALID_GROUP_OWNER_TRANSFER` | 대상 목록 새로고침 후 재선택 |
| 500 | `INTERNAL_SERVER_ERROR` | 공통 재시도 UI와 request ID 기반 문의 안내 |

비멤버와 삭제 그룹을 구분할 수 없도록 둘 다 `GROUP_NOT_FOUND`로 반환합니다. 앱 문구도 그룹 존재 여부를 추측하지 않는 일반 메시지를 사용합니다.

같은 초대의 수락/거절, 같은 멤버의 역할/제거 버튼은 요청 중 비활성화합니다. 다른 기기나 동시 요청 때문에 409가 올 수 있으므로 서버 응답을 최종 상태로 봅니다.

## 10. 알림 화면 연동

그룹 관련 알림 타입:

- `GROUP_INVITATION`
- `GROUP_INVITATION_ACCEPTED`
- `GROUP_INVITATION_REJECTED`
- `GROUP_INVITATION_CANCELED`

초대 만료 알림은 타입이 `GROUP_INVITATION`으로 유지되고 `payload.invitation_status=EXPIRED`, `actions=[]`, `is_read=true`가 됩니다. 따라서 버튼 표시 조건을 타입 하나로 판단하지 않습니다.

버튼 표시 조건:

```text
notification_type == GROUP_INVITATION
AND payload.invitation_status == PENDING
AND actions contains accept/reject
```

초대 상태의 source of truth는 `GET /group-invitations/received`입니다. 알림 목록과 상태가 일시적으로 다르면 받은 초대 API 결과를 우선합니다. 외부 push 발송은 현재 범위에 없습니다.

## 11. 권장 화면별 호출 흐름

### 11.1 그룹 목록 화면

```text
화면 진입/당겨서 새로고침
  → GET /groups?page=1&limit=20
카드 선택
  → GET /groups/{group_id}
  → 캘린더 화면 진입 시 GET /groups/{group_id}/calendar/range
```

목록 카드에는 `GroupSummary`만 사용합니다. 전체 멤버를 표시해야 할 때만 상세 API를 호출합니다.

### 11.2 그룹 생성 화면

```text
친구 선택
  → 기존 친구 목록 API 사용
입력 검증
  → POST /groups
성공
  → 응답 group으로 상세 이동 또는 그룹 목록 page 1 재조회
실패
  → 그룹/초대가 일부 생성되었다고 가정하지 않음
```

### 11.3 그룹 캘린더 화면

```text
표시할 월 결정
  → 전월 1일~다음월 말일 계산
  → inclusive 100일 이하 확인
  → GET /groups/{group_id}/calendar/range
  → membersByUserId 구성
  → owner_user_id를 유지한 채 날짜별 shift/event 표시
```

날짜 변경 요청은 이전 요청을 취소하거나 응답 sequence를 비교해 늦게 도착한 구간이 최신 화면을 덮지 않게 합니다.

### 11.4 받은 초대 화면

```text
GET /group-invitations/received?status=PENDING&page=1&limit=20
  → accept/reject 버튼
  → PUT /group-invitations/{id}/respond
  → 응답 invitation/notification으로 카드 즉시 교체
  → accept면 그룹 목록 page 1 재조회
```

### 11.5 관리 화면

상세 응답의 `my_role`과 대상 멤버 `role`로 버튼을 결정합니다. 관리 작업 성공 후 서버가 반환한 객체를 우선 적용하고, 멤버 수·정렬·캘린더 접근 상태가 영향을 받는 작업은 상세와 캘린더를 재조회합니다.

## 12. Dio 계층 권장 형태

기존 프로젝트의 토큰/refresh/error mapping 인터셉터를 그대로 사용하고 그룹 전용 datasource를 추가합니다.

```dart
abstract interface class GroupRemoteDataSource {
  Future<PaginatedGroups> getGroups({int page = 1, int limit = 20});

  Future<CreateGroupResult> createGroup(CreateGroupRequest request);

  Future<GroupDetail> getGroupDetail(String groupId);

  Future<GroupCalendarRange> getGroupCalendarRange({
    required String groupId,
    required String startDate, // YYYY-MM-DD
    required String endDate, // YYYY-MM-DD
  });

  Future<PaginatedGroupInvitations> getReceivedInvitations({
    GroupInvitationStatus? status,
    int page = 1,
    int limit = 20,
  });

  Future<RespondToGroupInvitationResult> respondToInvitation({
    required String invitationId,
    required String action,
  });
}
```

응답 decoder는 먼저 `success`를 확인하고, false이면 공통 `AppError`에 HTTP status, `error.code`, `error.message`를 보존합니다. DTO에서 domain 상태로 변환할 때도 `owner_user_id`와 `calendar_access`를 삭제하지 않습니다.

## 13. 데이터 갱신 기준

| 성공 작업 | 즉시 갱신할 상태 |
| --- | --- |
| 그룹 생성 | 그룹 목록 page 1, 선택된 그룹 상세 |
| 초대 생성/취소 | 초대 목록. 그룹 목록 순서는 유지 |
| 초대 수락 | 받은 초대 카드, 그룹 목록 page 1 |
| 초대 거절 | 받은 초대 카드 |
| 그룹명/timezone 수정 | 상세, 목록 카드, 캘린더 header |
| 멤버 가입/제거/나가기 | 목록 member count/preview, 상세, 캘린더 |
| 역할 변경/소유권 이전 | 목록 `my_role`, 상세, 관리 UI, 캘린더 멤버 순서 |
| 그룹 삭제 | 목록·상세·캘린더에서 제거 |
| 친구 공개 설정 변경 | 열려 있는 그룹 캘린더 재조회 |

## 14. 프론트 구현 체크리스트

### 모델/파싱

- [ ] `GroupRole`, `GroupInvitationStatus`, `CalendarAccess` JSON 매핑
- [ ] 모든 nullable 필드 처리
- [ ] UTC timestamp와 날짜 전용 `work_date` 분리
- [ ] `#AARRGGBB`/null 색상 처리
- [ ] `HH:mm:ss`/null 시간 처리
- [ ] pagination의 `total_pages=0` 처리
- [ ] `notification` nullable 처리
- [ ] 이메일·전화번호를 그룹 DTO에 기대하지 않음

### 화면/상태

- [ ] 목록 page 1 새로고침과 다음 페이지 append 분리
- [ ] `my_role` 기반 관리 버튼 노출
- [ ] 그룹 캘린더 전용 상태 도입
- [ ] 모든 shift/event의 `owner_user_id` 보존
- [ ] `DENIED`와 실제 데이터 없음 UI 구분
- [ ] 숨겨진 데이터 개수 추정 금지
- [ ] 캘린더 범위 양 끝 포함 100일 검사
- [ ] 월 전환 중 이전 HTTP 요청 취소 또는 stale 응답 방지
- [ ] 초대 응답 중 버튼 중복 탭 방지
- [ ] terminal 초대/알림에서 actions 버튼 제거

### 오류/회귀

- [ ] 401 refresh 1회 후 원 요청 재시도
- [ ] 403에서 상세 재조회 및 역할 UI 갱신
- [ ] 404 그룹에서 화면 종료와 목록 재조회
- [ ] 409 초대/멤버 경쟁 상태 처리
- [ ] 그룹 생성 bulk 실패 시 부분 성공으로 표시하지 않음
- [ ] 개인 캘린더와 친구 캘린더 기존 화면 회귀 없음

## 15. Stage 인수 테스트

더미 데이터를 제거하기 전에 최소 다음을 두 개 이상의 실제 테스트 계정으로 확인합니다.

- [ ] 로그인 토큰으로 `GET /groups` 200
- [ ] OWNER 그룹 생성 후 목록·상세 반영
- [ ] 친구 대상 bulk 초대 생성과 받은 초대함 노출
- [ ] 초대 수락 후 MEMBER로 그룹 목록에 진입
- [ ] 같은 초대 두 번 응답 시 첫 요청만 성공하고 두 번째 409 처리
- [ ] 그룹 캘린더에서 본인 `SELF`, 공개 친구 `VISIBLE`, 비공개/친구 아님 `DENIED` 구분
- [ ] `DENIED` 소유자의 shift/event가 배열에 없음
- [ ] 이벤트 UTC/group timezone 경계와 end-exclusive 표시
- [ ] `work_date`가 서버 문자열 그대로 같은 날짜에 표시
- [ ] 100일 초과 요청의 400 처리
- [ ] MEMBER 관리 버튼 미노출과 강제 요청 시 403 처리
- [ ] 초대 만료/수락/거절 후 알림 `actions=[]`
- [ ] 이름·메모·장소가 앱 오류 로그에 포함되지 않음

Stage 인수 테스트가 끝나면 테스트한 API origin, 서버 이미지 버전, DB migration 적용 시각, P0/P1 범위와 발견 이슈를 프론트/서버 양쪽 작업 기록에 남깁니다.

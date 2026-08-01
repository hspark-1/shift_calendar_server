import type { GroupInvitationStatus, GroupRole } from "../models";

export type CalendarAccess = "SELF" | "VISIBLE" | "DENIED";

export interface GroupUserSummary {
  user_id: string;
  name: string;
  profile_image_url: string | null;
}

export interface GroupMemberSummary extends GroupUserSummary {
  role: GroupRole;
  joined_at: string;
}

export interface GroupSummary {
  group_id: string;
  name: string;
  timezone: string;
  my_role: GroupRole;
  member_count: number;
  members_preview: GroupUserSummary[];
  created_at: string;
  updated_at: string;
}

export interface GroupDetail {
  group_id: string;
  name: string;
  timezone: string;
  my_role: GroupRole;
  member_count: number;
  members: GroupMemberSummary[];
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface GroupInvitationSummary {
  invitation_id: string;
  invitee_user_id: string;
  status: GroupInvitationStatus;
  expires_at: string;
}

export interface GroupInvitationApiModel {
  invitation_id: string;
  group: {
    group_id: string;
    name: string;
    member_count: number;
  };
  inviter: GroupUserSummary;
  invitee_user_id: string;
  status: GroupInvitationStatus;
  message: string | null;
  expires_at: string;
  created_at: string;
  responded_at: string | null;
}

export interface GroupCalendarMember extends GroupMemberSummary {
  calendar_access: CalendarAccess;
}

export interface GroupCalendarWorkShift {
  owner_user_id: string;
  work_shift_id: string;
  work_date: string;
  shift_type_code: string;
  shift_type_name: string;
  shift_type_color: string | null;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface GroupCalendarEvent {
  owner_user_id: string;
  event_id: string;
  title: string;
  memo: string | null;
  place: string | null;
  all_day: boolean;
  start_at: string;
  end_at: string;
  visibility_level: number;
}

export interface GroupCalendarRange {
  group: {
    group_id: string;
    name: string;
    timezone: string;
  };
  range: {
    start_date: string;
    end_date: string;
  };
  members: GroupCalendarMember[];
  work_shifts: GroupCalendarWorkShift[];
  events: GroupCalendarEvent[];
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

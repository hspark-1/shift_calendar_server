export interface WorkShiftApiModel {
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

-- 기존 데이터 보존. 대상 DB/백업 확인 후 API와 탈퇴 worker 배포 전에 전체 실행.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_catalog;
SELECT pg_advisory_xact_lock(hashtextextended('migration:profile-edit', 0));
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS ck_users_job_type;
ALTER TABLE public.users ADD CONSTRAINT ck_users_job_type CHECK (
  job_type IS NULL OR char_length(btrim(job_type)) BETWEEN 1 AND 20
);
COMMENT ON COLUMN public.users.job_type IS '선택 직종. trim 기준 1~20자 자유 문자열. 기존 직종 코드도 허용';

CREATE TABLE IF NOT EXISTS public.profile_image_cleanup_tasks (
  object_key text PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  storage_fingerprint char(64) NOT NULL,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text,
  CONSTRAINT ck_profile_image_cleanup_key CHECK (
    object_key ~ ('^(local|test|stage|center)/profiles/' || owner_user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
  ),
  CONSTRAINT ck_profile_image_cleanup_fingerprint CHECK (storage_fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_profile_image_cleanup_due
  ON public.profile_image_cleanup_tasks(next_attempt_at, owner_user_id);
COMMENT ON TABLE public.profile_image_cleanup_tasks IS '관리 이미지 교체/실패 정리 재시도. 업로드 전에 기록하고 DB commit으로 현재 key 작업 취소. 탈퇴 후에도 정리하도록 논리 소유자 참조만 유지. 성공 시 즉시 행 삭제';
COMMIT;

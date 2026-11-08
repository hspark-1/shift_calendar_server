-- 백업과 대상 DB 확인 후 API/worker 배포 전에 실행한다. 재실행 가능.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_image_key text;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS ck_users_profile_image_key;
ALTER TABLE public.users ADD CONSTRAINT ck_users_profile_image_key CHECK (
  profile_image_key IS NULL OR profile_image_key ~ (
    '^(local|test|stage|center)/profiles/' || user_id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
  )
);
COMMENT ON COLUMN public.users.profile_image_key IS
  '비공개 관리 프로필 이미지의 소유자별 객체 key. API 응답에 포함하지 않음';
COMMIT;

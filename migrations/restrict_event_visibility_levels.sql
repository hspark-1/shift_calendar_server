-- 개인 일정은1~5, 친구 레벨0은 근무표만 열람한다.
-- 기존 private/시간/ID/소유자 및 근무표/친구 레벨은 보존한다.
-- 0→1은 노출을 줄이는 보정이므로 다운 migration에서0으로 되돌리지 않는다.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.events IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.events WHERE visibility_level < 0 OR visibility_level > 5) THEN
    RAISE EXCEPTION 'event visibility preflight: unexpected levels outside 0..5';
  END IF;
END;
$$;
UPDATE public.events SET visibility_level = 1 WHERE visibility_level = 0;
ALTER TABLE public.events ALTER COLUMN visibility_level SET DEFAULT 1;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS ck_events_visibility;
ALTER TABLE public.events ADD CONSTRAINT ck_events_visibility CHECK (visibility_level BETWEEN 1 AND 5);
COMMENT ON COLUMN public.events.visibility_level IS '개인 일정 공개 레벨1~5, 기본1. 친구 레벨0은 근무표만 열람';
COMMIT;

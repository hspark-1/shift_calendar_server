-- Existing deployments only. Run once and record the migration externally.
-- Never remove this filter or column once private rows exist.
BEGIN;
LOCK TABLE public.events IN ACCESS EXCLUSIVE MODE;

-- CREATE OR REPLACE must preserve all existing view names, types and positions.
-- Abort on drift; inspect pg_get_viewdef and dependencies before adapting this SQL.
DO $$
DECLARE
  actual_columns text[];
  actual_types text[];
BEGIN
  SELECT array_agg(attname::text ORDER BY attnum),
         array_agg(format_type(atttypid, atttypmod) ORDER BY attnum)
    INTO actual_columns, actual_types
  FROM pg_attribute
  WHERE attrelid = 'public.v_visible_events_for_friend'::regclass
    AND attnum > 0 AND NOT attisdropped;

  IF actual_columns IS DISTINCT FROM ARRAY[
    'event_id', 'owner_user_id', 'created_by_user_id',
    'title', 'memo', 'place', 'all_day', 'start_at', 'end_at',
    'visibility_level', 'created_at', 'updated_at',
    'deleted_at', 'deleted_by_user_id', 'viewer_user_id'
  ]::text[] OR actual_types IS DISTINCT FROM ARRAY[
    'uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'boolean',
    'timestamp with time zone', 'timestamp with time zone', 'smallint',
    'timestamp with time zone', 'timestamp with time zone',
    'timestamp with time zone', 'uuid', 'uuid'
  ]::text[] THEN
    RAISE EXCEPTION 'event privacy preflight: unexpected view columns/types/order';
  END IF;
END;
$$;

ALTER TABLE public.events
  ADD COLUMN is_private boolean NOT NULL DEFAULT false;
COMMENT ON TABLE public.events IS '개인 일정. 타인 노출: is_private=false AND 친구 관계 AND can_view=true AND friend_level>=visibility_level';
COMMENT ON COLUMN public.events.is_private IS
  'true면 소유자만 조회 가능. 친구 레벨/열람/그룹보다 우선';

CREATE OR REPLACE VIEW public.v_visible_events_for_friend AS
SELECT
  e.event_id, e.owner_user_id, e.created_by_user_id,
  e.title, e.memo, e.place, e.all_day, e.start_at, e.end_at,
  e.visibility_level, e.created_at, e.updated_at,
  e.deleted_at, e.deleted_by_user_id,
  fls.friend_user_id AS viewer_user_id,
  e.is_private
FROM public.events e
JOIN public.friend_level_settings fls
  ON fls.owner_user_id = e.owner_user_id
 AND fls.can_view = true
WHERE e.deleted_at IS NULL
  AND e.is_private = false
  AND EXISTS (
    SELECT 1
    FROM public.friendships f
    WHERE f.user_id_a = LEAST(e.owner_user_id, fls.friend_user_id)
      AND f.user_id_b = GREATEST(e.owner_user_id, fls.friend_user_id)
  )
  AND fls.friend_level >= e.visibility_level;
COMMIT;

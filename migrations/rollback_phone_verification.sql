-- Only after stopping all consumers and reviewing retained proofs/receipts.
-- Forward recovery is required after enforcement; this is NOT an auth bypass plan.
BEGIN;
DO $$
BEGIN
  IF current_setting('shiftmate.phone_rollback_confirmed', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'PHONE_ROLLBACK_REQUIRES_STOPPED_CONSUMERS_AND_EXPLICIT_CONFIRMATION';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profile_mutation_receipts)
    OR EXISTS (SELECT 1 FROM public.phone_verification_events)
    OR EXISTS (SELECT 1 FROM public.phone_verifications WHERE verified_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.users WHERE phone_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'PHONE_VERIFICATION_DATA_PRESENT_FORWARD_RECOVERY_REQUIRED';
  END IF;
END;
$$;
DROP TABLE IF EXISTS public.profile_mutation_receipts;
DROP TABLE IF EXISTS public.phone_verifications;
DROP TABLE IF EXISTS public.phone_verification_events;
DROP TABLE IF EXISTS public.phone_verification_rate_limits;
ALTER TABLE public.users DROP COLUMN IF EXISTS phone_verified_at;
ALTER TABLE public.users DROP COLUMN IF EXISTS phone_verification_generation;
COMMIT;

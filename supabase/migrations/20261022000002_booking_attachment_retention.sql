-- Retain issue photos for 30 days, then remove them through the Storage API.
-- Chat attachments are not in booking_attachments and are intentionally excluded.

CREATE INDEX IF NOT EXISTS booking_attachments_retention_idx
  ON public.booking_attachments (created_at, id);

DO $$
DECLARE
  existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'cleanup-booking-attachments-daily'
  LIMIT 1;

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;

  PERFORM cron.schedule(
    'cleanup-booking-attachments-daily',
    '15 3 * * *',
    $job$SELECT net.http_post(
      url := 'https://ojivulfurjjsskqzghfb.supabase.co/functions/v1/cleanup-booking-attachments',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cleanup-token', 'HOME_CLEANUP_20261022_9f5f2d6f7f2e4f5d9d4e3c2b1a0f8e7d'
      ),
      body := '{}'::jsonb
    );$job$
  );
END $$;

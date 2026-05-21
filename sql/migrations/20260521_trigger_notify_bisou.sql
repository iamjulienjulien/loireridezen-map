-- LRZ-EVO-37 — Notification Pushover via Edge Function sur INSERT bisou

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.trigger_notify_bisou()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  request_id BIGINT;
  function_url TEXT := 'https://covxsekavbmeqysdqnjh.supabase.co/functions/v1/notify-bisou';
BEGIN
  SELECT INTO request_id net.http_post(
    url := function_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('record', row_to_json(NEW))::jsonb,
    timeout_milliseconds := 5000
  );

  RAISE NOTICE 'notify_bisou triggered, request_id=%', request_id;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'notify_bisou trigger failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

CREATE TRIGGER notify_bisou_after_insert
AFTER INSERT ON public.bisous
FOR EACH ROW
EXECUTE FUNCTION public.trigger_notify_bisou();

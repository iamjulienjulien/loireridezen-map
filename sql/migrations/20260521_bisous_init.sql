-- LRZ-EVO-36 — Journal des bisous envoyés depuis la vue for=elle
CREATE TABLE public.bisous (
  id BIGSERIAL PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bisous_sent_at ON public.bisous (sent_at DESC);

ALTER TABLE public.bisous ENABLE ROW LEVEL SECURITY;

-- Pas de SELECT public — Julien consulte directement via le dashboard Supabase

CREATE OR REPLACE FUNCTION public.send_bisou()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_id BIGINT;
BEGIN
  INSERT INTO public.bisous DEFAULT VALUES
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_bisou() TO anon, authenticated;

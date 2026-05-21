-- LRZ-EVO-33 — Compteur de visites cyclonautes
-- Table + RLS + RPC get_visit_count + RPC increment_visit_count

CREATE TABLE public.visit_counter (
  id INTEGER PRIMARY KEY DEFAULT 1,
  count BIGINT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_visit_at TIMESTAMPTZ,
  CHECK (id = 1)
);

INSERT INTO public.visit_counter (id, count) VALUES (1, 0);

ALTER TABLE public.visit_counter ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visit_counter_select_anon"
  ON public.visit_counter FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.get_visit_count()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT count FROM public.visit_counter WHERE id = 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_visit_count() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.increment_visit_count()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_count BIGINT;
BEGIN
  UPDATE public.visit_counter
     SET count = count + 1,
         last_visit_at = NOW()
   WHERE id = 1
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_visit_count() TO anon, authenticated;

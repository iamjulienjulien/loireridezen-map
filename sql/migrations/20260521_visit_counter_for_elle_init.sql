-- LRZ-EVO-35 — Compteur de visites dédié à la vue for=elle
CREATE TABLE public.visit_counter_for_elle (
  id BOOLEAN PRIMARY KEY DEFAULT true,
  count BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT visit_counter_for_elle_single_row CHECK (id = true)
);

INSERT INTO public.visit_counter_for_elle DEFAULT VALUES;

ALTER TABLE public.visit_counter_for_elle ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_visit_count_for_elle()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT count FROM public.visit_counter_for_elle LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.increment_visit_count_for_elle()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_count BIGINT;
BEGIN
  UPDATE public.visit_counter_for_elle SET count = count + 1
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_visit_count_for_elle() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_visit_count_for_elle() TO anon, authenticated;

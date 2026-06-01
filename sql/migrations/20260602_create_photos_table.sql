-- LRZ-EVO-72 : Création table photos + categories text[] + index GIN
-- Annule aussi l'ajout erroné de categories sur pois (20260601_add_pois_categories.sql)

-- 1. Retirer categories de pois (ajoutée dans la migration précédente — était sur la mauvaise table)
ALTER TABLE public.pois DROP COLUMN IF EXISTS categories;
DROP INDEX IF EXISTS idx_pois_categories;

-- 2. Créer la table photos
CREATE TABLE public.photos (
  id          text PRIMARY KEY,
  label       text NOT NULL DEFAULT '',
  description text,
  "order"     integer,
  "group"     text,
  time        text,
  lat         double precision,
  lon         double precision,
  thumb       text,
  image       text,
  poi_id      uuid REFERENCES public.pois(id) ON DELETE SET NULL,
  categories  text[] NOT NULL DEFAULT '{}'
);

-- 3. Index GIN pour requêtes && et @> par catégorie
CREATE INDEX idx_photos_categories ON public.photos USING GIN (categories);

-- 4. RLS — lecture publique (comme pois)
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON public.photos FOR SELECT USING (true);

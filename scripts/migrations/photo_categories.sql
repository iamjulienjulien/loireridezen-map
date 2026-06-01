-- LRZ-EVO-72 : Ajout colonne categories text[] sur la table photos
-- Idempotent : peut être relancé sans effet de bord

-- 1. Ajouter la colonne si elle n'existe pas encore
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';

-- 2. Index GIN pour requêtes @> et && performantes
CREATE INDEX IF NOT EXISTS idx_photos_categories
  ON photos USING GIN (categories);

-- Vérification post-migration :
-- SELECT COUNT(*) FROM photos WHERE categories = '{}';  -- → toutes (avant catégorisation)
-- SELECT COUNT(*) FROM photos WHERE categories != '{}'; -- → 0 (avant catégorisation)

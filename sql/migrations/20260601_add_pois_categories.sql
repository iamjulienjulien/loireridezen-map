-- LRZ-EVO-72 : Catégories photos — colonne sur la table pois
-- Les photos sont des POI de type 'photo' dans la table pois.
-- Idempotent : peut être relancé sans effet de bord.

ALTER TABLE pois
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_pois_categories
  ON pois USING GIN (categories);

COMMENT ON COLUMN pois.categories IS
  'Sous-catégories thématiques (photos). Valeurs valides : voir PHOTO_CATEGORY_GROUPS dans app/carnets/registry.js';

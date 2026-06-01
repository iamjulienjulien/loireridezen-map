-- LRZ-EVO-73 : 16 nouveaux types de POI
-- Étend la CHECK constraint de la colonne pois.type.
-- Les types existants (avec leurs vrais noms en BDD) sont conservés.

ALTER TABLE public.pois DROP CONSTRAINT IF EXISTS pois_type_check;

ALTER TABLE public.pois ADD CONSTRAINT pois_type_check CHECK (
  type IN (
    -- 9 existants (noms réels en BDD)
    'chateau', 'vigneron', 'nature', 'coupdecoeur',
    'patrimoine', 'guinguette', 'hébergement',
    'photo', 'lapin',
    -- types hérités (contrainte précédente, pas d'instances actuelles)
    'paysage', 'départ', 'arrivée',
    -- 16 nouveaux
    'abbaye', 'restaurant', 'bar_cafe', 'bivouac',
    'site_historique', 'vestige_archeo', 'point_eau',
    'service_velo', 'gare_velo', 'sandbank', 'point_vue',
    'spot_faune', 'depart_sentier', 'cave_troglodyte',
    'marche_producteur', 'producteur_fermier'
  )
);

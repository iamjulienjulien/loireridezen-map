-- Migration LRZ-EVO-23 : type chateau + colonnes photo_path, visited, construction_date

-- 1. Nouvelles colonnes
ALTER TABLE public.pois
  ADD COLUMN IF NOT EXISTS photo_path        TEXT    NULL,
  ADD COLUMN IF NOT EXISTS visited           BOOLEAN NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS construction_date TEXT    NULL;

-- 2. Mise à jour du CHECK pour inclure 'chateau'
ALTER TABLE public.pois
  DROP CONSTRAINT IF EXISTS pois_type_check;

ALTER TABLE public.pois
  ADD CONSTRAINT pois_type_check CHECK (
    type = ANY (ARRAY[
      'paysage', 'patrimoine', 'guinguette', 'hébergement',
      'départ', 'arrivée', 'photo', 'coupdecoeur', 'chateau'
    ])
  );

-- 3. Mise à jour de la RPC pois_bbox_geojson pour exposer les nouvelles colonnes
CREATE OR REPLACE FUNCTION public.pois_bbox_geojson(
  minlon double precision,
  minlat double precision,
  maxlon double precision,
  maxlat double precision,
  p_type text DEFAULT NULL,
  p_stage integer DEFAULT NULL
) RETURNS jsonb
  LANGUAGE sql STABLE
  SET search_path TO 'public', 'pg_temp'
AS $$
  WITH f AS (
    SELECT jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(geom)::jsonb,
      'properties', jsonb_build_object(
        'id', id,
        'name', name,
        'type', type,
        'stage', stage,
        'description', COALESCE(description, ''),
        'url', url,
        'url_insta', url_insta,
        'image', image,
        'thumb', thumb,
        'photo_path', photo_path,
        'visited', visited,
        'construction_date', construction_date
      )
    ) AS feature
    FROM public.pois
    WHERE ST_Intersects(
      geom,
      ST_MakeEnvelope(minlon, minlat, maxlon, maxlat, 4326)
    )
    AND (p_type  IS NULL OR type  = p_type)
    AND (p_stage IS NULL OR stage = p_stage)
  )
  SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
  )
  FROM f;
$$;

-- 4. Seed des châteaux (9 visités acte-2 + 7 à confirmer)
INSERT INTO public.pois (name, type, description, visited, construction_date, photo_path, geom)
VALUES
  -- Acte 2 — visités
  ('Château de Chambord',    'chateau', 'Le plus emblématique des châteaux de la Loire, chef-d''œuvre de la Renaissance française.', true,  '1519–1547',   'data/thumbs/01-chambord.webp',       ST_SetSRID(ST_MakePoint(1.5171,  47.6160), 4326)),
  ('Château d''Amboise',     'chateau', 'Demeure royale qui domine la Loire et le bourg d''Amboise.',                                  true,  'XVe siècle',  NULL,                                 ST_SetSRID(ST_MakePoint(0.9847,  47.4133), 4326)),
  ('Château de Chenonceau',  'chateau', 'Le château des dames, suspendu au-dessus du Cher.',                                          true,  '1514–1522',   'data/thumbs/05-chenonceau.webp',     ST_SetSRID(ST_MakePoint(1.0702,  47.3240), 4326)),
  ('Château de Villandry',   'chateau', 'Célèbre pour ses jardins Renaissance extraordinaires.',                                      true,  '1532',        'data/thumbs/08-villandry.webp',      ST_SetSRID(ST_MakePoint(0.5143,  47.3403), 4326)),
  ('Château de Chinon',      'chateau', 'Forteresse royale où Jeanne d''Arc rencontra le roi Charles VII.',                           true,  'XIIe siècle', 'data/thumbs/11-chinon.webp',         ST_SetSRID(ST_MakePoint(0.2379,  47.1640), 4326)),
  ('Abbaye de Fontevraud',   'chateau', 'La plus grande abbaye médiévale d''Europe, nécropole des Plantagenêts.',                     true,  'XIIe siècle', 'data/thumbs/12-fontevraud.webp',     ST_SetSRID(ST_MakePoint(0.0516,  47.1811), 4326)),
  ('Château de Montsoreau',  'chateau', 'Château gothique à la confluence de la Loire et de la Vienne.',                             true,  '1443–1453',   NULL,                                 ST_SetSRID(ST_MakePoint(-0.0628, 47.2157), 4326)),
  ('Château de Saumur',      'chateau', 'Forteresse médiévale dominant la Loire, symbole de l''Anjou.',                              true,  'XIVe siècle', 'data/thumbs/13-saumur.webp',         ST_SetSRID(ST_MakePoint(-0.0727, 47.2601), 4326)),
  ('Château d''Angers',      'chateau', 'Forteresse du XIIIe siècle abritant la tenture de l''Apocalypse.',                          true,  '1230–1240',   'data/thumbs/16-angers.webp',         ST_SetSRID(ST_MakePoint(-0.5554, 47.4686), 4326)),
  -- À confirmer
  ('Château de Sully-sur-Loire', 'chateau', 'Château médiéval ceint de douves, ancienne résidence de Sully.',  false, 'XIVe siècle', NULL, ST_SetSRID(ST_MakePoint(2.3742,  47.7744), 4326)),
  ('Château de Meung-sur-Loire', 'chateau', 'Résidence des évêques d''Orléans pendant sept siècles.',          false, 'XIIe siècle', NULL, ST_SetSRID(ST_MakePoint(1.6956,  47.8265), 4326)),
  ('Château de Beaugency',       'chateau', 'Tour médiévale dominant la Loire au cœur du bourg.',              false, 'XIe siècle',  NULL, ST_SetSRID(ST_MakePoint(1.6341,  47.7773), 4326)),
  ('Château de Cheverny',        'chateau', 'Chef-d''œuvre du classicisme français, inspiration de Moulinsart.', false, '1624–1634', NULL, ST_SetSRID(ST_MakePoint(1.4582,  47.5003), 4326)),
  ('Château de Chaumont',        'chateau', 'Château Renaissance perché sur un éperon rocheux dominant la Loire.', false, '1465–1510', NULL, ST_SetSRID(ST_MakePoint(1.1833,  47.4793), 4326)),
  ('Château de Loches',          'chateau', 'Cité royale médiévale remarquablement préservée en Touraine.',   false, 'XIe siècle',  NULL, ST_SetSRID(ST_MakePoint(1.0004,  47.1284), 4326)),
  ('Château de Valençay',        'chateau', 'Château Renaissance appartenu à Talleyrand, entouré d''un vaste parc.', false, '1540', NULL, ST_SetSRID(ST_MakePoint(1.5620,  47.1572), 4326))
ON CONFLICT DO NOTHING;

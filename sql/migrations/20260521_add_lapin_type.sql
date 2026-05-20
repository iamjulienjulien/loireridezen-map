-- Migration LRZ-EVO-25 : type lapin (layer caché activable par ?for=elle)

-- 1. Mise à jour du CHECK pour inclure 'lapin'
ALTER TABLE public.pois
  DROP CONSTRAINT IF EXISTS pois_type_check;

ALTER TABLE public.pois
  ADD CONSTRAINT pois_type_check CHECK (
    type = ANY (ARRAY[
      'paysage', 'patrimoine', 'guinguette', 'hébergement',
      'départ', 'arrivée', 'photo', 'coupdecoeur', 'chateau', 'lapin'
    ])
  );

-- 2. Mise à jour de la RPC pois_bbox_geojson : filtre p_allowed_types[]
--    Sans ce paramètre (NULL), tous les types sont retournés.
--    Avec le tableau, seuls les types listés sont exposés — évite de leaker
--    les POI lapin aux visiteurs sans le param ?for=elle.
CREATE OR REPLACE FUNCTION public.pois_bbox_geojson(
  minlon double precision,
  minlat double precision,
  maxlon double precision,
  maxlat double precision,
  p_type text DEFAULT NULL,
  p_stage integer DEFAULT NULL,
  p_allowed_types text[] DEFAULT NULL
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
    AND (p_type         IS NULL OR type  = p_type)
    AND (p_stage        IS NULL OR stage = p_stage)
    AND (p_allowed_types IS NULL OR type = ANY(p_allowed_types))
  )
  SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
  )
  FROM f;
$$;

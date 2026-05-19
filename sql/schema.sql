

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."pois_bbox_geojson"("minlon" double precision, "minlat" double precision, "maxlon" double precision, "maxlat" double precision, "p_type" "text" DEFAULT NULL::"text", "p_stage" integer DEFAULT NULL::integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with f as (
    select jsonb_build_object(
      'type','Feature',
      'geometry', ST_AsGeoJSON(geom)::jsonb,
      'properties', jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'stage', stage,
        'description', coalesce(description,''), 'url', url, 'url_insta', url_insta,
        'image', image, 'thumb', thumb
      )
    ) as feature
    from public.pois
    where ST_Intersects(
      geom,
      ST_MakeEnvelope(minlon, minlat, maxlon, maxlat, 4326)
    )
    and (p_type  is null or type  = p_type)
    and (p_stage is null or stage = p_stage)
  )
  select jsonb_build_object('type','FeatureCollection','features', coalesce(jsonb_agg(feature), '[]'::jsonb))
  from f;
$$;


ALTER FUNCTION "public"."pois_bbox_geojson"("minlon" double precision, "minlat" double precision, "maxlon" double precision, "maxlat" double precision, "p_type" "text", "p_stage" integer) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."pois" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text",
    "stage" integer,
    "description" "text",
    "url" "text",
    "url_insta" "text",
    "image" "text",
    "thumb" "text",
    "geom" "public"."geometry"(Point,4326) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "pois_type_check" CHECK (("type" = ANY (ARRAY['paysage'::"text", 'patrimoine'::"text", 'guinguette'::"text", 'hébergement'::"text", 'départ'::"text", 'arrivée'::"text", 'photo'::"text", 'coupdecoeur'::"text"])))
);


ALTER TABLE "public"."pois" OWNER TO "postgres";


ALTER TABLE ONLY "public"."pois"
    ADD CONSTRAINT "pois_pkey" PRIMARY KEY ("id");



CREATE INDEX "pois_gix" ON "public"."pois" USING "gist" ("geom");



CREATE INDEX "pois_stage_idx" ON "public"."pois" USING "btree" ("stage");



CREATE INDEX "pois_type_idx" ON "public"."pois" USING "btree" ("type");



ALTER TABLE "public"."pois" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read_pois_public" ON "public"."pois" FOR SELECT USING (true);



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."pois_bbox_geojson"("minlon" double precision, "minlat" double precision, "maxlon" double precision, "maxlat" double precision, "p_type" "text", "p_stage" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."pois_bbox_geojson"("minlon" double precision, "minlat" double precision, "maxlon" double precision, "maxlat" double precision, "p_type" "text", "p_stage" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pois_bbox_geojson"("minlon" double precision, "minlat" double precision, "maxlon" double precision, "maxlat" double precision, "p_type" "text", "p_stage" integer) TO "service_role";



GRANT ALL ON TABLE "public"."pois" TO "service_role";
GRANT SELECT ON TABLE "public"."pois" TO "anon";
GRANT SELECT ON TABLE "public"."pois" TO "authenticated";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







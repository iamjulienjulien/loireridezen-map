"""
One-shot migration: données existantes → architecture catalog.

Fichiers d'entrée :
  data/route.geojson                  9 étapes Acte 2 (stage 0-8)
  data/route_simplified.geojson       idem, version Douglas-Peucker
  data/route-acte1.geojson            Acte 1
  data/route_boucle_angevine.geojson  Boucle Angevine
  data/pois/pois.geojson              36 POI snapshot Supabase
  data/pois/pois_photos.geojson       photos terrain

Fichiers produits :
  data/traces/etape-{00-08}.geojson
  data/traces/etape-{00-08}_simplified.geojson
  data/traces/acte-1.geojson
  data/traces/boucle-angevine.geojson
  data/catalog/groups.json
  data/catalog/traces.json
  data/catalog/photos.json
  data/catalog/pois.json
"""

import argparse
import json
import os
import sys


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO_ROOT, "data")

INPUT = {
    "route": os.path.join(DATA, "route.geojson"),
    "route_simplified": os.path.join(DATA, "route_simplified.geojson"),
    "acte1": os.path.join(DATA, "route-acte1.geojson"),
    "boucle": os.path.join(DATA, "route_boucle_angevine.geojson"),
    "pois": os.path.join(DATA, "pois", "pois.geojson"),
    "photos": os.path.join(DATA, "pois", "pois_photos.geojson"),
}

TRACES_DIR = os.path.join(DATA, "traces")
CATALOG_DIR = os.path.join(DATA, "catalog")

# ---------------------------------------------------------------------------
# Stage metadata (Acte 2)
# ---------------------------------------------------------------------------

STAGES = {
    0: {"departure": "blois", "arrival": "chambord", "label": "Blois ↔ Chambord"},
    1: {"departure": "blois", "arrival": "amboise", "label": "Blois → Amboise"},
    2: {"departure": "amboise", "arrival": "chenonceaux", "label": "Amboise → Chenonceaux"},
    3: {"departure": "chenonceaux", "arrival": "tours", "label": "Chenonceaux → Tours"},
    4: {"departure": "tours", "arrival": "villandry", "label": "Tours → Villandry"},
    5: {"departure": "villandry", "arrival": "chinon", "label": "Villandry → Chinon"},
    6: {"departure": "chinon", "arrival": "montsoreau", "label": "Chinon → Montsoreau"},
    7: {"departure": "montsoreau", "arrival": "saumur", "label": "Montsoreau → Saumur"},
    8: {"departure": "saumur", "arrival": "angers", "label": "Saumur → Angers"},
}

GROUPS_DATA = [
    {"id": "acte-1", "label": "Acte 1"},
    {"id": "acte-2", "label": "Acte 2 — Blois → Angers"},
    {"id": "acte-3", "label": "Acte 3"},
    {"id": "micro-aventure", "label": "Micro-aventure"},
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_geojson(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data, dry_run, verbose, label):
    if dry_run:
        print(f"  [dry-run] would write {os.path.relpath(path, REPO_ROOT)}")
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    if verbose:
        print(f"  wrote {os.path.relpath(path, REPO_ROOT)}  ({label})")


def should_skip(path, force, verbose):
    if os.path.exists(path) and not force:
        if verbose:
            print(f"  skip (exists) {os.path.relpath(path, REPO_ROOT)}")
        return True
    return False


def stage_id(stage_num):
    s = STAGES[stage_num]
    return f"etape-{stage_num:02d}-{s['departure']}-{s['arrival']}"


# ---------------------------------------------------------------------------
# 1. Split route by stage
# ---------------------------------------------------------------------------

def split_route_by_stage(args):
    print("→ split_route_by_stage")
    route = load_geojson(INPUT["route"])
    route_simplified = load_geojson(INPUT["route_simplified"])

    by_stage = {f["properties"]["stage"]: f for f in route["features"]}
    by_stage_simplified = {f["properties"]["stage"]: f for f in route_simplified["features"]}

    for stage_num in range(9):
        full_path = os.path.join(TRACES_DIR, f"etape-{stage_num:02d}.geojson")
        simp_path = os.path.join(TRACES_DIR, f"etape-{stage_num:02d}_simplified.geojson")

        if not should_skip(full_path, args.force, args.verbose):
            feature = by_stage.get(stage_num)
            if feature is None:
                print(f"  WARNING: stage {stage_num} not found in route.geojson", file=sys.stderr)
                continue
            fc = {"type": "FeatureCollection", "features": [feature]}
            write_json(full_path, fc, args.dry_run, args.verbose, f"stage {stage_num} full")

        if not should_skip(simp_path, args.force, args.verbose):
            feature = by_stage_simplified.get(stage_num)
            if feature is None:
                print(f"  WARNING: stage {stage_num} not found in route_simplified.geojson", file=sys.stderr)
                continue
            fc = {"type": "FeatureCollection", "features": [feature]}
            write_json(simp_path, fc, args.dry_run, args.verbose, f"stage {stage_num} simplified")

    # acte-1
    acte1_out = os.path.join(TRACES_DIR, "acte-1.geojson")
    if not should_skip(acte1_out, args.force, args.verbose):
        write_json(acte1_out, load_geojson(INPUT["acte1"]), args.dry_run, args.verbose, "acte-1")

    # boucle-angevine
    boucle_out = os.path.join(TRACES_DIR, "boucle-angevine.geojson")
    if not should_skip(boucle_out, args.force, args.verbose):
        write_json(boucle_out, load_geojson(INPUT["boucle"]), args.dry_run, args.verbose, "boucle-angevine")


# ---------------------------------------------------------------------------
# 2. Build groups catalog
# ---------------------------------------------------------------------------

def build_groups_catalog(args):
    print("→ build_groups_catalog")
    out = os.path.join(CATALOG_DIR, "groups.json")
    if should_skip(out, args.force, args.verbose):
        return
    write_json(out, GROUPS_DATA, args.dry_run, args.verbose, f"{len(GROUPS_DATA)} groups")


# ---------------------------------------------------------------------------
# 3. Build traces catalog
# ---------------------------------------------------------------------------

def build_traces_catalog(args):
    print("→ build_traces_catalog")
    out = os.path.join(CATALOG_DIR, "traces.json")
    if should_skip(out, args.force, args.verbose):
        return

    entries = []

    # Acte 2 stages
    for stage_num in range(9):
        s = STAGES[stage_num]
        tid = stage_id(stage_num)
        entries.append({
            "id": tid,
            "group_id": "acte-2",
            "label": s["label"],
            "stage": stage_num,
            "files": {
                "geojson": f"data/traces/etape-{stage_num:02d}.geojson",
                "simplified": f"data/traces/etape-{stage_num:02d}_simplified.geojson",
            },
        })

    # Acte 1
    entries.append({
        "id": "acte-1",
        "group_id": "acte-1",
        "label": "Acte 1",
        "files": {
            "geojson": "data/traces/acte-1.geojson",
        },
    })

    # Boucle Angevine
    entries.append({
        "id": "boucle-angevine",
        "group_id": "micro-aventure",
        "label": "Boucle Angevine",
        "files": {
            "geojson": "data/traces/boucle-angevine.geojson",
        },
    })

    write_json(out, entries, args.dry_run, args.verbose, f"{len(entries)} traces")


# ---------------------------------------------------------------------------
# 4. Build photos catalog
# ---------------------------------------------------------------------------

def build_photos_catalog(args):
    print("→ build_photos_catalog")
    out = os.path.join(CATALOG_DIR, "photos.json")
    if should_skip(out, args.force, args.verbose):
        return

    src = load_geojson(INPUT["photos"])
    entries = []
    for i, feature in enumerate(src["features"], start=1):
        p = feature["properties"]
        coords = feature["geometry"]["coordinates"]
        slug = p.get("name", f"photo-{i:02d}").lower().replace(" ", "-")
        entries.append({
            "id": f"photo-{slug}",
            "label": p.get("name", ""),
            "time": p.get("time", ""),
            "coordinates": coords,
            "paths": {
                "thumb": p.get("thumb", ""),
                "remote": p.get("image", ""),
            },
        })

    write_json(out, entries, args.dry_run, args.verbose, f"{len(entries)} photos")


# ---------------------------------------------------------------------------
# 5. Build POIs catalog
# ---------------------------------------------------------------------------

def build_pois_catalog(args):
    print("→ build_pois_catalog")
    out = os.path.join(CATALOG_DIR, "pois.json")
    if should_skip(out, args.force, args.verbose):
        return

    src = load_geojson(INPUT["pois"])
    entries = []
    for feature in src["features"]:
        p = feature["properties"]
        coords = feature["geometry"]["coordinates"]
        entries.append({
            "id": p.get("id", ""),
            "label": p.get("name", ""),
            "type": p.get("type", ""),
            "stage": p.get("stage"),
            "description": p.get("description", ""),
            "coordinates": coords,
        })

    write_json(out, entries, args.dry_run, args.verbose, f"{len(entries)} POIs")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def check_inputs():
    missing = [k for k, v in INPUT.items() if not os.path.exists(v)]
    if missing:
        for k in missing:
            print(f"ERROR: input file not found: {INPUT[k]}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Migration one-shot vers l'architecture catalog.")
    parser.add_argument("--force", action="store_true", help="Écraser les fichiers existants")
    parser.add_argument("--verbose", "-v", action="store_true", help="Logs détaillés")
    parser.add_argument("--dry-run", action="store_true", help="Simuler sans écrire")
    args = parser.parse_args()

    if args.dry_run:
        print("Mode dry-run : aucun fichier ne sera écrit.")

    check_inputs()

    os.makedirs(TRACES_DIR, exist_ok=True)
    os.makedirs(CATALOG_DIR, exist_ok=True)

    split_route_by_stage(args)
    build_groups_catalog(args)
    build_traces_catalog(args)
    build_photos_catalog(args)
    build_pois_catalog(args)

    print("Done.")


if __name__ == "__main__":
    main()

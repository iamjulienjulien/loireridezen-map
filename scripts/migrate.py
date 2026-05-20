"""
One-shot migration: données existantes → architecture catalog (LRZ-EVO-1).

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
from datetime import datetime, timezone
from pathlib import Path


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
    0: {"departure": "blois", "arrival": "chambord", "label": "Étape 0 — Blois ↔ Chambord"},
    1: {"departure": "blois", "arrival": "amboise", "label": "Étape 1 — Blois → Amboise"},
    2: {"departure": "amboise", "arrival": "chenonceaux", "label": "Étape 2 — Amboise → Chenonceaux"},
    3: {"departure": "chenonceaux", "arrival": "tours", "label": "Étape 3 — Chenonceaux → Tours"},
    4: {"departure": "tours", "arrival": "villandry", "label": "Étape 4 — Tours → Villandry"},
    5: {"departure": "villandry", "arrival": "chinon", "label": "Étape 5 — Villandry → Chinon"},
    6: {"departure": "chinon", "arrival": "montsoreau", "label": "Étape 6 — Chinon → Montsoreau"},
    7: {"departure": "montsoreau", "arrival": "saumur", "label": "Étape 7 — Montsoreau → Saumur"},
    8: {"departure": "saumur", "arrival": "angers", "label": "Étape 8 — Saumur → Angers"},
}

# Groupes complets per LRZ-EVO-1 spec
GROUPS_DATA = [
    {
        "id": "acte-1",
        "label": "Acte 1 — Paris → Blois",
        "description": "Voyage initiatique de 2018, hors compte Instagram.",
        "year": 2018,
        "unified": True,
        "color": "#34495E",
        "order": 1,
    },
    {
        "id": "acte-2",
        "label": "Acte 2 — Blois → Angers",
        "description": "Le voyage fondateur du projet, 8 étapes en juin 2025.",
        "year": 2025,
        "unified": False,
        "color": [
            "#2E86AB", "#1F77B4", "#5DADE2", "#9B59B6",
            "#E74C3C", "#F39C12", "#27AE60", "#16A085", "#34495E",
        ],
        "order": 2,
    },
    {
        "id": "acte-3",
        "label": "Acte 3 — Angers → Saint-Brévin",
        "description": "Bouclage symbolique au Serpent de Huang Yong Ping, mai 2026.",
        "year": 2026,
        "unified": False,
        "color": "fn:byStage",
        "order": 3,
    },
    {
        "id": "micro-aventure",
        "label": "Micro-aventures",
        "description": "Boucles locales autour d'Angers.",
        "unified": False,
        "color": "#FF7F00",
        "dashed": True,
        "order": 4,
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def write_catalog(path, items, extra=None, dry_run=False, verbose=False, label=""):
    """Write {updated_at, [extra fields], items} JSON catalog."""
    payload: dict = {"updated_at": now_iso()}
    if extra:
        payload.update(extra)
    payload["items"] = items
    write_json(path, payload, dry_run, verbose, label)


def should_skip(path, force, verbose):
    if os.path.exists(path) and not force:
        if verbose:
            print(f"  skip (exists) {os.path.relpath(path, REPO_ROOT)}")
        return True
    return False


def stage_id(stage_num):
    s = STAGES[stage_num]
    return f"etape-{stage_num:02d}-{s['departure']}-{s['arrival']}"


def exif_time_to_iso(time_str: str) -> str:
    """Convert '2025:06:06 14:22:09' (EXIF) to '2025-06-06T14:22:09'."""
    if not time_str:
        return ""
    try:
        date_part, time_part = time_str.split(" ", 1)
        return f"{date_part.replace(':', '-')}T{time_part}"
    except Exception:
        return time_str


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

    acte1_out = os.path.join(TRACES_DIR, "acte-1.geojson")
    if not should_skip(acte1_out, args.force, args.verbose):
        write_json(acte1_out, load_geojson(INPUT["acte1"]), args.dry_run, args.verbose, "acte-1")

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
    write_catalog(out, GROUPS_DATA, dry_run=args.dry_run, verbose=args.verbose,
                  label=f"{len(GROUPS_DATA)} groups")


# ---------------------------------------------------------------------------
# 3. Build traces catalog
# ---------------------------------------------------------------------------

def build_traces_catalog(args):
    print("→ build_traces_catalog")
    out = os.path.join(CATALOG_DIR, "traces.json")
    if should_skip(out, args.force, args.verbose):
        return

    entries = []

    # Acte 1 (unified single trace)
    entries.append({
        "id": "acte-1",
        "label": "Paris → Blois",
        "description": "Le voyage initiatique de 2018.",
        "group": "acte-1",
        "paths": {
            "full": "data/traces/acte-1.geojson",
        },
        "source": "sources/gpx/acte-1.gpx",
        "order": 1,
        "distance_km": None,
        "elevation_gain_m": None,
    })

    # Acte 2 stages (9 étapes)
    for stage_num in range(9):
        s = STAGES[stage_num]
        tid = stage_id(stage_num)
        entries.append({
            "id": tid,
            "label": s["label"],
            "group": "acte-2",
            "paths": {
                "full": f"data/traces/etape-{stage_num:02d}.geojson",
                "simplified": f"data/traces/etape-{stage_num:02d}_simplified.geojson",
            },
            "source": f"sources/gpx/{tid}.gpx",
            "order": stage_num + 1,
            "distance_km": None,
            "elevation_gain_m": None,
        })

    # Boucle Angevine (micro-aventure)
    entries.append({
        "id": "boucle-angevine",
        "label": "Boucle angevine",
        "description": "45 km de gravel autour d'Angers.",
        "group": "micro-aventure",
        "paths": {
            "full": "data/traces/boucle-angevine.geojson",
        },
        "source": "sources/gpx/boucle-angevine.gpx",
        "order": 1,
        "distance_km": None,
        "elevation_gain_m": None,
    })

    write_catalog(out, entries, dry_run=args.dry_run, verbose=args.verbose,
                  label=f"{len(entries)} traces")


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
        lon, lat = coords[0], coords[1]

        # Derive stem from thumb path: "./thumbs/01-chambord.webp" → "01-chambord"
        thumb_raw = p.get("thumb", "")
        stem = Path(thumb_raw).stem if thumb_raw else f"photo-{i:02d}"

        # Detect source extension from Supabase URL
        remote = p.get("image", "")
        ext = Path(remote.split("?")[0]).suffix if remote else ".jpeg"
        if not ext:
            ext = ".jpeg"

        entries.append({
            "id": stem,
            "label": p.get("name", ""),
            "description": "",
            "group": "acte-2",
            "paths": {
                "thumb": f"data/thumbs/{stem}.webp",
                "remote": remote,
            },
            "source": f"sources/photos/{stem}{ext}",
            "order": i,
            "time": exif_time_to_iso(p.get("time", "")),
            "lat": lat,
            "lon": lon,
        })

    write_catalog(out, entries, dry_run=args.dry_run, verbose=args.verbose,
                  label=f"{len(entries)} photos")


# ---------------------------------------------------------------------------
# 5. Build POIs catalog (light inventory, no coordinates/description)
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
        entries.append({
            "id": p.get("id", ""),
            "label": p.get("name", ""),
            "type": p.get("type", ""),
            "group": "acte-2",
            "stage": p.get("stage"),
        })

    extra = {"synced_from": "supabase", "count": len(entries)}
    write_catalog(out, entries, extra=extra, dry_run=args.dry_run, verbose=args.verbose,
                  label=f"{len(entries)} POIs")


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

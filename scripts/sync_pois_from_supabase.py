#!/usr/bin/env python3
"""
sync_pois_from_supabase.py — export les POI Supabase vers data/pois.geojson.

Régénère un snapshot fidèle de la table `public.pois` au format GeoJSON
RFC 7946. Utilise la RPC `pois_bbox_geojson` existante avec une BBOX
mondiale pour récupérer tous les POI en une seule requête.

Pas de dépendance externe : urllib seul (stdlib). Aucune entrée dans
`requirements.txt` à ajouter.

Usage :
    # Avec config.js déjà en place (recommandé en local)
    python sync_pois_from_supabase.py

    # Avec variables d'environnement (CI, scripts automatisés)
    SUPA_URL="https://...supabase.co" \\
    SUPA_PUBLISHABLE_KEY="sb_publishable_..." \\
    python sync_pois_from_supabase.py

    # Chemin de sortie custom
    python scripts/sync_pois_from_supabase.py -o data/pois/pois.geojson

    # Verbose
    python scripts/sync_pois_from_supabase.py -v

Workflow type :
    1. Éditer un POI dans la console Supabase (Table Editor)
    2. Lancer ce script localement
    3. git diff data/pois/pois.geojson pour vérifier les changements
    4. git commit + push → Vercel redéploie

Exit codes :
    0 — succès
    2 — credentials manquants (ni env vars, ni config.js)
    3 — erreur réseau ou API Supabase
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

# BBOX mondiale — englobe tout point possible sur Terre.
# La RPC pois_bbox_geojson filtre par ST_Intersects, donc retourne tous les POI.
WORLD_BBOX = {
    "minlon": -180.0,
    "minlat": -90.0,
    "maxlon": 180.0,
    "maxlat": 90.0,
}

# Tous les types POI connus — transmis via p_allowed_types (nouvelle signature RPC).
# Inclut lapin (type caché) pour un export complet.
ALL_POI_TYPES = [
    "chateau", "coupdecoeur", "patrimoine", "guinguette",
    "hébergement", "vigneron", "nature", "photo", "lapin",
]

logger = logging.getLogger("sync_pois")


def load_config_from_js(config_path: Path) -> dict[str, str]:
    """Parse minimaliste du fichier config.js pour extraire SUPA_URL et SUPA_PUBLISHABLE_KEY.

    Recherche les motifs `KEY: "value"` ou `KEY: 'value'` dans le fichier.
    Tolère les variations de formatage (espaces, point-virgules).
    """
    if not config_path.exists():
        return {}
    text = config_path.read_text(encoding="utf-8")
    config: dict[str, str] = {}
    for key in ("SUPA_URL", "SUPA_PUBLISHABLE_KEY"):
        match = re.search(rf"""{key}\s*:\s*['"]([^'"]+)['"]""", text)
        if match:
            config[key] = match.group(1)
    return config


def get_credentials() -> tuple[str, str]:
    """Récupère les credentials depuis les variables d'env (priorité), puis config.js."""
    supa_url = os.environ.get("SUPA_URL")
    supa_key = os.environ.get("SUPA_PUBLISHABLE_KEY")

    if not (supa_url and supa_key):
        config = load_config_from_js(Path("config.js"))
        supa_url = supa_url or config.get("SUPA_URL")
        supa_key = supa_key or config.get("SUPA_PUBLISHABLE_KEY")

    if not (supa_url and supa_key):
        logger.error(
            "SUPA_URL et SUPA_PUBLISHABLE_KEY introuvables.\n"
            "  Option 1 : export SUPA_URL=... && export SUPA_PUBLISHABLE_KEY=...\n"
            "  Option 2 : créer config.js à la racine depuis config.js.example"
        )
        sys.exit(2)

    return supa_url, supa_key


def fetch_pois(supa_url: str, supa_key: str, timeout: int = 30) -> dict:
    """Appelle la RPC pois_bbox_geojson avec une BBOX mondiale.

    Retourne un FeatureCollection GeoJSON RFC 7946.
    Exit code 3 en cas d'erreur HTTP, réseau ou réponse malformée.
    """
    rpc_url = f"{supa_url.rstrip('/')}/rest/v1/rpc/pois_bbox_geojson"
    payload = {**WORLD_BBOX, "p_allowed_types": ALL_POI_TYPES}
    body = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(
        rpc_url,
        data=body,
        headers={
            "apikey": supa_key,
            "Authorization": f"Bearer {supa_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    logger.debug("POST %s", rpc_url)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.load(response)
    except urllib.error.HTTPError as err:
        body_text = err.read().decode("utf-8", errors="replace")[:500]
        logger.error("HTTP %d %s\n  Détails : %s", err.code, err.reason, body_text)
        sys.exit(3)
    except urllib.error.URLError as err:
        logger.error("Erreur réseau : %s", err.reason)
        sys.exit(3)
    except json.JSONDecodeError as err:
        logger.error("Réponse non-JSON : %s", err)
        sys.exit(3)

    if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
        logger.error("Réponse inattendue (pas un FeatureCollection) : %r", data)
        sys.exit(3)

    return data


def sort_features(geojson: dict) -> dict:
    """Trie les features par stage puis par name pour des diffs git stables.

    Sans tri, l'ordre des POI peut varier entre deux exports (selon le plan
    d'exécution Postgres), ce qui pollue les diffs git.
    """
    features = geojson.get("features", [])
    features.sort(
        key=lambda f: (
            f.get("properties", {}).get("stage") or 0,
            (f.get("properties", {}).get("name") or "").lower(),
        )
    )
    geojson["features"] = features
    return geojson


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Export les POI Supabase en GeoJSON RFC 7946.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("data/pois/pois.geojson"),
        help="Chemin du fichier GeoJSON de sortie (défaut : data/pois/pois.geojson)",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="Indentation JSON (défaut : 2). Mettre 0 pour compact.",
    )
    parser.add_argument(
        "--no-sort",
        action="store_true",
        help="Ne pas trier les features (par défaut tri par stage puis name).",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="Timeout HTTP en secondes (défaut : 30).",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Logs détaillés."
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    supa_url, supa_key = get_credentials()
    logger.info("Connexion à %s", supa_url)

    geojson = fetch_pois(supa_url, supa_key, timeout=args.timeout)
    n_features = len(geojson.get("features", []))

    if n_features == 0:
        logger.warning(
            "Aucun POI récupéré. Vérifier les policies RLS et la validité de SUPA_PUBLISHABLE_KEY."
        )

    if not args.no_sort:
        geojson = sort_features(geojson)

    indent = args.indent if args.indent > 0 else None
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=indent)
        if indent is None:
            f.write("\n")

    logger.info("✓ %d POI exportés vers %s", n_features, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())

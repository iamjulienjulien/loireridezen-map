#!/usr/bin/env python3
"""
photos_to_poi.py — convertit des photos géotaguées en GeoJSON RFC 7946.

Lit les photos depuis **Supabase Storage** (par défaut) ou un dossier
local, extrait les coordonnées GPS et la date depuis les EXIF, et produit
un FeatureCollection prêt à être chargé dans Leaflet.

Cf. ticket LRZ-QA-10 — externaliser les photos JPEG originales hors du
repo git, vers Supabase Storage. Les miniatures WebP restent locales
dans `data/thumbs/` (5.2 MB total, OK à versionner).

Modes d'exécution
-----------------
1. **Supabase Storage** (défaut) — liste le bucket, télécharge chaque
   photo en mémoire, extrait l'EXIF. Reproductible depuis n'importe
   quelle machine, sans copie locale des originaux.

2. **Local** (`--local-photos PATH`) — lit les EXIF depuis un dossier
   local mais génère quand même des URLs Supabase pour `image`. Plus
   rapide si les photos sont déjà sur le disque.

Dépendances (toutes dans requirements.txt) :
    Pillow, pillow-heif (HEIC), exifread (fallback)

Credentials Supabase :
    Mêmes sources que `sync_pois_from_supabase.py` :
    1. Variables d'env SUPA_URL et SUPA_PUBLISHABLE_KEY (priorité)
    2. Fichier config.js à la racine (fallback)

Usage
-----
    # Mode Supabase Storage (lit le bucket "photos" du projet)
    python photos_to_poi.py

    # Bucket et output custom
    python scripts/photos_to_poi.py --bucket photos --out data/pois/pois_photos.geojson

    # Mode local (EXIF lus en local, URLs Supabase générées)
    python scripts/photos_to_poi.py --local-photos sources/photos

    # Override de l'URL base (rare)
    python photos_to_poi.py \\
        --image-base https://xxx.supabase.co/storage/v1/object/public/photos

Exit codes :
    0 — succès
    2 — credentials manquants, dépendances manquantes, ou dossier introuvable
    3 — erreur réseau ou API Supabase
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

logger = logging.getLogger("photos_to_poi")

# Imports optionnels — au moins l'un des deux est nécessaire
try:
    from PIL import ExifTags, Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
    HEIF_AVAILABLE = True
except ImportError:
    HEIF_AVAILABLE = False

try:
    import exifread
    EXIFREAD_AVAILABLE = True
except ImportError:
    EXIFREAD_AVAILABLE = False


PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif"}

CATALOG_PHOTOS = Path(__file__).resolve().parent.parent / "data" / "catalog" / "photos.json"


def load_catalog_labels() -> dict[str, str]:
    """Retourne un dict {stem → label} depuis data/catalog/photos.json."""
    if not CATALOG_PHOTOS.exists():
        return {}
    with CATALOG_PHOTOS.open(encoding="utf-8") as f:
        data = json.load(f)
    return {item["id"]: item["label"] for item in data.get("items", []) if item.get("id") and item.get("label")}


# ───────────────────────────────────────────────────────────── Credentials


def load_config_from_js(config_path: Path) -> dict[str, str]:
    """Parse minimaliste de config.js pour extraire SUPA_URL et SUPA_PUBLISHABLE_KEY."""
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
    """Récupère SUPA_URL + SUPA_PUBLISHABLE_KEY (env vars, puis config.js)."""
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


# ────────────────────────────────────────────────────────── Supabase Storage


def list_storage_bucket(
    supa_url: str, supa_key: str, bucket: str, prefix: str = ""
) -> list[dict]:
    """Liste les objets d'un bucket Supabase Storage via l'API REST."""
    url = f"{supa_url.rstrip('/')}/storage/v1/object/list/{bucket}"
    body = json.dumps({
        "prefix": prefix,
        "limit": 1000,
        "offset": 0,
        "sortBy": {"column": "name", "order": "asc"},
    }).encode("utf-8")

    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "apikey": supa_key,
            "Authorization": f"Bearer {supa_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.load(response)
    except urllib.error.HTTPError as err:
        body_text = err.read().decode("utf-8", errors="replace")[:500]
        logger.error("HTTP %d %s\n  Détails : %s", err.code, err.reason, body_text)
        sys.exit(3)
    except urllib.error.URLError as err:
        logger.error("Erreur réseau : %s", err.reason)
        sys.exit(3)

    if not isinstance(data, list):
        logger.error("Réponse inattendue (pas une liste) : %r", data)
        sys.exit(3)

    # Filtre : seulement les fichiers photos (pas les markers de dossier)
    return [
        obj
        for obj in data
        if obj.get("name") and Path(obj["name"]).suffix.lower() in PHOTO_EXTENSIONS
    ]


def download_public_file(supa_url: str, bucket: str, path: str) -> bytes:
    """Télécharge un fichier depuis Supabase Storage (URL publique, sans auth).

    Retourne b'' en cas d'erreur (skip avec warning) plutôt que de planter.
    """
    url = f"{supa_url.rstrip('/')}/storage/v1/object/public/{bucket}/{path}"
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            return response.read()
    except urllib.error.HTTPError as err:
        logger.warning("Skip %s : HTTP %d %s", path, err.code, err.reason)
        return b""
    except urllib.error.URLError as err:
        logger.warning("Skip %s : %s", path, err.reason)
        return b""


# ─────────────────────────────────────────────────────────────── EXIF tools


def rational_to_float(value) -> float | None:
    """Convertit un EXIF rational (Pillow IFDRational, tuple, exifread Ratio) en float."""
    if value is None:
        return None
    try:
        return float(value[0]) / float(value[1])
    except (TypeError, ValueError, ZeroDivisionError, IndexError):
        pass
    try:
        return float(value.num) / float(value.den)
    except (AttributeError, ZeroDivisionError):
        pass
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def dms_to_decimal(dms, ref: str | None) -> float | None:
    """Convertit une coordonnée DMS (degrés, minutes, secondes) en décimal signé."""
    if not dms or len(dms) < 3:
        return None
    d = rational_to_float(dms[0])
    m = rational_to_float(dms[1])
    s = rational_to_float(dms[2])
    if d is None or m is None or s is None:
        return None
    decimal = d + m / 60.0 + s / 3600.0
    if ref and str(ref).upper().strip() in ("S", "W"):
        decimal = -decimal
    return decimal


def extract_gps_pil(image_bytes: bytes) -> dict:
    """Extrait GPS + DateTime via Pillow (JPEG, PNG, HEIC via pillow-heif)."""
    if not PIL_AVAILABLE:
        return {}
    try:
        img = Image.open(io.BytesIO(image_bytes))
        exif = img.getexif()
        if not exif:
            return {}

        # Tags top-level (DateTime…)
        top_tags = {ExifTags.TAGS.get(k, k): v for k, v in exif.items()}

        # Sub-IFD GPS
        try:
            gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo)
        except (KeyError, AttributeError):
            gps_ifd = {}
        gps_data = {ExifTags.GPSTAGS.get(k, k): v for k, v in (gps_ifd or {}).items()}

        lat = dms_to_decimal(
            gps_data.get("GPSLatitude"),
            gps_data.get("GPSLatitudeRef"),
        )
        lon = dms_to_decimal(
            gps_data.get("GPSLongitude"),
            gps_data.get("GPSLongitudeRef"),
        )

        # DateTimeOriginal n'est pas toujours dans le top-level — il vit dans le sub-IFD Exif
        try:
            exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
            exif_tags = {ExifTags.TAGS.get(k, k): v for k, v in (exif_ifd or {}).items()}
        except (KeyError, AttributeError):
            exif_tags = {}

        when = (
            exif_tags.get("DateTimeOriginal")
            or top_tags.get("DateTimeOriginal")
            or top_tags.get("DateTime")
        )
        if isinstance(when, bytes):
            when = when.decode("utf-8", errors="ignore")

        return {"lat": lat, "lon": lon, "time": when}
    except Exception as err:
        logger.debug("PIL EXIF extraction failed : %s", err)
        return {}


def extract_gps_exifread(image_bytes: bytes) -> dict:
    """Extrait GPS + DateTime via exifread (fallback)."""
    if not EXIFREAD_AVAILABLE:
        return {}
    try:
        tags = exifread.process_file(io.BytesIO(image_bytes), details=False)
        lat_dms = tags.get("GPS GPSLatitude")
        lon_dms = tags.get("GPS GPSLongitude")
        lat_ref = str(tags.get("GPS GPSLatitudeRef", ""))
        lon_ref = str(tags.get("GPS GPSLongitudeRef", ""))

        lat = dms_to_decimal(lat_dms.values if lat_dms else None, lat_ref)
        lon = dms_to_decimal(lon_dms.values if lon_dms else None, lon_ref)

        when = str(tags.get("EXIF DateTimeOriginal", "")) or None
        return {"lat": lat, "lon": lon, "time": when}
    except Exception as err:
        logger.debug("exifread EXIF extraction failed : %s", err)
        return {}


def extract_gps(image_bytes: bytes) -> dict:
    """Tente PIL d'abord, exifread en fallback."""
    info = extract_gps_pil(image_bytes)
    if info.get("lat") is None or info.get("lon") is None:
        fallback = extract_gps_exifread(image_bytes)
        if fallback.get("lat") is not None and fallback.get("lon") is not None:
            return fallback
    return info


# ──────────────────────────────────────────────────────── Feature building


def build_feature(
    name: str,
    image_url: str,
    thumb_url: str,
    lat: float,
    lon: float,
    when: str | None,
) -> dict:
    """Construit un Feature GeoJSON RFC 7946 (Point WGS84)."""
    return {
        "type": "Feature",
        "properties": {
            "name": name,
            "type": "photo",
            "image": image_url,
            "thumb": thumb_url,
            "time": when,
        },
        "geometry": {
            "type": "Point",
            "coordinates": [round(lon, 6), round(lat, 6)],
        },
    }


def pretty_name(stem: str) -> str:
    """Transforme '01-chambord' ou 'IMG_4242_chenonceau' en nom lisible."""
    return stem.replace("_", " ").replace("-", " ").strip()


# ───────────────────────────────────────────────────────────────── Modes


def photos_from_supabase(
    supa_url: str,
    supa_key: str,
    bucket: str,
    image_base: str,
    thumb_prefix: str,
    catalog_labels: dict[str, str] | None = None,
) -> list[dict]:
    """Liste le bucket Supabase, télécharge chaque photo en mémoire, extrait EXIF."""
    logger.info("Liste du bucket '%s' sur %s", bucket, supa_url)
    objects = list_storage_bucket(supa_url, supa_key, bucket)
    logger.info("%d photo(s) dans le bucket", len(objects))

    features = []
    skipped_no_gps = 0
    skipped_dl_error = 0

    for obj in objects:
        name = obj["name"]
        logger.debug("Téléchargement %s", name)
        image_bytes = download_public_file(supa_url, bucket, name)
        if not image_bytes:
            skipped_dl_error += 1
            continue

        info = extract_gps(image_bytes)
        lat, lon = info.get("lat"), info.get("lon")
        if lat is None or lon is None:
            logger.debug("Skip %s : pas de GPS dans l'EXIF", name)
            skipped_no_gps += 1
            continue

        stem = Path(name).stem
        image_url = f"{image_base.rstrip('/')}/{name}"
        thumb_url = f"{thumb_prefix.rstrip('/')}/{stem}.webp"
        label = (catalog_labels or {}).get(stem) or pretty_name(stem)

        features.append(build_feature(
            label, image_url, thumb_url, lat, lon, info.get("time")
        ))

    if skipped_no_gps:
        logger.info("%d photo(s) ignorée(s) (pas de GPS EXIF)", skipped_no_gps)
    if skipped_dl_error:
        logger.warning("%d photo(s) ignorée(s) (erreur téléchargement)", skipped_dl_error)

    return features


def photos_from_local(
    photos_dir: Path,
    image_base: str,
    thumb_prefix: str,
    catalog_labels: dict[str, str] | None = None,
) -> list[dict]:
    """Lit les EXIF depuis un dossier local, génère les URLs configurées."""
    if not photos_dir.exists():
        logger.error("Dossier introuvable : %s", photos_dir)
        sys.exit(2)

    files = sorted(
        f for f in photos_dir.rglob("*")
        if f.is_file() and f.suffix.lower() in PHOTO_EXTENSIONS
    )
    logger.info("%d photo(s) trouvée(s) dans %s", len(files), photos_dir)

    features = []
    skipped_no_gps = 0

    for f in files:
        image_bytes = f.read_bytes()
        info = extract_gps(image_bytes)
        lat, lon = info.get("lat"), info.get("lon")
        if lat is None or lon is None:
            logger.debug("Skip %s : pas de GPS dans l'EXIF", f.name)
            skipped_no_gps += 1
            continue

        rel = f.relative_to(photos_dir).as_posix()
        stem = Path(rel).stem
        image_url = f"{image_base.rstrip('/')}/{rel}"
        thumb_url = f"{thumb_prefix.rstrip('/')}/{stem}.webp"
        label = (catalog_labels or {}).get(stem) or pretty_name(stem)

        features.append(build_feature(
            label, image_url, thumb_url, lat, lon, info.get("time")
        ))

    if skipped_no_gps:
        logger.info("%d photo(s) ignorée(s) (pas de GPS EXIF)", skipped_no_gps)

    return features


# ────────────────────────────────────────────────────────────────── Main


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Convertit des photos géotaguées en GeoJSON RFC 7946.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    # Mode
    parser.add_argument(
        "--bucket", default="photos",
        help="Bucket Supabase Storage à lister (défaut : photos).",
    )
    parser.add_argument(
        "--local-photos", type=Path, default=None, metavar="DIR",
        help="Lit les EXIF depuis ce dossier local au lieu de Supabase Storage. "
             "Les URLs `image` pointent quand même vers Supabase (sauf override --image-base).",
    )

    # Output
    parser.add_argument(
        "-o", "--out", type=Path, default=Path("data/pois/pois_photos.geojson"),
        help="Chemin du fichier GeoJSON de sortie (défaut : data/pois/pois_photos.geojson).",
    )
    parser.add_argument(
        "--indent", type=int, default=2,
        help="Indentation JSON (défaut : 2). 0 pour compact.",
    )

    # URLs
    parser.add_argument(
        "--image-base", default=None,
        help="URL préfixe pour les images. Défaut : déduit de SUPA_URL + --bucket "
             "(ex. https://xxx.supabase.co/storage/v1/object/public/photos).",
    )
    parser.add_argument(
        "--thumb-prefix", default="data/thumbs",
        help="Préfixe pour les miniatures (défaut : data/thumbs). "
             "Les thumbs restent locaux (cf. ticket LRZ-QA-10).",
    )

    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Logs détaillés.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    if not PIL_AVAILABLE and not EXIFREAD_AVAILABLE:
        logger.error(
            "Aucune lib d'extraction EXIF disponible. "
            "Installer : pip install -r requirements.txt"
        )
        return 2

    if not HEIF_AVAILABLE:
        logger.warning("pillow-heif non installé : les fichiers HEIC seront ignorés.")

    # Calcule l'image_base si non fourni
    image_base = args.image_base
    if not image_base:
        supa_url, _ = get_credentials()
        image_base = f"{supa_url.rstrip('/')}/storage/v1/object/public/{args.bucket}"
        logger.info("image_base auto : %s", image_base)

    catalog_labels = load_catalog_labels()
    if catalog_labels:
        logger.info("%d label(s) chargés depuis le catalogue photos", len(catalog_labels))

    # Aiguillage de mode
    if args.local_photos:
        features = photos_from_local(args.local_photos, image_base, args.thumb_prefix, catalog_labels)
    else:
        supa_url, supa_key = get_credentials()
        features = photos_from_supabase(
            supa_url, supa_key, args.bucket, image_base, args.thumb_prefix, catalog_labels
        )

    if not features:
        logger.warning("Aucun POI photo généré.")

    # Tri stable pour des diffs git propres : par time puis par name
    features.sort(
        key=lambda f: (
            f["properties"].get("time") or "",
            f["properties"].get("name") or "",
        )
    )

    geojson = {"type": "FeatureCollection", "features": features}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    indent = args.indent if args.indent > 0 else None
    with args.out.open("w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=indent)
        if indent is None:
            f.write("\n")

    logger.info("✓ %d POI photos exportés vers %s", len(features), args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
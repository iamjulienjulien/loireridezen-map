#!/usr/bin/env python3
"""
fetch_weather.py — Enrichit data/catalog/traces.json avec météo + phase lunaire.

Pour chaque étape avec une date, interroge Open-Meteo (archive) et calcule
la phase lunaire via la formule du Jour Julien.

Champs ajoutés/mis à jour dans chaque item :
  weather_code   int     Code WMO (0=clair, 3=couvert, 61=pluie légère, etc.)
  weather_desc   str     Description française du code WMO
  weather_emoji  str     Emoji correspondant
  temp_c         float   Température moyenne journalière (°C, 1 décimale)
  sunrise        str     Lever du soleil "HH:MM" (heure locale Europe/Paris)
  sunset         str     Coucher du soleil "HH:MM" (heure locale Europe/Paris)
  moon_phase     float   Phase lunaire 0.0–1.0 (0=nouvelle, 0.5=pleine)

Usage :
    python scripts/fetch_weather.py             # saute les étapes déjà renseignées
    python scripts/fetch_weather.py --force     # ré-écrit toutes les étapes
    python scripts/fetch_weather.py --dry-run   # prévisualise sans écrire
    python scripts/fetch_weather.py -v          # verbose

Exit codes :
    0 — succès complet
    1 — erreur lecture/écriture traces.json
    3 — au moins une étape n'a pas pu être mise à jour (erreur réseau)
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("fetch_weather")

WMO_LABELS: dict[int, tuple[str, str]] = {
    0: ("☀️", "Ciel dégagé"),
    1: ("🌤", "Peu nuageux"),
    2: ("⛅", "Partiellement nuageux"),
    3: ("☁️", "Couvert"),
    45: ("🌫", "Brouillard"),
    48: ("🌫", "Brouillard givrant"),
    51: ("🌦", "Bruine légère"),
    53: ("🌦", "Bruine modérée"),
    55: ("🌧", "Bruine dense"),
    56: ("🌧", "Bruine verglaçante légère"),
    57: ("🌧", "Bruine verglaçante dense"),
    61: ("🌧", "Pluie légère"),
    63: ("🌧", "Pluie modérée"),
    65: ("🌧", "Pluie forte"),
    66: ("🌧", "Pluie verglaçante légère"),
    67: ("🌧", "Pluie verglaçante forte"),
    71: ("❄️", "Neige légère"),
    73: ("❄️", "Neige modérée"),
    75: ("❄️", "Neige forte"),
    77: ("🌨", "Grains de neige"),
    80: ("🌦", "Averses légères"),
    81: ("🌧", "Averses modérées"),
    82: ("⛈", "Averses violentes"),
    85: ("🌨", "Averses de neige légères"),
    86: ("🌨", "Averses de neige fortes"),
    95: ("⛈", "Orage"),
    96: ("⛈", "Orage avec grêle"),
    99: ("⛈", "Orage violent avec grêle"),
}


def moon_phase(date_str: str) -> float:
    """Fraction 0.0–1.0 (0 = nouvelle lune, 0.5 = pleine lune)."""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    y, m, day = d.year, d.month, d.day
    if m <= 2:
        y -= 1
        m += 12
    A = y // 100
    B = 2 - A + A // 4
    jd = int(365.25 * (y + 4716)) + int(30.6001 * (m + 1)) + day + B - 1524.5
    known_new = 2451549.5  # Nouvelle lune du 6 jan 2000
    synodic = 29.53058770576
    phase = ((jd - known_new) % synodic) / synodic
    return round(phase, 3)


def get_trace_midpoint(paths: dict, base_dir: Path) -> tuple[float, float] | None:
    """Lit le GeoJSON de la trace et retourne le (lat, lon) du point médian."""
    path_key = paths.get("simplified") or paths.get("full")
    if not path_key:
        return None
    geojson_path = base_dir / path_key
    if not geojson_path.exists():
        logger.warning("Fichier trace introuvable : %s", geojson_path)
        return None
    try:
        data = json.loads(geojson_path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("Impossible de lire %s : %s", geojson_path, e)
        return None

    coords: list[list[float]] = []
    for feature in data.get("features", []):
        geom = feature.get("geometry", {})
        t = geom.get("type", "")
        if t == "LineString":
            coords.extend(geom.get("coordinates", []))
        elif t == "MultiLineString":
            for line in geom.get("coordinates", []):
                coords.extend(line)

    if not coords:
        return None
    mid = coords[len(coords) // 2]
    return mid[1], mid[0]  # lat, lon


def fetch_weather_archive(lat: float, lon: float, date: str, timeout: int = 30) -> dict | None:
    """Interroge l'API Open-Meteo archive pour une date et une position."""
    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={lat:.4f}&longitude={lon:.4f}"
        f"&start_date={date}&end_date={date}"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset"
        "&timezone=Europe%2FParis"
    )
    logger.debug("GET %s", url)
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        logger.warning("HTTP %d pour %s : %s", e.code, date, body)
    except urllib.error.URLError as e:
        logger.warning("Erreur réseau pour %s : %s", date, e.reason)
    except json.JSONDecodeError as e:
        logger.warning("Réponse non-JSON pour %s : %s", date, e)
    return None


def parse_hhmm(iso_str: str) -> str | None:
    """Extrait HH:MM depuis une chaîne ISO datetime (ex. '2018-06-09T05:42')."""
    if not iso_str:
        return None
    if "T" in iso_str:
        return iso_str.split("T")[1][:5]
    return iso_str[:5] or None


def enrich_item(item: dict, base_dir: Path, force: bool, timeout: int) -> bool:
    """Enrichit un item. Retourne True si des champs ont été modifiés."""
    date = item.get("date")
    if not date:
        logger.debug("Passe %s : pas de date", item.get("id"))
        return False

    if not force and item.get("weather_code") is not None:
        logger.debug("Passe %s : météo déjà renseignée", item.get("id"))
        return False

    midpoint = get_trace_midpoint(item.get("paths", {}), base_dir)
    if not midpoint:
        logger.warning("Passe %s : coordonnées introuvables", item.get("id"))
        return False
    lat, lon = midpoint

    logger.info("Météo %s (%s) @ %.4f,%.4f …", item.get("id"), date, lat, lon)

    data = fetch_weather_archive(lat, lon, date, timeout=timeout)
    if not data:
        return False

    daily = data.get("daily", {})
    codes = daily.get("weather_code", [])
    t_max_list = daily.get("temperature_2m_max", [])
    t_min_list = daily.get("temperature_2m_min", [])
    sunrise_list = daily.get("sunrise", [])
    sunset_list = daily.get("sunset", [])

    wmo: int | None = codes[0] if codes else None
    if wmo is not None:
        emoji, desc = WMO_LABELS.get(wmo, ("🌡", f"Code WMO {wmo}"))
    else:
        emoji, desc = None, None

    t_max = t_max_list[0] if t_max_list else None
    t_min = t_min_list[0] if t_min_list else None
    temp = round((t_max + t_min) / 2, 1) if t_max is not None and t_min is not None else None

    item["weather_code"] = wmo
    item["weather_desc"] = desc
    item["weather_emoji"] = emoji
    item["temp_c"] = temp
    item["sunrise"] = parse_hhmm(sunrise_list[0]) if sunrise_list else None
    item["sunset"] = parse_hhmm(sunset_list[0]) if sunset_list else None
    item["moon_phase"] = moon_phase(date)

    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Enrichit traces.json avec météo Open-Meteo + phase lunaire.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--input", type=Path, default=Path("data/catalog/traces.json"),
        help="Chemin du fichier traces.json (défaut : data/catalog/traces.json)",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Ré-écrit les étapes déjà renseignées.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Prévisualise les changements sans écrire le fichier.",
    )
    parser.add_argument(
        "--timeout", type=int, default=30,
        help="Timeout HTTP en secondes (défaut : 30).",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Logs détaillés.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    if not args.input.exists():
        logger.error("Fichier introuvable : %s", args.input)
        return 1

    try:
        catalog = json.loads(args.input.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error("Impossible de lire %s : %s", args.input, e)
        return 1

    items = catalog.get("items", [])
    base_dir = Path(".")

    n_updated = 0
    n_errors = 0

    for item in items:
        try:
            if enrich_item(item, base_dir, args.force, args.timeout):
                n_updated += 1
        except Exception as e:
            logger.warning("Erreur sur %s : %s", item.get("id"), e)
            n_errors += 1

    logger.info("✓ %d/%d étapes mises à jour", n_updated, len(items))

    if args.dry_run:
        logger.info("Dry run : fichier non modifié.")
        if args.verbose:
            print(json.dumps(catalog, ensure_ascii=False, indent=2))
        return 0

    catalog["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        args.input.write_text(
            json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except Exception as e:
        logger.error("Impossible d'écrire %s : %s", args.input, e)
        return 1

    logger.info("✓ Écrit dans %s", args.input)
    return 3 if n_errors else 0


if __name__ == "__main__":
    sys.exit(main())

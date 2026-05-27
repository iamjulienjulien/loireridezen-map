#!/usr/bin/env python3
"""
gpx_to_geojson.py — convertit des fichiers GPX en GeoJSON RFC 7946.

Conçu pour Loire Ride Zen : traces d'étape, boucles locales, sortie
strictement conforme RFC 7946 (pas de membre `crs` déprécié).

Dépendances :
    pip install gpxpy
    pip install shapely  # optionnel, pour --simplify

Usage :
    # Une étape → un fichier
    python scripts/gpx_to_geojson.py sources/gpx/etape-01.gpx -o data/traces/etape-01.geojson

    # Avec version simplifiée
    python scripts/gpx_to_geojson.py sources/gpx/etape-01.gpx \
        -o data/traces/etape-01_simplified.geojson --simplify 0.0001

    # Fusionner les segments d'un GPX en MultiLineString
    python scripts/gpx_to_geojson.py sources/gpx/boucle-angevine.gpx \
        -o data/traces/boucle-angevine.geojson --multilinestring

Properties générées par feature :
    name, source_file, distance_km, duration_s (si timestamps),
    elevation_gain_m, elevation_loss_m, point_count
"""

from __future__ import annotations

import argparse
import copy
import json
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import gpxpy
import gpxpy.gpx

logger = logging.getLogger("gpx_to_geojson")


def _round_coord(c: float, ndigits: int = 6) -> float:
    """Arrondit une coordonnée pour éviter le bruit float (~10 cm de précision)."""
    return round(c, ndigits)


def _point_to_coords(
    p: gpxpy.gpx.GPXTrackPoint, include_z: bool = True
) -> list[float]:
    """Convertit un GPXTrackPoint en [lon, lat] ou [lon, lat, ele]."""
    coords = [_round_coord(p.longitude), _round_coord(p.latitude)]
    if include_z and p.elevation is not None:
        coords.append(round(p.elevation, 2))
    return coords


def _build_segment_coords(
    segment: gpxpy.gpx.GPXTrackSegment, include_z: bool = True
) -> list[list[float]]:
    return [_point_to_coords(p, include_z) for p in segment.points]


def _maybe_simplify(
    coords: list[list[float]], tolerance: float | None
) -> list[list[float]]:
    """Simplifie Douglas-Peucker via shapely si tolérance fournie ET shapely installé."""
    if tolerance is None or tolerance <= 0:
        return coords
    try:
        from shapely.geometry import LineString
    except ImportError:
        logger.warning(
            "shapely n'est pas installé — simplification ignorée. "
            "Installer avec: pip install shapely"
        )
        return coords
    if len(coords) < 3:
        return coords
    # Shapely travaille en 2D : la 3e dimension (altitude) est perdue à la simplification.
    line = LineString([(c[0], c[1]) for c in coords])
    simplified = line.simplify(tolerance, preserve_topology=False)
    return [[_round_coord(x), _round_coord(y)] for x, y in simplified.coords]


def _track_to_feature(
    track: gpxpy.gpx.GPXTrack,
    source_file: str,
    include_z: bool = True,
    multilinestring: bool = False,
    simplify_tolerance: float | None = None,
) -> dict[str, Any] | None:
    """Convertit un track GPX en Feature GeoJSON (LineString ou MultiLineString)."""
    # Construction de la géométrie
    segments_coords = [
        _maybe_simplify(_build_segment_coords(s, include_z), simplify_tolerance)
        for s in track.segments
        if len(s.points) >= 2
    ]
    if not segments_coords:
        logger.warning("Track '%s' sans segment exploitable, ignoré.", track.name)
        return None

    if multilinestring or len(segments_coords) > 1:
        geometry = {"type": "MultiLineString", "coordinates": segments_coords}
    else:
        geometry = {"type": "LineString", "coordinates": segments_coords[0]}

    # Propriétés enrichies (gpxpy fait le calcul)
    properties: dict[str, Any] = {
        "name": track.name or Path(source_file).stem,
        "source_file": source_file,
        "point_count": sum(len(s.points) for s in track.segments),
    }

    try:
        length_m = track.length_2d() or 0.0
        properties["distance_km"] = round(length_m / 1000.0, 2)
    except Exception as e:
        logger.debug("Distance non calculable pour '%s' : %s", track.name, e)

    try:
        duration_s = track.get_duration()
        if duration_s is not None:
            properties["duration_s"] = int(duration_s)
    except Exception as e:
        logger.debug("Durée non calculable pour '%s' : %s", track.name, e)

    try:
        ud = track.get_uphill_downhill()
        if ud is not None:
            properties["elevation_gain_m"] = round(ud.uphill, 1)
            properties["elevation_loss_m"] = round(ud.downhill, 1)
    except Exception as e:
        logger.debug("Dénivelé non calculable pour '%s' : %s", track.name, e)

    return {"type": "Feature", "geometry": geometry, "properties": properties}


def concat_convert(
    gpx_paths: list[Path],
    tolerance_m: float = 20.0,
    name: str | None = None,
) -> dict[str, Any]:
    """Concatène tous les tracks/segments en une seule LineString (2D).

    Usage EuroVelo : python scripts/gpx_to_geojson.py eurovelo-6.gpx \\
        -o data/eurovelo/eurovelo-6.geojson --concat --tolerance-m 20
    """
    all_coords: list[list[float]] = []
    points_in = 0

    for path in gpx_paths:
        logger.info("Lecture %s", path)
        with path.open("r", encoding="utf-8") as f:
            gpx = gpxpy.parse(f)
        for track in gpx.tracks:
            for segment in track.segments:
                points_in += len(segment.points)
                if tolerance_m > 0:
                    seg = copy.deepcopy(segment)
                    seg.simplify(max_distance=tolerance_m)
                    pts = seg.points
                else:
                    pts = segment.points
                for p in pts:
                    all_coords.append([_round_coord(p.longitude), _round_coord(p.latitude)])

    points_out = len(all_coords)
    feature_name = name or gpx_paths[0].stem.replace("_", " ")
    feature: dict[str, Any] = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": all_coords},
        "properties": {
            "name": feature_name,
            "source": ", ".join(p.name for p in gpx_paths),
            "points_in": points_in,
            "points_out": points_out,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "tolerance_m": tolerance_m,
        },
    }
    logger.info(
        "Concaténation : %d points → %d après simplification (tolérance %g m)",
        points_in,
        points_out,
        tolerance_m,
    )
    return {"type": "FeatureCollection", "features": [feature]}


def convert(
    gpx_paths: list[Path],
    include_z: bool = True,
    multilinestring: bool = False,
    simplify_tolerance: float | None = None,
) -> dict[str, Any]:
    """Convertit une liste de fichiers GPX en FeatureCollection RFC 7946."""
    features = []
    for path in gpx_paths:
        logger.info("Lecture %s", path)
        with path.open("r", encoding="utf-8") as f:
            gpx = gpxpy.parse(f)
        for track in gpx.tracks:
            feature = _track_to_feature(
                track,
                source_file=path.name,
                include_z=include_z,
                multilinestring=multilinestring,
                simplify_tolerance=simplify_tolerance,
            )
            if feature is not None:
                features.append(feature)
    return {"type": "FeatureCollection", "features": features}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Convertit des fichiers GPX en GeoJSON RFC 7946.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        type=Path,
        help="Un ou plusieurs fichiers GPX à convertir.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        required=False,
        default=None,
        help="Chemin du fichier GeoJSON de sortie (requis sauf avec --stats-only).",
    )
    parser.add_argument(
        "--stats-only",
        action="store_true",
        help="Affiche distance_km et elevation_gain_m en JSON sur stdout, sans écrire de fichier.",
    )
    parser.add_argument(
        "--no-z",
        dest="include_z",
        action="store_false",
        help="Ignorer l'altitude, sortir des coordonnées 2D uniquement.",
    )
    parser.add_argument(
        "--multilinestring",
        action="store_true",
        help="Forcer une géométrie MultiLineString même pour un track à un seul segment.",
    )
    parser.add_argument(
        "--simplify",
        type=float,
        default=None,
        metavar="TOLERANCE",
        help="Tolérance Douglas-Peucker en degrés WGS84 (ex. 0.0001 ≈ 11 m). "
        "Nécessite shapely. Note : perd l'altitude.",
    )
    parser.add_argument(
        "--concat",
        action="store_true",
        help="Concatène tous les tracks/segments en une seule LineString 2D. "
        "Utilise --tolerance-m pour la simplification (défaut 20 m).",
    )
    parser.add_argument(
        "--tolerance-m",
        type=float,
        default=20.0,
        dest="tolerance_m",
        metavar="METERS",
        help="Tolérance Douglas-Peucker en mètres pour le mode --concat (défaut : 20).",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=None,
        help="Indentation JSON (par défaut : compact). Ex. --indent 2 pour debug.",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Logs détaillés."
    )
    args = parser.parse_args(argv)

    if not args.stats_only and args.output is None:
        parser.error("-o/--output est requis sauf avec --stats-only")

    logging.basicConfig(
        level=logging.ERROR if args.stats_only else (logging.DEBUG if args.verbose else logging.INFO),
        format="%(levelname)s %(message)s",
    )

    missing = [p for p in args.inputs if not p.exists()]
    if missing:
        for p in missing:
            logger.error("Fichier introuvable : %s", p)
        return 1

    if args.stats_only:
        total_dist = 0.0
        total_elev = 0.0
        for path in args.inputs:
            with path.open("r", encoding="utf-8") as f:
                gpx = gpxpy.parse(f)
            for track in gpx.tracks:
                try:
                    total_dist += (track.length_2d() or 0.0) / 1000.0
                except Exception:
                    pass
                try:
                    ud = track.get_uphill_downhill()
                    if ud:
                        total_elev += ud.uphill
                except Exception:
                    pass
        print(json.dumps({
            "distance_km": round(total_dist, 2),
            "elevation_gain_m": round(total_elev, 1),
        }))
        return 0

    if args.concat:
        geojson = concat_convert(
            gpx_paths=args.inputs,
            tolerance_m=args.tolerance_m,
        )
    else:
        geojson = convert(
            gpx_paths=args.inputs,
            include_z=args.include_z,
            multilinestring=args.multilinestring,
            simplify_tolerance=args.simplify,
        )

    n_features = len(geojson["features"])
    if n_features == 0:
        logger.error("Aucun track exploitable trouvé dans les fichiers fournis.")
        return 2

    total_km = sum(f["properties"].get("distance_km", 0) for f in geojson["features"])
    logger.info(
        "Conversion : %d feature(s), %.1f km cumulés → %s",
        n_features,
        total_km,
        args.output,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=args.indent)
        if args.indent is None:
            f.write("\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())

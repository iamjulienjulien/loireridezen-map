from __future__ import annotations

import re
import struct
from typing import Optional

from .supabase_client import get_client

VALID_TYPES = {"chateau", "coupdecoeur", "patrimoine", "guinguette", "hébergement"}
CHATEAU_FIELDS = {"photo_path", "visited", "construction_date"}

TYPE_EMOJIS: dict[str, str] = {
    "chateau": "👑",
    "coupdecoeur": "💖",
    "patrimoine": "🏰",
    "guinguette": "🍻",
    "hébergement": "🏕️",
    "photo": "📸",
}

_EWKT_RE = re.compile(r'POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)', re.IGNORECASE)


def list_pois(type_filter: Optional[str] = None) -> list[dict]:
    client = get_client()
    q = client.table("pois").select("*").order("id")
    if type_filter:
        q = q.eq("type", type_filter)
    return q.execute().data or []


def get_poi(poi_id: int) -> dict | None:
    client = get_client()
    res = client.table("pois").select("*").eq("id", poi_id).execute()
    return res.data[0] if res.data else None


def create_poi(data: dict) -> dict:
    client = get_client()
    res = client.table("pois").insert(data).execute()
    return res.data[0]


def update_poi(poi_id: int, changes: dict) -> dict:
    client = get_client()
    res = client.table("pois").update(changes).eq("id", poi_id).execute()
    return res.data[0]


def delete_poi(poi_id: int) -> bool:
    client = get_client()
    client.table("pois").delete().eq("id", poi_id).execute()
    return True


def parse_wkb_point(wkb_hex: str) -> tuple[float, float] | None:
    """Parse EWKB hex string → (lon, lat). Returns None if parsing fails."""
    try:
        data = bytes.fromhex(wkb_hex)
        byte_order = data[0]
        fmt = "<" if byte_order == 1 else ">"
        geom_type = struct.unpack_from(f"{fmt}I", data, 1)[0]
        has_srid = bool(geom_type & 0x20000000)
        offset = 5 + (4 if has_srid else 0)
        x, y = struct.unpack_from(f"{fmt}dd", data, offset)
        return x, y
    except Exception:
        return None


def coords_from_poi(poi: dict) -> tuple[float, float] | None:
    """Extract (lon, lat) from a POI dict. Handles both WKB hex and EWKT strings."""
    geom = poi.get("geom")
    if not geom or not isinstance(geom, str):
        return None
    geom = geom.strip()
    if "POINT" in geom.upper():
        m = _EWKT_RE.search(geom)
        if m:
            return float(m.group(1)), float(m.group(2))
        return None
    return parse_wkb_point(geom)


def ewkt_point(lon: float, lat: float) -> str:
    return f"SRID=4326;POINT({lon} {lat})"

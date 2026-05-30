"""
scripts/lib/weather.py — Météo et calculs astronomiques (EVO-57).

Exposé :
  ICON_TO_DESCRIPTION          dict[str, str]
  PHASE_BUCKETS                list[tuple]
  description_for_icon(icon)   → str
  moon_icon_desc(phase)        → (icon, description)
  compute_moon(date_str)       → {phase, icon, description}
  compute_moon_from_phase(p)   → {phase, icon, description}
  compute_day(lat, lon, date)  → {sunrise, sunset} | {}   (via Open-Meteo)
  fetch_weather_for(lat, lon, date) → {icon, description, temp} | None
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from datetime import datetime

logger = logging.getLogger("weather")

# ─── Icônes météo canoniques → description française ─────────────────────────

ICON_TO_DESCRIPTION: dict[str, str] = {
    "☀️":  "Ensoleillé",
    "🌤️": "Plutôt ensoleillé",
    "⛅":  "Nuageux ensoleillé",
    "🌥️": "Plutôt nuageux",
    "☁️":  "Couvert",
    "🌦️": "Pluie passagère",
    "🌧️": "Pluvieux",
    "⛈️": "Orageux",
    "🌩️": "Éclairs",
    "❄️":  "Neigeux",
    "🌬️": "Venteux",
    "🌫️": "Brumeux",
}

# Codes WMO → icône canonique
_WMO_TO_ICON: dict[int, str] = {
    0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️",
    45: "🌫️", 48: "🌫️",
    51: "🌦️", 53: "🌦️", 55: "🌧️",
    56: "🌧️", 57: "🌧️",
    61: "🌧️", 63: "🌧️", 65: "🌧️",
    66: "🌧️", 67: "🌧️",
    71: "❄️", 73: "❄️", 75: "❄️", 77: "❄️",
    80: "🌦️", 81: "🌧️", 82: "🌧️",
    85: "❄️", 86: "❄️",
    95: "⛈️", 96: "⛈️", 99: "⛈️",
}

# ─── Phases lunaires ─────────────────────────────────────────────────────────
# (phase_max_exclu, icon, description)

PHASE_BUCKETS: list[tuple[float, str, str]] = [
    (0.0625, "🌑", "Nouvelle lune"),
    (0.1875, "🌒", "Premier croissant"),
    (0.3125, "🌓", "Premier quartier"),
    (0.4375, "🌔", "Gibbeuse croissante"),
    (0.5625, "🌕", "Pleine lune"),
    (0.6875, "🌖", "Gibbeuse décroissante"),
    (0.8125, "🌗", "Dernier quartier"),
    (0.9375, "🌘", "Dernier croissant"),
    (1.0001, "🌑", "Nouvelle lune"),
]


def description_for_icon(icon: str) -> str:
    """Description par défaut d'une icône météo, ou '' si inconnue."""
    return ICON_TO_DESCRIPTION.get(icon, "")


def moon_icon_desc(phase: float) -> tuple[str, str]:
    """Retourne (icon, description) pour une phase 0.0–1.0."""
    for max_phase, icon, desc in PHASE_BUCKETS:
        if phase < max_phase:
            return icon, desc
    return "🌑", "Nouvelle lune"


def compute_moon(date_str: str) -> dict:
    """Calcule la phase lunaire et retourne {phase, icon, description}."""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    y, m, day = d.year, d.month, d.day
    if m <= 2:
        y -= 1
        m += 12
    A = y // 100
    B = 2 - A + A // 4
    jd = int(365.25 * (y + 4716)) + int(30.6001 * (m + 1)) + day + B - 1524.5
    known_new = 2451549.5
    synodic = 29.53058770576
    phase = round(((jd - known_new) % synodic) / synodic, 3)
    icon, desc = moon_icon_desc(phase)
    return {"phase": phase, "icon": icon, "description": desc}


def compute_moon_from_phase(phase: float) -> dict:
    """Enrichit une phase connue avec icon + description."""
    icon, desc = moon_icon_desc(phase)
    return {"phase": round(phase, 3), "icon": icon, "description": desc}


def compute_day(lat: float, lon: float, date_str: str, timeout: int = 20) -> dict:
    """Récupère lever/coucher du soleil via Open-Meteo. Retourne {} si erreur."""
    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={lat:.4f}&longitude={lon:.4f}"
        f"&start_date={date_str}&end_date={date_str}"
        "&daily=sunrise,sunset&timezone=Europe%2FParis"
    )
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = json.load(resp)
        daily = data.get("daily", {})
        sunrise_list = daily.get("sunrise", [])
        sunset_list = daily.get("sunset", [])

        def _hhmm(s: str) -> str | None:
            if not s:
                return None
            return s.split("T")[1][:5] if "T" in s else s[:5]

        sr = _hhmm(sunrise_list[0]) if sunrise_list else None
        ss = _hhmm(sunset_list[0]) if sunset_list else None
        return {"sunrise": sr, "sunset": ss} if (sr or ss) else {}
    except Exception as e:
        logger.warning("compute_day failed for %s: %s", date_str, e)
        return {}


def fetch_weather_for(lat: float, lon: float, date_str: str, timeout: int = 30) -> dict | None:
    """Récupère météo depuis Open-Meteo archive.

    Retourne {"icon": str, "description": str, "temp": int} ou None si erreur.
    """
    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={lat:.4f}&longitude={lon:.4f}"
        f"&start_date={date_str}&end_date={date_str}"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min"
        "&timezone=Europe%2FParis"
    )
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = json.load(resp)
    except Exception as e:
        logger.warning("fetch_weather_for failed for %s: %s", date_str, e)
        return None

    daily = data.get("daily", {})
    codes = daily.get("weather_code", [])
    t_max_list = daily.get("temperature_2m_max", [])
    t_min_list = daily.get("temperature_2m_min", [])

    wmo = codes[0] if codes else None
    icon = _WMO_TO_ICON.get(wmo) if wmo is not None else None
    if icon is None:
        return None

    desc = ICON_TO_DESCRIPTION.get(icon, "")
    t_max = t_max_list[0] if t_max_list else None
    t_min = t_min_list[0] if t_min_list else None
    temp = round((t_max + t_min) / 2) if t_max is not None and t_min is not None else None

    return {"icon": icon, "description": desc, "temp": temp}

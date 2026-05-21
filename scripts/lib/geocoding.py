"""
Géocodage d'adresses via Nominatim (OpenStreetMap).

Politique d'usage : User-Agent obligatoire, max 1 req/sec.
https://operations.osmfoundation.org/policies/nominatim/
"""
from __future__ import annotations

import time

import requests

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "loireridezen-tools/1.0 (contact: contact@julienjulien.fr)"
DEFAULT_COUNTRY = "fr"
DEFAULT_LIMIT = 5

_last_call_ts: float = 0.0


def geocode_address(
    address: str,
    country_codes: str = DEFAULT_COUNTRY,
    limit: int = DEFAULT_LIMIT,
    timeout: int = 10,
) -> list[dict]:
    """
    Géocode une adresse via Nominatim. Retourne une liste de résultats triés
    par pertinence (max `limit`). Lève requests.RequestException en cas d'erreur réseau.

    Chaque résultat contient au minimum : lat (str), lon (str), display_name (str).
    Respecte le rate limit Nominatim (1 req/s) via sleep automatique.
    """
    global _last_call_ts
    elapsed = time.monotonic() - _last_call_ts
    if elapsed < 1.0:
        time.sleep(1.0 - elapsed)

    params: dict = {
        "q": address,
        "format": "json",
        "limit": limit,
        "addressdetails": 1,
    }
    if country_codes:
        params["countrycodes"] = country_codes

    r = requests.get(
        NOMINATIM_URL,
        params=params,
        headers={"User-Agent": USER_AGENT},
        timeout=timeout,
    )
    _last_call_ts = time.monotonic()
    r.raise_for_status()
    return r.json()


def format_result_label(result: dict, *, max_length: int = 80) -> str:
    """Formate un résultat Nominatim pour affichage compact dans un select."""
    name = result.get("display_name", "")
    if len(name) > max_length:
        name = name[: max_length - 1] + "…"
    lat = float(result["lat"])
    lon = float(result["lon"])
    return f"{name}  ({lat:.4f}, {lon:.4f})"

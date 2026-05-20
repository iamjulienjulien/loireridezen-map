#!/usr/bin/env python3
"""
update_position.py — Mise à jour manuelle du marker "Où je suis" sur la carte.

Géocode une adresse via Nominatim (OSM) ou accepte des coordonnées GPS directes,
puis écrit data/catalog/current_position.json.

Usage :
    python scripts/update_position.py
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
import questionary
from rich.console import Console

CATALOG = Path(__file__).resolve().parent.parent / "data" / "catalog" / "current_position.json"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "loireridezen-update-position/1.0"

console = Console()


def load_current() -> dict:
    if not CATALOG.exists():
        return {"updated_at": None, "active": False, "label": "", "description": "", "coordinates": None, "source": None}
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def save_current(data: dict) -> None:
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def geocode(address: str) -> list[dict]:
    r = requests.get(
        NOMINATIM_URL,
        params={"q": address, "format": "json", "limit": 5, "countrycodes": "fr"},
        headers={"User-Agent": USER_AGENT},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def parse_gps(text: str) -> tuple[float, float] | None:
    parts = re.split(r"[,\s]+", text.strip())
    if len(parts) != 2:
        return None
    try:
        lat = float(parts[0].replace(",", "."))
        lon = float(parts[1].replace(",", "."))
        return (lat, lon)
    except ValueError:
        return None


def update_by_address() -> None:
    address = questionary.text("Adresse :").ask()
    if not address:
        return

    console.print("[dim]Géocodage en cours…[/]")
    try:
        results = geocode(address)
    except requests.RequestException as err:
        console.print(f"[red]Erreur réseau : {err}[/]")
        return

    if not results:
        console.print("[red]Aucun résultat.[/]")
        return

    choices = [
        questionary.Choice(f"{r['display_name']} ({float(r['lat']):.4f}, {float(r['lon']):.4f})", value=r)
        for r in results
    ]
    chosen = questionary.select("Choisir :", choices=choices).ask()
    if not chosen:
        return

    label = questionary.text("Label affiché :", default=chosen["display_name"].split(",")[0].strip()).ask()
    description = questionary.text("Description (optionnelle) :", default="").ask()

    save_current({
        "active": True,
        "label": label,
        "description": description or "",
        "coordinates": [float(chosen["lon"]), float(chosen["lat"])],
        "source": "address",
    })
    console.print(f"[green]✓ Position mise à jour : {label}[/]")


def update_by_gps() -> None:
    text = questionary.text("Coordonnées (lat, lon) :").ask()
    if not text:
        return

    coords = parse_gps(text)
    if not coords:
        console.print("[red]Format invalide. Exemple : 47.3641, -0.4966[/]")
        return

    label = questionary.text("Label :").ask()
    description = questionary.text("Description (optionnelle) :", default="").ask()

    save_current({
        "active": True,
        "label": label,
        "description": description or "",
        "coordinates": [coords[1], coords[0]],  # [lon, lat] GeoJSON
        "source": "gps",
    })
    console.print(f"[green]✓ Position mise à jour : {label}[/]")


def clear_position() -> None:
    data = load_current()
    data["active"] = False
    save_current(data)
    console.print("[green]✓ Marker masqué.[/]")


def main() -> None:
    current = load_current()
    if current.get("active") and current.get("label"):
        console.print(f"[dim]Position actuelle : {current['label']}[/]")

    choice = questionary.select(
        "Que veux-tu faire ?",
        choices=[
            "Mettre à jour par adresse",
            "Mettre à jour par coordonnées GPS",
            "Effacer",
            "Quitter",
        ],
    ).ask()

    if choice == "Mettre à jour par adresse":
        update_by_address()
    elif choice == "Mettre à jour par coordonnées GPS":
        update_by_gps()
    elif choice == "Effacer":
        clear_position()


if __name__ == "__main__":
    main()

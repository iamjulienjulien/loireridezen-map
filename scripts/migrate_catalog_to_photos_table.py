#!/usr/bin/env python3
"""
migrate_catalog_to_photos_table.py — Remplit la table Supabase `photos`
depuis le catalog local data/catalog/photos.json.

Idempotent : utilise upsert sur la clé primaire `id`.
Les photos déjà présentes sont mises à jour si leurs données ont changé.

Usage :
    python scripts/migrate_catalog_to_photos_table.py
    python scripts/migrate_catalog_to_photos_table.py --dry-run
    python scripts/migrate_catalog_to_photos_table.py -v
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PHOTOS = REPO_ROOT / "data" / "catalog" / "photos.json"

try:
    from rich.console import Console
    from rich.table import Table
    console = Console()
except ImportError:
    print("Dépendance manquante : pip install rich>=13")
    sys.exit(1)

# Lib Supabase
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from lib.supabase_client import get_client
except ImportError:
    console.print("[red]lib/supabase_client introuvable.[/]")
    sys.exit(1)


def _build_row(item: dict) -> dict:
    """Mappe un item du catalog local vers une ligne de la table photos."""
    paths = item.get("paths") or {}
    return {
        "id":          item["id"],
        "label":       item.get("label") or "",
        "description": item.get("description") or None,
        "order":       item.get("order"),
        "group":       item.get("group") or None,
        "time":        item.get("time") or None,
        "lat":         item.get("lat"),
        "lon":         item.get("lon"),
        "thumb":       paths.get("thumb") or None,
        "image":       paths.get("remote") or None,
        "poi_id":      item.get("poi_id") or None,
        "categories":  item.get("categories") or [],
    }


def migrate(dry_run: bool = False, verbose: bool = False) -> None:
    if not CATALOG_PHOTOS.exists():
        console.print(f"[red]Catalog introuvable : {CATALOG_PHOTOS}[/]")
        sys.exit(1)

    with CATALOG_PHOTOS.open(encoding="utf-8") as f:
        data = json.load(f)

    items: list[dict] = data.get("items", data) if isinstance(data, dict) else data

    if not items:
        console.print("[yellow]Catalog vide — rien à migrer.[/]")
        return

    rows = [_build_row(it) for it in items]

    if verbose or dry_run:
        table = Table(title=f"Aperçu ({len(rows)} photos)", box=None, pad_edge=False)
        table.add_column("id", style="dim")
        table.add_column("label")
        table.add_column("group")
        table.add_column("order", justify="right")
        table.add_column("categories")
        for r in rows:
            cats = ", ".join(r["categories"]) if r["categories"] else "—"
            table.add_row(
                r["id"],
                r["label"],
                r["group"] or "—",
                str(r["order"]) if r["order"] is not None else "—",
                cats,
            )
        console.print(table)

    if dry_run:
        console.print(f"\n[dim][dry-run] {len(rows)} ligne(s) — aucun envoi Supabase.[/]")
        return

    url = os.environ.get("SUPA_URL")
    key = os.environ.get("SUPA_SECRET_KEY")
    if not url or not key:
        console.print(
            "[yellow]⚠ Variables d'env manquantes :[/]\n"
            f"  SUPA_URL        {'[green]✓[/]' if url else '[red]✗[/]'}\n"
            f"  SUPA_SECRET_KEY {'[green]✓[/]' if key else '[red]✗[/]'}"
        )
        sys.exit(2)

    supa = get_client()
    console.print(f"[dim]Upsert de {len(rows)} photo(s) vers Supabase…[/]")

    # Supabase limite les upserts à ~500 lignes — on envoie par batch de 100
    BATCH = 100
    n_ok = 0
    n_err = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        try:
            resp = supa.table("photos").upsert(batch, on_conflict="id").execute()
            n_ok += len(resp.data or batch)
        except Exception as e:
            console.print(f"[red]Erreur batch {i//BATCH + 1} : {e}[/]")
            n_err += len(batch)

    if n_err:
        console.print(f"[yellow]⚠ {n_ok} photo(s) insérée(s)/mises à jour, {n_err} erreur(s).[/]")
    else:
        console.print(f"[green]✓ {n_ok} photo(s) synchronisée(s) vers Supabase.[/]")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Afficher sans envoyer")
    parser.add_argument("-v", "--verbose", action="store_true", help="Afficher le tableau complet")
    args = parser.parse_args()
    migrate(dry_run=args.dry_run, verbose=args.verbose)

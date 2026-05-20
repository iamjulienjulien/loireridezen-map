#!/usr/bin/env python3
"""
migrate_photos_order.py — Migration idempotente de l'ordre et des labels des photos.

Lit data/catalog/photos.json, parse le filename du thumb pour chaque item
(format attendu : <order>-<slug>.<ext>), corrige les labels auto-générés à
l'ancienne et attribue un order aux items qui en sont dépourvus.

Idempotent : une deuxième exécution ne modifie aucun item déjà migré.

Usage :
    python scripts/migrate_photos_order.py
    python scripts/migrate_photos_order.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PHOTOS = REPO_ROOT / "data" / "catalog" / "photos.json"

PHOTO_FILENAME_RE = re.compile(r"^(\d+)-(.+)$")

# Détecte un label auto-généré par l'ancienne méthode : "01 chambord", "07 delaware painter"…
OLD_LABEL_RE = re.compile(r"^\d+ .+")


def build_photo_defaults(stem: str) -> dict:
    """Parse <order>-<slug> → label propre + order numérique."""
    m = PHOTO_FILENAME_RE.match(stem)
    if m:
        return {
            "label": m.group(2).replace("-", " ").title(),
            "order": int(m.group(1)),
        }
    return {
        "label": stem.replace("-", " ").replace("_", " ").title(),
        "order": None,
    }


def migrate(dry_run: bool = False) -> None:
    if not CATALOG_PHOTOS.exists():
        print(f"Catalog introuvable : {CATALOG_PHOTOS}", file=sys.stderr)
        sys.exit(1)

    with CATALOG_PHOTOS.open(encoding="utf-8") as f:
        data = json.load(f)

    items: list[dict] = data.get("items", [])
    modified = 0
    max_order = max((it.get("order") or 0 for it in items), default=0)

    for item in items:
        thumb = item.get("paths", {}).get("thumb", "")
        stem = Path(thumb).stem if thumb else item.get("id", "")
        defaults = build_photo_defaults(stem)
        changed = False

        # Attribuer un order si manquant
        if item.get("order") is None:
            max_order += 1
            item["order"] = max_order
            changed = True

        # Corriger un label auto-généré (pattern "01 chambord")
        current_label = item.get("label", "")
        if OLD_LABEL_RE.match(current_label) and defaults.get("label"):
            new_label = defaults["label"]
            if current_label != new_label:
                print(f"  label : {current_label!r} → {new_label!r}  ({stem})")
                item["label"] = new_label
                changed = True

        if changed:
            modified += 1

    # Trier par order (items sans order à la fin)
    items.sort(key=lambda it: (it.get("order") is None, it.get("order") or 0))

    if dry_run:
        print(f"\n[dry-run] {len(items)} photos, {modified} à modifier — aucune écriture.")
        return

    data["items"] = items
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    with CATALOG_PHOTOS.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"\n✓ {len(items)} photos traitées, {modified} modifiée(s).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Afficher sans écrire")
    args = parser.parse_args()
    migrate(dry_run=args.dry_run)

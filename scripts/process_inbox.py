#!/usr/bin/env python3
"""
process_inbox.py — Déplace les photos de sources/photos/inbox/ vers sources/photos/
en suivant la convention <NN>-<slug>.ext (NN auto-incrémenté, extension préservée).

Idempotent : un slug déjà présent dans sources/photos/ est ignoré.
Utilisation :
    python scripts/process_inbox.py
    python scripts/process_inbox.py --dry-run   # affiche sans déplacer
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
INBOX_DIR = REPO_ROOT / "sources" / "photos" / "inbox"
PHOTOS_DIR = REPO_ROOT / "sources" / "photos"

PHOTO_EXTS = {".jpg", ".jpeg", ".heic", ".heif", ".png"}
_NN_SLUG_RE = re.compile(r"^(\d+)-(.+)$")


def _to_slug(stem: str) -> str:
    """Normalize a filename stem to a lowercase kebab-case slug."""
    s = stem.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def _max_nn() -> int:
    """Return the highest NN prefix found in sources/photos/ (direct children only)."""
    max_n = 0
    for p in PHOTOS_DIR.iterdir():
        if p.is_file() and p.suffix.lower() in PHOTO_EXTS:
            m = _NN_SLUG_RE.match(p.stem)
            if m:
                max_n = max(max_n, int(m.group(1)))
    return max_n


def _existing_slugs() -> set[str]:
    """Collect all slugs currently present in sources/photos/ (direct children)."""
    slugs: set[str] = set()
    for p in PHOTOS_DIR.iterdir():
        if not (p.is_file() and p.suffix.lower() in PHOTO_EXTS):
            continue
        m = _NN_SLUG_RE.match(p.stem)
        raw_slug = m.group(2) if m else p.stem
        slugs.add(_to_slug(raw_slug))
    return slugs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", "-n", action="store_true",
        help="Afficher les opérations sans les exécuter",
    )
    args = parser.parse_args()

    if not INBOX_DIR.exists():
        print(f"[info] Dossier inbox absent : {INBOX_DIR}", flush=True)
        return 0

    inbox_files = sorted(
        p for p in INBOX_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in PHOTO_EXTS
    )
    if not inbox_files:
        print("[info] Inbox vide — rien à traiter.", flush=True)
        return 0

    existing = _existing_slugs()
    nn = _max_nn()
    moved = skipped = 0

    for src in inbox_files:
        # Compute slug from source filename
        src_stem = src.stem
        m = _NN_SLUG_RE.match(src_stem)
        raw_slug = m.group(2) if m else src_stem
        slug = _to_slug(raw_slug)

        if not slug:
            slug = _to_slug(src_stem) or f"photo-{nn + 1:02d}"

        if slug in existing:
            print(f"[skip] {src.name} — slug '{slug}' déjà présent dans sources/photos/")
            skipped += 1
            continue

        # Determine extension: normalize .jpg → .jpeg, keep others
        ext = src.suffix.lower()
        if ext == ".jpg":
            ext = ".jpeg"

        nn += 1
        dest_name = f"{nn:02d}-{slug}{ext}"
        dest = PHOTOS_DIR / dest_name

        if args.dry_run:
            print(f"[dry]  {src.name} → sources/photos/{dest_name}")
        else:
            shutil.move(str(src), str(dest))
            print(f"[move] {src.name} → sources/photos/{dest_name}", flush=True)

        existing.add(slug)
        moved += 1

    status = "[dry-run] " if args.dry_run else ""
    print(f"\n{status}✓ {moved} photo(s) déplacée(s), {skipped} ignorée(s).", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

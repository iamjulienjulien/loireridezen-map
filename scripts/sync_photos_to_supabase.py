#!/usr/bin/env python3
"""
sync_photos_to_supabase.py — pousse les photos locales vers Supabase Storage.

Synchronise le dossier `sources/photos/` (ou autre) vers le bucket Supabase
Storage `photos`. Sync **additive** par défaut : n'écrase rien, ne
supprime rien. Flags explicites pour activer ces comportements.

Cf. ticket LRZ-QA-10 — externaliser les photos JPEG originales hors du
repo git.

⚠️ SÉCURITÉ — clé secrète obligatoire
------------------------------------
L'upload sur Supabase Storage requiert le rôle `service_role`, donc la
**`SUPA_SECRET_KEY`** (format `sb_secret_*` ou legacy `service_role`).

Cette clé est lue **uniquement depuis la variable d'environnement**
`SUPA_SECRET_KEY` — jamais depuis `config.js`. `config.js` est exposé
côté navigateur (en local et en prod via le build Vercel) — y mettre la
clé secrète serait une fuite immédiate.

Stocker la clé de façon sûre :
    # Bash / Zsh
    export SUPA_SECRET_KEY="sb_secret_..."

    # Ou dans un fichier .env.local gitignored, sourcé manuellement
    echo 'SUPA_SECRET_KEY="sb_secret_..."' > .env.local
    chmod 600 .env.local
    source .env.local

`SUPA_URL` peut venir d'env ou de config.js (pas un secret).

Usage
-----
    # Sync additive (par défaut) : upload juste les nouveaux fichiers
    python sync_photos_to_supabase.py

    # Voir ce qui serait fait sans rien envoyer
    python sync_photos_to_supabase.py --dry-run

    # Écraser les fichiers déjà présents (si modifiés en local)
    python sync_photos_to_supabase.py --upsert

    # Sync miroir : aussi supprimer sur Supabase ce qui n'est plus en local
    python sync_photos_to_supabase.py --delete

    # Dossier source et bucket custom
    python scripts/sync_photos_to_supabase.py --photos ./mes_photos --bucket photos

Exit codes :
    0 — succès complet
    1 — succès partiel (au moins un échec d'upload/delete)
    2 — credentials manquants ou dossier introuvable
    3 — erreur API Supabase bloquante (au listing)
"""

from __future__ import annotations

import argparse
import json
import logging
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

logger = logging.getLogger("sync_photos")

_REPO_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_PHOTOS_DIR = _REPO_ROOT / "sources" / "photos"

PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif"}

# Override mimetypes — HEIC n'est pas toujours reconnu par la stdlib
MIME_OVERRIDES = {
    ".heic": "image/heic",
    ".heif": "image/heif",
}


# ─────────────────────────────────────────────────────────── Credentials


def load_config_from_js(config_path: Path) -> dict[str, str]:
    """Parse minimaliste de config.js pour SUPA_URL UNIQUEMENT (jamais la secret key)."""
    if not config_path.exists():
        return {}
    text = config_path.read_text(encoding="utf-8")
    config: dict[str, str] = {}
    match = re.search(r"""SUPA_URL\s*:\s*['"]([^'"]+)['"]""", text)
    if match:
        config["SUPA_URL"] = match.group(1)
    return config


def get_credentials() -> tuple[str, str]:
    """Récupère SUPA_URL (env ou config.js) + SUPA_SECRET_KEY (env uniquement)."""
    supa_url = os.environ.get("SUPA_URL")
    if not supa_url:
        config = load_config_from_js(Path("config.js"))
        supa_url = config.get("SUPA_URL")

    supa_secret = os.environ.get("SUPA_SECRET_KEY")

    if not supa_url:
        logger.error(
            "SUPA_URL introuvable.\n"
            "  Option 1 : export SUPA_URL=...\n"
            "  Option 2 : créer config.js à la racine"
        )
        sys.exit(2)

    if not supa_secret:
        logger.error(
            "SUPA_SECRET_KEY introuvable dans l'environnement.\n"
            "  export SUPA_SECRET_KEY=\"sb_secret_...\"\n"
            "  (jamais cette clé dans config.js — elle serait exposée au navigateur)"
        )
        sys.exit(2)

    return supa_url, supa_secret


# ───────────────────────────────────────────────────────────── Listing


def list_remote_files(
    supa_url: str, supa_secret: str, bucket: str
) -> dict[str, dict]:
    """Liste les objets du bucket. Retourne un dict {name: metadata}."""
    url = f"{supa_url.rstrip('/')}/storage/v1/object/list/{bucket}"
    all_objects: list[dict] = []
    offset = 0
    page_size = 1000

    while True:
        body = json.dumps({
            "prefix": "",
            "limit": page_size,
            "offset": offset,
            "sortBy": {"column": "name", "order": "asc"},
        }).encode("utf-8")

        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "apikey": supa_secret,
                "Authorization": f"Bearer {supa_secret}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                page = json.load(response)
        except urllib.error.HTTPError as err:
            body_text = err.read().decode("utf-8", errors="replace")[:500]
            logger.error("HTTP %d %s\n  Détails : %s", err.code, err.reason, body_text)
            sys.exit(3)
        except urllib.error.URLError as err:
            logger.error("Erreur réseau lors du listing : %s", err.reason)
            sys.exit(3)

        if not isinstance(page, list):
            logger.error("Réponse de listing inattendue : %r", page)
            sys.exit(3)

        all_objects.extend(page)
        if len(page) < page_size:
            break
        offset += page_size

    # Indexe par name, ne garde que les fichiers (pas les markers de dossier)
    return {
        obj["name"]: obj
        for obj in all_objects
        if obj.get("name") and Path(obj["name"]).suffix.lower() in PHOTO_EXTENSIONS
    }


def list_local_files(photos_dir: Path) -> dict[str, Path]:
    """Liste les photos locales récursivement. Retourne un dict {relative_path: full_path}."""
    if not photos_dir.exists() or not photos_dir.is_dir():
        logger.error("Dossier introuvable : %s", photos_dir)
        sys.exit(2)

    files: dict[str, Path] = {}
    for f in sorted(photos_dir.rglob("*")):
        if f.is_file() and f.suffix.lower() in PHOTO_EXTENSIONS:
            rel = f.relative_to(photos_dir).as_posix()
            files[rel] = f
    return files


# ──────────────────────────────────────────────────────── Upload / Delete


def guess_mime(path: Path) -> str:
    """Devine le MIME type. Fallback sur application/octet-stream."""
    suffix = path.suffix.lower()
    if suffix in MIME_OVERRIDES:
        return MIME_OVERRIDES[suffix]
    mime, _ = mimetypes.guess_type(path.as_posix())
    return mime or "application/octet-stream"


def upload_file(
    supa_url: str,
    supa_secret: str,
    bucket: str,
    remote_path: str,
    local_path: Path,
    upsert: bool = False,
) -> bool:
    """Upload un fichier vers Supabase Storage. Retourne True si succès."""
    url = f"{supa_url.rstrip('/')}/storage/v1/object/{bucket}/{remote_path}"
    data = local_path.read_bytes()
    headers = {
        "apikey": supa_secret,
        "Authorization": f"Bearer {supa_secret}",
        "Content-Type": guess_mime(local_path),
        "x-upsert": "true" if upsert else "false",
    }
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            response.read()
        return True
    except urllib.error.HTTPError as err:
        body_text = err.read().decode("utf-8", errors="replace")[:300]
        logger.error("✗ %s : HTTP %d — %s", remote_path, err.code, body_text)
        return False
    except urllib.error.URLError as err:
        logger.error("✗ %s : %s", remote_path, err.reason)
        return False


def delete_file(
    supa_url: str, supa_secret: str, bucket: str, remote_path: str
) -> bool:
    """Supprime un fichier du bucket. Retourne True si succès."""
    url = f"{supa_url.rstrip('/')}/storage/v1/object/{bucket}/{remote_path}"
    request = urllib.request.Request(
        url,
        headers={
            "apikey": supa_secret,
            "Authorization": f"Bearer {supa_secret}",
        },
        method="DELETE",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response.read()
        return True
    except urllib.error.HTTPError as err:
        body_text = err.read().decode("utf-8", errors="replace")[:300]
        logger.error("✗ delete %s : HTTP %d — %s", remote_path, err.code, body_text)
        return False
    except urllib.error.URLError as err:
        logger.error("✗ delete %s : %s", remote_path, err.reason)
        return False


# ──────────────────────────────────────────────────────────────── Main


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Synchronise un dossier local vers un bucket Supabase Storage.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--photos", type=Path, default=_DEFAULT_PHOTOS_DIR,
        help="Dossier local à synchroniser (défaut : sources/photos/).",
    )
    parser.add_argument(
        "--bucket", default="photos",
        help="Bucket Supabase Storage cible (défaut : photos).",
    )
    parser.add_argument(
        "--upsert", action="store_true",
        help="Écraser les fichiers déjà présents sur Supabase (défaut : skip).",
    )
    parser.add_argument(
        "--delete", action="store_true",
        help="Sync miroir : supprimer sur Supabase les fichiers absents en local. "
             "À utiliser avec précaution.",
    )
    parser.add_argument(
        "-n", "--dry-run", action="store_true",
        help="Affiche les actions sans rien envoyer ni supprimer.",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Logs détaillés.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    supa_url, supa_secret = get_credentials()

    logger.info("Inspection du dossier local : %s", args.photos)
    local_files = list_local_files(args.photos)
    logger.info("  → %d photo(s) en local", len(local_files))

    logger.info("Inspection du bucket Supabase : %s", args.bucket)
    remote_files = list_remote_files(supa_url, supa_secret, args.bucket)
    logger.info("  → %d photo(s) sur Supabase", len(remote_files))

    # Diff
    local_set = set(local_files.keys())
    remote_set = set(remote_files.keys())

    to_upload_new = sorted(local_set - remote_set)
    to_upload_existing = sorted(local_set & remote_set) if args.upsert else []
    to_delete = sorted(remote_set - local_set) if args.delete else []
    skipped = sorted(local_set & remote_set) if not args.upsert else []

    # Plan
    logger.info("─" * 60)
    logger.info("Plan de synchronisation :")
    logger.info("  Nouveau (à uploader)       : %d", len(to_upload_new))
    if args.upsert:
        logger.info("  Existant (à écraser)       : %d", len(to_upload_existing))
    else:
        logger.info("  Existant (skip, sans --upsert) : %d", len(skipped))
    if args.delete:
        logger.info("  Distant orphelin (à delete): %d", len(to_delete))
    else:
        orphans = len(remote_set - local_set)
        if orphans:
            logger.info(
                "  Distant orphelin (ignoré, sans --delete) : %d", orphans
            )
    logger.info("─" * 60)

    if args.dry_run:
        for name in to_upload_new:
            logger.info("  [DRY] UPLOAD   %s", name)
        for name in to_upload_existing:
            logger.info("  [DRY] UPSERT   %s", name)
        for name in to_delete:
            logger.info("  [DRY] DELETE   %s", name)
        logger.info("Dry-run : aucune action effectuée.")
        return 0

    # Exécution
    n_ok, n_fail = 0, 0

    for name in to_upload_new:
        ok = upload_file(
            supa_url, supa_secret, args.bucket, name, local_files[name], upsert=False
        )
        if ok:
            logger.info("  ↑ UPLOAD   %s", name)
            n_ok += 1
        else:
            n_fail += 1

    for name in to_upload_existing:
        ok = upload_file(
            supa_url, supa_secret, args.bucket, name, local_files[name], upsert=True
        )
        if ok:
            logger.info("  ↑ UPSERT   %s", name)
            n_ok += 1
        else:
            n_fail += 1

    for name in to_delete:
        ok = delete_file(supa_url, supa_secret, args.bucket, name)
        if ok:
            logger.info("  ✗ DELETE   %s", name)
            n_ok += 1
        else:
            n_fail += 1

    logger.info("─" * 60)
    logger.info("Terminé : %d action(s) OK, %d échec(s)", n_ok, n_fail)
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

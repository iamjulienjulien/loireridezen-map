#!/usr/bin/env python3
"""
sync_photos_from_supabase.py — télécharge les photos depuis Supabase Storage vers local.

Sens inverse de sync_photos_to_supabase.py : récupère les photos présentes dans le
bucket Supabase Storage mais absentes du dossier `sources/photos/`.

Cf. ticket LRZ-EVO-58 — sync inverse (Storage → local).

⚠️ SÉCURITÉ — clé secrète obligatoire
------------------------------------
Le téléchargement depuis Supabase Storage requiert le rôle `service_role`, donc la
**`SUPA_SECRET_KEY`** (format `sb_secret_*` ou legacy `service_role`).

Cette clé est lue **uniquement depuis la variable d'environnement** `SUPA_SECRET_KEY`.

Usage
-----
    # Télécharger les fichiers manquants en local
    python sync_photos_from_supabase.py

    # Voir ce qui serait fait sans rien télécharger
    python sync_photos_from_supabase.py --dry-run

    # Écraser les fichiers existants en local
    python sync_photos_from_supabase.py --force

    # Dossier de destination et bucket custom
    python scripts/sync_photos_from_supabase.py --dest ./mes_photos --bucket photos

Exit codes :
    0 — succès complet (ou rien à faire)
    1 — succès partiel (au moins un échec de téléchargement)
    2 — credentials manquants
    3 — erreur API Supabase bloquante (listing ou bucket inaccessible)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import signal
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

try:
    from rich.console import Console
    from rich.tree import Tree
    _RICH = True
    console = Console()
except ImportError:
    _RICH = False
    console = None  # type: ignore[assignment]

logger = logging.getLogger("sync_photos_from_supabase")

_REPO_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_PHOTOS_DIR = _REPO_ROOT / "sources" / "photos"
_DEFAULT_BUCKET = "photos"

PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif"}


# ─────────────────────────────────────────────────────────── Credentials


def _load_config_from_js(config_path: Path) -> dict[str, str]:
    if not config_path.exists():
        return {}
    text = config_path.read_text(encoding="utf-8")
    config: dict[str, str] = {}
    m = re.search(r"""SUPA_URL\s*:\s*['"]([^'"]+)['"]""", text)
    if m:
        config["SUPA_URL"] = m.group(1)
    return config


def get_credentials() -> tuple[str, str]:
    """Récupère SUPA_URL (env ou config.js) + SUPA_SECRET_KEY (env uniquement)."""
    supa_url = os.environ.get("SUPA_URL")
    if not supa_url:
        config = _load_config_from_js(Path("config.js"))
        supa_url = config.get("SUPA_URL")

    supa_secret = os.environ.get("SUPA_SECRET_KEY")

    if not supa_url:
        _err(
            "SUPA_URL introuvable.\n"
            "  Option 1 : export SUPA_URL=...\n"
            "  Option 2 : créer config.js à la racine"
        )
        sys.exit(2)

    if not supa_secret:
        _err(
            "SUPA_SECRET_KEY introuvable dans l'environnement.\n"
            '  export SUPA_SECRET_KEY="sb_secret_..."\n'
            "  (jamais cette clé dans config.js — elle serait exposée au navigateur)"
        )
        sys.exit(2)

    return supa_url, supa_secret


def _err(msg: str) -> None:
    if _RICH:
        console.print(f"[red]✗ {msg}[/]")  # type: ignore[union-attr]
    else:
        print(f"✗ {msg}", file=sys.stderr)


def _info(msg: str) -> None:
    if _RICH:
        console.print(msg)  # type: ignore[union-attr]
    else:
        print(msg)


# ─────────────────────────────────────────────────────────── Logging JSONL

_LOG_PATH: Path | None = None
_RUN_ID: str = uuid.uuid4().hex[:8]
_LOG_WARN_SHOWN: bool = False


def _init_logger(log_dir: Path) -> None:
    global _LOG_PATH
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        today = datetime.now().strftime("%Y-%m-%d")
        _LOG_PATH = log_dir / f"{today}.jsonl"
    except Exception as e:
        _info(f"[yellow]⚠ Logger non initialisé : {e}[/]")


def _log(level: str, action: str, **data) -> None:
    global _LOG_WARN_SHOWN
    if _LOG_PATH is None:
        return
    try:
        entry = {
            "ts": datetime.now().astimezone().isoformat(timespec="milliseconds"),
            "run_id": _RUN_ID,
            "level": level,
            "category": "photos_pull",
            "action": action,
            "data": data,
        }
        with _LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        if not _LOG_WARN_SHOWN:
            _info(f"[yellow]⚠ Échec d'écriture dans le log ({_LOG_PATH}) : {e}[/]")
            _LOG_WARN_SHOWN = True


# ─────────────────────────────────────────────────────────── API Supabase


def _list_remote_files(supa_url: str, supa_secret: str, bucket: str) -> dict[str, dict]:
    """Liste les fichiers photo du bucket. Retourne {name: metadata}."""
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
            _err(f"HTTP {err.code} {err.reason} lors du listing\n  Détails : {body_text}")
            if err.code in (401, 403):
                _err(
                    "Accès refusé — vérifier que SUPA_SECRET_KEY a les droits de lecture "
                    f"sur le bucket « {bucket} » (policy Storage)."
                )
            sys.exit(3)
        except urllib.error.URLError as err:
            _err(f"Erreur réseau lors du listing : {err.reason}")
            sys.exit(3)

        if not isinstance(page, list):
            _err(f"Réponse de listing inattendue : {page!r}")
            sys.exit(3)

        all_objects.extend(page)
        if len(page) < page_size:
            break
        offset += page_size

    photos: dict[str, dict] = {}
    non_photo_count = 0
    for obj in all_objects:
        name = obj.get("name", "")
        if not name or obj.get("id") is None:
            # id=None indique un dossier virtuel dans Supabase
            continue
        suffix = Path(name).suffix.lower()
        if suffix in PHOTO_EXTENSIONS:
            photos[name] = obj
        else:
            non_photo_count += 1

    if non_photo_count:
        logger.debug("%d fichier(s) ignoré(s) (extension hors photos)", non_photo_count)

    return photos


def _download_file(
    supa_url: str,
    supa_secret: str,
    bucket: str,
    remote_name: str,
    dest_path: Path,
) -> bool:
    """Télécharge remote_name → dest_path. Retourne True si succès.

    Écrit d'abord dans dest_path.tmp puis renomme pour éviter les fichiers partiels.
    """
    url = f"{supa_url.rstrip('/')}/storage/v1/object/{bucket}/{remote_name}"
    request = urllib.request.Request(
        url,
        headers={
            "apikey": supa_secret,
            "Authorization": f"Bearer {supa_secret}",
        },
        method="GET",
    )
    tmp_path = dest_path.with_suffix(dest_path.suffix + ".tmp")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
        tmp_path.write_bytes(data)
        tmp_path.rename(dest_path)
        return True
    except urllib.error.HTTPError as err:
        body_text = err.read().decode("utf-8", errors="replace")[:300]
        logger.error("✗ %s : HTTP %d — %s", remote_name, err.code, body_text)
    except urllib.error.URLError as err:
        logger.error("✗ %s : %s", remote_name, err.reason)
    except Exception as err:
        logger.error("✗ %s : %s", remote_name, err)
    if tmp_path.exists():
        tmp_path.unlink()
    return False


# ─────────────────────────────────────────────────────────── Fonction principale


def pull_photos_from_storage(
    dest_dir: Path,
    bucket: str | None = None,
    dry_run: bool = False,
    force: bool = False,
    verbose: bool = False,
) -> dict:
    """Synchronise les photos depuis Supabase Storage vers dest_dir.

    Retourne {downloaded: int, skipped: int, errors: int}.
    """
    bucket = bucket or _DEFAULT_BUCKET
    supa_url, supa_secret = get_credentials()

    dest_dir.mkdir(parents=True, exist_ok=True)

    _log("INFO", "start", bucket=bucket, dest=str(dest_dir), dry_run=dry_run, force=force)

    if verbose:
        logger.debug("Bucket : %s | Destination : %s", bucket, dest_dir)

    remote_files = _list_remote_files(supa_url, supa_secret, bucket)

    if not remote_files:
        _info("[dim]Bucket vide — aucun fichier à télécharger.[/]" if _RICH else "Bucket vide.")
        _log("INFO", "done", downloaded=0, skipped=0, errors=0)
        return {"downloaded": 0, "skipped": 0, "errors": 0}

    local_names = {
        f.name
        for f in dest_dir.iterdir()
        if f.is_file() and f.suffix.lower() in PHOTO_EXTENSIONS
    } if dest_dir.exists() else set()

    remote_names = set(remote_files.keys())

    if force:
        to_download = sorted(remote_names)
        already_local = set()
    else:
        to_download = sorted(remote_names - local_names)
        already_local = remote_names & local_names

    if _RICH:
        tree = Tree("[bold cyan]📥 Sync photos ← Supabase Storage[/]")
        info_branch = tree.add("[dim]Résumé[/]")
        info_branch.add(f"Bucket :        {bucket}")
        info_branch.add(f"Destination :   {dest_dir}")
        info_branch.add(f"Distants :      {len(remote_names)} photo(s)")
        info_branch.add(f"Locaux :        {len(local_names)} photo(s)")
        info_branch.add(f"À télécharger : {len(to_download)}")
        if already_local and not force:
            info_branch.add(f"Skip (déjà présents) : {len(already_local)}")
    else:
        tree = None

    if not to_download:
        if _RICH and tree:
            tree.add("[green]✓ Tout est déjà à jour.[/]")
            console.print(tree)  # type: ignore[union-attr]
        else:
            _info("✓ Tout est déjà à jour.")
        for name in already_local:
            _log("INFO", "file_skipped", name=name)
        _log("INFO", "done", downloaded=0, skipped=len(already_local), errors=0)
        return {"downloaded": 0, "skipped": len(already_local), "errors": 0}

    if dry_run:
        if _RICH and tree:
            dry_branch = tree.add("[yellow][DRY-RUN] fichiers qui seraient téléchargés[/]")
            for name in to_download:
                dry_branch.add(f"[dim]↓ {name}[/]")
            console.print(tree)  # type: ignore[union-attr]
        else:
            for name in to_download:
                _info(f"  [DRY] DOWNLOAD  {name}")
            _info(f"Dry-run : {len(to_download)} fichier(s) seraient téléchargés.")
        _log("INFO", "done", downloaded=0, skipped=len(already_local), errors=0, dry_run=True)
        return {"downloaded": 0, "skipped": len(already_local), "errors": 0}

    # ── Téléchargement ───────────────────────────────────────────────────────
    downloaded = 0
    errors = 0
    _current_tmp: list[Path] = []

    def _sigint_handler(sig, frame):  # type: ignore[no-untyped-def]
        for p in _current_tmp:
            if p.exists():
                p.unlink()
        _info("\n[dim]Interrompu.[/]" if _RICH else "\nInterrompu.")
        sys.exit(130)

    old_handler = signal.signal(signal.SIGINT, _sigint_handler)
    dl_branch = tree.add("Téléchargements") if (_RICH and tree) else None

    try:
        for name in to_download:
            dest_path = dest_dir / name
            tmp_path = dest_path.with_suffix(dest_path.suffix + ".tmp")
            _current_tmp[:] = [tmp_path]

            ok = _download_file(supa_url, supa_secret, bucket, name, dest_path)
            _current_tmp.clear()

            if ok:
                downloaded += 1
                if dl_branch:
                    dl_branch.add(f"[green]↓ {name}[/]")  # type: ignore[union-attr]
                elif verbose:
                    _info(f"  ↓ {name}")
                _log("INFO", "file_downloaded", name=name)
            else:
                errors += 1
                if dl_branch:
                    dl_branch.add(f"[red]✗ {name}[/]")  # type: ignore[union-attr]
                else:
                    _info(f"  ✗ {name}")
                _log("ERROR", "file_error", name=name)
    finally:
        signal.signal(signal.SIGINT, old_handler)

    skipped = len(already_local)
    for name in already_local:
        _log("INFO", "file_skipped", name=name)

    if _RICH and tree:
        summary = (
            f"[bold]Terminé :[/] {downloaded} téléchargé(s), "
            f"{skipped} skip, {errors} erreur(s)"
        )
        tree.add(summary)
        console.print(tree)  # type: ignore[union-attr]
    else:
        _info(f"Terminé : {downloaded} téléchargé(s), {skipped} skip, {errors} erreur(s)")

    _log(
        "ERROR" if errors else "INFO",
        "done",
        downloaded=downloaded,
        skipped=skipped,
        errors=errors,
    )
    return {"downloaded": downloaded, "skipped": skipped, "errors": errors}


# ─────────────────────────────────────────────────────────── CLI


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Télécharge les photos manquantes depuis Supabase Storage vers local.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--dest", type=Path, default=_DEFAULT_PHOTOS_DIR,
        help="Dossier de destination (défaut : sources/photos/).",
    )
    parser.add_argument(
        "--bucket", default=None,
        help="Bucket Supabase Storage source (défaut : photos).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Affiche les actions sans rien télécharger.",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Écrase les fichiers locaux existants (défaut : skip).",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true",
        help="Logs détaillés.",
    )
    parser.add_argument(
        "--no-log", action="store_true",
        help="Désactive le fichier de log JSONL.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    if not args.no_log:
        _init_logger(_REPO_ROOT / "logs" / "update_data")

    try:
        result = pull_photos_from_storage(
            dest_dir=args.dest,
            bucket=args.bucket,
            dry_run=args.dry_run,
            force=args.force,
            verbose=args.verbose,
        )
    except KeyboardInterrupt:
        _info("\n[dim]Interrompu.[/]" if _RICH else "\nInterrompu.")
        return 130

    return 0 if result["errors"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

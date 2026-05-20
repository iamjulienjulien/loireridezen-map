#!/usr/bin/env python3
"""
update_data.py — orchestrateur CLI interactif pour la mise à jour des données.

Synchronise les sources (GPX, photos, Supabase) avec data/catalog/ en mode
bidirectionnel : ajout ET suppression des items orphelins.

  1. Scan tabulaire (Catalog / Sources / Diff) par catégorie
  2. Menu interactif avec libellés dynamiques (ajout de N, suppression de M)
  3. Écran de confirmation avant toute opération destructive
  4. Exécution des sous-scripts avec arbre visuel rich
  5. Mise à jour des catalogs JSON (data/catalog/*.json)

Sources scannées :
  - Traces     : sources/gpx/*.gpx  +  data/traces/*.geojson
  - Photos     : sources/photos/*.{jpg,jpeg,heic,png}  →  data/catalog/photos.json
  - POI        : Supabase → data/pois/pois.geojson  →  data/catalog/pois.json
  - Groupes    : data/catalog/groups.json (statique)

Dépendances :
    pip install rich>=13 questionary>=2

Usage :
    python scripts/update_data.py                         # menu interactif
    python scripts/update_data.py --all                   # tout synchroniser
    python scripts/update_data.py --add-only --traces     # ajouts traces
    python scripts/update_data.py --delete-only --photos  # suppressions photos
    python scripts/update_data.py --all --non-interactive --yes  # mode CI
    python scripts/update_data.py -v                      # verbose
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich.tree import Tree
    import questionary
except ImportError as e:
    print(f"Dépendance manquante : {e}")
    print("Installer avec : pip install rich>=13 questionary>=2")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA = REPO_ROOT / "data"
CATALOG_DIR = DATA / "catalog"
TRACES_DIR = DATA / "traces"
POIS_DIR = DATA / "pois"
PHOTOS_DIR = REPO_ROOT / "sources" / "photos"
THUMBS_DIR = DATA / "thumbs"
GPX_DROP_DIR = REPO_ROOT / "sources" / "gpx"

CATALOG_TRACES = CATALOG_DIR / "traces.json"
CATALOG_PHOTOS = CATALOG_DIR / "photos.json"
CATALOG_POIS = CATALOG_DIR / "pois.json"
CATALOG_GROUPS = CATALOG_DIR / "groups.json"

POIS_GEOJSON = POIS_DIR / "pois.geojson"
PHOTOS_GEOJSON = POIS_DIR / "pois_photos.geojson"

SCRIPTS_DIR = Path(__file__).resolve().parent
PYTHON = sys.executable

PHOTO_EXTS = {".jpg", ".jpeg", ".heic", ".heif", ".png"}
KNOWN_GROUPS = ["acte-1", "acte-2", "acte-3", "micro-aventure"]

console = Console()


# ---------------------------------------------------------------------------
# Catalog I/O
# ---------------------------------------------------------------------------

def load_catalog(path: Path) -> tuple[list[dict], str | None]:
    """Retourne (items, updated_at). Gère les tableaux plats (ancien format)."""
    if not path.exists():
        return [], None
    with path.open(encoding="utf-8") as f:
        raw = json.load(f)
    if isinstance(raw, list):
        return raw, None
    return raw.get("items", []), raw.get("updated_at")


def save_catalog(path: Path, items: list[dict], verbose: bool = False) -> None:
    """Écrit {updated_at, items} en UTF-8 indenté."""
    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "items": items,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    if verbose:
        console.print(f"  [green]✓[/] catalog mis à jour : {path.relative_to(REPO_ROOT)}")


# ---------------------------------------------------------------------------
# Scan
# ---------------------------------------------------------------------------

def scan_sources(verbose: bool = False) -> dict:
    """
    Retourne un dict avec pour chaque catégorie :
      catalog_count, sources_count, diff, to_add, to_delete
    """
    result: dict = {}

    # --- Traces ---
    trace_items, _ = load_catalog(CATALOG_TRACES)
    catalog_trace_ids = {it["id"] for it in trace_items}

    # Fichiers .geojson non simplifiés présents dans data/traces/
    existing_geojsons = {
        p.stem: p for p in TRACES_DIR.glob("*.geojson")
        if "_simplified" not in p.stem
    } if TRACES_DIR.exists() else {}

    # GPX en attente dans le drop dir
    pending_gpx = sorted(GPX_DROP_DIR.glob("*.gpx")) if GPX_DROP_DIR.exists() else []
    gpx_stems = {g.stem for g in pending_gpx}

    # to_add : GPX dont le stem n'est pas en catalog
    to_add_traces = [g for g in pending_gpx if g.stem not in catalog_trace_ids]
    # to_delete : GeoJSON manquant OU source GPX déclarée mais absente de sources/gpx/
    to_delete_traces = [
        it for it in trace_items
        if (
            it.get("paths", {}).get("full") and
            not (REPO_ROOT / it["paths"]["full"]).exists()
        ) or (
            it.get("source") and
            it["source"].startswith("sources/gpx/") and
            not (REPO_ROOT / it["source"]).exists()
        )
    ]

    # "Sources" = GPX en attente uniquement (pas les GeoJSON déjà traités)
    sources_count_traces = len(pending_gpx)
    diff_traces = len(to_add_traces) - len(to_delete_traces)

    result["traces"] = {
        "catalog_count": len(trace_items),
        "sources_count": sources_count_traces,
        "diff": diff_traces,
        "to_add": to_add_traces,
        "to_delete": to_delete_traces,
    }

    # --- Photos ---
    photo_items, _ = load_catalog(CATALOG_PHOTOS)
    existing_thumb_stems = {
        Path(it["paths"]["thumb"]).stem
        for it in photo_items
        if it.get("paths", {}).get("thumb")
    }

    local_photos = sorted(
        p for p in PHOTOS_DIR.glob("*") if p.suffix.lower() in PHOTO_EXTS
    ) if PHOTOS_DIR.exists() else []
    local_photo_stems = {p.stem for p in local_photos}

    to_add_photos = [p for p in local_photos if p.stem not in existing_thumb_stems]
    # Une entrée catalog est orpheline si son thumb n'existe plus dans THUMBS_DIR
    # (on compare par stem pour être agnostique au chemin relatif stocké)
    existing_thumb_files = {p.stem for p in THUMBS_DIR.glob("*.webp")} if THUMBS_DIR.exists() else set()
    to_delete_photos = [
        it for it in photo_items
        if it.get("paths", {}).get("thumb") and
        Path(it["paths"]["thumb"]).stem not in existing_thumb_files
    ]

    diff_photos = len(local_photos) - len(photo_items)

    result["photos"] = {
        "catalog_count": len(photo_items),
        "sources_count": len(local_photos),
        "diff": diff_photos,
        "to_add": to_add_photos,
        "to_delete": to_delete_photos,
    }

    # --- POI (source = Supabase, pas de comptage local) ---
    poi_items, _ = load_catalog(CATALOG_POIS)
    src_pois: list[dict] = []
    if POIS_GEOJSON.exists():
        with POIS_GEOJSON.open(encoding="utf-8") as f:
            src_pois = json.load(f).get("features", [])
    existing_poi_ids = {it["id"] for it in poi_items}
    src_poi_ids = {f["properties"].get("id") for f in src_pois}

    to_add_pois = [f for f in src_pois if f["properties"].get("id") not in existing_poi_ids]
    orphan_pois = [it for it in poi_items if it["id"] not in src_poi_ids]
    if orphan_pois and verbose:
        console.print(
            f"  [yellow]⚠[/] {len(orphan_pois)} POI(s) orphelin(s) dans le catalog"
        )

    result["pois"] = {
        "catalog_count": len(poi_items),
        "sources_count": None,
        "diff": None,
        "to_add": to_add_pois,
        "to_delete": [],
    }

    # --- Groupes ---
    group_items, _ = load_catalog(CATALOG_GROUPS)
    result["groups"] = {
        "catalog_count": len(group_items),
        "sources_count": len(KNOWN_GROUPS),
        "diff": len(KNOWN_GROUPS) - len(group_items),
        "to_add": [],
        "to_delete": [],
    }

    return result


def _fmt_diff(diff: int | None) -> str:
    if diff is None:
        return "[dim]N/A[/]"
    if diff > 0:
        return f"[green]+{diff}[/]"
    if diff < 0:
        return f"[red]{diff}[/]"
    return "[dim]0[/]"


def print_scan_table(scan: dict) -> None:
    console.print(Panel(
        "[bold]Scan des sources 🔎[/]",
        title="🚲 Loire Ride Zen — Mise à jour des données",
        border_style="blue",
    ))
    table = Table(show_header=True, header_style="bold cyan", box=None, pad_edge=False)
    table.add_column("Catégorie", style="bold", min_width=10)
    table.add_column("Catalog", justify="right", min_width=8)
    table.add_column("Sources", justify="right", min_width=8)
    table.add_column("Diff", justify="right", min_width=6)

    rows = [
        ("Traces",  "traces"),
        ("Photos",  "photos"),
        ("POI",     "pois"),
        ("Groupes", "groups"),
    ]
    for label, key in rows:
        s = scan[key]
        src = "—" if s["sources_count"] is None else str(s["sources_count"])
        table.add_row(
            label,
            str(s["catalog_count"]),
            src,
            _fmt_diff(s["diff"]),
        )

    console.print(table)
    console.print()


# ---------------------------------------------------------------------------
# Helpers — prompts éditoriaux
# ---------------------------------------------------------------------------

def _humanize(stem: str) -> str:
    return stem.replace("-", " ").replace("_", " ").title()


def prompt_trace_meta(gpx_path: Path, non_interactive: bool) -> dict:
    stem = gpx_path.stem
    defaults = {"label": _humanize(stem), "group": "acte-2", "description": ""}
    if non_interactive:
        return defaults

    label = questionary.text(f"Label pour '{stem}' :", default=defaults["label"]).ask()
    group = questionary.select(
        "Groupe :", choices=KNOWN_GROUPS, default=defaults["group"]
    ).ask()
    description = questionary.text("Description (optionnelle) :", default="").ask()

    if label is None or group is None:
        console.print("[red]Annulé.[/]")
        sys.exit(0)
    return {"label": label or defaults["label"], "group": group, "description": description or ""}


def prompt_photo_meta(photo_path: Path, non_interactive: bool) -> dict:
    defaults = {"label": _humanize(photo_path.stem), "description": ""}
    if non_interactive:
        return defaults

    label = questionary.text(
        f"Label pour '{photo_path.name}' :", default=defaults["label"]
    ).ask()
    description = questionary.text("Description (optionnelle) :", default="").ask()

    if label is None:
        console.print("[red]Annulé.[/]")
        sys.exit(0)
    return {"label": label or defaults["label"], "description": description or ""}


# ---------------------------------------------------------------------------
# Menu interactif
# ---------------------------------------------------------------------------

def _trace_label(scan: dict) -> str:
    n_add = len(scan["traces"]["to_add"])
    n_del = len(scan["traces"]["to_delete"])
    if n_add and n_del:
        return f"Traces seulement (ajout de {n_add}, suppression de {n_del})"
    if n_add:
        return f"Traces seulement (ajout de {n_add})"
    if n_del:
        return f"Traces seulement (suppression de {n_del})"
    return "Traces seulement"


def _photo_label(scan: dict) -> str:
    n_add = len(scan["photos"]["to_add"])
    n_del = len(scan["photos"]["to_delete"])
    if n_add and n_del:
        return f"Photos seulement (ajout de {n_add}, suppression de {n_del})"
    if n_add:
        return f"Photos seulement (ajout de {n_add})"
    if n_del:
        return f"Photos seulement (suppression de {n_del})"
    return "Photos seulement"


def interactive_menu(scan: dict) -> tuple[str, str]:
    """Retourne (action, mode) : action in {all,traces,photos,pois,quit}, mode in {add,delete,both}."""
    total_add = len(scan["traces"]["to_add"]) + len(scan["photos"]["to_add"])
    total_del = len(scan["traces"]["to_delete"]) + len(scan["photos"]["to_delete"])
    total_diff = total_add + total_del

    if total_diff == 0 and not scan["pois"]["to_add"]:
        console.print("[green]✓ Tout est aligné[/]")
        choice = questionary.select(
            "Que voulez-vous faire ?",
            choices=["POI avec la base de données", "Quitter"],
        ).ask()
        if choice == "Quitter" or choice is None:
            return "quit", "both"
        return "pois", "both"

    choices = [
        "Tout ajouter",
        "Tout supprimer",
        _trace_label(scan),
        _photo_label(scan),
        "POI avec la base de données",
        "Quitter",
    ]
    choice = questionary.select("Que voulez-vous synchroniser ?", choices=choices).ask()
    if choice is None or choice == "Quitter":
        return "quit", "both"
    if choice == "Tout ajouter":
        return "all", "add"
    if choice == "Tout supprimer":
        return "all", "delete"
    if choice.startswith("Traces"):
        return "traces", "both"
    if choice.startswith("Photos"):
        return "photos", "both"
    if choice.startswith("POI"):
        return "pois", "both"
    return "quit", "both"


# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------

def confirm_operations(scan: dict, do_traces: bool, do_photos: bool, do_pois: bool,
                       mode: str, args: argparse.Namespace) -> bool:
    """Affiche le récap et demande confirmation. Retourne False si annulé."""
    if getattr(args, "yes", False):
        return True

    lines: list[str] = []
    if do_traces:
        n_add = len(scan["traces"]["to_add"])
        n_del = len(scan["traces"]["to_delete"])
        if mode in ("add", "both") and n_add:
            lines.append(f"  [green]+{n_add}[/] trace(s) à ajouter")
        if mode in ("delete", "both") and n_del:
            lines.append(f"  [red]-{n_del}[/] trace(s) à supprimer")
    if do_photos:
        n_add = len(scan["photos"]["to_add"])
        n_del = len(scan["photos"]["to_delete"])
        if mode in ("add", "both") and n_add:
            lines.append(f"  [green]+{n_add}[/] photo(s) à ajouter")
        if mode in ("delete", "both") and n_del:
            lines.append(f"  [red]-{n_del}[/] photo(s) à supprimer (thumb local uniquement)")
    if do_pois:
        lines.append("  Synchronisation POI depuis Supabase")

    if not lines:
        return True

    console.print(Panel("\n".join(lines), title="Opérations prévues", border_style="yellow"))

    if args.non_interactive:
        # non-interactive sans --yes : refus si suppressions
        has_deletes = (
            (do_traces and mode in ("delete", "both") and scan["traces"]["to_delete"]) or
            (do_photos and mode in ("delete", "both") and scan["photos"]["to_delete"])
        )
        if has_deletes:
            console.print(
                "[red]Refus de procéder : suppressions détectées en mode non-interactif. "
                "Utiliser --yes pour confirmer.[/]"
            )
            sys.exit(2)
        return True

    confirmed = questionary.confirm("Confirmer ces opérations ?", default=True).ask()
    if not confirmed:
        console.print("[dim]Annulé.[/]")
        return False
    return True


# ---------------------------------------------------------------------------
# Subprocess runner
# ---------------------------------------------------------------------------

def run_script(cmd: list[str], label: str, tree: Tree, verbose: bool) -> bool:
    branch = tree.add(f"[cyan]{label}[/]")
    try:
        subprocess.run(
            cmd,
            cwd=str(REPO_ROOT),
            capture_output=not verbose,
            text=True,
            check=True,
        )
        branch.add("[green]✓ succès[/]")
        return True
    except subprocess.CalledProcessError as e:
        branch.add(f"[red]✗ erreur (exit {e.returncode})[/]")
        if e.stdout:
            console.print(e.stdout)
        if e.stderr:
            console.print(f"[red]{e.stderr}[/]")
        return False
    except FileNotFoundError:
        branch.add(f"[red]✗ commande introuvable : {cmd[0]}[/]")
        return False


# ---------------------------------------------------------------------------
# Suppressions
# ---------------------------------------------------------------------------

def delete_orphan_traces(to_delete: list[dict], trace_items: list[dict],
                         tree: Tree, verbose: bool) -> list[dict]:
    """Supprime les fichiers et retire les entrées orphelines du catalog. Retourne les items mis à jour."""
    delete_ids = {it["id"] for it in to_delete}
    for item in to_delete:
        for path_key in ("full", "simplified"):
            rel = item.get("paths", {}).get(path_key, "")
            if not rel:
                continue
            path = REPO_ROOT / rel
            if path.exists():
                path.unlink()
                tree.add(f"[red]✗[/] supprimé {path.relative_to(REPO_ROOT)}")
            else:
                tree.add(f"[dim]déjà absent {rel}[/]")
        tree.add(f"[red]−[/] retiré du catalog : {item['id']}")
    return [it for it in trace_items if it["id"] not in delete_ids]


def delete_orphan_photos(to_delete: list[dict], photo_items: list[dict],
                         tree: Tree, verbose: bool) -> list[dict]:
    """Supprime les thumbs locaux et retire les entrées orphelines. Retourne les items mis à jour."""
    tree.add("[yellow]⚠ Supabase Storage non modifié — suppression manuelle si nécessaire[/]")
    delete_ids = {it["id"] for it in to_delete}
    for item in to_delete:
        thumb = item.get("paths", {}).get("thumb", "")
        if thumb:
            # Chercher le thumb dans THUMBS_DIR par stem (chemin stocké peut être relatif)
            thumb_path = THUMBS_DIR / (Path(thumb).stem + ".webp")
            if thumb_path.exists():
                thumb_path.unlink()
                tree.add(f"[red]✗[/] supprimé {thumb_path.relative_to(REPO_ROOT)}")
            else:
                tree.add(f"[dim]thumb déjà absent : {thumb}[/]")
        tree.add(f"[red]−[/] retiré du catalog : {item['id']}")
    return [it for it in photo_items if it["id"] not in delete_ids]


# ---------------------------------------------------------------------------
# Sync — Traces
# ---------------------------------------------------------------------------

def sync_traces(scan: dict, args: argparse.Namespace, mode: str = "both") -> bool:
    to_add: list[Path] = scan["traces"]["to_add"]
    to_delete: list[dict] = scan["traces"]["to_delete"]

    do_add = mode in ("add", "both") and bool(to_add)
    do_delete = mode in ("delete", "both") and bool(to_delete)

    if not do_add and not do_delete:
        console.print("[dim]Traces : rien à faire.[/]")
        return True

    console.rule("[bold]Traces")
    tree = Tree("[bold cyan]Traces")
    all_ok = True
    trace_items, _ = load_catalog(CATALOG_TRACES)

    if do_add:
        for gpx_path in to_add:
            meta = prompt_trace_meta(gpx_path, args.non_interactive)
            stem = gpx_path.stem
            out_full = TRACES_DIR / f"{stem}.geojson"
            out_simplified = TRACES_DIR / f"{stem}_simplified.geojson"

            ok = run_script(
                [PYTHON, str(SCRIPTS_DIR / "gpx_to_geojson.py"), str(gpx_path), "-o", str(out_full)],
                f"{gpx_path.name} → {out_full.name}",
                tree, args.verbose,
            )
            if not ok:
                all_ok = False
                continue

            run_script(
                [PYTHON, str(SCRIPTS_DIR / "gpx_to_geojson.py"), str(gpx_path),
                 "-o", str(out_simplified), "--simplify", "0.0001"],
                f"{gpx_path.name} → {out_simplified.name} (simplifié)",
                tree, args.verbose,
            )

            entry: dict = {
                "id": stem,
                "label": meta["label"],
                "group": meta["group"],
                "paths": {
                    "full": str(out_full.relative_to(REPO_ROOT)),
                    "simplified": str(out_simplified.relative_to(REPO_ROOT)),
                },
                "source": str(gpx_path.relative_to(REPO_ROOT)),
                "order": len(trace_items) + 1,
                "distance_km": None,
                "elevation_gain_m": None,
            }
            if meta.get("description"):
                entry["description"] = meta["description"]
            trace_items.append(entry)

    if do_delete:
        trace_items = delete_orphan_traces(to_delete, trace_items, tree, args.verbose)

    save_catalog(CATALOG_TRACES, trace_items, args.verbose)
    console.print(tree)
    return all_ok


# ---------------------------------------------------------------------------
# Sync — Photos
# ---------------------------------------------------------------------------

def sync_photos(scan: dict, args: argparse.Namespace, mode: str = "both") -> bool:
    to_add: list[Path] = scan["photos"]["to_add"]
    to_delete: list[dict] = scan["photos"]["to_delete"]

    do_add = mode in ("add", "both") and bool(to_add)
    do_delete = mode in ("delete", "both") and bool(to_delete)

    if not do_add and not do_delete:
        console.print("[dim]Photos : rien à faire.[/]")
        return True

    if do_add and not os.environ.get("SUPA_SECRET_KEY"):
        console.print(
            "[yellow]⚠ SUPA_SECRET_KEY non définie — l'upload Supabase sera ignoré.[/]\n"
            "  Définir avec : export SUPA_SECRET_KEY='sb_secret_...'"
        )

    if do_add and not args.non_interactive:
        for photo in to_add:
            prompt_photo_meta(photo, non_interactive=False)

    console.rule("[bold]Photos")
    tree = Tree("[bold cyan]Photos")
    all_ok = True
    photo_items, _ = load_catalog(CATALOG_PHOTOS)

    if do_add:
        thumbs_cmd = [
            PYTHON, str(SCRIPTS_DIR / "make_thumbs.py"),
            "--photos", str(PHOTOS_DIR),
            "--thumbs", str(THUMBS_DIR),
            "--skip-existing", "--quality", "80",
        ]
        if args.verbose:
            thumbs_cmd.append("--verbose")
        ok = run_script(thumbs_cmd, "make_thumbs.py", tree, args.verbose)
        all_ok = all_ok and ok

        if os.environ.get("SUPA_SECRET_KEY"):
            ok = run_script(
                [PYTHON, str(SCRIPTS_DIR / "sync_photos_to_supabase.py")],
                "sync_photos_to_supabase.py", tree, args.verbose,
            )
            all_ok = all_ok and ok
        else:
            tree.add("[yellow]⚠ sync_photos_to_supabase.py ignoré (pas de SUPA_SECRET_KEY)[/]")

        ok = run_script(
            [PYTHON, str(SCRIPTS_DIR / "photos_to_poi.py"), "--out", str(PHOTOS_GEOJSON)],
            "photos_to_poi.py", tree, args.verbose,
        )
        all_ok = all_ok and ok
        photo_items = _merge_photos_from_geojson(photo_items, tree, args.verbose)

    if do_delete:
        photo_items = delete_orphan_photos(to_delete, photo_items, tree, args.verbose)
        # Nettoyer pois_photos.geojson des entrées dont le thumb n'existe plus
        _filter_photos_geojson(tree)

    save_catalog(CATALOG_PHOTOS, photo_items, args.verbose)
    console.print(tree)
    return all_ok


def _merge_photos_from_geojson(photo_items: list[dict], tree: Tree, verbose: bool) -> list[dict]:
    """Fusionne les nouvelles entrées de pois_photos.geojson dans photos.json."""
    if not PHOTOS_GEOJSON.exists():
        return photo_items
    with PHOTOS_GEOJSON.open(encoding="utf-8") as f:
        features = json.load(f).get("features", [])

    existing_thumbs = {
        Path(it["paths"]["thumb"]).stem
        for it in photo_items
        if it.get("paths", {}).get("thumb")
    }
    added = 0
    for i, feature in enumerate(features, start=len(photo_items) + 1):
        p = feature["properties"]
        thumb = p.get("thumb", "")
        stem = Path(thumb).stem if thumb else ""
        if stem in existing_thumbs:
            continue
        coords = feature["geometry"]["coordinates"]
        lon, lat = coords[0], coords[1]
        remote = p.get("image", "")
        ext = Path(remote.split("?")[0]).suffix if remote else ".jpeg"
        if not ext:
            ext = ".jpeg"
        time_raw = p.get("time", "")
        # Convert EXIF time "2025:06:06 14:22:09" → ISO "2025-06-06T14:22:09"
        if time_raw and ":" in time_raw[:4]:
            try:
                date_part, time_part = time_raw.split(" ", 1)
                time_iso = f"{date_part.replace(':', '-')}T{time_part}"
            except Exception:
                time_iso = time_raw
        else:
            time_iso = time_raw
        photo_items.append({
            "id": stem or f"photo-{i:02d}",
            "label": p.get("name", ""),
            "description": "",
            "group": "acte-2",
            "paths": {
                "thumb": f"data/thumbs/{stem}.webp" if stem else thumb,
                "remote": remote,
            },
            "source": f"sources/photos/{stem}{ext}" if stem else "",
            "order": i,
            "time": time_iso,
            "lat": lat,
            "lon": lon,
        })
        added += 1
    if added:
        tree.add(f"[green]+{added}[/] photo(s) ajoutée(s) au catalog")
    return photo_items


def _filter_photos_geojson(tree: Tree) -> None:
    """Retire de pois_photos.geojson les entrées dont le thumb local n'existe plus."""
    if not PHOTOS_GEOJSON.exists():
        return
    with PHOTOS_GEOJSON.open(encoding="utf-8") as f:
        fc = json.load(f)
    before = len(fc.get("features", []))
    fc["features"] = [
        ft for ft in fc.get("features", [])
        if (THUMBS_DIR / (Path(ft["properties"].get("thumb", "")).stem + ".webp")).exists()
    ]
    after = len(fc["features"])
    if before != after:
        with PHOTOS_GEOJSON.open("w", encoding="utf-8") as f:
            json.dump(fc, f, ensure_ascii=False, indent=2)
        tree.add(f"[dim]pois_photos.geojson mis à jour ({before} → {after} entrées)[/]")


# ---------------------------------------------------------------------------
# Sync — POI
# ---------------------------------------------------------------------------

def sync_pois(scan: dict, args: argparse.Namespace) -> bool:
    console.rule("[bold]POI")
    tree = Tree("[bold cyan]POI")

    pois_cmd = [PYTHON, str(SCRIPTS_DIR / "sync_pois_from_supabase.py"), "-o", str(POIS_GEOJSON)]
    if args.verbose:
        pois_cmd.append("-v")
    ok = run_script(pois_cmd, "sync_pois_from_supabase.py", tree, args.verbose)

    if ok and POIS_GEOJSON.exists():
        with POIS_GEOJSON.open(encoding="utf-8") as f:
            features = json.load(f).get("features", [])
        poi_items = [
            {
                "id": f["properties"].get("id", ""),
                "label": f["properties"].get("name", ""),
                "type": f["properties"].get("type", ""),
                "group": "acte-2",
                "stage": f["properties"].get("stage"),
            }
            for f in features
        ]
        # pois.json has extra top-level fields beyond {updated_at, items}
        payload = {
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "synced_from": "supabase",
            "count": len(poi_items),
            "items": poi_items,
        }
        CATALOG_POIS.parent.mkdir(parents=True, exist_ok=True)
        with CATALOG_POIS.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        if args.verbose:
            console.print(f"  [green]✓[/] catalog mis à jour : {CATALOG_POIS.relative_to(REPO_ROOT)}")
        tree.add(f"[green]✓ pois.json mis à jour ({len(poi_items)} entrées)[/]")

    console.print(tree)
    return ok


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Orchestrateur de mise à jour des données Loire Ride Zen.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--all", action="store_true", help="Synchroniser toutes les catégories")
    parser.add_argument("--traces", action="store_true", help="Traces seulement")
    parser.add_argument("--photos", action="store_true", help="Photos seulement")
    parser.add_argument("--pois", action="store_true", help="POI seulement")
    parser.add_argument("--add-only", action="store_true", help="Ajouts uniquement (pas de suppression)")
    parser.add_argument("--delete-only", action="store_true", help="Suppressions uniquement (pas d'ajout)")
    parser.add_argument("--non-interactive", action="store_true", help="Pas de prompts interactifs (mode CI)")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip l'écran de confirmation")
    parser.add_argument("-v", "--verbose", action="store_true", help="Logs détaillés")
    args = parser.parse_args()

    # Déduire le mode add/delete/both depuis les flags
    if args.add_only and args.delete_only:
        console.print("[red]--add-only et --delete-only sont mutuellement exclusifs.[/]")
        sys.exit(1)
    if args.add_only:
        mode = "add"
    elif args.delete_only:
        mode = "delete"
    else:
        mode = "both"

    # --- Scan ---
    scan = scan_sources(verbose=args.verbose)
    print_scan_table(scan)

    # Vérifier si tout est déjà aligné (sans flag de sync explicite)
    has_work = (
        scan["traces"]["to_add"] or scan["traces"]["to_delete"] or
        scan["photos"]["to_add"] or scan["photos"]["to_delete"] or
        scan["pois"]["to_add"]
    )
    if not has_work and not (args.all or args.traces or args.photos or args.pois):
        console.print("[green]✓ Tout est déjà à jour.[/]")
        sys.exit(0)

    # --- Déterminer ce qu'on synchronise ---
    if args.all:
        do_traces = do_photos = do_pois = True
    elif args.traces or args.photos or args.pois:
        do_traces = args.traces
        do_photos = args.photos
        do_pois = args.pois
    elif args.non_interactive:
        console.print("[dim]Aucun flag de sync fourni. Utiliser --all ou --traces/--photos/--pois.[/]")
        sys.exit(0)
    else:
        action, mode = interactive_menu(scan)
        if action == "quit":
            console.print("[dim]Annulé.[/]")
            sys.exit(0)
        do_traces = action in ("all", "traces")
        do_photos = action in ("all", "photos")
        do_pois = action in ("all", "pois")

    # --- Garde-fou : non-interactive + suppressions sans --yes ---
    has_deletes = (
        (do_traces and mode in ("delete", "both") and scan["traces"]["to_delete"]) or
        (do_photos and mode in ("delete", "both") and scan["photos"]["to_delete"])
    )
    if args.non_interactive and not args.yes and has_deletes:
        console.print(
            "[red]Refus de procéder : suppressions détectées en mode non-interactif. "
            "Utiliser --yes pour confirmer.[/]"
        )
        sys.exit(2)

    # --- Confirmation ---
    if not confirm_operations(scan, do_traces, do_photos, do_pois, mode, args):
        sys.exit(0)

    # --- Exécution ---
    all_ok = True
    console.rule("[bold]Exécution")

    if do_traces:
        ok = sync_traces(scan, args, mode=mode)
        all_ok = all_ok and ok

    if do_photos:
        ok = sync_photos(scan, args, mode=mode)
        all_ok = all_ok and ok

    if do_pois:
        ok = sync_pois(scan, args)
        all_ok = all_ok and ok

    # --- Résumé ---
    console.rule("[bold]Résumé")
    scan_after = scan_sources()
    stats_tree = Tree("[bold]Catalogs après mise à jour")
    for label, key in [("Traces", "traces"), ("Photos", "photos"), ("POI", "pois"), ("Groupes", "groups")]:
        stats_tree.add(f"{label} : [cyan]{scan_after[key]['catalog_count']}[/] entrées")
    console.print(stats_tree)

    if all_ok:
        console.print("\n[green]✓ Synchronisation terminée.[/]")
        sys.exit(0)
    else:
        console.print("\n[red]✗ Des erreurs ont été rencontrées (voir ci-dessus).[/]")
        sys.exit(1)


if __name__ == "__main__":
    main()

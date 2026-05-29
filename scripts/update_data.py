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
    python scripts/update_data.py --no-log                # sans fichier de log
    python scripts/update_data.py -v                      # verbose
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import uuid
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

# questionary stores the title as value when value=None — use this sentinel instead
_CANCEL = "__cancel__"

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
LOG_DIR_DEFAULT = REPO_ROOT / "logs" / "update_data"

PHOTO_EXTS = {".jpg", ".jpeg", ".heic", ".heif", ".png"}
PHOTO_FILENAME_RE = re.compile(r"^(\d+)-(.+)$")
KNOWN_GROUPS = ["acte-1", "acte-2", "acte-3", "micro-aventure"]
DEFAULT_GROUP_ID = "acte-3"

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DURATION_HM_RE = re.compile(r"^(\d+)h(\d{0,2})$", re.IGNORECASE)
DATE_STATUS_CHOICES = ["effective", "approximative", "planned", "inconnue"]
WEATHER_ICONS = ["☀️", "🌤️", "⛅", "🌥️", "☁️", "🌦️", "🌧️", "⛈️", "🌩️", "❄️", "🌬️", "🌫️"]

console = Console()

# ---------------------------------------------------------------------------
# POI — constantes visuelles (indépendant de supabase-py)
# ---------------------------------------------------------------------------

_POI_TYPE_EMOJIS: dict[str, str] = {
    "chateau": "👑",
    "coupdecoeur": "💖",
    "patrimoine": "🏰",
    "guinguette": "🍻",
    "hébergement": "🏕️",
    "vigneron": "🍷",
    "nature": "🌿",
    "photo": "📸",
}
_POI_VALID_TYPES: tuple[str, ...] = (
    "chateau", "coupdecoeur", "patrimoine", "guinguette", "hébergement",
    "vigneron", "nature", "lapin",
)
_INSTA_RE = re.compile(r"^https?://(www\.)?instagram\.com/.+")
_KOMOOT_RE = re.compile(r"^https?://(www\.)?komoot\.(com|de)/tour/\d+")


def parse_duration(s: str) -> float | None:
    """Parse '3h30', '3h', '1h45' → float heures. Accepte aussi un float brut."""
    s = s.strip()
    m = DURATION_HM_RE.match(s)
    if m:
        h = int(m.group(1))
        mins = int(m.group(2)) if m.group(2) else 0
        return round(h + mins / 60, 4)
    try:
        return float(s)
    except ValueError:
        return None


def parse_temp(s: str) -> int | None:
    """Parse '22', '22°', '-5°C' → int."""
    cleaned = s.strip().rstrip("C").rstrip("°").strip()
    try:
        return int(cleaned)
    except ValueError:
        return None


def format_weather(w: dict | None) -> str:
    if not w:
        return "—"
    parts = []
    if w.get("icon"):
        parts.append(w["icon"])
    if w.get("description"):
        parts.append(w["description"])
    temps = []
    if w.get("temp_min") is not None:
        temps.append(f"{w['temp_min']}°")
    if w.get("temp_max") is not None:
        temps.append(f"{w['temp_max']}°")
    if temps:
        parts.append(f"({' / '.join(temps)})")
    return " ".join(parts) if parts else "—"


def _resolve_poi_name(poi_id: str | None) -> str:
    """Résout un poi_id en 'emoji nom' lisible. Retourne '' si absent."""
    if not poi_id or not _SUPABASE_AVAILABLE:
        return ""
    try:
        poi = _get_poi(poi_id)
        if not poi:
            return f"⚠ POI orphelin ({poi_id[:8]}...)"
        emoji = _POI_TYPE_EMOJIS.get(poi.get("type", ""), "📍")
        return f"{emoji} {poi.get('name', '(sans nom)')}"
    except Exception:
        return f"⚠ Erreur résolution ({poi_id[:8]}...)"


def _find_photos_attached_to_poi(poi_id: str) -> list[dict]:
    """Retourne les items de photos.json dont le poi_id correspond."""
    photos, _ = load_catalog(CATALOG_PHOTOS)
    return [p for p in photos if p.get("poi_id") == poi_id]


def _update_photo_poi_in_geojson(photo_id: str, poi_id: str | None) -> None:
    """Met à jour (ou retire) poi_id dans pois_photos.geojson pour un photo donné."""
    if not PHOTOS_GEOJSON.exists():
        return
    with PHOTOS_GEOJSON.open(encoding="utf-8") as f:
        fc = json.load(f)
    changed = False
    for feat in fc.get("features", []):
        props = feat.get("properties", {})
        # Match par id exact (nouveau format) ou par stem du thumb (legacy)
        feat_id = props.get("id") or Path(props.get("thumb", "")).stem
        if feat_id == photo_id:
            if poi_id:
                props["poi_id"] = poi_id
            else:
                props.pop("poi_id", None)
            changed = True
    if changed:
        with PHOTOS_GEOJSON.open("w", encoding="utf-8") as f:
            json.dump(fc, f, ensure_ascii=False, indent=2)


# Lib Supabase — import optionnel (dispo si supabase>=2.5.0 installé)
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

_GEOCODING_AVAILABLE = False
try:
    import requests as _requests
    from lib.geocoding import geocode_address as _geocode_address  # type: ignore[import]
    from lib.geocoding import format_result_label as _format_result_label  # type: ignore[import]
    from lib.geocoding import reverse_geocode as _reverse_geocode  # type: ignore[import]
    _GEOCODING_AVAILABLE = True
except ImportError:
    pass

_EXIF_AVAILABLE = False
try:
    from photos_to_poi import extract_gps as _extract_gps  # type: ignore[import]
    _EXIF_AVAILABLE = True
except ImportError:
    pass

_SUPABASE_AVAILABLE = False
try:
    from lib.poi import (  # type: ignore[import]
        list_pois as _list_pois,
        get_poi as _get_poi,
        create_poi as _create_poi,
        update_poi as _update_poi,
        delete_poi as _delete_poi,
        coords_from_poi as _coords_from_poi,
        ewkt_point as _ewkt_point,
    )
    _SUPABASE_AVAILABLE = True
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Logging JSONL
# ---------------------------------------------------------------------------

_RUN_ID: str = uuid.uuid4().hex[:8]
_LOG_PATH: Path | None = None
_LOG_WARN_SHOWN: bool = False


def init_logger(log_dir: Path) -> Path | None:
    global _LOG_PATH
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        today = datetime.now().strftime("%Y-%m-%d")
        _LOG_PATH = log_dir / f"{today}.jsonl"
        return _LOG_PATH
    except Exception as e:
        console.print(f"[yellow]⚠ Logger non initialisé : {e}[/]")
        return None


def log_event(level: str, category: str, action: str, **data) -> None:
    global _LOG_WARN_SHOWN
    if _LOG_PATH is None:
        return
    try:
        entry = {
            "ts": datetime.now().astimezone().isoformat(timespec="milliseconds"),
            "run_id": _RUN_ID,
            "level": level,
            "category": category,
            "action": action,
            "data": data,
        }
        with _LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        if not _LOG_WARN_SHOWN:
            console.print(f"[yellow]⚠ Échec d'écriture dans le log ({_LOG_PATH}) : {e}[/]")
            _LOG_WARN_SHOWN = True


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
    items_before = 0
    if path.exists():
        try:
            with path.open(encoding="utf-8") as f:
                raw = json.load(f)
            prev = raw.get("items", raw) if isinstance(raw, dict) else raw
            items_before = len(prev)
        except Exception:
            pass

    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "items": items,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    log_event("INFO", "catalog", "update",
              file=str(path.relative_to(REPO_ROOT)),
              items_before=items_before,
              items_after=len(items))

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

    existing_geojsons = {
        p.stem: p for p in TRACES_DIR.glob("*.geojson")
        if "_simplified" not in p.stem
    } if TRACES_DIR.exists() else {}

    pending_gpx = sorted(GPX_DROP_DIR.glob("*.gpx")) if GPX_DROP_DIR.exists() else []

    to_add_traces = [g for g in pending_gpx if g.stem not in catalog_trace_ids]
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

    to_add_photos = [p for p in local_photos if p.stem not in existing_thumb_stems]
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

    log_event("INFO", "scan", "done",
              traces={"catalog": len(trace_items), "to_add": len(to_add_traces), "to_delete": len(to_delete_traces)},
              photos={"catalog": len(photo_items), "to_add": len(to_add_photos), "to_delete": len(to_delete_photos)},
              pois={"catalog": len(poi_items), "to_add": len(to_add_pois)})

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


def _clean(s: str) -> str:
    """Remove known group prefixes and numeric step markers, then title-case."""
    s = re.sub(r"^(acte-\d+|micro-aventure)[_-]", "", s, flags=re.IGNORECASE)
    # etape-N or etape_N → keep "Étape N " prefix
    m = re.match(r"etape[_-](\d+)[_-]?(.*)", s, re.IGNORECASE)
    if m:
        step = m.group(1)
        # Split on underscore only: dashes stay inside place names (e.g. boissy-st-culle)
        rest_parts = [p.title() for p in m.group(2).strip().split("_") if p]
        if len(rest_parts) == 2:
            rest = f"{rest_parts[0]} ➡️ {rest_parts[1]}"
        else:
            rest = " ".join(rest_parts)
        return f"Étape {step} {rest}".strip() if rest else f"Étape {step}"
    # Underscore-separated → distinct place names (A ➡️ B); dash → compound word
    if "_" in s and "-" not in s:
        parts = [p.title() for p in s.split("_") if p]
        if len(parts) == 2:
            return f"{parts[0]} ➡️ {parts[1]}"
        return " ".join(parts)
    parts = re.split(r"[_-]", s)
    return " ".join(p.title() for p in parts if p)


def build_photo_defaults(stem: str) -> dict:
    """Parse <order>-<slug> filenames → label propre + order numérique."""
    m = PHOTO_FILENAME_RE.match(stem)
    if m:
        return {
            "label": m.group(2).replace("-", " ").title(),
            "order": int(m.group(1)),
        }
    return {"label": _humanize(stem), "order": None}


def build_trace_defaults(gpx_path: Path) -> dict:
    stem = gpx_path.stem
    group_id = DEFAULT_GROUP_ID
    for g in KNOWN_GROUPS:
        if stem.lower().startswith(g + "_") or stem.lower().startswith(g + "-"):
            group_id = g
            break
    label = _clean(stem)
    return {"label": label, "group": group_id, "description": ""}


def prompt_trace_meta(gpx_path: Path, non_interactive: bool) -> dict:
    defaults = build_trace_defaults(gpx_path)
    if non_interactive:
        return defaults

    stem = gpx_path.stem
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
    defaults = build_photo_defaults(photo_path.stem)
    if non_interactive:
        return {"label": defaults["label"], "description": "", "order": defaults["order"]}

    label = questionary.text(
        f"Label pour '{photo_path.name}' :", default=defaults["label"]
    ).ask()
    description = questionary.text("Description (optionnelle) :", default="").ask()

    if label is None:
        console.print("[red]Annulé.[/]")
        sys.exit(0)
    return {
        "label": label or defaults["label"],
        "description": description or "",
        "order": defaults["order"],
    }


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
    """Retourne (action, mode). action ∈ {all,traces,photos,pois,list_edit,delete_all,quit}."""
    t_add = len(scan["traces"]["to_add"])
    t_del = len(scan["traces"]["to_delete"])
    p_add = len(scan["photos"]["to_add"])
    p_del = len(scan["photos"]["to_delete"])

    t_changes   = t_add > 0 or t_del > 0
    p_changes   = p_add > 0 or p_del > 0
    total_adds  = t_add + p_add
    total_dels  = t_del + p_del

    show_all_sync = t_changes and p_changes and total_adds > 0 and total_dels > 0
    show_all_add  = total_adds > 0
    show_all_del  = total_dels > 0
    show_traces   = t_changes
    show_photos   = p_changes

    catalog_has_items = (
        scan["traces"]["catalog_count"] > 0 or
        scan["photos"]["catalog_count"] > 0
    )

    if not t_changes and not p_changes:
        console.print(
            "[green]✓ Catalogs Traces et Photos alignés — rien à synchroniser[/]"
        )

    # --- Groupe 1 : Synchronisation ---
    choices: list = []
    if show_all_sync:
        choices.append(
            questionary.Choice("🔄 Tout synchroniser (ajouts + suppressions)", value="all_both")
        )
    if show_all_add:
        choices.append(questionary.Choice(f"➕ Tout ajouter ({total_adds})", value="all_add"))
    if show_all_del:
        choices.append(questionary.Choice(f"🗑️  Tout supprimer ({total_dels})", value="all_delete"))
    if show_traces:
        choices.append(questionary.Choice(f"🗺️  {_trace_label(scan)}", value="traces"))
    if show_photos:
        choices.append(questionary.Choice(f"📷 {_photo_label(scan)}", value="photos"))

    # --- Groupe 2 : Gestion catalog ---
    choices.append(questionary.Separator())
    if catalog_has_items:
        choices.append(questionary.Choice("📋 Lister / modifier le catalog", value="list_edit"))
        choices.append(questionary.Choice("🔥 Supprimer toutes les données", value="delete_all"))
        choices.append(questionary.Separator())

    # --- Groupe 3 : POI ---
    choices.append(questionary.Choice("🌐 Synchroniser les POI (Supabase)", value="pois"))
    choices.append(questionary.Choice("📍 Créer un POI à partir d'une photo (EXIF)", value="poi_from_photo"))
    choices.append(questionary.Separator())

    # --- Groupe 4 : Sortie ---
    choices.append(questionary.Choice("🚪 Quitter", value="quit"))

    choice = questionary.select("Que voulez-vous faire ?", choices=choices).ask()
    log_event("INFO", "system", "menu_choice", choice=choice)

    if choice is None or choice == "quit":
        return "quit", "both"
    if choice == "all_both":
        return "all", "both"
    if choice == "all_add":
        return "all", "add"
    if choice == "all_delete":
        return "all", "delete"
    if choice == "traces":
        return "traces", "both"
    if choice == "photos":
        return "photos", "both"
    if choice == "pois":
        return "pois", "both"
    if choice == "poi_from_photo":
        return "poi_from_photo", "both"
    if choice == "list_edit":
        return "list_edit", "both"
    if choice == "delete_all":
        return "delete_all", "both"
    return "quit", "both"


# ---------------------------------------------------------------------------
# POI CRUD (Supabase)
# ---------------------------------------------------------------------------

def _check_supa_env() -> bool:
    url = os.environ.get("SUPA_URL")
    key = os.environ.get("SUPA_SECRET_KEY")
    if not url or not key:
        console.print(
            "[yellow]⚠ Variables d'env manquantes :[/]\n"
            f"  SUPA_URL            {'[green]✓[/]' if url else '[red]✗ manquante[/]'}\n"
            f"  SUPA_SECRET_KEY     {'[green]✓[/]' if key else '[red]✗ manquante[/]'}\n\n"
            "  Définir avec :\n"
            "    export SUPA_URL='https://...supabase.co'\n"
            "    export SUPA_SECRET_KEY='sb_secret_...'"
        )
        return False
    return True


def _display_pois_table(pois: list[dict], title: str = "POI Supabase") -> None:
    table = Table(
        show_header=True, header_style="bold cyan",
        box=None, pad_edge=False, title=title,
    )
    table.add_column("ID", style="dim", min_width=5, justify="right")
    table.add_column("Type", min_width=16)
    table.add_column("Nom", min_width=24)
    table.add_column("Coordonnées", min_width=20, justify="right")
    table.add_column("Visité", min_width=7, justify="center")

    type_counts: dict[str, int] = {}
    for poi in pois:
        poi_id = str(poi.get("id", ""))
        poi_type = poi.get("type", "")
        emoji = _POI_TYPE_EMOJIS.get(poi_type, "📍")
        name = poi.get("name", "")

        coords = _coords_from_poi(poi) if _SUPABASE_AVAILABLE else None
        coords_str = f"{coords[1]:.4f}, {coords[0]:.4f}" if coords else "—"

        visited_str = "✓" if (poi_type == "chateau" and poi.get("visited")) else "—"

        table.add_row(poi_id, f"{emoji} {poi_type}", name, coords_str, visited_str)
        type_counts[poi_type] = type_counts.get(poi_type, 0) + 1

    console.print(table)
    breakdown = "  ".join(
        f"{_POI_TYPE_EMOJIS.get(t, '📍')} {t}: {n}"
        for t, n in sorted(type_counts.items())
    )
    console.print(f"\n[dim]Total : {len(pois)} POI — {breakdown}[/]\n")


def _select_poi_from_list(pois: list[dict], prompt: str = "Sélectionner un POI :") -> dict | None:
    choices = []
    for poi in pois:
        poi_id = poi.get("id", "")
        poi_type = poi.get("type", "")
        emoji = _POI_TYPE_EMOJIS.get(poi_type, "📍")
        name = poi.get("name", "")
        coords = _coords_from_poi(poi) if _SUPABASE_AVAILABLE else None
        coords_str = f"({coords[1]:.3f}, {coords[0]:.3f})" if coords else ""
        choices.append(questionary.Choice(f"#{poi_id} {emoji} {name} {coords_str}", value=poi_id))
    choices.append(questionary.Choice("← Annuler", value=_CANCEL))

    selected_id = questionary.select(prompt, choices=choices).ask()
    if selected_id is None or selected_id == _CANCEL:
        return None
    return next((p for p in pois if p.get("id") == selected_id), None)


def _parse_coords(text: str) -> tuple[float, float] | None:
    text = text.strip().replace(",", " ")
    parts = text.split()
    if len(parts) != 2:
        return None
    try:
        lat, lon = float(parts[0]), float(parts[1])
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            return None
        return lat, lon
    except ValueError:
        return None


def _show_poi_panel(poi: dict, title: str = "POI") -> None:
    coords = _coords_from_poi(poi) if _SUPABASE_AVAILABLE else None
    coords_str = f"{coords[1]:.6f}, {coords[0]:.6f}" if coords else "N/A"
    emoji = _POI_TYPE_EMOJIS.get(poi.get("type", ""), "📍")
    lines = [
        f"[dim]id:[/]           {poi.get('id', '')}",
        f"[dim]type:[/]         {emoji} {poi.get('type', '')}",
        f"[dim]nom:[/]          {poi.get('name', '')}",
        f"[dim]coordonnées:[/]  {coords_str}",
        f"[dim]description:[/]  {poi.get('description', '') or ''}",
        f"[dim]url_insta:[/]    {poi.get('url_insta', '') or ''}",
    ]
    if poi.get("type") == "chateau":
        lines += [
            f"[dim]construction:[/] {poi.get('construction_date', '') or ''}",
            f"[dim]photo_path:[/]   {poi.get('photo_path', '') or ''}",
            f"[dim]visité:[/]       {'✓ Oui' if poi.get('visited') else '— Non'}",
        ]
    console.print(Panel("\n".join(lines), title=title, border_style="cyan"))


def _prompt_coords_direct(default: str = "") -> tuple[float, float] | None:
    """Saisie directe lat/lon. Retourne (lat, lon) ou None si annulé."""
    while True:
        raw = questionary.text(
            "Coordonnées (lat, lon) — ex. 47.62, 1.52 :", default=default
        ).ask()
        if raw is None:
            return None
        result = _parse_coords(raw)
        if result:
            return result
        console.print("[yellow]Format invalide. Utiliser : lat, lon  (ex. 47.6160, 1.5171)[/]")


def _prompt_coords_by_address() -> tuple[tuple[float, float], str, str] | None:
    """
    Recherche par adresse via Nominatim. Retourne :
    - ((lat, lon), address_used, suggested_label) si succès
    - None si annulé ou erreur réseau
    """
    address = questionary.text("Adresse :").ask()
    if not address or not address.strip():
        return None

    console.print("[dim]Géocodage en cours…[/]")
    try:
        results = _geocode_address(address.strip())
    except Exception as err:
        console.print(f"[red]Erreur réseau : {err}[/]")
        return None

    if not results:
        console.print(f"[yellow]Aucun résultat pour « {address} ».[/]")
        return None

    choices = [
        questionary.Choice(_format_result_label(r), value=r) for r in results
    ] + [questionary.Choice("← Annuler", value=None)]

    chosen = questionary.select("Choisir le bon résultat :", choices=choices).ask()
    if chosen is None:
        return None

    lat = float(chosen["lat"])
    lon = float(chosen["lon"])
    display_name = chosen.get("display_name", "")
    suggested_label = display_name.split(",")[0].strip() if display_name else ""
    return (lat, lon), address.strip(), suggested_label


def _prompt_coords_with_method(
    default_direct: str = "",
) -> tuple[tuple[float, float], str | None, str | None] | None:
    """
    Propose 2 méthodes (adresse / direct).
    Retourne ((lat, lon), geocoded_from, suggested_label) ou None si annulé.
    geocoded_from et suggested_label sont None si saisie directe.
    """
    if not _GEOCODING_AVAILABLE:
        coords = _prompt_coords_direct(default_direct)
        return ((coords, None, None) if coords else None)

    while True:
        method = questionary.select(
            "Coordonnées :",
            choices=[
                questionary.Choice("🔍 Rechercher par adresse", value="address"),
                questionary.Choice("📍 Saisir lat/lon directement", value="direct"),
                questionary.Choice("← Annuler", value=None),
            ],
        ).ask()

        if method is None:
            return None

        if method == "address":
            result = _prompt_coords_by_address()
            if result is None:
                fallback = questionary.select(
                    "Que faire ?",
                    choices=[
                        questionary.Choice("🔍 Réessayer avec une autre adresse", value="retry"),
                        questionary.Choice("📍 Saisir lat/lon directement", value="direct"),
                        questionary.Choice("← Annuler", value=None),
                    ],
                ).ask()
                if fallback is None:
                    return None
                if fallback == "retry":
                    continue
                coords = _prompt_coords_direct(default_direct)
                return (coords, None, None) if coords else None
            (lat, lon), address_used, suggested = result
            return (lat, lon), address_used, suggested

        coords = _prompt_coords_direct(default_direct)
        return (coords, None, None) if coords else None


def prompt_new_poi() -> None:
    if not _SUPABASE_AVAILABLE:
        console.print("[red]Module supabase non disponible. Installer avec : pip install supabase>=2.5.0[/]")
        return
    if not _check_supa_env():
        return

    type_choices = [
        questionary.Choice(f"{_POI_TYPE_EMOJIS.get(t, '📍')} {t}", value=t)
        for t in _POI_VALID_TYPES
    ]
    poi_type = questionary.select("Type de POI :", choices=type_choices).ask()
    if poi_type is None:
        return

    # Coordonnées en premier pour pré-remplir le nom via Nominatim
    coords_result = _prompt_coords_with_method()
    if coords_result is None:
        console.print("[dim]Annulé.[/]")
        return
    (lat, lon), geocoded_from, suggested_label = coords_result

    name = questionary.text("Nom du POI :", default=suggested_label or "").ask()
    if not name or not name.strip():
        console.print("[dim]Annulé.[/]")
        return

    description = questionary.text("Description (optionnelle) :", default="").ask() or ""

    url_insta_raw = questionary.text("URL Instagram (optionnel) :", default="").ask() or ""
    url_insta = url_insta_raw.strip() if _INSTA_RE.match(url_insta_raw.strip()) else None
    if url_insta_raw.strip() and not url_insta:
        console.print("[yellow]⚠ URL Instagram invalide — ignorée.[/]")

    construction_date = photo_path = None
    visited = False
    if poi_type == "chateau":
        construction_date = questionary.text("Date de construction (texte libre) :", default="").ask() or None
        photo_path = questionary.text("Chemin photo (ex. data/thumbs/nom.webp) :", default="").ask() or None
        if photo_path and not (REPO_ROOT / photo_path).exists():
            console.print(f"[yellow]⚠ Fichier non trouvé localement : {photo_path}[/]")
        visited = questionary.confirm("Visité ?", default=False).ask() or False

    data: dict = {
        "name": name.strip(),
        "type": poi_type,
        "geom": _ewkt_point(lon, lat),
    }
    if description:
        data["description"] = description.strip()
    if url_insta:
        data["url_insta"] = url_insta
    if poi_type == "chateau":
        data["construction_date"] = construction_date
        data["photo_path"] = photo_path
        data["visited"] = visited

    _show_poi_panel({**data, "id": "—"}, title="Récapitulatif du nouveau POI")

    confirmed = questionary.confirm("Créer ce POI ?", default=True).ask()
    if not confirmed:
        console.print("[dim]Annulé.[/]")
        return

    try:
        result = _create_poi(data)
        new_id = result.get("id", "?")
        log_event("INFO", "poi", "create", id=new_id, name=data["name"], type=poi_type,
                  geocoded_from=geocoded_from)
        console.print(f"[green]✓ POI ajouté : ID {new_id}[/]")
    except Exception as e:
        console.print(f"[red]Erreur lors de la création : {e}[/]")


def prompt_poi_from_photo() -> None:
    if not _SUPABASE_AVAILABLE:
        console.print("[red]Module supabase non disponible. Installer avec : pip install supabase>=2.5.0[/]")
        return
    if not _check_supa_env():
        return
    if not _EXIF_AVAILABLE:
        console.print("[red]PIL non disponible. Installer : pip install Pillow[/]")
        return

    # 1. Sélection de la photo
    inbox_dir = PHOTOS_DIR / "inbox"
    inbox_photos = sorted(
        p for p in inbox_dir.iterdir()
        if p.is_file() and p.suffix.lower() in PHOTO_EXTS
    ) if inbox_dir.exists() else []

    photo_path: Path | None = None
    if inbox_photos:
        choices = [questionary.Choice(p.name, value=p) for p in inbox_photos] + [
            questionary.Choice("📂 Saisir un chemin manuellement", value="manual"),
            questionary.Choice("← Annuler", value=_CANCEL),
        ]
        sel = questionary.select("Photo à utiliser :", choices=choices).ask()
        if sel is None or sel == _CANCEL:
            console.print("[dim]Annulé.[/]")
            return
        if sel == "manual":
            raw = questionary.text("Chemin de la photo :").ask()
            if not raw:
                return
            photo_path = Path(raw.strip()).expanduser()
        else:
            photo_path = sel
    else:
        raw = questionary.text("Chemin de la photo :").ask()
        if not raw:
            return
        photo_path = Path(raw.strip()).expanduser()

    if not photo_path.exists():
        console.print(f"[red]Fichier introuvable : {photo_path}[/]")
        return

    # 2. Extraction EXIF
    console.print("[dim]Extraction des données EXIF…[/]")
    gps_info = _extract_gps(photo_path.read_bytes())
    lat, lon = gps_info.get("lat"), gps_info.get("lon")

    if lat is None or lon is None:
        console.print("[yellow]⚠ Aucune coordonnée GPS trouvée dans l'EXIF.[/]")
        if not questionary.confirm("Saisir les coordonnées manuellement ?", default=True).ask():
            return
        coords = _prompt_coords_direct()
        if coords is None:
            return
        lat, lon = coords
    else:
        exif_time = gps_info.get("time")
        console.print(f"  GPS EXIF : {lat:.6f}, {lon:.6f}" + (f"  ({exif_time})" if exif_time else ""))
        if not questionary.confirm(f"Utiliser ces coordonnées ({lat:.5f}, {lon:.5f}) ?", default=True).ask():
            result = _prompt_coords_with_method(default_direct=f"{lat:.6f}, {lon:.6f}")
            if result is None:
                return
            (lat, lon), _, _ = result

    # 3. Géocodage inverse
    suggested_name = ""
    if _GEOCODING_AVAILABLE:
        console.print("[dim]Géocodage inverse…[/]")
        try:
            suggested_name = _reverse_geocode(lat, lon) or ""
            if suggested_name:
                console.print(f"  Suggestion : {suggested_name}")
        except Exception as err:
            console.print(f"[dim]Géocodage inverse échoué : {err}[/]")

    # 4. Type de POI
    type_choices = [
        questionary.Choice(f"{_POI_TYPE_EMOJIS.get(t, '📍')} {t}", value=t)
        for t in _POI_VALID_TYPES
    ]
    poi_type = questionary.select("Type de POI :", choices=type_choices).ask()
    if poi_type is None:
        return

    # 5. Nom / description
    name = questionary.text("Nom du POI :", default=suggested_name).ask()
    if not name or not name.strip():
        console.print("[dim]Annulé.[/]")
        return

    description = questionary.text("Description (optionnelle) :", default="").ask() or ""

    url_insta_raw = questionary.text("URL Instagram (optionnel) :", default="").ask() or ""
    url_insta = url_insta_raw.strip() if _INSTA_RE.match(url_insta_raw.strip()) else None
    if url_insta_raw.strip() and not url_insta:
        console.print("[yellow]⚠ URL Instagram invalide — ignorée.[/]")

    construction_date = poi_photo_path = None
    visited = False
    if poi_type == "chateau":
        construction_date = questionary.text("Date de construction :", default="").ask() or None
        poi_photo_path = questionary.text("Chemin photo (ex. data/thumbs/nom.webp) :", default="").ask() or None
        if poi_photo_path and not (REPO_ROOT / poi_photo_path).exists():
            console.print(f"[yellow]⚠ Fichier non trouvé localement : {poi_photo_path}[/]")
        visited = questionary.confirm("Visité ?", default=False).ask() or False

    data: dict = {
        "name": name.strip(),
        "type": poi_type,
        "geom": _ewkt_point(lon, lat),
    }
    if description:
        data["description"] = description.strip()
    if url_insta:
        data["url_insta"] = url_insta
    if poi_type == "chateau":
        data["construction_date"] = construction_date
        data["photo_path"] = poi_photo_path
        data["visited"] = visited

    # 6. Récapitulatif
    emoji = _POI_TYPE_EMOJIS.get(poi_type, "📍")
    console.print(Panel(
        "\n".join([
            f"[dim]photo :[/]   {photo_path.name}",
            f"[dim]type :[/]    {emoji} {poi_type}",
            f"[dim]nom :[/]     {data['name']}",
            f"[dim]coords :[/]  {lat:.6f}, {lon:.6f}",
            f"[dim]descr. :[/]  {data.get('description', '') or '—'}",
        ]),
        title="Récapitulatif du nouveau POI",
        border_style="cyan",
    ))

    if not questionary.confirm("Créer ce POI et lier la photo ?", default=True).ask():
        console.print("[dim]Annulé.[/]")
        return

    # 7. Création du POI
    try:
        result = _create_poi(data)
        new_id = str(result.get("id", "?"))
        log_event("INFO", "poi", "create", id=new_id, name=data["name"], type=poi_type,
                  source="photo_exif", photo=photo_path.name)
        console.print(f"[green]✓ POI créé : ID {new_id}[/]")
    except Exception as e:
        console.print(f"[red]Erreur lors de la création du POI : {e}[/]")
        return

    # 8. Liaison photo → POI
    photo_stem = photo_path.stem
    linked = False

    photo_items, _ = load_catalog(CATALOG_PHOTOS)
    existing = next((p for p in photo_items if p.get("id") == photo_stem), None)
    if existing:
        existing["poi_id"] = new_id
        save_catalog(CATALOG_PHOTOS, photo_items)
        console.print(f"[green]✓ photos.json : '{photo_stem}' → POI {new_id}[/]")
        linked = True

    _update_photo_poi_in_geojson(photo_stem, new_id)
    if PHOTOS_GEOJSON.exists():
        # Vérifier si la mise à jour a eu un effet
        with PHOTOS_GEOJSON.open(encoding="utf-8") as f:
            fc = json.load(f)
        matched = any(
            (feat.get("properties", {}).get("id") or Path(feat.get("properties", {}).get("thumb", "")).stem) == photo_stem
            for feat in fc.get("features", [])
        )
        if matched:
            console.print(f"[green]✓ pois_photos.geojson : '{photo_stem}' → POI {new_id}[/]")
            linked = True

    if not linked:
        console.print(
            f"[yellow]⚠ Photo '{photo_stem}' non trouvée dans le catalog ni dans pois_photos.geojson.[/]\n"
            f"  Ajouter manuellement : poi_id = {new_id} dans data/catalog/photos.json\n"
            f"  puis relancer la synchronisation des photos."
        )


def prompt_edit_poi() -> None:
    if not _SUPABASE_AVAILABLE:
        console.print("[red]Module supabase non disponible.[/]")
        return
    if not _check_supa_env():
        return

    try:
        pois = _list_pois()
    except Exception as e:
        console.print(f"[red]Erreur lors du chargement des POI : {e}[/]")
        return
    if not pois:
        console.print("[dim]Aucun POI trouvé.[/]")
        return

    poi = _select_poi_from_list(pois, "Sélectionner le POI à modifier :")
    if poi is None:
        return

    original = dict(poi)
    local = dict(poi)
    modified = False

    while True:
        _show_poi_panel(local, title=f"POI #{local.get('id', '')}")

        field_choices: list = [
            questionary.Choice("✏️  Nom", value="name"),
            questionary.Choice("📝 Description", value="description"),
            questionary.Choice("📍 Coordonnées", value="coords"),
            questionary.Choice("📸 URL Instagram", value="url_insta"),
        ]
        if local.get("type") == "chateau":
            field_choices += [
                questionary.Choice("🏗  Date de construction", value="construction_date"),
                questionary.Choice("🖼  Chemin photo", value="photo_path"),
                questionary.Choice("✅ Visité", value="visited"),
            ]
        field_choices += [
            questionary.Choice("🔄 Changer le type", value="type"),
            questionary.Separator(),
            questionary.Choice("💾 Sauvegarder", value="save"),
            questionary.Choice("✖  Annuler", value="cancel"),
        ]

        action = questionary.select("Champ à modifier :", choices=field_choices).ask()
        if action is None or action == "cancel":
            if modified and questionary.confirm("Annuler les modifications ?", default=True).ask():
                console.print("[dim]Modifications annulées.[/]")
            return

        if action == "save":
            break

        if action == "name":
            val = questionary.text("Nouveau nom :", default=local.get("name", "")).ask()
            if val is not None:
                local["name"] = val
                modified = True

        elif action == "description":
            val = questionary.text("Nouvelle description :", default=local.get("description") or "").ask()
            if val is not None:
                local["description"] = val
                modified = True

        elif action == "coords":
            coords = _coords_from_poi(local)
            default_str = f"{coords[1]:.6f}, {coords[0]:.6f}" if coords else ""
            result = _prompt_coords_with_method(default_direct=default_str)
            if result is not None:
                (lat, lon), _geocoded_from, _suggested = result
                local["geom"] = _ewkt_point(lon, lat)
                modified = True

        elif action == "url_insta":
            val = questionary.text("URL Instagram :", default=local.get("url_insta") or "").ask()
            if val is not None:
                stripped = val.strip()
                if stripped and not _INSTA_RE.match(stripped):
                    console.print("[yellow]⚠ URL invalide — ignorée.[/]")
                else:
                    local["url_insta"] = stripped or None
                    modified = True

        elif action == "construction_date":
            val = questionary.text("Date de construction :", default=local.get("construction_date") or "").ask()
            if val is not None:
                local["construction_date"] = val.strip() or None
                modified = True

        elif action == "photo_path":
            val = questionary.text("Chemin photo :", default=local.get("photo_path") or "").ask()
            if val is not None:
                stripped = val.strip()
                if stripped and not (REPO_ROOT / stripped).exists():
                    console.print(f"[yellow]⚠ Fichier non trouvé localement : {stripped}[/]")
                local["photo_path"] = stripped or None
                modified = True

        elif action == "visited":
            val = questionary.confirm("Visité ?", default=bool(local.get("visited"))).ask()
            if val is not None:
                local["visited"] = val
                modified = True

        elif action == "type":
            old_type = local.get("type", "")
            type_choices = [
                questionary.Choice(f"{_POI_TYPE_EMOJIS.get(t, '📍')} {t}", value=t)
                for t in _POI_VALID_TYPES
            ]
            new_type = questionary.select("Nouveau type :", choices=type_choices).ask()
            if new_type and new_type != old_type:
                if old_type == "chateau" and new_type != "chateau":
                    console.print(
                        "[yellow]⚠ Les champs château (construction_date, photo_path, visited) "
                        "seront conservés en base mais ignorés visuellement.[/]"
                    )
                local["type"] = new_type
                modified = True

    if not modified:
        console.print("[dim]Aucune modification.[/]")
        return

    diff = {k: v for k, v in local.items() if v != original.get(k) and k != "id"}
    if not diff:
        console.print("[dim]Aucun changement à sauvegarder.[/]")
        return

    poi_id = original.get("id")
    try:
        _update_poi(poi_id, diff)
        log_event("INFO", "poi", "update", id=poi_id, diff={k: str(v)[:200] for k, v in diff.items()})
        console.print("[green]✓ POI mis à jour[/]")
    except Exception as e:
        console.print(f"[red]Erreur lors de la mise à jour : {e}[/]")


def prompt_delete_poi() -> None:
    if not _SUPABASE_AVAILABLE:
        console.print("[red]Module supabase non disponible.[/]")
        return
    if not _check_supa_env():
        return

    try:
        pois = _list_pois()
    except Exception as e:
        console.print(f"[red]Erreur lors du chargement des POI : {e}[/]")
        return
    if not pois:
        console.print("[dim]Aucun POI trouvé.[/]")
        return

    poi = _select_poi_from_list(pois, "Sélectionner le POI à supprimer :")
    if poi is None:
        return

    _show_poi_panel(poi, title="POI à supprimer")

    poi_id = poi.get("id")
    name = poi.get("name", "")

    # Vérifier les photos rattachées à ce POI
    attached_photos = _find_photos_attached_to_poi(poi_id) if poi_id else []
    if attached_photos:
        console.print(f"\n[yellow]⚠ Ce POI a {len(attached_photos)} photo(s) rattachée(s) :[/]")
        for p in attached_photos[:5]:
            console.print(f"  - {p['id']}")
        if len(attached_photos) > 5:
            console.print(f"  ... et {len(attached_photos) - 5} autres")
        orphan_choice = questionary.select(
            "Que faire des photos ?",
            choices=[
                questionary.Choice("↪ Les détacher (elles redeviendront des markers)", value="detach"),
                questionary.Choice("↪ Annuler la suppression", value="cancel"),
            ],
        ).ask()
        if orphan_choice is None or orphan_choice == "cancel":
            console.print("[dim]❌ Suppression annulée.[/]")
            return
        if orphan_choice == "detach":
            photos, _ = load_catalog(CATALOG_PHOTOS)
            for p in photos:
                if p.get("poi_id") == poi_id:
                    p["poi_id"] = None
                    _update_photo_poi_in_geojson(p["id"], None)
            save_catalog(CATALOG_PHOTOS, photos)
            console.print(f"[dim]{len(attached_photos)} photo(s) détachée(s).[/]")

    console.print("[bold red]⚠ Cette action est irréversible.[/]\n")

    confirm_text = questionary.text("Pour confirmer, saisir exactement : SUPPRIMER").ask()
    if not confirm_text or confirm_text.strip() != "SUPPRIMER":
        console.print("[dim]❌ Annulé.[/]")
        return

    try:
        _delete_poi(poi_id)
        log_event("INFO", "poi", "delete", id=poi_id, name=name)
        console.print(f"[green]✓ POI #{poi_id} « {name} » supprimé.[/]")
    except Exception as e:
        console.print(f"[red]Erreur lors de la suppression : {e}[/]")


def poi_crud_menu() -> None:
    if not _SUPABASE_AVAILABLE:
        console.print(
            "[yellow]⚠ Module supabase non disponible.\n"
            "  Installer avec : pip install supabase>=2.5.0[/]"
        )
        return

    while True:
        choice = questionary.select(
            "POI (Supabase) — que voulez-vous faire ?",
            choices=[
                questionary.Choice("📋 Lister tous les POI", value="list"),
                questionary.Choice("🔍 Filtrer par type", value="filter"),
                questionary.Choice("➕ Ajouter un POI", value="add"),
                questionary.Choice("✏️  Modifier un POI", value="edit"),
                questionary.Choice("🗑️  Supprimer un POI", value="delete"),
                questionary.Separator(),
                questionary.Choice("← Retour", value="back"),
            ],
        ).ask()

        if choice is None or choice == "back":
            return

        if choice == "list":
            if not _check_supa_env():
                continue
            try:
                pois = _list_pois()
                if not pois:
                    console.print("[dim]Aucun POI.[/]")
                    continue
                if len(pois) <= 100:
                    _display_pois_table(pois)
                else:
                    page, page_size = 0, 100
                    total_pages = (len(pois) + page_size - 1) // page_size
                    while True:
                        start = page * page_size
                        _display_pois_table(
                            pois[start:start + page_size],
                            title=f"POI — page {page + 1}/{total_pages}",
                        )
                        nav_choices: list = []
                        if page > 0:
                            nav_choices.append(questionary.Choice("← Précédent", value="prev"))
                        if page < total_pages - 1:
                            nav_choices.append(questionary.Choice("Suivant →", value="next"))
                        nav_choices.append(questionary.Choice("Quitter", value="quit"))
                        nav = questionary.select("Navigation :", choices=nav_choices).ask()
                        if nav == "next":
                            page += 1
                        elif nav == "prev":
                            page -= 1
                        else:
                            break
            except Exception as e:
                console.print(f"[red]Erreur : {e}[/]")

        elif choice == "filter":
            if not _check_supa_env():
                continue
            type_choices = [
                questionary.Choice(f"{_POI_TYPE_EMOJIS.get(t, '📍')} {t}", value=t)
                for t in _POI_VALID_TYPES
            ] + [questionary.Choice("📸 photo", value="photo")]
            poi_type = questionary.select("Type à afficher :", choices=type_choices).ask()
            if poi_type:
                try:
                    pois = _list_pois(type_filter=poi_type)
                    if pois:
                        _display_pois_table(pois, title=f"POI — type : {poi_type}")
                    else:
                        console.print(f"[dim]Aucun POI de type « {poi_type} ».[/]")
                except Exception as e:
                    console.print(f"[red]Erreur : {e}[/]")

        elif choice == "add":
            prompt_new_poi()

        elif choice == "edit":
            prompt_edit_poi()

        elif choice == "delete":
            prompt_delete_poi()


# ---------------------------------------------------------------------------
# Lister / modifier le catalog
# ---------------------------------------------------------------------------

def list_and_edit_catalog() -> None:
    """Écran interactif de listage et modification des items catalog."""
    while True:
        cat_choice = questionary.select(
            "Quel catalog afficher ?",
            choices=[
                questionary.Choice("🗺️  Traces", value="traces"),
                questionary.Choice("📷 Photos", value="photos"),
                questionary.Choice("🌐 POI (Supabase)", value="pois"),
                questionary.Choice("← Retour", value="back"),
            ],
        ).ask()
        if cat_choice is None or cat_choice == "back":
            return
        if cat_choice == "traces":
            _edit_catalog_loop(CATALOG_TRACES, "traces")
        elif cat_choice == "photos":
            _edit_catalog_loop(CATALOG_PHOTOS, "photos")
        elif cat_choice == "pois":
            poi_crud_menu()


def _edit_catalog_loop(catalog_path: Path, kind: str) -> None:
    """Boucle principale : liste les items, sélection, édition, retour à la liste."""
    while True:
        items, _ = load_catalog(catalog_path)

        table = Table(show_header=True, header_style="bold cyan", box=None, pad_edge=False)
        table.add_column("ID", style="dim", min_width=12)
        table.add_column("Label", min_width=20)
        table.add_column("Groupe", min_width=14)
        if kind == "traces":
            table.add_column("Order", justify="right")
            for it in items:
                table.add_row(
                    it["id"], it.get("label", ""), it.get("group", ""),
                    str(it.get("order", "")),
                )
        else:
            table.add_column("Time")
            for it in items:
                t = it.get("time", "")
                table.add_row(it["id"], it.get("label", ""), it.get("group", ""), t[:10] if t else "")
        console.print(table)

        item_choices: list = [
            questionary.Choice(f"{it['id']} — {it.get('label', '')}", value=it["id"])
            for it in items
        ]
        item_choices.append(questionary.Choice("← Retour", value="back"))

        selected_id = questionary.select("Sélectionner un item :", choices=item_choices).ask()
        if selected_id is None or selected_id == "back":
            return

        item = next((it for it in items if it["id"] == selected_id), None)
        if not item:
            continue

        if kind == "traces":
            deleted = _edit_trace_item(item, items, catalog_path)
        else:
            deleted = _edit_item(item, items, catalog_path, kind)
        # Boucle : si suppression ou modification, rafraîchit la liste


def _edit_item(item: dict, items: list[dict], catalog_path: Path, kind: str) -> bool:
    """Boucle d'édition d'un item. Retourne True si l'item a été supprimé."""
    while True:
        if kind == "photos":
            poi_id = item.get("poi_id")
            poi_label = _resolve_poi_name(poi_id) if poi_id else "—"
            lines = [
                f"  [dim]id:[/]           {item.get('id', '')}",
                f"  [dim]label:[/]        {item.get('label', '')}",
                f"  [dim]description:[/]  {item.get('description', '') or ''}",
                f"  [dim]group:[/]        {item.get('group', '')}",
                f"  [dim]order:[/]        {item.get('order', '')}",
                f"  [dim]poi_id:[/]       {poi_label or '—'}",
                f"  [dim]time:[/]         {item.get('time', '')}",
                f"  [dim]coords:[/]       {item.get('lat', '')}, {item.get('lon', '')}",
            ]
            fields = "\n".join(lines)
        else:
            fields = "\n".join(f"  [dim]{k}:[/] {v}" for k, v in item.items())
        console.print(Panel(fields, title=f"Item : {item['id']}", border_style="cyan"))

        action_choices: list = [
            questionary.Choice("✏️  Modifier le label", value="label"),
            questionary.Choice("📂 Modifier le groupe", value="group"),
            questionary.Choice("📝 Modifier la description", value="description"),
        ]
        if kind == "traces":
            action_choices.append(questionary.Choice("🔢 Modifier l'ordre", value="order"))
        if kind == "photos":
            action_choices.append(questionary.Separator())
            if item.get("poi_id"):
                action_choices.append(questionary.Choice("🔗 Détacher du POI", value="detach_poi"))
            else:
                action_choices.append(questionary.Choice("🌐 Rattacher à un POI", value="attach_poi"))
            action_choices.append(questionary.Separator())
        action_choices += [
            questionary.Choice("🗑️  Supprimer cet item", value="delete"),
            questionary.Choice("← Retour sans modifier", value="back"),
        ]

        action = questionary.select("Action :", choices=action_choices).ask()
        if action is None or action == "back":
            return False

        if action == "label":
            new_val = questionary.text("Nouveau label :", default=item.get("label", "")).ask()
            if new_val is not None:
                item["label"] = new_val
                save_catalog(catalog_path, items)
                console.print("[green]✓ Item mis à jour[/]")

        elif action == "group":
            cur = item.get("group", KNOWN_GROUPS[0])
            default_g = cur if cur in KNOWN_GROUPS else KNOWN_GROUPS[0]
            new_val = questionary.select(
                "Nouveau groupe :", choices=KNOWN_GROUPS, default=default_g
            ).ask()
            if new_val is not None:
                item["group"] = new_val
                save_catalog(catalog_path, items)
                console.print("[green]✓ Item mis à jour[/]")

        elif action == "description":
            new_val = questionary.text(
                "Nouvelle description :", default=item.get("description", "")
            ).ask()
            if new_val is not None:
                item["description"] = new_val
                save_catalog(catalog_path, items)
                console.print("[green]✓ Item mis à jour[/]")

        elif action == "order":
            new_val = questionary.text(
                "Nouvel ordre :", default=str(item.get("order", ""))
            ).ask()
            if new_val is not None:
                try:
                    item["order"] = int(new_val)
                    save_catalog(catalog_path, items)
                    console.print("[green]✓ Item mis à jour[/]")
                except ValueError:
                    console.print("[red]Valeur non valide — entier attendu.[/]")

        elif action == "attach_poi":
            if not _SUPABASE_AVAILABLE:
                console.print("[yellow]⚠ Module supabase non disponible.[/]")
                continue
            if not _check_supa_env():
                continue
            try:
                pois = _list_pois()
            except Exception as e:
                console.print(f"[red]Erreur chargement POI : {e}[/]")
                continue
            if item.get("poi_id"):
                console.print(
                    f"[dim]Photo actuellement rattachée à : {_resolve_poi_name(item['poi_id'])}[/]"
                )
                replace = questionary.confirm("Remplacer par un autre POI ?", default=True).ask()
                if not replace:
                    continue
            selected = _select_poi_from_list(pois, "Rattacher la photo à ce POI :")
            if selected:
                item["poi_id"] = selected["id"]
                save_catalog(catalog_path, items)
                _update_photo_poi_in_geojson(item["id"], selected["id"])
                log_event("INFO", "photos", "photo_poi_attached",
                          id=item["id"], poi_id=selected["id"], poi_name=selected.get("name", ""))
                console.print(
                    f"[green]✓ Photo « {item.get('label', item['id'])} » rattachée "
                    f"au POI « {selected.get('name', '')} »[/]"
                )

        elif action == "detach_poi":
            poi_name = _resolve_poi_name(item.get("poi_id"))
            confirmed = questionary.confirm(
                f"Détacher la photo du POI « {poi_name} » ?", default=False
            ).ask()
            if confirmed:
                item["poi_id"] = None
                save_catalog(catalog_path, items)
                _update_photo_poi_in_geojson(item["id"], None)
                log_event("INFO", "photos", "photo_poi_detached", id=item["id"])
                console.print("[green]✓ Photo détachée — redeviendra un marker sur la carte.[/]")

        elif action == "delete":
            label_display = item.get("label", item["id"])
            confirmed = questionary.confirm(
                f"Supprimer définitivement « {label_display} » ?", default=False
            ).ask()
            if confirmed:
                del_tree = Tree("[bold red]Suppression")
                if kind == "traces":
                    for path_key in ("full", "simplified"):
                        rel = item.get("paths", {}).get(path_key, "")
                        if rel:
                            p = REPO_ROOT / rel
                            if p.exists():
                                p.unlink()
                                del_tree.add(f"[red]✗[/] {rel}")
                else:
                    thumb = item.get("paths", {}).get("thumb", "")
                    if thumb:
                        tp = THUMBS_DIR / (Path(thumb).stem + ".webp")
                        if tp.exists():
                            tp.unlink()
                            del_tree.add(f"[red]✗[/] {tp.relative_to(REPO_ROOT)}")
                console.print(del_tree)
                updated = [it for it in items if it["id"] != item["id"]]
                save_catalog(catalog_path, updated)
                if kind == "photos":
                    _filter_photos_geojson(del_tree)
                console.print(f"[green]✓ « {label_display} » supprimé du catalog[/]")
                return True


# ---------------------------------------------------------------------------
# Édition complète des traces (LRZ-EVO-26)
# ---------------------------------------------------------------------------

def _show_trace_panel(item: dict, title: str = "Trace") -> None:
    def _v(val) -> str:
        return str(val) if val is not None else "—"

    dur_str = "—"
    if item.get("duration_h") is not None:
        total_min = round(item["duration_h"] * 60)
        h, m = divmod(total_min, 60)
        dur_str = f"{h}h{m:02d}" if m else f"{h}h"

    dist = f"{item['distance_km']} km" if item.get("distance_km") is not None else "—"
    elev = f"{item['elevation_gain_m']} m" if item.get("elevation_gain_m") is not None else "—"

    lines = [
        f"[dim]id:[/]             {item.get('id', '')}",
        f"[dim]label:[/]          {_v(item.get('label'))}",
        f"[dim]groupe:[/]         {_v(item.get('group'))}",
        f"[dim]order:[/]          {_v(item.get('order'))}",
        f"[dim]date_status:[/]    {_v(item.get('date_status'))}",
        f"[dim]date:[/]           {_v(item.get('date'))}",
        f"[dim]durée:[/]          {dur_str}",
        f"[dim]distance:[/]       {dist}",
        f"[dim]dénivelé:[/]       {elev}",
        f"[dim]météo:[/]          {format_weather(item.get('weather'))}",
        f"[dim]instagram_url:[/]  {item.get('instagram_url') or '—'}",
        f"[dim]komoot_url:[/]     {item.get('komoot_url') or '—'}",
        f"[dim]boucle:[/]         {'Oui ↔️' if item.get('is_loop') else '— Non'}",
    ]
    console.print(Panel("\n".join(lines), title=title, border_style="cyan"))


def _edit_weather_submenu(item: dict, items: list[dict], catalog_path: Path) -> None:
    """Sous-menu d'édition de la météo d'une trace, avec sauvegarde par champ."""
    while True:
        w = dict(item.get("weather") or {})
        desc_cur = w.get("description") or ""
        tmin_cur = str(w.get("temp_min")) if w.get("temp_min") is not None else ""
        tmax_cur = str(w.get("temp_max")) if w.get("temp_max") is not None else ""
        icon_cur = w.get("icon") or ""

        action = questionary.select(
            "Météo — champ à modifier :",
            choices=[
                questionary.Choice(f"📝 Description  ({desc_cur or '—'})", value="description"),
                questionary.Choice(f"🌡  Temp. min    ({tmin_cur + '°' if tmin_cur else '—'})", value="temp_min"),
                questionary.Choice(f"🌡  Temp. max    ({tmax_cur + '°' if tmax_cur else '—'})", value="temp_max"),
                questionary.Choice(f"🎨 Icône        ({icon_cur or '—'})", value="icon"),
                questionary.Separator(),
                questionary.Choice("🗑️  Effacer toute la météo", value="clear"),
                questionary.Choice("← Retour", value="back"),
            ],
        ).ask()

        if action is None or action == "back":
            return

        if action == "clear":
            if questionary.confirm("Effacer toute la météo ?", default=False).ask():
                item["weather"] = None
                save_catalog(catalog_path, items)
                log_event("INFO", "traces", "field_updated",
                          id=item.get("id"), field="weather", value=None)
                console.print("[green]✓ Météo effacée[/]")
            return

        changed = False

        if action == "description":
            val = questionary.text("Description météo (vide pour null) :", default=desc_cur).ask()
            if val is not None:
                w["description"] = val.strip() or None
                changed = True

        elif action == "temp_min":
            val = questionary.text("Température min (ex. 12 ou vide pour null) :", default=tmin_cur).ask()
            if val is not None:
                stripped = val.strip()
                if stripped:
                    t = parse_temp(stripped)
                    if t is None:
                        console.print("[yellow]Format invalide — entier attendu.[/]")
                        continue
                    w["temp_min"] = t
                else:
                    w["temp_min"] = None
                changed = True

        elif action == "temp_max":
            val = questionary.text("Température max (ex. 28 ou vide pour null) :", default=tmax_cur).ask()
            if val is not None:
                stripped = val.strip()
                if stripped:
                    t = parse_temp(stripped)
                    if t is None:
                        console.print("[yellow]Format invalide — entier attendu.[/]")
                        continue
                    w["temp_max"] = t
                else:
                    w["temp_max"] = None
                changed = True

        elif action == "icon":
            icon_choices = [questionary.Choice(ic, value=ic) for ic in WEATHER_ICONS]
            icon_choices.append(questionary.Choice("← Aucune icône", value=""))
            val = questionary.select("Choisir une icône :", choices=icon_choices).ask()
            if val is None:
                continue
            w["icon"] = val or None
            changed = True

        if changed:
            item["weather"] = w if any(v is not None for v in w.values()) else None
            save_catalog(catalog_path, items)
            log_event("INFO", "traces", "field_updated", id=item.get("id"),
                      field="weather", value=format_weather(item.get("weather")))
            console.print("[green]✓ Météo mise à jour[/]")


def _recalc_gpx_stats(item: dict, items: list[dict], catalog_path: Path) -> None:
    """Appelle gpx_to_geojson.py --stats-only et met à jour distance_km / elevation_gain_m."""
    source = item.get("source", "")
    if not source:
        console.print("[yellow]Aucune source GPX définie pour cette trace.[/]")
        return
    gpx_path = REPO_ROOT / source
    if not gpx_path.exists():
        console.print(f"[yellow]Fichier GPX introuvable : {gpx_path}[/]")
        return
    try:
        result = subprocess.run(
            [PYTHON, str(SCRIPTS_DIR / "gpx_to_geojson.py"), str(gpx_path), "--stats-only"],
            capture_output=True, text=True, check=True,
        )
        stats = json.loads(result.stdout.strip())
        dist = stats.get("distance_km")
        elev = stats.get("elevation_gain_m")
        if dist is not None:
            item["distance_km"] = dist
        if elev is not None:
            item["elevation_gain_m"] = elev
        save_catalog(catalog_path, items)
        log_event("INFO", "traces", "field_updated", id=item.get("id"),
                  field="gpx_stats", value={"distance_km": dist, "elevation_gain_m": elev})
        console.print(f"[green]✓ Stats GPX : {dist} km · {elev} m D+[/]")
    except subprocess.CalledProcessError as e:
        console.print(f"[red]Erreur GPX (exit {e.returncode}) : {e.stderr}[/]")
    except (json.JSONDecodeError, KeyError) as e:
        console.print(f"[red]Résultat GPX invalide : {e}[/]")


def _regenerate_trace_geojson(item: dict) -> bool:
    """Régénère les GeoJSON full + simplified depuis le GPX source et rafraîchit les stats.
    Retourne True si succès complet (les stats peuvent rester inchangées si --stats-only échoue).
    """
    source = item.get("source")
    if not source:
        console.print(
            "[yellow]⚠ Cet item n'a pas de fichier GPX source associé.\n"
            "  La régénération nécessite un GPX original.[/]"
        )
        return False

    gpx_path = REPO_ROOT / source
    if not gpx_path.exists():
        console.print(
            f"[yellow]⚠ Fichier GPX introuvable : {source}\n"
            "  Soit le fichier a été supprimé, soit le chemin est obsolète.\n"
            "  → Replacer le GPX et relancer, ou supprimer cet item du catalog.[/]"
        )
        return False

    paths = item.get("paths", {})
    out_full = REPO_ROOT / paths.get("full", "")
    out_simplified = REPO_ROOT / paths.get("simplified", "")

    console.print(Panel(
        f"Régénération du GeoJSON depuis :\n  [cyan]{source}[/]\n\n"
        f"Vers :\n  [cyan]{paths.get('full', '?')}[/]\n  [cyan]{paths.get('simplified', '?')}[/]\n\n"
        "Les fichiers actuels seront écrasés. Les stats (distance, dénivelé) seront recalculées.",
        title="🔄 Régénérer le GeoJSON",
        border_style="yellow",
    ))
    if not questionary.confirm("Continuer ?", default=True).ask():
        console.print("[dim]Annulé.[/]")
        return False

    old_dist = item.get("distance_km")
    old_elev = item.get("elevation_gain_m")
    tree = Tree("[bold cyan]🔄 Régénération")

    # 1. Full GeoJSON
    ok = run_script(
        [PYTHON, str(SCRIPTS_DIR / "gpx_to_geojson.py"), str(gpx_path), "-o", str(out_full)],
        f"{gpx_path.name} → {out_full.name}",
        tree, verbose=False,
    )
    if not ok:
        log_event("ERROR", "traces", "geojson_regenerate_failed",
                  id=item.get("id"), stage="full", source=source)
        console.print(tree)
        console.print(
            "[red]Erreur sur le full GeoJSON. Le simplified et le catalog n'ont pas été modifiés.\n"
            "  Relancer la régénération ou restaurer depuis Git.[/]"
        )
        return False

    # 2. Simplified GeoJSON
    ok = run_script(
        [PYTHON, str(SCRIPTS_DIR / "gpx_to_geojson.py"), str(gpx_path),
         "-o", str(out_simplified), "--simplify", "0.0001"],
        f"{gpx_path.name} → {out_simplified.name}",
        tree, verbose=False,
    )
    if not ok:
        log_event("ERROR", "traces", "geojson_regenerate_failed",
                  id=item.get("id"), stage="simplified", source=source)
        console.print(tree)
        console.print(
            "[red]Erreur sur le simplified GeoJSON. Le full a été régénéré mais le catalog\n"
            "  n'a pas été mis à jour. Relancer la régénération pour compléter.[/]"
        )
        return False

    # 3. Stats refresh
    new_dist, new_elev = old_dist, old_elev
    try:
        result = subprocess.run(
            [PYTHON, str(SCRIPTS_DIR / "gpx_to_geojson.py"), str(gpx_path), "--stats-only"],
            capture_output=True, text=True, check=True,
        )
        stats = json.loads(result.stdout.strip())
        new_dist = stats.get("distance_km", old_dist)
        new_elev = stats.get("elevation_gain_m", old_elev)
        item["distance_km"] = new_dist
        item["elevation_gain_m"] = new_elev
        tree.add("[green]✓ stats rafraîchies[/]")
    except (subprocess.CalledProcessError, json.JSONDecodeError, FileNotFoundError) as e:
        tree.add(f"[yellow]⚠ stats non recalculées : {e}[/]")

    console.print(tree)

    log_event("INFO", "traces", "geojson_regenerated",
              id=item.get("id"),
              source=source,
              old_stats={"distance_km": old_dist, "elevation_gain_m": old_elev},
              new_stats={"distance_km": new_dist, "elevation_gain_m": new_elev})

    def _stat_diff(label: str, unit: str, old, new) -> str | None:
        if old == new:
            return None
        if old is None or new is None:
            return f"  {label:14} : {old or '—'} → {new or '—'} {unit}"
        delta = new - old
        sign = "+" if delta > 0 else ""
        return f"  {label:14} : {old} → {new} {unit}  ({sign}{delta:.1f} {unit})"

    diffs = [
        _stat_diff("Distance", "km", old_dist, new_dist),
        _stat_diff("Dénivelé D+", "m", old_elev, new_elev),
    ]
    diffs = [d for d in diffs if d]
    if diffs:
        console.print("\n[green]✓ GeoJSON régénéré.[/]")
        for d in diffs:
            console.print(d)
    else:
        console.print("[green]✓ GeoJSON régénéré. Stats inchangées.[/]")

    return True


def _edit_trace_item(item: dict, items: list[dict], catalog_path: Path) -> bool:
    """Boucle d'édition complète d'une trace. Retourne True si supprimée."""
    while True:
        _show_trace_panel(item, title=f"Trace : {item.get('id', '')}")

        action = questionary.select(
            "Champ à modifier :",
            choices=[
                questionary.Choice("✏️  Label", value="label"),
                questionary.Choice("📂 Groupe", value="group"),
                questionary.Choice("🔢 Ordre", value="order"),
                questionary.Choice("📅 Statut de date", value="date_status"),
                questionary.Choice("📆 Date", value="date"),
                questionary.Choice("⏱  Durée", value="duration_h"),
                questionary.Choice("☀️  Météo", value="weather"),
                questionary.Choice("🔄 Recalculer stats GPX", value="gpx_stats"),
                questionary.Choice("🗺️  Régénérer le GeoJSON depuis le GPX", value="regen_geojson"),
                questionary.Choice("📷 Lien Instagram", value="instagram_url"),
                questionary.Choice("🌍 Lien Komoot", value="komoot_url"),
                questionary.Choice("↔️  Boucle (is_loop)", value="is_loop"),
                questionary.Separator(),
                questionary.Choice("🗑️  Supprimer cette trace", value="delete"),
                questionary.Choice("← Retour", value="back"),
            ],
        ).ask()

        if action is None or action == "back":
            return False

        if action == "label":
            val = questionary.text("Nouveau label :", default=item.get("label", "")).ask()
            if val is not None:
                item["label"] = val
                save_catalog(catalog_path, items)
                log_event("INFO", "traces", "field_updated",
                          id=item.get("id"), field="label", value=val)
                console.print("[green]✓ Label mis à jour[/]")

        elif action == "group":
            cur = item.get("group", KNOWN_GROUPS[0])
            default_g = cur if cur in KNOWN_GROUPS else KNOWN_GROUPS[0]
            val = questionary.select("Groupe :", choices=KNOWN_GROUPS, default=default_g).ask()
            if val is not None:
                item["group"] = val
                save_catalog(catalog_path, items)
                log_event("INFO", "traces", "field_updated",
                          id=item.get("id"), field="group", value=val)
                console.print("[green]✓ Groupe mis à jour[/]")

        elif action == "order":
            val = questionary.text("Ordre :", default=str(item.get("order", ""))).ask()
            if val is not None:
                try:
                    item["order"] = int(val)
                    save_catalog(catalog_path, items)
                    log_event("INFO", "traces", "field_updated",
                              id=item.get("id"), field="order", value=item["order"])
                    console.print("[green]✓ Ordre mis à jour[/]")
                except ValueError:
                    console.print("[red]Entier attendu.[/]")

        elif action == "date_status":
            cur = item.get("date_status", DATE_STATUS_CHOICES[0])
            default_ds = cur if cur in DATE_STATUS_CHOICES else DATE_STATUS_CHOICES[0]
            val = questionary.select(
                "Statut de date :", choices=DATE_STATUS_CHOICES, default=default_ds
            ).ask()
            if val is not None:
                item["date_status"] = val
                save_catalog(catalog_path, items)
                log_event("INFO", "traces", "field_updated",
                          id=item.get("id"), field="date_status", value=val)
                console.print("[green]✓ Statut mis à jour[/]")

        elif action == "date":
            val = questionary.text(
                "Date (YYYY-MM-DD, vide pour null) :", default=item.get("date") or ""
            ).ask()
            if val is not None:
                stripped = val.strip()
                if stripped and not DATE_RE.match(stripped):
                    console.print("[yellow]Format invalide — utiliser YYYY-MM-DD.[/]")
                else:
                    item["date"] = stripped or None
                    save_catalog(catalog_path, items)
                    log_event("INFO", "traces", "field_updated",
                              id=item.get("id"), field="date", value=item["date"])
                    console.print("[green]✓ Date mise à jour[/]")

        elif action == "duration_h":
            cur_h = item.get("duration_h")
            if cur_h is not None:
                total_min = round(cur_h * 60)
                h, m = divmod(total_min, 60)
                default_dur = f"{h}h{m:02d}" if m else f"{h}h"
            else:
                default_dur = ""
            val = questionary.text(
                "Durée (ex. 3h30 ou 3h, vide pour null) :", default=default_dur
            ).ask()
            if val is not None:
                stripped = val.strip()
                if stripped:
                    parsed = parse_duration(stripped)
                    if parsed is None:
                        console.print("[yellow]Format invalide — utiliser 3h30 ou 3.5.[/]")
                    else:
                        item["duration_h"] = parsed
                        save_catalog(catalog_path, items)
                        log_event("INFO", "traces", "field_updated",
                                  id=item.get("id"), field="duration_h", value=parsed)
                        console.print("[green]✓ Durée mise à jour[/]")
                else:
                    item["duration_h"] = None
                    save_catalog(catalog_path, items)
                    log_event("INFO", "traces", "field_updated",
                              id=item.get("id"), field="duration_h", value=None)
                    console.print("[green]✓ Durée effacée[/]")

        elif action == "weather":
            _edit_weather_submenu(item, items, catalog_path)

        elif action == "gpx_stats":
            _recalc_gpx_stats(item, items, catalog_path)

        elif action == "regen_geojson":
            if _regenerate_trace_geojson(item):
                save_catalog(catalog_path, items)

        elif action == "instagram_url":
            current = item.get("instagram_url") or ""
            val = questionary.text("URL Instagram (vide pour effacer) :", default=current).ask()
            if val is not None:
                stripped = val.strip()
                if stripped and not _INSTA_RE.match(stripped):
                    console.print("[yellow]⚠ URL invalide — doit commencer par https://www.instagram.com/[/]")
                else:
                    old = item.get("instagram_url")
                    item["instagram_url"] = stripped or None
                    save_catalog(catalog_path, items)
                    log_event("INFO", "traces", "item_updated",
                              id=item["id"], field="instagram_url",
                              old=old, new=item["instagram_url"])
                    console.print("[green]✓ Lien Instagram mis à jour[/]")

        elif action == "komoot_url":
            current = item.get("komoot_url") or ""
            val = questionary.text("URL Komoot (vide pour effacer) :", default=current).ask()
            if val is not None:
                stripped = val.strip()
                if stripped and not _KOMOOT_RE.match(stripped):
                    console.print("[yellow]⚠ URL invalide — doit matcher https://www.komoot.com/tour/XXXXXXX[/]")
                else:
                    old = item.get("komoot_url")
                    item["komoot_url"] = stripped or None
                    save_catalog(catalog_path, items)
                    log_event("INFO", "traces", "item_updated",
                              id=item["id"], field="komoot_url",
                              old=old, new=item["komoot_url"])
                    console.print("[green]✓ Lien Komoot mis à jour[/]")

        elif action == "is_loop":
            val = questionary.confirm(
                "Trace en boucle (is_loop) ?", default=bool(item.get("is_loop"))
            ).ask()
            if val is not None:
                if val:
                    item["is_loop"] = True
                else:
                    item.pop("is_loop", None)
                save_catalog(catalog_path, items)
                log_event("INFO", "traces", "field_updated",
                          id=item.get("id"), field="is_loop", value=val)
                console.print("[green]✓ Boucle mise à jour[/]")

        elif action == "delete":
            label_display = item.get("label", item["id"])
            if questionary.confirm(
                f"Supprimer définitivement « {label_display} » ?", default=False
            ).ask():
                del_tree = Tree("[bold red]Suppression")
                for path_key in ("full", "simplified"):
                    rel = item.get("paths", {}).get(path_key, "")
                    if rel:
                        p = REPO_ROOT / rel
                        if p.exists():
                            p.unlink()
                            del_tree.add(f"[red]✗[/] {rel}")
                console.print(del_tree)
                updated = [it for it in items if it["id"] != item["id"]]
                save_catalog(catalog_path, updated)
                console.print(f"[green]✓ « {label_display} » supprimé du catalog[/]")
                return True

    return False


# ---------------------------------------------------------------------------
# Supprimer toutes les données
# ---------------------------------------------------------------------------

def delete_all_data(args: argparse.Namespace) -> None:
    """Vide les catalogs Traces et Photos et supprime tous les fichiers dérivés."""
    if args.non_interactive:
        console.print("[red]Suppression de toutes les données impossible en mode non-interactif.[/]")
        sys.exit(2)

    trace_items, _ = load_catalog(CATALOG_TRACES)
    photo_items, _ = load_catalog(CATALOG_PHOTOS)
    trace_geojsons = sorted(TRACES_DIR.glob("*.geojson")) if TRACES_DIR.exists() else []
    thumb_files = sorted(THUMBS_DIR.glob("*.webp")) if THUMBS_DIR.exists() else []

    recap = "\n".join([
        f"  Catalog Traces    : [bold]{len(trace_items)}[/] items vidés",
        f"  Catalog Photos    : [bold]{len(photo_items)}[/] items vidés",
        f"  GeoJSON (data/traces/)  : [bold]{len(trace_geojsons)}[/] fichiers supprimés",
        f"  WebP    (data/thumbs/)  : [bold]{len(thumb_files)}[/] fichiers supprimés",
        "",
        "  [dim]Non touchés : sources/, groups.json, data/pois/, Supabase Storage[/]",
    ])
    console.print(Panel(
        recap,
        title="[bold red]⚠️  Suppression de toutes les données[/]",
        border_style="red",
    ))

    confirm_text = questionary.text(
        "Pour confirmer, tape exactement : SUPPRIMER"
    ).ask()
    if confirm_text is None or confirm_text.strip().upper() != "SUPPRIMER":
        console.print("[dim]Annulé.[/]")
        return

    n_deleted = 0
    save_catalog(CATALOG_TRACES, [])
    save_catalog(CATALOG_PHOTOS, [])

    for p in trace_geojsons:
        p.unlink()
        n_deleted += 1
    for p in thumb_files:
        p.unlink()
        n_deleted += 1

    empty_fc = {"type": "FeatureCollection", "features": []}
    PHOTOS_GEOJSON.parent.mkdir(parents=True, exist_ok=True)
    with PHOTOS_GEOJSON.open("w", encoding="utf-8") as f:
        json.dump(empty_fc, f, ensure_ascii=False, indent=2)

    console.print(
        f"[green]✓ {n_deleted} fichier(s) supprimé(s). Catalogs Traces et Photos vidés.[/]"
    )


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
    script_name = Path(cmd[0]).name if cmd else ""
    log_event("INFO", "subprocess", "call_start",
              script=script_name, args=cmd[1:], cwd=str(REPO_ROOT))
    t0 = time.monotonic()
    try:
        result = subprocess.run(
            cmd,
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            check=True,
        )
        duration_ms = round((time.monotonic() - t0) * 1000)
        if verbose and result.stdout:
            console.print(result.stdout)
        stderr_content = result.stderr.strip() if result.stderr else ""
        stderr_lines = len(stderr_content.splitlines()) if stderr_content else 0
        event_data: dict = dict(
            script=script_name,
            exit_code=0,
            duration_ms=duration_ms,
            stdout_lines=len(result.stdout.splitlines()) if result.stdout else 0,
            stderr_lines=stderr_lines,
        )
        if stderr_lines:
            event_data["stderr"] = stderr_content[:1000]
        log_event("INFO", "subprocess", "call_done", **event_data)
        branch.add("[green]✓ succès[/]")
        return True
    except subprocess.CalledProcessError as e:
        duration_ms = round((time.monotonic() - t0) * 1000)
        log_event("ERROR", "subprocess", "call_error",
                  script=script_name,
                  exit_code=e.returncode,
                  duration_ms=duration_ms,
                  stderr=(e.stderr or "")[:1000])
        branch.add(f"[red]✗ erreur (exit {e.returncode})[/]")
        if e.stdout:
            console.print(e.stdout)
        if e.stderr:
            console.print(f"[red]{e.stderr}[/]")
        return False
    except FileNotFoundError:
        duration_ms = round((time.monotonic() - t0) * 1000)
        log_event("ERROR", "subprocess", "call_error",
                  script=script_name, exit_code=-1, duration_ms=duration_ms,
                  stderr=f"commande introuvable : {cmd[0]}")
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
        files_removed = []
        for path_key in ("full", "simplified"):
            rel = item.get("paths", {}).get(path_key, "")
            if not rel:
                continue
            path = REPO_ROOT / rel
            if path.exists():
                path.unlink()
                files_removed.append(rel)
                tree.add(f"[red]✗[/] supprimé {path.relative_to(REPO_ROOT)}")
            else:
                tree.add(f"[dim]déjà absent {rel}[/]")
        log_event("INFO", "traces", "item_deleted",
                  id=item["id"], files_removed=files_removed)
        tree.add(f"[red]−[/] retiré du catalog : {item['id']}")
    return [it for it in trace_items if it["id"] not in delete_ids]


def delete_orphan_photos(to_delete: list[dict], photo_items: list[dict],
                         tree: Tree, verbose: bool) -> list[dict]:
    """Supprime les thumbs locaux et retire les entrées orphelines. Retourne les items mis à jour."""
    tree.add("[yellow]⚠ Supabase Storage non modifié — suppression manuelle si nécessaire[/]")
    delete_ids = {it["id"] for it in to_delete}
    for item in to_delete:
        thumb = item.get("paths", {}).get("thumb", "")
        files_removed = []
        if thumb:
            thumb_path = THUMBS_DIR / (Path(thumb).stem + ".webp")
            if thumb_path.exists():
                thumb_path.unlink()
                files_removed.append(str(thumb_path.relative_to(REPO_ROOT)))
                tree.add(f"[red]✗[/] supprimé {thumb_path.relative_to(REPO_ROOT)}")
            else:
                tree.add(f"[dim]thumb déjà absent : {thumb}[/]")
        log_event("INFO", "photos", "item_deleted",
                  id=item["id"], files_removed=files_removed)
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

    log_event("INFO", "traces", "sync_start",
              mode=mode, to_add=len(to_add), to_delete=len(to_delete))

    console.rule("[bold]🗺️  Traces")
    tree = Tree("[bold cyan]🗺️  Traces")
    all_ok = True
    added = 0
    deleted = 0
    errors = 0
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
                log_event("ERROR", "traces", "error",
                          message="gpx_to_geojson failed", item_id=stem)
                errors += 1
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
            log_event("INFO", "traces", "item_added",
                      id=stem, label=meta["label"],
                      group=meta["group"],
                      source=str(gpx_path.relative_to(REPO_ROOT)))
            added += 1

    if do_delete:
        before = len(trace_items)
        trace_items = delete_orphan_traces(to_delete, trace_items, tree, args.verbose)
        deleted = before - len(trace_items)

    save_catalog(CATALOG_TRACES, trace_items, args.verbose)
    console.print(tree)

    log_event("INFO", "traces", "sync_done",
              added=added, deleted=deleted, errors=errors)
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

    log_event("INFO", "photos", "sync_start",
              mode=mode, to_add=len(to_add), to_delete=len(to_delete))

    if do_add and not os.environ.get("SUPA_SECRET_KEY"):
        console.print(
            "[yellow]⚠ SUPA_SECRET_KEY non définie — l'upload Supabase sera ignoré.[/]\n"
            "  Définir avec : export SUPA_SECRET_KEY='sb_secret_...'"
        )

    if do_add and not args.non_interactive:
        for photo in to_add:
            prompt_photo_meta(photo, non_interactive=False)

    console.rule("[bold]📷 Photos")
    tree = Tree("[bold cyan]📷 Photos")
    all_ok = True
    added = 0
    deleted = 0
    errors = 0
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
        if not ok:
            log_event("ERROR", "photos", "error",
                      message="make_thumbs failed", item_id=None)
            errors += 1
        all_ok = all_ok and ok

        if os.environ.get("SUPA_SECRET_KEY"):
            ok = run_script(
                [PYTHON, str(SCRIPTS_DIR / "sync_photos_to_supabase.py")],
                "sync_photos_to_supabase.py", tree, args.verbose,
            )
            if not ok:
                log_event("ERROR", "photos", "error",
                          message="sync_photos_to_supabase failed", item_id=None)
                errors += 1
            all_ok = all_ok and ok
        else:
            tree.add("[yellow]⚠ sync_photos_to_supabase.py ignoré (pas de SUPA_SECRET_KEY)[/]")

        ok = run_script(
            [PYTHON, str(SCRIPTS_DIR / "photos_to_poi.py"), "--out", str(PHOTOS_GEOJSON)],
            "photos_to_poi.py", tree, args.verbose,
        )
        if not ok:
            log_event("ERROR", "photos", "error",
                      message="photos_to_poi failed", item_id=None)
            errors += 1
        all_ok = all_ok and ok
        before = len(photo_items)
        photo_items = _merge_photos_from_geojson(photo_items, tree, args.verbose)
        added = len(photo_items) - before

    if do_delete:
        before = len(photo_items)
        photo_items = delete_orphan_photos(to_delete, photo_items, tree, args.verbose)
        deleted = before - len(photo_items)
        _filter_photos_geojson(tree)

    save_catalog(CATALOG_PHOTOS, photo_items, args.verbose)
    console.print(tree)

    log_event("INFO", "photos", "sync_done",
              added=added, deleted=deleted, errors=errors)
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

    max_order = max((it.get("order") or 0 for it in photo_items), default=0)

    added = 0
    for feature in features:
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
        if time_raw and ":" in time_raw[:4]:
            try:
                date_part, time_part = time_raw.split(" ", 1)
                time_iso = f"{date_part.replace(':', '-')}T{time_part}"
            except Exception:
                time_iso = time_raw
        else:
            time_iso = time_raw

        photo_defaults = build_photo_defaults(stem) if stem else {}
        order = photo_defaults.get("order")
        if order is None:
            max_order += 1
            order = max_order

        photo_items.append({
            "id": stem or f"photo-{order:02d}",
            "label": photo_defaults.get("label") or p.get("name", "") or stem,
            "description": "",
            "group": "acte-2",
            "paths": {
                "thumb": f"data/thumbs/{stem}.webp" if stem else thumb,
                "remote": remote,
            },
            "source": f"sources/photos/{stem}{ext}" if stem else "",
            "order": order,
            "time": time_iso,
            "lat": lat,
            "lon": lon,
        })
        added += 1

    photo_items.sort(key=lambda it: (it.get("order") is None, it.get("order") or 0))

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
    log_event("INFO", "pois", "sync_start", mode="both", to_add=len(scan["pois"]["to_add"]))

    console.rule("[bold]🌐 POI")
    tree = Tree("[bold cyan]🌐 POI")

    pois_cmd = [PYTHON, str(SCRIPTS_DIR / "sync_pois_from_supabase.py"), "-o", str(POIS_GEOJSON)]
    if args.verbose:
        pois_cmd.append("-v")
    ok = run_script(pois_cmd, "sync_pois_from_supabase.py", tree, args.verbose)

    added = 0
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
        added = len(poi_items)
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
    elif not ok:
        log_event("ERROR", "pois", "error",
                  message="sync_pois_from_supabase failed", item_id=None)

    console.print(tree)

    log_event("INFO", "pois", "sync_done",
              added=added, deleted=0, errors=0 if ok else 1)
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
    parser.add_argument("--photos-only", action="store_true",
                        help="Photos uniquement — alias explicite pour CI (équiv. --photos --non-interactive)")
    parser.add_argument("--pois", action="store_true", help="POI seulement")
    parser.add_argument("--add-only", action="store_true", help="Ajouts uniquement (pas de suppression)")
    parser.add_argument("--delete-only", action="store_true", help="Suppressions uniquement (pas d'ajout)")
    parser.add_argument("--non-interactive", action="store_true", help="Pas de prompts interactifs (mode CI)")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip l'écran de confirmation")
    parser.add_argument("--log-dir", type=Path, default=LOG_DIR_DEFAULT,
                        help=f"Dossier de logs JSONL (défaut : {LOG_DIR_DEFAULT})")
    parser.add_argument("--no-log", action="store_true", help="Désactiver le fichier de log")
    parser.add_argument("-v", "--verbose", action="store_true", help="Logs détaillés")
    args = parser.parse_args()

    # Initialiser le logger
    if not args.no_log:
        init_logger(args.log_dir)

    t_start = time.monotonic()
    log_event("INFO", "system", "start",
              argv=sys.argv[1:],
              python_version=sys.version,
              cwd=str(Path.cwd()))

    if args.add_only and args.delete_only:
        console.print("[red]--add-only et --delete-only sont mutuellement exclusifs.[/]")
        log_event("ERROR", "system", "done", exit_code=1,
                  duration_s=round(time.monotonic() - t_start, 2),
                  totals={})
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

    has_work = (
        scan["traces"]["to_add"] or scan["traces"]["to_delete"] or
        scan["photos"]["to_add"] or scan["photos"]["to_delete"] or
        scan["pois"]["to_add"]
    )
    if not has_work and not (args.all or args.traces or args.photos or args.photos_only or args.pois):
        if args.non_interactive:
            console.print("[green]✓ Tout est déjà à jour.[/]")
            log_event("INFO", "system", "done", exit_code=0,
                      duration_s=round(time.monotonic() - t_start, 2),
                      totals={"nothing_to_do": True})
            sys.exit(0)
        # Mode interactif : on continue vers le menu (POI + gestion catalog disponibles)

    # --photos-only : alias CI explicite → force photos, désactive traces et POI
    if args.photos_only:
        args.photos = True
        args.non_interactive = True

    # --- Déterminer ce qu'on synchronise ---
    if args.all:
        do_traces = do_photos = do_pois = True
    elif args.traces or args.photos or args.pois:
        do_traces = args.traces
        do_photos = args.photos or args.photos_only
        do_pois = args.pois
    elif args.non_interactive:
        console.print("[dim]Aucun flag de sync fourni. Utiliser --all ou --traces/--photos/--pois.[/]")
        log_event("INFO", "system", "done", exit_code=0,
                  duration_s=round(time.monotonic() - t_start, 2),
                  totals={"nothing_to_do": True})
        sys.exit(0)
    else:
        try:
            action, mode = interactive_menu(scan)
        except KeyboardInterrupt:
            log_event("WARN", "system", "aborted", stage="menu")
            console.print("\n[dim]Interrompu.[/]")
            sys.exit(0)
        if action == "quit":
            log_event("WARN", "system", "aborted", stage="menu_quit")
            console.print("[dim]Annulé.[/]")
            sys.exit(0)
        if action == "list_edit":
            try:
                list_and_edit_catalog()
            except KeyboardInterrupt:
                console.print("\n[dim]Interrompu.[/]")
            log_event("INFO", "system", "done", exit_code=0,
                      duration_s=round(time.monotonic() - t_start, 2), totals={})
            sys.exit(0)
        if action == "delete_all":
            try:
                delete_all_data(args)
            except KeyboardInterrupt:
                console.print("\n[dim]Interrompu.[/]")
            log_event("INFO", "system", "done", exit_code=0,
                      duration_s=round(time.monotonic() - t_start, 2), totals={})
            sys.exit(0)
        if action == "poi_from_photo":
            try:
                prompt_poi_from_photo()
            except KeyboardInterrupt:
                console.print("\n[dim]Interrompu.[/]")
            log_event("INFO", "system", "done", exit_code=0,
                      duration_s=round(time.monotonic() - t_start, 2), totals={})
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
        log_event("WARN", "system", "aborted", stage="non_interactive_delete_guard")
        sys.exit(2)

    # --- Confirmation ---
    try:
        if not confirm_operations(scan, do_traces, do_photos, do_pois, mode, args):
            log_event("WARN", "system", "aborted", stage="confirmation")
            sys.exit(0)
    except KeyboardInterrupt:
        log_event("WARN", "system", "aborted", stage="confirmation")
        console.print("\n[dim]Interrompu.[/]")
        sys.exit(0)

    # --- Exécution ---
    all_ok = True
    console.rule("[bold]⚙️  Exécution")

    try:
        if do_traces:
            ok = sync_traces(scan, args, mode=mode)
            all_ok = all_ok and ok

        if do_photos:
            ok = sync_photos(scan, args, mode=mode)
            all_ok = all_ok and ok

        if do_pois:
            ok = sync_pois(scan, args)
            all_ok = all_ok and ok
    except KeyboardInterrupt:
        log_event("WARN", "system", "aborted", stage="execution")
        console.print("\n[dim]Interrompu pendant l'exécution.[/]")
        sys.exit(1)

    # --- Résumé ---
    console.rule("[bold]📊 Résumé")
    scan_after = scan_sources()
    stats_tree = Tree("[bold]Catalogs après mise à jour")
    totals = {}
    for label, key in [("Traces", "traces"), ("Photos", "photos"), ("POI", "pois"), ("Groupes", "groups")]:
        count = scan_after[key]["catalog_count"]
        stats_tree.add(f"{label} : [cyan]{count}[/] entrées")
        totals[key] = count
    console.print(stats_tree)

    exit_code = 0 if all_ok else 1
    log_event("INFO", "system", "done",
              exit_code=exit_code,
              duration_s=round(time.monotonic() - t_start, 2),
              totals=totals)

    if all_ok:
        console.print("\n[green]✓ Synchronisation terminée avec succès.[/]")
        sys.exit(0)
    else:
        console.print("\n[red]✗ Des erreurs ont été rencontrées — voir les détails ci-dessus.[/]")
        sys.exit(1)


if __name__ == "__main__":
    main()

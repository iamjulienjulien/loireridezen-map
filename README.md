# 🗺️ Loire Ride Zen — Carte interactive

Carte interactive du projet **Loire Ride Zen** :
un récit de voyage à vélo le long de la Loire, mêlant **traces**, **points d'intérêt**, **photos géolocalisées** et **coups de cœur personnels**.

Ce projet combine **Leaflet**, **Supabase + PostGIS**, et des **outils Python** pour transformer une aventure réelle en expérience cartographique vivante.

---

## ✨ Fonctionnalités

- 🚴 **Parcours à vélo**
  - Traces par acte et par étape
  - Micro-aventures (boucles locales)
  - Couleurs par étape, par groupe ou dynamiques

- 📍 **Points d'intérêt (POI)**
  - Patrimoine (châteaux, lieux historiques)
  - Guinguettes
  - Hébergements
  - Départs / Arrivées
  - ⭐ Coups de cœur personnels

- 📷 **Photos géolocalisées**
  - Générées automatiquement depuis les EXIF
  - Miniatures optimisées pour les popups

- 🗺️ **Carte avancée**
  - Vue Plan (OpenStreetMap)
  - Vue Satellite (Esri)
  - Clustering doux des POI
  - Filtres par type
  - Panneau latéral repliable (desktop & mobile)
  - Plein écran

---

## 🧱 Stack technique

### Frontend

- **Leaflet 1.9**
- Leaflet MarkerCluster
- Leaflet ExtraMarkers
- Leaflet Fullscreen
- Font Awesome
- Vanilla JS / HTML / CSS

### Backend (POI dynamiques)

- **Supabase**
- **PostgreSQL + PostGIS**
- RPC SQL retournant du **GeoJSON par BBOX**
- Schéma versionné dans `sql/schema.sql` (cf. [Schéma Supabase & migrations](#-schéma-supabase--migrations))

### Data & tooling

- GeoJSON (RFC 7946)
- GPX → GeoJSON (via `gpxpy` + `shapely` pour la simplification)
- Python (Pillow, pillow-heif, exifread, rich, questionary)
- Photos originales hébergées sur **Supabase Storage** (bucket `photos`)
- Catalogs JSON `data/catalog/` comme source de vérité éditoriale

### Déploiement

- Hébergement : **Vercel** (site statique)
- Configuration runtime via `config.js` (généré au build, jamais committé)

---

## 📁 Structure du projet

```
.
├─ index.html
├─ README.md
├─ requirements.txt
├─ vercel.json
├─ .vercelignore
├─ config.js.example
├─ app.js
├─ app/
│  ├─ config.js
│  ├─ current-position.js   ← marker "Où je suis"
│  ├─ helpers.js
│  ├─ locate.js
│  ├─ map.js
│  ├─ poi.js
│  ├─ preferences.js
│  ├─ routes.js
│  ├─ step-popup.js         ← popups d'étape riches
│  ├─ trace-markers.js      ← markers Départ/Étape/Arrivée calculés
│  ├─ types.js
│  └─ ui.js
├─ scripts/
│  ├─ lib/
│  │  ├─ __init__.py
│  │  ├─ supabase_client.py     ← client Supabase partagé (SUPA_URL + SUPA_SECRET_KEY)
│  │  └─ poi.py                 ← fonctions CRUD POI (list, get, create, update, delete)
│  ├─ gpx_to_geojson.py
│  ├─ make_thumbs.py
│  ├─ migrate.py
│  ├─ migrate_photos_order.py   ← migration idempotente des labels/order photos
│  ├─ photos_to_poi.py
│  ├─ sync_photos_to_supabase.py
│  ├─ sync_pois_from_supabase.py
│  ├─ update_data.py            ← orchestrateur principal
│  └─ update_position.py        ← marker "Où je suis" (CLI interactif)
├─ sources/                 ← gitignored, matière brute
│  ├─ gpx/
│  └─ photos/
├─ data/
│  ├─ catalog/              ← inventaires JSON éditoriaux
│  │  ├─ groups.json
│  │  ├─ traces.json
│  │  ├─ photos.json
│  │  ├─ pois.json
│  │  └─ current_position.json   ← marker "Où je suis" (mis à jour par update_position.py)
│  ├─ traces/               ← GeoJSON générés depuis sources/gpx/
│  │  ├─ *.geojson
│  │  └─ *_simplified.geojson
│  ├─ pois/
│  │  ├─ pois.geojson       ← snapshot Supabase
│  │  └─ pois_photos.geojson
│  └─ thumbs/               ← miniatures WebP commitées (~5 MB)
├─ assets/
│  └─ logo_loire_ride_zen.jpg
└─ sql/
   ├─ schema.sql
   └─ migrations/
```

Fichiers **non versionnés** (générés ou locaux, dans `.gitignore`) :

- `config.js` — créé localement depuis `config.js.example`, généré par le build Vercel en prod
- `sources/` — matière brute (GPX, photos JPEG/HEIC) non commités
- `.venv/` — environnement Python local
- `.supabase/` — état local de Supabase CLI

---

## 🛠 Setup local

Une fois Python 3 installé sur la machine, depuis la racine du projet :

```bash
# 1. Environnement Python isolé
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. Configuration runtime (Supabase URL + publishable key)
cp config.js.example config.js
# puis éditer config.js avec les vraies valeurs (cf. console Supabase)
```

À chaque nouvelle session terminal, réactiver le venv avec `source .venv/bin/activate`. Le prompt commencera par `(.venv)` pour le signaler. Pour le désactiver : `deactivate`.

Pour servir la carte en local : n'importe quel serveur HTTP statique fonctionne, par exemple `python3 -m http.server 8000` puis ouvrir `http://localhost:8000`.

---

## 🔀 Cartographie des flux

Comment une donnée arrive sur la carte, selon sa source :

```
┌─────────────────────────────────────────────────────────────────┐
│  FLUX 1 — Photos terrain → POI photos                            │
└─────────────────────────────────────────────────────────────────┘

  sources/photos/        update_data.py ──┬─ make_thumbs.py ──→ data/thumbs/*.webp
  (JPEG/HEIC + EXIF GPS)                  ├─ sync_photos_to_supabase.py → Supabase Storage
                                          └─ photos_to_poi.py ──→ data/pois/pois_photos.geojson
                                                                         │
                                                                         ▼
                                                                 Leaflet (couche photos)


┌─────────────────────────────────────────────────────────────────┐
│  FLUX 2 — GPX → traces géographiques                             │
└─────────────────────────────────────────────────────────────────┘

  sources/gpx/           update_data.py ──→ gpx_to_geojson.py ──→ data/traces/*.geojson
  (GPX terrain)                                                     data/catalog/traces.json
                                                                         │
                                                                         ▼
                                                                 Leaflet (couche traces)


┌─────────────────────────────────────────────────────────────────┐
│  FLUX 3 — POI dynamiques → marqueurs sur la carte                │
└─────────────────────────────────────────────────────────────────┘

  Table public.pois         RPC pois_bbox_geojson    fetch JS
  (PostGIS, SRID 4326) ───→ (filtre par BBOX)   ───→ (BBOX courante)
                                                          │
                                                          ▼
                                                  Leaflet (cluster POI)

  ╔══════════════════════════════════════════════════════════════╗
  ║  Snapshot offline (édition + traçabilité)                    ║
  ║                                                              ║
  ║  Table public.pois     update_data.py ──→ sync_pois.py       ║
  ║                  ───→  (export RFC 7946)                     ║
  ║                        data/pois/pois.geojson (committé)     ║
  ╚══════════════════════════════════════════════════════════════╝
```

Les trois flux convergent dans le même cluster Leaflet, qui les gère côte à côte (filtres par type, popup au clic).

---

## 🎛 Workflow de synchronisation

`scripts/update_data.py` est le **point d'entrée unique** pour toute mise à jour des données. Il orchestre les scripts Python individuels, met à jour les catalogs JSON, et guide interactivement les ajouts éditoriaux.

### Usage

```bash
# Menu interactif (mode normal)
python scripts/update_data.py

# Tout synchroniser sans prompts (mode CI)
python scripts/update_data.py --all --non-interactive --yes

# Ajouts uniquement, traces
python scripts/update_data.py --add-only --traces

# Logs détaillés
python scripts/update_data.py -v
```

### Déroulement type

**Écran 1 — Scan des sources**

```
╭─────────────────────────────────────────────────────╮
│ 🚲 Loire Ride Zen — Mise à jour des données         │
│ Scan des sources 🔎                                 │
╰─────────────────────────────────────────────────────╯
Catégorie    Catalog   Sources    Diff
Traces            11        2      +2
Photos            17        3      +3
POI               36         —     N/A
Groupes            4         4       0
```

**Écran 2 — Menu interactif**

```
Que voulez-vous synchroniser ?
❯ Tout ajouter
  Tout supprimer
  Traces seulement (ajout de 2)
  Photos seulement (ajout de 3)
  POI avec la base de données
  Quitter
```

**Écran 3 — Prompts éditoriaux** (pour chaque nouvel item)

```
Label pour 'etape-09-angers-nantes' : Étape 9 — Angers → Nantes
Groupe : ❯ acte-3
Description (optionnelle) : La dernière ligne droite.
```

**Écran 4 — Exécution avec arbre visuel**

```
── Traces
   ├─ etape-09.gpx → etape-09.geojson         ✓ succès
   ├─ etape-09.gpx → etape-09_simplified.geojson ✓ succès
   └─ +1 entrée ajoutée dans traces.json
```

### Workflow après une sortie terrain

```bash
# 1. Déposer les GPX dans sources/gpx/
#    Déposer les photos dans sources/photos/

# 2. Lancer l'orchestrateur
python scripts/update_data.py

# 3. Vérifier les changements
git diff data/catalog/ data/traces/ data/thumbs/

# 4. Commit + push
git add data/ && git commit -m "data: ajout étape 9 + photos terrain"
git push
```

> Les scripts individuels (`gpx_to_geojson.py`, `make_thumbs.py`, etc.) restent appelables directement — ils sont les briques de base qu'`update_data.py` orchestre.

---

## 📋 Catalogs éditoriaux

Les quatre fichiers `data/catalog/*.json` sont la **source de vérité éditoriale** du projet. La carte les lit directement au chargement (plus de paths hardcodés).

| Fichier | Rôle | Mis à jour par |
|---|---|---|
| `groups.json` | Définition des actes et micro-aventures | **Manuellement** (couleurs, labels, ordre) |
| `traces.json` | Inventaire des traces GPX | `update_data.py` à l'ajout/suppression |
| `photos.json` | Inventaire des photos géolocalisées | `update_data.py` après sync photos |
| `pois.json` | Snapshot light des POI Supabase | `update_data.py --pois` (régénéré entier) |
| `current_position.json` | Position courante du cycliste sur la carte | `update_position.py` (CLI interactif) |

### Quand éditer à la main

- **`groups.json`** — ajouter un acte, changer une couleur, modifier un label, réordonner. Ce fichier est pensé pour l'édition humaine : les couleurs, descriptions et années y sont maintenues.
- **`traces.json`** — corriger un label ou une description après import, modifier l'ordre d'affichage, ajuster `distance_km` / `elevation_gain_m`.
- **`photos.json`** — corriger le label ou la description d'une photo, changer son groupe.

### Quand ne pas éditer à la main

- **`pois.json`** — régénéré entièrement à chaque `update_data.py --pois`. Toute édition manuelle sera écrasée.
- Les champs `paths`, `source`, `updated_at` — gérés automatiquement, ne pas toucher.

### Format des catalogs

Tous les catalogs partagent la même enveloppe :

```json
{
  "updated_at": "2026-05-19T22:00:00+00:00",
  "items": [ ... ]
}
```

Le champ `color` dans `groups.json` accepte trois formes :

```json
"color": "#34495E"               // couleur fixe
"color": ["#2E86AB", "#E74C3C"]  // cyclage par étape (modulo)
"color": "fn:byStage"            // fonction JS (définie dans app/types.js)
```

> Pour le schéma complet de chaque catalog, voir le ticket de spec `development/tickets/LRZ-EVO-1.md`.

---

## 🔐 Variables d'environnement

Deux niveaux de credentials Supabase à distinguer.

### Côté navigateur (carte publique)

Configuration runtime exposée au client via `window.LRZ_CONFIG` dans `config.js`. **Gitignored**.

**En local**, copier `config.js.example` en `config.js` et y mettre les valeurs réelles :

```js
window.LRZ_CONFIG = {
  SUPA_URL: "https://covxsekavbmeqysdqnjh.supabase.co",
  SUPA_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxxxxxxxxxxxxxxxx_xxxxxxxx",
};
```

Ces valeurs sont à récupérer dans la console Supabase → Project Settings → API Keys (**publishable** key, pas secret).

**En production (Vercel)**, le fichier `config.js` est **généré au moment du build** par Vercel à partir des variables d'environnement :

| Variable               | Description                                   | Visibilité                   |
| ---------------------- | --------------------------------------------- | ---------------------------- |
| `SUPA_URL`             | URL du projet Supabase                        | Publique (exposée au client) |
| `SUPA_PUBLISHABLE_KEY` | Clé publishable Supabase (`sb_publishable_*`) | Publique (exposée au client) |

À configurer dans : Vercel Dashboard → Project Settings → Environment Variables. Cocher les 3 environnements (Production / Preview / Development).

Le `buildCommand` de `vercel.json` lit ces variables et écrit le `config.js` avant que Vercel ne serve les fichiers.

### Côté scripts admin (push vers Supabase)

Certaines opérations administratives — uploader des photos sur Supabase Storage, par exemple — nécessitent le rôle `service_role` (bypass RLS). La clé associée est la **`SUPA_SECRET_KEY`** (format `sb_secret_*`).

| Variable          | Utilisée par                          | Source autorisée             |
| ----------------- | ------------------------------------- | ---------------------------- |
| `SUPA_SECRET_KEY` | `scripts/sync_photos_to_supabase.py`  | **Variable d'env seulement** |

```bash
# Récupérer dans console Supabase → Settings → API Keys → Secret key → Reveal
export SUPA_SECRET_KEY="sb_secret_xxxxxxxxxxxxxxxxxxxxxx_xxxxxxxx"
```

> ⚠️ **`SUPA_SECRET_KEY` ne doit JAMAIS être dans `config.js`** ni dans aucun fichier committé. `config.js` est exposé au navigateur (en local et en prod via Vercel). Y placer la secret key serait une fuite immédiate avec accès complet à la base. Stockage recommandé : 1Password / Bitwarden / Keychain macOS, et `export` ponctuel dans le terminal au moment de l'utiliser.

---

## 📍 Ajouter / éditer un POI

Les POI vivent dans la table `public.pois` de Supabase, **pas** dans un fichier local. La carte les récupère via la RPC `pois_bbox_geojson` à chaque changement de vue.

### Ajouter un POI

1. Console Supabase → Project `covxsekavbmeqysdqnjh` → **Table Editor** → table `pois`
2. Cliquer **Insert row**
3. Renseigner au minimum :
   - `name` — texte
   - `type` — une des valeurs autorisées (cf. CHECK constraint) : `paysage`, `patrimoine`, `guinguette`, `hébergement`, `départ`, `arrivée`, `photo`, `coupdecoeur`
   - `stage` — entier (numéro d'étape ou `0` hors-étape)
   - `geom` — point géographique au format `SRID=4326;POINT(lon lat)`. Exemple : `SRID=4326;POINT(-0.5594 47.4732)` pour Angers
4. Champs optionnels : `description`, `url`, `url_insta`, `image`, `thumb`
5. Cliquer **Save**

Le POI apparaît sur la carte au prochain chargement (pas de cache, fetch BBOX direct).

### Éditer un POI

Même chemin (Table Editor → ligne concernée → double-clic sur la cellule à modifier). Les modifications sont effectives immédiatement.

### Supprimer un POI

Cocher la ligne → bouton **Delete** en haut. Action irréversible (pas de soft-delete).

> ⚠️ **Édition concurrente.** Pas de versioning sur les POI. À deux mains sur la même ligne au même moment = la dernière écriture gagne.

> 💾 **Après chaque session d'édition**, lance `python scripts/update_data.py --pois` pour mettre à jour le snapshot offline dans le repo.

---

## 🗂 Gestion des POI en ligne de commande

`scripts/update_data.py` intègre un **sous-menu CRUD complet** pour gérer les POI Supabase sans passer par la console web. Accessible via le menu principal → **Lister / modifier le catalog** → **POI (Supabase)**.

### Prérequis

Deux variables d'env sont nécessaires (secret key, pas la publishable) :

```bash
export SUPA_URL="https://covxsekavbmeqysdqnjh.supabase.co"
export SUPA_SECRET_KEY="sb_secret_..."   # Settings → API Keys → Secret key
```

La dépendance Python est dans `requirements.txt` :

```bash
pip install supabase>=2.5.0
# ou si venv actif :
pip install -r requirements.txt
```

### Opérations disponibles

| Action | Description |
|---|---|
| **Lister tous les POI** | Tableau rich : ID, type, nom, coordonnées, statut visité (pagination si > 100) |
| **Filtrer par type** | Affiche seulement les POI d'un type donné |
| **Ajouter un POI** | Saisie guidée : type, nom, description, coordonnées, URL Instagram, champs château |
| **Modifier un POI** | Sélection dans la liste, édition champ par champ, diff calculé avant envoi |
| **Supprimer un POI** | Sélection + confirmation explicite "SUPPRIMER" (irréversible) |

### Lancer

```bash
python scripts/update_data.py
# → Lister / modifier le catalog → POI (Supabase)
```

### Logs

Chaque opération CRUD (create / update / delete) est tracée dans `logs/update_data/YYYY-MM-DD.jsonl` avec timestamp, run_id, et données modifiées.

### Notes

- La confirmation "SUPPRIMER" est obligatoire même avec `--yes` (protection intentionnelle).
- Pour les châteaux : trois champs supplémentaires — `construction_date`, `photo_path`, `visited`.
- Un avertissement s'affiche si `photo_path` pointe vers un fichier absent localement.
- Après une session CRUD, lancer `python scripts/update_data.py --pois` pour régénérer le snapshot `data/pois/pois.geojson`.

---

## 💾 Synchroniser les POI dans le repo

Le fichier `data/pois/pois.geojson` est un **snapshot fidèle** de la table Supabase, régénéré automatiquement par le script `sync_pois_from_supabase.py`. Ce snapshot vit dans le repo, est versionné par git, et permet :

- Une **traçabilité historique** des évolutions du catalogue de POI (`git log`, `git blame`)
- Un **backup déconnecté** : si le projet Supabase est perdu, le fichier permet de tout réinjecter
- Une **revue avant publication** : `git diff` avant push pour vérifier les changements

Le snapshot n'est **pas** utilisé en runtime par la carte — celle-ci lit Supabase directement via la RPC. Le fichier est strictement un artefact de mémoire et de sauvegarde.

### Utilisation

Via l'orchestrateur (recommandé) :

```bash
python scripts/update_data.py --pois
```

Ou directement :

```bash
python scripts/sync_pois_from_supabase.py
```

Le script :

1. Lit les credentials depuis `config.js` (ou env vars `SUPA_URL` + `SUPA_PUBLISHABLE_KEY` si présentes — elles ont priorité)
2. Interroge la RPC `pois_bbox_geojson` avec une BBOX mondiale (récupère tous les POI en une requête)
3. Trie les features par `stage` puis `name` pour des diffs git stables
4. Écrit `data/pois/pois.geojson` indenté à 2 espaces

### Options notables

```bash
# Sortie compacte (une seule ligne, pour la prod si besoin)
python scripts/sync_pois_from_supabase.py --indent 0

# Chemin de sortie custom
python scripts/sync_pois_from_supabase.py -o data/pois/pois_backup_2026-06-01.geojson

# Sans tri (garder l'ordre Supabase, déconseillé pour les diffs)
python scripts/sync_pois_from_supabase.py --no-sort

# Logs détaillés
python scripts/sync_pois_from_supabase.py -v
```

### Workflow type après édition

```bash
# 1. Éditer dans Supabase Table Editor (cf. section précédente)
# 2. Régénérer le snapshot
python scripts/update_data.py --pois

# 3. Vérifier les changements
git diff data/pois/pois.geojson

# 4. Commit + push si OK
git add data/pois/pois.geojson data/catalog/pois.json
git commit -m "data(pois): mise à jour du snapshot après ajout étape 3"
git push
```

### Dépannage

| Message                                         | Cause probable                            | Solution                                                                 |
| ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| `SUPA_URL et SUPA_PUBLISHABLE_KEY introuvables` | `config.js` absent ou mal parsé           | `cp config.js.example config.js` puis éditer                             |
| `HTTP 401` ou `HTTP 403`                        | Clé publishable invalide ou RLS bloquante | Vérifier la clé dans la console Supabase + policies RLS de `public.pois` |
| `Aucun POI récupéré`                            | Table vide, ou RLS qui filtre tout        | Vérifier dans Supabase Table Editor que les POI existent                 |
| `Erreur réseau`                                 | Pas de connexion ou URL Supabase erronée  | Vérifier `SUPA_URL`                                                      |

> 💡 **Pas de dépendance externe.** Le script utilise uniquement la stdlib Python (`urllib`), donc pas d'ajout à `requirements.txt`. Il marche dès que Python 3 est installé.

---

## 🗄 Schéma Supabase & migrations

Le schéma de la base est **versionné** dans le repo, à la racine sous `sql/`, et géré via **Supabase CLI**.

### Pourquoi

Avant cette mise en place, le schéma vivait uniquement dans le projet Supabase distant. Une perte du projet (compte fermé, suppression accidentelle) aurait entraîné une perte irréversible du schéma. Maintenant, `sql/schema.sql` peut tout reconstruire à partir de zéro.

### Installation de Supabase CLI

```bash
# macOS via Homebrew
brew install supabase/tap/supabase

# Ou via npm
npm install -g supabase
```

Puis se connecter et lier le projet :

```bash
supabase login
supabase link --project-ref covxsekavbmeqysdqnjh
```

### Geler le schéma actuel

À faire une fois pour produire l'état actuel de la base en SQL :

```bash
supabase db dump --schema public --file sql/schema.sql
git add sql/schema.sql && git commit -m "freeze: snapshot schema"
```

### Créer une nouvelle migration

Toute modification structurelle (ajout de colonne, nouvelle policy, nouvelle RPC...) passe désormais par une migration versionnée :

```bash
# 1. Créer un fichier de migration vide horodaté
supabase migration new <nom_court_explicite>
# ex: supabase migration new add_url_audio_to_pois

# 2. Éditer le fichier SQL généré dans sql/migrations/
#    Y mettre les commandes ALTER, CREATE, etc.

# 3. Appliquer en local (si Supabase local lancé) ou pousser en distant
supabase db push

# 4. Committer la migration
git add sql/migrations/ && git commit -m "migration: <description>"
```

### Tirer les changements appliqués manuellement dans la console

Si une modif a été faite via le SQL editor de la console sans passer par CLI (à éviter, mais ça arrive) :

```bash
supabase db pull
```

Cela génère une migration locale qui reflète l'état distant. À committer ensuite.

> 💡 **Règle.** Ne plus modifier le schéma via le SQL editor de la console. Tout passe par `supabase migration new` + `supabase db push`. Garantit la traçabilité et la reproductibilité.

---

## 📷 POI depuis des photos géolocalisées

Transforme automatiquement les photos de terrain en points d'intérêt sur la carte. Workflow en 4 étapes : photos en local → miniatures + upload Supabase → GeoJSON.

### 1) Ajouter les photos

Place les photos **géolocalisées** dans `sources/photos/` (dossier gitignored). Formats supportés : JPG / JPEG, PNG, HEIC. Les photos sans GPS sont automatiquement ignorées.

### 2) Générer les miniatures WebP

```bash
python scripts/make_thumbs.py \
  --photos sources/photos \
  --thumbs data/thumbs \
  --width 1200 \
  --quality 80
```

Les miniatures restent dans le repo (`data/thumbs/`, ~5 MB total). Elles servent à l'affichage rapide dans les popups Leaflet.

### 3) Uploader les originaux sur Supabase Storage

Les photos originales (JPEG/HEIC, 1.6 à 5 MB chacune) sont hébergées sur **Supabase Storage** dans le bucket `photos`, pas dans le repo git.

```bash
# Récupérer SUPA_SECRET_KEY (cf. section Variables d'environnement)
export SUPA_SECRET_KEY="sb_secret_..."

# Voir ce qui serait fait
python scripts/sync_photos_to_supabase.py --dry-run

# Lancer pour de vrai (sync additive : n'écrase rien, ne supprime rien)
python scripts/sync_photos_to_supabase.py
```

Le script est **idempotent** : il skip les fichiers déjà présents sur Supabase. Tu peux le relancer 10 fois de suite sans risque.

**Flags utiles :**

```bash
# Écraser les fichiers déjà présents (si une photo a été modifiée en local)
python scripts/sync_photos_to_supabase.py --upsert

# Sync miroir : aussi supprimer sur Supabase ce qui n'est plus en local
python scripts/sync_photos_to_supabase.py --delete

# Combiner --delete avec --dry-run avant de lancer pour vrai !
python scripts/sync_photos_to_supabase.py --dry-run --delete
```

### 4) Générer le GeoJSON des photos

Extraction automatique des coordonnées GPS depuis les EXIF, génération des URLs Supabase pour `image` et URLs locales pour `thumb` :

```bash
# Mode local (recommandé) : lit les EXIF en local, génère des URLs Supabase
python scripts/photos_to_poi.py --local-photos sources/photos

# Mode pur Supabase : télécharge chaque photo depuis le bucket pour lire les EXIF
# Plus lent mais marche depuis n'importe quelle machine sans copie locale
python scripts/photos_to_poi.py
```

Résultat : `data/pois/pois_photos.geojson` avec chaque feature contenant :

- `image` : URL Supabase Storage (ex. `https://...supabase.co/storage/v1/object/public/photos/04-amboise.jpeg`)
- `thumb` : chemin relatif `data/thumbs/04-amboise.webp`
- `time` : DateTime EXIF
- coordinates WGS84

### Workflow type complet après une sortie photo

```bash
# Méthode recommandée : orchestrateur interactif
python scripts/update_data.py --photos

# Ou étape par étape :

# 1. Vider la carte SD dans sources/photos/
# (Lightroom, Finder, etc.)

# 2. Générer les miniatures
python scripts/make_thumbs.py --photos sources/photos --thumbs data/thumbs

# 3. Uploader les originaux sur Supabase Storage
export SUPA_SECRET_KEY="sb_secret_..."
python scripts/sync_photos_to_supabase.py

# 4. Régénérer le GeoJSON
python scripts/photos_to_poi.py --local-photos sources/photos

# 5. Commit + push
git add data/thumbs/ data/pois/pois_photos.geojson data/catalog/photos.json
git commit -m "data(photos): nouvelles photos étape 3"
git push
```

---

## 🚲 Marker "Où je suis"

Affiche un marqueur animé 🚲 sur la carte indiquant la position actuelle du cycliste. La position est mise à jour **manuellement** via un script CLI : elle ne suit pas le GPS en temps réel, mais est actualisée à chaque étape ou séjour.

La carte relit le fichier `data/catalog/current_position.json` toutes les **5 minutes** (sans rechargement de page). Si `active` est `false`, le marqueur est masqué automatiquement.

### Usage

```bash
source .venv/bin/activate
python scripts/update_position.py
```

Le script affiche un menu interactif :

```
Que veux-tu faire ?
❯ Mettre à jour par adresse
  Mettre à jour par coordonnées GPS
  Effacer
  Quitter
```

**Option 1 — Par adresse (géocodage Nominatim)**

```
Adresse : Chalonnes-sur-Loire
Géocodage en cours…
Choisir :
❯ Chalonnes-sur-Loire, Maine-et-Loire, … (47.3594, -0.7594)
  …
Label affiché : Chalonnes-sur-Loire
Description (optionnelle) : Étape 2 — nuit chez l'habitant
✓ Position mise à jour : Chalonnes-sur-Loire
```

**Option 2 — Par coordonnées GPS directes**

```
Coordonnées (lat, lon) : 47.3594, -0.7594
Label : Chalonnes-sur-Loire
Description (optionnelle) :
✓ Position mise à jour : Chalonnes-sur-Loire
```

**Option 3 — Effacer**

Masque le marqueur sur la carte (`active: false`) sans supprimer les coordonnées enregistrées.

### Fichier généré

`data/catalog/current_position.json` — exemple après mise à jour :

```json
{
  "active": true,
  "label": "Chalonnes-sur-Loire",
  "description": "Étape 2 — nuit chez l'habitant",
  "coordinates": [-0.7594, 47.3594],
  "source": "address",
  "updated_at": "2026-06-15T18:42:00+00:00"
}
```

Les `coordinates` suivent la convention GeoJSON : `[longitude, latitude]`.

### Workflow type

```bash
# 1. Mettre à jour la position
python scripts/update_position.py

# 2. Committer pour que Vercel serve le fichier mis à jour
git add data/catalog/current_position.json
git commit -m "data: position mise à jour — Chalonnes-sur-Loire"
git push
```

La carte en production rechargera automatiquement le fichier dans les 5 minutes suivant le déploiement Vercel.

### Panel carte

La section **Contrôles** du panneau latéral expose une checkbox **"Afficher ma position"**. Son état est persisté dans `localStorage` : si l'utilisateur la décoche, le marqueur reste masqué au rechargement même si `active: true` dans le JSON.

### Dépendances

Requires `requests>=2.31` (dans `requirements.txt`) pour le géocodage Nominatim. Installé automatiquement avec `pip install -r requirements.txt`.

---

## 🛤 Traces GPX → GeoJSON

Convertit les fichiers GPX (enregistrés sur GPS, montre, iPhone…) en GeoJSON RFC 7946 prêt à être chargé par Leaflet.

Properties générées automatiquement par feature : `name`, `distance_km`, `duration_s`, `elevation_gain_m`, `elevation_loss_m`, `point_count`, `source_file`.

### Cas d'usage

**Méthode recommandée** — déposer le GPX dans `sources/gpx/` puis lancer l'orchestrateur :

```bash
python scripts/update_data.py --traces
```

**Appel direct du script de conversion :**

```bash
# Une étape → un fichier :
python scripts/gpx_to_geojson.py sources/gpx/etape-01.gpx \
  -o data/traces/etape-01.geojson

# Version simplifiée :
python scripts/gpx_to_geojson.py sources/gpx/etape-01.gpx \
  -o data/traces/etape-01_simplified.geojson \
  --simplify 0.0001

# Fusionner les segments en MultiLineString :
python scripts/gpx_to_geojson.py sources/gpx/boucle.gpx \
  -o data/traces/boucle.geojson \
  --multilinestring
```

La tolérance `0.0001` correspond à ≈ 11 m sur la Loire. Augmenter (`0.0002`) pour gagner plus de poids, diminuer (`0.00005`) pour préserver les virages serrés. ⚠️ La simplification perd l'altitude.

---

## 🧠 Astuces & bonnes pratiques

- 📍 Les photos **sans GPS** sont automatiquement ignorées par `scripts/photos_to_poi.py`.
- 🔒 **`SUPA_SECRET_KEY` jamais committée**, jamais dans `config.js`. Uniquement en variable d'env au moment d'exécuter `scripts/sync_photos_to_supabase.py`.
- 🍃 Garder une trace **pleine** et une **simplifiée** par étape. La carte tente la version simplifiée en premier et bascule sur la version pleine en cas d'erreur.
- 📱 Tester systématiquement sur mobile (drawer + clustering).
- 🧪 **Toujours `--dry-run` d'abord** avec `scripts/sync_photos_to_supabase.py --delete`. Le sync miroir est irréversible.
- 🗂 `sources/` n'est **jamais committé** et jamais servi par Vercel (cf. `.vercelignore`).

### HEIC

Le support HEIC est déjà dans `requirements.txt` via `pillow-heif`. À noter : tous les navigateurs ne décodent pas le HEIC en natif (Chrome notamment). Pour une compatibilité maximale, convertir les HEIC en JPEG avant l'upload Supabase (Lightroom, Preview, ou `sips -s format jpeg` sur macOS).

---

## 🚢 Déploiement

Déploiement automatique sur Vercel à chaque push sur la branche `main`.

```
push main → Vercel build → config.js généré → site statique servi
```

Pour un déploiement de preview (branche secondaire), même mécanisme avec une URL `*.vercel.app` temporaire.

**Ce qui est exclu du déploiement (`.vercelignore`) :**

- `sources/` — matière brute (GPX, photos) non pertinente en prod
- `scripts/` — scripts Python non exécutables côté Vercel
- `*.py`, `requirements.txt`, `sql/`, `development/`

**Vérifier après déploiement :**

- Ouvrir `https://carte.loireridezen.link`
- Onglet Réseau → confirmer que les requêtes Supabase utilisent la bonne `apikey`
- Vérifier qu'au moins un POI s'affiche
- Tester un changement de couche (Plan ↔ Satellite)
- Vérifier qu'une photo s'affiche dans une popup (URL Supabase Storage)

**Logs de build et runtime :** Vercel Dashboard → Project → Deployments → cliquer un déploiement pour voir le détail.

---

## 🌊 Philosophie

> _La carte n'est pas qu'un outil de navigation._
> _C'est un espace de narration, une mémoire du mouvement,_
> _un carnet de voyage géographique._

**Loire Ride Zen** explore le **slow travel à vélo**, la Loire comme fil conducteur,
et la technologie comme moyen de raconter autrement.

---

## 🚀 Prochaines évolutions possibles

- Timeline / mode "lecture"
- Mise en avant automatique des coups de cœur
- Lien POI ↔ posts Instagram
- Mode offline
- Partage de parcours

---

Bonne route 🚲

---

## 👋 À propos du développeur

**Julien Julien**
Développeur Full Stack & créateur de projets narratifs.
Je conçois des applications et des outils numériques durables, où le code, la structure et le récit avancent ensemble.
J'aime les projets clairs, évolutifs, pensés pour le temps long plutôt que pour l'instantané.

📍 Angers, France 🇫🇷  
🌍 https://julienjulien.fr

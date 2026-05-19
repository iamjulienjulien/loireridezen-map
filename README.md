# 🗺️ Loire Ride Zen — Carte interactive

Carte interactive du projet **Loire Ride Zen** :
un récit de voyage à vélo le long de la Loire, mêlant **traces**, **points d'intérêt**, **photos géolocalisées** et **coups de cœur personnels**.

Ce projet combine **Leaflet**, **Supabase + PostGIS**, et des **outils Python** pour transformer une aventure réelle en expérience cartographique vivante.

---

## ✨ Fonctionnalités

- 🚴 **Parcours à vélo**
  - Trace principale de la randonnée
  - Traces secondaires (micro-aventures, boucles locales)
  - Couleurs par étape

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
- Python (Pillow, pillow-heif, exifread pour les EXIF photo)
- Photos originales hébergées sur **Supabase Storage** (bucket `photos`)

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
├─ config.js.example
├─ photos_to_poi.py
├─ make_thumbs.py
├─ gpx_to_geojson.py
├─ sync_pois_from_supabase.py
├─ sync_photos_to_supabase.py
├─ assets/
│  └─ logo_loire_ride_zen.jpg
├─ data/
│  ├─ route.geojson
│  ├─ route_simplified.geojson
│  ├─ boucle_angevine.geojson
│  ├─ boucle_angevine.gpx
│  ├─ pois.geojson
│  └─ pois_photos.geojson
├─ photos/                ← gitignored, source des originaux
├─ thumbs/                ← committé (miniatures WebP, ~5 MB)
└─ sql/
   ├─ schema.sql
   └─ migrations/
```

Fichiers **non versionnés** (générés ou locaux, dans `.gitignore`) :

- `config.js` — créé localement depuis `config.js.example`, généré par le build Vercel en prod
- `photos/` — originaux JPEG/HEIC hébergés sur Supabase Storage (cf. [Sync photos vers Supabase](#-poi-depuis-des-photos-géolocalisées))
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

  Photos terrain (JPEG/HEIC + GPS EXIF, ./photos local, gitignored)
       │
       ├─ make_thumbs.py ───────────────→ ./thumbs/*.webp
       │                                  (committé, ~5 MB)
       │
       ├─ sync_photos_to_supabase.py ───→ Supabase Storage
       │  (upload, SUPA_SECRET_KEY)       bucket "photos"
       │                                          ↑
       │                                          │ référencé par URL
       └─ photos_to_poi.py ─────────────→ data/pois_photos.geojson
          (lit EXIF en local,             (committé, URLs Supabase)
          génère URLs Supabase)                   │
                                                  ▼
                                          Leaflet (couche photos)


┌─────────────────────────────────────────────────────────────────┐
│  FLUX 2 — GPX → traces géographiques                             │
└─────────────────────────────────────────────────────────────────┘

  GPX (GPS, montre,         gpx_to_geojson.py     data/route*.geojson
  iPhone)             ───→  (+ simplification)  ───→  data/boucle*.geojson
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
  ║  Table public.pois     sync_pois_from_supabase.py            ║
  ║                  ───→  (export RFC 7946)         ───→        ║
  ║                                                              ║
  ║                        data/pois.geojson (committé)          ║
  ╚══════════════════════════════════════════════════════════════╝
```

Les trois flux convergent dans le même cluster Leaflet, qui les gère côte à côte (filtres par type, popup au clic).

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

| Variable          | Utilisée par                 | Source autorisée             |
| ----------------- | ---------------------------- | ---------------------------- |
| `SUPA_SECRET_KEY` | `sync_photos_to_supabase.py` | **Variable d'env seulement** |

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

> 💾 **Après chaque session d'édition**, lance `sync_pois_from_supabase.py` (cf. section suivante) pour mettre à jour le snapshot offline dans le repo.

---

## 💾 Synchroniser les POI dans le repo

Le fichier `data/pois.geojson` est un **snapshot fidèle** de la table Supabase, régénéré automatiquement par le script `sync_pois_from_supabase.py`. Ce snapshot vit dans le repo, est versionné par git, et permet :

- Une **traçabilité historique** des évolutions du catalogue de POI (`git log`, `git blame`)
- Un **backup déconnecté** : si le projet Supabase est perdu, le fichier permet de tout réinjecter
- Une **revue avant publication** : `git diff` avant push pour vérifier les changements

Le snapshot n'est **pas** utilisé en runtime par la carte — celle-ci lit Supabase directement via la RPC. Le fichier est strictement un artefact de mémoire et de sauvegarde.

### Utilisation

Depuis la racine du projet, avec `config.js` déjà en place :

```bash
python sync_pois_from_supabase.py
```

C'est tout. Le script :

1. Lit les credentials depuis `config.js` (ou env vars `SUPA_URL` + `SUPA_PUBLISHABLE_KEY` si présentes — elles ont priorité)
2. Interroge la RPC `pois_bbox_geojson` avec une BBOX mondiale (récupère tous les POI en une requête)
3. Trie les features par `stage` puis `name` pour des diffs git stables
4. Écrit `data/pois.geojson` indenté à 2 espaces

### Options notables

```bash
# Sortie compacte (un seul ligne, pour la prod si besoin)
python sync_pois_from_supabase.py --indent 0

# Chemin de sortie custom
python sync_pois_from_supabase.py -o data/pois_backup_2026-06-01.geojson

# Sans tri (garder l'ordre Supabase, déconseillé pour les diffs)
python sync_pois_from_supabase.py --no-sort

# Logs détaillés
python sync_pois_from_supabase.py -v
```

### Workflow type après édition

```bash
# 1. Éditer dans Supabase Table Editor (cf. section précédente)
# 2. Régénérer le snapshot
python sync_pois_from_supabase.py

# 3. Vérifier les changements
git diff data/pois.geojson

# 4. Commit + push si OK
git add data/pois.geojson
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

Place les photos **géolocalisées** dans `./photos` (dossier gitignored). Formats supportés : JPG / JPEG, PNG, HEIC. Les photos sans GPS sont automatiquement ignorées.

### 2) Générer les miniatures WebP

```bash
python make_thumbs.py \
  --photos ./photos \
  --thumbs ./thumbs \
  --width 1200 \
  --quality 80
```

Les miniatures restent dans le repo (`./thumbs/`, ~5 MB total). Elles servent à l'affichage rapide dans les popups Leaflet.

### 3) Uploader les originaux sur Supabase Storage

Les photos originales (JPEG/HEIC, 1.6 à 5 MB chacune) sont hébergées sur **Supabase Storage** dans le bucket `photos`, pas dans le repo git.

```bash
# Récupérer SUPA_SECRET_KEY (cf. section Variables d'environnement)
export SUPA_SECRET_KEY="sb_secret_..."

# Voir ce qui serait fait
python sync_photos_to_supabase.py --dry-run

# Lancer pour de vrai (sync additive : n'écrase rien, ne supprime rien)
python sync_photos_to_supabase.py
```

Le script est **idempotent** : il skip les fichiers déjà présents sur Supabase. Tu peux le relancer 10 fois de suite sans risque.

**Flags utiles :**

```bash
# Écraser les fichiers déjà présents (si une photo a été modifiée en local)
python sync_photos_to_supabase.py --upsert

# Sync miroir : aussi supprimer sur Supabase ce qui n'est plus en local
python sync_photos_to_supabase.py --delete

# Combiner --delete avec --dry-run avant de lancer pour vrai !
python sync_photos_to_supabase.py --dry-run --delete
```

Le script affiche un **plan** avant d'agir :

```
────────────────────────────────────────────────────────────
Plan de synchronisation :
  Nouveau (à uploader)       : 12
  Existant (skip, sans --upsert) : 38
  Distant orphelin (ignoré, sans --delete) : 0
────────────────────────────────────────────────────────────
```

### 4) Générer le GeoJSON des photos

Extraction automatique des coordonnées GPS depuis les EXIF, génération des URLs Supabase pour `image` et URLs locales pour `thumb` :

```bash
# Mode local (recommandé) : lit les EXIF en local, génère des URLs Supabase
python photos_to_poi.py --local-photos ./photos

# Mode pur Supabase : télécharge chaque photo depuis le bucket pour lire les EXIF
# Plus lent mais marche depuis n'importe quelle machine sans copie locale
python photos_to_poi.py
```

Résultat : `data/pois_photos.geojson` avec chaque feature contenant :

- `image` : URL Supabase Storage (ex. `https://...supabase.co/storage/v1/object/public/photos/04-amboise.jpeg`)
- `thumb` : chemin relatif `./thumbs/04-amboise.webp`
- `time` : DateTime EXIF
- coordinates WGS84

### Workflow type complet après une sortie photo

```bash
# 1. Vider la carte SD dans ./photos/
# (Lightroom, Finder, etc.)

# 2. Générer les miniatures
python make_thumbs.py --photos ./photos --thumbs ./thumbs

# 3. Uploader les originaux sur Supabase Storage
export SUPA_SECRET_KEY="sb_secret_..."
python sync_photos_to_supabase.py

# 4. Régénérer le GeoJSON
python photos_to_poi.py --local-photos ./photos

# 5. Commit + push
git add thumbs/ data/pois_photos.geojson
git commit -m "data(photos): nouvelles photos étape 3"
git push
```

---

## 🛤 Traces GPX → GeoJSON

Convertit les fichiers GPX (enregistrés sur GPS, montre, iPhone…) en GeoJSON RFC 7946 prêt à être chargé par Leaflet.

Properties générées automatiquement par feature : `name`, `distance_km`, `duration_s`, `elevation_gain_m`, `elevation_loss_m`, `point_count`, `source_file`.

### Cas d'usage

**Une étape → un fichier :**

```bash
python gpx_to_geojson.py etape-01-angers-chalonnes.gpx \
  -o data/etape-01.geojson
```

**Plusieurs GPX → fichier consolidé** (style `data/route.geojson`) :

```bash
python gpx_to_geojson.py data/gpx/*.gpx -o data/route.geojson
```

**Version simplifiée** (style `data/route_simplified.geojson`) :

```bash
python gpx_to_geojson.py data/gpx/*.gpx \
  -o data/route_simplified.geojson \
  --simplify 0.0001
```

La tolérance `0.0001` correspond à ≈ 11 m sur la Loire. Augmenter (`0.0002`) pour gagner plus de poids, diminuer (`0.00005`) pour préserver les virages serrés. ⚠️ La simplification perd l'altitude.

**Fusionner les segments d'un GPX en MultiLineString** (style `data/boucle_angevine.geojson`) :

```bash
python gpx_to_geojson.py boucle_angevine.gpx \
  -o data/boucle_angevine.geojson \
  --multilinestring
```

---

## 🗺️ Intégration dans la carte Leaflet

Les photos sont chargées comme une **couche POI supplémentaire**, fusionnée avec les POI venant de la base Supabase.

Exemple simplifié :

```js
fetch("data/pois_photos.geojson")
  .then((r) => r.json())
  .then((geojson) => {
    const photosLayer = L.geoJSON(geojson, {
      pointToLayer: (f, latlng) =>
        L.marker(latlng, { icon: iconByType("photo") }),
      onEachFeature: (f, l) => {
        const p = f.properties || {};
        const img = p.thumb || p.image;
        l.bindPopup(`
          <div class="poi-popup">
            <img src="${img}" alt="${p.name || "Photo"}" />
            <strong>${p.name || "Photo"}</strong><br/>
            <small>${p.time || ""}</small>
          </div>
        `);
      },
    });
    cluster.addLayer(photosLayer);
  });
```

⚠️ Assure-toi que le type `photo` est bien géré dans `iconByType()`.

---

## 🧠 Astuces & bonnes pratiques

- 📍 Les photos **sans GPS** sont automatiquement ignorées par `photos_to_poi.py`.
- 🔒 **`SUPA_SECRET_KEY` jamais committée**, jamais dans `config.js`. Uniquement en variable d'env au moment d'exécuter `sync_photos_to_supabase.py`.
- 🍃 Garder une trace **pleine** (`route.geojson`) et une **simplifiée** (`route_simplified.geojson`). La carte tente la version simplifiée en premier et bascule sur la version pleine en cas d'erreur.
- 📱 Tester systématiquement sur mobile (drawer + clustering).
- 🧪 **Toujours `--dry-run` d'abord** avec `sync_photos_to_supabase.py --delete`. Le sync miroir est irréversible.

### HEIC

Le support HEIC est déjà dans `requirements.txt` via `pillow-heif`. À noter : tous les navigateurs ne décodent pas le HEIC en natif (Chrome notamment). Pour une compatibilité maximale, convertir les HEIC en JPEG avant l'upload Supabase (Lightroom, Preview, ou `sips -s format jpeg` sur macOS).

---

## 🚢 Déploiement

Déploiement automatique sur Vercel à chaque push sur la branche `main`.

```
push main → Vercel build → config.js généré → site statique servi
```

Pour un déploiement de preview (branche secondaire), même mécanisme avec une URL `*.vercel.app` temporaire.

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

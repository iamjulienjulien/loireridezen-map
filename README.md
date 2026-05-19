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
├─ assets/
│  └─ logo_loire_ride_zen.jpg
├─ data/
│  ├─ route.geojson
│  ├─ route_simplified.geojson
│  ├─ boucle_angevine.geojson
│  ├─ boucle_angevine.gpx
│  └─ pois_photos.geojson
├─ photos/
├─ thumbs/
└─ sql/
   ├─ schema.sql
   └─ migrations/
```

Fichiers **non versionnés** (générés ou locaux, dans `.gitignore`) :

- `config.js` — créé localement depuis `config.js.example`, généré par le build Vercel en prod
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

  Photos JPEG/HEIC          make_thumbs.py        thumbs/*.webp
  avec GPS EXIF      ───→   (resize WebP)   ───→
  (./photos)
                            photos_to_poi.py      data/pois_photos.geojson
                     ───→   (extrait GPS)   ───→
                                                          │
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
```

Les trois flux convergent dans le même cluster Leaflet, qui les gère côte à côte (filtres par type, popup au clic).

---

## 🔐 Variables d'environnement

La configuration runtime sensible est externalisée dans un objet `window.LRZ_CONFIG` chargé depuis `config.js`. Ce fichier est **gitignored**.

### En local

Copier `config.js.example` en `config.js` et y mettre les valeurs réelles :

```js
window.LRZ_CONFIG = {
  SUPA_URL: "https://covxsekavbmeqysdqnjh.supabase.co",
  SUPA_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxxxxxxxxxxxxxxxx_xxxxxxxx",
};
```

Ces valeurs sont à récupérer dans la console Supabase → Project Settings → API Keys (publishable key, **pas** secret).

### En production (Vercel)

Le fichier `config.js` est **généré au moment du build** par Vercel à partir des variables d'environnement :

| Variable               | Description                                   | Visibilité                   |
| ---------------------- | --------------------------------------------- | ---------------------------- |
| `SUPA_URL`             | URL du projet Supabase                        | Publique (exposée au client) |
| `SUPA_PUBLISHABLE_KEY` | Clé publishable Supabase (`sb_publishable_*`) | Publique (exposée au client) |

À configurer dans : Vercel Dashboard → Project Settings → Environment Variables. Cocher les 3 environnements (Production / Preview / Development).

Le `buildCommand` de `vercel.json` lit ces variables et écrit le `config.js` avant que Vercel ne serve les fichiers.

> 💡 **Sécurité.** La `SUPA_PUBLISHABLE_KEY` est conçue par Supabase pour être publique côté client. La sécurité repose entièrement sur les politiques RLS de la base. Ne **jamais** exposer la `secret key` côté front.

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

Transforme automatiquement les photos de terrain en points d'intérêt sur la carte.

### Étapes

#### 1) Ajouter les photos

Place les photos **géolocalisées** dans un dossier, par exemple :

```
./photos
```

Formats supportés :

- JPG / JPEG
- PNG
- HEIC (voir note plus bas)

---

#### 2) (Optionnel) Générer des miniatures WebP

Pour des popups rapides et légères :

```bash
python make_thumbs.py \
  --photos ./photos \
  --thumbs ./thumbs \
  --width 1200 \
  --quality 80
```

---

#### 3) Générer le GeoJSON des photos

Extraction automatique des coordonnées GPS depuis les EXIF :

```bash
python photos_to_poi.py \
  --photos ./photos \
  --out ./data/pois_photos.geojson \
  --image-prefix ./photos \
  --thumb-prefix ./thumbs
```

Résultat :
un fichier `pois_photos.geojson` directement exploitable par Leaflet.

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

- 📍 Les photos **sans GPS** sont automatiquement ignorées.
- 🧭 Les chemins `--image-prefix` et `--thumb-prefix` deviennent les **URLs publiques** utilisées dans la carte.
- 🍃 Garder une trace **pleine** (`route.geojson`) et une **simplifiée** (`route_simplified.geojson`). La carte tente la version simplifiée en premier et bascule sur la version pleine en cas d'erreur.
- 📱 Tester systématiquement sur mobile (drawer + clustering).

### HEIC

Le support HEIC est déjà dans `requirements.txt` via `pillow-heif`. Si tu pars d'une install manuelle :

```bash
pip install pillow pillow-heif
```

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

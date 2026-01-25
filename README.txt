# 🗺️ Loire Ride Zen — Carte interactive

Carte interactive du projet **Loire Ride Zen** :  
un récit de voyage à vélo le long de la Loire, mêlant **traces**, **points d’intérêt**, **photos géolocalisées** et **coups de cœur personnels**.

Ce projet combine **Leaflet**, **Supabase + PostGIS**, et des **outils Python** pour transformer une aventure réelle en expérience cartographique vivante.

---

## ✨ Fonctionnalités

- 🚴 **Parcours à vélo**
  - Trace principale de la randonnée
  - Traces secondaires (micro-aventures, boucles locales)
  - Couleurs par étape

- 📍 **Points d’intérêt (POI)**
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

### Data & tooling
- GeoJSON
- GPX → GeoJSON
- Python (EXIF, images)

---

## 📁 Structure du projet

```
.
├─ index.html
├─ assets/
│  └─ logo_loire_ride_zen.jpg
├─ data/
│  ├─ route.geojson
│  ├─ route_simplified.geojson
│  ├─ pois_photos.geojson
│  └─ routes/
│     └─ boucle_angevine_simplified.geojson
├─ photos/
├─ thumbs/
├─ scripts/
│  ├─ photos_to_poi.py
│  └─ make_thumbs.py
└─ README.md
```

---

## 📷 POI depuis des photos géolocalisées

Transforme automatiquement tes photos de terrain en points d’intérêt sur la carte.

### Étapes

#### 1) Ajouter les photos
Place tes photos **géolocalisées** dans un dossier, par exemple :

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
python make_thumbs.py   --photos ./photos   --thumbs ./thumbs   --width 1200   --quality 80
```

---

#### 3) Générer le GeoJSON des photos
Extraction automatique des coordonnées GPS depuis les EXIF :

```bash
python photos_to_poi.py   --photos ./photos   --out ./data/pois_photos.geojson   --image-prefix ./photos   --thumb-prefix ./thumbs
```

Résultat :  
un fichier `pois_photos.geojson` directement exploitable par Leaflet.

---

## 🗺️ Intégration dans la carte Leaflet

Les photos sont chargées comme une **couche POI supplémentaire**, fusionnée avec les POI venant de la base Supabase.

Exemple simplifié :

```js
fetch('data/pois_photos.geojson')
  .then(r => r.json())
  .then(geojson => {
    const photosLayer = L.geoJSON(geojson, {
      pointToLayer: (f, latlng) =>
        L.marker(latlng, { icon: iconByType('photo') }),
      onEachFeature: (f, l) => {
        const p = f.properties || {};
        const img = p.thumb || p.image;
        l.bindPopup(`
          <div class="poi-popup">
            <img src="${img}" alt="${p.name || 'Photo'}" />
            <strong>${p.name || 'Photo'}</strong><br/>
            <small>${p.time || ''}</small>
          </div>
        `);
      }
    });
    cluster.addLayer(photosLayer);
  });
```

⚠️ Assure-toi que le type `photo` est bien géré dans `iconByType()`.

---

## 🧠 Astuces & bonnes pratiques

- 📍 Les photos **sans GPS** sont automatiquement ignorées.
- 🧭 Les chemins `--image-prefix` et `--thumb-prefix` deviennent les **URLs publiques** utilisées dans la carte.
- 🍃 Simplifie les traces (`route_simplified.geojson`) pour de meilleures performances.
- 📱 Teste systématiquement sur mobile (drawer + clustering).

### HEIC
Pour le support HEIC :

```bash
pip install pillow pillow-heif
```

---

## 🌊 Philosophie

> *La carte n’est pas qu’un outil de navigation.*  
> *C’est un espace de narration, une mémoire du mouvement,*  
> *un carnet de voyage géographique.*

**Loire Ride Zen** explore le **slow travel à vélo**, la Loire comme fil conducteur,
et la technologie comme moyen de raconter autrement.

---

## 🚀 Prochaines évolutions possibles

- Timeline / mode “lecture”
- Mise en avant automatique des coups de cœur
- Lien POI ↔ posts Instagram
- Mode offline
- Partage de parcours

---

Bonne route 🚲

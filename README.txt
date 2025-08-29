# POI depuis des photos géolocalisées (Loire Ride Zen)

## Étapes
1) Place tes photos géolocalisées dans un dossier, ex. `./photos` (JPG/PNG/HEIC).
2) (Optionnel) Génère des miniatures WebP pour des popups rapides :
   ```bash
   python make_thumbs.py --photos ./photos --thumbs ./thumbs --width 1200 --quality 80
   ```
3) Crée le GeoJSON de POI à partir des EXIF :
   ```bash
   python photos_to_poi.py --photos ./photos --out ./data/pois_photos.geojson --image-prefix ./photos --thumb-prefix ./thumbs
   ```

## Intégration dans la carte Leaflet
- Ajoute `pois_photos.geojson` comme **nouvelle couche** "Photos". Exemple :
  ```js
  fetch('data/pois_photos.geojson')
    .then(r => r.json())
    .then(geojson => {
      const photosLayer = L.geoJSON(geojson, {
        pointToLayer: (f, latlng) => L.marker(latlng, { icon: iconByType('photo') }),
        onEachFeature: (f, l) => {
          const p = f.properties || {};
          const img = p.thumb || p.image;
          l.bindPopup(\`
            <div class="poi-popup">
              <img src="\${img}" alt="\${p.name}" />
              <strong>\${p.name||'Photo'}</strong><br/>
              <small>\${p.time||''}</small>
            </div>\`);
        }
      });
      cluster.addLayer(photosLayer);
    });
  ```
- Assure-toi d’ajouter un style d’icône `photo` à `iconByType('photo')`.

## Astuces
- Si certaines photos n’ont pas de GPS, elles seront ignorées.
- Les chemins `--image-prefix` et `--thumb-prefix` deviennent les URLs dans ton site.
- Pour HEIC, installe `pillow-heif` si besoin.

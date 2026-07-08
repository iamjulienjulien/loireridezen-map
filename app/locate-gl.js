/**
 * app/locate-gl.js — Géolocalisation utilisateur en MapLibre GL (LRZ-BRA-404 P1, commit [4]).
 *
 * Port de `locate.js` : flyTo sur la position + marker pulse temporaire (10 s) + toast.
 * `triggerLocateGL(map)` — sera câblé au bouton du panneau et aux raccourcis clavier au portage
 * des panneaux (commit ultérieur).
 */

import maplibregl from "maplibre-gl";
import { showToast } from "./toast.js";

export function triggerLocateGL(map) {
  if (!navigator.geolocation) {
    showToast("Géolocalisation non supportée par ce navigateur.", "error");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.flyTo({ center: [longitude, latitude], zoom: 13, duration: 1200 });
      const el = document.createElement("div");
      el.className = "lrz-user-position-marker";
      el.style.cssText =
        "width:16px;height:16px;border-radius:50%;background:#c69247;border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25);";
      const m = new maplibregl.Marker({ element: el }).setLngLat([longitude, latitude]).addTo(map);
      setTimeout(() => m.remove(), 10000);
      showToast("Position trouvée 📍", "success");
    },
    () => showToast("Localisation refusée ou indisponible.", "error"),
  );
}

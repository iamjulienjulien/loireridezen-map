/**
 * app/locate.js — Géolocalisation utilisateur + marker pulse
 *
 * Exporte triggerLocate(map) : déclenche la géoloc, flyTo, marker temporaire
 * et toast. Appelé par le bouton custom du panel (ui.js) et par les raccourcis
 * clavier (app.js).
 */

import { CircleMarker } from "leaflet";
import { showToast } from "./toast.js";

export function triggerLocate(map) {
  if (!navigator.geolocation) {
    showToast("Géolocalisation non supportée par ce navigateur.", "error");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.flyTo([latitude, longitude], 13, { duration: 1.2 });
      const m = new CircleMarker([latitude, longitude], {
        radius: 8,
        color: "white",
        fillColor: "#c69247",
        fillOpacity: 1,
        weight: 3,
        className: "lrz-user-position-marker",
      }).addTo(map);
      setTimeout(() => map.removeLayer(m), 10000);
      showToast("Position trouvée 📍", "success");
    },
    () => showToast("Localisation refusée ou indisponible.", "error"),
  );
}

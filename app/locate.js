/**
 * app/locate.js — Bouton de localisation utilisateur + marker pulse
 */

import { Control, DomUtil, DomEvent, CircleMarker } from "leaflet";
import { showToast } from "./toast.js";

export function initLocateControl(map) {
  const ctl = new Control({ position: "topright" });

  ctl.onAdd = function () {
    const div = DomUtil.create("div", "leaflet-bar lrz-locate-btn");
    div.innerHTML = `
      <a href="#" role="button" title="Centrer sur ma position" aria-label="Localisation">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.94 3A8.99 8.99 0 0013 3.06V1h-2v2.06A8.99 8.99 0 003.06 11H1v2h2.06A8.99 8.99 0 0011 20.94V23h2v-2.06A8.99 8.99 0 0020.94 13H23v-2h-2.06z"/>
        </svg>
      </a>
    `;

    DomEvent.disableClickPropagation(div);

    div.querySelector("a").addEventListener("click", (e) => {
      e.preventDefault();
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
    });

    return div;
  };

  ctl.addTo(map);
}

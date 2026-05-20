/**
 * app.js — Entry point de la carte Loire Ride Zen
 *
 * Skeleton progressif en 4 phases :
 *   Phase 1 : plein écran (lrz-loading) pendant le chargement JS
 *   Phase 2 : UI rendue → masquer le plein écran, mini "Chargement des traces…"
 *   Phase 3 : traces GeoJSON prêtes → mini "Chargement des lieux…"
 *   Phase 4 : premier lot de POI chargé → retirer le mini skeleton
 */

import { map } from "./app/map.js";
import { loadPoisForViewport, bindViewportListeners } from "./app/poi.js";
import { loadPreferences, updatePreference } from "./app/preferences.js";
import {
  renderTracesSection,
  renderPoiSection,
  renderPhotosSection,
  wireTraceCheckboxes,
  initControls,
  initMobileDrawer,
  initAccordion,
  initPoiBadge,
  initResetButton,
  initKeyboardShortcuts,
} from "./app/ui.js";

// ─────────────────────────────────── Skeleton helpers

const fullSkeleton = document.getElementById("lrz-loading");
let miniSkeleton = null;

function createMiniSkeleton(text) {
  if (miniSkeleton) {
    miniSkeleton.querySelector(".lrz-loading-mini__text").textContent = text;
    return;
  }
  miniSkeleton = document.createElement("div");
  miniSkeleton.className = "lrz-loading-mini";
  miniSkeleton.innerHTML = `<span class="lrz-loading-mini__text">${text}</span>`;
  document.body.appendChild(miniSkeleton);
}

function removeMiniSkeleton() {
  if (!miniSkeleton) return;
  miniSkeleton.style.opacity = "0";
  const el = miniSkeleton;
  miniSkeleton = null;
  setTimeout(() => el.remove(), 300);
}

// Phase 4 : premier POI chargé → retirer le mini skeleton
document.addEventListener("lrz:poi-loaded", removeMiniSkeleton, { once: true });

// ─────────────────────────────────── Init principal

async function init() {
  const prefs = loadPreferences();

  const groups = await fetch("data/catalog/groups.json").then((r) => r.json());

  renderTracesSection(groups, prefs);
  renderPhotosSection(prefs);
  renderPoiSection(prefs);

  initControls(map);
  initMobileDrawer();
  initAccordion(prefs);
  initPoiBadge();
  initResetButton();
  initKeyboardShortcuts(map);

  // Sauvegarder la préférence POI à chaque changement de type-filter
  document.querySelectorAll(".type-filter").forEach((cb) => {
    cb.addEventListener("change", () => {
      updatePreference(`poi.${cb.value}`, cb.checked);
    });
  });

  // POI : premier chargement + listeners viewport
  bindViewportListeners();
  loadPoisForViewport();

  // Phase 2 : UI rendue → masquer le skeleton plein écran, démarrer le mini
  requestAnimationFrame(() => {
    if (fullSkeleton) {
      fullSkeleton.classList.add("lrz-loading--hidden");
      setTimeout(() => fullSkeleton.remove(), 400);
    }
    createMiniSkeleton("Chargement des traces…");
  });

  // Phase 3 : traces chargées → mettre à jour le mini skeleton
  wireTraceCheckboxes().then(() => {
    createMiniSkeleton("Chargement des lieux…");
  });
}

init();

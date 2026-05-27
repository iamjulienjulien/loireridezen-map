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
import { initVisitCounter } from "./app/visit-counter.js";
import { initVisitCounterForElle } from "./app/visit-counter-for-elle.js";
import { initBisouButton } from "./app/bisou-button.js";
import { hiddenModes } from "./app/url-mode.js";
import { track, trackAndNavigate, trackForElle } from "./app/analytics.js";
import { loadPoisForViewport, bindViewportListeners } from "./app/poi.js";
import { loadPreferences, updatePreference } from "./app/preferences.js";
import { buildTraceMarkersFromCatalog } from "./app/trace-markers.js";
import {
  loadCurrentPosition,
  currentPositionLayer,
} from "./app/current-position.js";
import { initActionsPanel } from "./app/actions-panel.js";
import { initExportButton } from "./app/map-export.js";
import { initInfoPanel } from "./app/info-panel.js";
import { initEuroVelo } from "./app/eurovelo.js";
import {
  renderTracesSection,
  renderPoiSection,
  renderPhotosSection,
  wireTraceCheckboxes,
  traceFeatureGroups,
  addEuroVeloToggle,
  initMobileDrawer,
  initAccordion,
  initPoiBadge,
  initResetButton,
  initKeyboardShortcuts,
  initCurrentPositionToggle,
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
  // document.body.appendChild(miniSkeleton);
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

  const [groups, traces] = await Promise.all([
    fetch("data/catalog/groups.json").then((r) => r.json()),
    fetch("data/catalog/traces.json").then((r) => r.json()),
  ]);

  renderTracesSection(groups, prefs);
  renderPhotosSection(prefs);
  renderPoiSection(prefs);

  initActionsPanel();
  initExportButton();
  initInfoPanel();
  initMobileDrawer();
  initAccordion(prefs);
  initPoiBadge();
  initResetButton();
  initKeyboardShortcuts(map);
  initCurrentPositionToggle(currentPositionLayer, loadCurrentPosition, prefs);
  initEuroVelo(map).then((eurovelo) => {
    if (eurovelo) addEuroVeloToggle(eurovelo, prefs);
  });

  if (!hiddenModes.rabbit) {
    initVisitCounter().catch((err) =>
      console.warn("[visit-counter] init failed", err),
    );
    document.querySelector(".lrz-bottom-right")?.remove();
  }
  setInterval(
    () => {
      const toggle = document.getElementById("position-toggle");
      if (!toggle || toggle.checked) loadCurrentPosition();
    },
    5 * 60 * 1000,
  );

  // Sauvegarder la préférence POI à chaque changement de type-filter
  document.querySelectorAll(".type-filter").forEach((cb) => {
    cb.addEventListener("change", () => {
      const section = cb.value === 'photo' ? 'photos' : 'poi';
      track('Layer Item Toggled', { section, item: cb.value, state: cb.checked ? 'on' : 'off' });
      updatePreference(`poi.${cb.value}`, cb.checked);
    });
  });

  // Tracking liens externes du footer (hors mode for=elle)
  document.querySelectorAll('.lrz-panel-header__link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = link.href;
      const dest = href.includes('instagram') ? 'instagram'
                : href.includes('komoot') ? 'komoot'
                : 'site';
      trackAndNavigate('External Link', href, { destination: dest });
    });
  });

  // POI : premier chargement + listeners viewport (pas de listener moveend en mode for=elle)
  if (!hiddenModes.rabbit) bindViewportListeners();
  loadPoisForViewport();

  if (hiddenModes.rabbit) {
    const _fromToken = new URL(location.href).searchParams.get('from') || 'unknown';
    trackForElle('View', { from: _fromToken });
    // Bonus A — masquer liens externes + crédits
    document.querySelector(".lrz-panel-header")?.remove();
    document.querySelectorAll(".lrz-panel-credit").forEach((el) => el.remove());
    // Masquer sections non pertinentes
    ["traces", "poi", "photos", "options"].forEach((s) => {
      document.querySelector(`[data-section="${s}"]`)?.remove();
    });
    // Charger la position directement (le toggle #position-toggle a été supprimé)
    loadCurrentPosition();
    initVisitCounterForElle().catch((err) =>
      console.warn("[visit-counter-for-elle] init failed", err),
    );
    initBisouButton();
  }

  // Phase 2 : UI rendue → masquer le skeleton plein écran, démarrer le mini
  requestAnimationFrame(() => {
    if (fullSkeleton) {
      fullSkeleton.classList.add("lrz-loading--hidden");
      setTimeout(() => fullSkeleton.remove(), 400);
    }
    createMiniSkeleton("Chargement des traces…");
  });

  // Phase 3 : traces chargées → markers calculés + mini skeleton "lieux"
  wireTraceCheckboxes().then(() => {
    createMiniSkeleton("Chargement des lieux…");
    buildTraceMarkersFromCatalog(groups, traces, traceFeatureGroups);
  });
}

init();

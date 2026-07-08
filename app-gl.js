/**
 * app-gl.js — Point d'entrée du moteur MapLibre GL (LRZ-BRA-404 P1, activé par `?engine=gl`).
 *
 * En PARALLÈLE de `app.js` (Leaflet, moteur par défaut). Chargé uniquement quand `?engine=gl` est
 * présent, donc n'importe JAMAIS Leaflet — les deux moteurs ne coexistent pas au runtime.
 *
 * Commit [1] : ossature (fonds raster + Positron vectoriel). Les couches de données (traces, POI,
 * photos), les carnets et l'export arrivent aux commits suivants.
 */

import { initMapGL } from './app/map-gl.js';
import { loadAllRoutesGL } from './app/routes-gl.js';
import { loadPoisForViewportGL, bindViewportListenersGL } from './app/poi-gl.js';
import { initEuroVelosGL } from './app/eurovelo-gl.js';
import { buildTraceMarkersGL } from './app/trace-markers-gl.js';
import { initActionsPanelGL } from './app/actions-panel-gl.js';
import { applyCarnetGL, getCurrentCarnetGL } from './app/carnets/apply-gl.js';
import { initExportButton } from './app/map-export.js';
import { hiddenModes } from './app/url-mode.js';
import { initVisitCounter } from './app/visit-counter.js';
import { initVisitCounterForElle } from './app/visit-counter-for-elle.js';
import { initBisouButton } from './app/bisou-button.js';
import { loadPreferences } from './app/preferences.js';
import {
    renderTracesSectionGL,
    renderPoiSectionGL,
    renderPhotosSectionGL,
    wireTraceCheckboxesGL,
    wirePoiFiltersGL,
    addEuroVeloLegendGL,
    initAccordionGL,
    initResetButtonGL,
} from './app/ui-gl.js';

const map = initMapGL();

map.on('load', async () => {
    // Retirer le skeleton de chargement dès que le fond est prêt (parité avec app.js).
    const skeleton = document.getElementById('lrz-loading');
    if (skeleton) skeleton.style.display = 'none';

    const prefs = loadPreferences();

    // Panel cockpit (Traces · POI · Photos) — parité app.js. Rendu AVANT les données pour que les
    // cases existent quand on câble la visibilité des couches. Non pertinent en mode ?for=elle
    // (l'UI y est réduite, comme dans app.js).
    let panelActive = !hiddenModes.rabbit;
    if (panelActive) {
        const [groups, traces] = await Promise.all([
            fetch('data/catalog/groups.json').then((r) => r.json()),
            fetch('data/catalog/traces.json').then((r) => r.json()),
        ]).catch((err) => {
            console.warn('[loireridezen] panel catalog load failed', err);
            return [null, null];
        });
        if (groups) {
            renderTracesSectionGL(groups, prefs, traces);
            renderPoiSectionGL(prefs);
            renderPhotosSectionGL(prefs);
            addEuroVeloLegendGL();
            initAccordionGL(prefs);
            initResetButtonGL();
            wirePoiFiltersGL();
        } else {
            panelActive = false;
        }
    }

    // Commit [4] — EuroVelo d'abord (sous les traces, ordre des layers GL).
    await initEuroVelosGL();

    // Commit [2] — traces (lignes colorées + popups + fitBounds).
    await loadAllRoutesGL();

    // Commit [4] — markers Départ/Étape/Arrivée (après les traces : openStepPopupGL prêt).
    await buildTraceMarkersGL();

    // Câble les cases de traces sur la visibilité des couches (après lignes + markers prêts).
    if (panelActive) wireTraceCheckboxesGL();

    // Commit [5] — sélecteur de carnets + zoom/recentrer/localiser.
    bindViewportListenersGL();
    initActionsPanelGL();

    // Commit [6] — bouton d'export image (?admin) : map-export.js est agnostique du moteur.
    initExportButton();

    // Commit [5] — applique le carnet courant (fond + couleurs + filtre POI + catégories).
    // setEnabledPoiTypesGL (dans applyCarnetGL) déclenche le chargement initial des POI.
    const carnet = getCurrentCarnetGL();
    if (carnet) applyCarnetGL(carnet);
    else loadPoisForViewportGL();

    // Signature vs compteur de visites (parité app.js) : la signature « Papa » n'existe qu'en
    // mode ?for=elle ; le compteur CYCLONAUTES ne s'affiche qu'en dehors de ce mode.
    if (!hiddenModes.rabbit) {
        initVisitCounter().catch((err) => console.warn('[visit-counter] init failed', err));
        document.querySelector('.lrz-bottom-right')?.remove();
    } else {
        // Mode ?for=elle : compteur « TU ES VENUE X FOIS » + bouton bisou (parité app.js).
        initVisitCounterForElle().catch((err) =>
            console.warn('[visit-counter-for-elle] init failed', err)
        );
        initBisouButton();
    }
});

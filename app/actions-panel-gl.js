/**
 * app/actions-panel-gl.js — Panneau d'actions (zoom, sélecteur de 7 carnets, recentrer, localiser)
 * en MapLibre GL (LRZ-BRA-404 P1, commit [5]). Port de `actions-panel.js` : MapLibre expose
 * `zoomIn`/`zoomOut`/`getZoom`/`fitBounds` (mêmes noms que Leaflet), le câblage est direct.
 */

import { map } from './map-gl.js';
import { fitAllTracesGL } from './routes-gl.js';
import { triggerLocateGL } from './locate-gl.js';
import { track } from './analytics.js';
import { getCurrentCarnetKeyGL, setCarnetGL, syncSelectorUIGL } from './carnets/apply-gl.js';

export function initActionsPanelGL() {
    // Sync visuel du sélecteur sur le carnet persisté (l'application complète se fait via applyCarnetGL).
    syncSelectorUIGL(getCurrentCarnetKeyGL());

    // Sélecteur de carnets (7 boutons emoji).
    document.querySelectorAll('[data-carnet]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.carnet;
            track('Carnet Changed', { carnet: key });
            setCarnetGL(key);
        });
    });

    // Actions standard.
    document.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
            switch (btn.dataset.action) {
                case 'zoom-in':
                    track('Zoom In', { from_zoom: map.getZoom() });
                    map.zoomIn();
                    break;
                case 'zoom-out':
                    track('Zoom Out', { from_zoom: map.getZoom() });
                    map.zoomOut();
                    break;
                case 'reset-view':
                    track('Reset View');
                    fitAllTracesGL();
                    break;
                case 'locate-me':
                    track('Locate Me');
                    triggerLocateGL(map);
                    break;
            }
        });
    });
}

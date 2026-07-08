/**
 * app/carnets/apply-gl.js — Application d'un carnet en MapLibre GL (LRZ-BRA-404 P1, commit [5]).
 *
 * Port de `apply.js` + de la partie GL-safe de `state.js`. On NE peut PAS importer `state.js`/`apply.js`
 * (ils importent `map.js` ⟹ instancieraient Leaflet) : l'état carnet est reconstruit ici depuis
 * `registry.js` (pur). Applique CSS vars + ui-mode + fond (switchBasemapGL) + couleurs de traces
 * (setPaintProperty) + filtre POI (setEnabledPoiTypesGL) + catégories photos (event).
 */

import { map, switchBasemapGL } from '../map-gl.js';
import { traceGroupsGL } from '../routes-gl.js';
import { setEnabledPoiTypesGL } from '../poi-gl.js';
import { lightenHex } from '../helpers.js';
import { CARNET_MAP, DEFAULT_CARNET_KEY } from './registry.js';

const STORAGE_KEY = 'lrz_carnet';
const PHOTO_CAT_STORAGE_KEY = 'lrz_photo_categories_overrides';

let _currentPrimary = null;

function _hexToHue(hex) {
    if (!hex || hex[0] !== '#') return 0;
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
    const d = max - min;
    if (!d) return 0;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = Math.round(h * 60);
    return h < 0 ? h + 360 : h;
}

/** Couleur d'un groupe selon la logique de apply.js (micro=noir, vélodyssée=primaire, actes=dégradé). */
function _groupColor(group, primary, actGroups) {
    if (group.id === 'micro-aventure') return '#111111';
    if (group.id === 'velodyssee') return primary;
    if (group.id.startsWith('acte-')) {
        const idx = actGroups.findIndex((g) => g.group.id === group.id);
        const total = actGroups.length;
        const factor = total > 1 ? ((total - 1 - idx) / (total - 1)) * 0.5 : 0;
        return factor > 0 ? lightenHex(primary, factor) : primary;
    }
    return primary;
}

/** Applique la couleur primaire aux traces (setPaintProperty ; garde-fou si layer absent). */
function _applyColorToTracesGL(primary) {
    _currentPrimary = primary;
    const actGroups = [...traceGroupsGL.values()]
        .filter(({ group }) => group.id.startsWith('acte-'))
        .sort((a, b) => (a.group.order ?? 0) - (b.group.order ?? 0));

    traceGroupsGL.forEach(({ group, layerIds }) => {
        const color = _groupColor(group, primary, actGroups);
        for (const layerId of layerIds) {
            if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'line-color', color);
        }
    });
}

// Après un changement de fond vectoriel (setStyle vide le style), routes-gl.js re-pose les traces
// avec leur couleur par défaut → on ré-applique la couleur du carnet courant.
document.addEventListener('lrz:basemap-changed', () => {
    if (_currentPrimary) _applyColorToTracesGL(_currentPrimary);
});

/** Applique un carnet complet (port de applyCarnet). */
export function applyCarnetGL(carnet) {
    const root = document.documentElement;
    root.style.setProperty('--lrz-or', carnet.visual.primaryColor);
    root.style.setProperty('--lrz-color-primary', carnet.visual.primaryColor);
    root.style.setProperty('--lrz-font-theme', carnet.visual.fontTheme);
    const traceHue = (_hexToHue(carnet.visual.primaryColor) - 38 + 360) % 360;
    root.style.setProperty('--lrz-trace-hue', `${traceHue}deg`);
    if (carnet.visual.accentColor)
        root.style.setProperty('--lrz-color-accent', carnet.visual.accentColor);
    else root.style.removeProperty('--lrz-color-accent');

    document.body.dataset.uiMode = carnet.uiMode;

    switchBasemapGL(carnet.visual.basemap);
    _applyColorToTracesGL(carnet.visual.primaryColor);
    setEnabledPoiTypesGL(carnet.pois?.defaultEnabled ?? null);
    document.dispatchEvent(
        new CustomEvent('lrz:photo-categories-changed', {
            detail: { enabled: carnet.photoCategories?.enabled ?? null },
        })
    );
}

export function getCurrentCarnetKeyGL() {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_CARNET_KEY;
}

export function getCurrentCarnetGL() {
    return CARNET_MAP.get(getCurrentCarnetKeyGL()) ?? null;
}

/** Sélectionne un carnet (port GL-safe de setCarnet, sans l'accroche). */
export function setCarnetGL(key) {
    const carnet = CARNET_MAP.get(key);
    if (!carnet) return;
    localStorage.setItem(STORAGE_KEY, key);
    localStorage.removeItem(PHOTO_CAT_STORAGE_KEY);
    applyCarnetGL(carnet);
    syncSelectorUIGL(key);
    document.dispatchEvent(new CustomEvent('lrz:carnet-changed', { detail: { key } }));
}

/** Synchronise l'état visuel des boutons du sélecteur de carnets. */
export function syncSelectorUIGL(key) {
    document.querySelectorAll('[data-carnet]').forEach((btn) => {
        const active = btn.dataset.carnet === key;
        btn.classList.toggle('lrz-carnet-btn--active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
}

/**
 * app/routes-gl.js — Chargeur/rendu des traces en MapLibre GL (LRZ-BRA-404 P1, commit [2]).
 *
 * Port de `routes.js` (Leaflet) : lit groups.json + traces.json, ajoute une source `geojson` + un
 * layer `line` par trace (couleur du groupe via `resolveColor`, dash si `planned`), popup d'étape au
 * clic, fitBounds global. Les données sont mises en cache pour re-poser les couches après un
 * `setStyle` de fond (event `lrz:basemap-changed`, émis par map-gl.js).
 */

import maplibregl from 'maplibre-gl';
import { map } from './map-gl.js';
import { resolveColor } from './types.js';
import { renderStepPopup } from './step-popup.js';
import { track } from './analytics.js';
import { loadCarteJourneys } from './carte-journeys.js';

/** groupId → { group, layerIds, sourceIds } — pour la bascule de visibilité (carnets, commit [5]). */
export const traceGroupsGL = new Map();
/** Groupes masqués par l'utilisateur (cases du panel). Réappliqué après un re-render de style. */
const _hiddenGroups = new Set();
/** stepId → bbox [minLng, minLat, maxLng, maxLat] — pour centrer sur une étape. */
export const stepBoundsById = new Map();
/** stepId → { item, group } — pour ouvrir le popup d'étape (markers d'étape, commit [4]). */
const _stepInfoById = new Map();

let _promise = null;
/** Traces chargées (fetch une fois), re-rendues à chaque style. */
const _loaded = [];

/** bbox [minLng, minLat, maxLng, maxLat] d'un GeoJSON (Feature/FeatureCollection, Line/MultiLine). */
function _bbox(geojson) {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    const eat = ([x, y]) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    };
    const walk = (coords) => {
        if (typeof coords[0] === 'number') eat(coords);
        else coords.forEach(walk);
    };
    const features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
    for (const f of features) if (f?.geometry?.coordinates) walk(f.geometry.coordinates);
    return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

function _mergeBbox(a, b) {
    if (!a) return b;
    if (!b) return a;
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** (Ré)ajoute toutes les sources/layers de trace au style courant (idempotent). */
function _renderTraces() {
    for (const t of _loaded) {
        const srcId = `trace-src-${t.item.id}`;
        const lyrId = `trace-${t.item.id}`;
        if (map.getSource(srcId)) continue; // déjà posé sur ce style
        map.addSource(srcId, { type: 'geojson', data: t.data });
        map.addLayer({
            id: lyrId,
            type: 'line',
            source: srcId,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
                visibility: _hiddenGroups.has(t.group.id) ? 'none' : 'visible',
            },
            paint: {
                'line-color': t.color,
                'line-width': 4,
                'line-opacity': 0.9,
                ...(t.dashed ? { 'line-dasharray': [2, 2.5] } : {}),
            },
        });
        _wireStepPopup(lyrId, t.item, t.group);
    }
}

function _wireStepPopup(lyrId, item, group) {
    map.on('click', lyrId, (e) => {
        const popup = new maplibregl.Popup({ maxWidth: '300px', closeButton: false })
            .setLngLat(e.lngLat)
            .setHTML(renderStepPopup(item, group))
            .addTo(map);
        popup
            .getElement()
            ?.querySelector('.lrz-step-popup__close')
            ?.addEventListener('click', () => popup.remove());
        track('Step Opened', { step_id: item.id, act: group.id });
    });
    map.on('mouseenter', lyrId, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', lyrId, () => (map.getCanvas().style.cursor = ''));
}

async function _doLoad() {
    const { groups: groupsCatalog, traces: tracesCatalog } = await loadCarteJourneys();
    const groups = (groupsCatalog.items ?? [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const allItems = tracesCatalog.items ?? [];
    let globalBbox = null;

    for (const group of groups) {
        const items = allItems
            .filter((it) => it.group === group.id)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        if (!items.length) continue;

        const layerIds = [];
        const sourceIds = [];
        for (const item of items) {
            const data = item.geojson;
            if (!data) continue;

            const featureIndex = (item.order ?? 1) - 1;
            const color = resolveColor(group.color, {
                feature: data.features?.[0],
                item,
                group,
                featureIndex,
            });
            _loaded.push({ item, group, data, color, dashed: item.date_status === 'planned' });
            layerIds.push(`trace-${item.id}`);
            sourceIds.push(`trace-src-${item.id}`);

            _stepInfoById.set(item.id, { item, group });
            const bbox = _bbox(data);
            if (bbox) {
                stepBoundsById.set(item.id, bbox);
                globalBbox = _mergeBbox(globalBbox, bbox);
            }
        }
        if (layerIds.length) traceGroupsGL.set(group.id, { group, layerIds, sourceIds });
    }

    _renderTraces();

    if (globalBbox) {
        try {
            map.fitBounds(
                [
                    [globalBbox[0], globalBbox[1]],
                    [globalBbox[2], globalBbox[3]],
                ],
                { padding: 30, maxZoom: 13, animate: false }
            );
        } catch (err) {
            console.warn('[loireridezen] fitBounds failed:', err);
        }
    }

    // Re-poser les couches après un changement de fond vectoriel (setStyle vide le style).
    document.addEventListener('lrz:basemap-changed', _renderTraces);
}

/** Charge et rend toutes les traces. Singleton : safe à appeler plusieurs fois. */
export function loadAllRoutesGL() {
    if (!_promise) _promise = _doLoad();
    return _promise;
}

/** Affiche/masque les lignes d'un groupe de traces (cases du panel). Idempotent, survit au re-style. */
export function setTraceGroupVisibilityGL(groupId, visible) {
    if (visible) _hiddenGroups.delete(groupId);
    else _hiddenGroups.add(groupId);
    const entry = traceGroupsGL.get(groupId);
    if (!entry) return;
    for (const layerId of entry.layerIds) {
        if (map.getLayer(layerId)) {
            map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
        }
    }
}

/** Ouvre le popup d'étape (au centre de la trace), réutilisé par les markers d'étape (commit [4]). */
export function openStepPopupGL(stepId) {
    const info = _stepInfoById.get(stepId);
    const b = stepBoundsById.get(stepId);
    if (!info || !b) return;
    const center = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    const popup = new maplibregl.Popup({ maxWidth: '300px', closeButton: false })
        .setLngLat(center)
        .setHTML(renderStepPopup(info.item, info.group))
        .addTo(map);
    popup
        .getElement()
        ?.querySelector('.lrz-step-popup__close')
        ?.addEventListener('click', () => popup.remove());
}

/** Recentre la carte sur l'ensemble des traces (bouton « Recentrer »). */
export function fitAllTracesGL() {
    let bbox = null;
    for (const b of stepBoundsById.values()) bbox = _mergeBbox(bbox, b);
    if (!bbox) return;
    try {
        map.fitBounds(
            [
                [bbox[0], bbox[1]],
                [bbox[2], bbox[3]],
            ],
            { padding: 30, maxZoom: 13 }
        );
    } catch {
        /* noop */
    }
}

/** Centre la carte sur une étape (bbox mémorisée). */
export function centerOnStepGL(stepId) {
    const b = stepBoundsById.get(stepId);
    if (!b) return;
    try {
        map.fitBounds(
            [
                [b[0], b[1]],
                [b[2], b[3]],
            ],
            { padding: 40, maxZoom: 14 }
        );
    } catch {
        /* noop */
    }
}

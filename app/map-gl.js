/**
 * app/map-gl.js — Moteur de rendu MapLibre GL (LRZ-BRA-404 P1, commit [1]).
 *
 * Ossature du moteur GL, en PARALLÈLE de Leaflet (`map.js`) : activé par le flag `?engine=gl`.
 * Ce commit pose l'init + les fonds (raster + Positron vectoriel) + la restauration du fond depuis
 * le carnet persisté + la bascule de fond. Les couches de données (traces, POI, photos) arrivent
 * aux commits suivants. Vanilla JS + ES modules, comme le reste du repo.
 *
 * Exporte `map` (l'instance maplibregl.Map) et `switchBasemapGL(basemap)` pour les carnets.
 */

import maplibregl from 'maplibre-gl';
import { DEFAULT_VIEW } from './config.js';
import { DEFAULT_CARNET_KEY, CARNET_MAP } from './carnets/registry.js';

// ─── Fonds raster (portés depuis map.js — {s} sous-domaines dépliés, {r} retina retiré) ──────────
const OSM_ATTR =
    "&copy; OpenStreetMap contributors · <span style='color:#c69247'>Loire Ride Zen</span>";

/** @type {Record<string, { tiles: string[], maxzoom?: number, attribution: string }>} */
const RASTER_BASEMAPS = {
    osm: {
        tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.openstreetmap.org/{z}/{x}/{y}.png`),
        attribution: OSM_ATTR,
    },
    'satellite-esri': {
        tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        attribution: 'Imagery © Esri & sources',
    },
    cyclosm: {
        tiles: ['a', 'b', 'c'].map(
            (s) => `https://${s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`
        ),
        maxzoom: 20,
        attribution: '&copy; OpenStreetMap contributors · tuiles CyclOSM / OSM-FR',
    },
    'ign-plan': {
        tiles: [
            'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&FORMAT=image%2Fpng',
        ],
        maxzoom: 18,
        attribution: '&copy; IGN-F / Géoplateforme',
    },
    opentopomap: {
        tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
        maxzoom: 17,
        attribution: '&copy; OpenTopoMap (CC-BY-SA) · &copy; OpenStreetMap contributors',
    },
    'osm-dark': {
        tiles: ['a', 'b', 'c', 'd'].map(
            (s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`
        ),
        maxzoom: 19,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
    positron: {
        tiles: ['a', 'b', 'c', 'd'].map(
            (s) => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`
        ),
        maxzoom: 19,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
    'osm-fr': {
        tiles: ['a', 'b', 'c'].map(
            (s) => `https://${s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png`
        ),
        maxzoom: 20,
        attribution: '&copy; OpenStreetMap contributors · rendu OSM-FR',
    },
};

// Labels Esri superposés au satellite (couche raster au-dessus, sans clic).
const ESRI_LABELS_TILES = [
    'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
];

// Style vectoriel Positron (MapLibre natif — remplace le wrapper maplibre-gl-leaflet).
const POSITRON_GL_STYLE = 'https://openmaptiles.data.gouv.fr/styles/positron/style.json';

/** Construit un style MapLibre composite : tous les fonds raster, seul l'actif visible. */
function buildRasterStyle(activeBasemap) {
    const sources = {};
    const layers = [];
    for (const [id, cfg] of Object.entries(RASTER_BASEMAPS)) {
        sources[id] = {
            type: 'raster',
            tiles: cfg.tiles,
            tileSize: 256,
            ...(cfg.maxzoom ? { maxzoom: cfg.maxzoom } : {}),
            attribution: cfg.attribution,
        };
        layers.push({
            id: `basemap-${id}`,
            type: 'raster',
            source: id,
            layout: { visibility: id === activeBasemap ? 'visible' : 'none' },
        });
    }
    // Labels Esri (visibles seulement avec le satellite).
    sources['esri-labels'] = { type: 'raster', tiles: ESRI_LABELS_TILES, tileSize: 256 };
    layers.push({
        id: 'basemap-esri-labels',
        type: 'raster',
        source: 'esri-labels',
        layout: { visibility: activeBasemap === 'satellite-esri' ? 'visible' : 'none' },
    });
    return { version: 8, sources, layers };
}

/** @type {import("maplibre-gl").Map | null} */
export let map = null;

/** Normalise un identifiant de fond : `positron-gl` (vectoriel) ou une clé raster connue ;
 *  `osm-plan` et tout inconnu retombent sur `osm` (parité avec le `default` de map.js). */
function normalizeBasemap(basemap) {
    if (basemap === 'positron-gl') return basemap;
    return RASTER_BASEMAPS[basemap] ? basemap : 'osm';
}

/** Fond persisté du carnet courant (même logique que map.js). */
function initialBasemap() {
    const carnetKey = localStorage.getItem('lrz_carnet') ?? DEFAULT_CARNET_KEY;
    return normalizeBasemap(CARNET_MAP.get(carnetKey)?.visual.basemap ?? 'cyclosm');
}

/**
 * Bascule de fond (appelé par les carnets). Raster → toggle visibility ; positron-gl → setStyle
 * vectoriel, puis retour au composite raster. Émet `lrz:basemap-changed` pour re-poser les couches
 * de données après un setStyle (branché aux commits suivants).
 */
export function switchBasemapGL(basemap) {
    if (!map) return;
    basemap = normalizeBasemap(basemap);
    const isVector = basemap === 'positron-gl';
    const currentVector = map.getStyle()?.name === 'positron' || map.__lrzVector === true;

    if (isVector) {
        map.__lrzVector = true;
        map.setStyle(POSITRON_GL_STYLE);
        map.once('style.load', () =>
            document.dispatchEvent(new CustomEvent('lrz:basemap-changed'))
        );
        return;
    }

    if (currentVector) {
        // On revient d'un style vectoriel → recomposer le style raster.
        map.__lrzVector = false;
        map.setStyle(buildRasterStyle(basemap));
        map.once('style.load', () =>
            document.dispatchEvent(new CustomEvent('lrz:basemap-changed'))
        );
        return;
    }

    // Raster → raster : simple toggle de visibility.
    for (const id of Object.keys(RASTER_BASEMAPS)) {
        map.setLayoutProperty(`basemap-${id}`, 'visibility', id === basemap ? 'visible' : 'none');
    }
    map.setLayoutProperty(
        'basemap-esri-labels',
        'visibility',
        basemap === 'satellite-esri' ? 'visible' : 'none'
    );
}

/** Initialise le moteur MapLibre GL sur #map (ossature P1). */
export function initMapGL() {
    const basemap = initialBasemap();
    const vector = basemap === 'positron-gl';

    map = new maplibregl.Map({
        container: 'map',
        style: vector ? POSITRON_GL_STYLE : buildRasterStyle(basemap),
        center: [DEFAULT_VIEW.center[1], DEFAULT_VIEW.center[0]], // Leaflet [lat,lng] → GL [lng,lat]
        zoom: DEFAULT_VIEW.zoom,
        attributionControl: false,
    });
    if (vector) map.__lrzVector = true;

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    return map;
}

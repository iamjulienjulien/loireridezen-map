/**
 * app/carte-journeys.js — Source unique des voyages / étapes / traces de la carte publique
 * (LRZ-BRA-405, rebranchement P2).
 *
 * Remplace les fichiers statiques `data/catalog/{groups,traces}.json` + `data/traces/*.geojson` par
 * la RPC publique `lrz_carte_journeys_geojson` (Le Camp, tables `lrz_*`, filtrée `effective` par la
 * RLS anon, clé publishable). Fetch mémoïsé — un seul appel réseau — partagé par les trois
 * consommateurs : `routes-gl.js` (lignes), `trace-markers-gl.js` (markers Départ/Étape/Arrivée) et le
 * panel (`app-gl.js` → `ui-gl.js`).
 *
 * La sortie garde la forme héritée du catalogue statique pour minimiser les changements consommateurs :
 *   { groups: { items: GROUPS_META }, traces: { items: [ …, geojson, is_loop ] } }
 * La géométrie est portée inline (`item.geojson`, FeatureCollection à une trace) — plus aucun fetch
 * par fichier. `is_loop` est déduit (premier point ≈ dernier point), la RPC ne l'exposant pas.
 */

import { SUPA_URL, SUPA_PUBLISHABLE_KEY } from './config.js';

// Registre éditorial des 5 groupes (ex-`data/catalog/groups.json`). Le style de groupe (couleur,
// libellé) reste une décision FRONT, distincte des couleurs internes du Camp — parité visuelle avec
// l'ancienne carte. Les traces sont rattachées à un groupe via `mapGroup` (pont d'identité BRA-403).
export const GROUPS_META = [
    {
        id: 'acte-1',
        label: 'Acte 1 — Paris → Blois',
        color: '#86a0ac',
        dashed: false,
        order: 1,
        visible_by_default: true,
    },
    {
        id: 'acte-2',
        label: 'Acte 2 — Blois → Angers',
        color: '#5a9bb8',
        dashed: false,
        order: 2,
        visible_by_default: true,
    },
    {
        id: 'acte-3',
        label: "Acte 3 — Angers → L'Océan",
        color: '#2e6a8f',
        dashed: false,
        order: 3,
        visible_by_default: true,
    },
    {
        id: 'micro-aventure',
        label: 'Micro-aventures',
        color: '#c69247',
        dashed: false,
        order: 4,
        visible_by_default: true,
    },
    {
        id: 'velodyssee',
        label: 'Vélodyssée',
        color: '#1a7abf',
        dashed: false,
        order: 5,
        visible_by_default: true,
    },
];

const LOOP_TOLERANCE_DEG = 0.0009; // ~100 m : premier ≈ dernier point ⟹ boucle.

function _isLoop(coords) {
    if (!Array.isArray(coords) || coords.length < 2) return false;
    const [ax, ay] = coords[0];
    const [bx, by] = coords[coords.length - 1];
    return Math.abs(ax - bx) < LOOP_TOLERANCE_DEG && Math.abs(ay - by) < LOOP_TOLERANCE_DEG;
}

let _promise = null;

/** Charge (une fois) les voyages/traces `effective` depuis la RPC publique. Mémoïsé. */
export function loadCarteJourneys() {
    if (!_promise) _promise = _fetch();
    return _promise;
}

async function _fetch() {
    let fc;
    try {
        const res = await fetch(`${SUPA_URL}/rest/v1/rpc/lrz_carte_journeys_geojson`, {
            method: 'POST',
            headers: {
                apikey: SUPA_PUBLISHABLE_KEY,
                Authorization: `Bearer ${SUPA_PUBLISHABLE_KEY}`,
                'Content-Type': 'application/json',
            },
            body: '{}',
        });
        if (!res.ok) throw new Error(`Supabase ${res.status}`);
        fc = await res.json();
    } catch (err) {
        console.warn('[loireridezen] carte journeys RPC failed', err);
        return { groups: { items: GROUPS_META }, traces: { items: [] } };
    }

    const items = (fc.features || []).map((f) => {
        const pr = f.properties || {};
        const coords = f.geometry?.coordinates ?? [];
        return {
            id: pr.stageMapId ?? pr.stageId,
            group: pr.mapGroup,
            label: pr.stageName || `${pr.departure ?? ''} ➡️ ${pr.arrival ?? ''}`.trim(),
            order: pr.stageOrder ?? pr.step ?? 0,
            step: pr.step,
            date: pr.date,
            date_status: 'effective',
            distance_km: pr.distanceKm,
            duration_h: pr.durationMin != null ? pr.durationMin / 60 : null,
            elevation_gain_m: pr.elevationGainM,
            weather: pr.weather || null,
            day: pr.day || null,
            moon: pr.moon || null,
            is_loop: _isLoop(coords),
            geojson: {
                type: 'FeatureCollection',
                features: [{ type: 'Feature', geometry: f.geometry, properties: {} }],
            },
        };
    });

    return { groups: { items: GROUPS_META }, traces: { items } };
}

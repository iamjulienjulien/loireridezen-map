/**
 * app/poi-gl.js — POI + photos en MapLibre GL (LRZ-BRA-404 P1, commit [3]).
 *
 * Port de `poi.js` (Leaflet). Le fichier Leaflet importe `map.js` (⟹ instancie Leaflet) donc on ne
 * peut pas le réutiliser tel quel en mode GL : les helpers purs (icônes, popups, fetch, filtres) sont
 * DUPLIQUÉS ici (dette transitoire, à consolider au commit [7] quand Leaflet part). Rendu = markers
 * HTML `maplibregl.Marker` (élément réutilisé de `leaflet-extra-markers` via createIcon), popups
 * `maplibregl.Popup`. ⚠️ Positionnement des markers à vérifier en navigateur (anchor extra-markers).
 */

import maplibregl from 'maplibre-gl';
import { Icon as ExtraIcon, TackCircleBorder } from 'leaflet-extra-markers';
import { map } from './map-gl.js';
import { POI_TYPES, SHAPES } from './types.js';
import { escapeHtml, safeHttpUrl, debounce, lightenHex } from './helpers.js';
import { SUPA_URL, SUPA_PUBLISHABLE_KEY } from './config.js';
import { hiddenModes } from './url-mode.js';
import { track, trackAndNavigate } from './analytics.js';

// ── État (dupliqué de poi.js) ────────────────────────────────────────────────
const photosByPoi = new Map();
let _enabledPhotoCategories = null;
let _enabledPoiTypes = null; // null = tous les types autorisés (piloté par le carnet, commit [5])
const _markers = [];

const _allowedTypes = Object.entries(POI_TYPES)
    .filter(([k, c]) => !c.hidden || (k === 'lapin' && hiddenModes.rabbit))
    .map(([k]) => k);

export function shouldShowPhoto(photo) {
    if (!_enabledPhotoCategories) return true;
    const cats = photo.categories;
    if (!cats || cats.length === 0) return true;
    return cats.some((c) => _enabledPhotoCategories.has(c));
}

export function setEnabledPhotoCategoriesGL(enabledSet) {
    _enabledPhotoCategories = enabledSet ?? null;
    loadPoisForViewportGL();
}

/** Types de POI actifs (pilotés par le carnet). `null`/vide → tous les types autorisés. */
export function setEnabledPoiTypesGL(types) {
    _enabledPoiTypes = types && types.length ? types.slice() : null;
    loadPoisForViewportGL();
}

document.addEventListener('lrz:photo-categories-changed', ({ detail }) => {
    setEnabledPhotoCategoriesGL(detail.enabled ? new Set(detail.enabled) : null);
});

// ── Icônes (extra-markers, comme poi.js) ─────────────────────────────────────
function iconByType(type) {
    const t = POI_TYPES[type];
    if (!t) {
        return new ExtraIcon({
            content: '📍',
            color: lightenHex('#00BCD4', 0.8),
            accentColor: '#00BCD4',
            svgStyle: { stroke: '#00BCD4', 'stroke-width': '1.5' },
            svg: TackCircleBorder,
            scale: 1.1,
            shadow: 'drop',
        });
    }
    return new ExtraIcon({
        content: t.emoji,
        color: lightenHex(t.color, 0.7),
        accentColor: t.color,
        svgStyle: { stroke: t.color, 'stroke-width': '0.5' },
        svg: SHAPES[t.shape] || TackCircleBorder,
        scale: 1.1,
        shadow: 'drop',
    });
}

// ── Popups (dupliqués de poi.js, HTML pur) ───────────────────────────────────
function renderAttachedPhotos(poiId) {
    const attached = photosByPoi.get(poiId) || [];
    if (!attached.length) return '';
    if (attached.length === 1) {
        const ph = attached[0];
        const img = `<img src="${escapeHtml(ph.thumb || '')}" alt="${escapeHtml(ph.name || '')}"/>`;
        const remote = escapeHtml(safeHttpUrl(ph.image) || '');
        return `<div class="lrz-poi-popup__hero-photo">${remote ? `<a href="${remote}" target="_blank" rel="noopener noreferrer">${img}</a>` : img}</div>`;
    }
    const thumbs = attached
        .map((ph) => {
            const img = `<img src="${escapeHtml(ph.thumb || '')}" alt="${escapeHtml(ph.name || '')}"/>`;
            const remote = escapeHtml(safeHttpUrl(ph.image) || '');
            return remote
                ? `<a href="${remote}" target="_blank" rel="noopener noreferrer" class="lrz-poi-popup__thumb">${img}</a>`
                : `<span class="lrz-poi-popup__thumb">${img}</span>`;
        })
        .join('');
    return `<div class="lrz-poi-popup__attached"><h4>Mes clichés</h4><div class="lrz-poi-popup__grid">${thumbs}</div></div>`;
}

function renderEditorialPoiPopup(p) {
    const t = POI_TYPES[p.type] || {};
    const color = t.color || '#888888';
    const attached = photosByPoi.get(p.id) || [];
    const attachedSrc = attached.length
        ? safeHttpUrl(attached[0].thumb) ||
          safeHttpUrl(attached[0].image) ||
          attached[0].thumb ||
          attached[0].image
        : null;
    const photo =
        p.photo_path ||
        safeHttpUrl(p.thumb) ||
        safeHttpUrl(p.image) ||
        p.thumb ||
        p.image ||
        attachedSrc ||
        null;
    return `
    <div class="lrz-popup lrz-popup--poi">
      <header class="lrz-popup__header" style="--poi-type-color:${escapeHtml(color)}">
        <span class="lrz-popup__header-left">
          <span class="lrz-popup-type-label">
            <span class="lrz-popup-type-label__emoji">${t.emoji || '📍'}</span>
            <span class="lrz-popup-type-label__text">${escapeHtml(t.label || p.type || '')}</span>
          </span>
          ${p.type === 'chateau' && p.visited === true ? `<span class="lrz-popup__visited">✅ Visité</span>` : ''}
        </span>
        <button class="lrz-popup__close" aria-label="Fermer">✕</button>
      </header>
      ${photo ? `<div class="lrz-popup__photo"><img src="${escapeHtml(photo)}" alt="${escapeHtml(p.name || '')}"/></div>` : ''}
      <div class="lrz-popup__body">
        <h3 class="lrz-popup__title">${escapeHtml(p.name || '')}</h3>
        ${p.type === 'chateau' && p.construction_date ? `<span class="lrz-popup__meta">🏗 ${escapeHtml(p.construction_date)}</span>` : ''}
        ${p.description ? `<p class="lrz-popup__desc">${escapeHtml(p.description)}</p>` : ''}
      </div>
    </div>`;
}

function renderPhotoPopup(p) {
    const img = safeHttpUrl(p.thumb) || safeHttpUrl(p.image) || p.thumb || p.image;
    const safeImg = img ? escapeHtml(img) : null;
    return `
    <div class="poi-popup">
      ${safeImg ? `<img src="${safeImg}" alt="${escapeHtml(p.name || 'Photo')}"/>` : ''}
      <strong>${escapeHtml(p.name || 'Photo')}</strong>
      ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}
    </div>`;
}

function renderLapinPopup(p) {
    const attached = photosByPoi.get(p.id) || [];
    const heroSection = attached.length === 1 ? renderAttachedPhotos(p.id) : '';
    const gridSection = attached.length > 1 ? renderAttachedPhotos(p.id) : '';
    return `
    <div class="lrz-poi-popup lrz-poi-popup--lapin">
      ${heroSection || (p.photo_path ? `<div class="lrz-poi-popup__photo"><img src="${escapeHtml(p.photo_path)}" alt="${escapeHtml(p.name || 'Lapin')}"/></div>` : '')}
      <div class="lrz-poi-popup__body">
        <strong class="lrz-poi-popup__title">${escapeHtml(p.name || 'Lapin en voyage')}</strong>
        ${p.description ? `<p class="lrz-poi-popup__description">${escapeHtml(p.description)}</p>` : ''}
        ${gridSection}
        ${hiddenModes.rabbit ? `<span class="lrz-poi-popup__closing">Je pense à toi 💗</span>` : ''}
        <span class="lrz-poi-popup__signature">💖 Papa</span>
      </div>
    </div>`;
}

/** HTML du popup selon le type + faut-il câbler un bouton fermer custom. */
function popupHtmlFor(p) {
    if (p.type === 'lapin') return { html: renderLapinPopup(p), customClose: false };
    if (p.type === 'photo') return { html: renderPhotoPopup(p), customClose: false };
    return { html: renderEditorialPoiPopup(p), customClose: true };
}

// ── Fetch (dupliqué de poi.js — bounds.getWest/... : API identique GL) ────────
let lastAbort = null;

async function fetchPoisFromSupabase(bounds, activeType, signal) {
    const body = {
        minlon: bounds.getWest(),
        minlat: bounds.getSouth(),
        maxlon: bounds.getEast(),
        maxlat: bounds.getNorth(),
        p_allowed_types: _allowedTypes,
    };
    if (activeType) body.p_type = activeType;
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/pois_bbox_geojson`, {
        method: 'POST',
        headers: {
            apikey: SUPA_PUBLISHABLE_KEY,
            Authorization: `Bearer ${SUPA_PUBLISHABLE_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    return res.json();
}

async function fetchLocalPhotos() {
    try {
        const r = await fetch('data/pois/pois_photos.geojson');
        if (!r.ok) return { type: 'FeatureCollection', features: [] };
        return r.json();
    } catch {
        return { type: 'FeatureCollection', features: [] };
    }
}

function buildPhotosByPoi(features) {
    photosByPoi.clear();
    for (const f of features) {
        const { poi_id } = f.properties || {};
        if (poi_id) {
            if (!photosByPoi.has(poi_id)) photosByPoi.set(poi_id, []);
            photosByPoi.get(poi_id).push(f.properties);
        }
    }
}

// ── Bannière d'erreur (DOM, position bottom-left) ────────────────────────────
let _errorBanner = null;
function ensureErrorBanner() {
    if (_errorBanner) return _errorBanner;
    const div = document.createElement('div');
    div.className = 'lrz-error-banner';
    div.setAttribute('role', 'status');
    div.style.cssText = 'display:none;position:absolute;left:10px;bottom:10px;z-index:5;';
    div.innerHTML = `<span class="lrz-error-banner__msg">Impossible de charger les lieux.</span><button type="button" class="lrz-error-banner__retry">Réessayer</button>`;
    div.querySelector('.lrz-error-banner__retry').addEventListener('click', () =>
        loadPoisForViewportGL()
    );
    map.getContainer().appendChild(div);
    _errorBanner = div;
    return div;
}
function showErrorBanner() {
    ensureErrorBanner().style.display = 'flex';
}
function hideErrorBanner() {
    if (_errorBanner) _errorBanner.style.display = 'none';
}

// ── Rendu markers GL ─────────────────────────────────────────────────────────
function clearMarkers() {
    for (const m of _markers) m.remove();
    _markers.length = 0;
}

function addPoiMarker(feature) {
    const p = feature.properties || {};
    const [lng, lat] = feature.geometry?.coordinates ?? [];
    if (lng == null || lat == null) return;

    const el = iconByType(p.type).createIcon(); // élément DOM extra-markers réutilisé
    // createIcon() applique des styles d'ancrage Leaflet (position absolute + marginLeft/Top =
    // -iconAnchor) qui se cumulent avec l'ancrage de maplibregl.Marker → double décalage (markers
    // « trop hauts »). On neutralise ces styles et on laisse MapLibre ancrer par le bas (pointe du pin).
    el.style.position = 'static';
    el.style.margin = '0';
    el.style.left = '';
    el.style.top = '';
    el.style.cursor = 'pointer';
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);

    el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const { html, customClose } = popupHtmlFor(p);
        const popup = new maplibregl.Popup({ closeButton: !customClose, maxWidth: '320px' })
            .setLngLat([lng, lat])
            .setHTML(html)
            .addTo(map);
        const root = popup.getElement();
        if (customClose) {
            root?.querySelector('.lrz-popup__close')?.addEventListener('click', () =>
                popup.remove()
            );
        }
        if (p.type !== 'photo' && p.url_insta) {
            const link = root?.querySelector('a[href*="instagram"]');
            link?.addEventListener('click', (e) => {
                e.preventDefault();
                trackAndNavigate('POI Instagram', link.href, {
                    poi_id: p.id || '',
                    type: p.type || '',
                });
            });
        }
        if (p.type === 'photo') track('Photo Opened', { id: p.id || '', caption: p.caption || '' });
        else track('POI Opened', { type: p.type || '', name: p.name || '' });
    });

    _markers.push(marker);
}

/** Charge les POI de la BBOX courante (port de loadPoisForViewport). */
export async function loadPoisForViewportGL() {
    let activeTypes, activeType, bounds;
    if (hiddenModes.rabbit) {
        activeTypes = ['lapin'];
        activeType = 'lapin';
        bounds = { getWest: () => -5, getSouth: () => 41, getEast: () => 10, getNorth: () => 51 };
    } else {
        // Types pilotés par le carnet (commit [5]) ; défaut = tous les types autorisés.
        activeTypes = (_enabledPoiTypes ?? _allowedTypes).filter((t) => _allowedTypes.includes(t));
        activeType = activeTypes.length === 1 ? activeTypes[0] : null;
        bounds = map.getBounds();
    }

    if (lastAbort) lastAbort.abort();
    const controller = new AbortController();
    lastAbort = controller;

    try {
        const [fcDB, fcLocal] = await Promise.all([
            fetchPoisFromSupabase(bounds, activeType, controller.signal),
            fetchLocalPhotos(),
        ]);
        const localFeatures = fcLocal.features || [];
        buildPhotosByPoi(localFeatures);
        const photosForMarkers = localFeatures.filter((f) => {
            const p = f.properties || {};
            if (p.poi_id) return false;
            if (p.type === 'photo') return shouldShowPhoto(p);
            return true;
        });
        const activeSet = new Set(activeTypes);
        const filtered = (fcDB.features || []).concat(photosForMarkers).filter((f) => {
            const p = f.properties || {};
            if (!activeSet.has(p.type)) return false;
            if (p.type === 'photo') return shouldShowPhoto(p);
            return true;
        });

        clearMarkers(); // après succès (préserve les markers si erreur)
        for (const feature of filtered) addPoiMarker(feature);
        hideErrorBanner();
        document.dispatchEvent(new CustomEvent('lrz:poi-loaded'));
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('[loireridezen] fetchPoisFromSupabase failed', err);
        showErrorBanner();
    }
}

/** Recharge les POI au déplacement de carte (les filtres passent par setEnabledPoiTypesGL, commit [5]). */
export function bindViewportListenersGL() {
    map.on('moveend', debounce(loadPoisForViewportGL, 250));
}

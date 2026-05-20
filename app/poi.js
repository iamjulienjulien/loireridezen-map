/**
 * app/poi.js — POI dynamiques (Supabase) + photos locales
 *
 * Responsabilités :
 *   - construire les icônes Leaflet depuis POI_TYPES (iconByType)
 *   - construire les popups en échappant le HTML (bindPopupFromProps)
 *   - fetch des POI Supabase par BBOX (avec abort sur déplacement rapide)
 *   - fetch des photos locales (pois_photos.geojson)
 *   - rendu du cluster sur la carte
 *   - bannière d'erreur en bas à gauche avec bouton Réessayer
 *
 * Exporte loadPoisForViewport (à brancher sur "moveend" et sur les filtres)
 * et le cluster (utilisé par ui.js dans le layer control).
 */

import {
  LayerGroup,
  GeoJSON,
  Marker,
  Control,
  DomUtil,
  DomEvent,
} from "leaflet";
import * as leafletExtraMarkers from "leaflet-extra-markers";

import { map } from "./map.js";
import { POI_TYPES, SHAPES } from "./types.js";
import { escapeHtml, safeHttpUrl, debounce } from "./helpers.js";
import { SUPA_URL, SUPA_PUBLISHABLE_KEY } from "./config.js";

const { Icon, TackCircleBorder } = leafletExtraMarkers;

// ──────────────────────────────────────────────── Cluster (LayerGroup)

export const cluster = new LayerGroup().addTo(map);

// ──────────────────────────────────────────────────────────── Icônes

function iconByType(type) {
  const t = POI_TYPES[type];
  if (!t) {
    return new Icon({
      content: "📍",
      color: "#00BCD4",
      accentColor: "rgba(0,0,0,0.18)",
      svg: TackCircleBorder,
      scale: 1.1,
      shadow: "drop",
    });
  }
  return new Icon({
    content: t.emoji,
    color: t.color,
    accentColor: "rgba(0,0,0,0.18)",
    svg: SHAPES[t.shape] || TackCircleBorder,
    scale: 1.1,
    shadow: "drop",
  });
}

// ──────────────────────────────────────────────────────────── Popups

function renderChateauPopup(p) {
  const visited = p.visited === true;
  return `
    <div class="lrz-poi-popup lrz-poi-popup--chateau">
      ${p.photo_path ? `<div class="lrz-poi-popup__photo"><img src="${escapeHtml(p.photo_path)}" alt="${escapeHtml(p.name || "Château")}"/></div>` : ""}
      <div class="lrz-poi-popup__body">
        <strong class="lrz-poi-popup__title">${escapeHtml(p.name || "Château")}</strong>
        <div class="lrz-poi-popup__meta">
          <span class="lrz-poi-popup__badge lrz-poi-popup__badge--${visited ? "visited" : "planned"}">${visited ? "✓ Visité" : "À visiter"}</span>
          ${p.construction_date ? `<span class="lrz-poi-popup__meta-date">🏗 ${escapeHtml(p.construction_date)}</span>` : ""}
        </div>
        ${p.description ? `<p class="lrz-poi-popup__description">${escapeHtml(p.description)}</p>` : ""}
      </div>
    </div>
  `;
}

function renderGenericPoiPopup(p) {
  const img = safeHttpUrl(p.thumb) || safeHttpUrl(p.image) || p.thumb || p.image;
  const insta = safeHttpUrl(p.url_insta);
  const safeImg = img ? escapeHtml(img) : null;
  return `
    <div class="poi-popup">
      ${safeImg ? `<img src="${safeImg}" alt="${escapeHtml(p.name || "POI")}"/>` : ""}
      <strong>${escapeHtml(p.name || "Point")}</strong><br/>
      <small>${escapeHtml(p.type || "")}${p.stage ? ` · Étape ${escapeHtml(String(p.stage))}` : ""}</small>
      ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ""}
      ${insta ? `<p><a href="${escapeHtml(insta)}" target="_blank" rel="noopener noreferrer">Voir sur Instagram 📲</a></p>` : ""}
    </div>
  `;
}

function renderPoiPopup(p) {
  if (p.type === "chateau") return renderChateauPopup(p);
  return renderGenericPoiPopup(p);
}

function bindPopupFromProps(p, layer) {
  layer.bindPopup(renderPoiPopup(p));
}

// ──────────────────────────────────────────────── Bannière d'erreur

const errorControl = new Control({ position: "bottomleft" });
let currentRetry = null;

errorControl.onAdd = function () {
  const div = DomUtil.create("div", "lrz-error-banner");
  div.setAttribute("role", "status");
  div.setAttribute("aria-live", "polite");
  div.style.display = "none";
  div.innerHTML = `
    <span class="lrz-error-banner__msg">Impossible de charger les lieux.</span>
    <button type="button" class="lrz-error-banner__retry">Réessayer</button>
  `;
  DomEvent.disableClickPropagation(div);
  div
    .querySelector(".lrz-error-banner__retry")
    .addEventListener("click", () => currentRetry?.());
  return div;
};
errorControl.addTo(map);

function showErrorBanner(onRetry) {
  currentRetry = onRetry;
  errorControl.getContainer().style.display = "flex";
}

function hideErrorBanner() {
  currentRetry = null;
  errorControl.getContainer().style.display = "none";
}

// ────────────────────────────────────────────────────── Fetch POI

let lastAbort = null;

async function fetchPoisFromSupabase(bounds, activeType, signal) {
  const body = {
    minlon: bounds.getWest(),
    minlat: bounds.getSouth(),
    maxlon: bounds.getEast(),
    maxlat: bounds.getNorth(),
  };
  if (activeType) body.p_type = activeType;

  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/pois_bbox_geojson`, {
    method: "POST",
    headers: {
      apikey: SUPA_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPA_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

async function fetchLocalPhotos() {
  try {
    const r = await fetch("data/pois/pois_photos.geojson");
    if (!r.ok) return { type: "FeatureCollection", features: [] };
    return r.json();
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}

/**
 * Charge les POI visibles dans la BBOX courante.
 * Annule le fetch précédent si encore en cours (déplacement rapide).
 * En cas d'erreur, conserve les markers précédents et affiche la bannière.
 */
export async function loadPoisForViewport() {
  const activeTypes = Array.from(
    document.querySelectorAll(".type-filter:checked"),
  ).map((i) => i.value);
  const activeType = activeTypes.length === 1 ? activeTypes[0] : null;

  if (lastAbort) lastAbort.abort();
  const controller = new AbortController();
  lastAbort = controller;

  const bounds = map.getBounds();

  try {
    const [fcDB, fcLocal] = await Promise.all([
      fetchPoisFromSupabase(bounds, activeType, controller.signal),
      fetchLocalPhotos(),
    ]);
    const all = (fcDB.features || []).concat(fcLocal.features || []);
    const activeSet = new Set(activeTypes);
    const filtered = all.filter((f) =>
      activeSet.has((f.properties || {}).type),
    );

    // clearLayers seulement APRÈS succès du fetch (préserve les markers
    // précédents si une erreur survient ensuite)
    cluster.clearLayers();
    const layer = new GeoJSON(
      { type: "FeatureCollection", features: filtered },
      {
        pointToLayer: (f, latlng) =>
          new Marker(latlng, { icon: iconByType((f.properties || {}).type) }),
        onEachFeature: (f, l) => bindPopupFromProps(f.properties || {}, l),
      },
    );
    cluster.addLayer(layer);
    hideErrorBanner();
    document.dispatchEvent(new CustomEvent("lrz:poi-loaded"));
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error("[loireridezen] fetchPoisFromSupabase failed", {
      bbox: {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      },
      error: err.message,
      stack: err.stack,
    });
    showErrorBanner(loadPoisForViewport);
  }
}

/** Compte les POI visibles dans le cluster (pour le badge du panel). */
export function getVisiblePoiCount() {
  return cluster.getLayers().reduce((acc, l) => {
    return acc + (l.getLayers ? l.getLayers().length : 1);
  }, 0);
}

/**
 * Branche les listeners "moveend" et "filtres" pour recharger les POI
 * automatiquement quand la vue ou les filtres changent.
 */
export function bindViewportListeners() {
  const debounced = debounce(loadPoisForViewport, 250);
  map.on("moveend", debounced);
  document
    .querySelectorAll(".type-filter")
    .forEach((cb) => cb.addEventListener("change", debounced));
}

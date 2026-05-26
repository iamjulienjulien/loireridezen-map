/**
 * app/map-export.js — Export de carte en image (LRZ-EVO-41 / 42 / 43)
 *
 * Approche canvas slippy-map :
 *   1. Tuiles XYZ depuis BASEMAPS (OSM, Esri, IGN, CyclOSM, OpenTopoMap)
 *   2. Polylignes GeoJSON → pixels, halo blanc sous le trait coloré
 *   3. Marqueurs drapeau Départ/Étape/Arrivée (emoji + ctx.filter hue-rotate)
 *   4. Options : noms de villes, encadré stats, position actuelle
 *   5. Sélecteur de couleur principale (8 swatches) + thèmes prédéfinis (5)
 *   6. Attribution cartographique (bas-gauche, obligatoire)
 *   7. canvas.toBlob() → JPEG 0.92 → téléchargement
 *
 * Visible uniquement avec ?admin dans l'URL.
 */

import { TRACE_MARKER_TYPES } from './types.js';

// ─── Fonds de carte ───────────────────────────────────────────────────────────

const BASEMAPS = {
  osm: {
    label: 'Plan OSM',
    tileUrl: (z, x, y) => `https://${'abc'[(x + y + z) % 3]}.tile.openstreetmap.org/${z}/${x}/${y}.png`,
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  sat: {
    label: 'Satellite',
    tileUrl: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: '© Esri',
    maxZoom: 19,
  },
  ign: {
    label: 'IGN Plan',
    tileUrl: (z, x, y) =>
      `https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile` +
      `&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM` +
      `&TILEMATRIX=${z}&TILECOL=${x}&TILEROW=${y}&FORMAT=image/png`,
    attribution: '© IGN-F / Géoplateforme',
    maxZoom: 18,
  },
  ign_topo: {
    label: 'IGN Topo',
    tileUrl: (z, x, y) =>
      `https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile` +
      `&LAYER=GEOGRAPHICALGRIDSYSTEMS.MAPS&STYLE=normal&TILEMATRIXSET=PM` +
      `&TILEMATRIX=${z}&TILECOL=${x}&TILEROW=${y}&FORMAT=image/jpeg`,
    attribution: '© IGN-F / Géoplateforme',
    maxZoom: 18,
  },
  cyclosm: {
    label: 'CyclOSM',
    tileUrl: (z, x, y) => `https://${'abc'[(x + y + z) % 3]}.tile-cyclosm.openstreetmap.fr/cyclosm/${z}/${x}/${y}.png`,
    attribution: '© OpenStreetMap contributors · tuiles CyclOSM / OSM-FR',
    maxZoom: 20,
  },
  topo: {
    label: 'OpenTopo',
    tileUrl: (z, x, y) => `https://${'abc'[(x + y + z) % 3]}.tile.opentopomap.org/${z}/${x}/${y}.png`,
    attribution: '© OpenTopoMap (CC-BY-SA) · © OpenStreetMap contributors',
    maxZoom: 17,
  },
};

// ─── Palette de couleurs ──────────────────────────────────────────────────────

const COLOR_PALETTE = [
  { key: 'loire',      hex: '#3a6f8f', label: 'Bleu Loire' },
  { key: 'bordeaux',   hex: '#722f37', label: 'Bordeaux' },
  { key: 'vigne',      hex: '#6b8e4e', label: 'Vert vigne' },
  { key: 'ambre',      hex: '#c8893a', label: 'Ambré' },
  { key: 'terracotta', hex: '#b5562f', label: 'Terracotta' },
  { key: 'ardoise',    hex: '#3f4a54', label: 'Ardoise' },
  { key: 'indigo',     hex: '#38445f', label: 'Indigo' },
  { key: 'tuffeau',    hex: '#2b2620', label: 'Tuffeau foncé' },
];

// ─── Thèmes prédéfinis ────────────────────────────────────────────────────────

const THEMES = [
  { key: 'etat-major',  label: 'État-major',    basemap: 'ign_topo', color: '#722f37', font: 'Spectral' },
  { key: 'loire-velo',  label: 'Loire à vélo',  basemap: 'cyclosm',  color: '#3a6f8f', font: 'Oswald' },
  { key: 'or-tuffeau',  label: 'Or et tuffeau', basemap: 'sat',      color: '#c8893a', font: 'Fraunces' },
  { key: 'grand-air',   label: 'Grand air',     basemap: 'topo',     color: '#b5562f', font: 'Cabin' },
  { key: 'ardoise',     label: 'Ardoise',       basemap: 'ign',      color: '#3f4a54', font: 'Geist' },
];

// ─── Menu de polices ──────────────────────────────────────────────────────────

const FONT_MENU = [
  { key: 'spectral',       family: 'Spectral',       label: 'Spectral' },
  { key: 'fraunces',       family: 'Fraunces',        label: 'Fraunces' },
  { key: 'oswald',         family: 'Oswald',          label: 'Oswald' },
  { key: 'cabin',          family: 'Cabin',           label: 'Cabin' },
  { key: 'geist',          family: 'Geist',           label: 'Geist' },
  { key: 'jetbrains-mono', family: 'JetBrains Mono',  label: 'Editor' },
];

// ─── Formats ──────────────────────────────────────────────────────────────────

const FORMATS = {
  square:  { label: 'Carré',       ratio: '1:1',  w: 2160, h: 2160 },
  story:   { label: 'Story',       ratio: '9:16', w: 2160, h: 3840 },
  publish: { label: 'Publication', ratio: '4:5',  w: 2160, h: 2700 },
};

// ─── Emojis pour l'encadré stats ─────────────────────────────────────────────

const STAT_ICONS = {
  calendar: '📅',
  bike:     '🚴',
  route:    '📏',
  mountain: '🏔️',
  clock:    '🕒',
};

// ─── Définitions des lignes de stats (pour les cases à cocher) ───────────────

const STAT_DEFS = [
  { id: 'dates',  label: 'Dates',           icon: 'calendar', mode: 'both' },
  { id: 'stages', label: "Nombre d'étapes", icon: 'bike',     mode: 'act'  },
  { id: 'dist',   label: 'Distance',        icon: 'route',    mode: 'both' },
  { id: 'elev',   label: 'Dénivelé',        icon: 'mountain', mode: 'both' },
  { id: 'dur',    label: 'Durée',           icon: 'clock',    mode: 'step' },
];

// ─── Projection Web Mercator ──────────────────────────────────────────────────

function worldFromLngLat(lng, lat) {
  const x = (lng + 180) / 360;
  const sinLat = Math.sin(lat * Math.PI / 180);
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return { x, y };
}

// ─── BBox ─────────────────────────────────────────────────────────────────────

function emptyBbox() {
  return { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
}

function bboxFromGeoJSON(geojson) {
  const b = emptyBbox();
  for (const f of (geojson.features ?? [geojson])) {
    for (const [lng, lat] of (f.geometry?.coordinates ?? [])) {
      if (lng < b.west)  b.west  = lng;
      if (lng > b.east)  b.east  = lng;
      if (lat < b.south) b.south = lat;
      if (lat > b.north) b.north = lat;
    }
  }
  return b;
}

function mergeBboxes(bboxes) {
  const r = emptyBbox();
  for (const b of bboxes) {
    if (b.west  < r.west)  r.west  = b.west;
    if (b.east  > r.east)  r.east  = b.east;
    if (b.south < r.south) r.south = b.south;
    if (b.north > r.north) r.north = b.north;
  }
  return r;
}

// ─── Render params ────────────────────────────────────────────────────────────

function computeRenderParams(bbox, canvasW, canvasH, padding = 0.05, maxTileZoom = 18) {
  const TILE_SIZE = 256;
  const nw = worldFromLngLat(bbox.west, bbox.north);
  const se = worldFromLngLat(bbox.east, bbox.south);

  const bboxWx   = se.x - nw.x;
  const bboxWy   = se.y - nw.y;
  const centerWX = (nw.x + se.x) / 2;
  const centerWY = (nw.y + se.y) / 2;

  const targetW = canvasW * (1 - 2 * padding);
  const targetH = canvasH * (1 - 2 * padding);
  const zFromW  = Math.log2(targetW / (bboxWx * TILE_SIZE));
  const zFromH  = Math.log2(targetH / (bboxWy * TILE_SIZE));

  const zFloat    = Math.min(Math.min(zFromW, zFromH), maxTileZoom);
  const zoom      = Math.floor(zFloat);
  const tileScale = Math.pow(2, zFloat - zoom);

  const scalePx = Math.pow(2, zFloat) * TILE_SIZE;
  return {
    zoom, tileScale, zFloat,
    originWX: centerWX - canvasW / (2 * scalePx),
    originWY: centerWY - canvasH / (2 * scalePx),
  };
}

// ─── Tile loading (avec timeout + allSettled) ─────────────────────────────────

const TILE_SIZE = 256;
const _tileCache = new Map();

function loadTile(url) {
  if (_tileCache.has(url)) return _tileCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
    // Résoudre avec null après 8 s pour ne pas bloquer le rendu
    setTimeout(() => resolve(null), 8000);
  });
  _tileCache.set(url, p);
  return p;
}

// ─── Pixel utils ─────────────────────────────────────────────────────────────

function lngLatToPixel(lng, lat, zFloat, originWX, originWY) {
  const w = worldFromLngLat(lng, lat);
  const scalePx = Math.pow(2, zFloat) * TILE_SIZE;
  return { x: (w.x - originWX) * scalePx, y: (w.y - originWY) * scalePx };
}

function hexToHueDeg(hex) {
  if (!hex || hex[0] !== '#') return 0;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = Math.round(h * 60);
  return h < 0 ? h + 360 : h;
}

// ─── Helpers graphiques ───────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function _rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

async function _ensureFontLoaded(family) {
  await Promise.all([
    document.fonts.load(`400 32px '${family}'`),
    document.fonts.load(`700 32px '${family}'`),
  ]);
}

// ─── Helpers données ──────────────────────────────────────────────────────────

function extractCityNames(label) {
  const arrowEmoji = '➡️';
  const idx = label.indexOf(arrowEmoji);
  if (idx < 0) return { from: label.trim(), to: null };
  const fromPart = label.slice(0, idx).replace(/^[^\d]*\d+\s+/, '').trim();
  const toPart   = label.slice(idx + arrowEmoji.length);
  const secArrow = toPart.lastIndexOf('→');
  const toRaw    = secArrow >= 0 ? toPart.slice(secArrow + 1) : toPart;
  return { from: fromPart, to: toRaw.replace(/^[^A-Za-zÀ-ÿ]+/, '').trim() };
}

function _fmtNum(n) { return Math.round(n).toLocaleString('fr-FR'); }

function _formatDateFR(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return dateStr; }
}

function _formatPeriodFR(dates) {
  const sorted = dates.filter(Boolean).sort();
  if (!sorted.length) return null;
  try {
    const first = new Date(sorted[0] + 'T12:00:00');
    const last  = new Date(sorted[sorted.length - 1] + 'T12:00:00');
    if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
      const monthYear = last.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      return `${first.getDate()}–${last.getDate()} ${monthYear}`;
    }
    return first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  } catch { return sorted[0]; }
}

function _formatDurationFR(hours) {
  if (hours == null) return null;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

// Ordre — acte  : dates → étapes → distance → dénivelé
// Ordre — étape : date  → distance → dénivelé → durée
function _computeStatsData(mode, group, loaded, color) {
  if (mode === 'act') {
    const n       = loaded.length;
    const hasDist = loaded.some(({ item }) => item.distance_km != null);
    const hasElev = loaded.some(({ item }) => item.elevation_gain_m != null);
    const totalDist = loaded.reduce((s, { item }) => s + (item.distance_km ?? 0), 0);
    const totalElev = loaded.reduce((s, { item }) => s + (item.elevation_gain_m ?? 0), 0);
    const allDates  = loaded.map(({ item }) => item.date).filter(Boolean);
    const lines = [];
    const period = _formatPeriodFR(allDates);
    if (period)  lines.push({ text: period, icon: 'calendar' });
    lines.push({ text: `${n} étape${n > 1 ? 's' : ''}`, icon: 'bike' });
    if (hasDist) lines.push({ text: `${_fmtNum(totalDist)} km`, icon: 'route' });
    if (hasElev) lines.push({ text: `${_fmtNum(totalElev)} m de dénivelé`, icon: 'mountain' });
    return { title: group?.label ?? '', lines, color };
  } else {
    const item  = loaded[0].item;
    const lines = [];
    if (item.date)              lines.push({ text: _formatDateFR(item.date) ?? item.date, icon: 'calendar' });
    if (item.distance_km != null)     lines.push({ text: `${(+item.distance_km).toLocaleString('fr-FR')} km`, icon: 'route' });
    if (item.elevation_gain_m != null) lines.push({ text: `${_fmtNum(item.elevation_gain_m)} m de dénivelé`, icon: 'mountain' });
    if (item.duration_h != null)       lines.push({ text: _formatDurationFR(item.duration_h), icon: 'clock' });
    return { title: item.label ?? '', lines, color };
  }
}

// ─── Canvas drawing ───────────────────────────────────────────────────────────

async function drawBasemap(ctx, canvasW, canvasH, zoom, tileScale, originWX, originWY, tileUrlFn) {
  const scale           = Math.pow(2, zoom);
  const tileDisplaySize = TILE_SIZE * tileScale;
  const txMin = Math.floor(originWX * scale);
  const tyMin = Math.floor(originWY * scale);
  const txMax = Math.ceil(originWX * scale + canvasW / tileDisplaySize);
  const tyMax = Math.ceil(originWY * scale + canvasH / tileDisplaySize);

  const jobs = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      jobs.push(loadTile(tileUrlFn(zoom, tx, ty)).then((img) => ({ img, tx, ty })));
    }
  }
  const results = await Promise.allSettled(jobs);

  ctx.fillStyle = '#ddd';
  ctx.fillRect(0, 0, canvasW, canvasH);
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { img, tx, ty } = r.value;
    if (!img) continue;
    const px = (tx - originWX * scale) * tileDisplaySize;
    const py = (ty - originWY * scale) * tileDisplaySize;
    ctx.drawImage(img, Math.round(px), Math.round(py), Math.ceil(tileDisplaySize), Math.ceil(tileDisplaySize));
  }
}

function drawTraces(ctx, traces, zFloat, originWX, originWY, lineWidth) {
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  const haloWidth = lineWidth + Math.round(lineWidth * 0.7);

  for (const { geojson, dashed } of traces) {
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth   = haloWidth;
    ctx.setLineDash(dashed ? [haloWidth * 1.5, haloWidth * 2] : []);
    for (const f of (geojson.features ?? [geojson])) {
      const coords = f.geometry?.coordinates ?? [];
      if (coords.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < coords.length; i++) {
        const { x, y } = lngLatToPixel(coords[i][0], coords[i][1], zFloat, originWX, originWY);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  for (const { geojson, color, dashed } of traces) {
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;
    ctx.setLineDash(dashed ? [lineWidth * 2, lineWidth * 2.5] : []);
    for (const f of (geojson.features ?? [geojson])) {
      const coords = f.geometry?.coordinates ?? [];
      if (coords.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < coords.length; i++) {
        const { x, y } = lngLatToPixel(coords[i][0], coords[i][1], zFloat, originWX, originWY);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

function drawMarkers(ctx, markers, zFloat, originWX, originWY, fontSize) {
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  for (const { lng, lat, emoji, color } of markers) {
    const { x, y } = lngLatToPixel(lng, lat, zFloat, originWX, originWY);
    const rotate = ((hexToHueDeg(color) - 38) + 360) % 360;
    ctx.filter = `sepia(1) saturate(4) hue-rotate(${rotate}deg)`;
    ctx.font   = `${fontSize}px sans-serif`;
    ctx.fillText(emoji, x, y);
  }
  ctx.filter = 'none';
}

function drawCityLabels(ctx, markers, zFloat, originWX, originWY, fontSize, fontFamily = 'Geist') {
  const pad     = Math.round(fontSize * 0.4);
  const r       = Math.round(fontSize * 0.3);
  const offsetX = Math.round(fontSize * 1.15);
  const placed  = [];

  for (const marker of markers) {
    if (!marker.city) continue;
    const { x, y } = lngLatToPixel(marker.lng, marker.lat, zFloat, originWX, originWY);
    const bold      = marker.bold ? 'bold ' : '';
    const cityText  = marker.bold ? marker.city.toUpperCase() : marker.city;
    ctx.font        = `${bold}${fontSize}px '${fontFamily}', sans-serif`;

    const tw  = ctx.measureText(cityText).width;
    const bw  = tw + pad * 2;
    const bh  = fontSize + pad;
    const lx  = x + offsetX;

    const vertSteps = [0, -bh * 0.9, bh * 0.9, -bh * 1.8, bh * 1.8, -bh * 2.7];
    let chosen = null;
    for (const dy of vertSteps) {
      const candidate = { x: lx, y: y - bh / 2 + dy, w: bw, h: bh };
      if (!placed.some((p) => _rectsOverlap(p, candidate))) { chosen = candidate; break; }
    }
    if (!chosen) chosen = { x: lx, y: y - bh / 2 + vertSteps[vertSteps.length - 1], w: bw, h: bh };
    placed.push(chosen);

    const centerY  = chosen.y + bh / 2;
    const vertDist = Math.abs(centerY - y);

    if (vertDist > bh * 0.35) {
      ctx.save();
      ctx.strokeStyle = marker.color || '#2e6a8f';
      ctx.lineWidth   = Math.max(1, Math.round(fontSize * 0.07));
      ctx.setLineDash([Math.round(fontSize * 0.2), Math.round(fontSize * 0.15)]);
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(chosen.x, centerY);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle   = 'rgba(255,255,255,0.9)';
    ctx.shadowColor = 'rgba(0,0,0,0.12)';
    ctx.shadowBlur  = Math.round(fontSize * 0.2);
    roundRect(ctx, chosen.x, chosen.y, chosen.w, chosen.h, r);
    ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';

    ctx.fillStyle    = marker.color || '#2e6a8f';
    ctx.font         = `${bold}${fontSize}px '${fontFamily}', sans-serif`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(cityText, chosen.x + pad, centerY);
  }
}

function drawStats(ctx, canvasW, canvasH, statsData, fontSize, margin, showTitle, fontFamily = 'Geist') {
  const { title, lines } = statsData;
  if (!lines.length) return;

  const iconSize = Math.round(fontSize * 0.85);
  const iconPad  = Math.round(iconSize * 0.55);
  const titleFs  = (showTitle && title) ? Math.round(fontSize * 1.25) : 0;
  const divH     = (showTitle && title) ? Math.round(fontSize * 0.5)  : 0;
  const lineH    = Math.round(fontSize * 1.65);
  const pad      = Math.round(fontSize * 0.85);
  const r        = Math.round(fontSize * 0.4);

  let maxW = 0;
  if (showTitle && title) {
    ctx.font = `bold ${titleFs}px '${fontFamily}', sans-serif`;
    maxW = Math.max(maxW, ctx.measureText(title).width);
  }
  ctx.font = `${fontSize}px '${fontFamily}', sans-serif`;
  for (const { text } of lines) {
    maxW = Math.max(maxW, iconSize + iconPad + ctx.measureText(text).width);
  }

  const boxW = maxW + pad * 2;
  const boxH = pad + (showTitle && title ? titleFs + divH : 0) + lines.length * lineH + pad;
  const bx   = canvasW - boxW - margin;
  const by   = canvasH - boxH - margin;

  ctx.shadowColor   = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur    = Math.round(fontSize * 0.6);
  ctx.shadowOffsetY = Math.round(fontSize * 0.15);
  ctx.fillStyle     = 'rgba(252,250,245,0.93)';
  roundRect(ctx, bx, by, boxW, boxH, r);
  ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.shadowColor = 'transparent';

  let curY = by + pad;

  if (showTitle && title) {
    ctx.fillStyle    = '#2a2a2a';
    ctx.font         = `bold ${titleFs}px '${fontFamily}', sans-serif`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, bx + pad, curY);
    curY += titleFs;

    const divMidY = curY + divH / 2;
    ctx.strokeStyle = '#d8d3c8';
    ctx.lineWidth   = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(bx + pad, divMidY);
    ctx.lineTo(bx + boxW - pad, divMidY);
    ctx.stroke();
    curY += divH;
  }

  for (const { text, icon } of lines) {
    const iconCX = bx + pad + iconSize / 2;
    const iconCY = curY + lineH / 2;

    ctx.filter = 'none';
    ctx.font   = `${iconSize}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(STAT_ICONS[icon] ?? '', iconCX, iconCY);

    ctx.fillStyle    = '#333';
    ctx.font         = `${fontSize}px '${fontFamily}', sans-serif`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + pad + iconSize + iconPad, iconCY);
    curY += lineH;
  }
}

async function drawCurrentPosition(ctx, zFloat, originWX, originWY, bbox, fontSize) {
  try {
    const r = await fetch('data/catalog/current_position.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const data = await r.json();
    if (!data.active || !data.coordinates) return;
    const [lng, lat] = data.coordinates;
    if (lng < bbox.west || lng > bbox.east || lat < bbox.south || lat > bbox.north) return;
    const { x, y } = lngLatToPixel(lng, lat, zFloat, originWX, originWY);
    ctx.filter = 'none';
    ctx.font   = `${fontSize}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🚲', x, y);
  } catch { /* position non disponible */ }
}

function drawAttribution(ctx, canvasW, canvasH, text) {
  const fs  = Math.max(20, Math.round(canvasW / 90));
  const pad = Math.round(fs * 0.5);
  ctx.font  = `${fs}px sans-serif`;
  const textW = ctx.measureText(text).width;
  const boxW  = textW + pad * 2;
  const boxH  = fs + pad * 2;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillRect(6, canvasH - boxH - 6, boxW, boxH);
  ctx.fillStyle    = '#333';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, 6 + pad, canvasH - pad - 6);
}

// ─── Data loading ─────────────────────────────────────────────────────────────

const _geojsonCache = new Map();

function fetchGeoJSON(url) {
  if (_geojsonCache.has(url)) return _geojsonCache.get(url);
  const p = fetch(url).then((r) => r.ok ? r.json() : null).catch(() => null);
  _geojsonCache.set(url, p);
  return p;
}

function _firstCoord(gj) { return gj.features?.[0]?.geometry?.coordinates?.[0] ?? null; }
function _lastCoord(gj) {
  const fs = gj.features ?? [];
  const f  = fs[fs.length - 1];
  const c  = f?.geometry?.coordinates ?? [];
  return c[c.length - 1] ?? null;
}

async function loadSelectionData(mode, selectedId, groups, tracesData) {
  const allGroups = groups.items ?? [];
  const allItems  = tracesData.items ?? [];

  let items = [], group = null;
  if (mode === 'act') {
    group = allGroups.find((g) => g.id === selectedId);
    items = allItems.filter((it) => it.group === selectedId)
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  } else {
    const item = allItems.find((it) => it.id === selectedId);
    if (item) { items = [item]; group = allGroups.find((g) => g.id === item.group); }
  }
  if (!items.length) return null;

  const loaded = (await Promise.all(items.map(async (item) => {
    const url = item.paths?.simplified ?? item.paths?.full;
    const gj  = url ? await fetchGeoJSON(url) : null;
    return gj ? { item, gj } : null;
  }))).filter(Boolean);

  if (!loaded.length) return null;

  const bbox  = mergeBboxes(loaded.map(({ gj }) => bboxFromGeoJSON(gj)));
  const color = (typeof group?.color === 'string' && !group.color.startsWith('fn:'))
    ? group.color : '#3a6f8f';

  const traces = loaded.map(({ item, gj }) => ({
    geojson: gj,
    color,
    dashed: group?.dashed === true && item.date_status !== 'effective',
  }));

  const markers = [];
  const push = (coord, type, city = null) => {
    if (!coord) return;
    const bold = type === 'départ' || type === 'arrivée';
    markers.push({ lng: coord[0], lat: coord[1], emoji: TRACE_MARKER_TYPES[type].emoji, color, city, bold });
  };

  if (mode === 'act') {
    const cityNames = loaded.map(({ item }) => extractCityNames(item.label));
    push(_firstCoord(loaded[0].gj), 'départ', cityNames[0]?.from ?? null);
    for (let i = 1; i < loaded.length; i++) {
      push(_firstCoord(loaded[i].gj), 'étape', cityNames[i]?.from ?? null);
    }
    push(_lastCoord(loaded[loaded.length - 1].gj), 'arrivée',
         cityNames[loaded.length - 1]?.to ?? null);
  } else {
    const { from, to } = extractCityNames(loaded[0].item.label);
    push(_firstCoord(loaded[0].gj), 'départ', from);
    push(_lastCoord(loaded[0].gj), 'arrivée', to);
  }

  const statsData = _computeStatsData(mode, group, loaded, color);
  return { traces, markers, bbox, statsData };
}

// ─── Application de la couleur principale ────────────────────────────────────

function _applyColor(data, color) {
  if (!color) return;
  for (const t of data.traces)  t.color = color;
  for (const m of data.markers) m.color = color;
  if (data.statsData) data.statsData.color = color;
}

// ─── Render orchestration ─────────────────────────────────────────────────────

async function renderToCanvas(canvas, { traces, markers, bbox, statsData, formatKey, basemapKey, options = {} }) {
  const fmt        = FORMATS[formatKey];
  const bm         = BASEMAPS[basemapKey] ?? BASEMAPS.osm;
  const fontFamily = options.font ?? 'Geist';

  canvas.width  = fmt.w;
  canvas.height = fmt.h;

  const { zoom, tileScale, zFloat, originWX, originWY } =
    computeRenderParams(bbox, fmt.w, fmt.h, 0.05, bm.maxZoom);
  const ctx = canvas.getContext('2d');

  await drawBasemap(ctx, fmt.w, fmt.h, zoom, tileScale, originWX, originWY, bm.tileUrl);
  await _ensureFontLoaded(fontFamily);

  const lineWidth    = Math.max(14, Math.round(fmt.w / 155));
  const tracesToDraw = options.showDashed === false ? traces.map((t) => ({ ...t, dashed: false })) : traces;
  drawTraces(ctx, tracesToDraw, zFloat, originWX, originWY, lineWidth);

  const markerFs = Math.max(80, Math.round(fmt.w / 25));
  drawMarkers(ctx, markers, zFloat, originWX, originWY, markerFs);

  if (options.cities) {
    const cityFs = Math.max(36, Math.round(fmt.w / 58));
    drawCityLabels(ctx, markers, zFloat, originWX, originWY, cityFs, fontFamily);
  }

  if (options.stats && statsData) {
    const filteredLines = statsData.lines.filter(
      (l) => !options.visibleStats?.size || options.visibleStats.has(l.icon)
    );
    const filteredStats = { ...statsData, lines: filteredLines };
    const hasContent    = filteredLines.length > 0 || (options.showTitle !== false && filteredStats.title);
    if (hasContent) {
      const statsFs   = Math.max(32, Math.round(fmt.w / 58));
      const statsMarg = Math.round(fmt.w / 30);
      drawStats(ctx, fmt.w, fmt.h, filteredStats, statsFs, statsMarg, options.showTitle !== false, fontFamily);
    }
  }

  if (options.position) {
    await drawCurrentPosition(ctx, zFloat, originWX, originWY, bbox, markerFs);
  }

  drawAttribution(ctx, fmt.w, fmt.h, bm.attribution);
}

// ─── Modal ────────────────────────────────────────────────────────────────────

let _overlay    = null;
let _groups     = null;
let _tracesData = null;
let _previewTimer = null;

function _close() {
  _overlay?.remove();
  _overlay = null;
  document.removeEventListener('keydown', _onKey);
  clearTimeout(_previewTimer);
}

function _onKey(e) { if (e.key === 'Escape') _close(); }

function _buildHTML(groups, tracesData) {
  const gItems = (groups.items ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const tItems = tracesData.items ?? [];

  const actOpts = gItems.map((g) => `<option value="${g.id}">${g.label}</option>`).join('');
  const stepOpts = gItems.map((g) => {
    const its = tItems.filter((it) => it.group === g.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!its.length) return '';
    return `<optgroup label="${g.label}">${its.map((it) => `<option value="${it.id}">${it.label}</option>`).join('')}</optgroup>`;
  }).join('');

  const swatches = COLOR_PALETTE.map((c, i) =>
    `<button class="lrz-export-swatch${i === 0 ? ' is-active' : ''}" data-color="${c.hex}" title="${c.label}" style="background:${c.hex}"></button>`
  ).join('');

  const themes = THEMES.map((t) =>
    `<button class="lrz-export-theme" data-theme="${t.key}">${t.label}</button>`
  ).join('');

  const fontBtns = FONT_MENU.map((f) =>
    `<button class="lrz-export-font-btn${f.family === 'Geist' ? ' is-active' : ''}" data-font="${f.family}" style="font-family:'${f.family}',sans-serif">${f.label}</button>`
  ).join('');

  const basemapBtns = Object.entries(BASEMAPS).map(([key, bm]) =>
    `<label class="lrz-export-bm-btn"><input type="radio" name="exp-bm" value="${key}"${key === 'osm' ? ' checked' : ''}><span>${bm.label}</span></label>`
  ).join('');

  return `<div class="lrz-export-overlay">
  <div class="lrz-export-modal" role="dialog" aria-modal="true" aria-label="Export de carte en image">
    <div class="lrz-export-modal__header">
      <span class="lrz-export-modal__title">Exporter en image</span>
      <button class="lrz-export-modal__close" aria-label="Fermer">✕</button>
    </div>
    <div class="lrz-export-modal__body">

      <div class="lrz-export-section">
        <div class="lrz-export-section__label">Quoi exporter</div>
        <div class="lrz-export-mode-row">
          <label class="lrz-export-mode-opt"><input type="radio" name="exp-mode" value="act" checked> Un acte</label>
          <label class="lrz-export-mode-opt"><input type="radio" name="exp-mode" value="step"> Une étape</label>
        </div>
        <select class="lrz-export-select" id="exp-act">${actOpts}</select>
        <select class="lrz-export-select" id="exp-step" hidden>${stepOpts}</select>
      </div>

      <div class="lrz-export-section">
        <div class="lrz-export-section__label">Thème</div>
        <div class="lrz-export-themes">${themes}</div>
      </div>

      <div class="lrz-export-section">
        <div class="lrz-export-section__label">Couleur</div>
        <div class="lrz-export-colors">${swatches}</div>
      </div>

      <div class="lrz-export-section">
        <div class="lrz-export-section__label">Police</div>
        <div class="lrz-export-fonts">${fontBtns}</div>
      </div>

      <div class="lrz-export-section">
        <div class="lrz-export-section__label">Format</div>
        <div class="lrz-export-formats">
          <button class="lrz-export-fmt is-active" data-fmt="square">
            <span class="lrz-export-fmt__thumb" style="aspect-ratio:1/1"></span>
            <span>Carré<br><small>1:1</small></span>
          </button>
          <button class="lrz-export-fmt" data-fmt="story">
            <span class="lrz-export-fmt__thumb" style="aspect-ratio:9/16"></span>
            <span>Story<br><small>9:16</small></span>
          </button>
          <button class="lrz-export-fmt" data-fmt="publish">
            <span class="lrz-export-fmt__thumb" style="aspect-ratio:4/5"></span>
            <span>Publication<br><small>4:5</small></span>
          </button>
        </div>
      </div>

      <div class="lrz-export-section">
        <div class="lrz-export-section__label">Fond de carte</div>
        <div class="lrz-export-bm-grid">${basemapBtns}</div>
      </div>

      <div class="lrz-export-section">
        <div class="lrz-export-section__label">Options</div>
        <div class="lrz-export-options">
          <label class="lrz-export-opt" id="exp-opt-upcoming-wrap">
            <input type="checkbox" id="exp-opt-upcoming" checked>
            <span class="lrz-export-opt__label">Montrer les étapes à venir</span>
          </label>
          <label class="lrz-export-opt">
            <input type="checkbox" id="exp-opt-cities">
            <span class="lrz-export-opt__label">Noms des villes</span>
          </label>
          <label class="lrz-export-opt">
            <input type="checkbox" id="exp-opt-stats">
            <span class="lrz-export-opt__label">Statistiques du parcours</span>
          </label>
          <label class="lrz-export-opt lrz-export-opt--sub is-disabled" id="exp-opt-title-wrap">
            <input type="checkbox" id="exp-opt-title" checked>
            <span class="lrz-export-opt__label">Afficher le titre</span>
          </label>
          <div id="exp-stat-lines"></div>
          <label class="lrz-export-opt">
            <input type="checkbox" id="exp-opt-position">
            <span class="lrz-export-opt__label">Ma position actuelle 🚲</span>
          </label>
        </div>
      </div>

      <div class="lrz-export-section">
        <div class="lrz-export-section__label">Aperçu</div>
        <div class="lrz-export-preview-wrap" id="exp-preview-wrap">
          <div class="lrz-export-preview-loading" id="exp-preview-loading">Calcul…</div>
          <canvas id="exp-preview-canvas" class="lrz-export-preview-canvas"></canvas>
        </div>
      </div>

    </div>
    <div class="lrz-export-modal__footer">
      <button class="lrz-export-generate" id="exp-generate">Générer et télécharger</button>
    </div>
  </div>
</div>`;
}

function _rebuildStatCheckboxes(mode) {
  const container = _overlay?.querySelector('#exp-stat-lines');
  if (!container) return;
  const defs = STAT_DEFS.filter((d) => d.mode === 'both' || d.mode === mode);
  container.innerHTML = defs.map((d) =>
    `<label class="lrz-export-opt lrz-export-opt--sub" id="exp-stat-${d.id}-wrap">
      <input type="checkbox" id="exp-stat-${d.id}" checked>
      <span class="lrz-export-opt__label">${d.label}</span>
    </label>`
  ).join('');
  container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', _schedulePreview);
  });
  _syncStatDisabled();
}

function _syncStatDisabled() {
  const statsOn = _overlay?.querySelector('#exp-opt-stats')?.checked ?? false;
  const titleWrap = _overlay?.querySelector('#exp-opt-title-wrap');
  if (titleWrap) {
    titleWrap.classList.toggle('is-disabled', !statsOn);
    const cb = titleWrap.querySelector('input');
    if (cb) cb.disabled = !statsOn;
  }
  const container = _overlay?.querySelector('#exp-stat-lines');
  if (!container) return;
  container.querySelectorAll('.lrz-export-opt--sub').forEach((el) => {
    el.classList.toggle('is-disabled', !statsOn);
    const cb = el.querySelector('input');
    if (cb) cb.disabled = !statsOn;
  });
}

function _syncStatAvailability(statsData) {
  const container = _overlay?.querySelector('#exp-stat-lines');
  if (!container || !statsData) return;
  const statsOn = _overlay?.querySelector('#exp-opt-stats')?.checked ?? true;
  if (!statsOn) return;
  const availableIcons = new Set(statsData.lines.map((l) => l.icon));
  STAT_DEFS.forEach((d) => {
    const wrap = container.querySelector(`#exp-stat-${d.id}-wrap`);
    const cb   = container.querySelector(`#exp-stat-${d.id}`);
    if (!wrap || !cb) return;
    const unavailable = !availableIcons.has(d.icon);
    wrap.classList.toggle('is-disabled', unavailable);
    if (unavailable) { cb.disabled = true; cb.checked = false; }
    else if (!cb.disabled) { cb.disabled = false; }
  });
}

function _syncUpcomingDisabled(data) {
  const wrap = _overlay?.querySelector('#exp-opt-upcoming-wrap');
  const cb   = _overlay?.querySelector('#exp-opt-upcoming');
  if (!wrap || !cb) return;
  const hasPlanned = data?.traces.some((t) => t.dashed) ?? false;
  wrap.classList.toggle('is-disabled', !hasPlanned);
  cb.disabled = !hasPlanned;
}

function _sel() {
  const m  = _overlay.querySelector('[name="exp-mode"]:checked')?.value ?? 'act';
  const id = m === 'act'
    ? _overlay.querySelector('#exp-act')?.value
    : _overlay.querySelector('#exp-step')?.value;
  const fmt      = _overlay.querySelector('.lrz-export-fmt.is-active')?.dataset.fmt ?? 'square';
  const bm       = _overlay.querySelector('[name="exp-bm"]:checked')?.value ?? 'osm';
  const color    = _overlay.querySelector('.lrz-export-swatch.is-active')?.dataset.color ?? COLOR_PALETTE[0].hex;
  const font     = _overlay.querySelector('.lrz-export-font-btn.is-active')?.dataset.font ?? 'Geist';
  const showDashed = _overlay.querySelector('#exp-opt-upcoming')?.checked ?? true;
  const cities    = _overlay.querySelector('#exp-opt-cities')?.checked ?? false;
  const stats     = _overlay.querySelector('#exp-opt-stats')?.checked  ?? false;
  const showTitle = stats && (_overlay.querySelector('#exp-opt-title')?.checked ?? true);
  const position  = _overlay.querySelector('#exp-opt-position')?.checked ?? false;
  const visibleStats = new Set(
    STAT_DEFS
      .filter((d) => { const cb = _overlay.querySelector(`#exp-stat-${d.id}`); return cb && !cb.disabled && cb.checked; })
      .map((d) => d.icon)
  );
  return { mode: m, selectedId: id, formatKey: fmt, basemapKey: bm,
           options: { cities, stats, showTitle, position, color, font, visibleStats, showDashed } };
}

async function _renderPreview() {
  if (!_overlay) return;
  const { mode, selectedId, formatKey, basemapKey, options } = _sel();

  const loadingEl = document.getElementById('exp-preview-loading');
  const cvs       = document.getElementById('exp-preview-canvas');
  if (loadingEl) loadingEl.hidden = false;
  if (cvs) cvs.style.opacity = '0.3';

  try {
    const data = await loadSelectionData(mode, selectedId, _groups, _tracesData);
    if (!data || !_overlay) return;

    _applyColor(data, options.color);
    _syncStatAvailability(data.statsData);
    _syncUpcomingDisabled(data);

    const fmt        = FORMATS[formatKey];
    const bm         = BASEMAPS[basemapKey] ?? BASEMAPS.osm;
    const fontFamily = options.font ?? 'Geist';
    const previewW   = 280;
    const previewH   = Math.round(previewW * fmt.h / fmt.w);

    const tmp = document.createElement('canvas');
    tmp.width  = previewW;
    tmp.height = previewH;

    const { zoom, tileScale, zFloat, originWX, originWY } =
      computeRenderParams(data.bbox, previewW, previewH, 0.05, bm.maxZoom);
    const ctx = tmp.getContext('2d');

    await drawBasemap(ctx, previewW, previewH, zoom, tileScale, originWX, originWY, bm.tileUrl);
    await _ensureFontLoaded(fontFamily);
    const previewTraces = options.showDashed === false ? data.traces.map((t) => ({ ...t, dashed: false })) : data.traces;
    drawTraces(ctx, previewTraces, zFloat, originWX, originWY, 2);
    drawMarkers(ctx, data.markers, zFloat, originWX, originWY, 20);
    if (options.cities) drawCityLabels(ctx, data.markers, zFloat, originWX, originWY, 15, fontFamily);
    if (options.stats && data.statsData) {
      const filteredLines = data.statsData.lines.filter(
        (l) => !options.visibleStats?.size || options.visibleStats.has(l.icon)
      );
      const filteredStats = { ...data.statsData, lines: filteredLines };
      const hasContent    = filteredLines.length > 0 || (options.showTitle && filteredStats.title);
      if (hasContent) {
        drawStats(ctx, previewW, previewH, filteredStats, 11, Math.round(previewW / 30), options.showTitle, fontFamily);
      }
    }
    if (options.position) await drawCurrentPosition(ctx, zFloat, originWX, originWY, data.bbox, 20);
    drawAttribution(ctx, previewW, previewH, bm.attribution);

    if (!_overlay) return;
    if (cvs) {
      cvs.width  = previewW;
      cvs.height = previewH;
      cvs.getContext('2d').drawImage(tmp, 0, 0);
      cvs.style.opacity = '1';
    }
  } catch (err) {
    console.error('[map-export] preview', err);
    if (cvs) cvs.style.opacity = '0.5';
  } finally {
    if (loadingEl) loadingEl.hidden = true;
  }
}

function _schedulePreview() {
  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(_renderPreview, 350);
}

async function _generate() {
  const btn = document.getElementById('exp-generate');
  if (!btn) return;
  btn.disabled    = true;
  btn.textContent = 'Génération…';

  try {
    const { mode, selectedId, formatKey, basemapKey, options } = _sel();
    const data = await loadSelectionData(mode, selectedId, _groups, _tracesData);
    if (!data) throw new Error('no data');

    _applyColor(data, options.color);

    const fmt = FORMATS[formatKey];
    const cvs = document.createElement('canvas');
    cvs.width = fmt.w; cvs.height = fmt.h;

    await renderToCanvas(cvs, { ...data, formatKey, basemapKey, options });

    const blob = await new Promise((res, rej) =>
      cvs.toBlob((b) => b ? res(b) : rej(new Error('toBlob failed')), 'image/jpeg', 0.92)
    );
    const slug = (selectedId ?? 'export').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `loire-ride-zen_${slug}_${formatKey}.jpg` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    btn.textContent = 'Téléchargé ✓';
    setTimeout(() => { if (btn) btn.textContent = 'Générer et télécharger'; }, 3000);
  } catch (err) {
    console.error('[map-export]', err);
    btn.textContent = 'Erreur — réessayer';
    setTimeout(() => { if (btn) btn.textContent = 'Générer et télécharger'; }, 3000);
  }
  if (btn) btn.disabled = false;
}

export async function openExportModal() {
  if (_overlay) { _close(); return; }

  if (!_groups || !_tracesData) {
    [_groups, _tracesData] = await Promise.all([
      fetch('data/catalog/groups.json').then((r) => r.json()),
      fetch('data/catalog/traces.json').then((r) => r.json()),
    ]);
  }

  const wrap = document.createElement('div');
  wrap.innerHTML = _buildHTML(_groups, _tracesData);
  _overlay = wrap.firstElementChild;
  document.body.appendChild(_overlay);
  document.addEventListener('keydown', _onKey);

  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _close(); });
  _overlay.querySelector('.lrz-export-modal__close').addEventListener('click', _close);

  // Mode acte / étape
  _overlay.querySelectorAll('[name="exp-mode"]').forEach((r) => {
    r.addEventListener('change', () => {
      const isStep = r.value === 'step';
      _overlay.querySelector('#exp-act').hidden  = isStep;
      _overlay.querySelector('#exp-step').hidden = !isStep;
      _rebuildStatCheckboxes(r.value);
      _schedulePreview();
    });
  });
  _overlay.querySelector('#exp-act').addEventListener('change', _schedulePreview);
  _overlay.querySelector('#exp-step').addEventListener('change', _schedulePreview);

  // Format
  _overlay.querySelectorAll('.lrz-export-fmt').forEach((btn) => {
    btn.addEventListener('click', () => {
      _overlay.querySelectorAll('.lrz-export-fmt').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _schedulePreview();
    });
  });

  // Fond de carte
  _overlay.querySelectorAll('[name="exp-bm"]').forEach((r) => {
    r.addEventListener('change', () => {
      // Désactiver le thème si fond modifié manuellement
      _overlay.querySelectorAll('.lrz-export-theme').forEach((b) => {
        const t = THEMES.find((x) => x.key === b.dataset.theme);
        if (t && t.basemap !== r.value) b.classList.remove('is-active');
      });
      _schedulePreview();
    });
  });

  // Swatches couleur
  _overlay.querySelectorAll('.lrz-export-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      _overlay.querySelectorAll('.lrz-export-swatch').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      // Désactiver thème si couleur modifiée manuellement
      _overlay.querySelectorAll('.lrz-export-theme').forEach((b) => {
        const t = THEMES.find((x) => x.key === b.dataset.theme);
        if (t && t.color !== btn.dataset.color) b.classList.remove('is-active');
      });
      _schedulePreview();
    });
  });

  // Thèmes — applique fond + couleur + police d'un clic
  _overlay.querySelectorAll('.lrz-export-theme').forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = THEMES.find((t) => t.key === btn.dataset.theme);
      if (!theme) return;
      // Fond
      const bmRadio = _overlay.querySelector(`[name="exp-bm"][value="${theme.basemap}"]`);
      if (bmRadio) bmRadio.checked = true;
      // Couleur
      _overlay.querySelectorAll('.lrz-export-swatch').forEach((s) => s.classList.remove('is-active'));
      _overlay.querySelector(`.lrz-export-swatch[data-color="${theme.color}"]`)?.classList.add('is-active');
      // Police
      _overlay.querySelectorAll('.lrz-export-font-btn').forEach((b) => b.classList.remove('is-active'));
      _overlay.querySelector(`.lrz-export-font-btn[data-font="${theme.font}"]`)?.classList.add('is-active');
      // Thème actif
      _overlay.querySelectorAll('.lrz-export-theme').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _schedulePreview();
    });
  });

  // Polices — override thème si changement manuel
  _overlay.querySelectorAll('.lrz-export-font-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      _overlay.querySelectorAll('.lrz-export-font-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _overlay.querySelectorAll('.lrz-export-theme').forEach((b) => {
        const t = THEMES.find((x) => x.key === b.dataset.theme);
        if (t && t.font !== btn.dataset.font) b.classList.remove('is-active');
      });
      _schedulePreview();
    });
  });

  // Options checkboxes
  _overlay.querySelectorAll('.lrz-export-opt input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', _schedulePreview);
  });

  // Étapes à venir
  _overlay.querySelector('#exp-opt-upcoming')?.addEventListener('change', _schedulePreview);

  // Stats — case maître : active/désactive titre + lignes
  _overlay.querySelector('#exp-opt-stats')?.addEventListener('change', () => {
    _syncStatDisabled();
    _schedulePreview();
  });

  // Init des cases par stat (mode acte par défaut)
  _rebuildStatCheckboxes('act');

  document.getElementById('exp-generate').addEventListener('click', _generate);

  _renderPreview();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initExportButton() {
  if (!new URLSearchParams(location.search).has('admin')) return;

  const panel = document.getElementById('lrz-actions-panel');
  if (!panel) return;

  const grp = document.createElement('div');
  grp.className = 'lrz-actions-panel__group';
  grp.innerHTML = '<button class="lrz-apanel-btn" title="Exporter en image" aria-label="Exporter en image">📷</button>';
  panel.appendChild(grp);

  grp.querySelector('button').addEventListener('click', openExportModal);
}

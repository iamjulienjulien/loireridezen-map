/**
 * app/map-export.js — Export de carte en image (LRZ-EVO-41 / LRZ-EVO-42)
 *
 * Approche canvas slippy-map :
 *   1. Tuiles XYZ (OSM ou Esri) crossOrigin='anonymous'
 *   2. Polylignes GeoJSON → pixels, avec halo blanc sous le trait coloré
 *   3. Marqueurs drapeau Départ/Étape/Arrivée (emoji + ctx.filter hue-rotate)
 *   4. Options : noms de villes, encadré stats, voile fond, position actuelle, cadre carnet
 *   5. Attribution cartographique (bas-gauche, obligatoire)
 *   6. canvas.toBlob() → JPEG 0.92 → téléchargement
 *
 * Visible uniquement avec ?admin dans l'URL.
 */

import { TRACE_MARKER_TYPES } from './types.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TILE_SIZE = 256;

const FORMATS = {
  square:  { label: 'Carré',       ratio: '1:1',  w: 2160, h: 2160 },
  story:   { label: 'Story',       ratio: '9:16', w: 2160, h: 3840 },
  publish: { label: 'Publication', ratio: '4:5',  w: 2160, h: 2700 },
};

const BASEMAPS = {
  osm: {
    label: 'Plan',
    tileUrl: (z, x, y) => `https://${'abc'[(x + y + z) % 3]}.tile.openstreetmap.org/${z}/${x}/${y}.png`,
    attribution: '© OpenStreetMap contributors',
  },
  sat: {
    label: 'Satellite',
    tileUrl: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: '© Esri & sources',
  },
};

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

function computeRenderParams(bbox, canvasW, canvasH, padding = 0.05) {
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

  // Zoom fractionnaire exact → tuiles au floor, pixels/traces au float
  const zFloat    = Math.min(Math.min(zFromW, zFromH), 18);
  const zoom      = Math.floor(zFloat);
  const tileScale = Math.pow(2, zFloat - zoom);

  const scalePx = Math.pow(2, zFloat) * TILE_SIZE;
  return {
    zoom,
    tileScale,
    zFloat,
    originWX: centerWX - canvasW / (2 * scalePx),
    originWY: centerWY - canvasH / (2 * scalePx),
  };
}

// ─── Tile loading ─────────────────────────────────────────────────────────────

const _tileCache = new Map();

function loadTile(url) {
  if (_tileCache.has(url)) return _tileCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
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

// ─── Helpers données ──────────────────────────────────────────────────────────

/**
 * Extrait les noms de villes depuis un label de trace.
 * "Étape 3 Tours ➡️ Saumur" → { from: "Tours", to: "Saumur" }
 * "Étape 6 Paimboeuf ➡️ 🐍 Serpent d'Océan → Tharon-Plage" → { from: "Paimboeuf", to: "Tharon-Plage" }
 */
function extractCityNames(label) {
  const arrowEmoji = '➡️';
  const idx = label.indexOf(arrowEmoji);
  if (idx < 0) return { from: label.trim(), to: null };

  const fromPart = label.slice(0, idx)
    .replace(/^[^\d]*\d+\s+/, '') // retire "Étape N "
    .trim();

  const toPart = label.slice(idx + arrowEmoji.length);
  const secArrow = toPart.lastIndexOf('→');
  const toRaw = secArrow >= 0 ? toPart.slice(secArrow + 1) : toPart;
  const to = toRaw.replace(/^[^A-Za-zÀ-ÿ]+/, '').trim();

  return { from: fromPart, to };
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

function _computeStatsData(mode, group, loaded) {
  if (mode === 'act') {
    const n = loaded.length;
    const hasDist = loaded.some(({ item }) => item.distance_km != null);
    const hasElev = loaded.some(({ item }) => item.elevation_gain_m != null);
    const totalDist = loaded.reduce((s, { item }) => s + (item.distance_km ?? 0), 0);
    const totalElev = loaded.reduce((s, { item }) => s + (item.elevation_gain_m ?? 0), 0);
    const allDates  = loaded.map(({ item }) => item.date).filter(Boolean);

    const lines = [`🚴 ${n} étape${n > 1 ? 's' : ''}`];
    if (hasDist) lines.push(`📏 ${_fmtNum(totalDist)} km`);
    if (hasElev) lines.push(`⛰ ${_fmtNum(totalElev)} m de dénivelé`);
    const period = _formatPeriodFR(allDates);
    if (period) lines.push(`🗓 ${period}`);
    return { title: group?.label ?? '', lines };
  } else {
    const item = loaded[0].item;
    const lines = [];
    if (item.distance_km != null) lines.push(`📏 ${(+item.distance_km).toLocaleString('fr-FR')} km`);
    if (item.elevation_gain_m != null) lines.push(`⛰ ${_fmtNum(item.elevation_gain_m)} m de dénivelé`);
    if (item.duration_h != null) lines.push(`🕒 ${_formatDurationFR(item.duration_h)}`);
    if (item.date) lines.push(`🗓 ${_formatDateFR(item.date)}`);
    return { title: item.label ?? '', lines };
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
  const tiles = await Promise.all(jobs);

  ctx.fillStyle = '#ddd';
  ctx.fillRect(0, 0, canvasW, canvasH);

  for (const { img, tx, ty } of tiles) {
    if (!img) continue;
    const px = (tx - originWX * scale) * tileDisplaySize;
    const py = (ty - originWY * scale) * tileDisplaySize;
    ctx.drawImage(img, Math.round(px), Math.round(py), Math.ceil(tileDisplaySize), Math.ceil(tileDisplaySize));
  }
}

function drawVeil(ctx, canvasW, canvasH) {
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(0, 0, canvasW, canvasH);
}

function drawTraces(ctx, traces, zFloat, originWX, originWY, lineWidth) {
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  const haloWidth = lineWidth + Math.round(lineWidth * 0.7);

  // Passe 1 — halo blanc sous toutes les traces
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

  // Passe 2 — trait coloré par-dessus
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

    // Pastille blanche de fond
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur  = Math.round(fontSize * 0.25);
    ctx.beginPath();
    ctx.arc(x, y, fontSize * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    const rotate = ((hexToHueDeg(color) - 38) + 360) % 360;
    ctx.filter = `sepia(1) saturate(2) hue-rotate(${rotate}deg)`;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillText(emoji, x, y);
  }
  ctx.filter = 'none';
}

function drawCityLabels(ctx, markers, zFloat, originWX, originWY, fontSize) {
  const pad  = Math.round(fontSize * 0.4);
  const r    = Math.round(fontSize * 0.3);

  ctx.font      = `${fontSize}px sans-serif`;
  ctx.textAlign = 'left';

  for (const { lng, lat, city } of markers) {
    if (!city) continue;
    const { x, y } = lngLatToPixel(lng, lat, zFloat, originWX, originWY);

    const tw  = ctx.measureText(city).width;
    const bw  = tw + pad * 2;
    const bh  = fontSize + pad;
    const bx  = x + Math.round(fontSize * 0.7);
    const by  = y - bh / 2;

    // Pastille fond blanc semi-opaque
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.shadowColor = 'rgba(0,0,0,0.12)';
    ctx.shadowBlur  = Math.round(fontSize * 0.2);
    roundRect(ctx, bx, by, bw, bh, r);
    ctx.fill();
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';

    ctx.fillStyle    = '#222';
    ctx.textBaseline = 'middle';
    ctx.fillText(city, bx + pad, y);
  }
}

function drawStats(ctx, canvasW, canvasH, statsData, fontSize) {
  const { title, lines } = statsData;
  if (!title && !lines.length) return;

  const titleFs = Math.round(fontSize * 1.25);
  const lineH   = Math.round(fontSize * 1.65);
  const pad     = Math.round(fontSize * 0.85);
  const r       = Math.round(fontSize * 0.4);

  ctx.font = `bold ${titleFs}px sans-serif`;
  const titleW = ctx.measureText(title).width;
  ctx.font = `${fontSize}px sans-serif`;
  const maxLineW = lines.length
    ? Math.max(...lines.map((l) => ctx.measureText(l).width))
    : 0;

  const boxW = Math.max(titleW, maxLineW) + pad * 2;
  const divH = Math.round(fontSize * 0.5);
  const boxH = pad + titleFs + divH + lines.length * lineH + pad;

  const margin = Math.round(fontSize * 0.6);
  const bx = canvasW - boxW - margin;
  const by = canvasH - boxH - margin;

  // Fond
  ctx.shadowColor   = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur    = Math.round(fontSize * 0.6);
  ctx.shadowOffsetY = Math.round(fontSize * 0.15);
  ctx.fillStyle     = 'rgba(252,250,245,0.93)';
  roundRect(ctx, bx, by, boxW, boxH, r);
  ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.shadowColor = 'transparent';

  // Titre
  ctx.fillStyle    = '#2a2a2a';
  ctx.font         = `bold ${titleFs}px sans-serif`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(title, bx + pad, by + pad);

  // Séparateur
  const divY = by + pad + titleFs + Math.round(divH * 0.3);
  ctx.strokeStyle = '#d8d3c8';
  ctx.lineWidth   = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(bx + pad, divY);
  ctx.lineTo(bx + boxW - pad, divY);
  ctx.stroke();

  // Lignes stats
  ctx.font      = `${fontSize}px sans-serif`;
  ctx.fillStyle = '#333';
  let curY = divY + Math.round(divH * 0.7);
  for (const line of lines) {
    ctx.fillText(line, bx + pad, curY);
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
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur  = Math.round(fontSize * 0.25);
    ctx.beginPath();
    ctx.arc(x, y, fontSize * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    ctx.filter = 'none';
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🚲', x, y);
  } catch { /* position non disponible */ }
}

function drawAttribution(ctx, canvasW, canvasH, text) {
  const fs  = Math.max(20, Math.round(canvasW / 90));
  const pad = Math.round(fs * 0.5);
  ctx.font      = `${fs}px sans-serif`;
  const textW   = ctx.measureText(text).width;
  const boxW    = textW + pad * 2;
  const boxH    = fs + pad * 2;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillRect(6, canvasH - boxH - 6, boxW, boxH);
  ctx.fillStyle    = '#333';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, 6 + pad, canvasH - pad - 6);
}

function drawFrame(ctx, canvasW, canvasH) {
  const m = Math.round(canvasW * 0.03);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, m);
  ctx.fillRect(0, canvasH - m, canvasW, m);
  ctx.fillRect(0, m, m, canvasH - 2 * m);
  ctx.fillRect(canvasW - m, m, m, canvasH - 2 * m);
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
    if (item) {
      items = [item];
      group = allGroups.find((g) => g.id === item.group);
    }
  }
  if (!items.length) return null;

  const loaded = (await Promise.all(items.map(async (item) => {
    const url = item.paths?.simplified ?? item.paths?.full;
    const gj  = url ? await fetchGeoJSON(url) : null;
    return gj ? { item, gj } : null;
  }))).filter(Boolean);

  if (!loaded.length) return null;

  const bbox = mergeBboxes(loaded.map(({ gj }) => bboxFromGeoJSON(gj)));

  const color = (typeof group?.color === 'string' && !group.color.startsWith('fn:'))
    ? group.color : '#2e6a8f';

  const traces = loaded.map(({ item, gj }) => ({
    geojson: gj,
    color,
    dashed: group?.dashed === true && item.date_status !== 'effective',
  }));

  const markers = [];
  const push = (coord, type, city = null) => {
    if (!coord) return;
    markers.push({ lng: coord[0], lat: coord[1], emoji: TRACE_MARKER_TYPES[type].emoji, color, city });
  };

  if (mode === 'act') {
    const cityNames = loaded.map(({ item }) => extractCityNames(item.label));
    push(_firstCoord(loaded[0].gj), 'départ', cityNames[0]?.from ?? null);
    for (let i = 1; i < loaded.length - 1; i++) {
      push(_firstCoord(loaded[i].gj), 'étape', cityNames[i]?.from ?? null);
    }
    if (loaded.length > 1) {
      push(_lastCoord(loaded[loaded.length - 1].gj), 'arrivée', cityNames[loaded.length - 1]?.to ?? null);
    } else {
      push(_lastCoord(loaded[0].gj), 'arrivée', cityNames[0]?.to ?? null);
    }
  } else {
    const { from, to } = extractCityNames(loaded[0].item.label);
    push(_firstCoord(loaded[0].gj), 'départ', from);
    push(_lastCoord(loaded[0].gj), 'arrivée', to);
  }

  const statsData = _computeStatsData(mode, group, loaded);

  return { traces, markers, bbox, statsData };
}

// ─── Render orchestration ─────────────────────────────────────────────────────

async function renderToCanvas(canvas, { traces, markers, bbox, statsData, formatKey, basemapKey, options = {} }) {
  const fmt = FORMATS[formatKey];
  const bm  = BASEMAPS[basemapKey];

  canvas.width  = fmt.w;
  canvas.height = fmt.h;

  const { zoom, tileScale, zFloat, originWX, originWY } = computeRenderParams(bbox, fmt.w, fmt.h);
  const ctx = canvas.getContext('2d');

  // Ordre de dessin : fond → voile → traces (halo+couleur) → marqueurs →
  //   noms villes → stats → position → attribution → cadre
  await drawBasemap(ctx, fmt.w, fmt.h, zoom, tileScale, originWX, originWY, bm.tileUrl);

  if (options.veil) drawVeil(ctx, fmt.w, fmt.h);

  const lineWidth = Math.max(14, Math.round(fmt.w / 155));
  drawTraces(ctx, traces, zFloat, originWX, originWY, lineWidth);

  const markerFs = Math.max(80, Math.round(fmt.w / 25));
  drawMarkers(ctx, markers, zFloat, originWX, originWY, markerFs);

  if (options.cities) {
    const cityFs = Math.max(28, Math.round(fmt.w / 78));
    drawCityLabels(ctx, markers, zFloat, originWX, originWY, cityFs);
  }

  if (options.stats && statsData) {
    const statsFs = Math.max(32, Math.round(fmt.w / 58));
    drawStats(ctx, fmt.w, fmt.h, statsData, statsFs);
  }

  if (options.position) {
    await drawCurrentPosition(ctx, zFloat, originWX, originWY, bbox, markerFs);
  }

  drawAttribution(ctx, fmt.w, fmt.h, bm.attribution);

  if (options.frame) drawFrame(ctx, fmt.w, fmt.h);
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
        <div class="lrz-export-basemap-row">
          <label class="lrz-export-mode-opt"><input type="radio" name="exp-bm" value="osm" checked> Plan</label>
          <label class="lrz-export-mode-opt"><input type="radio" name="exp-bm" value="sat"> Satellite</label>
        </div>
      </div>

      <div class="lrz-export-section">
        <div class="lrz-export-section__label">Options</div>
        <div class="lrz-export-options">
          <label class="lrz-export-opt">
            <input type="checkbox" id="exp-opt-cities">
            <span class="lrz-export-opt__label">Noms des villes</span>
          </label>
          <label class="lrz-export-opt">
            <input type="checkbox" id="exp-opt-stats">
            <span class="lrz-export-opt__label">Statistiques du parcours</span>
          </label>
          <label class="lrz-export-opt">
            <input type="checkbox" id="exp-opt-veil">
            <span class="lrz-export-opt__label">Atténuer le fond</span>
          </label>
          <label class="lrz-export-opt">
            <input type="checkbox" id="exp-opt-position">
            <span class="lrz-export-opt__label">Ma position actuelle 🚲</span>
          </label>
          <label class="lrz-export-opt">
            <input type="checkbox" id="exp-opt-frame">
            <span class="lrz-export-opt__label">Cadre carnet</span>
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

function _sel() {
  const m  = _overlay.querySelector('[name="exp-mode"]:checked')?.value ?? 'act';
  const id = m === 'act'
    ? _overlay.querySelector('#exp-act')?.value
    : _overlay.querySelector('#exp-step')?.value;
  const fmt      = _overlay.querySelector('.lrz-export-fmt.is-active')?.dataset.fmt ?? 'square';
  const bm       = _overlay.querySelector('[name="exp-bm"]:checked')?.value ?? 'osm';
  const cities   = _overlay.querySelector('#exp-opt-cities')?.checked   ?? false;
  const stats    = _overlay.querySelector('#exp-opt-stats')?.checked    ?? false;
  const veil     = _overlay.querySelector('#exp-opt-veil')?.checked     ?? false;
  const position = _overlay.querySelector('#exp-opt-position')?.checked ?? false;
  const frame    = _overlay.querySelector('#exp-opt-frame')?.checked    ?? false;
  return { mode: m, selectedId: id, formatKey: fmt, basemapKey: bm, options: { cities, stats, veil, position, frame } };
}

async function _renderPreview() {
  if (!_overlay) return;
  const { mode, selectedId, formatKey, basemapKey, options } = _sel();

  const loadingEl = document.getElementById('exp-preview-loading');
  const cvs       = document.getElementById('exp-preview-canvas');
  if (loadingEl) loadingEl.hidden = false;
  if (cvs) cvs.style.opacity = '0.3';

  const data = await loadSelectionData(mode, selectedId, _groups, _tracesData);
  if (!data || !_overlay) return;

  const fmt      = FORMATS[formatKey];
  const previewW = 280;
  const previewH = Math.round(previewW * fmt.h / fmt.w);

  const tmp = document.createElement('canvas');
  tmp.width  = previewW;
  tmp.height = previewH;

  const { zoom, tileScale, zFloat, originWX, originWY } = computeRenderParams(data.bbox, previewW, previewH);
  const ctx = tmp.getContext('2d');
  const bm  = BASEMAPS[basemapKey];

  await drawBasemap(ctx, previewW, previewH, zoom, tileScale, originWX, originWY, bm.tileUrl);
  if (options.veil) drawVeil(ctx, previewW, previewH);
  drawTraces(ctx, data.traces, zFloat, originWX, originWY, 2);
  drawMarkers(ctx, data.markers, zFloat, originWX, originWY, 20);
  if (options.cities)  drawCityLabels(ctx, data.markers, zFloat, originWX, originWY, 11);
  if (options.stats && data.statsData) drawStats(ctx, previewW, previewH, data.statsData, 11);
  if (options.position) await drawCurrentPosition(ctx, zFloat, originWX, originWY, data.bbox, 20);
  drawAttribution(ctx, previewW, previewH, bm.attribution);
  if (options.frame) drawFrame(ctx, previewW, previewH);

  if (!_overlay) return;
  if (cvs) {
    cvs.width  = previewW;
    cvs.height = previewH;
    cvs.getContext('2d').drawImage(tmp, 0, 0);
    cvs.style.opacity = '1';
  }
  if (loadingEl) loadingEl.hidden = true;
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

    const fmt = FORMATS[formatKey];
    const cvs = document.createElement('canvas');
    cvs.width  = fmt.w;
    cvs.height = fmt.h;

    await renderToCanvas(cvs, { ...data, formatKey, basemapKey, options });

    const blob = await new Promise((res, rej) =>
      cvs.toBlob((b) => b ? res(b) : rej(new Error('toBlob failed')), 'image/jpeg', 0.92)
    );
    const slug = (selectedId ?? 'export').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `loire-ride-zen_${slug}_${formatKey}.jpg` });
    a.click();
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

  _overlay.querySelectorAll('[name="exp-mode"]').forEach((r) => {
    r.addEventListener('change', () => {
      const isStep = r.value === 'step';
      _overlay.querySelector('#exp-act').hidden  = isStep;
      _overlay.querySelector('#exp-step').hidden = !isStep;
      _schedulePreview();
    });
  });

  _overlay.querySelector('#exp-act').addEventListener('change', _schedulePreview);
  _overlay.querySelector('#exp-step').addEventListener('change', _schedulePreview);

  _overlay.querySelectorAll('.lrz-export-fmt').forEach((btn) => {
    btn.addEventListener('click', () => {
      _overlay.querySelectorAll('.lrz-export-fmt').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _schedulePreview();
    });
  });

  _overlay.querySelectorAll('[name="exp-bm"]').forEach((r) => {
    r.addEventListener('change', _schedulePreview);
  });

  _overlay.querySelectorAll('.lrz-export-opt input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', _schedulePreview);
  });

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

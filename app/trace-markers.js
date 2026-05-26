/**
 * app/trace-markers.js — Markers Départ / Étape / Arrivée calculés depuis les traces
 *
 * Les markers sont ajoutés au même LayerGroup que la trace parente :
 * toggler une trace masque/affiche aussi ses markers.
 */

import { DivIcon, Marker } from "leaflet";
import { TRACE_MARKER_TYPES } from "./types.js";
import { escapeHtml } from "./helpers.js";
import { hiddenModes } from "./url-mode.js";
import { farthestPointFromStart } from "./geo-utils.js";

function hexToHueDeg(hex) {
  if (!hex || hex[0] !== "#") return 0;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return 0;
  let h =
    max === r
      ? ((g - b) / d) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  h = Math.round(h * 60);
  return h < 0 ? h + 360 : h;
}

function emojiIcon(type, color) {
  const cfg = TRACE_MARKER_TYPES[type];
  const filterStyle =
    color && typeof color === "string" && color[0] === "#"
      ? ` style="filter:sepia(1) saturate(2) hue-rotate(${(hexToHueDeg(color) - 38 + 360) % 360}deg)"`
      : "";
  return new DivIcon({
    html: `<span class="lrz-trace-emoji lrz-trace-emoji--${type}"${filterStyle}>${cfg.emoji}</span>`,
    className: "",
    iconSize: [cfg.size, cfg.size],
    iconAnchor: [cfg.size / 2, cfg.size / 2],
  });
}

function firstCoord(geojson) {
  const f = geojson.features?.[0];
  return f ? f.geometry.coordinates[0] : null;
}

function lastCoord(geojson) {
  const features = geojson.features ?? [];
  const f = features[features.length - 1];
  if (!f) return null;
  const c = f.geometry.coordinates;
  return c[c.length - 1];
}

function _flatCoords(geojson) {
  const out = [];
  for (const f of geojson.features ?? [geojson]) {
    for (const c of f.geometry?.coordinates ?? []) out.push(c);
  }
  return out;
}

async function safeFetch(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * Construit les markers de trace et les ajoute au FeatureGroup de leur trace parente.
 * @param {object} groupsCatalog
 * @param {object} tracesCatalog
 * @param {Map<string, import("leaflet").FeatureGroup>} featureGroups — Map<groupId, FeatureGroup> issue de wireTraceCheckboxes
 */
export async function buildTraceMarkersFromCatalog(
  groupsCatalog,
  tracesCatalog,
  featureGroups,
) {
  if (hiddenModes.rabbit) return;

  for (const group of groupsCatalog.items ?? []) {
    const fg = featureGroups.get(group.id);
    if (!fg) continue;

    const items = (tracesCatalog.items ?? [])
      .filter((it) => it.group === group.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!items.length) continue;

    if (group.unified) {
      const data = await safeFetch(items[0].paths.full);
      if (!data) continue;
      const start = firstCoord(data);
      const end = lastCoord(data);
      if (start) {
        const m = new Marker([start[1], start[0]], {
          icon: emojiIcon("départ", group.color),
        });
        m.bindPopup(`<strong>Départ</strong><br/>${escapeHtml(group.label)}`);
        fg.addLayer(m);
      }
      if (end) {
        const m = new Marker([end[1], end[0]], {
          icon: emojiIcon("arrivée", group.color),
        });
        m.bindPopup(`<strong>Arrivée</strong><br/>${escapeHtml(group.label)}`);
        fg.addLayer(m);
      }
    } else {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const url = item.paths.simplified ?? item.paths.full;
        const data = await safeFetch(url);
        if (!data) continue;

        if (item.is_loop) {
          if (i === 0) {
            const start = firstCoord(data);
            if (start) {
              const m = new Marker([start[1], start[0]], {
                icon: emojiIcon("départ", group.color),
              });
              m.bindPopup(
                `<strong>${TRACE_MARKER_TYPES["départ"].label}</strong><br/>${escapeHtml(item.label)}`,
              );
              fg.addLayer(m);
            }
          }
          const far = farthestPointFromStart(_flatCoords(data));
          if (far) {
            const m = new Marker([far.lat, far.lng], {
              icon: emojiIcon("étape", group.color),
            });
            m.bindPopup(
              `<strong>${TRACE_MARKER_TYPES["étape"].label}</strong><br/>${escapeHtml(item.label)}`,
            );
            fg.addLayer(m);
          }
        } else {
          const start = firstCoord(data);
          if (!start) continue;
          const type = i === 0 ? "départ" : "étape";
          const m = new Marker([start[1], start[0]], {
            icon: emojiIcon(type, group.color),
          });
          m.bindPopup(
            `<strong>${TRACE_MARKER_TYPES[type].label}</strong><br/>${escapeHtml(item.label)}`,
          );
          fg.addLayer(m);
        }
      }
      const lastItem = items[items.length - 1];
      if (!lastItem.is_loop) {
        const url = lastItem.paths.simplified ?? lastItem.paths.full;
        const data = await safeFetch(url);
        if (data) {
          const end = lastCoord(data);
          if (end) {
            const m = new Marker([end[1], end[0]], {
              icon: emojiIcon("arrivée", group.color),
            });
            m.bindPopup(
              `<strong>Arrivée</strong><br/>${escapeHtml(group.label)}`,
            );
            fg.addLayer(m);
          }
        }
      }
    }
  }
}

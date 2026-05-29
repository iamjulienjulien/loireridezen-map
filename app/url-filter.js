/**
 * app/url-filter.js — Paramètres d'URL ?acte= et ?etape= pour focus au chargement
 * (LRZ-EVO-51)
 *
 * parseUrlFilter(traceItems, groups) → filtre | null
 * applyUrlFilter(filter, traceFeatureGroups) → void
 * initFocusBanner(filter, groups, traces, traceFeatureGroups) → void
 */

import { map } from './map.js';
import { isForElle } from './url-mode.js';
import { loadPreferences } from './preferences.js';
import { track } from './analytics.js';
import { getStepLayer, openStepPopup } from './routes.js';
import { escapeHtml } from './helpers.js';

// Format court ?acte=X → ID interne
const ACTE_SHORT = {
  '1': 'acte-1',
  '2': 'acte-2',
  '3': 'acte-3',
  'micro': 'micro-aventure',
};

let _activeFocusLayer = null;
let _focusActive = false;
let _unwatch = null;

// ─────────────────────────────── Parsing

function _resolveEtapeId(raw, traceItems) {
  // Format court : X.Y → acte-X_etape-Y[_...]
  const short = /^(\d+)\.(\d+)$/.exec(raw);
  if (short) {
    const acteId = ACTE_SHORT[short[1]];
    if (!acteId) return null;
    const prefix = `${acteId}_etape-${short[2]}`;
    const item = traceItems.find(it => it.group === acteId && it.id.startsWith(prefix));
    return item ? { etapeId: item.id, acteId, value: raw } : null;
  }
  // Fallback : ID interne complet
  const item = traceItems.find(it => it.id === raw);
  return item ? { etapeId: item.id, acteId: item.group, value: raw } : null;
}

function _resolveActeId(raw, groups) {
  const acteId = ACTE_SHORT[raw] ?? (groups.find(g => g.id === raw) ? raw : null);
  return acteId ? { acteId, value: raw } : null;
}

/**
 * Lit ?acte= / ?etape= depuis l'URL et retourne un objet filtre validé,
 * ou null si aucun paramètre valide ou si ?for=elle est actif.
 */
export function parseUrlFilter(traceItems, groups) {
  if (isForElle()) return null;
  const params = new URLSearchParams(window.location.search);

  // ?etape= prime sur ?acte=
  const etapeRaw = params.get('etape');
  if (etapeRaw) {
    const r = _resolveEtapeId(etapeRaw, traceItems);
    if (r) return { type: 'etape', ...r };
  }

  const acteRaw = params.get('acte');
  if (acteRaw) {
    const r = _resolveActeId(acteRaw, groups);
    if (r) return { type: 'acte', ...r };
  }

  return null;
}

// ─────────────────────────────── Sortie du mode focus

function _cleanUrl() {
  const url = new URL(location.href);
  url.searchParams.delete('acte');
  url.searchParams.delete('etape');
  return url.toString();
}

function _exitFocus(traceFeatureGroups, restorePrefs) {
  _focusActive = false;
  if (_unwatch) { _unwatch(); _unwatch = null; }

  // Retirer la couche d'étape ajoutée directement à la carte
  if (_activeFocusLayer) {
    if (map.hasLayer(_activeFocusLayer)) map.removeLayer(_activeFocusLayer);
    _activeFocusLayer = null;
  }

  if (restorePrefs) {
    const prefs = loadPreferences();
    for (const [groupId, fg] of traceFeatureGroups) {
      const shouldShow = prefs.traces?.[groupId] ?? true;
      const cb = document.querySelector(`[data-group-id="${groupId}"]`);
      if (cb) cb.checked = shouldShow;
      if (shouldShow && !map.hasLayer(fg)) map.addLayer(fg);
      else if (!shouldShow && map.hasLayer(fg)) map.removeLayer(fg);
    }
  }

  history.replaceState(null, '', _cleanUrl());
  const banner = document.getElementById('lrz-focus-banner');
  if (banner) banner.className = 'lrz-focus-banner';
}

// Surveille tout changement manuel sur les checkboxes de trace.
// Dès qu'une case est cochée/décochée manuellement, on sort du mode focus.
function _watchManualChange(traceFeatureGroups) {
  const handler = (e) => {
    if (!_focusActive) return;
    if (!e.target.matches('[data-group-id]')) return;
    if (_unwatch) { _unwatch(); _unwatch = null; }
    _exitFocus(traceFeatureGroups, false);
  };
  document.addEventListener('change', handler, true);
  _unwatch = () => document.removeEventListener('change', handler, true);
}

// ─────────────────────────────── Application du filtre

/**
 * Applique le filtre URL sur la carte après wireTraceCheckboxes().
 * Modifie les couches et les checkboxes visuellement sans toucher localStorage.
 */
export function applyUrlFilter(filter, traceFeatureGroups) {
  _focusActive = true;

  if (filter.type === 'acte') {
    for (const [groupId, fg] of traceFeatureGroups) {
      const isTarget = groupId === filter.acteId;
      if (isTarget) {
        if (!map.hasLayer(fg)) map.addLayer(fg);
      } else {
        if (map.hasLayer(fg)) map.removeLayer(fg);
      }
      const cb = document.querySelector(`[data-group-id="${groupId}"]`);
      if (cb) cb.checked = isTarget;
    }
    const fg = traceFeatureGroups.get(filter.acteId);
    if (fg) {
      try { map.fitBounds(fg.getBounds(), { padding: [60, 60], maxZoom: 13 }); } catch {}
    }
  } else if (filter.type === 'etape') {
    // Masquer toutes les FeatureGroups (y compris les autres étapes du même acte)
    for (const [, fg] of traceFeatureGroups) {
      if (map.hasLayer(fg)) map.removeLayer(fg);
    }
    document.querySelectorAll('[data-group-id]').forEach((cb) => {
      cb.checked = cb.dataset.groupId === filter.acteId;
    });

    const stepLayer = getStepLayer(filter.etapeId);
    if (stepLayer) {
      _activeFocusLayer = stepLayer;
      map.addLayer(stepLayer);
      try { map.fitBounds(stepLayer.getBounds(), { padding: [60, 60], maxZoom: 14 }); } catch {}
      map.once('moveend', () => openStepPopup(filter.etapeId));
    }
  }

  track('Loaded With Filter', { type: filter.type, value: filter.value });
  _watchManualChange(traceFeatureGroups);
}

// ─────────────────────────────── Bandeau focus

/**
 * Affiche le bandeau « Focus : … — Tout afficher ✕ » dans #lrz-focus-banner.
 */
export function initFocusBanner(filter, groups, traces, traceFeatureGroups) {
  const banner = document.getElementById('lrz-focus-banner');
  if (!banner) return;

  const acteGroup = groups.find(g => g.id === filter.acteId);
  const acteLabel = acteGroup?.label?.split('—')[0]?.trim() ?? filter.acteId;

  let label = acteLabel;
  if (filter.type === 'etape') {
    const item = traces.find(it => it.id === filter.etapeId);
    label += ` — ${item?.label ?? filter.etapeId}`;
  }

  banner.innerHTML = `
    <span class="lrz-focus-banner__label">Focus : ${escapeHtml(label)}</span>
    <button type="button" class="lrz-focus-banner__clear">Tout afficher ✕</button>
  `;
  banner.className = 'lrz-focus-banner lrz-focus-banner--active';

  banner.querySelector('.lrz-focus-banner__clear').addEventListener('click', () => {
    _exitFocus(traceFeatureGroups, true);
  });
}

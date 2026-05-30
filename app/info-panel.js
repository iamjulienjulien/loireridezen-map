/**
 * app/info-panel.js — Blocs éditoriaux dans le panel cockpit
 *
 * Bloc 1 : "Ma dernière position" (lit current_position.json via lrz:position-loaded)
 *          → clic → flyTo sur la carte
 * Bloc 2 : "Étape en cours" ou "Prochaine étape" (lit traces.json)
 *
 * Logique findCurrentOrNextStep :
 *   - date_status === "effective" && date === today  → "en cours"
 *   - premier "planned" ou "prévue" par order       → "prochaine étape"
 *   - sinon : null (bloc masqué)
 */

import { map } from "./map.js";
import { centerOnStep, openStepPopup } from "./routes.js";
import { formatRelativeTime, formatDateFr } from "./time-format.js";
import { escapeHtml } from "./helpers.js";
import { track } from "./analytics.js";

let _positionDetail = null;
let _stepInfo = null;

function findCurrentOrNextStep(items) {
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const inProgress = sorted.find(
    (t) => t.date_status === "effective" && t.date === today,
  );
  if (inProgress) return { trace: inProgress, status: "en-cours" };

  const next = sorted.find(
    (t) => t.date_status === "planned" || t.date_status === "prévue",
  );
  if (next) return { trace: next, status: "prochaine" };

  return null;
}

function renderPositionBlock(detail) {
  if (!detail?.active) return "";
  const time = detail.updated_at ? formatRelativeTime(detail.updated_at) : "";
  return `
    <div class="lrz-info-block lrz-info-block--position" id="lrz-position-block" role="button" tabindex="0" title="Centrer sur la position de Julien">
      <div class="lrz-info-block__icon">🚲</div>
      <div class="lrz-info-block__body">
        <strong class="lrz-info-block__title">${escapeHtml(detail.label || "Ma position")}</strong>
        ${detail.description ? `<span class="lrz-info-block__sub">${escapeHtml(detail.description)}</span>` : ""}
        ${time ? `<span class="lrz-info-block__meta">${time}</span>` : ""}
      </div>
      <input type="checkbox" class="lrz-checkbox" id="position-toggle" title="Afficher le marqueur sur la carte" checked />
    </div>`;
}

function renderStepBlock(info) {
  if (!info) return "";
  const { trace, status } = info;
  const isActive = status === "en-cours";
  const badge = isActive ? "En cours" : "Prochaine étape";
  const badgeClass = isActive
    ? "lrz-info-block__badge--active"
    : "lrz-info-block__badge--next";
  const date = trace.date ? formatDateFr(trace.date) : "";
  return `
    <div class="lrz-info-block lrz-info-block--step" role="button" tabindex="0" title="Centrer sur cette étape">
      <div class="lrz-info-block__icon">🛤️</div>
      <div class="lrz-info-block__body">
        <span class="lrz-info-block__badge ${badgeClass}">${badge}</span>
        <strong class="lrz-info-block__title">${escapeHtml(trace.label || "")}</strong>
        ${date ? `<span class="lrz-info-block__meta">${date}</span>` : ""}
        ${trace.distance_km ? `<span class="lrz-info-block__meta">${trace.distance_km} km</span>` : ""}
      </div>
    </div>`;
}

function _render() {
  const container = document.getElementById("lrz-info-panel");
  if (!container) return;

  const posHTML = renderPositionBlock(_positionDetail);
  const stepHTML = renderStepBlock(_stepInfo);

  if (!posHTML && !stepHTML) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `<div class="lrz-info-blocks">${posHTML}${stepHTML}</div>`;

  if (_positionDetail?.active) {
    const { lat, lon } = _positionDetail;
    const flyTo = () => {
      track('Position Block Clicked');
      map.flyTo([lat, lon], 14, { duration: 1.2 });
    };
    const posBlock = container.querySelector("#lrz-position-block");
    posBlock?.addEventListener("click", (e) => {
      if (e.target.id === "position-toggle") return;
      flyTo();
    });
    posBlock?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") flyTo();
    });
  }

  if (_stepInfo) {
    const stepId = _stepInfo.trace.id;
    const stepBlock = container.querySelector(".lrz-info-block--step");
    stepBlock?.addEventListener("click", () => {
      track('Step Block Clicked', { step_id: stepId });
      centerOnStep(stepId);
      setTimeout(() => openStepPopup(stepId), 500);
    });
    stepBlock?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        track('Step Block Clicked', { step_id: stepId });
        centerOnStep(stepId);
        setTimeout(() => openStepPopup(stepId), 500);
      }
    });
  }
}

export async function initInfoPanel() {
  try {
    const r = await fetch("data/catalog/traces.json");
    if (r.ok) {
      const { items } = await r.json();
      _stepInfo = findCurrentOrNextStep(items || []);
    }
  } catch {}

  document.addEventListener("lrz:position-loaded", ({ detail }) => {
    _positionDetail = detail.active ? detail : null;
    _render();
  });

  _render();
}

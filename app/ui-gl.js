/**
 * app/ui-gl.js — Rendu et interactions du panel cockpit en MapLibre GL (LRZ-BRA-404 P1).
 *
 * Port GL-safe de `ui.js` (Leaflet). On NE peut PAS réutiliser `ui.js` : il importe `map.js` +
 * `routes.js` (⟹ instancierait Leaflet). Les fonctions de rendu (pur DOM) sont DUPLIQUÉES ici (dette
 * transitoire, comme poi-gl.js/eurovelo-gl.js), et le câblage des cases est branché sur les couches GL :
 *   - Traces  → setTraceGroupVisibilityGL + setGroupMarkersVisibilityGL
 *   - POI      → setEnabledPoiTypesGL (les cases `.type-filter` deviennent la source de vérité)
 *   - Photos   → event `lrz:photo-categories-changed` (écouté par poi-gl.js)
 */

import { Icon as ExtraIcon, TackCircleBorder } from 'leaflet-extra-markers';
import { PHOTO_CATEGORY_GROUPS, ALL_PHOTO_CATEGORIES } from './carnets/registry.js';
import { POI_TYPES, SHAPES, TRACE_MARKER_TYPES, getGroupColorPreview } from './types.js';
import { escapeHtml, lightenHex } from './helpers.js';
import { hiddenModes } from './url-mode.js';
import { track } from './analytics.js';
import { updatePreference, resetPreferences } from './preferences.js';
import { traceGroupsGL, setTraceGroupVisibilityGL } from './routes-gl.js';
import { setGroupMarkersVisibilityGL } from './trace-markers-gl.js';
import { setEnabledPoiTypesGL } from './poi-gl.js';
import { getCurrentCarnetGL } from './carnets/apply-gl.js';

const _EYE_SVG = `<svg viewBox="0 0 24 24" class="lrz-eye-toggle__svg" aria-hidden="true">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
  <circle cx="12" cy="12" r="3"/>
  <line class="lrz-eye-toggle__strike" x1="3" y1="3" x2="21" y2="21"/>
</svg>`;

// ─────────────────────────────────────── Section 1 : Traces

const LOIRE_GROUPS = ['acte-1', 'acte-2', 'acte-3'];
const OTHER_GROUPS = ['micro-aventure', 'velodyssee'];

function groupSubsection(groupId) {
    if (LOIRE_GROUPS.includes(groupId)) return 'loire';
    if (OTHER_GROUPS.includes(groupId)) return 'other';
    return 'other';
}

function colorPreviewStyle(preview) {
    if (preview.type === 'solid') return `background:${preview.colors[0]}`;
    if (preview.type === 'dashed') {
        return `background:repeating-linear-gradient(to right,${preview.colors[0]} 0 5px,transparent 5px 9px)`;
    }
    return `background:linear-gradient(to right,${preview.colors.join(',')})`;
}

function buildTraceRow(group, prefs, isEmpty) {
    const preview = getGroupColorPreview(group);
    const displayPreview = preview.type === 'dashed' ? { ...preview, type: 'solid' } : preview;
    const style = colorPreviewStyle(displayPreview);
    const isChecked = prefs.traces?.[group.id] ?? group.visible_by_default ?? true;
    const emptyClass = isEmpty ? ' lrz-trace-row--empty' : '';
    const suffix = isEmpty ? ` <span class="lrz-trace-row__suffix">(à venir)</span>` : '';
    const disabledClass = isEmpty ? ' lrz-stamp-toggle--disabled' : '';
    return `
    <div class="lrz-row${emptyClass}">
      <div class="lrz-row__visual" style="${style}"></div>
      <span class="lrz-row__label">${escapeHtml(group.label)}${suffix}</span>
      <label class="lrz-stamp-toggle${disabledClass}">
        <input type="checkbox" class="lrz-checkbox" data-group-id="${escapeHtml(group.id)}" ${isChecked ? 'checked' : ''} ${isEmpty ? 'disabled' : ''} />
        <span class="lrz-stamp-toggle__slot" aria-hidden="true"><span class="lrz-stamp-toggle__mark">✓</span></span>
      </label>
    </div>`;
}

function buildSubsection(title, groupItems, prefs, tracesItems) {
    if (groupItems.length === 0) return '';
    const groupIds = new Set(tracesItems.map((t) => t.group));
    const rows = groupItems.map((g) => buildTraceRow(g, prefs, !groupIds.has(g.id)));
    return `
    <div class="lrz-trace-subsection">
      <h3 class="lrz-trace-subsection__title">${escapeHtml(title)}</h3>
      <div class="lrz-trace-subsection__list">${rows.join('')}</div>
    </div>`;
}

export function renderTracesSectionGL(groups, prefs, traces) {
    const list = document.getElementById('traces-list');
    if (!list) return;

    const items = [...(groups.items ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const tracesItems = traces?.items ?? [];

    const loireGroups = items.filter((g) => groupSubsection(g.id) === 'loire');
    const otherGroups = items.filter((g) => groupSubsection(g.id) === 'other');

    const legendItems = Object.entries(TRACE_MARKER_TYPES)
        .map(
            ([key, cfg]) =>
                `<span class="lrz-legend-row__item"><span class="lrz-legend-row__emoji lrz-legend-row__emoji--${key}">${cfg.emoji}</span><span>${escapeHtml(cfg.label)}</span></span>`
        )
        .join('');

    list.innerHTML =
        buildSubsection('Loire à Vélo', loireGroups, prefs, tracesItems) +
        buildSubsection('Autres voyages', otherGroups, prefs, tracesItems) +
        `<div class="lrz-legend__title">Légende</div>` +
        `<div class="lrz-legend-row lrz-legend-row--inline">${legendItems}</div>`;
}

/** Légende EuroVelo (pur DOM, non-interactif — parité addEuroVeloToggle). */
export function addEuroVeloLegendGL() {
    const list = document.getElementById('traces-list');
    if (!list) return;

    const legend = list.querySelector('.lrz-legend__title');
    const strokeStyle =
        'display:inline-block;width:1.5rem;height:3px;background:#6b7280;opacity:0.6;border-radius:2px;flex-shrink:0';

    const ev6Row = document.createElement('span');
    ev6Row.id = 'eurovelo-row';
    ev6Row.className = 'lrz-legend__eurovelo';
    ev6Row.innerHTML =
        `<span class="lrz-legend-row__visual" style="${strokeStyle}"></span>` +
        `<span>EuroVelo 6</span>`;

    const ev1Row = document.createElement('span');
    ev1Row.id = 'eurovelo-1-row';
    ev1Row.className = 'lrz-legend__eurovelo';
    ev1Row.innerHTML =
        `<span class="lrz-legend-row__visual" style="${strokeStyle}"></span>` +
        `<span>EuroVelo 1</span>`;

    const evWrapper = document.createElement('div');
    evWrapper.className = 'lrz-legend__eurovelos';
    evWrapper.append(ev6Row, ev1Row);

    if (legend) legend.after(evWrapper);
    else list.appendChild(evWrapper);
}

/** Branche les cases de traces sur la visibilité des couches GL (lignes + markers d'étape). */
export function wireTraceCheckboxesGL() {
    document.querySelectorAll('[data-group-id]').forEach((cb) => {
        const groupId = cb.dataset.groupId;
        // État initial : la case est la source de vérité.
        setTraceGroupVisibilityGL(groupId, cb.checked);
        setGroupMarkersVisibilityGL(groupId, cb.checked);

        cb.addEventListener('change', () => {
            setTraceGroupVisibilityGL(groupId, cb.checked);
            setGroupMarkersVisibilityGL(groupId, cb.checked);
            track('Layer Item Toggled', {
                section: 'traces',
                item: groupId,
                state: cb.checked ? 'on' : 'off',
            });
            updatePreference(`traces.${groupId}`, cb.checked);
        });
    });
}

// ─────────────────────────────────────── Section 3 : POI

function renderMiniMarker(type) {
    const t = POI_TYPES[type];
    if (!t) return `<span style="font-size:1.1rem">📍</span>`;
    const icon = new ExtraIcon({
        content: t.emoji,
        color: lightenHex(t.color, 0.8),
        accentColor: t.color,
        svgStyle: { stroke: t.color, 'stroke-width': '2' },
        svg: SHAPES[t.shape] || TackCircleBorder,
        scale: 0.75,
        shadow: 'none',
    });
    const el = icon.createIcon();
    el.style.position = 'static';
    el.style.margin = '0';
    return el.outerHTML;
}

/** Set des types POI actifs selon le carnet courant (`null` = tous cochés). */
function _carnetEnabledPoiTypes() {
    const def = getCurrentCarnetGL()?.pois?.defaultEnabled;
    return def ? new Set(def) : null;
}

export function renderPoiSectionGL(prefs) {
    const list = document.getElementById('poi-list');
    if (!list) return;

    const enabled = _carnetEnabledPoiTypes();
    const types = Object.entries(POI_TYPES).filter(
        ([k, cfg]) => k !== 'photo' && (!cfg.hidden || (k === 'lapin' && hiddenModes.rabbit))
    );

    list.innerHTML = types
        .map(([key, cfg]) => {
            const isChecked = enabled ? enabled.has(key) : (cfg.defaultChecked ?? true);
            return `
        <div class="lrz-row">
          <div class="lrz-row__marker">${renderMiniMarker(key)}</div>
          <span class="lrz-row__label">${escapeHtml(cfg.label)}</span>
          <label class="lrz-eye-toggle" title="Afficher / masquer">
            <input type="checkbox" class="lrz-checkbox type-filter" value="${escapeHtml(key)}" ${isChecked ? 'checked' : ''} />
            <span class="lrz-eye-toggle__icon">${_EYE_SVG}</span>
          </label>
        </div>`;
        })
        .join('');
}

/** Branche les cases `.type-filter` (POI + master photo) → setEnabledPoiTypesGL. */
export function wirePoiFiltersGL() {
    const apply = () => {
        const checked = [...document.querySelectorAll('.type-filter:checked')].map(
            (cb) => cb.value
        );
        setEnabledPoiTypesGL(checked);
    };
    document.querySelectorAll('.type-filter').forEach((cb) => cb.addEventListener('change', apply));
    // Pas d'apply() initial : le chargement POI de départ est piloté par applyCarnetGL, et les cases
    // sont rendues à partir des défauts du carnet (renderPoiSectionGL) → déjà cohérentes.
}

// ─────────────────────────────────────── Section 4 : Photos

const _CAT_EXPANDED_KEY = 'lrz_photo_categories_expanded';

/** Set des catégories photos activées (port GL-safe de getCurrentEnabledCategories, state.js). */
function _currentEnabledCategoriesGL() {
    const carnet = getCurrentCarnetGL();
    const defaults = new Set(carnet?.photoCategories?.enabled ?? []);
    try {
        const raw = localStorage.getItem('lrz_photo_categories_overrides');
        if (raw) {
            const overrides = JSON.parse(raw);
            if (overrides.all) return new Set(ALL_PHOTO_CATEGORIES);
            if (Array.isArray(overrides.enabled)) return new Set(overrides.enabled);
        }
    } catch {}
    return defaults;
}

export function renderPhotosSectionGL(prefs) {
    const list = document.getElementById('photos-list');
    if (!list) return;

    const enabledPoi = _carnetEnabledPoiTypes();
    const isChecked = enabledPoi ? enabledPoi.has('photo') : (prefs.poi?.photo ?? true);
    const enabled = _currentEnabledCategoriesGL();
    const isExpanded = (() => {
        try {
            return localStorage.getItem(_CAT_EXPANDED_KEY) === 'true';
        } catch {
            return false;
        }
    })();

    const groupsHTML = PHOTO_CATEGORY_GROUPS.map((group) => {
        const subHTML = group.subcategories
            .map((sub) => {
                const checked = enabled.has(sub.key);
                return `
        <div class="lrz-photo-subcat" data-cat="${escapeHtml(sub.key)}">
          <span class="lrz-photo-subcat__label">${escapeHtml(sub.label)}</span>
          <label class="lrz-eye-toggle lrz-eye-toggle--sm">
            <input type="checkbox" class="lrz-photo-cat-cb" data-cat="${escapeHtml(sub.key)}" ${checked ? 'checked' : ''} />
            <span class="lrz-eye-toggle__icon">${_EYE_SVG}</span>
          </label>
        </div>`;
            })
            .join('');

        const allChecked = group.subcategories.every((s) => enabled.has(s.key));
        const noneChecked = group.subcategories.every((s) => !enabled.has(s.key));
        const indeterminate = !allChecked && !noneChecked;

        return `
      <div class="lrz-photo-group" data-group="${escapeHtml(group.key)}">
        <div class="lrz-photo-group__header">
          <span class="lrz-photo-group__icon">${group.icon}</span>
          <span class="lrz-photo-group__label">${escapeHtml(group.label)}</span>
          <label class="lrz-eye-toggle lrz-eye-toggle--sm">
            <input type="checkbox" class="lrz-photo-group-cb" data-group="${escapeHtml(group.key)}"
              ${allChecked ? 'checked' : ''} ${indeterminate ? 'data-indeterminate' : ''} />
            <span class="lrz-eye-toggle__icon">${_EYE_SVG}</span>
          </label>
        </div>
        <div class="lrz-photo-group__subcats">${subHTML}</div>
      </div>`;
    }).join('');

    list.innerHTML = `
    <div class="lrz-row lrz-photo-master-row">
      <div class="lrz-row__marker">${renderMiniMarker('photo')}</div>
      <span class="lrz-row__label">Photos géolocalisées</span>
      <label class="lrz-eye-toggle" title="Afficher / masquer la couche photos">
        <input type="checkbox" class="lrz-checkbox type-filter" value="photo" ${isChecked ? 'checked' : ''} />
        <span class="lrz-eye-toggle__icon">${_EYE_SVG}</span>
      </label>
      <button class="lrz-photo-expand-btn" aria-expanded="${isExpanded}" title="Filtres par catégorie">▾</button>
    </div>
    <div class="lrz-photo-categories${isExpanded ? ' is-expanded' : ''}">
      <div class="lrz-photo-categories__inner">${groupsHTML}</div>
    </div>`;

    // indeterminate en JS (pas en attribut HTML)
    list.querySelectorAll('[data-indeterminate]').forEach((cb) => {
        cb.indeterminate = true;
        cb.removeAttribute('data-indeterminate');
    });

    // Toggle expand
    list.querySelector('.lrz-photo-expand-btn')?.addEventListener('click', () => {
        const catSection = list.querySelector('.lrz-photo-categories');
        const btn = list.querySelector('.lrz-photo-expand-btn');
        const expanded = catSection.classList.toggle('is-expanded');
        btn.setAttribute('aria-expanded', String(expanded));
        try {
            localStorage.setItem(_CAT_EXPANDED_KEY, String(expanded));
        } catch {}
    });

    // Master photo → grise les sous-cases (l'état réel est piloté par .type-filter)
    list.querySelector('.type-filter')?.addEventListener('change', (e) => {
        list.querySelector('.lrz-photo-categories').classList.toggle(
            'is-disabled',
            !e.target.checked
        );
    });

    // Toggle sous-catégorie
    list.querySelectorAll('.lrz-photo-cat-cb').forEach((cb) => {
        cb.addEventListener('change', () => _updatePhotoCategoryFilterGL(list));
    });

    // Toggle groupe
    list.querySelectorAll('.lrz-photo-group-cb').forEach((gcb) => {
        gcb.addEventListener('change', () => {
            const group = PHOTO_CATEGORY_GROUPS.find((g) => g.key === gcb.dataset.group);
            if (!group) return;
            group.subcategories.forEach((sub) => {
                const cb = list.querySelector(`.lrz-photo-cat-cb[data-cat="${sub.key}"]`);
                if (cb) cb.checked = gcb.checked;
            });
            _updatePhotoCategoryFilterGL(list);
        });
    });

    // Re-render sur changement de carnet (parité ui.js)
    document.addEventListener('lrz:carnet-changed', () => renderPhotosSectionGL(prefs));
}

function _updatePhotoCategoryFilterGL(list) {
    const checked = new Set(
        [...list.querySelectorAll('.lrz-photo-cat-cb:checked')].map((cb) => cb.dataset.cat)
    );
    PHOTO_CATEGORY_GROUPS.forEach((group) => {
        const gcb = list.querySelector(`.lrz-photo-group-cb[data-group="${group.key}"]`);
        if (!gcb) return;
        const all = group.subcategories.every((s) => checked.has(s.key));
        const none = group.subcategories.every((s) => !checked.has(s.key));
        gcb.checked = all;
        gcb.indeterminate = !all && !none;
    });
    // poi-gl.js écoute cet event et refiltres les markers photos.
    document.dispatchEvent(
        new CustomEvent('lrz:photo-categories-changed', { detail: { enabled: [...checked] } })
    );
}

// ─────────────────────────────────────── Accordion + "Tout" (engine-agnostic)

export function initAccordionGL(prefs) {
    document.querySelectorAll('.lrz-section').forEach((section) => {
        const sectionKey = section.dataset.section;
        const isCollapsed = prefs.sections?.[sectionKey] ?? false;
        if (isCollapsed) section.dataset.collapsed = 'true';

        const toggle = section.querySelector('.lrz-section__toggle');

        const toggleSection = () => {
            const wasCollapsed = section.dataset.collapsed === 'true';
            section.dataset.collapsed = wasCollapsed ? 'false' : 'true';
            track('Layer Toggled', { section: sectionKey, state: wasCollapsed ? 'on' : 'off' });
            updatePreference(`sections.${sectionKey}`, !wasCollapsed);
        };

        toggle?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSection();
        });
        section.querySelector('h3')?.addEventListener('click', toggleSection);
    });

    document.querySelectorAll('.lrz-section__all').forEach((btn) => {
        btn.addEventListener('click', () => {
            const section = btn.closest('.lrz-section');
            const sectionKey = section?.dataset.section || '';
            const checkboxes = [...section.querySelectorAll('.lrz-checkbox')];
            const allChecked = checkboxes.every((cb) => cb.checked);
            track('Layer Tout Clicked', { section: sectionKey });
            checkboxes.forEach((cb) => {
                cb.checked = !allChecked;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });
    });
}

// ─────────────────────────────────────── Reset preferences

export function initResetButtonGL() {
    document.getElementById('reset-prefs')?.addEventListener('click', () => {
        track('Preferences Reset');
        resetPreferences();
        location.reload();
    });
}

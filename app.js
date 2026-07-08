/**
 * app.js — Entry point de la carte Loire Ride Zen
 *
 * Skeleton progressif en 4 phases :
 *   Phase 1 : plein écran (lrz-loading) pendant le chargement JS
 *   Phase 2 : UI rendue → masquer le plein écran, mini "Chargement des traces…"
 *   Phase 3 : traces GeoJSON prêtes → mini "Chargement des lieux…"
 *   Phase 4 : premier lot de POI chargé → retirer le mini skeleton
 */

import { map } from './app/map.js';
import { initVisitCounter } from './app/visit-counter.js';
import { initVisitCounterForElle } from './app/visit-counter-for-elle.js';
import { initBisouButton } from './app/bisou-button.js';
import { hiddenModes } from './app/url-mode.js';
import { track, trackAndNavigate, trackForElle } from './app/analytics.js';
import { loadPoisForViewport, bindViewportListeners } from './app/poi.js';
import { loadPreferences, updatePreference } from './app/preferences.js';
import { buildTraceMarkersFromCatalog } from './app/trace-markers.js';
import { loadCurrentPosition, currentPositionLayer } from './app/current-position.js';
import { initActionsPanel, applyThemeColors } from './app/actions-panel.js';
import {
    getCurrentCarnet,
    getCurrentEnabledCategories,
    setAllPhotoCategoriesEnabled,
    resetPhotoCategoriesToCarnet,
} from './app/carnets/state.js';
import { applyPoiFilter } from './app/carnets/apply.js';
import { setEnabledPhotoCategories } from './app/poi.js';
import { ALL_PHOTO_CATEGORIES } from './app/carnets/registry.js';
import { initExportButton } from './app/map-export.js';
import { initInfoPanel } from './app/info-panel.js';
import { initEuroVelos } from './app/eurovelo.js';
import { parseUrlFilter, applyUrlFilter, initFocusBanner } from './app/url-filter.js';
import {
    renderTracesSection,
    renderPoiSection,
    renderPhotosSection,
    wireTraceCheckboxes,
    traceFeatureGroups,
    addEuroVeloToggle,
    initMobileDrawer,
    initAccordion,
    initResetButton,
    initKeyboardShortcuts,
    initCurrentPositionToggle,
} from './app/ui.js';

// ─────────────────────────────────── Skeleton helpers

const fullSkeleton = document.getElementById('lrz-loading');
let miniSkeleton = null;

function createMiniSkeleton(text) {
    if (miniSkeleton) {
        miniSkeleton.querySelector('.lrz-loading-mini__text').textContent = text;
        return;
    }
    miniSkeleton = document.createElement('div');
    miniSkeleton.className = 'lrz-loading-mini';
    miniSkeleton.innerHTML = `<span class="lrz-loading-mini__text">${text}</span>`;
    // document.body.appendChild(miniSkeleton);
}

function removeMiniSkeleton() {
    if (!miniSkeleton) return;
    miniSkeleton.style.opacity = '0';
    const el = miniSkeleton;
    miniSkeleton = null;
    setTimeout(() => el.remove(), 300);
}

// Phase 4 : premier POI chargé → retirer le mini skeleton
document.addEventListener('lrz:poi-loaded', removeMiniSkeleton, { once: true });

// ─────────────────────────────────── Panel collapsable (LRZ-EVO-60)

function initPanelToggle() {
    const panel = document.getElementById('filtersPanel');
    const toggle = panel?.querySelector('.lrz-panel__toggle');
    if (!panel || !toggle) return;

    const STORAGE_KEY = 'lrz_filters_panel_collapsed';

    function getDefaultCollapsed() {
        return window.matchMedia('(max-width: 768px)').matches;
    }

    function setCollapsed(collapsed, persist = true) {
        panel.classList.toggle('lrz-panel--collapsed', collapsed);
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? 'Déplier le panneau' : 'Replier le panneau');
        if (persist) localStorage.setItem(STORAGE_KEY, String(collapsed));
        track('Filters Panel Toggled', { state: collapsed ? 'collapsed' : 'opened' });
    }

    // Restauration sans animation au boot
    panel.classList.add('no-transition');
    const stored = localStorage.getItem(STORAGE_KEY);
    const initial = stored === null ? getDefaultCollapsed() : stored === 'true';
    setCollapsed(initial, false);
    requestAnimationFrame(() => panel.classList.remove('no-transition'));

    toggle.addEventListener('click', () => {
        setCollapsed(!panel.classList.contains('lrz-panel--collapsed'));
    });
}

// ─────────────────────────────────── Init principal

async function init() {
    const prefs = loadPreferences();

    const [groups, traces] = await Promise.all([
        fetch('data/catalog/groups.json').then((r) => r.json()),
        fetch('data/catalog/traces.json').then((r) => r.json()),
    ]);

    renderTracesSection(groups, prefs, traces);
    renderPhotosSection(prefs);
    renderPoiSection(prefs);

    initActionsPanel();

    // Appliquer le filtre POI du carnet actif au démarrage
    if (!hiddenModes.rabbit) {
        const carnet = getCurrentCarnet();
        if (carnet) applyPoiFilter(carnet.pois.defaultEnabled);
    }

    initExportButton();
    initInfoPanel();
    initMobileDrawer();
    initAccordion(prefs);
    initResetButton();
    initKeyboardShortcuts(map);
    initCurrentPositionToggle(currentPositionLayer, loadCurrentPosition, prefs);
    initEuroVelos(map).then((eurovelo) => {
        if (eurovelo) addEuroVeloToggle(eurovelo, prefs);
    });

    if (!hiddenModes.rabbit) {
        initPanelToggle();
    } else {
        document.querySelector('.lrz-panel__toggle')?.remove();
    }

    if (!hiddenModes.rabbit) {
        initVisitCounter().catch((err) => console.warn('[visit-counter] init failed', err));
        document.querySelector('.lrz-bottom-right')?.remove();
    }
    setInterval(
        async () => {
            await loadCurrentPosition();
            const cb = document.getElementById('position-toggle');
            if (cb && !cb.checked) map.removeLayer(currentPositionLayer);
        },
        5 * 60 * 1000
    );

    // Bouton Tout voir
    (() => {
        const btn = document.getElementById('lrz-tout-voir');
        if (!btn) return;
        const ALL_POI = [
            'chateau',
            'coupdecoeur',
            'patrimoine',
            'guinguette',
            'hébergement',
            'vigneron',
            'nature',
            'abbaye',
            'site_historique',
            'vestige_archeo',
            'restaurant',
            'bar_cafe',
            'cave_troglodyte',
            'marche_producteur',
            'producteur_fermier',
            'sandbank',
            'point_vue',
            'spot_faune',
            'depart_sentier',
            'bivouac',
            'point_eau',
            'service_velo',
            'gare_velo',
            'photo',
        ];
        let _expanded = false;
        btn.addEventListener('click', () => {
            _expanded = !_expanded;
            btn.classList.toggle('is-active', _expanded);
            if (_expanded) {
                applyPoiFilter(ALL_POI);
                setEnabledPhotoCategories(new Set(ALL_PHOTO_CATEGORIES));
            } else {
                const carnet = getCurrentCarnet();
                if (carnet) {
                    applyPoiFilter(carnet.pois.defaultEnabled);
                    setEnabledPhotoCategories(getCurrentEnabledCategories());
                }
            }
            track('Tout Voir Toggled', { state: _expanded ? 'expanded' : 'carnet' });
        });
        // Resync sur bascule de carnet
        document.addEventListener('lrz:carnet-changed', () => {
            _expanded = false;
            btn.classList.remove('is-active');
            const carnet = getCurrentCarnet();
            if (carnet) {
                applyPoiFilter(carnet.pois.defaultEnabled);
                setEnabledPhotoCategories(getCurrentEnabledCategories());
            }
        });
    })();

    // Sauvegarder la préférence POI à chaque changement de type-filter
    document.querySelectorAll('.type-filter').forEach((cb) => {
        cb.addEventListener('change', () => {
            const section = cb.value === 'photo' ? 'photos' : 'poi';
            track('Layer Item Toggled', {
                section,
                item: cb.value,
                state: cb.checked ? 'on' : 'off',
            });
            updatePreference(`poi.${cb.value}`, cb.checked);
        });
    });

    // Tracking liens externes du footer (hors mode for=elle)
    document.querySelectorAll('.lrz-panel-header__link').forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const href = link.href;
            const dest = href.includes('instagram')
                ? 'instagram'
                : href.includes('komoot')
                  ? 'komoot'
                  : 'site';
            trackAndNavigate('External Link', href, { destination: dest });
        });
    });

    // POI : premier chargement + listeners viewport (pas de listener moveend en mode for=elle)
    if (!hiddenModes.rabbit) bindViewportListeners();
    loadPoisForViewport();

    if (hiddenModes.rabbit) {
        const _fromToken = new URL(location.href).searchParams.get('from') || 'unknown';
        trackForElle('View', { from: _fromToken });
        // Bonus A — masquer liens externes + crédits
        document.querySelector('.lrz-panel-header')?.remove();
        document.querySelectorAll('.lrz-panel-credit').forEach((el) => el.remove());
        // Masquer sections non pertinentes
        ['traces', 'poi', 'photos'].forEach((s) => {
            document.querySelector(`[data-section="${s}"]`)?.remove();
        });
        document.querySelector('.lrz-actions-panel__group--themes')?.remove();
        loadCurrentPosition();
        initVisitCounterForElle().catch((err) =>
            console.warn('[visit-counter-for-elle] init failed', err)
        );
        initBisouButton();
    }

    // Phase 2 : UI rendue → masquer le skeleton plein écran, démarrer le mini
    requestAnimationFrame(() => {
        if (fullSkeleton) {
            fullSkeleton.classList.add('lrz-loading--hidden');
            setTimeout(() => fullSkeleton.remove(), 400);
        }
        createMiniSkeleton('Chargement des traces…');
    });

    // Phase 3 : traces chargées → filtre URL + markers + mini skeleton "lieux"
    wireTraceCheckboxes().then(() => {
        applyThemeColors();
        const urlFilter = parseUrlFilter(traces.items ?? [], groups.items ?? []);
        if (urlFilter) {
            applyUrlFilter(urlFilter, traceFeatureGroups);
            initFocusBanner(urlFilter, groups.items ?? [], traces.items ?? [], traceFeatureGroups);
        }
        createMiniSkeleton('Chargement des lieux…');
        buildTraceMarkersFromCatalog(groups, traces, traceFeatureGroups);
    });
}

init();

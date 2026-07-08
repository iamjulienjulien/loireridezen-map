/**
 * app/carnets/state.js — Persistance et bascule du carnet actif
 */

import {
    CARNETS_REGISTRY,
    DEFAULT_CARNET_KEY,
    CARNET_MAP,
    ALL_PHOTO_CATEGORIES,
} from './registry.js';
import { applyCarnet } from './apply.js';
import { showAccroche } from './accroche.js';

const PHOTO_CAT_STORAGE_KEY = 'lrz_photo_categories_overrides';

const STORAGE_KEY = 'lrz_carnet';

/** Migration one-shot depuis l'ancien système lrz_theme → lrz_carnet. */
export function migrateLocalStorage() {
    const oldTheme = localStorage.getItem('lrz_theme');
    if (oldTheme && !localStorage.getItem(STORAGE_KEY)) {
        const mapping = {
            tuffeau: 'or-tuffeau',
            'or-tuffeau': 'or-tuffeau',
            ardoise: 'loire-velo',
            'etat-major': 'patrimoine',
            'loire-velo': 'loire-velo',
            'grand-air': 'grand-air',
        };
        const newKey = mapping[oldTheme] ?? DEFAULT_CARNET_KEY;
        localStorage.setItem(STORAGE_KEY, newKey);
        localStorage.removeItem('lrz_theme');
    }
}

export function getCurrentCarnetKey() {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_CARNET_KEY;
}

export function getCurrentCarnet() {
    return CARNET_MAP.get(getCurrentCarnetKey()) ?? CARNET_MAP.get(DEFAULT_CARNET_KEY);
}

export function setCarnet(key, { withAccroche = true } = {}) {
    const carnet = CARNET_MAP.get(key);
    if (!carnet) return;
    localStorage.setItem(STORAGE_KEY, key);
    // Reset les overrides photos — le carnet repart de ses défauts
    localStorage.removeItem(PHOTO_CAT_STORAGE_KEY);
    applyCarnet(carnet);
    _syncSelectorUI(key);
    if (withAccroche) showAccroche(carnet);
    document.dispatchEvent(new CustomEvent('lrz:carnet-changed', { detail: { key } }));
}

/** Set des catégories photos actuellement activées (défauts carnet + overrides). */
export function getCurrentEnabledCategories() {
    const carnet = getCurrentCarnet();
    const defaults = new Set(carnet?.photoCategories?.enabled ?? []);
    try {
        const raw = localStorage.getItem(PHOTO_CAT_STORAGE_KEY);
        if (raw) {
            const overrides = JSON.parse(raw);
            if (overrides.all) return new Set(ALL_PHOTO_CATEGORIES);
            if (Array.isArray(overrides.enabled)) return new Set(overrides.enabled);
        }
    } catch {}
    return defaults;
}

/** Active toutes les catégories (mode "Tout voir"). */
export function setAllPhotoCategoriesEnabled() {
    localStorage.setItem(PHOTO_CAT_STORAGE_KEY, JSON.stringify({ all: true }));
}

/** Restaure les défauts du carnet actif. */
export function resetPhotoCategoriesToCarnet() {
    localStorage.removeItem(PHOTO_CAT_STORAGE_KEY);
}

function _syncSelectorUI(key) {
    document.querySelectorAll('[data-carnet]').forEach((btn) => {
        const isActive = btn.dataset.carnet === key;
        btn.classList.toggle('lrz-carnet-btn--active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });
}

export { CARNETS_REGISTRY };

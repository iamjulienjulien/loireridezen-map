/**
 * app/config.js — Runtime config & constantes globales
 *
 * Centralise les credentials Supabase (injectées via config.js →
 * window.LRZ_CONFIG, généré au build Vercel ou copié depuis
 * config.js.example en local) et les constantes de cadrage initial.
 */

const cfg = window.LRZ_CONFIG || {};

export const SUPA_URL = cfg.SUPA_URL;
export const SUPA_PUBLISHABLE_KEY = cfg.SUPA_PUBLISHABLE_KEY;

if (!SUPA_URL || !SUPA_PUBLISHABLE_KEY) {
  console.error(
    "[loireridezen] config.js manquant ou incomplet. " +
      "Créer config.js depuis config.js.example pour dev local.",
  );
}

/** Vue par défaut avant fitBounds (centre Val de Loire, zoom large). */
export const DEFAULT_VIEW = { center: [47.3, 0.5], zoom: 8 };

/** Padding et zoom max appliqués lors du fitBounds initial. */
export const FIT_OPTIONS = { padding: [30, 30], maxZoom: 13 };

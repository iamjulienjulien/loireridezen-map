/**
 * app/types.js — Définition des types de POI et constantes visuelles
 *
 * SOURCE DE VÉRITÉ UNIQUE pour les types de POI.
 * Utilisée pour générer :
 *   - les filtres (checkbox par type)         → ui.js
 *   - la légende visuelle                     → ui.js
 *   - les icônes Leaflet                      → poi.js
 *
 * Pour ajouter un nouveau type de POI : ajouter une entrée dans POI_TYPES,
 * c'est tout. Filtres, légende et icônes s'adaptent automatiquement.
 */

import * as leafletExtraMarkers from "leaflet-extra-markers";

const {
  TackSquareBorder,
  TackCircleBorder,
  TackStarBorder,
  TackDiamondBorder,
} = leafletExtraMarkers;

export const POI_TYPES = {
  // ── 7 types éditoriaux existants ──────────────────────────────────────────
  chateau:     { label: "Château",      emoji: "👑",  color: "#b8860b", shape: "star",    defaultChecked: true },
  coupdecoeur: { label: "Coup de cœur", emoji: "💖",  color: "#d94e6a", shape: "star",    defaultChecked: true },
  patrimoine:  { label: "Patrimoine",   emoji: "🏰",  color: "#c69247", shape: "star",    defaultChecked: false },
  guinguette:  { label: "Guinguette",   emoji: "🍻",  color: "#e07b3a", shape: "square",  defaultChecked: false },
  hébergement: { label: "Hébergement",  emoji: "🏕️", color: "#7a6a4f", shape: "square",  defaultChecked: false },
  vigneron:    { label: "Vignerons",    emoji: "🍷",  color: "#722f37", shape: "diamond", defaultChecked: true },
  nature:      { label: "Coins nature", emoji: "🌿",  color: "#6b8e4e", shape: "circle",  defaultChecked: true },
  // ── 16 nouveaux types (LRZ-EVO-73) ────────────────────────────────────────
  abbaye:             { label: "Abbayes",                emoji: "🎯", color: "#8b6f47", shape: "star",    defaultChecked: false },
  site_historique:    { label: "Sites historiques",      emoji: "🗝️", color: "#7a5c3e", shape: "star",    defaultChecked: false },
  vestige_archeo:     { label: "Vestiges archéologiques",emoji: "🏺", color: "#a89968", shape: "star",    defaultChecked: false },
  restaurant:         { label: "Restaurants",            emoji: "🍴", color: "#c84a3a", shape: "square",  defaultChecked: false },
  bar_cafe:           { label: "Bars et cafés",          emoji: "☕", color: "#6f4e37", shape: "square",  defaultChecked: false },
  cave_troglodyte:    { label: "Caves troglodytes",      emoji: "🍇", color: "#5b3a4f", shape: "diamond", defaultChecked: false },
  marche_producteur:  { label: "Marchés et producteurs", emoji: "🥖", color: "#b8a050", shape: "diamond", defaultChecked: false },
  producteur_fermier: { label: "Producteurs fermiers",   emoji: "🧀", color: "#d4c590", shape: "diamond", defaultChecked: false },
  sandbank:           { label: "Sandbanks et îles",      emoji: "🏝", color: "#d4b88a", shape: "circle",  defaultChecked: false },
  point_vue:          { label: "Points de vue",          emoji: "👁", color: "#5a8c7c", shape: "circle",  defaultChecked: false },
  spot_faune:         { label: "Spots faune",            emoji: "🦅", color: "#6b7a3a", shape: "circle",  defaultChecked: false },
  depart_sentier:     { label: "Départs de sentiers",    emoji: "🥾", color: "#7a6b3a", shape: "circle",  defaultChecked: false },
  bivouac:            { label: "Bivouacs autorisés",     emoji: "🔥", color: "#e07b3a", shape: "circle",  defaultChecked: false },
  point_eau:          { label: "Points d'eau",           emoji: "💧", color: "#4a90b8", shape: "circle",  defaultChecked: false },
  service_velo:       { label: "Services vélo",          emoji: "🔧", color: "#5a6f7c", shape: "square",  defaultChecked: false },
  gare_velo:          { label: "Gares vélo-friendly",    emoji: "🚉", color: "#3a5f8f", shape: "square",  defaultChecked: false },
  // ── Types spéciaux ────────────────────────────────────────────────────────
  photo:       { label: "Photo",           emoji: "📸", color: "#3a8aa1", shape: "circle", defaultChecked: true },
  lapin:       { label: "Lapin en voyage", emoji: "🐰", color: "#ff9b3d", shape: "square", defaultChecked: false, hidden: true },
};

/** Types de markers calculés depuis les traces (non POI Supabase). */
export const TRACE_MARKER_TYPES = {
  départ:  { label: "Départ",  labelPlural: "Départs",  emoji: "🏴", size: 28 },
  étape:   { label: "Étape",   labelPlural: "Étapes",   emoji: "🚩",  size: 24 },
  arrivée: { label: "Arrivée", labelPlural: "Arrivées", emoji: "🏁",  size: 28 },
};

/** Mapping nom symbolique → forme leaflet-extra-markers. */
export const SHAPES = {
  star:    TackStarBorder,
  square:  TackSquareBorder,
  diamond: TackDiamondBorder,
  circle:  TackCircleBorder,
};

/** Couleurs cyclées par numéro d'étape pour la trace principale. */
export const STAGE_COLORS = [
  "#2E86AB", "#1F77B4", "#5DADE2", "#9B59B6", "#E74C3C",
  "#F39C12", "#27AE60", "#16A085", "#34495E",
];

export const COLOR_FNS = {
  byStage: (feature, item, group) => {
    const s = feature.properties?.stage ?? 0;
    return STAGE_COLORS[s % STAGE_COLORS.length];
  },
  byOrder: (feature, item, group) => {
    const o = (item?.order ?? 1) - 1;
    return STAGE_COLORS[o % STAGE_COLORS.length];
  },
};

/**
 * Retourne un descripteur visuel {type, colors} pour afficher une barre de
 * couleur représentant le groupe dans le panel traces.
 */
export function getGroupColorPreview(group) {
  const c = group.color;
  const dashed = group.dashed === true;
  if (typeof c === "string" && !c.startsWith("fn:")) {
    return { type: dashed ? "dashed" : "solid", colors: [c] };
  }
  if (Array.isArray(c)) {
    return { type: "gradient", colors: c.slice(0, 3) };
  }
  if (typeof c === "string" && c.startsWith("fn:")) {
    return { type: "gradient", colors: STAGE_COLORS.slice(0, 3) };
  }
  return { type: "solid", colors: [STAGE_COLORS[0]] };
}

export function resolveColor(colorSpec, context = {}) {
  if (!colorSpec) return STAGE_COLORS[0];
  if (typeof colorSpec === "string") {
    if (colorSpec.startsWith("fn:")) {
      const fn = COLOR_FNS[colorSpec.slice(3)];
      return fn ? fn(context.feature, context.item, context.group) : STAGE_COLORS[0];
    }
    return colorSpec;
  }
  if (Array.isArray(colorSpec)) {
    const idx = context.featureIndex ?? 0;
    return colorSpec[idx % colorSpec.length];
  }
  return STAGE_COLORS[0];
}

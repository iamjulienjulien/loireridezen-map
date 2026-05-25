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
  chateau:     { label: "Château",      emoji: "👑",  color: "#b8860b", shape: "star",   defaultChecked: true },
  coupdecoeur: { label: "Coup de cœur", emoji: "💖",  color: "#d94e6a", shape: "star",   defaultChecked: true },
  patrimoine:  { label: "Patrimoine",   emoji: "🏰",  color: "#c69247", shape: "star",   defaultChecked: false },
  guinguette:  { label: "Guinguette",   emoji: "🍻",  color: "#e07b3a", shape: "square", defaultChecked: false },
  hébergement: { label: "Hébergement",  emoji: "🏕️", color: "#7a6a4f", shape: "square", defaultChecked: false },
  vigneron:    { label: "Vignerons",    emoji: "🍷",  color: "#722f37", shape: "diamond", defaultChecked: true },
  nature:      { label: "Coins nature", emoji: "🌿",  color: "#6b8e4e", shape: "circle", defaultChecked: true },
  photo:       { label: "Photo",        emoji: "📸",  color: "#3a8aa1", shape: "circle", defaultChecked: true },
  lapin:       { label: "Lapin en voyage", emoji: "🐰", color: "#ff9b3d", shape: "square", defaultChecked: false, hidden: true },
};

/** Types de markers calculés depuis les traces (non POI Supabase). */
export const TRACE_MARKER_TYPES = {
  départ:  { label: "Départ",  labelPlural: "Départs",  emoji: "🏳️", size: 28 },
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

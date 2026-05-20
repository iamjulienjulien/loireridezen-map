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
  patrimoine:  { label: "Patrimoine",   emoji: "🏰",  color: "#c69247", shape: "star",    defaultChecked: true },
  guinguette:  { label: "Guinguette",   emoji: "🍻",  color: "#e07b3a", shape: "square",  defaultChecked: true },
  hébergement: { label: "Hébergement",  emoji: "🏕️", color: "#7a6a4f", shape: "square",  defaultChecked: true },
  coupdecoeur: { label: "Coup de cœur", emoji: "💖",  color: "#d94e6a", shape: "star",    defaultChecked: true },
  départ:      { label: "Départ",       emoji: "🏳️", color: "#27ae60", shape: "diamond", defaultChecked: true },
  arrivée:     { label: "Arrivée",      emoji: "🏁",  color: "#c0392b", shape: "diamond", defaultChecked: true },
  photo:       { label: "Photo",        emoji: "📸",  color: "#3a8aa1", shape: "circle",  defaultChecked: true },
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

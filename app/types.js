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
  patrimoine:  { label: "Patrimoine",   emoji: "🏰",  color: "#3498db", shape: "star",    defaultChecked: true },
  guinguette:  { label: "Guinguette",   emoji: "🍻",  color: "#f39c12", shape: "square",  defaultChecked: true },
  hébergement: { label: "Hébergement",  emoji: "🏕️", color: "#9b59b6", shape: "square",  defaultChecked: true },
  coupdecoeur: { label: "Coup de cœur", emoji: "💖",  color: "#f1c40f", shape: "square",  defaultChecked: true },
  départ:      { label: "Départ",       emoji: "🏳️", color: "#2ecc71", shape: "diamond", defaultChecked: true },
  arrivée:     { label: "Arrivée",      emoji: "🏁",  color: "#e74c3c", shape: "diamond", defaultChecked: true },
  photo:       { label: "Photo",        emoji: "📸",  color: "#00bcd4", shape: "square",  defaultChecked: true },
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

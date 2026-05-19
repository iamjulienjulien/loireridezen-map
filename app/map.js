/**
 * app/map.js — Création et configuration de la carte Leaflet
 *
 * Initialise la carte sur l'élément #map, prépare les fonds (OSM, Esri
 * Satellite avec labels) et restaure le fond précédent depuis localStorage.
 *
 * Exporte les objets Leaflet partagés par les autres modules :
 *   - map           : l'instance Map principale
 *   - baseOSM       : fond OpenStreetMap
 *   - baseEsriSat   : fond satellite Esri
 *   - esriLabels    : couche de labels superposée au satellite
 */

import { Map, TileLayer } from "leaflet";
import { DEFAULT_VIEW } from "./config.js";

export const map = new Map("map", {
  zoomControl: true,
  scrollWheelZoom: true,
}).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

export const baseOSM = new TileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  { attribution: "&copy; OpenStreetMap contributors" },
);

export const baseEsriSat = new TileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Imagery © Esri & sources" },
);

// Pane dédié aux labels Esri (au-dessus de la couche satellite, sans clic)
map.createPane("labelsPane");
map.getPane("labelsPane").style.pointerEvents = "none";
map.getPane("labelsPane").style.zIndex = 650;

export const esriLabels = new TileLayer(
  "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  { pane: "labelsPane", attribution: "Labels © Esri" },
);

// Restaurer le fond persisté (cf. handler "baselayerchange" dans ui.js)
const savedBase = localStorage.getItem("baseLayer");
if (savedBase === "sat") {
  baseEsriSat.addTo(map);
  esriLabels.addTo(map);
} else {
  baseOSM.addTo(map);
}

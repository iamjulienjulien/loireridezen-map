/**
 * app/map.js — Création et configuration de la carte Leaflet
 *
 * Initialise la carte sur l'élément #map, prépare les fonds (OSM, Esri
 * Satellite avec labels, CyclOSM, IGN Plan, OpenTopoMap) et restaure le fond
 * précédent depuis localStorage (lrz-preferences ou lrz_theme par défaut).
 *
 * Exporte les objets Leaflet partagés par les autres modules :
 *   - map           : l'instance Map principale
 *   - baseOSM       : fond OpenStreetMap
 *   - baseEsriSat   : fond satellite Esri
 *   - esriLabels    : couche de labels superposée au satellite
 *   - baseCyclOSM   : fond CyclOSM (véloroutes)
 *   - baseIgnPlan   : fond IGN Plan (Géoplateforme)
 *   - baseOpenTopo  : fond OpenTopoMap
 */

import { Map, TileLayer } from "leaflet";
import { DEFAULT_VIEW } from "./config.js";
import { THEME_MAP, DEFAULT_THEME } from "./themes.js";

export const map = new Map("map", {
  zoomControl: false,
  attributionControl: false,
  scrollWheelZoom: true,
}).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);


export const baseOSM = new TileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  { attribution: "&copy; OpenStreetMap contributors · <span style='color:#c69247'>Loire Ride Zen</span>" },
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

export const baseCyclOSM = new TileLayer(
  "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
  {
    subdomains: "abc",
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap contributors · tuiles CyclOSM / OSM-FR",
  },
);

export const baseIgnPlan = new TileLayer(
  "https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&FORMAT=image%2Fpng",
  { maxZoom: 18, attribution: "&copy; IGN-F / G&eacute;oplateforme" },
);

export const baseOpenTopo = new TileLayer(
  "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  {
    subdomains: "abc",
    maxZoom: 17,
    attribution: "&copy; <a href='https://opentopomap.org'>OpenTopoMap</a> (CC-BY-SA) · &copy; OpenStreetMap contributors",
  },
);

// Restaurer le fond persisté (lrz-preferences, sinon basemap du thème par défaut)
let _savedBase;
try {
  const raw = localStorage.getItem("lrz-preferences");
  if (raw) _savedBase = JSON.parse(raw)?.baseLayer;
} catch {}
if (!_savedBase) {
  const themeKey = localStorage.getItem("lrz_theme") || DEFAULT_THEME;
  _savedBase = THEME_MAP.get(themeKey)?.basemap || "sat";
}

if (_savedBase === "sat") {
  baseEsriSat.addTo(map);
  esriLabels.addTo(map);
} else if (_savedBase === "cyclosm") {
  baseCyclOSM.addTo(map);
} else if (_savedBase === "ign") {
  baseIgnPlan.addTo(map);
} else if (_savedBase === "topo") {
  baseOpenTopo.addTo(map);
} else {
  baseOSM.addTo(map);
}

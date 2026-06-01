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
import { DEFAULT_CARNET_KEY, CARNET_MAP } from "./carnets/registry.js";

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

// CartoDB Dark Matter — utilisé par 🏮 Veillée (même design que OpenMapTiles Dark Matter)
export const baseOSMDark = new TileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  {
    subdomains: "abcd",
    maxZoom: 19,
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors &copy; <a href='https://carto.com/attributions'>CARTO</a>",
  },
);

// CartoDB Positron raster (anglais) — gardé en réserve
export const basePositron = new TileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  {
    subdomains: "abcd",
    maxZoom: 19,
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors &copy; <a href='https://carto.com/attributions'>CARTO</a>",
  },
);

// OSM France — fond clair, labels 100 % en français
export const baseOSMFr = new TileLayer(
  "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
  {
    subdomains: "abc",
    maxZoom: 20,
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors · rendu <a href='https://tile.openstreetmap.fr'>OSM-FR</a>",
  },
);

// Positron GL (MapLibre) — style vectoriel openmaptiles.data.gouv.fr, labels français
// Créé lazily via getPositronGL() pour ne pas instancier avant que maplibregl soit chargé
let _positronGL = null;
export function getPositronGL() {
  if (!_positronGL && window.L?.maplibreGL) {
    _positronGL = window.L.maplibreGL({
      style: "https://openmaptiles.data.gouv.fr/styles/positron/style.json",
      attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors · <a href='https://openmaptiles.data.gouv.fr'>openmaptiles.data.gouv.fr</a>",
    });
  }
  return _positronGL;
}

// Restaurer le fond depuis le carnet persisté
const _carnetKey = localStorage.getItem("lrz_carnet") ?? DEFAULT_CARNET_KEY;
const _initialBasemap = CARNET_MAP.get(_carnetKey)?.visual.basemap ?? "cyclosm";

if (_initialBasemap === "satellite-esri") {
  baseEsriSat.addTo(map);
  esriLabels.addTo(map);
} else if (_initialBasemap === "osm-dark") {
  baseOSMDark.addTo(map);
} else if (_initialBasemap === "positron") {
  basePositron.addTo(map);
} else if (_initialBasemap === "positron-gl") {
  // GL layer initialisé après chargement de maplibre-gl-leaflet
  window.addEventListener("load", () => { try { getPositronGL()?.addTo(map); } catch {} });
} else if (_initialBasemap === "osm-fr") {
  baseOSMFr.addTo(map);
} else if (_initialBasemap === "ign-plan") {
  baseIgnPlan.addTo(map);
} else if (_initialBasemap === "cyclosm") {
  baseCyclOSM.addTo(map);
} else if (_initialBasemap === "opentopomap") {
  baseOpenTopo.addTo(map);
} else {
  baseOSM.addTo(map);
}

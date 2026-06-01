/**
 * app/carnets/registry.js — Source de vérité unique des 7 carnets (LRZ-EVO-71)
 *
 * Ordre : 1 Loire à vélo · 2 Grand air · 3 Or et tuffeau · 4 Patrimoine
 *         5 Tablée · 6 Veillée · 7 Souvenirs
 */

export const CARNETS_REGISTRY = [
  {
    key: "loire-velo",
    icon: "🚲",
    label: "Loire à vélo",
    shortLabel: "Loire à vélo",
    slug: "loire-velo",
    order: 1,
    isDefault: true,
    uiMode: "light",

    promise: "La Loire qu'on traverse à vélo.",
    accroche: "Étapes, gîtes, ravitaillement, ombrages. Le carnet du voyageur cycliste, pratique avant tout.",
    mood: ["pratique", "fonctionnel", "signalétique", "en route"],

    visual: {
      primaryColor: "#3a6f8f",
      backgroundColor: "#f5f8fb",
      accentColor: null,
      basemap: "cyclosm",
      fontTheme: '"Oswald", Impact, sans-serif',
      fontFamily: "Oswald",
    },

    pois: {
      defaultEnabled: ["hébergement", "guinguette", "point_eau", "service_velo", "gare_velo", "point_vue"],
    },

    photoCategories: {
      enabled: ["routes_chemins", "velo_mouvement", "etapes_pratiques", "balises_loire_velo"],
    },
  },

  {
    key: "grand-air",
    icon: "🌿",
    label: "Grand air",
    shortLabel: "Grand air",
    slug: "grand-air",
    order: 2,
    isDefault: false,
    uiMode: "light",

    promise: "La Loire sauvage.",
    accroche: "Sentiers, sandbanks, points de vue, oiseaux. La carte regarde la Loire comme un territoire vivant à fouler.",
    mood: ["naturaliste", "vivant", "ample", "ouvert"],

    visual: {
      primaryColor: "#b5562f",
      backgroundColor: "#faf7f4",
      accentColor: null,
      basemap: "opentopomap",
      fontTheme: '"Cabin", system-ui, sans-serif',
      fontFamily: "Cabin",
    },

    pois: {
      defaultEnabled: ["nature", "coupdecoeur", "sandbank", "point_vue", "spot_faune", "depart_sentier", "point_eau", "bivouac"],
    },

    photoCategories: {
      enabled: ["paysages", "faune_flore", "sentiers_reliefs", "skylines_naturelles"],
    },
  },

  {
    key: "or-tuffeau",
    icon: "🏰",
    label: "Or et tuffeau",
    shortLabel: "Or et tuffeau",
    slug: "or-tuffeau",
    order: 3,
    isDefault: false,
    uiMode: "light",

    promise: "La Loire des pierres dorées.",
    accroche: "Châteaux, abbayes, murs anciens. La carte regarde la Loire à hauteur de tuffeau, dans la lumière du soir.",
    mood: ["chaud", "contemplatif", "monumental", "golden hour"],

    visual: {
      primaryColor: "#c8893a",
      backgroundColor: "#fdfbf7",
      accentColor: null,
      basemap: "satellite-esri",
      fontTheme: '"Fraunces", "Iowan Old Style", Georgia, serif',
      fontFamily: "Fraunces",
    },

    pois: {
      defaultEnabled: ["chateau", "patrimoine", "abbaye", "point_vue", "cave_troglodyte"],
    },

    photoCategories: {
      enabled: ["architecture", "pierres_dorees", "pierres_clochers", "details_sculptes"],
    },
  },

  {
    key: "patrimoine",
    icon: "🏛",
    label: "Patrimoine",
    shortLabel: "Patrimoine",
    slug: "patrimoine",
    order: 4,
    isDefault: false,
    uiMode: "light",

    promise: "La Loire qui a duré.",
    accroche: "Murs, archives, ponts de pierre, lieux qui ont vu passer les siècles. La carte regarde ce qui reste.",
    mood: ["historique", "vivant", "patiné", "enraciné"],

    visual: {
      primaryColor: "#8b5e3c",
      backgroundColor: "#f8f4ef",
      accentColor: null,
      basemap: "ign-plan",
      fontTheme: '"Spectral", Georgia, serif',
      fontFamily: "Spectral",
    },

    pois: {
      defaultEnabled: ["patrimoine", "chateau", "abbaye", "site_historique", "vestige_archeo"],
    },

    photoCategories: {
      enabled: ["architecture", "pierres_clochers", "ruines_vestiges", "details_sculptes"],
    },
  },

  {
    key: "tablee",
    icon: "🍷",
    label: "Tablée",
    shortLabel: "Tablée",
    slug: "tablee",
    order: 5,
    isDefault: false,
    uiMode: "light",

    promise: "La Loire qu'on goûte.",
    accroche: "Vignerons, caves, guinguettes, tonnelles. La carte des bouteilles et des tables — le terroir ligérien à hauteur de verre.",
    mood: ["terroir", "gourmand", "convivial", "partagé"],

    visual: {
      primaryColor: "#5b2a4f",
      backgroundColor: "#fdf9f7",
      accentColor: null,
      basemap: "osm-plan",
      fontTheme: '"Cormorant Garamond", "Didot", Georgia, serif',
      fontFamily: "Cormorant Garamond",
    },

    pois: {
      defaultEnabled: ["vigneron", "guinguette", "cave_troglodyte", "restaurant", "marche_producteur", "producteur_fermier"],
    },

    photoCategories: {
      enabled: ["vignes_terroirs", "tables_bouteilles", "produits_locaux", "mains_vignerons"],
    },
  },

  {
    key: "veillee",
    icon: "🏮",
    label: "Veillée",
    shortLabel: "Veillée",
    slug: "veillee",
    order: 6,
    isDefault: false,
    uiMode: "dark",

    promise: "La Loire qui ne dort pas.",
    accroche: "Lampions, tonnelles, tables dehors, fenêtres allumées. La Loire qu'on traverse à la fraîche, à la veillée, devant un verre.",
    mood: ["nocturne", "chaleureux", "festif", "suspendu"],

    visual: {
      primaryColor: "#2a3b6f",
      backgroundColor: "#1a1f2e",
      accentColor: "#f5b942",
      basemap: "osm-dark",
      fontTheme: '"Lora", Georgia, serif',
      fontFamily: "Lora",
    },

    pois: {
      defaultEnabled: ["guinguette", "restaurant", "bar_cafe", "bivouac"],
    },

    photoCategories: {
      enabled: ["vie_nocturne", "lampions_tonnelles", "crepuscules", "lumieres_chaudes"],
    },
  },

  {
    key: "souvenirs",
    icon: "📷",
    label: "Souvenirs",
    shortLabel: "Souvenirs",
    slug: "souvenirs",
    order: 7,
    isDefault: false,
    uiMode: "light",

    promise: "La Loire de ce qui m'a touché.",
    accroche: "Coups de cœur, photos, scènes retenues. Le carnet le plus personnel du projet — un carnet dans le carnet.",
    mood: ["intime", "sensible", "photographique", "mémoriel"],

    visual: {
      primaryColor: "#a8825a",
      backgroundColor: "#fdf9f4",
      accentColor: null,
      basemap: "positron",
      fontTheme: '"Cormorant Garamond", "Didot", Georgia, serif',
      fontFamily: "Cormorant Garamond",
    },

    pois: {
      defaultEnabled: ["coupdecoeur", "photo"],
    },

    photoCategories: {
      enabled: ["portraits_rencontres", "moments_suspendus", "details_matieres", "atmospheres", "inattendus"],
    },
  },
];

export const DEFAULT_CARNET_KEY = "loire-velo";

export const CARNET_MAP = new Map(CARNETS_REGISTRY.map((c) => [c.key, c]));

/**
 * 6 groupes × 26 sous-catégories — source de vérité frontend.
 * Clés en snake_case — doit rester synchronisé avec KNOWN_PHOTO_CATEGORIES
 * dans scripts/update_data.py ET avec la colonne categories text[] en BDD.
 */
export const PHOTO_CATEGORY_GROUPS = [
  {
    key: "architecture-pierres",
    icon: "🏛",
    label: "Architecture et pierres",
    subcategories: [
      { key: "architecture",      label: "Architecture" },
      { key: "pierres_dorees",    label: "Pierres dorées" },
      { key: "pierres_clochers",  label: "Pierres et clochers" },
      { key: "ruines_vestiges",   label: "Ruines et vestiges" },
      { key: "details_sculptes",  label: "Détails sculptés" },
    ],
  },
  {
    key: "voyage-cyclisme",
    icon: "🚲",
    label: "Voyage et cyclisme",
    subcategories: [
      { key: "routes_chemins",      label: "Routes et chemins" },
      { key: "velo_mouvement",      label: "Vélo en mouvement" },
      { key: "etapes_pratiques",    label: "Étapes pratiques" },
      { key: "balises_loire_velo",  label: "Balises Loire à Vélo" },
    ],
  },
  {
    key: "nature-paysages",
    icon: "🌿",
    label: "Nature et paysages",
    subcategories: [
      { key: "paysages",           label: "Paysages" },
      { key: "faune_flore",        label: "Faune et flore" },
      { key: "sentiers_reliefs",   label: "Sentiers et reliefs" },
      { key: "skylines_naturelles", label: "Skylines naturelles" },
    ],
  },
  {
    key: "terroir-tables",
    icon: "🍷",
    label: "Terroir et tables",
    subcategories: [
      { key: "vignes_terroirs",   label: "Vignes et terroirs" },
      { key: "tables_bouteilles", label: "Tables et bouteilles" },
      { key: "produits_locaux",   label: "Produits locaux" },
      { key: "mains_vignerons",   label: "Mains de vignerons" },
    ],
  },
  {
    key: "vie-nocturne",
    icon: "🏮",
    label: "Vie nocturne",
    subcategories: [
      { key: "vie_nocturne",       label: "Vie nocturne" },
      { key: "lampions_tonnelles", label: "Lampions et tonnelles" },
      { key: "crepuscules",        label: "Crépuscules" },
      { key: "lumieres_chaudes",   label: "Lumières chaudes" },
    ],
  },
  {
    key: "intime-memoire",
    icon: "📷",
    label: "Intime et mémoire",
    subcategories: [
      { key: "portraits_rencontres", label: "Portraits et rencontres" },
      { key: "moments_suspendus",    label: "Moments suspendus" },
      { key: "details_matieres",     label: "Détails et matières" },
      { key: "atmospheres",          label: "Atmosphères" },
      { key: "inattendus",           label: "Inattendus" },
    ],
  },
];

/** Toutes les clés à plat — utile pour la validation et le "Tout voir". */
export const ALL_PHOTO_CATEGORIES = PHOTO_CATEGORY_GROUPS
  .flatMap((g) => g.subcategories.map((s) => s.key));

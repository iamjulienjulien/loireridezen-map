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
      defaultEnabled: ["hébergement", "guinguette"],
      futureTypes: ["point-eau", "service-velo", "gare-velo"],
    },

    photoCategories: {
      enabled: ["routes-chemins", "velo-mouvement", "etapes-pratiques", "balises-loire-velo"],
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
      defaultEnabled: ["nature", "coupdecoeur"],
      futureTypes: ["sandbank", "viewpoint", "faune", "sentier"],
    },

    photoCategories: {
      enabled: ["paysages", "faune-flore", "sentiers-reliefs", "skylines-naturelles"],
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
      defaultEnabled: ["chateau", "patrimoine"],
      futureTypes: ["abbaye", "viewpoint-chateau", "spot-golden-hour"],
    },

    photoCategories: {
      enabled: ["architecture", "pierres-dorees", "tuffeau-ardoise", "lumieres-soir"],
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
      defaultEnabled: ["patrimoine", "chateau"],
      futureTypes: ["site-historique", "lieu-memoire", "vestige"],
    },

    photoCategories: {
      enabled: ["architecture", "pierres-clochers", "ruines-vestiges", "details-sculptes"],
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
      defaultEnabled: ["vigneron", "guinguette"],
      futureTypes: ["cave-troglodyte", "restaurant", "marche", "affineur"],
    },

    photoCategories: {
      enabled: ["vignes-terroirs", "tables-bouteilles", "produits-locaux", "mains-vignerons"],
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
      defaultEnabled: ["guinguette"],
      futureTypes: ["restaurant", "bar", "bivouac", "spot-nuit"],
    },

    photoCategories: {
      enabled: ["vie-nocturne", "lampions-tonnelles", "crepuscules", "lumieres-chaudes"],
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
      futureTypes: [],
    },

    photoCategories: {
      enabled: ["portraits-rencontres", "moments-suspendus", "details-matieres", "atmospheres", "inattendus"],
    },
  },
];

export const DEFAULT_CARNET_KEY = "loire-velo";

export const CARNET_MAP = new Map(CARNETS_REGISTRY.map((c) => [c.key, c]));

export const PHOTO_CATEGORY_GROUPS = [
  {
    key: "voyage-cyclisme",
    icon: "🚲",
    label: "Voyage et cyclisme",
    subcategories: ["routes-chemins", "velo-mouvement", "etapes-pratiques", "balises-loire-velo"],
  },
  {
    key: "nature-paysages",
    icon: "🌿",
    label: "Nature et paysages",
    subcategories: ["paysages", "faune-flore", "sentiers-reliefs", "skylines-naturelles"],
  },
  {
    key: "architecture-pierres",
    icon: "🏛",
    label: "Architecture et pierres",
    subcategories: ["architecture", "pierres-dorees", "pierres-clochers", "ruines-vestiges", "details-sculptes"],
  },
  {
    key: "terroir-tables",
    icon: "🍷",
    label: "Terroir et tables",
    subcategories: ["vignes-terroirs", "tables-bouteilles", "produits-locaux", "mains-vignerons"],
  },
  {
    key: "vie-nocturne",
    icon: "🏮",
    label: "Vie nocturne",
    subcategories: ["vie-nocturne", "lampions-tonnelles", "crepuscules", "lumieres-chaudes"],
  },
  {
    key: "intime-memoire",
    icon: "📷",
    label: "Intime et mémoire",
    subcategories: ["portraits-rencontres", "moments-suspendus", "details-matieres", "atmospheres", "inattendus"],
  },
];

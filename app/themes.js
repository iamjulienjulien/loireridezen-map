export const THEMES = [
  {
    key: 'tuffeau',
    label: 'Or et tuffeau',
    emoji: '✨',
    basemap: 'sat',
    color: '#c8893a',
    font: 'Fraunces',
    fontStack: '"Fraunces", "Iowan Old Style", Georgia, serif',
  },
  {
    key: 'etat-major',
    label: 'État-major',
    emoji: '🗺️',
    basemap: 'ign',
    color: '#722f37',
    font: 'Spectral',
    fontStack: '"Spectral", Georgia, serif',
  },
  {
    key: 'loire-velo',
    label: 'Loire à vélo',
    emoji: '🚲',
    basemap: 'cyclosm',
    color: '#3a6f8f',
    font: 'Oswald',
    fontStack: '"Oswald", Impact, sans-serif',
  },
  {
    key: 'grand-air',
    label: 'Grand air',
    emoji: '⛰️',
    basemap: 'topo',
    color: '#b5562f',
    font: 'Cabin',
    fontStack: '"Cabin", system-ui, sans-serif',
  },
  {
    key: 'ardoise',
    label: 'Ardoise',
    emoji: '🌺',
    basemap: 'ign',
    color: '#3f4a54',
    font: 'Geist',
    fontStack: '"Geist", system-ui, sans-serif',
  },
];

export const THEME_MAP = new Map(THEMES.map((t) => [t.key, t]));
export const DEFAULT_THEME = 'tuffeau';

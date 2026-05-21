import { isForElle } from './url-mode.js';

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];

const BOT_PATTERNS = [
  /googlebot/i, /bingbot/i, /slurp/i, /duckduckbot/i, /baiduspider/i,
  /yandexbot/i, /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
  /whatsapp/i, /telegrambot/i, /discordbot/i, /applebot/i,
  /headless/i, /phantomjs/i, /puppeteer/i, /playwright/i, /selenium/i,
];

function _shouldSend() {
  const url = new URL(window.location.href);
  const hostname = window.location.hostname;
  const ua = navigator.userAgent;

  if (url.searchParams.has('ignore-count') || url.searchParams.has('nocount')) return false;
  if (LOCAL_HOSTNAMES.includes(hostname)) return false;
  if (hostname.endsWith('.test') || hostname.endsWith('.local')) return false;
  if (/^192\.168\./.test(hostname)) return false;
  if (/^10\./.test(hostname)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
  if (BOT_PATTERNS.some(re => re.test(ua))) return false;

  return true;
}

function _plausible(eventName, props) {
  if (typeof window.plausible !== 'function') return;
  try {
    window.plausible(eventName, { props });
  } catch (err) {
    console.warn('[analytics] track failed', err);
  }
}

/**
 * Tracke un événement Plausible. Bloqué en mode for=elle (utiliser trackForElle).
 * Fire-and-forget, ne bloque jamais le flux UI.
 */
export function track(eventName, props = {}) {
  if (!_shouldSend()) return;
  if (isForElle()) return;
  _plausible(eventName, props);
}

/**
 * Tracke un événement et ouvre l'URL dans un nouvel onglet après 150ms.
 * Garantit que Plausible reçoit l'event avant la navigation.
 */
export function trackAndNavigate(eventName, url, props = {}) {
  track(eventName, props);
  setTimeout(() => window.open(url, '_blank', 'noopener'), 150);
}

/**
 * Tracke un événement spécifique au mode for=elle. Ne déclenche jamais hors mode.
 */
export function trackForElle(eventName, props = {}) {
  if (!isForElle()) return;
  if (!_shouldSend()) return;
  _plausible(`For Elle ${eventName}`, props);
}

import { SUPA_URL, SUPA_PUBLISHABLE_KEY } from "./config.js";

const SESSION_KEY = "lrz_visit_counted";
const STARTED_DATE = "7 juin 2025";
const DIGIT_HEIGHT = 16;

function shouldCountVisit() {
  const url = new URL(window.location.href);
  const hostname = window.location.hostname;
  const ua = navigator.userAgent;

  if (url.searchParams.has("ignore-count") || url.searchParams.has("nocount")) return false;

  const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
  if (LOCAL_HOSTNAMES.includes(hostname)) return false;
  if (hostname.endsWith(".test") || hostname.endsWith(".local")) return false;

  if (/^192\.168\./.test(hostname)) return false;
  if (/^10\./.test(hostname)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;

  if (sessionStorage.getItem(SESSION_KEY) === "1") return false;

  const BOT_PATTERNS = [
    /googlebot/i, /bingbot/i, /slurp/i, /duckduckbot/i, /baiduspider/i,
    /yandexbot/i, /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
    /whatsapp/i, /telegrambot/i, /discordbot/i, /applebot/i,
    /headless/i, /phantomjs/i, /puppeteer/i, /playwright/i, /selenium/i,
  ];
  if (BOT_PATTERNS.some((re) => re.test(ua))) return false;

  return true;
}

async function callRpc(fn) {
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPA_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPA_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) throw new Error(`${fn} → HTTP ${res.status}`);
  return res.json();
}

async function loadVisitCount() {
  try {
    return await callRpc("get_visit_count");
  } catch (err) {
    console.warn("[visit-counter] read failed", err);
    return null;
  }
}

async function tryIncrementVisitCount() {
  if (!shouldCountVisit()) return null;
  try {
    const newCount = await callRpc("increment_visit_count");
    sessionStorage.setItem(SESSION_KEY, "1");
    return newCount;
  } catch (err) {
    console.warn("[visit-counter] increment failed", err);
    return null;
  }
}

function padDigits(count, length = 6) {
  return String(count).padStart(length, "0").split("");
}

function buildDigitHTML(d) {
  const strips = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((n) => `<span>${n}</span>`)
    .join("");
  return `<span class="lrz-visit-counter__digit">
    <span class="lrz-visit-counter__digit-strip" style="transform:translateY(${-d * DIGIT_HEIGHT}px)">${strips}</span>
  </span>`;
}

function buildCounterHTML(count) {
  const digitHTML = padDigits(count).map(Number).map(buildDigitHTML).join("");
  return `
    <div class="lrz-visit-counter__digits">${digitHTML}</div>
    <span class="lrz-visit-counter__label">CYCLONAUTES</span>
  `;
}

function animateToCount(container, newCount) {
  const digits = padDigits(newCount).map(Number);
  const strips = container.querySelectorAll(".lrz-visit-counter__digit-strip");
  digits.forEach((d, i) => {
    const el = strips[i];
    if (!el) return;
    el.style.transform = `translateY(${-d * DIGIT_HEIGHT}px)`;
  });
}

export async function initVisitCounter() {
  const container = document.createElement("aside");
  container.className = "lrz-visit-counter";
  container.setAttribute("aria-label", "Compteur de visites");
  document.body.appendChild(container);

  const currentCount = await loadVisitCount();
  if (currentCount === null) {
    container.remove();
    return;
  }

  container.innerHTML = buildCounterHTML(currentCount);

  setTimeout(async () => {
    const newCount = await tryIncrementVisitCount();
    if (newCount !== null && newCount !== currentCount) {
      animateToCount(container, newCount);
    }
  }, 1200);
}

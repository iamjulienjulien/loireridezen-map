import { SUPA_URL, SUPA_PUBLISHABLE_KEY } from "./config.js";
import { isForElle } from "./url-mode.js";
import { currentPositionLayer } from "./current-position.js";
import { map } from "./map.js";

const COOLDOWN_MS = 60_000;
let cooldownEnd = 0;

function shouldSendBisou() {
  const url = new URL(window.location.href);
  const hostname = window.location.hostname;
  const ua = navigator.userAgent;

  if (url.searchParams.has("ignore-count") || url.searchParams.has("nocount")) return false;

  const LOCAL = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
  if (LOCAL.includes(hostname)) return false;
  if (hostname.endsWith(".test") || hostname.endsWith(".local")) return false;
  if (/^192\.168\./.test(hostname)) return false;
  if (/^10\./.test(hostname)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;

  const BOTS = [
    /googlebot/i, /bingbot/i, /slurp/i, /duckduckbot/i, /baiduspider/i,
    /yandexbot/i, /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
    /whatsapp/i, /telegrambot/i, /discordbot/i, /applebot/i,
    /headless/i, /phantomjs/i, /puppeteer/i, /playwright/i, /selenium/i,
  ];
  if (BOTS.some((re) => re.test(ua))) return false;

  return true;
}

function isDebugContext() {
  const url = new URL(window.location.href);
  const h = window.location.hostname;
  return url.searchParams.has("ignore-count") ||
    url.searchParams.has("nocount") ||
    ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(h) ||
    h.endsWith(".test") || h.endsWith(".local");
}

function getButtonCenter() {
  const btn = document.querySelector(".lrz-bisou-button");
  if (!btn) return { x: window.innerWidth / 2, y: window.innerHeight * 0.8 };
  const r = btn.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function getPapaPoint() {
  try {
    const latlng = currentPositionLayer.getLatLng();
    if (!latlng || (latlng.lat === 0 && latlng.lng === 0)) throw new Error();
    const p = map.latLngToContainerPoint(latlng);
    const mapEl = document.getElementById("map");
    const rect = mapEl ? mapEl.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: rect.left + p.x, y: rect.top + p.y };
  } catch {
    return { x: window.innerWidth / 2, y: window.innerHeight / 3 };
  }
}

function flyHeartToPapa() {
  const from = getButtonCenter();
  const to = getPapaPoint();
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const el = document.createElement("span");
  el.textContent = "💗";
  el.style.cssText = [
    `position:fixed`,
    `left:${from.x}px`,
    `top:${from.y}px`,
    `font-size:32px`,
    `line-height:1`,
    `pointer-events:none`,
    `z-index:9999`,
    `transform:translate(-50%,-50%)`,
    `opacity:1`,
  ].join(";");
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = "transform 1200ms cubic-bezier(0.25,0.46,0.45,0.94), opacity 300ms ease";
      el.style.transform = `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(1.5)`;
    });
  });

  setTimeout(() => { el.style.opacity = "0"; }, 900);
  setTimeout(() => { el.remove(); }, 1300);
}

function showToast(message) {
  const existing = document.querySelector(".lrz-bisou-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "lrz-bisou-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("lrz-bisou-toast--visible"));
  });

  setTimeout(() => {
    toast.classList.remove("lrz-bisou-toast--visible");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function startCooldownUI() {
  const btn = document.querySelector(".lrz-bisou-button");
  if (!btn) return;
  btn.disabled = true;

  const interval = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
    if (remaining === 0) {
      btn.innerHTML = "💗 Envoyer un bisou";
      btn.disabled = false;
      clearInterval(interval);
      return;
    }
    btn.innerHTML = `💗 <span class="lrz-bisou-button__cooldown">${remaining}s</span>`;
  }, 1000);
}

async function sendBisou() {
  if (Date.now() < cooldownEnd) return;

  flyHeartToPapa();

  if (!shouldSendBisou()) {
    showToast(isDebugContext() ? "Bisou simulé 💗 (mode test)" : "Papa va le recevoir 💗");
    return;
  }

  cooldownEnd = Date.now() + COOLDOWN_MS;
  startCooldownUI();

  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/send_bisou`, {
      method: "POST",
      headers: {
        apikey: SUPA_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPA_PUBLISHABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast("Papa va le recevoir 💗");
  } catch (err) {
    console.warn("[bisou] send failed", err);
    showToast("Bisou pas envoyé, mais Papa pense à toi 💗");
    cooldownEnd = 0;
    const btn = document.querySelector(".lrz-bisou-button");
    if (btn) { btn.innerHTML = "💗 Envoyer un bisou"; btn.disabled = false; }
  }
}

export function initBisouButton() {
  if (!isForElle()) return;

  const btn = document.createElement("button");
  btn.className = "lrz-bisou-button";
  btn.innerHTML = "💗 Envoyer un bisou";
  btn.setAttribute("aria-label", "Envoyer un bisou à Papa");
  btn.addEventListener("click", sendBisou);

  const wrapper = document.querySelector(".lrz-bottom-right");
  if (wrapper) {
    wrapper.insertBefore(btn, wrapper.firstChild);
  } else {
    document.body.appendChild(btn);
  }
}

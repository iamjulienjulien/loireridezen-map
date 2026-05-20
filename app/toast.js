/**
 * app/toast.js — Système de toasts léger
 * API : showToast(msg, variant, duration)
 * variant: "info" | "success" | "error"
 */

let container = null;

function getContainer() {
  if (!container) {
    container = document.createElement("div");
    container.className = "lrz-toast-container";
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(msg, variant = "info", duration = 3500) {
  const c = getContainer();
  const toast = document.createElement("div");
  toast.className = `lrz-toast lrz-toast--${variant}`;
  toast.textContent = msg;
  c.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("lrz-toast--visible"));

  setTimeout(() => {
    toast.classList.remove("lrz-toast--visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, duration);
}

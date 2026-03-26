// utils.js — shared utility functions used across modules

export function showMessage(el, text, type = "info") {
  if (!el) return;
  el.textContent = text;
  el.className   = "message";
  if (text) el.classList.add(type);
}

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ppTodayIso is an alias used by the partial payment wizard
export function ppTodayIso() {
  return todayIso();
}

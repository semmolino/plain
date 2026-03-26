// numberRanges.js — Nummernkreise view
import { API_BASE } from "./config.js";
import { showMessage } from "./utils.js";

let __nrBound = false;

function nrYear() {
  return new Date().getFullYear();
}

function nrFormat(counter) {
  const y = nrYear();
  const c = String(Math.max(0, parseInt(counter || "0", 10) || 0)).padStart(4, "0");
  return `RE-${y}-${c}`;
}

function nrFormatProject(counter) {
  const y = nrYear();
  const yy = String(y % 100).padStart(2, "0");
  const c = String(Math.max(0, parseInt(counter || "0", 10) || 0)).padStart(3, "0");
  return `P-${yy}-${c}`;
}

function nrUpdatePreviews() {
  const c = document.getElementById("nr-next")?.value;
  const prev = document.getElementById("nr-preview");
  if (prev) prev.textContent = c ? `Vorschau: ${nrFormat(c)}` : "";

  const prjC = document.getElementById("nr-project-next")?.value;
  const prjPrev = document.getElementById("nr-project-preview");
  if (prjPrev) prjPrev.textContent = prjC ? `Vorschau: ${nrFormatProject(prjC)}` : "";
}

export async function initNumberRangesView() {
  const msg = document.getElementById("nr-msg");
  const nextEl = document.getElementById("nr-next");
  const prjNextEl = document.getElementById("nr-project-next");
  const saveBtn = document.getElementById("nr-save");

  if (!nextEl || !prjNextEl || !saveBtn) return;

  const showNrMsg = (t, type) => {
    if (!msg) return;
    showMessage(msg, t, type);
  };

  if (!__nrBound) {
    __nrBound = true;

    [nextEl, prjNextEl].forEach((el) => el.addEventListener("input", nrUpdatePreviews));

    saveBtn.addEventListener("click", async () => {
      const val = parseInt(nextEl.value || "0", 10);
      const prjVal = parseInt(prjNextEl.value || "0", 10);
      const valid9999 = (v) => Number.isFinite(v) && v >= 1 && v <= 9999;
      const valid999 = (v) => Number.isFinite(v) && v >= 1 && v <= 999;
      if (!valid9999(val) || !valid999(prjVal)) {
        return showNrMsg("Bitte gültige Werte eingeben (Global: 1–9999, Projekt: 1–999)", "error");
      }

      try {
        showNrMsg("Speichere …", "info");
        const res = await fetch(`${API_BASE}/number-ranges/set`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year: nrYear(), next_counter: val, project_next_counter: prjVal }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

        await nrLoadRanges();
        showNrMsg("Gespeichert", "success");
      } catch (e) {
        showNrMsg("Fehler: " + (e.message || e), "error");
      }
    });
  }

  await nrLoadRanges();
}

async function nrLoadRanges() {
  const msg = document.getElementById("nr-msg");
  const nextEl = document.getElementById("nr-next");
  const prjNextEl = document.getElementById("nr-project-next");
  const showNrMsg = (t, type) => msg && showMessage(msg, t, type);

  if (!nextEl || !prjNextEl) return;

  const res = await fetch(`${API_BASE}/number-ranges?year=${encodeURIComponent(nrYear())}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Nummernkreise");

  nextEl.value = String(json?.next_counter ?? 1);
  prjNextEl.value = String(json?.project_next_counter ?? 1);
  nrUpdatePreviews();
}

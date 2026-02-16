const API_BASE = "http://localhost:3000/api";
let __billingTypesCache = null;

// Abschlagsrechnung wizard draft cancellation handling
let __ppCancelOnUnload = false;
// Current draft PARTIAL_PAYMENT id (created via /partial-payments/init)
let __ppId = null;
// Prevent duplicate draft creation via double-clicks / slow network
let __ppInitInFlight = false;

async function getBillingTypes() {
  if (Array.isArray(__billingTypesCache)) return __billingTypesCache;
  const res = await fetch(`${API_BASE}/stammdaten/billing-types`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Abrechnungsarten");
  __billingTypesCache = Array.isArray(json.data) ? json.data : [];
  return __billingTypesCache;
}


// Utility to show/hide views
function showView(viewId) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(viewId)?.classList.remove("hidden");
}

function isViewActive(viewId) {
  const el = document.getElementById(viewId);
  return !!el && !el.classList.contains("hidden");
}

// If the user leaves an active wizard with an existing draft, confirm abort and delete draft.
async function guardLeaveDraftIfNeeded() {
  // Rechnungen wizard
  if (isViewActive("view-rechnungen") && __invId) {
    const ok = window.confirm(
      "Möchten Sie den Vorgang abbrechen? Alle ungespeicherten Daten werden gelöscht."
    );
    if (!ok) return false;

    const okDelete = await invDeleteDraftIfAny();
    if (!okDelete) {
      const msgEl = document.getElementById("inv-msg-1");
      showMessage(
        msgEl,
        "Entwurf konnte nicht gelöscht werden. Bitte versuchen Sie es erneut.",
        "error"
      );
      return false;
    }

    __invCancelOnUnload = false;
    invReset();
  }

  // Abschlagsrechnung wizard
  if (isViewActive("view-abschlagsrechnung") && __ppId) {
    const ok = window.confirm(
      "Möchten Sie den Vorgang abbrechen? Alle ungespeicherten Daten werden gelöscht."
    );
    if (!ok) return false;

    const okDelete = await ppDeleteDraftIfAny();
    if (!okDelete) {
      const msgEl = document.getElementById("pp-msg-1");
      showMessage(
        msgEl,
        "Entwurf konnte nicht gelöscht werden. Bitte versuchen Sie es erneut.",
        "error"
      );
      return false;
    }

    __ppCancelOnUnload = false;
    ppReset();
  }

  return true;
}


// UI message helper
function showMessage(el, text, type = "") {
  if (!el) return;
  const t = String(text || "");
  el.textContent = t;

  // Ensure visibility toggles correctly. Many message containers are hidden by default in CSS.
  const hasText = t.trim().length > 0;
  el.style.display = hasText ? "block" : "none";

  el.classList.remove("error", "success", "info");
  if (type) el.classList.add(type);
}


// Escape text for safe HTML attribute insertion
function escapeHtml(value) {
  const s = String(value ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Debounce helper (used for search inputs)
function debounce(fn, delayMs = 250) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), delayMs);
  };
}

// ----------------------------
// Reporting (Project)
// ----------------------------
function buildStructureTree(structureRows) {
  const byId = new Map();
  for (const r of Array.isArray(structureRows) ? structureRows : []) {
    if (r && r.STRUCTURE_ID != null) byId.set(r.STRUCTURE_ID, { ...r, children: [] });
  }

  const root = { id: "__PROJECT_ROOT__", children: [] };

  for (const node of byId.values()) {
    const parentId = node.PARENT_STRUCTURE_ID ?? node.FATHER_ID ?? null;
    if (parentId == null) {
      root.children.push(node);
    } else {
      const parent = byId.get(parentId);
      if (parent) parent.children.push(node);
      else root.children.push(node); // orphan safety
    }
  }

  return root;
}

function flattenTree(root) {
  const out = [];
  const visited = new Set();

  function walk(node, depth) {
    if (!node) return;
    const key = node.STRUCTURE_ID ?? node.id;
    if (key != null) {
      // prevent infinite loops if bad data
      const visitKey = `${key}@${depth}`;
      if (visited.has(visitKey)) return;
      visited.add(visitKey);
    }

    if (node.STRUCTURE_ID != null) out.push({ node, depth });
    const children = Array.isArray(node.children) ? node.children : [];
    // Stable ordering: by parent then id
    children.sort((a, b) => {
      const pa = a.PARENT_STRUCTURE_ID ?? a.FATHER_ID ?? -1;
      const pb = b.PARENT_STRUCTURE_ID ?? b.FATHER_ID ?? -1;
      if (pa !== pb) return pa < pb ? -1 : 1;
      return (a.STRUCTURE_ID ?? 0) - (b.STRUCTURE_ID ?? 0);
    });
    for (const ch of children) walk(ch, depth + 1);
  }

  for (const ch of (root.children || [])) walk(ch, 0);
  return out;
}

// ----------------------------
// Dashboard search (projects)
// ----------------------------
let __dashProjectsCache = null;

async function dashLoadProjectsOnce() {
  if (Array.isArray(__dashProjectsCache)) return __dashProjectsCache;
  const res = await fetch(`${API_BASE}/projekte/list?limit=2000`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Projekte konnten nicht geladen werden");
  __dashProjectsCache = Array.isArray(json.data) ? json.data : [];
  return __dashProjectsCache;
}

function dashRenderSuggestions(items, query) {
  const box = document.getElementById("dash-search-suggest");
  if (!box) return;
  const q = String(query || "").trim().toLowerCase();
  if (!q || !Array.isArray(items) || items.length === 0) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  const top = items.slice(0, 8);
  box.innerHTML = top
    .map((p) => {
      const label = `${escapeHtml(p.NAME_SHORT || "")} — ${escapeHtml(p.NAME_LONG || "")}`.replace(/\s+—\s+$/, "");
      return `
        <div class="suggest-item" role="button" tabindex="0" data-proj-id="${escapeHtml(p.ID)}" data-proj-q="${escapeHtml(q)}">
          <span class="suggest-pill">Projekt</span>
          <div class="suggest-text">${label}</div>
        </div>
      `;
    })
    .join("");

  box.classList.remove("hidden");
}

async function dashGoToProjectSearch(query) {
  const q = String(query || "").trim();
  if (!q) return;
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-projektliste");
  setBottomNavActive("view-projekte-menu");
  await loadProjektListe();
  const inp = document.getElementById("prj-list-global");
  if (inp) {
    inp.value = q;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// Local date -> YYYY-MM-DD
function todayIso() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Backwards compatibility (used in partial payment wizard)
function ppTodayIso() {
  return todayIso();
}


// Nav

function bindClick(id, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("click", handler);
}

function setBottomNavActive(targetId) {
  document.querySelectorAll(".bottom-nav-item").forEach((b) => b.classList.remove("active"));
  const btn = document.querySelector(`.bottom-nav-item[data-target="${targetId}"]`);
  if (btn) btn.classList.add("active");
}

// New dashboard/menu navigation
bindClick("nav-admin", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-administration");
  setBottomNavActive("view-administration");
});

bindClick("nav-mitarbeiter", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-mitarbeiter");
  setBottomNavActive("view-mitarbeiter");
});

bindClick("nav-adressen", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-adressen-kontakte");
  setBottomNavActive("view-adressen-kontakte");
});

bindClick("nav-projekte", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-projekte-menu");
  setBottomNavActive("view-projekte-menu");
});

bindClick("nav-projektdaten", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-projektdaten-menu");
  setBottomNavActive("view-projektdaten-menu");
});

bindClick("nav-rechnungen", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-vertraege-rechnungen-menu");
  setBottomNavActive("view-vertraege-rechnungen-menu");
});

// Quick actions
bindClick("qa-stunden-buchen", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  __buchungEditId = null;
  __buchungEditReturnProjectId = "";
  const saveBtn = document.getElementById("btn-save-buchung");
  if (saveBtn) saveBtn.textContent = "Speichern";
  loadBuchungDropdowns();
  showView("view-buchung");
  setBottomNavActive("view-projektdaten-menu");
});

bindClick("qa-abschlagsrechnung", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  await initPartialPaymentWizard();
  showView("view-abschlagsrechnung");
  setBottomNavActive("view-vertraege-rechnungen-menu");
});

bindClick("qa-rechnung", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  await initInvoiceWizard();
  showView("view-rechnungen");
  setBottomNavActive("view-vertraege-rechnungen-menu");
});

bindClick("qa-rechnungsliste", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-rechnungsliste");
  await loadRechnungsliste();
  setBottomNavActive("view-vertraege-rechnungen-menu");
});

// Menu pages -> existing views
bindClick("btn-adresse-anlegen", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  await loadCountriesForAddress();
  showView("view-address");
});

bindClick("btn-adressenliste", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-addressliste");
  await loadAddressListe();
});

bindClick("btn-kontakt-anlegen", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  await Promise.all([loadSalutationsForKontakte(), loadGendersForKontakte()]);
  resetKontakteAddressSelection();
  showView("view-kontakte");
});

bindClick("btn-kontaktliste", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-kontaktliste");
  await loadKontaktListe();
});

bindClick("btn-projekt-anlegen", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-projekte");
  try { await prjInitWizard(); } catch (e) {
    showMessage(document.getElementById("msg-projekt"), "Fehler: " + (e.message || e), "error");
  }
});

bindClick("btn-projektstruktur-menu", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  // reuse existing wiring
  wireProjektstrukturNeu();
  psMsg("", "");
  psShowTable(false);
  showView("view-projektstruktur");
});

bindClick("btn-projektliste-menu", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-projektliste");
  await loadProjektListe();
});

bindClick("btn-stunden-buchen-menu", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  __buchungEditId = null;
  __buchungEditReturnProjectId = "";
  const saveBtn = document.getElementById("btn-save-buchung");
  if (saveBtn) saveBtn.textContent = "Speichern";
  loadBuchungDropdowns();
  showView("view-buchung");
});

bindClick("btn-buchungsliste-menu", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  loadBuchungslisteProjects();
  showView("view-buchungsliste");
});

bindClick("btn-leistungsstaende-menu", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  wireLeistungsstaende();
  lsMsg("", "");
  lsShowTable(false);
  showView("view-leistungsstaende");
});

bindClick("btn-abschlagsrechnungen-menu", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  await initPartialPaymentWizard();
  showView("view-abschlagsrechnung");
});

bindClick("btn-rechnungen-menu", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  await initInvoiceWizard();
  showView("view-rechnungen");
});

bindClick("btn-zahlungen-menu", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-zahlungen");
});

bindClick("btn-rechnungsliste-menu", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-rechnungsliste");
  await loadRechnungsliste();
});

// Bottom nav click handling
function initBottomNav() {
  const bottomNav = document.getElementById("bottom-nav");
  if (!bottomNav) return;

  bottomNav.querySelectorAll(".bottom-nav-item").forEach((btn) => {
    // prevent double binding
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";

    btn.addEventListener("click", async () => {
      if (!(await guardLeaveDraftIfNeeded())) return;
      const target = btn.getAttribute("data-target");
      if (!target) return;
      showView(target);
      setBottomNavActive(target);

      // Lazy loading for list views
      if (target === "view-rechnungsliste") await loadRechnungsliste();
      if (target === "view-projektliste") await loadProjektListe();
      if (target === "view-mitarbeiterliste") await loadMitarbeiterListe();
    });
  });
}

function initDashboardSearch() {
  const input = document.getElementById("dash-search");
  const box = document.getElementById("dash-search-suggest");
  if (!input) return;

  const doSuggest = debounce(async () => {
    const q = String(input.value || "").trim();
    if (q.length < 2) {
      dashRenderSuggestions([], "");
      return;
    }
    try {
      const all = await dashLoadProjectsOnce();
      const qq = q.toLowerCase();
      const matches = all.filter((p) => {
        const blob = `${p.NAME_SHORT || ""} ${p.NAME_LONG || ""}`.toLowerCase();
        return blob.includes(qq);
      });
      dashRenderSuggestions(matches, q);
    } catch (e) {
      // If search suggestions fail (e.g. backend not reachable), just hide suggestions.
      dashRenderSuggestions([], "");
    }
  }, 250);

  input.addEventListener("input", doSuggest);
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      dashRenderSuggestions([], "");
      await dashGoToProjectSearch(input.value);
    }
    if (e.key === "Escape") {
      dashRenderSuggestions([], "");
    }
  });

  // click outside -> close
  document.addEventListener("click", (e) => {
    if (!box || box.classList.contains("hidden")) return;
    if (e.target === input) return;
    if (box.contains(e.target)) return;
    dashRenderSuggestions([], "");
  });

  // click suggestion -> open project list filtered
  box?.addEventListener("click", async (e) => {
    const item = e.target?.closest?.(".suggest-item");
    if (!item) return;
    const q = input.value;
    dashRenderSuggestions([], "");
    await dashGoToProjectSearch(q);
  });
}

// Ensure handlers are bound even if parts of the DOM appear after this script tag
document.addEventListener("DOMContentLoaded", () => {
  initBottomNav();
  initDashboardSearch();
});


document.getElementById("btn-administration")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-administration");
});


document.getElementById("btn-mitarbeiter")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-mitarbeiter");
});

document.getElementById("btn-mitarbeiter-anlegen")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  await loadGeschlechter();
  showView("view-mitarbeiter-anlegen");
});

document.getElementById("btn-mitarbeiter-liste")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-mitarbeiterliste");
  await loadMitarbeiterListe();
});

document.getElementById("btn-back-mitarbeiter-anlegen")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-mitarbeiter");
});

document.getElementById("btn-back-mitarbeiterliste")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-mitarbeiter");
});


document.getElementById("btn-projektuebersicht")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-vertraege-rechnungen-menu");
});

document.getElementById("btn-stammdaten").addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-stammdaten");
});

document.getElementById("btn-unternehmen").addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  await loadCountriesForUnternehmen();
  showView("view-unternehmen");
});

document.getElementById("btn-address")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  await loadCountriesForAddress();
  showView("view-address");
});

// Anschriftenliste
document.getElementById("btn-address-liste")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-addressliste");
  await loadAddressListe();
});

document.getElementById("btn-rollen")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-rollen");
});

document.getElementById("btn-kontakte")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  await Promise.all([
    loadSalutationsForKontakte(),
    loadGendersForKontakte()
  ]);
  resetKontakteAddressSelection();
  showView("view-kontakte");
});

// Kontaktliste
document.getElementById("btn-kontakte-liste")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-kontaktliste");
  await loadKontaktListe();
});

// Dokumente / Vorlagen
document.getElementById("btn-dokumente")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-dokumente");
  await initDocumentsView();
});

// Nummernkreise
let __nrBound = false;

document.getElementById("btn-nummernkreise")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-nummernkreise");
  await initNumberRangesView();
});

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

async function initNumberRangesView() {
  const msg = document.getElementById("nr-msg");
  const companySel = document.getElementById("nr-company");
  const nextEl = document.getElementById("nr-next");
  const prjNextEl = document.getElementById("nr-project-next");
  const saveBtn = document.getElementById("nr-save");

  if (!companySel || !nextEl || !prjNextEl || !saveBtn) return;

  const showNrMsg = (t, type) => {
    if (!msg) return;
    showMessage(msg, t, type);
  };

  if (!__nrBound) {
    __nrBound = true;

    companySel.addEventListener("change", () => {
      nrLoadRangesForCompany(companySel.value).catch((e) => showNrMsg("Fehler: " + e.message, "error"));
    });

    [nextEl, prjNextEl].forEach((el) => el.addEventListener("input", nrUpdatePreviews));

    saveBtn.addEventListener("click", async () => {
      const companyId = companySel.value;
      if (!companyId) return showNrMsg("Bitte ein Unternehmen auswählen", "error");
      const val = parseInt(nextEl.value || "0", 10);
      const prjVal = parseInt(prjNextEl.value || "0", 10);
      const valid9999 = (v) => Number.isFinite(v) && v >= 1 && v <= 9999;
      const valid999 = (v) => Number.isFinite(v) && v >= 1 && v <= 999;
      if (!valid9999(val) || !valid999(prjVal)) {
        return showNrMsg("Bitte gültige Werte eingeben (Global: 1–9999, Projekt: 1–999)", "error");
      }

      try {
        showNrMsg("Speichere …", "info");
        const year = nrYear();

        const res = await fetch(`${API_BASE}/number-ranges/set`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company_id: companyId,
            year,
            next_counter: val,
            project_next_counter: prjVal,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

        await nrLoadRangesForCompany(companyId);
        showNrMsg("Gespeichert", "success");
      } catch (e) {
        showNrMsg("Fehler: " + (e.message || e), "error");
      }
    });
  }

  // Load companies
  companySel.innerHTML = `<option value="">Bitte wählen …</option>`;
  try {
    const res = await fetch(`${API_BASE}/stammdaten/companies`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Firmen");
    (json.data || []).forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.ID;
      opt.textContent = c.NAME_SHORT || c.NAME_LONG || `Firma ${c.ID}`;
      companySel.appendChild(opt);
    });
  } catch (e) {
    showNrMsg("Fehler: " + (e.message || e), "error");
    return;
  }

  // If only one company exists, preselect
  if (companySel.options.length === 2) {
    companySel.value = companySel.options[1].value;
  }

  await nrLoadRangesForCompany(companySel.value);
}

async function nrLoadRangesForCompany(companyId) {
  const msg = document.getElementById("nr-msg");
  const nextEl = document.getElementById("nr-next");
  const prjNextEl = document.getElementById("nr-project-next");
  const showNrMsg = (t, type) => msg && showMessage(msg, t, type);

  if (!nextEl || !prjNextEl) return;

  if (!companyId) {
    nextEl.value = "";
    prjNextEl.value = "";
    nrUpdatePreviews();
    showNrMsg("", "success");
    return;
  }

  const year = nrYear();
  const res = await fetch(`${API_BASE}/number-ranges?company_id=${encodeURIComponent(companyId)}&year=${encodeURIComponent(year)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Nummernkreise");

  nextEl.value = String(json?.next_counter ?? 1);
  prjNextEl.value = String(json?.project_next_counter ?? 1);
  nrUpdatePreviews();
}


document.getElementById("btn-projekte").addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-projekte");
  try {
    await prjInitWizard();
  } catch (e) {
    showMessage(document.getElementById("msg-projekt"), "Fehler: " + (e.message || e), "error");
  }
});
document.querySelectorAll(".btn-back").forEach((btn) => {
  // Wizards with custom abort/back handling should not use the generic handler.
  if (btn.id === "pp-back-1" || btn.id === "inv-back-1") return;
  btn.addEventListener("click", async () => {
    if (!(await guardLeaveDraftIfNeeded())) return;

    // Special case: when editing a booking, go back to Buchungsliste instead of main menu
    const viewBuchung = document.getElementById("view-buchung");
    if (viewBuchung && !viewBuchung.classList.contains("hidden") && __buchungEditId) {
      const returnProjectId = __buchungEditReturnProjectId;
      __buchungEditId = null;
      __buchungEditReturnProjectId = "";
      const saveBtn = document.getElementById("btn-save-buchung");
      if (saveBtn) saveBtn.textContent = "Speichern";

      await loadBuchungslisteProjects();
      showView("view-buchungsliste");
      const sel = document.getElementById("select-buchungsliste-projekt");
      if (sel && returnProjectId) sel.value = returnProjectId;
      if (returnProjectId) await loadTecListForProject(returnProjectId);
      return;
    }

    showView("main-menu");
  });
});

document.getElementById("btn-projektliste").addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-projektliste");
  await loadProjektListe();
});

// Rechnungsliste (Abschlagsrechnungen)
document.getElementById("btn-rechnungsliste")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-rechnungsliste");
  await loadRechnungsliste();
});

document.getElementById("btn-buchung").addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  // New booking mode
  __buchungEditId = null;
  __buchungEditReturnProjectId = "";
  const saveBtn = document.getElementById("btn-save-buchung");
  if (saveBtn) saveBtn.textContent = "Speichern";
  loadBuchungDropdowns();
  showView("view-buchung");
});

document.getElementById("btn-buchungsliste").addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  loadBuchungslisteProjects();
  showView("view-buchungsliste");
});

// Abschlagsrechnung wizard
document.getElementById("btn-abschlagsrechnung")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  await initPartialPaymentWizard();
  showView("view-abschlagsrechnung");
});

// Rechnungen wizard (Frontend/Wizard only for now)
document.getElementById("btn-rechnungen")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  await initInvoiceWizard();
  showView("view-rechnungen");
});

// Abschlagsrechnung: Abbruch über "Zurück zur Übersicht" inkl. Löschung des Entwurfs
document.getElementById("pp-back-1")?.addEventListener(
  "click",
  async (e) => {
    // Prevent the generic .btn-back handler from switching views immediately
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

    // If no draft exists yet, simply go back
    if (!__ppId) {
      ppReset();
      showView("view-vertraege-rechnungen-menu");
      return;
    }

    const text = "Möchten Sie den Vorgang abbrechen? Alle ungespeicherten Daten werden gelöscht.";
    const ok = window.confirm(text);
    if (!ok) return;

    const okDelete = await ppDeleteDraftIfAny();
    if (!okDelete) {
      // Do not navigate away if we could not delete the draft.
      const msgEl = document.getElementById("pp-msg-1");
      showMessage(msgEl, "Entwurf konnte nicht gelöscht werden. Bitte versuchen Sie es erneut.", "error");
      return;
    }
    __ppCancelOnUnload = false;
    ppReset();
    showView("view-vertraege-rechnungen-menu");
  },
  true // capture: ensure we run before other click handlers
);


// Rechnungen: Abbruch über "Zurück zur Übersicht" inkl. Löschung des Entwurfs
document.getElementById("inv-back-1")?.addEventListener(
  "click",
  async (e) => {
    // Prevent the generic .btn-back handler from switching views immediately
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

    // If no draft exists yet, simply go back
    if (!__invId) {
      invReset();
      showView("view-vertraege-rechnungen-menu");
      return;
    }

    const text =
      "Möchten Sie den Vorgang abbrechen? Alle ungespeicherten Daten werden gelöscht.";
    const ok = window.confirm(text);
    if (!ok) return;

    const okDelete = await invDeleteDraftIfAny();
    if (!okDelete) {
      const msgEl = document.getElementById("inv-msg-1");
      showMessage(
        msgEl,
        "Entwurf konnte nicht gelöscht werden. Bitte versuchen Sie es erneut.",
        "error"
      );
      return;
    }

    __invCancelOnUnload = false;
    invReset();
    showView("view-vertraege-rechnungen-menu");
  },
  true // capture
);

// Abschlagsrechnung: Warnung beim Schließen/Neuladen des Tabs, solange ein Entwurf existiert.
// Hinweis: Browser zeigen hier einen Standard-Dialog; Texte können je nach Browser abweichen.
window.addEventListener("beforeunload", (e) => {
  // Only warn when Abschlagsrechnung view is active and a draft exists
  const view = document.getElementById("view-abschlagsrechnung");
  if (!view || view.classList.contains("hidden")) return;
  if (!__ppId) return;

  __ppCancelOnUnload = true;
  const msg = "Möchten Sie den Vorgang abbrechen? Alle ungespeicherten Daten werden gelöscht.";
  e.preventDefault();
  e.returnValue = msg;
  return msg;
});

// Best-effort draft deletion when the page actually unloads (user confirmed leaving)
window.addEventListener("pagehide", () => {
  if (!__ppCancelOnUnload) return;
  // Fire-and-forget
  ppDeleteDraftIfAny();
});

// Rechnungen: Warnung beim Schließen/Neuladen des Tabs, solange ein Entwurf existiert.
window.addEventListener("beforeunload", (e) => {
  const view = document.getElementById("view-rechnungen");
  if (!view || view.classList.contains("hidden")) return;
  if (!__invId) return;

  __invCancelOnUnload = true;
  const msg =
    "Möchten Sie den Vorgang abbrechen? Alle ungespeicherten Daten werden gelöscht.";
  e.preventDefault();
  e.returnValue = msg;
  return msg;
});

// Best-effort draft deletion when the page actually unloads (user confirmed leaving)
window.addEventListener("pagehide", () => {
  if (!__invCancelOnUnload) return;
  invDeleteDraftIfAny();
});

// Zahlungen
document.getElementById("btn-zahlungen")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  paymentsReset();
  showView("view-zahlungen");
});

// Reporting – Projekt (Header + Struktur)
document.getElementById("btn-reporting-project")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  // reset UI
  showMessage(document.getElementById("msg-reporting-project"), "", "");
  const headerBox = document.getElementById("rep-project-header");
  const structureBox = document.getElementById("rep-project-structure");
  if (headerBox) headerBox.innerHTML = "";
  if (structureBox) structureBox.innerHTML = "";
  showView("view-reporting-project");
});

document.getElementById("btn-load-project-report")?.addEventListener("click", async () => {
  const msgEl = document.getElementById("msg-reporting-project");
  const tenantId = String(document.getElementById("rep-tenant-id")?.value || "").trim();
  const projectId = String(document.getElementById("rep-project-id")?.value || "").trim();

  if (!tenantId || !projectId) {
    showMessage(msgEl, "Bitte TENANT_ID und PROJECT_ID angeben.", "error");
    return;
  }

  showMessage(msgEl, "Lade Report …", "info");

  try {
    const [hRes, sRes] = await Promise.all([
      fetch(`${API_BASE}/reports/project/${encodeURIComponent(projectId)}/header?tenant_id=${encodeURIComponent(tenantId)}`),
      fetch(`${API_BASE}/reports/project/${encodeURIComponent(projectId)}/structure?tenant_id=${encodeURIComponent(tenantId)}`),
    ]);

    const hJson = await hRes.json().catch(() => ({}));
    const sJson = await sRes.json().catch(() => ({}));

    if (!hRes.ok) throw new Error(hJson.error || "Header konnte nicht geladen werden");
    if (!sRes.ok) throw new Error(sJson.error || "Struktur konnte nicht geladen werden");

    const header = hJson.data;
    const rows = Array.isArray(sJson.data) ? sJson.data : [];

    // Render header
    const headerBox = document.getElementById("rep-project-header");
    if (headerBox) {
      headerBox.innerHTML = `
        <div class="kv"><div class="k">Projekt</div><div class="v">${escapeHtml(header.PROJECT_NUMBER || "")} – ${escapeHtml(header.PROJECT_NAME || "")}</div></div>
        <div class="kv"><div class="k">Budget</div><div class="v">${escapeHtml(header.BUDGET_TOTAL_NET ?? "")}</div></div>
        <div class="kv"><div class="k">Leistungsstand</div><div class="v">${escapeHtml(header.LEISTUNGSSTAND_VALUE ?? "")}</div></div>
        <div class="kv"><div class="k">Stunden</div><div class="v">${escapeHtml(header.HOURS_TOTAL ?? "")}</div></div>
        <div class="kv"><div class="k">Kosten</div><div class="v">${escapeHtml(header.COST_TOTAL ?? "")}</div></div>
        <div class="kv"><div class="k">Abgerechnet</div><div class="v">${escapeHtml(header.BILLED_NET_TOTAL ?? "")}</div></div>
        <div class="kv"><div class="k">Offen</div><div class="v">${escapeHtml(header.OPEN_NET_TOTAL ?? "")}</div></div>
      `;
    }

    // Build tree and render a simple indented table
    const root = buildStructureTree(rows);
    const flat = flattenTree(root);

    const structureBox = document.getElementById("rep-project-structure");
    if (structureBox) {
      const lines = flat.map(({ node, depth }) => {
        const indent = `padding-left:${depth * 18}px`;
        const label = node.STRUCTURE_NAME_SHORT || node.NAME_SHORT || node.STRUCTURE_ID;
        return `
          <tr>
            <td style="${indent}">${escapeHtml(label)}</td>
            <td>${escapeHtml(node.EARNED_VALUE_NET ?? "")}</td>
            <td>${escapeHtml(node.HOURS_TOTAL ?? "")}</td>
            <td>${escapeHtml(node.COST_TOTAL ?? "")}</td>
          </tr>
        `;
      }).join("");

      structureBox.innerHTML = `
        <table class="report-table">
          <thead>
            <tr>
              <th>Struktur</th>
              <th>Leistungsstand</th>
              <th>Stunden</th>
              <th>Kosten</th>
            </tr>
          </thead>
          <tbody>${lines}</tbody>
        </table>
      `;
    }

    showMessage(msgEl, `OK – ${rows.length} Struktur-Zeilen geladen.`, "success");
  } catch (err) {
    showMessage(msgEl, err.message || String(err), "error");
  }
});


// ----------------------------
// Rechnungsliste (PARTIAL_PAYMENT + INVOICE)
// ----------------------------

// Bump key when changing the available column set/order to avoid stale user config.
const PP_LIST_COLS_STORAGE_KEY = "pp_list_cols_v4";

const __ppList = {
  rows: [],
  sortKey: "DOC_DATE",
  sortDir: "desc",
  page: 1,
  pageSize: 25,
  filters: {},
  global: "",
  columns: [], // ordered column ids
};

function _ppStatusLabel(v) {
  if (String(v) === "2") return "Gebucht";
  if (String(v) === "1") return "Entwurf";
  return v ?? "";
}

function _fmtDate(d) {
  if (!d) return "";
  return String(d);
}

function _fmtMoney(n) {
  const x = typeof n === "number" ? n : parseFloat(String(n ?? ""));
  if (!Number.isFinite(x)) return "";
  return x.toFixed(2);
}

function _calcOpenGross(r) {
  const gross = parseFloat(String(r?.TOTAL_AMOUNT_GROSS ?? ""));
  const paid = parseFloat(String(r?.AMOUNT_PAYED_GROSS ?? ""));
  const g = Number.isFinite(gross) ? gross : 0;
  const p = Number.isFinite(paid) ? paid : 0;
  // If both are missing, keep cell empty
  if (!Number.isFinite(gross) && !Number.isFinite(paid)) return "";
  return g - p;
}

function _str(v) {
  return String(v ?? "").trim();
}

function _includesCI(haystack, needle) {
  return _str(haystack).toLowerCase().includes(_str(needle).toLowerCase());
}

// Column catalog curated by you (allowed + order). Users can still enable/disable and reorder.
const __ppListAllowedColumns = [
  { id: "DOC_NUMBER", label: "Nr.", get: (r) => r.DOC_NUMBER, filterable: true },
  { id: "DOC_TYPE", label: "Typ", get: (r) => r.DOC_TYPE, filterable: true },
  { id: "DOC_DATE", label: "Datum", get: (r) => _fmtDate(r.DOC_DATE), raw: (r) => r.DOC_DATE, filterable: true },
  { id: "STATUS_ID", label: "Status", get: (r) => _ppStatusLabel(r.STATUS_ID), raw: (r) => r.STATUS_ID, filterable: true },
  { id: "DUE_DATE", label: "Fällig", get: (r) => _fmtDate(r.DUE_DATE), raw: (r) => r.DUE_DATE, filterable: true },
  { id: "PROJECT", label: "Projekt", get: (r) => r.PROJECT, filterable: true },
  { id: "CONTRACT", label: "Vertrag", get: (r) => r.CONTRACT, filterable: true },
  { id: "ADDRESS_NAME_1", label: "Adresse", get: (r) => r.ADDRESS_NAME_1, filterable: true },
  { id: "CONTACT", label: "Kontakt", get: (r) => r.CONTACT, filterable: true },
  { id: "TOTAL_AMOUNT_NET", label: "Netto", get: (r) => _fmtMoney(r.TOTAL_AMOUNT_NET), raw: (r) => r.TOTAL_AMOUNT_NET, filterable: true, align: "right" },
  { id: "TAX_AMOUNT_NET", label: "MwSt.", get: (r) => _fmtMoney(r.TAX_AMOUNT_NET), raw: (r) => r.TAX_AMOUNT_NET, filterable: true, align: "right" },
  { id: "TOTAL_AMOUNT_GROSS", label: "Brutto", get: (r) => _fmtMoney(r.TOTAL_AMOUNT_GROSS), raw: (r) => r.TOTAL_AMOUNT_GROSS, filterable: true, align: "right" },
  { id: "AMOUNT_PAYED_GROSS", label: "Bezahlt", get: (r) => _fmtMoney(r.AMOUNT_PAYED_GROSS), raw: (r) => r.AMOUNT_PAYED_GROSS, filterable: true, align: "right" },
  { id: "OPEN_GROSS", label: "Offen", get: (r) => _fmtMoney(_calcOpenGross(r)), raw: (r) => _calcOpenGross(r), filterable: true, align: "right" },
  { id: "COMMENT", label: "Bemerkung", get: (r) => r.COMMENT, filterable: true },
];

const __ppListColMap = Object.fromEntries(__ppListAllowedColumns.map((c) => [c.id, c]));

function _ppListDefaultColumns() {
  // Default selection matches the curated column order.
  return __ppListAllowedColumns.map((c) => c.id);
}

function _ppListLoadColumnsFromStorage() {
  try {
    const raw = localStorage.getItem(PP_LIST_COLS_STORAGE_KEY);
    if (!raw) return _ppListDefaultColumns();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return _ppListDefaultColumns();
    const cleaned = arr.filter((id) => !!__ppListColMap[id]);
    return cleaned.length ? cleaned : _ppListDefaultColumns();
  } catch (_) {
    return _ppListDefaultColumns();
  }
}

function _ppListSaveColumnsToStorage(cols) {
  try {
    localStorage.setItem(PP_LIST_COLS_STORAGE_KEY, JSON.stringify(cols));
  } catch (_) {
    // ignore
  }
}

function _ppListValueForSort(row, colId) {
  const def = __ppListColMap[colId];
  if (!def) return "";
  if (def.raw) return def.raw(row);
  return def.get(row);
}

function _applyPpListTransforms() {
  let rows = Array.isArray(__ppList.rows) ? [...__ppList.rows] : [];

  // Column filters (by visible columns)
  Object.entries(__ppList.filters).forEach(([k, val]) => {
    if (!val) return;
    const def = __ppListColMap[k];
    if (!def) return;
    rows = rows.filter((r) => _includesCI(def.get(r), val));
  });

  // Global filter (across all visible columns)
  if (__ppList.global) {
    const g = __ppList.global;
    const visible = Array.isArray(__ppList.columns) && __ppList.columns.length ? __ppList.columns : _ppListDefaultColumns();
    rows = rows.filter((r) => {
      const blob = visible.map((cid) => __ppListColMap[cid]?.get(r)).join(" | ");
      return _includesCI(blob, g);
    });
  }

  // Sorting
  const key = __ppList.sortKey;
  const dir = __ppList.sortDir;
  rows.sort((a, b) => {
    const av = _ppListValueForSort(a, key);
    const bv = _ppListValueForSort(b, key);
    const an = parseFloat(String(av ?? ""));
    const bn = parseFloat(String(bv ?? ""));
    let cmp = 0;
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      cmp = an - bn;
    } else {
      cmp = _str(av).localeCompare(_str(bv), "de", { numeric: true, sensitivity: "base" });
    }
    return dir === "asc" ? cmp : -cmp;
  });

  return rows;
}

function _renderRechnungslisteTableHead() {
  const thead = document.querySelector("#tbl-rechnungsliste thead");
  if (!thead) return;

  const cols = Array.isArray(__ppList.columns) && __ppList.columns.length ? __ppList.columns : _ppListDefaultColumns();
  const headerCells = cols.map((cid) => {
    const c = __ppListColMap[cid];
    return `<th data-colid="${cid}" class="sortable">${c?.label ?? cid}</th>`;
  }).join("");

  const filterCells = cols.map((cid) => {
    const c = __ppListColMap[cid];
    if (!c?.filterable) return `<th></th>`;
    const ph = cid.includes("DATE") ? "YYYY-MM-DD" : "Filter";
    const val = __ppList.filters[cid] || "";
    return `<th><input data-filter="${cid}" placeholder="${ph}" type="text" value="${val.replace(/"/g, "&quot;")}"/></th>`;
  }).join("");

  thead.innerHTML = `
    <tr>
      ${headerCells}
      <th>Aktion</th>
    </tr>
    <tr class="filter-row">
      ${filterCells}
      <th></th>
    </tr>
  `;

  // Bind filter inputs
  thead.querySelectorAll(".filter-row input[data-filter]").forEach((inp) => {
    inp.addEventListener("input", debounce(() => {
      const k = inp.getAttribute("data-filter");
      __ppList.filters[k] = inp.value || "";
      __ppList.page = 1;
      _renderRechnungsliste();
    }, 250));
  });

  // Bind sorting
  thead.querySelectorAll("tr:first-child th[data-colid]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-colid");
      if (__ppList.sortKey === key) {
        __ppList.sortDir = __ppList.sortDir === "asc" ? "desc" : "asc";
      } else {
        __ppList.sortKey = key;
        __ppList.sortDir = "asc";
      }
      _renderRechnungsliste();
    });
  });
}

function _renderRechnungsliste() {
  const tbody = document.querySelector("#tbl-rechnungsliste tbody");
  const pageInfo = document.getElementById("pp-list-pageinfo");
  if (!tbody) return;

  const cols = Array.isArray(__ppList.columns) && __ppList.columns.length ? __ppList.columns : _ppListDefaultColumns();
  _renderRechnungslisteTableHead();

  const rows = _applyPpListTransforms();
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / __ppList.pageSize));
  if (__ppList.page > pages) __ppList.page = pages;
  if (__ppList.page < 1) __ppList.page = 1;

  const start = (__ppList.page - 1) * __ppList.pageSize;
  const pageRows = rows.slice(start, start + __ppList.pageSize);

  tbody.innerHTML = "";
  pageRows.forEach((r) => {
    const tr = document.createElement("tr");
    const cells = cols.map((cid) => {
      const def = __ppListColMap[cid];
      const align = def?.align ? ` style="text-align:${def.align};"` : "";
      return `<td${align}>${_str(def?.get(r))}</td>`;
    }).join("");

    tr.innerHTML = `
      ${cells}
      <td>
        <button class="btn-small" data-action="edit" data-type="${r.DOC_TYPE}" data-id="${r.DOC_ID}">Bearbeiten</button>
        <button class="btn-small secondary" data-action="pdf" data-type="${r.DOC_TYPE}" data-id="${r.DOC_ID}">PDF</button>
        <button class="btn-small secondary" data-action="xml" data-type="${r.DOC_TYPE}" data-id="${r.DOC_ID}">XML</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (pageInfo) pageInfo.textContent = `Seite ${__ppList.page} / ${pages} (Einträge: ${total})`;
}

async function loadRechnungsliste() {
  const msg = document.getElementById("msg-rechnungsliste");
  try {
    if (!__ppList.columns || __ppList.columns.length === 0) {
      __ppList.columns = _ppListLoadColumnsFromStorage();
    }

    showMessage(msg, "Lade Rechnungsliste …", "");

    const [ppRes, invRes] = await Promise.all([
      fetch(`${API_BASE}/partial-payments?limit=500`),
      fetch(`${API_BASE}/invoices?limit=500`),
    ]);

    const ppJson = await ppRes.json().catch(() => ({}));
    const invJson = await invRes.json().catch(() => ({}));

    if (!ppRes.ok) throw new Error(ppJson.error || "Rechnungsliste (AR) konnte nicht geladen werden");

    const ppRows = Array.isArray(ppJson.data) ? ppJson.data : [];
    const invRows = invRes.ok ? (Array.isArray(invJson.data) ? invJson.data : []) : [];

    // Normalize into a single list
    const merged = [];
    ppRows.forEach((r) => {
      merged.push({
        DOC_TYPE: "AR",
        DOC_ID: r.ID,
        DOC_NUMBER: r.PARTIAL_PAYMENT_NUMBER ?? "",
        DOC_DATE: r.PARTIAL_PAYMENT_DATE ?? null,
        DUE_DATE: r.DUE_DATE ?? null,
        PROJECT: r.PROJECT ?? "",
        CONTRACT: r.CONTRACT ?? "",
        ADDRESS_NAME_1: r.ADDRESS_NAME_1 ?? "",
        CONTACT: r.CONTACT ?? "",
        TOTAL_AMOUNT_NET: r.TOTAL_AMOUNT_NET ?? 0,
        TAX_AMOUNT_NET: r.TAX_AMOUNT_NET ?? 0,
        TOTAL_AMOUNT_GROSS: r.TOTAL_AMOUNT_GROSS ?? 0,
        AMOUNT_PAYED_GROSS: r.AMOUNT_PAYED_GROSS ?? 0,
        COMMENT: r.COMMENT ?? "",
        STATUS_ID: r.STATUS_ID ?? null,
      });
    });
    invRows.forEach((r) => {
      merged.push({
        DOC_TYPE: "RE",
        DOC_ID: r.ID,
        DOC_NUMBER: r.INVOICE_NUMBER ?? "",
        DOC_DATE: r.INVOICE_DATE ?? null,
        DUE_DATE: r.DUE_DATE ?? null,
        PROJECT: r.PROJECT ?? "",
        CONTRACT: r.CONTRACT ?? "",
        ADDRESS_NAME_1: r.ADDRESS_NAME_1 ?? "",
        CONTACT: r.CONTACT ?? "",
        TOTAL_AMOUNT_NET: r.TOTAL_AMOUNT_NET ?? 0,
        TAX_AMOUNT_NET: r.TAX_AMOUNT_NET ?? 0,
        TOTAL_AMOUNT_GROSS: r.TOTAL_AMOUNT_GROSS ?? 0,
        AMOUNT_PAYED_GROSS: r.AMOUNT_PAYED_GROSS ?? 0,
        COMMENT: r.COMMENT ?? "",
        STATUS_ID: r.STATUS_ID ?? null,
      });
    });

    __ppList.rows = merged;
    __ppList.page = 1;
    showMessage(msg, "", "");
    _renderRechnungsliste();
  } catch (e) {
    showMessage(msg, "Fehler: " + (e.message || e), "error");
  }
}

function _openPpEditModal(pp) {
  const modal = document.getElementById("pp-edit-modal");
  if (!modal) return;

  document.getElementById("pp-edit-id").value = pp.ID;
  document.getElementById("pp-edit-number").value = pp.PARTIAL_PAYMENT_NUMBER || "";
  document.getElementById("pp-edit-date").value = pp.PARTIAL_PAYMENT_DATE || "";
  document.getElementById("pp-edit-due").value = pp.DUE_DATE || "";
  document.getElementById("pp-edit-period-start").value = pp.BILLING_PERIOD_START || "";
  document.getElementById("pp-edit-period-finish").value = pp.BILLING_PERIOD_FINISH || "";
  document.getElementById("pp-edit-amount-net").value = pp.AMOUNT_NET ?? "";
  document.getElementById("pp-edit-amount-extras").value = pp.AMOUNT_EXTRAS_NET ?? "";
  document.getElementById("pp-edit-comment").value = pp.COMMENT || "";

  const total = (parseFloat(pp.AMOUNT_NET || 0) || 0) + (parseFloat(pp.AMOUNT_EXTRAS_NET || 0) || 0);
  document.getElementById("pp-edit-total").textContent = _fmtMoney(total);

  // live total
  const recalc = () => {
    const an = parseFloat(document.getElementById("pp-edit-amount-net").value || "0") || 0;
    const ae = parseFloat(document.getElementById("pp-edit-amount-extras").value || "0") || 0;
    document.getElementById("pp-edit-total").textContent = _fmtMoney(an + ae);
  };
  document.getElementById("pp-edit-amount-net").oninput = recalc;
  document.getElementById("pp-edit-amount-extras").oninput = recalc;

  document.getElementById("pp-edit-msg").textContent = "";
  const del = document.getElementById("tec-edit-delete");
  if (del) del.disabled = !(row.ID);
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function _closePpEditModal() {
  const modal = document.getElementById("pp-edit-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function _openInvEditModal(inv) {
  const modal = document.getElementById("inv-edit-modal");
  if (!modal) return;

  document.getElementById("inv-edit-id").value = inv.ID;
  document.getElementById("inv-edit-number").value = inv.INVOICE_NUMBER || "";
  document.getElementById("inv-edit-date").value = inv.INVOICE_DATE || "";
  document.getElementById("inv-edit-due").value = inv.DUE_DATE || "";
  document.getElementById("inv-edit-period-start").value = inv.BILLING_PERIOD_START || "";
  document.getElementById("inv-edit-period-finish").value = inv.BILLING_PERIOD_FINISH || "";
  document.getElementById("inv-edit-comment").value = inv.COMMENT || "";

  showMessage(document.getElementById("inv-edit-msg"), "", "");
  const del = document.getElementById("tec-edit-delete");
  if (del) del.disabled = !(row.ID);
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function _closeInvEditModal() {
  const modal = document.getElementById("inv-edit-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

// Rechnungsliste UI bindings
(function initRechnungslisteUi() {
  const global = document.getElementById("pp-list-global");
  const refresh = document.getElementById("pp-list-refresh");
  const prev = document.getElementById("pp-list-prev");
  const next = document.getElementById("pp-list-next");
  const table = document.getElementById("tbl-rechnungsliste");

  if (global) {
    global.addEventListener("input", debounce(() => {
      __ppList.global = global.value || "";
      __ppList.page = 1;
      _renderRechnungsliste();
    }, 250));
  }
  if (refresh) refresh.addEventListener("click", loadRechnungsliste);
  if (prev) prev.addEventListener("click", () => { __ppList.page -= 1; _renderRechnungsliste(); });
  if (next) next.addEventListener("click", () => { __ppList.page += 1; _renderRechnungsliste(); });

  // Row actions
  if (table) {
    table.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest("button[data-action]");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      const typ = btn.getAttribute("data-type") || "AR";

		if (action === "pdf") {
		  const docType = (typ === "RE") ? "INVOICE" : "PARTIAL_PAYMENT";

		  const qs = new URLSearchParams();
		  // live render preview (no snapshot)
		  qs.set("preview", "1");

		  qs.set("_ts", String(Date.now()));
		  // OPTIONAL: if you have a selected template id, pass it
		  // if (templateId) qs.set("template_id", String(templateId));

		  const url = `${API_BASE}/documents/${docType}/${id}/pdf?${qs.toString()}`;

		  window.open(url, "_blank"); // browser will preview inline if server sends inline disposition
		  return;
		}


      if (action === "xml") {
        const url = typ === "RE"
          ? `${API_BASE}/invoices/${id}/einvoice/ubl`
          : `${API_BASE}/partial-payments/${id}/einvoice/ubl`;
        window.open(url, "_blank");
        return;
      }

      if (action === "edit") {
        try {
          if (typ === "RE") {
            const res = await fetch(`${API_BASE}/invoices/${id}`);
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || "Rechnung konnte nicht geladen werden");
            // invoices.js returns: { data: { inv, ... } }
            const inv = json?.data?.inv || null;
            if (!inv) throw new Error("Rechnung konnte nicht geladen werden");
            _openInvEditModal(inv);
          } else {
            const res = await fetch(`${API_BASE}/partial-payments/${id}`);
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || "Rechnung konnte nicht geladen werden");
            const pp = json?.data?.pp || null;
            if (!pp) throw new Error("Rechnung konnte nicht geladen werden");
            _openPpEditModal(pp);
          }
        } catch (e) {
          alert("Fehler: " + (e.message || e));
        }
      }
    });
  }

  // Columns modal
  const colsBtn = document.getElementById("pp-list-columns");
  const colsModal = document.getElementById("pp-cols-modal");
  const colsList = document.getElementById("pp-cols-list");
  const colsMsg = document.getElementById("pp-cols-msg");

  // Drag & drop ordering state
  let __colsDragCol = null;

  const renderColsModal = () => {
    if (!colsList) return;
    const order = Array.isArray(__ppList.columns) ? [...__ppList.columns] : _ppListDefaultColumns();

    // Render selected columns in their current order first, then the remaining allowed columns.
    // This ensures the configuration UI reflects drag & drop ordering immediately.
    const allowedMap = {};
    (__ppListAllowedColumns || []).forEach((c) => { allowedMap[c.id] = c; });
    const selectedOrdered = (order || []).map((id) => allowedMap[id]).filter(Boolean);
    const selectedSet = new Set((selectedOrdered || []).map((c) => c.id));
    const unselected = (__ppListAllowedColumns || []).filter((c) => !selectedSet.has(c.id));
    const displayCols = [...selectedOrdered, ...unselected];

    const rowHtml = (c) => {
  const checked = order.includes(c.id);
  const idx = order.indexOf(c.id);
  const upDisabled = !checked || idx <= 0;
  const downDisabled = !checked || idx >= order.length - 1;

  return `
    <div class="cols-row" data-col="${c.id}" data-checked="${checked ? "1" : "0"}" ${checked ? 'draggable="true"' : ""}>
      <span class="cols-drag ${checked ? "" : "disabled"}" title="Ziehen zum Sortieren" aria-hidden="true">⋮⋮</span>
      <label class="cols-check">
        <input type="checkbox" data-action="toggle" data-col="${c.id}" ${checked ? "checked" : ""} />
        <span>${c.label}</span>
      </label>
      <div class="cols-order">
        <button type="button" class="btn-small secondary" data-action="up" data-col="${c.id}" ${upDisabled ? "disabled" : ""}>↑</button>
        <button type="button" class="btn-small secondary" data-action="down" data-col="${c.id}" ${downDisabled ? "disabled" : ""}>↓</button>
      </div>
    </div>
  `;
};

    colsList.innerHTML = displayCols.map(rowHtml).join("");
    showMessage(colsMsg, "", "");
  };

  const openColsModal = () => {
    if (!colsModal) return;
    renderColsModal();
    colsModal.classList.remove("hidden");
    colsModal.setAttribute("aria-hidden", "false");
  };

  const closeColsModal = () => {
    if (!colsModal) return;
    colsModal.classList.add("hidden");
    colsModal.setAttribute("aria-hidden", "true");
  };

  if (colsBtn) colsBtn.addEventListener("click", openColsModal);
  document.getElementById("pp-cols-close")?.addEventListener("click", closeColsModal);
  document.getElementById("pp-cols-cancel")?.addEventListener("click", closeColsModal);
  colsModal?.addEventListener("click", (ev) => {
    if (ev.target?.id === "pp-cols-modal") closeColsModal();
  });

  colsList?.addEventListener("click", (ev) => {
    const el = ev.target?.closest("button[data-action], input[data-action]");
    if (!el) return;
    const action = el.getAttribute("data-action");
    const col = el.getAttribute("data-col");
    if (!col || !__ppListColMap[col]) return;

    let order = Array.isArray(__ppList.columns) ? [...__ppList.columns] : _ppListDefaultColumns();
    const idx = order.indexOf(col);

    if (action === "toggle") {
      const checked = el.checked;
      if (checked && idx === -1) order.push(col);
      if (!checked && idx !== -1) order = order.filter((x) => x !== col);
    }
    if (action === "up" && idx > 0) {
      const tmp = order[idx - 1];
      order[idx - 1] = order[idx];
      order[idx] = tmp;
    }
    if (action === "down" && idx !== -1 && idx < order.length - 1) {
      const tmp = order[idx + 1];
      order[idx + 1] = order[idx];
      order[idx] = tmp;
    }

    __ppList.columns = order;
    renderColsModal();
  });


// Drag & drop ordering (for selected columns only)
const _colsClearDragStyles = () => {
  colsList?.querySelectorAll(".cols-row.drag-over")?.forEach((n) => n.classList.remove("drag-over"));
  colsList?.querySelectorAll(".cols-row.dragging")?.forEach((n) => n.classList.remove("dragging"));
};

colsList?.addEventListener("dragstart", (ev) => {
  const row = ev.target?.closest?.(".cols-row");
  if (!row) return;
  if (row.getAttribute("data-checked") !== "1") {
    ev.preventDefault();
    return;
  }
  __colsDragCol = row.getAttribute("data-col");
  row.classList.add("dragging");
  try {
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", __colsDragCol || "");
  } catch (_) {}
});

colsList?.addEventListener("dragover", (ev) => {
  if (!__colsDragCol) return;
  const row = ev.target?.closest?.(".cols-row");
  if (!row) return;
  if (row.getAttribute("data-checked") !== "1") return;
  ev.preventDefault();
  _colsClearDragStyles();
  row.classList.add("drag-over");
  try { ev.dataTransfer.dropEffect = "move"; } catch (_) {}
});

colsList?.addEventListener("drop", (ev) => {
  if (!__colsDragCol) return;
  const targetRow = ev.target?.closest?.(".cols-row");
  if (!targetRow) return;
  const targetCol = targetRow.getAttribute("data-col");
  if (!targetCol) return;
  if (targetRow.getAttribute("data-checked") !== "1") return;

  ev.preventDefault();

  if (targetCol === __colsDragCol) {
    _colsClearDragStyles();
    __colsDragCol = null;
    return;
  }

  let order = Array.isArray(__ppList.columns) ? [...__ppList.columns] : _ppListDefaultColumns();
  const from = order.indexOf(__colsDragCol);
  const to = order.indexOf(targetCol);

  if (from === -1 || to === -1) {
    _colsClearDragStyles();
    __colsDragCol = null;
    return;
  }

  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);

  __ppList.columns = order;
  _colsClearDragStyles();
  __colsDragCol = null;
  renderColsModal();
});

colsList?.addEventListener("dragend", () => {
  _colsClearDragStyles();
  __colsDragCol = null;
});
  document.getElementById("pp-cols-reset")?.addEventListener("click", () => {
    __ppList.columns = _ppListDefaultColumns();
    renderColsModal();
  });

  document.getElementById("pp-cols-save")?.addEventListener("click", () => {
    const cols = Array.isArray(__ppList.columns) && __ppList.columns.length ? __ppList.columns : _ppListDefaultColumns();
    if (cols.length === 0) {
      return showMessage(colsMsg, "Bitte mindestens eine Spalte auswählen", "error");
    }
    _ppListSaveColumnsToStorage(cols);
    closeColsModal();
    _renderRechnungsliste();
  });

  // Modal controls
  document.getElementById("pp-edit-close")?.addEventListener("click", _closePpEditModal);
  document.getElementById("pp-edit-cancel")?.addEventListener("click", _closePpEditModal);
  document.getElementById("pp-edit-modal")?.addEventListener("click", (ev) => {
    if (ev.target?.id === "pp-edit-modal") _closePpEditModal();
  });

  document.getElementById("pp-edit-save")?.addEventListener("click", async () => {
    const msg = document.getElementById("pp-edit-msg");
    const id = document.getElementById("pp-edit-id").value;
    const payload = {
      partial_payment_number: document.getElementById("pp-edit-number").value.trim(),
      partial_payment_date: document.getElementById("pp-edit-date").value || null,
      due_date: document.getElementById("pp-edit-due").value || null,
      billing_period_start: document.getElementById("pp-edit-period-start").value || null,
      billing_period_finish: document.getElementById("pp-edit-period-finish").value || null,
      amount_net: document.getElementById("pp-edit-amount-net").value,
      amount_extras_net: document.getElementById("pp-edit-amount-extras").value,
      comment: document.getElementById("pp-edit-comment").value
    };

    if (!payload.partial_payment_number) {
      return showMessage(msg, "Abschlagsrechnung Nr. ist erforderlich", "error");
    }

    try {
      const res = await fetch(`${API_BASE}/partial-payments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

      showMessage(msg, "Gespeichert ✅", "success");
      await loadRechnungsliste();
      _closePpEditModal();
    } catch (e) {
      showMessage(msg, "Fehler: " + (e.message || e), "error");
    }
  });

  // INVOICE edit modal controls
  document.getElementById("inv-edit-close")?.addEventListener("click", _closeInvEditModal);
  document.getElementById("inv-edit-cancel")?.addEventListener("click", _closeInvEditModal);
  document.getElementById("inv-edit-modal")?.addEventListener("click", (ev) => {
    if (ev.target?.id === "inv-edit-modal") _closeInvEditModal();
  });

  document.getElementById("inv-edit-save")?.addEventListener("click", async () => {
    const msg = document.getElementById("inv-edit-msg");
    const id = document.getElementById("inv-edit-id").value;
    const payload = {
      invoice_number: document.getElementById("inv-edit-number").value.trim(),
      invoice_date: document.getElementById("inv-edit-date").value || null,
      due_date: document.getElementById("inv-edit-due").value || null,
      billing_period_start: document.getElementById("inv-edit-period-start").value || null,
      billing_period_finish: document.getElementById("inv-edit-period-finish").value || null,
      comment: document.getElementById("inv-edit-comment").value
    };

    if (!payload.invoice_number) {
      return showMessage(msg, "Rechnungsnummer ist erforderlich", "error");
    }

    try {
      const res = await fetch(`${API_BASE}/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

      showMessage(msg, "Gespeichert ✅", "success");
      await loadRechnungsliste();
      _closeInvEditModal();
    } catch (e) {
      showMessage(msg, "Fehler: " + (e.message || e), "error");
    }
  });
})();


// --- UNTERNEHMEN ---
async function loadCountriesForUnternehmen() {
  const sel = document.getElementById("select-company-country");
  if (!sel) return;

  sel.innerHTML = `<option value="">Bitte wählen …</option>`;

  try {
    const res = await fetch(`${API_BASE}/stammdaten/countries`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "countries fetch failed");

    (json.data || []).forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.ID;
      // Prefer NAME_LONG when present, fallback to NAME_SHORT/ID
      opt.textContent = c.NAME_LONG || c.NAME_SHORT || c.ID;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("Fehler beim Laden der Länder", err);
  }
}

document.getElementById("btn-save-unternehmen")?.addEventListener("click", async () => {
  const msg = document.getElementById("msg-unternehmen");

  const payload = {
    company_name_1: document.getElementById("input-company-name-1").value.trim(),
    company_name_2: document.getElementById("input-company-name-2").value.trim(),
    street: document.getElementById("input-company-street").value.trim(),
    post_code: document.getElementById("input-company-post-code").value.trim(),
    city: document.getElementById("input-company-city").value.trim(),
    country_id: document.getElementById("select-company-country").value,
    tax_id: document.getElementById("input-company-tax-id").value.trim()
  };

  if (!payload.company_name_1 || !payload.street || !payload.post_code || !payload.city || !payload.country_id) {
    return showMessage(msg, "Bitte alle Pflichtfelder ausfüllen", "error");
  }

  try {
    const res = await fetch(`${API_BASE}/stammdaten/company`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "company save failed");

    showMessage(msg, "Unternehmen gespeichert ✅", "success");

    [
      "input-company-name-1",
      "input-company-name-2",
      "input-company-street",
      "input-company-post-code",
      "input-company-city",
      "input-company-tax-id"
    ].forEach(id => (document.getElementById(id).value = ""));
    document.getElementById("select-company-country").value = "";
  } catch (err) {
    showMessage(msg, "Fehler: " + err.message, "error");
  }
});


// --- ANSCHRIFTEN ---
async function loadCountriesForAddress() {
  const sel = document.getElementById("select-address-country");
  if (!sel) return;

  sel.innerHTML = `<option value="">Bitte wählen …</option>`;

  try {
    const res = await fetch(`${API_BASE}/stammdaten/countries`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "countries fetch failed");

    (json.data || []).forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.ID;
      opt.textContent = c.NAME_LONG || c.NAME_SHORT || c.ID;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("Fehler beim Laden der Länder", err);
  }
}

document.getElementById("btn-save-address")?.addEventListener("click", async () => {
  const msg = document.getElementById("msg-address");

  const countryVal = document.getElementById("select-address-country").value;
  const payload = {
    address_name_1: document.getElementById("input-address-name-1").value.trim(),
    address_name_2: document.getElementById("input-address-name-2").value.trim(),
    street: document.getElementById("input-address-street").value.trim(),
    post_code: document.getElementById("input-address-post-code").value.trim(),
    city: document.getElementById("input-address-city").value.trim(),
    post_office_box: document.getElementById("input-address-post-office-box").value.trim(),
    country_id: countryVal ? parseInt(countryVal, 10) : null,
    customer_number: document.getElementById("input-address-customer-number").value.trim(),
    tax_id: document.getElementById("input-address-tax-id").value.trim(),
    buyer_reference: document.getElementById("input-address-buyer-reference").value.trim()
  };

  if (!payload.address_name_1 || !payload.country_id) {
    return showMessage(msg, "Bitte alle Pflichtfelder ausfüllen", "error");
  }

  try {
    const res = await fetch(`${API_BASE}/stammdaten/address`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "address save failed");

    showMessage(msg, "Anschrift gespeichert ✅", "success");

    [
      "input-address-name-1",
      "input-address-name-2",
      "input-address-street",
      "input-address-post-code",
      "input-address-city",
      "input-address-post-office-box",
      "input-address-customer-number",
      "input-address-tax-id",
      "input-address-buyer-reference"
    ].forEach(id => (document.getElementById(id).value = ""));
    document.getElementById("select-address-country").value = "";
  } catch (err) {
    showMessage(msg, "Fehler: " + err.message, "error");
  }
});


// --- ROLLEN ---
document.getElementById("btn-save-rollen")?.addEventListener("click", async () => {
  const msg = document.getElementById("msg-rollen");

  const payload = {
    name_short: document.getElementById("input-role-name-short")?.value.trim(),
    name_long: document.getElementById("input-role-name-long")?.value.trim()
  };

  if (!payload.name_short) {
    return showMessage(msg, "Bitte Kürzel (Pflichtfeld) eingeben", "error");
  }

  try {
    const res = await fetch(`${API_BASE}/stammdaten/rollen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "rollen save failed");

    showMessage(msg, "Rolle gespeichert ✅", "success");

    document.getElementById("input-role-name-short").value = "";
    document.getElementById("input-role-name-long").value = "";
  } catch (err) {
    showMessage(msg, "Fehler: " + err.message, "error");
  }
});




// --- KONTAKTE ---
async function loadSalutationsForKontakte() {
  const sel = document.getElementById("select-kontakte-salutation");
  if (!sel) return;

  sel.innerHTML = `<option value="">Bitte wählen …</option>`;

  try {
    const res = await fetch(`${API_BASE}/stammdaten/salutations`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "salutations fetch failed");

    (json.data || []).forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.ID;
      opt.textContent = s.NAME_LONG || s.NAME_SHORT || s.ID;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("Fehler beim Laden der Anreden", err);
    const msg = document.getElementById("msg-kontakte");
    if (msg) showMessage(msg, "Anreden konnten nicht geladen werden: " + err.message, "error");
  }
}

async function loadGendersForKontakte() {
  const sel = document.getElementById("select-kontakte-gender");
  if (!sel) return;

  sel.innerHTML = `<option value="">Bitte wählen …</option>`;

  try {
    const res = await fetch(`${API_BASE}/stammdaten/genders`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "genders fetch failed");

    (json.data || []).forEach(g => {
      const opt = document.createElement("option");
      opt.value = g.ID;
      opt.textContent = g.NAME_LONG || g.NAME_SHORT || g.ID;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("Fehler beim Laden der Geschlechter (Kontakte)", err);
    const msg = document.getElementById("msg-kontakte");
    if (msg) showMessage(msg, "Geschlechter konnten nicht geladen werden: " + err.message, "error");
  }
}


function resetKontakteAddressSelection() {
  const input = document.getElementById("input-kontakte-address");
  const selectedId = document.getElementById("input-kontakte-address-id");
  const list = document.getElementById("kontakte-address-autocomplete");

  if (input) {
    input.value = "";
    input.dataset.selectedLabel = "";
  }
  if (selectedId) selectedId.value = "";
  if (list) {
    list.innerHTML = "";
    list.classList.remove("open");
  }
}

function closeKontakteAddressDropdown() {
  const list = document.getElementById("kontakte-address-autocomplete");
  if (list) {
    list.classList.remove("open");
    list.innerHTML = "";
  }
}

function openKontakteAddressDropdown() {
  const list = document.getElementById("kontakte-address-autocomplete");
  if (list) list.classList.add("open");
}

function setKontakteAddressSelection(id, label) {
  const input = document.getElementById("input-kontakte-address");
  const selectedId = document.getElementById("input-kontakte-address-id");

  if (input) {
    input.value = label || "";
    input.dataset.selectedLabel = label || "";
  }
  if (selectedId) selectedId.value = id || "";

  closeKontakteAddressDropdown();
}

async function searchAddressesForKontakte(query) {
  const list = document.getElementById("kontakte-address-autocomplete");
  if (!list) return;

  const q = (query || "").trim();

  // If the user changes the input after selecting an address, invalidate the selected ID
  const input = document.getElementById("input-kontakte-address");
  const selectedId = document.getElementById("input-kontakte-address-id");
  const selectedLabel = (input?.dataset?.selectedLabel || "").trim();
  if (selectedId && selectedId.value && selectedLabel && q !== selectedLabel) {
    selectedId.value = "";
    if (input) input.dataset.selectedLabel = "";
  }

  if (q.length < 2) {
    closeKontakteAddressDropdown();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/stammdaten/addresses/search?q=${encodeURIComponent(q)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "address search failed");

    const rows = json.data || [];
    list.innerHTML = "";

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "autocomplete-item muted";
      empty.textContent = "Keine Treffer";
      list.appendChild(empty);
      openKontakteAddressDropdown();
      return;
    }

    rows.forEach((a) => {
      const item = document.createElement("div");
      item.className = "autocomplete-item";
      const label = a.ADDRESS_NAME_1 || String(a.ID);
      item.textContent = label;

      item.addEventListener("mousedown", (e) => {
        // mousedown so the selection happens before blur closes the list
        e.preventDefault();
        setKontakteAddressSelection(a.ID, label);
      });

      list.appendChild(item);
    });

    openKontakteAddressDropdown();
  } catch (err) {
    console.error("Fehler bei der Adress-Suche", err);
    list.innerHTML = "";
    const item = document.createElement("div");
    item.className = "autocomplete-item muted";
    item.textContent = "Fehler bei der Suche";
    list.appendChild(item);
    openKontakteAddressDropdown();
  }
}

// Wire up address autocomplete UI (single field)
const kontakteAddressInput = document.getElementById("input-kontakte-address");
if (kontakteAddressInput) {
  kontakteAddressInput.addEventListener(
    "input",
    debounce((e) => {
      const input = e.target;
      const selectedId = document.getElementById("input-kontakte-address-id");
      const selectedLabel = (input?.dataset?.selectedLabel || "").trim();

      // If an address is already selected and the user hasn't changed the text, don't reopen the dropdown
      if (selectedId?.value && selectedLabel && input.value.trim() === selectedLabel) {
        closeKontakteAddressDropdown();
        return;
      }

      searchAddressesForKontakte(input.value);
    }, 250)
  );

  kontakteAddressInput.addEventListener("focus", (e) => {
    const q = (e.target.value || "").trim();
    if (q.length >= 2) searchAddressesForKontakte(q);
  });

  kontakteAddressInput.addEventListener("blur", () => {
    // Delay close slightly so a click on an item can register
    setTimeout(() => closeKontakteAddressDropdown(), 150);
  });
}

// Close autocomplete when clicking outside
document.addEventListener("click", (e) => {
  const input = document.getElementById("input-kontakte-address");
  const list = document.getElementById("kontakte-address-autocomplete");
  if (!input || !list) return;

  const clickedInside = input.contains(e.target) || list.contains(e.target);
  if (!clickedInside) closeKontakteAddressDropdown();
});


document.getElementById("btn-save-kontakte")?.addEventListener("click", async () => {
  const msg = document.getElementById("msg-kontakte");

  const payload = {
    title: document.getElementById("input-kontakte-title")?.value.trim(),
    first_name: document.getElementById("input-kontakte-first-name")?.value.trim(),
    last_name: document.getElementById("input-kontakte-last-name")?.value.trim(),
    email: document.getElementById("input-kontakte-email")?.value.trim(),
    mobile: document.getElementById("input-kontakte-mobile")?.value.trim(),
    salutation_id: document.getElementById("select-kontakte-salutation")?.value,
    gender_id: document.getElementById("select-kontakte-gender")?.value,
    address_id: document.getElementById("input-kontakte-address-id")?.value
  };

  if (!payload.first_name || !payload.last_name || !payload.salutation_id || !payload.gender_id || !payload.address_id) {
    return showMessage(msg, "Bitte alle Pflichtfelder ausfüllen", "error");
  }

  try {
    const res = await fetch(`${API_BASE}/stammdaten/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "contacts save failed");

    showMessage(msg, "Kontakt gespeichert ✅", "success");

    [
      "input-kontakte-title",
      "input-kontakte-first-name",
      "input-kontakte-last-name",
      "input-kontakte-email",
      "input-kontakte-mobile"
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    const sal = document.getElementById("select-kontakte-salutation");
    if (sal) sal.value = "";
    const gen = document.getElementById("select-kontakte-gender");
    if (gen) gen.value = "";

    resetKontakteAddressSelection();
  } catch (err) {
    showMessage(msg, "Fehler: " + err.message, "error");
  }
});
// --- STAMMDATEN ---
document.getElementById("btn-save-status").addEventListener("click", async () => {
  const name = document.getElementById("input-status").value.trim();
  const msg = document.getElementById("msg-stammdaten");
  if (!name) return showMessage(msg, "Bitte Name eingeben", "error");

  try {
    const res = await fetch(`${API_BASE}/stammdaten/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name_short: name })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    showMessage(msg, "Status gespeichert ✅", "success");
    document.getElementById("input-status").value = "";
  } catch (err) {
    showMessage(msg, "Fehler: " + err.message, "error");
  }
});

document.getElementById("btn-save-typ").addEventListener("click", async () => {
  const name = document.getElementById("input-typ").value.trim();
  const msg = document.getElementById("msg-stammdaten");
  if (!name) return showMessage(msg, "Bitte Name eingeben", "error");

  try {
    const res = await fetch(`${API_BASE}/stammdaten/typ`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name_short: name })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    showMessage(msg, "Typ gespeichert ✅", "success");
    document.getElementById("input-typ").value = "";
  } catch (err) {
    showMessage(msg, "Fehler: " + err.message, "error");
  }
});

// --- MITARBEITER ---
async function loadGeschlechter() {
  const sel = document.getElementById("select-geschlecht");
  sel.innerHTML = `<option value="">Bitte wählen …</option>`;
  try {
    const res = await fetch(`${API_BASE}/mitarbeiter/genders`);
    const json = await res.json();
    json.data.forEach(g => {
      const opt = document.createElement("option");
      opt.value = g.ID;
      opt.textContent = g.GENDER;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("Fehler beim Laden der Geschlechter", err);
  }
}

document.getElementById("btn-save-mitarbeiter").addEventListener("click", async () => {
  const msg = document.getElementById("msg-mitarbeiter");

  const payload = {
    short_name: document.getElementById("input-username").value.trim(),
    title: document.getElementById("input-titel").value.trim(),
    first_name: document.getElementById("input-vorname").value.trim(),
    last_name: document.getElementById("input-nachname").value.trim(),
    password: document.getElementById("input-passwort").value,
    email: document.getElementById("input-email").value.trim(),
    mobile: document.getElementById("input-mobil").value.trim(),
    personnel_number: document.getElementById("input-personalnummer").value.trim(),
    gender_id: document.getElementById("select-geschlecht").value
  };

  if (!payload.short_name || !payload.first_name || !payload.last_name || !payload.gender_id) {
    return showMessage(msg, "Bitte alle Pflichtfelder ausfüllen", "error");
  }

  try {
    const res = await fetch(`${API_BASE}/mitarbeiter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    showMessage(msg, "Mitarbeiter gespeichert ✅", "success");

    ["input-username", "input-titel", "input-vorname", "input-nachname",
     "input-passwort", "input-email", "input-mobil", "input-personalnummer"]
      .forEach(id => document.getElementById(id).value = "");
    document.getElementById("select-geschlecht").value = "";
  } catch (err) {
    showMessage(msg, "Fehler: " + err.message, "error");
  }
});

// --- PROJEKTE ---
async function loadProjektDropdowns() {
  await Promise.all([
    loadDropdown("projektstatus", "projekte/statuses", "ID", "NAME_SHORT"),
    loadDropdown("projekttyp", "projekte/types", "ID", "NAME_SHORT"),
    loadDropdown("projektleiter", "projekte/managers", "ID", "SHORT_NAME")
  ]);
}

// --- PROJEKTE: Rechnungsadresse + Kontakt (Autocomplete) ---
function resetProjektInvoiceAddressSelection() {
  const input = document.getElementById("input-projekt-invoice-address");
  const selectedId = document.getElementById("input-projekt-invoice-address-id");
  const list = document.getElementById("projekt-invoice-address-autocomplete");
  if (input) {
    input.value = "";
    input.dataset.selectedLabel = "";
  }
  if (selectedId) selectedId.value = "";
  if (list) {
    list.innerHTML = "";
    list.classList.remove("open");
  }
}

function resetProjektInvoiceContactSelection() {
  const input = document.getElementById("input-projekt-invoice-contact");
  const selectedId = document.getElementById("input-projekt-invoice-contact-id");
  const list = document.getElementById("projekt-invoice-contact-autocomplete");
  if (input) {
    input.value = "";
    input.dataset.selectedLabel = "";
  }
  if (selectedId) selectedId.value = "";
  if (list) {
    list.innerHTML = "";
    list.classList.remove("open");
  }
}

function closeProjektInvoiceAddressDropdown() {
  const list = document.getElementById("projekt-invoice-address-autocomplete");
  if (list) {
    list.classList.remove("open");
    list.innerHTML = "";
  }
}

function openProjektInvoiceAddressDropdown() {
  const list = document.getElementById("projekt-invoice-address-autocomplete");
  if (list) list.classList.add("open");
}

function closeProjektInvoiceContactDropdown() {
  const list = document.getElementById("projekt-invoice-contact-autocomplete");
  if (list) {
    list.classList.remove("open");
    list.innerHTML = "";
  }
}

function openProjektInvoiceContactDropdown() {
  const list = document.getElementById("projekt-invoice-contact-autocomplete");
  if (list) list.classList.add("open");
}

function setProjektInvoiceAddressSelection(id, label) {
  const input = document.getElementById("input-projekt-invoice-address");
  const selectedId = document.getElementById("input-projekt-invoice-address-id");

  if (input) {
    input.value = label || "";
    input.dataset.selectedLabel = label || "";
  }
  if (selectedId) selectedId.value = id || "";

  // Changing invoice address invalidates the contact selection.
  resetProjektInvoiceContactSelection();
  closeProjektInvoiceAddressDropdown();
}

function setProjektInvoiceContactSelection(id, label) {
  const input = document.getElementById("input-projekt-invoice-contact");
  const selectedId = document.getElementById("input-projekt-invoice-contact-id");
  if (input) {
    input.value = label || "";
    input.dataset.selectedLabel = label || "";
  }
  if (selectedId) selectedId.value = id || "";
  closeProjektInvoiceContactDropdown();
}

async function searchAddressesForProjekt(query) {
  const list = document.getElementById("projekt-invoice-address-autocomplete");
  const input = document.getElementById("input-projekt-invoice-address");
  const selectedId = document.getElementById("input-projekt-invoice-address-id");
  if (!list) return;

  const q = (query || "").trim();

  // invalidate selected id if user edits after selecting
  const selectedLabel = (input?.dataset?.selectedLabel || "").trim();
  if (selectedId && selectedId.value && selectedLabel && q !== selectedLabel) {
    selectedId.value = "";
    if (input) input.dataset.selectedLabel = "";
    resetProjektInvoiceContactSelection();
  }

  if (q.length < 2) {
    closeProjektInvoiceAddressDropdown();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/stammdaten/addresses/search?q=${encodeURIComponent(q)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "address search failed");

    const rows = json.data || [];
    list.innerHTML = "";

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "autocomplete-item muted";
      empty.textContent = "Keine Treffer";
      list.appendChild(empty);
      openProjektInvoiceAddressDropdown();
      return;
    }

    rows.forEach((a) => {
      const item = document.createElement("div");
      item.className = "autocomplete-item";
      const label = a.ADDRESS_NAME_1 || String(a.ID);
      item.textContent = label;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        setProjektInvoiceAddressSelection(a.ID, label);
      });
      list.appendChild(item);
    });

    openProjektInvoiceAddressDropdown();
  } catch (err) {
    console.error("Fehler bei der Rechnungsadress-Suche", err);
    list.innerHTML = "";
    const item = document.createElement("div");
    item.className = "autocomplete-item muted";
    item.textContent = "Fehler bei der Suche";
    list.appendChild(item);
    openProjektInvoiceAddressDropdown();
  }
}

async function searchContactsForProjekt(query) {
  const list = document.getElementById("projekt-invoice-contact-autocomplete");
  const input = document.getElementById("input-projekt-invoice-contact");
  const selectedId = document.getElementById("input-projekt-invoice-contact-id");
  const addressId = document.getElementById("input-projekt-invoice-address-id")?.value;
  if (!list) return;

  const q = (query || "").trim();

  // invalidate selected id if user edits after selecting
  const selectedLabel = (input?.dataset?.selectedLabel || "").trim();
  if (selectedId && selectedId.value && selectedLabel && q !== selectedLabel) {
    selectedId.value = "";
    if (input) input.dataset.selectedLabel = "";
  }

  if (!addressId) {
    // must select invoice address first
    closeProjektInvoiceContactDropdown();
    return;
  }

  if (q.length < 2) {
    closeProjektInvoiceContactDropdown();
    return;
  }

  try {
    const res = await fetch(
      `${API_BASE}/stammdaten/contacts/search?address_id=${encodeURIComponent(addressId)}&q=${encodeURIComponent(q)}`
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "contact search failed");

    const rows = json.data || [];
    list.innerHTML = "";

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "autocomplete-item muted";
      empty.textContent = "Keine Treffer";
      list.appendChild(empty);
      openProjektInvoiceContactDropdown();
      return;
    }

    rows.forEach((c) => {
      const item = document.createElement("div");
      item.className = "autocomplete-item";
      const label = `${c.FIRST_NAME || ""} ${c.LAST_NAME || ""}`.trim() || String(c.ID);
      item.textContent = label;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        setProjektInvoiceContactSelection(c.ID, label);
      });
      list.appendChild(item);
    });

    openProjektInvoiceContactDropdown();
  } catch (err) {
    console.error("Fehler bei der Kontakt-Suche (Projekt)", err);
    list.innerHTML = "";
    const item = document.createElement("div");
    item.className = "autocomplete-item muted";
    item.textContent = "Fehler bei der Suche";
    list.appendChild(item);
    openProjektInvoiceContactDropdown();
  }
}

// Wire up autocomplete inputs in Projekte view
const projektInvoiceAddressInput = document.getElementById("input-projekt-invoice-address");
if (projektInvoiceAddressInput) {
  projektInvoiceAddressInput.addEventListener(
    "input",
    debounce((e) => {
      const input = e.target;
      const selectedId = document.getElementById("input-projekt-invoice-address-id");
      const selectedLabel = (input?.dataset?.selectedLabel || "").trim();
      if (selectedId?.value && selectedLabel && input.value.trim() === selectedLabel) {
        closeProjektInvoiceAddressDropdown();
        return;
      }
      searchAddressesForProjekt(input.value);
    }, 250)
  );
  projektInvoiceAddressInput.addEventListener("focus", (e) => {
    const q = (e.target.value || "").trim();
    if (q.length >= 2) searchAddressesForProjekt(q);
  });
  projektInvoiceAddressInput.addEventListener("blur", () => {
    setTimeout(() => closeProjektInvoiceAddressDropdown(), 150);
  });
}

const projektInvoiceContactInput = document.getElementById("input-projekt-invoice-contact");
if (projektInvoiceContactInput) {
  projektInvoiceContactInput.addEventListener(
    "input",
    debounce((e) => {
      const input = e.target;
      const selectedId = document.getElementById("input-projekt-invoice-contact-id");
      const selectedLabel = (input?.dataset?.selectedLabel || "").trim();
      if (selectedId?.value && selectedLabel && input.value.trim() === selectedLabel) {
        closeProjektInvoiceContactDropdown();
        return;
      }
      searchContactsForProjekt(input.value);
    }, 250)
  );
  projektInvoiceContactInput.addEventListener("focus", (e) => {
    const q = (e.target.value || "").trim();
    if (q.length >= 2) searchContactsForProjekt(q);
  });
  projektInvoiceContactInput.addEventListener("blur", () => {
    setTimeout(() => closeProjektInvoiceContactDropdown(), 150);
  });
}

// Close project autocomplete when clicking outside
document.addEventListener("click", (e) => {
  const addrInput = document.getElementById("input-projekt-invoice-address");
  const addrList = document.getElementById("projekt-invoice-address-autocomplete");
  const conInput = document.getElementById("input-projekt-invoice-contact");
  const conList = document.getElementById("projekt-invoice-contact-autocomplete");

  if (addrInput && addrList) {
    const inside = addrInput.contains(e.target) || addrList.contains(e.target);
    if (!inside) closeProjektInvoiceAddressDropdown();
  }
  if (conInput && conList) {
    const inside = conInput.contains(e.target) || conList.contains(e.target);
    if (!inside) closeProjektInvoiceContactDropdown();
  }
});

async function loadDropdown(fieldSuffix, endpoint, valField, labelField, labelField2 = null) {
  const sel = document.getElementById(`select-${fieldSuffix}`);
  if (!sel) return;

  sel.innerHTML = `<option value="">Bitte wählen …</option>`;
  try {
    const res = await fetch(`${API_BASE}/${endpoint}`);
    const json = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(json.error || `Fehler beim Laden (${endpoint})`);
    if (!Array.isArray(json.data)) return;

    json.data.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item[valField];
      opt.textContent = labelField2
        ? `${item[labelField]} - ${item[labelField2]}`
        : item[labelField];
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error(`Fehler bei ${fieldSuffix}`, err);
  }
}

// --- load Project Dropdown ---


async function loadProjectDropdown(dropdownId) {
  const sel = document.getElementById(dropdownId);
  if (!sel) return;

  sel.innerHTML = `<option value="">Bitte wählen …</option>`;

  try {
    // IMPORTANT: always call the backend (port 3000) and not the frontend origin
    const res = await fetch(`${API_BASE}/projekte`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Projekte");
    if (!Array.isArray(json.data)) return;

    json.data.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.ID;
      opt.textContent = `${p.NAME_SHORT} – ${p.NAME_LONG}`;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("Fehler beim Laden der Projekte", err);
  }
}


// --- PROJEKT ANLEGEN (Wizard) ---
const __prjWizard = {
  step: 1,
  employees: [],
  roles: [],
  selectedEmpIds: new Set(),
  e2p: {}, // employee_id -> { role_id, role_name_short, role_name_long, sp_rate }
};

function prjSetMsg(text, type = "info") {
  const msg = document.getElementById("msg-projekt");
  showMessage(msg, text, type);
}

function prjShowStep(step) {
  __prjWizard.step = step;
  [1,2,3,4,5].forEach((s) => {
    const el = document.getElementById(`prj-step-${s}`);
    if (!el) return;
    el.classList.toggle("hidden", s !== step);
  });

  // Step indicator
  const steps = document.querySelectorAll("#prj-steps .wizard-step");
  steps.forEach((el) => {
    const s = parseInt(el.getAttribute("data-step") || "0", 10);
    el.classList.toggle("active", s === step);
  });
}

async function prjLoadCompanies() {
  const companySel = document.getElementById("select-projekt-company");
  if (!companySel) return;

  companySel.innerHTML = `<option value="">Bitte wählen …</option>`;
  const res = await fetch(`${API_BASE}/stammdaten/companies`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Firmen");
  (json.data || []).forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.ID;
    opt.textContent = c.NAME_SHORT || c.NAME_LONG || `Firma ${c.ID}`;
    companySel.appendChild(opt);
  });
}

async function prjLoadEmployeesActive() {
  const res = await fetch(`${API_BASE}/projekte/employees/active`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Mitarbeiter");
  __prjWizard.employees = json.data || [];
  prjRenderEmployeeList();
}

async function prjLoadRolesActive() {
  const res = await fetch(`${API_BASE}/projekte/roles/active`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Rollen");
  __prjWizard.roles = json.data || [];
}

function prjEmployeeLabel(emp) {
  const sn = emp.SHORT_NAME ? `${emp.SHORT_NAME}: ` : "";
  const fn = emp.FIRST_NAME || "";
  const ln = emp.LAST_NAME || "";
  return `${sn}${fn} ${ln}`.trim();
}

function prjRenderEmployeeList() {
  const tbody = document.getElementById("prj-emp-list");
  if (!tbody) return;
  tbody.innerHTML = "";

  (__prjWizard.employees || []).forEach((emp) => {
    const tr = document.createElement("tr");
    const tdChk = document.createElement("td");
    const tdLbl = document.createElement("td");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = `prj-emp-${emp.ID}`;
    cb.checked = __prjWizard.selectedEmpIds.has(emp.ID);
    cb.addEventListener("change", () => {
      if (cb.checked) __prjWizard.selectedEmpIds.add(emp.ID);
      else __prjWizard.selectedEmpIds.delete(emp.ID);
    });

    tdChk.appendChild(cb);
    tdLbl.textContent = prjEmployeeLabel(emp);

    tr.appendChild(tdChk);
    tr.appendChild(tdLbl);
    tbody.appendChild(tr);
  });
}

function prjRenderE2PTable() {
  const tbody = document.getElementById("prj-e2p-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const selected = Array.from(__prjWizard.selectedEmpIds);
  const empById = new Map((__prjWizard.employees || []).map((e) => [e.ID, e]));

  selected.forEach((empId) => {
    const emp = empById.get(empId);
    if (!emp) return;

    if (!__prjWizard.e2p[empId]) {
      __prjWizard.e2p[empId] = { role_id: "", role_name_short: "", role_name_long: "", sp_rate: "" };
    }
    const rowState = __prjWizard.e2p[empId];

    const tr = document.createElement("tr");

    const tdEmp = document.createElement("td");
    tdEmp.textContent = prjEmployeeLabel(emp);

    const tdRoleSel = document.createElement("td");
    const sel = document.createElement("select");
    sel.innerHTML = `<option value="">Bitte wählen …</option>`;
    (__prjWizard.roles || []).forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.ID;
      opt.textContent = `${r.NAME_SHORT || ""}${r.NAME_LONG ? " – " + r.NAME_LONG : ""}`.trim();
      sel.appendChild(opt);
    });
    sel.value = rowState.role_id || "";
    sel.addEventListener("change", () => {
      rowState.role_id = sel.value;
      const role = (__prjWizard.roles || []).find((x) => String(x.ID) === String(sel.value));
      if (role) {
        rowState.role_name_short = role.NAME_SHORT || "";
        rowState.role_name_long = role.NAME_LONG || "";
        inpShort.value = rowState.role_name_short;
        inpLong.value = rowState.role_name_long;
      }
    });
    tdRoleSel.appendChild(sel);

    const tdShort = document.createElement("td");
    const inpShort = document.createElement("input");
    inpShort.type = "text";
    inpShort.value = rowState.role_name_short || "";
    inpShort.addEventListener("input", () => rowState.role_name_short = inpShort.value);
    tdShort.appendChild(inpShort);

    const tdLong = document.createElement("td");
    const inpLong = document.createElement("input");
    inpLong.type = "text";
    inpLong.value = rowState.role_name_long || "";
    inpLong.addEventListener("input", () => rowState.role_name_long = inpLong.value);
    tdLong.appendChild(inpLong);

    const tdRate = document.createElement("td");
    const inpRate = document.createElement("input");
    inpRate.type = "number";
    inpRate.step = "0.01";
    inpRate.value = rowState.sp_rate || "";
    inpRate.addEventListener("input", () => rowState.sp_rate = inpRate.value);
    tdRate.appendChild(inpRate);

    tr.appendChild(tdEmp);
    tr.appendChild(tdRoleSel);
    tr.appendChild(tdShort);
    tr.appendChild(tdLong);
    tr.appendChild(tdRate);
    tbody.appendChild(tr);
  });
}

function prjSetStructMode(mode) {
  __prjWizard.structMode = mode;
  const manual = document.getElementById("prj-struct-manual");
  const copy = document.getElementById("prj-struct-copy");
  if (manual) manual.classList.toggle("hidden", mode !== "manual");
  if (copy) copy.classList.toggle("hidden", mode !== "copy");
}

function prjNewStructRow() {
  const tmp = "t" + Date.now().toString(36) + Math.floor(Math.random() * 1000);
  return { tmp_key: tmp, father_tmp_key: "", NAME_SHORT: "", NAME_LONG: "", BILLING_TYPE_ID: "" };
}

async function prjEnsureBillingTypesLoaded() {
  try {
    await getBillingTypes();
  } catch (e) {
    console.error(e);
  }
}

function prjRenderStructTable() {
  const tbody = document.getElementById("prj-struct-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const rows = __prjWizard.structDraft || [];
  const bt = Array.isArray(__billingTypesCache) ? __billingTypesCache : [];

  rows.forEach((r, idx) => {
    const tr = document.createElement("tr");

    const tdNr = document.createElement("td");
    tdNr.textContent = String(idx + 1);

    const tdShort = document.createElement("td");
    const inpShort = document.createElement("input");
    inpShort.type = "text";
    inpShort.value = r.NAME_SHORT || "";
    inpShort.addEventListener("input", () => { r.NAME_SHORT = inpShort.value; });
    tdShort.appendChild(inpShort);

    const tdLong = document.createElement("td");
    const inpLong = document.createElement("input");
    inpLong.type = "text";
    inpLong.value = r.NAME_LONG || "";
    inpLong.addEventListener("input", () => { r.NAME_LONG = inpLong.value; });
    tdLong.appendChild(inpLong);

    const tdBt = document.createElement("td");
    const selBt = document.createElement("select");
    selBt.innerHTML = `<option value="">Bitte wählen …</option>`;
    bt.forEach((b0) => {
      const opt = document.createElement("option");
      opt.value = b0.ID;
      opt.textContent = `${b0.NAME_SHORT || ""}${b0.NAME_LONG ? " – " + b0.NAME_LONG : ""}`.trim();
      selBt.appendChild(opt);
    });
    selBt.value = r.BILLING_TYPE_ID || "";
    selBt.addEventListener("change", () => { r.BILLING_TYPE_ID = selBt.value; });
    tdBt.appendChild(selBt);

    const tdFather = document.createElement("td");
    const selFather = document.createElement("select");
    selFather.innerHTML = `<option value="">(Root)</option>`;
    rows.forEach((cand) => {
      if (cand.tmp_key === r.tmp_key) return;
      const opt = document.createElement("option");
      opt.value = cand.tmp_key;
      const lbl = `${cand.NAME_SHORT || ""} ${cand.NAME_LONG || ""}`.trim() || `Zeile`;
      opt.textContent = lbl;
      selFather.appendChild(opt);
    });
    selFather.value = r.father_tmp_key || "";
    selFather.addEventListener("change", () => { r.father_tmp_key = selFather.value; });
    tdFather.appendChild(selFather);

    const tdDel = document.createElement("td");
    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.textContent = "Entfernen";
    btnDel.addEventListener("click", () => {
      __prjWizard.structDraft = rows.filter(x => x.tmp_key !== r.tmp_key).map(x => {
        if (x.father_tmp_key === r.tmp_key) x.father_tmp_key = "";
        return x;
      });
      prjRenderStructTable();
    });
    tdDel.appendChild(btnDel);

    tr.appendChild(tdNr);
    tr.appendChild(tdShort);
    tr.appendChild(tdLong);
    tr.appendChild(tdBt);
    tr.appendChild(tdFather);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  });
}

async function prjLoadCopyProjectsDropdown() {
  const sel = document.getElementById("prj-struct-source-project");
  if (!sel) return;
  sel.innerHTML = `<option value="">Bitte wählen …</option>`;
  try {
    const res = await fetch(`${API_BASE}/projekte/list?limit=2000`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Projekte");
    (json.data || []).forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.ID;
      opt.textContent = `${p.NAME_SHORT || ""} – ${p.NAME_LONG || ""}`.trim();
      sel.appendChild(opt);
    });
  } catch (e) {
    console.error(e);
  }
}

async function prjCopyStructureFromProject(sourceProjectId) {
  if (!sourceProjectId) throw new Error("Bitte Quellprojekt auswählen.");
  const res = await fetch(`${API_BASE}/projekte/${sourceProjectId}/structure`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Projektstruktur");

  const nodes = Array.isArray(json.data) ? json.data : [];
  // Build mapping old ID -> tmp
  const idToTmp = new Map();
  nodes.forEach((n) => {
    idToTmp.set(String(n.ID), "t" + String(n.ID));
  });

  __prjWizard.structDraft = nodes.map((n) => ({
    tmp_key: idToTmp.get(String(n.ID)) || ("t" + String(n.ID)),
    father_tmp_key: n.FATHER_ID ? (idToTmp.get(String(n.FATHER_ID)) || "") : "",
    NAME_SHORT: n.NAME_SHORT || "",
    NAME_LONG: n.NAME_LONG || "",
    BILLING_TYPE_ID: n.BILLING_TYPE_ID ? String(n.BILLING_TYPE_ID) : "",
  }));

  prjRenderStructTable();
}

function prjBuildSummary() {
  const companyId = document.getElementById("select-projekt-company")?.value || "";
  const nameLong = document.getElementById("input-projektname")?.value.trim() || "";
  const statusText = document.getElementById("select-projektstatus")?.selectedOptions?.[0]?.textContent || "";
  const managerText = document.getElementById("select-projektleiter")?.selectedOptions?.[0]?.textContent || "";
  const typeText = document.getElementById("select-projekttyp")?.selectedOptions?.[0]?.textContent || "";

  const addr = document.getElementById("input-projekt-invoice-address")?.value || "";
  const contact = document.getElementById("input-projekt-invoice-contact")?.value || "";

  const div = document.getElementById("prj-summary");
  if (!div) return;

  const empById = new Map((__prjWizard.employees || []).map((e) => [e.ID, e]));
  const rows = Array.from(__prjWizard.selectedEmpIds).map((id) => {
    const emp = empById.get(id);
    const s = __prjWizard.e2p[id] || {};
    return {
      emp: emp ? prjEmployeeLabel(emp) : `ID ${id}`,
      roleShort: s.role_name_short || "",
      roleLong: s.role_name_long || "",
      rate: s.sp_rate || "",
    };
  });

  let html = "";
  html += `<p><b>Hinweis:</b> Die Projektnummer wird beim Anlegen automatisch vergeben (P-YY-CCC).</p>`;
  html += `<p><b>Firma:</b> ${companyId || "-"}</p>`;
  html += `<p><b>Projektname:</b> ${escapeHtml(nameLong)}</p>`;
  html += `<p><b>Status:</b> ${escapeHtml(statusText)}</p>`;
  html += `<p><b>Projektleiter:</b> ${escapeHtml(managerText)}</p>`;
  html += `<p><b>Projekttyp:</b> ${escapeHtml(typeText || "-")}</p>`;
  html += `<p><b>Rechnungsadresse:</b> ${escapeHtml(addr)}</p>`;
  html += `<p><b>Kontakt:</b> ${escapeHtml(contact)}</p>`;
  html += `<p><b>Projektstruktur:</b> ${(__prjWizard.structDraft || []).length} Elemente</p>`;

  if (rows.length) {
    html += `<h4>Mitarbeiter</h4>`;
    html += `<div class="table-wrap"><table class="data-table"><thead><tr><th>Mitarbeiter</th><th>Kürzel</th><th>Rolle</th><th>Stundensatz</th></tr></thead><tbody>`;
    rows.forEach((r) => {
      html += `<tr><td>${escapeHtml(r.emp)}</td><td>${escapeHtml(r.roleShort)}</td><td>${escapeHtml(r.roleLong)}</td><td>${escapeHtml(String(r.rate))}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  } else {
    html += `<p><i>Keine Mitarbeiter zugeordnet.</i></p>`;
  }

  div.innerHTML = html;
}

function prjResetWizardState() {
  __prjWizard.step = 1;
  __prjWizard.employees = [];
  __prjWizard.roles = [];
  __prjWizard.selectedEmpIds = new Set();
  __prjWizard.e2p = {};
  __prjWizard.structMode = "manual";
  __prjWizard.structDraft = [];
  document.getElementById("select-projekt-company").value = "";
  document.getElementById("input-projektname").value = "";
  document.getElementById("select-projektstatus").value = "";
  document.getElementById("select-projektleiter").value = "";
  document.getElementById("select-projekttyp").value = "";
  resetProjektInvoiceAddressSelection();
  resetProjektInvoiceContactSelection();
  const toggleAll = document.getElementById("prj-emp-toggleall");
  if (toggleAll) toggleAll.checked = false;
  const empList = document.getElementById("prj-emp-list");
  if (empList) empList.innerHTML = "";
  const e2pBody = document.getElementById("prj-e2p-body");
  if (e2pBody) e2pBody.innerHTML = "";
  const sum = document.getElementById("prj-summary");
  if (sum) sum.innerHTML = "";
  const sb = document.getElementById("prj-struct-body");
  if (sb) sb.innerHTML = "";
}

async function prjInitWizard() {
  prjResetWizardState();
  prjShowStep(1);
  prjSetMsg("", "info");

  // Dropdowns (status, type, manager) + companies
  await loadProjektDropdowns();
  await prjLoadCompanies();

  // Load employees/roles lazily when entering step 3
}

function prjValidateStep1() {
  const companyId = document.getElementById("select-projekt-company").value;
  const nameLong = document.getElementById("input-projektname").value.trim();
  const statusId = document.getElementById("select-projektstatus").value;
  const managerId = document.getElementById("select-projektleiter").value;
  const addressId = document.getElementById("input-projekt-invoice-address-id").value;
  const contactId = document.getElementById("input-projekt-invoice-contact-id").value;

  if (!companyId || !nameLong || !statusId || !managerId || !addressId || !contactId) {
    prjSetMsg("Bitte alle Pflichtfelder ausfüllen", "error");
    return false;
  }
  return true;
}

async function prjEnsureStep3DataLoaded() {
  if (!__prjWizard.roles.length) await prjLoadRolesActive();
  if (!__prjWizard.employees.length) await prjLoadEmployeesActive();
}

document.getElementById("prj-next-1").addEventListener("click", async () => {
  if (!prjValidateStep1()) return;
  prjShowStep(2);
});

document.getElementById("prj-prev-2").addEventListener("click", () => prjShowStep(1));
document.getElementById("prj-next-2").addEventListener("click", async () => {
  await prjEnsureStep3DataLoaded();
  prjShowStep(3);
});

document.getElementById("prj-prev-3").addEventListener("click", () => prjShowStep(2));
document.getElementById("prj-next-3").addEventListener("click", async () => {
  await prjEnsureBillingTypesLoaded();
  await prjLoadCopyProjectsDropdown();
  // default mode
  prjSetStructMode(__prjWizard.structMode || "manual");
  prjRenderStructTable();
  prjShowStep(4);
});

document.getElementById("prj-prev-4").addEventListener("click", () => prjShowStep(3));

// Projektstruktur (Wizard Step 4)
Array.from(document.querySelectorAll('input[name="prj-struct-mode"]')).forEach((el) => {
  el.addEventListener('change', () => {
    __prjWizard.structMode = el.value;
    prjSetStructMode(el.value);
  });
});

const prjAddRowBtn = document.getElementById('prj-struct-add-row');
if (prjAddRowBtn) prjAddRowBtn.addEventListener('click', () => {
  __prjWizard.structDraft = __prjWizard.structDraft || [];
  __prjWizard.structDraft.push(prjNewStructRow());
  prjRenderStructTable();
});

const prjCopyBtn = document.getElementById('prj-struct-copy-btn');
if (prjCopyBtn) prjCopyBtn.addEventListener('click', async () => {
  const sel = document.getElementById('prj-struct-source-project');
  const srcId = sel ? sel.value : '';
  try {
    await prjCopyStructureFromProject(srcId);
    prjSetMsg('Projektstruktur kopiert ✅', 'success');
  } catch (e) {
    prjSetMsg('Fehler: ' + (e.message || e), 'error');
  }
});

document.getElementById("prj-next-4").addEventListener("click", () => {
  prjBuildSummary();
  prjShowStep(5);
});

document.getElementById("prj-prev-5").addEventListener("click", () => prjShowStep(4));

document.getElementById("prj-emp-toggleall").addEventListener("change", (e) => {
  const checked = !!e.target.checked;
  __prjWizard.selectedEmpIds = new Set();
  (__prjWizard.employees || []).forEach((emp) => {
    const cb = document.getElementById(`prj-emp-${emp.ID}`);
    if (cb) cb.checked = checked;
    if (checked) __prjWizard.selectedEmpIds.add(emp.ID);
  });
});

document.getElementById("prj-emp-confirm").addEventListener("click", () => {
  // Ensure we capture checkbox state (in case user didn't blur)
  (__prjWizard.employees || []).forEach((emp) => {
    const cb = document.getElementById(`prj-emp-${emp.ID}`);
    if (cb?.checked) __prjWizard.selectedEmpIds.add(emp.ID);
    else __prjWizard.selectedEmpIds.delete(emp.ID);
  });
  prjRenderE2PTable();
  prjSetMsg("Mitarbeiter übernommen ✅", "success");
});

document.getElementById("prj-create").addEventListener("click", async () => {
  if (!prjValidateStep1()) return;

  const msg = document.getElementById("msg-projekt");

  const companyId = document.getElementById("select-projekt-company").value;
  const payload = {
    company_id: companyId,
    name_long: document.getElementById("input-projektname").value.trim(),
    project_status_id: document.getElementById("select-projektstatus").value,
    project_type_id: document.getElementById("select-projekttyp").value || null,
    project_manager_id: document.getElementById("select-projektleiter").value,
    address_id: document.getElementById("input-projekt-invoice-address-id")?.value,
    contact_id: document.getElementById("input-projekt-invoice-contact-id")?.value,
    employee2project: [],
    project_structure: (__prjWizard.structDraft || []).map(r0 => ({
      tmp_key: r0.tmp_key,
      father_tmp_key: r0.father_tmp_key || null,
      NAME_SHORT: r0.NAME_SHORT || "",
      NAME_LONG: r0.NAME_LONG || "",
      BILLING_TYPE_ID: r0.BILLING_TYPE_ID || null,
    })),
  };

  // Build EMPLOYEE2PROJECT payload
  const selected = Array.from(__prjWizard.selectedEmpIds);
  selected.forEach((empId) => {
    const row = __prjWizard.e2p[empId] || {};
    payload.employee2project.push({
      employee_id: empId,
      role_id: row.role_id || null,
      role_name_short: row.role_name_short || "",
      role_name_long: row.role_name_long || "",
      sp_rate: row.sp_rate !== "" && row.sp_rate !== null && row.sp_rate !== undefined ? Number(row.sp_rate) : null,
    });
  });

  try {
    showMessage(msg, "Speichere Projekt …", "info");

    const res = await fetch(`${API_BASE}/projekte`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

    showMessage(msg, `Projekt angelegt ✅ (${json?.data?.NAME_SHORT || "Nr. vergeben"})`, "success");
    prjResetWizardState();
    prjShowStep(1);
  } catch (err) {
    showMessage(msg, "Fehler: " + (err.message || err), "error");
  }
});

// --- Projektliste---
// --- Projektliste (filterbar, sortierbar, editierbar) ---
const __prjList = {
  rows: [],
  sortKey: "NAME_SHORT",
  sortDir: "asc",
  page: 1,
  pageSize: 25,
  filters: {},
  global: "",
};

const __prjLookups = {
  loaded: false,
  statuses: [],
  types: [],
  managers: [],
};

async function loadProjektListe() {
  const msg = document.getElementById("msg-projektliste");
  try {
    showMessage(msg, "", "info");

    const res = await fetch(`${API_BASE}/projekte/list?limit=2000`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Fehler beim Laden");
    __prjList.rows = Array.isArray(json.data) ? json.data : [];
    __prjList.page = 1;
    _renderProjektliste();
  } catch (err) {
    console.error(err);
    showMessage(document.getElementById("msg-projektliste"), "Fehler beim Laden der Projektliste", "error");
  }
}

function _prjStr(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function _prjNorm(v) {
  return _prjStr(v).toLowerCase().trim();
}

function _projectMatchesGlobal(r, q) {
  if (!q) return true;
  const hay = [
    r.NAME_SHORT,
    r.NAME_LONG,
    r.STATUS_NAME,
    r.TYPE_NAME,
    r.MANAGER_NAME,
    r.ID,
  ].map(_prjStr).join(" ").toLowerCase();
  return hay.includes(q);
}

function _applyProjektlisteTransforms() {
  const q = _prjNorm(__prjList.global);
  const filters = __prjList.filters || {};

  let rows = (__prjList.rows || []).filter(r => {
    if (!_projectMatchesGlobal(r, q)) return false;

    for (const [k, v] of Object.entries(filters)) {
      const fv = _prjNorm(v);
      if (!fv) continue;
      const cell = _prjNorm(r[k]);
      if (!cell.includes(fv)) return false;
    }
    return true;
  });

  // Sorting
  const key = __prjList.sortKey;
  const dir = __prjList.sortDir === "desc" ? -1 : 1;

  rows.sort((a, b) => {
    const av = _prjStr(a[key]);
    const bv = _prjStr(b[key]);

    // numeric sort for ID if possible
    if (key === "ID") {
      const an = parseInt(av, 10);
      const bn = parseInt(bv, 10);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
    }

    return av.localeCompare(bv, "de", { numeric: true, sensitivity: "base" }) * dir;
  });

  return rows;
}

function _renderProjektliste() {
  const tblBody = document.querySelector("#tbl-projektliste tbody");
  const pageInfo = document.getElementById("prj-list-pageinfo");
  const msg = document.getElementById("msg-projektliste");
  if (!tblBody) return;

  const rows = _applyProjektlisteTransforms();
  const total = rows.length;
  const pageSize = __prjList.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  __prjList.page = Math.min(__prjList.page, totalPages);

  const start = (__prjList.page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  tblBody.innerHTML = "";
  pageRows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${_prjStr(r.NAME_SHORT)}</td>
      <td>${_prjStr(r.NAME_LONG)}</td>
      <td>${_prjStr(r.STATUS_NAME)}</td>
      <td>${_prjStr(r.TYPE_NAME)}</td>
      <td>${_prjStr(r.MANAGER_NAME)}</td>
      <td>${_prjStr(r.ID)}</td>
      <td>
        <button class="btn-small" data-action="edit" data-id="${_prjStr(r.ID)}">Bearbeiten</button>
      </td>
    `;
    tblBody.appendChild(tr);
  });

  if (pageInfo) pageInfo.textContent = `Seite ${__prjList.page} / ${totalPages} (${total} Einträge)`;
  showMessage(msg, total === 0 ? "Keine Projekte gefunden." : "", "info");
}

async function _ensureProjektEditLookups() {
  if (__prjLookups.loaded) return;

  const [st, ty, ma] = await Promise.all([
    fetch(`${API_BASE}/projekte/statuses`).then(r => r.json()),
    fetch(`${API_BASE}/projekte/types`).then(r => r.json()),
    fetch(`${API_BASE}/projekte/managers`).then(r => r.json()),
  ]);

  __prjLookups.statuses = Array.isArray(st.data) ? st.data : [];
  __prjLookups.types = Array.isArray(ty.data) ? ty.data : [];
  __prjLookups.managers = Array.isArray(ma.data) ? ma.data : [];
  __prjLookups.loaded = true;
}

function _fillSelect(selectEl, items, getLabel) {
  if (!selectEl) return;
  selectEl.innerHTML = `<option value="">—</option>`;
  items.forEach(it => {
    const opt = document.createElement("option");
    opt.value = it.ID;
    opt.textContent = getLabel(it);
    selectEl.appendChild(opt);
  });
}

function _openPrjEditModal(row) {
  const modal = document.getElementById("prj-edit-modal");
  if (!modal) return;

  document.getElementById("prj-edit-id").value = _prjStr(row.ID);
  document.getElementById("prj-edit-name-short").value = _prjStr(row.NAME_SHORT);
  document.getElementById("prj-edit-name-long").value = _prjStr(row.NAME_LONG);

  const selStatus = document.getElementById("prj-edit-status");
  const selType = document.getElementById("prj-edit-type");
  const selMgr = document.getElementById("prj-edit-manager");

  _fillSelect(selStatus, __prjLookups.statuses, (x) => x.NAME_SHORT || x.ID);
  _fillSelect(selType, __prjLookups.types, (x) => x.NAME_SHORT || x.ID);
  _fillSelect(selMgr, __prjLookups.managers, (x) => x.SHORT_NAME || x.ID);

  selStatus.value = row.PROJECT_STATUS_ID ?? "";
  selType.value = row.PROJECT_TYPE_ID ?? "";
  selMgr.value = row.PROJECT_MANAGER_ID ?? "";

  const msg = document.getElementById("prj-edit-msg");
  if (msg) msg.textContent = "";

  const del = document.getElementById("tec-edit-delete");
  if (del) del.disabled = !(row.ID);
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function _closePrjEditModal() {
  const modal = document.getElementById("prj-edit-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function _savePrjEditModal() {
  const msg = document.getElementById("prj-edit-msg");
  try {
    const id = document.getElementById("prj-edit-id").value;
    const name_short = (document.getElementById("prj-edit-name-short").value || "").trim();
    const name_long = (document.getElementById("prj-edit-name-long").value || "").trim();

    const project_status_id = document.getElementById("prj-edit-status").value || null;
    const project_type_id = document.getElementById("prj-edit-type").value || null;
    const project_manager_id = document.getElementById("prj-edit-manager").value || null;

    if (!name_short) {
      showMessage(msg, "Projektnr ist erforderlich.", "error");
      return;
    }

    const payload = {
      name_short,
      name_long,
      project_status_id,
      project_type_id,
      project_manager_id,
    };

    const res = await fetch(`${API_BASE}/projekte/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

    // Update local row
    const updated = json.data;
    const idx = __prjList.rows.findIndex(r => String(r.ID) === String(id));
    if (idx >= 0) __prjList.rows[idx] = updated;

    showMessage(msg, "Gespeichert.", "success");
    _renderProjektliste();
    setTimeout(_closePrjEditModal, 250);
  } catch (err) {
    console.error(err);
    showMessage(msg, err.message || "Fehler beim Speichern", "error");
  }
}

// Projektliste UI bindings
(function initProjektlisteUi() {
  const global = document.getElementById("prj-list-global");
  const refresh = document.getElementById("prj-list-refresh");
  const prev = document.getElementById("prj-list-prev");
  const next = document.getElementById("prj-list-next");
  const tbl = document.getElementById("tbl-projektliste");
  const tbody = tbl ? tbl.querySelector("tbody") : null;

  if (global) {
    global.addEventListener("input", debounce(() => {
      __prjList.global = global.value || "";
      __prjList.page = 1;
      _renderProjektliste();
    }, 250));
  }

  if (refresh) refresh.addEventListener("click", loadProjektListe);

  if (prev) prev.addEventListener("click", () => {
    __prjList.page = Math.max(1, __prjList.page - 1);
    _renderProjektliste();
  });

  if (next) next.addEventListener("click", () => {
    __prjList.page = __prjList.page + 1;
    _renderProjektliste();
  });

  // Column filters
  document.querySelectorAll('#tbl-projektliste thead input[data-filter]').forEach(inp => {
    inp.addEventListener("input", debounce(() => {
      const k = inp.getAttribute("data-filter");
      __prjList.filters[k] = inp.value || "";
      __prjList.page = 1;
      _renderProjektliste();
    }, 250));
  });

  // Sorting
  document.querySelectorAll("#tbl-projektliste thead tr:first-child th[data-key]").forEach(th => {
    th.classList.add("sortable");
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-key");
      if (__prjList.sortKey === key) {
        __prjList.sortDir = __prjList.sortDir === "asc" ? "desc" : "asc";
      } else {
        __prjList.sortKey = key;
        __prjList.sortDir = "asc";
      }
      _renderProjektliste();
    });
  });

  // Row actions
  if (tbody) {
    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      const id = btn.getAttribute("data-id");
      const row = __prjList.rows.find(r => String(r.ID) === String(id));
      if (!row) return;

      if (action === "edit") {
        await _ensureProjektEditLookups();
        _openPrjEditModal(row);
      }
    });
  }

  // Modal buttons
  document.getElementById("prj-edit-close")?.addEventListener("click", _closePrjEditModal);
  document.getElementById("prj-edit-cancel")?.addEventListener("click", _closePrjEditModal);
  document.getElementById("prj-edit-save")?.addEventListener("click", _savePrjEditModal);
})();


// ----------------------------
// Anschriftenliste (ADDRESS)
// ----------------------------

const __addrList = {
  rows: [],
  sortKey: "ADDRESS_NAME_1",
  sortDir: "asc",
  page: 1,
  pageSize: 25,
  filters: {},
  global: "",
};

const __addrLookups = {
  loadedCountries: false,
  countries: [],
};

async function _ensureCountriesForAddrEdit() {
  if (__addrLookups.loadedCountries) return;
  const res = await fetch(`${API_BASE}/stammdaten/countries`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Länder konnten nicht geladen werden");
  __addrLookups.countries = Array.isArray(json.data) ? json.data : [];
  __addrLookups.loadedCountries = true;
}

function _fillCountrySelect(selectEl, selectedId) {
  if (!selectEl) return;
  selectEl.innerHTML = `<option value="">Bitte wählen …</option>`;
  (__addrLookups.countries || []).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.ID;
    opt.textContent = c.NAME_LONG || c.NAME_SHORT || c.ID;
    selectEl.appendChild(opt);
  });
  if (selectedId !== undefined && selectedId !== null) {
    selectEl.value = String(selectedId);
  }
}

function _applyAddrListTransforms() {
  let rows = Array.isArray(__addrList.rows) ? [...__addrList.rows] : [];

  Object.entries(__addrList.filters).forEach(([k, v]) => {
    if (!v) return;
    rows = rows.filter(r => _includesCI(r?.[k], v));
  });

  if (__addrList.global) {
    const g = __addrList.global;
    rows = rows.filter(r => {
      const blob = [
        r.ADDRESS_NAME_1,
        r.ADDRESS_NAME_2,
        r.STREET,
        r.POST_CODE,
        r.CITY,
        r.COUNTRY,
        r.CUSTOMER_NUMBER,
        r.TAX_ID,
        r.BUYER_REFERENCE,
        r.ID,
      ].join(" | ");
      return _includesCI(blob, g);
    });
  }

  const key = __addrList.sortKey;
  const dir = __addrList.sortDir;
  rows.sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];
    return dir === "asc"
      ? _str(av).localeCompare(_str(bv), "de", { numeric: true, sensitivity: "base" })
      : _str(bv).localeCompare(_str(av), "de", { numeric: true, sensitivity: "base" });
  });

  return rows;
}

function _renderAddressliste() {
  const tbody = document.querySelector("#tbl-addressliste tbody");
  const pageInfo = document.getElementById("addr-list-pageinfo");
  if (!tbody) return;

  const rows = _applyAddrListTransforms();
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / __addrList.pageSize));
  if (__addrList.page > pages) __addrList.page = pages;
  if (__addrList.page < 1) __addrList.page = 1;

  const start = (__addrList.page - 1) * __addrList.pageSize;
  const pageRows = rows.slice(start, start + __addrList.pageSize);

  tbody.innerHTML = "";
  pageRows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${_str(r.ADDRESS_NAME_1)}</td>
      <td>${_str(r.ADDRESS_NAME_2)}</td>
      <td>${_str(r.STREET)}</td>
      <td>${_str(r.POST_CODE)}</td>
      <td>${_str(r.CITY)}</td>
      <td>${_str(r.COUNTRY)}</td>
      <td>${_str(r.CUSTOMER_NUMBER)}</td>
      <td>${_str(r.TAX_ID)}</td>
      <td>${_str(r.BUYER_REFERENCE)}</td>
      <td><button class="btn-small" data-action="edit" data-id="${_str(r.ID)}">Bearbeiten</button></td>
    `;
    tbody.appendChild(tr);
  });

  if (pageInfo) pageInfo.textContent = `Seite ${__addrList.page} / ${pages} (Einträge: ${total})`;
}

async function loadAddressListe() {
  const msg = document.getElementById("msg-addressliste");
  try {
    showMessage(msg, "Lade Anschriftenliste …", "");
    const res = await fetch(`${API_BASE}/stammdaten/addresses/list?limit=2000`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Anschriftenliste konnte nicht geladen werden");
    __addrList.rows = Array.isArray(json.data) ? json.data : [];
    __addrList.page = 1;
    showMessage(msg, "", "");
    _renderAddressliste();
  } catch (e) {
    showMessage(msg, "Fehler: " + (e.message || e), "error");
  }
}

function _openAddrEditModal(row) {
  const modal = document.getElementById("addr-edit-modal");
  if (!modal) return;

  document.getElementById("addr-edit-id").value = row.ID;
  document.getElementById("addr-edit-name-1").value = row.ADDRESS_NAME_1 || "";
  document.getElementById("addr-edit-name-2").value = row.ADDRESS_NAME_2 || "";
  document.getElementById("addr-edit-street").value = row.STREET || "";
  document.getElementById("addr-edit-post-code").value = row.POST_CODE || "";
  document.getElementById("addr-edit-city").value = row.CITY || "";
  document.getElementById("addr-edit-post-office-box").value = row.POST_OFFICE_BOX || "";
  document.getElementById("addr-edit-customer-number").value = row.CUSTOMER_NUMBER || "";
  document.getElementById("addr-edit-tax-id").value = row.TAX_ID || "";
  document.getElementById("addr-edit-buyer-reference").value = row.BUYER_REFERENCE || "";

  const selCountry = document.getElementById("addr-edit-country");
  _fillCountrySelect(selCountry, row.COUNTRY_ID);

  document.getElementById("addr-edit-msg").textContent = "";
  const del = document.getElementById("tec-edit-delete");
  if (del) del.disabled = !(row.ID);
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function _closeAddrEditModal() {
  const modal = document.getElementById("addr-edit-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function _saveAddrEditModal() {
  const msg = document.getElementById("addr-edit-msg");
  try {
    const id = document.getElementById("addr-edit-id").value;
    const payload = {
      address_name_1: (document.getElementById("addr-edit-name-1").value || "").trim(),
      address_name_2: (document.getElementById("addr-edit-name-2").value || "").trim(),
      street: (document.getElementById("addr-edit-street").value || "").trim(),
      post_code: (document.getElementById("addr-edit-post-code").value || "").trim(),
      city: (document.getElementById("addr-edit-city").value || "").trim(),
      post_office_box: (document.getElementById("addr-edit-post-office-box").value || "").trim(),
      country_id: document.getElementById("addr-edit-country").value,
      customer_number: (document.getElementById("addr-edit-customer-number").value || "").trim(),
      tax_id: (document.getElementById("addr-edit-tax-id").value || "").trim(),
      buyer_reference: (document.getElementById("addr-edit-buyer-reference").value || "").trim(),
    };

    if (!payload.address_name_1 || !payload.country_id) {
      showMessage(msg, "Bitte alle Pflichtfelder ausfüllen (Anschrift, Land)", "error");
      return;
    }

    const res = await fetch(`${API_BASE}/stammdaten/addresses/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

    const updated = json.data;
    const idx = __addrList.rows.findIndex(r => String(r.ID) === String(id));
    if (idx >= 0) __addrList.rows[idx] = { ...__addrList.rows[idx], ...updated };

    showMessage(msg, "Gespeichert.", "success");
    _renderAddressliste();
    setTimeout(_closeAddrEditModal, 250);
  } catch (e) {
    showMessage(msg, "Fehler: " + (e.message || e), "error");
  }
}

(function initAddresslisteUi() {
  const global = document.getElementById("addr-list-global");
  const refresh = document.getElementById("addr-list-refresh");
  const prev = document.getElementById("addr-list-prev");
  const next = document.getElementById("addr-list-next");
  const table = document.getElementById("tbl-addressliste");

  if (global) {
    global.addEventListener("input", debounce(() => {
      __addrList.global = global.value || "";
      __addrList.page = 1;
      _renderAddressliste();
    }, 250));
  }
  if (refresh) refresh.addEventListener("click", loadAddressListe);
  if (prev) prev.addEventListener("click", () => { __addrList.page -= 1; _renderAddressliste(); });
  if (next) next.addEventListener("click", () => { __addrList.page += 1; _renderAddressliste(); });

  document.querySelectorAll("#tbl-addressliste .filter-row input").forEach(inp => {
    inp.addEventListener("input", debounce(() => {
      const k = inp.getAttribute("data-filter");
      __addrList.filters[k] = inp.value || "";
      __addrList.page = 1;
      _renderAddressliste();
    }, 250));
  });

  document.querySelectorAll("#tbl-addressliste thead tr:first-child th[data-key]").forEach(th => {
    th.classList.add("sortable");
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-key");
      if (__addrList.sortKey === key) {
        __addrList.sortDir = __addrList.sortDir === "asc" ? "desc" : "asc";
      } else {
        __addrList.sortKey = key;
        __addrList.sortDir = "asc";
      }
      _renderAddressliste();
    });
  });

  if (table) {
    table.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest("button[data-action]");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const row = __addrList.rows.find(r => String(r.ID) === String(id));
      if (!row) return;

      if (btn.getAttribute("data-action") === "edit") {
        try {
          await _ensureCountriesForAddrEdit();
          _openAddrEditModal(row);
        } catch (e) {
          alert("Fehler: " + (e.message || e));
        }
      }
    });
  }

  document.getElementById("addr-edit-close")?.addEventListener("click", _closeAddrEditModal);
  document.getElementById("addr-edit-cancel")?.addEventListener("click", _closeAddrEditModal);
  document.getElementById("addr-edit-save")?.addEventListener("click", _saveAddrEditModal);
  document.getElementById("addr-edit-modal")?.addEventListener("click", (ev) => {
    if (ev.target?.id === "addr-edit-modal") _closeAddrEditModal();
  });
})();


// ----------------------------
// Kontaktliste (CONTACTS)
// ----------------------------

const __ctList = {
  rows: [],
  sortKey: "NAME",
  sortDir: "asc",
  page: 1,
  pageSize: 25,
  filters: {},
  global: "",
};

const __ctLookups = {
  loaded: false,
  salutations: [],
  genders: [],
};

async function _ensureKontaktLookups() {
  if (__ctLookups.loaded) return;
  const [sRes, gRes] = await Promise.all([
    fetch(`${API_BASE}/stammdaten/salutations`).then(r => r.json()),
    fetch(`${API_BASE}/stammdaten/genders`).then(r => r.json()),
  ]);
  __ctLookups.salutations = Array.isArray(sRes.data) ? sRes.data : [];
  __ctLookups.genders = Array.isArray(gRes.data) ? gRes.data : [];
  __ctLookups.loaded = true;
}

function _fillLookupSelect(selectEl, items, labelFn, selectedVal) {
  if (!selectEl) return;
  selectEl.innerHTML = `<option value="">Bitte wählen …</option>`;
  (items || []).forEach(it => {
    const opt = document.createElement("option");
    opt.value = it.ID;
    opt.textContent = labelFn(it);
    selectEl.appendChild(opt);
  });
  if (selectedVal !== undefined && selectedVal !== null) selectEl.value = String(selectedVal);
}

function _applyKontaktListTransforms() {
  let rows = Array.isArray(__ctList.rows) ? [...__ctList.rows] : [];

  Object.entries(__ctList.filters).forEach(([k, v]) => {
    if (!v) return;
    rows = rows.filter(r => _includesCI(r?.[k], v));
  });

  if (__ctList.global) {
    const g = __ctList.global;
    rows = rows.filter(r => {
      const blob = [
        r.NAME,
        r.TITLE,
        r.EMAIL,
        r.MOBILE,
        r.SALUTATION,
        r.GENDER,
        r.ADDRESS,
        r.ID,
      ].join(" | ");
      return _includesCI(blob, g);
    });
  }

  const key = __ctList.sortKey;
  const dir = __ctList.sortDir;
  rows.sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];
    return dir === "asc"
      ? _str(av).localeCompare(_str(bv), "de", { numeric: true, sensitivity: "base" })
      : _str(bv).localeCompare(_str(av), "de", { numeric: true, sensitivity: "base" });
  });

  return rows;
}

function _renderKontaktliste() {
  const tbody = document.querySelector("#tbl-kontaktliste tbody");
  const pageInfo = document.getElementById("ct-list-pageinfo");
  if (!tbody) return;

  const rows = _applyKontaktListTransforms();
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / __ctList.pageSize));
  if (__ctList.page > pages) __ctList.page = pages;
  if (__ctList.page < 1) __ctList.page = 1;

  const start = (__ctList.page - 1) * __ctList.pageSize;
  const pageRows = rows.slice(start, start + __ctList.pageSize);

  tbody.innerHTML = "";
  pageRows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${_str(r.NAME)}</td>
      <td>${_str(r.TITLE)}</td>
      <td>${_str(r.EMAIL)}</td>
      <td>${_str(r.MOBILE)}</td>
      <td>${_str(r.SALUTATION)}</td>
      <td>${_str(r.GENDER)}</td>
      <td>${_str(r.ADDRESS)}</td>
      <td><button class="btn-small" data-action="edit" data-id="${_str(r.ID)}">Bearbeiten</button></td>
    `;
    tbody.appendChild(tr);
  });

  if (pageInfo) pageInfo.textContent = `Seite ${__ctList.page} / ${pages} (Einträge: ${total})`;
}

async function loadKontaktListe() {
  const msg = document.getElementById("msg-kontaktliste");
  try {
    showMessage(msg, "Lade Kontaktliste …", "");
    const res = await fetch(`${API_BASE}/stammdaten/contacts/list?limit=2000`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Kontaktliste konnte nicht geladen werden");
    __ctList.rows = Array.isArray(json.data) ? json.data : [];
    __ctList.page = 1;
    showMessage(msg, "", "");
    _renderKontaktliste();
  } catch (e) {
    showMessage(msg, "Fehler: " + (e.message || e), "error");
  }
}

function _setupAddressAutocomplete(inputId, hiddenId, listId) {
  const input = document.getElementById(inputId);
  const hidden = document.getElementById(hiddenId);
  const list = document.getElementById(listId);
  if (!input || !hidden || !list) return;

  const close = () => {
    list.classList.remove("open");
    list.innerHTML = "";
  };
  const open = () => list.classList.add("open");
  const setSel = (id, label) => {
    hidden.value = id || "";
    input.value = label || "";
    input.dataset.selectedLabel = label || "";
    close();
  };

  const search = async (qRaw) => {
    const q = (qRaw || "").trim();

    // Invalidate selection if the user changes text
    const selectedLabel = (input.dataset.selectedLabel || "").trim();
    if (hidden.value && selectedLabel && q !== selectedLabel) {
      hidden.value = "";
      input.dataset.selectedLabel = "";
    }

    if (q.length < 2) {
      close();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/stammdaten/addresses/search?q=${encodeURIComponent(q)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Suche fehlgeschlagen");
      const rows = json.data || [];
      list.innerHTML = "";
      if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "autocomplete-item muted";
        empty.textContent = "Keine Treffer";
        list.appendChild(empty);
        open();
        return;
      }

      rows.forEach(a => {
        const item = document.createElement("div");
        item.className = "autocomplete-item";
        const label = a.ADDRESS_NAME_1 || String(a.ID);
        item.textContent = label;
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          setSel(a.ID, label);
        });
        list.appendChild(item);
      });
      open();
    } catch (e) {
      list.innerHTML = "";
      const err = document.createElement("div");
      err.className = "autocomplete-item muted";
      err.textContent = "Fehler bei der Suche";
      list.appendChild(err);
      open();
    }
  };

  input.addEventListener("input", debounce((e) => {
    const selectedLabel = (input.dataset.selectedLabel || "").trim();
    if (hidden.value && selectedLabel && input.value.trim() === selectedLabel) {
      close();
      return;
    }
    search(e.target.value);
  }, 250));

  input.addEventListener("focus", () => {
    const q = (input.value || "").trim();
    if (q.length >= 2) search(q);
  });

  input.addEventListener("blur", () => {
    setTimeout(close, 150);
  });

  document.addEventListener("click", (e) => {
    const clickedInside = input.contains(e.target) || list.contains(e.target);
    if (!clickedInside) close();
  });

  return { setSelection: setSel };
}

let __ctEditAddressAutocomplete = null;

function _openCtEditModal(row) {
  const modal = document.getElementById("ct-edit-modal");
  if (!modal) return;

  document.getElementById("ct-edit-id").value = row.ID;
  document.getElementById("ct-edit-title").value = row.TITLE || "";
  document.getElementById("ct-edit-first-name").value = row.FIRST_NAME || "";
  document.getElementById("ct-edit-last-name").value = row.LAST_NAME || "";
  document.getElementById("ct-edit-email").value = row.EMAIL || "";
  document.getElementById("ct-edit-mobile").value = row.MOBILE || "";

  const selSal = document.getElementById("ct-edit-salutation");
  const selGen = document.getElementById("ct-edit-gender");
  _fillLookupSelect(selSal, __ctLookups.salutations, (x) => x.NAME_LONG || x.ID, row.SALUTATION_ID);
  _fillLookupSelect(selGen, __ctLookups.genders, (x) => x.NAME_LONG || x.ID, row.GENDER_ID);

  const addrInput = document.getElementById("ct-edit-address");
  const addrHidden = document.getElementById("ct-edit-address-id");
  if (addrHidden) addrHidden.value = row.ADDRESS_ID ?? "";
  if (addrInput) {
    addrInput.value = row.ADDRESS || "";
    addrInput.dataset.selectedLabel = row.ADDRESS || "";
  }

  document.getElementById("ct-edit-msg").textContent = "";
  const del = document.getElementById("tec-edit-delete");
  if (del) del.disabled = !(row.ID);
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function _closeCtEditModal() {
  const modal = document.getElementById("ct-edit-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function _saveCtEditModal() {
  const msg = document.getElementById("ct-edit-msg");
  try {
    const id = document.getElementById("ct-edit-id").value;
    const payload = {
      title: (document.getElementById("ct-edit-title").value || "").trim(),
      first_name: (document.getElementById("ct-edit-first-name").value || "").trim(),
      last_name: (document.getElementById("ct-edit-last-name").value || "").trim(),
      email: (document.getElementById("ct-edit-email").value || "").trim(),
      mobile: (document.getElementById("ct-edit-mobile").value || "").trim(),
      salutation_id: document.getElementById("ct-edit-salutation").value,
      gender_id: document.getElementById("ct-edit-gender").value,
      address_id: document.getElementById("ct-edit-address-id").value,
    };

    if (!payload.first_name || !payload.last_name || !payload.salutation_id || !payload.gender_id || !payload.address_id) {
      showMessage(msg, "Bitte alle Pflichtfelder ausfüllen (Vorname, Nachname, Anrede, Geschlecht, Adresse)", "error");
      return;
    }

    const res = await fetch(`${API_BASE}/stammdaten/contacts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

    const updated = json.data;
    const idx = __ctList.rows.findIndex(r => String(r.ID) === String(id));
    if (idx >= 0) __ctList.rows[idx] = { ...__ctList.rows[idx], ...updated };

    showMessage(msg, "Gespeichert.", "success");
    _renderKontaktliste();
    setTimeout(_closeCtEditModal, 250);
  } catch (e) {
    showMessage(msg, "Fehler: " + (e.message || e), "error");
  }
}

(function initKontaktlisteUi() {
  const global = document.getElementById("ct-list-global");
  const refresh = document.getElementById("ct-list-refresh");
  const prev = document.getElementById("ct-list-prev");
  const next = document.getElementById("ct-list-next");
  const table = document.getElementById("tbl-kontaktliste");

  if (global) {
    global.addEventListener("input", debounce(() => {
      __ctList.global = global.value || "";
      __ctList.page = 1;
      _renderKontaktliste();
    }, 250));
  }
  if (refresh) refresh.addEventListener("click", loadKontaktListe);
  if (prev) prev.addEventListener("click", () => { __ctList.page -= 1; _renderKontaktliste(); });
  if (next) next.addEventListener("click", () => { __ctList.page += 1; _renderKontaktliste(); });

  document.querySelectorAll("#tbl-kontaktliste .filter-row input").forEach(inp => {
    inp.addEventListener("input", debounce(() => {
      const k = inp.getAttribute("data-filter");
      __ctList.filters[k] = inp.value || "";
      __ctList.page = 1;
      _renderKontaktliste();
    }, 250));
  });

  document.querySelectorAll("#tbl-kontaktliste thead tr:first-child th[data-key]").forEach(th => {
    th.classList.add("sortable");
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-key");
      if (__ctList.sortKey === key) {
        __ctList.sortDir = __ctList.sortDir === "asc" ? "desc" : "asc";
      } else {
        __ctList.sortKey = key;
        __ctList.sortDir = "asc";
      }
      _renderKontaktliste();
    });
  });

  if (table) {
    table.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest("button[data-action]");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const row = __ctList.rows.find(r => String(r.ID) === String(id));
      if (!row) return;

      if (btn.getAttribute("data-action") === "edit") {
        await _ensureKontaktLookups();

        // One-time init of autocomplete bindings
        if (!__ctEditAddressAutocomplete) {
          __ctEditAddressAutocomplete = _setupAddressAutocomplete("ct-edit-address", "ct-edit-address-id", "ct-edit-address-autocomplete");
        }
        _openCtEditModal(row);
      }
    });
  }

  document.getElementById("ct-edit-close")?.addEventListener("click", _closeCtEditModal);
  document.getElementById("ct-edit-cancel")?.addEventListener("click", _closeCtEditModal);
  document.getElementById("ct-edit-save")?.addEventListener("click", _saveCtEditModal);
  document.getElementById("ct-edit-modal")?.addEventListener("click", (ev) => {
    if (ev.target?.id === "ct-edit-modal") _closeCtEditModal();
  });
})();


// --- Projektstruktur (neu) ---
let __psWired = false;
let __psProjectId = null;
let __psNodes = [];
let __psBillingTypes = [];
let __psDirtyIds = new Set();
let __psSelectedIds = new Set();
let __psDragId = null;
let __psCtxTargetId = null;

function psGetSelectedIdsOrClicked(clickedId) {
  const selected = Array.from(__psSelectedIds || []);
  if (selected.length) return selected;
  return clickedId ? [String(clickedId)] : [];
}

function psHasChildrenInData(nodes) {
  const childMap = new Map();
  (nodes || []).forEach((n) => {
    const fid = n.FATHER_ID === 0 || n.FATHER_ID === "0" || n.FATHER_ID === null || n.FATHER_ID === undefined ? null : String(n.FATHER_ID);
    if (!fid) return;
    const arr = childMap.get(fid) || [];
    arr.push(String(n.ID));
    childMap.set(fid, arr);
  });
  return childMap;
}

function psComputeRevenuesFromNodes(nodes) {
  const map = new Map();
  (nodes || []).forEach((n) => map.set(String(n.ID), { ...n }));
  const childMap = psHasChildrenInData(nodes);

  const visiting = new Set();
  const done = new Map();

  const getLeafRevenue = (node) => {
    const btId = Number(node.BILLING_TYPE_ID || 0);
    if (btId === 2) return Number(node.TEC_SP_TOT_SUM ?? 0) || 0;
    return Number(node.REVENUE ?? 0) || 0;
  };

  const dfs = (id) => {
    if (done.has(id)) return done.get(id);
    if (visiting.has(id)) return 0; // prevent cycles
    visiting.add(id);
    const node = map.get(id);
    const children = childMap.get(id) || [];
    let val = 0;
    if (children.length) {
      val = children.reduce((s, cid) => s + dfs(String(cid)), 0);
    } else {
      val = node ? getLeafRevenue(node) : 0;
    }
    visiting.delete(id);
    done.set(id, val);
    return val;
  };

  // attach meta on the original nodes array
  (nodes || []).forEach((n) => {
    const id = String(n.ID);
    const children = childMap.get(id) || [];
    n.__HAS_CHILDREN = children.length > 0;
    n.__REVENUE_COMPUTED = dfs(id);
  });
}

function psRecomputeParentRevenuesFromDom() {
  const rows = Array.from(document.querySelectorAll("#table-projektstruktur tbody tr"));
  if (!rows.length) return;

  const nodes = new Map();
  const children = new Map();

  rows.forEach((r) => {
    const id = String(r.dataset.id);
    const fidRaw = r.dataset.fatherId;
    const fid = fidRaw === "0" || fidRaw === 0 || fidRaw === "" || fidRaw === null || fidRaw === undefined ? null : String(fidRaw);
    const bt = parseInt(r.querySelector('select[data-field="BILLING_TYPE_ID"]')?.value || "0", 10) || 0;
    const tecSum = Number(r.dataset.tecSum ?? 0) || 0;
    const revenueInput = r.querySelector('input[data-field="REVENUE"]');
    const revVal = parseFloat(revenueInput?.value || "0") || 0;
    nodes.set(id, { id, fid, bt, tecSum, revVal, row: r, revenueInput });
    if (fid) {
      const arr = children.get(fid) || [];
      arr.push(id);
      children.set(fid, arr);
    }
  });

  const visiting = new Set();
  const memo = new Map();
  const dfs = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const n = nodes.get(id);
    const childs = children.get(id) || [];
    let val = 0;
    if (childs.length) {
      val = childs.reduce((s, cid) => s + dfs(cid), 0);
    } else {
      val = n.bt === 2 ? n.tecSum : (Number.isFinite(n.revVal) ? n.revVal : 0);
    }
    visiting.delete(id);
    memo.set(id, val);
    return val;
  };

  // Apply to parents (readonly + computed)
  nodes.forEach((n, id) => {
    const childs = children.get(id) || [];
    const hasChildren = childs.length > 0;
    n.row.dataset.hasChildren = hasChildren ? "1" : "0";
    if (hasChildren) {
      const sum = dfs(id);
      if (n.revenueInput) {
        n.revenueInput.value = String(sum);
        n.revenueInput.readOnly = true;
        n.revenueInput.classList.add("readonly-field", "ps-parent-revenue");
      }
    } else {
      // leaf: honour BT=2 readonly
      if (n.revenueInput) {
        const fixed = n.bt === 2;
        n.revenueInput.readOnly = fixed;
        n.revenueInput.classList.toggle("readonly-field", fixed);
        n.revenueInput.classList.remove("ps-parent-revenue");
        if (fixed) n.revenueInput.value = String(n.tecSum);
      }
    }
  });
}

function psMsg(text, type = "") {
  const el = document.getElementById("ps-msg");
  if (el) showMessage(el, text, type);
}

function psShowTable(show) {
  const wrap = document.getElementById("ps-table-wrap");
  if (!wrap) return;
  wrap.classList.toggle("hidden", !show);
}

function psClearTable() {
  const tbody = document.querySelector("#table-projektstruktur tbody");
  if (tbody) tbody.innerHTML = "";
}

function psResetState() {
  __psNodes = [];
  __psBillingTypes = [];
  __psDirtyIds = new Set();
  __psSelectedIds = new Set();
  __psDragId = null;

  document.getElementById("ps-save-all")?.setAttribute("disabled", "disabled");
  document.getElementById("ps-bulk-toggle")?.setAttribute("disabled", "disabled");
  document.getElementById("ps-selected-count") && (document.getElementById("ps-selected-count").textContent = "0");
  document.getElementById("ps-bulk-panel")?.classList.add("hidden");
}

function psSetDirty(structureId, isDirty) {
  const id = String(structureId);
  const row = document.querySelector(`#table-projektstruktur tbody tr[data-id="${cssEscape(id)}"]`);
  if (isDirty) __psDirtyIds.add(id);
  else __psDirtyIds.delete(id);

  if (row) row.classList.toggle("ps-dirty", isDirty);

  const saveAll = document.getElementById("ps-save-all");
  const bulkToggle = document.getElementById("ps-bulk-toggle");
  const hasDirty = __psDirtyIds.size > 0;

  if (saveAll) saveAll.disabled = !hasDirty;
  if (bulkToggle) bulkToggle.disabled = !__psNodes.length;
}

function psUpdateSelectedCount() {
  const el = document.getElementById("ps-selected-count");
  if (el) el.textContent = String(__psSelectedIds.size || 0);
}

function psClearMessages() {
  ["ps-msg", "ps-add-msg", "ps-del-msg"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) showMessage(el, "", "");
  });
}

function psFillBillingTypeSelect(selectEl, { allowEmpty = false, emptyLabel = "—" } = {}) {
  if (!selectEl) return;
  const opts = [];
  if (allowEmpty) opts.push(`<option value="">${emptyLabel}</option>`);
  (__psBillingTypes || []).forEach((bt) => {
    const id = String(bt.ID);
    const label = bt.BILLING_TYPE ?? id;
    opts.push(`<option value="${id}">${escapeHtml(label)}</option>`);
  });
  selectEl.innerHTML = opts.join("");
}

function psBuildParentOptions() {
  const sel = document.getElementById("ps-add-parent");
  if (!sel) return;
  const roots = psBuildTree(__psNodes || []);
  const flat = psFlattenTree(roots);

  const opts = [`<option value="">(Root / oberste Ebene)</option>`];
  flat.forEach(({ node, level }) => {
    const label = `${"—".repeat(level)} ${node.NAME_SHORT || ("#" + node.ID)}`.trim();
    opts.push(`<option value="${node.ID}">${escapeHtml(label)}</option>`);
  });
  sel.innerHTML = opts.join("");
}

function psOpenModal(id) {
  document.getElementById(id)?.classList.remove("hidden");
}

function psCloseModal(id) {
  document.getElementById(id)?.classList.add("hidden");
}

function cssEscape(val) {
  try {
    return CSS.escape(val);
  } catch (_) {
    return String(val).replace(/"/g, '\\"');
  }
}


function psBuildTree(nodes) {
  const map = {};
  (nodes || []).forEach((n) => {
    map[String(n.ID)] = { ...n, children: [] };
  });

  const roots = [];
  (nodes || []).forEach((n) => {
    const id = String(n.ID);
    const fid = n.FATHER_ID === 0 || n.FATHER_ID === "0" ? null : n.FATHER_ID;
    if (fid === null || fid === undefined || fid === "") {
      roots.push(map[id]);
      return;
    }
    const parent = map[String(fid)];
    if (parent) parent.children.push(map[id]);
    else roots.push(map[id]);
  });

  const sortById = (arr) => arr.sort((a, b) => Number(a.ID) - Number(b.ID));
  sortById(roots);
  Object.values(map).forEach((n) => sortById(n.children || []));

  return roots;
}

function psFlattenTree(roots) {
  const out = [];
  const walk = (node, level) => {
    out.push({ node, level });
    (node.children || []).forEach((c) => walk(c, level + 1));
  };
  (roots || []).forEach((r) => walk(r, 0));
  return out;
}

async function psLoadProjectStructure(projectId) {
  if (!projectId) {
    psMsg("Bitte ein Projekt auswählen.", "error");
    psShowTable(false);
    psClearTable();
    return;
  }

  __psProjectId = String(projectId);
  psResetState();
  const addBtn = document.getElementById("ps-add");
  if (addBtn) addBtn.disabled = false;
  psMsg("Lade Projektstruktur …", "info");
  psShowTable(false);
  psClearTable();

  try {
    const [billingTypes, res] = await Promise.all([
      getBillingTypes(),
      fetch(`${API_BASE}/projekte/${encodeURIComponent(projectId)}/structure`),
    ]);

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Projektstruktur");

    const nodes = Array.isArray(json.data) ? json.data : [];
    __psBillingTypes = billingTypes || [];
    __psNodes = nodes || [];
    // compute parent revenues as sum(children), leaf revenues as stored / TEC (BT=2)
    psComputeRevenuesFromNodes(__psNodes);
    // prepare bulk + add modal selects
    psFillBillingTypeSelect(document.getElementById("ps-bulk-billing-type"), { allowEmpty: true, emptyLabel: "(nicht ändern)" });
    psFillBillingTypeSelect(document.getElementById("ps-add-billing-type"));
    psBuildParentOptions();
    if (!nodes.length) {
      psMsg("Keine Projektstruktur vorhanden.", "info");
      psShowTable(true);
      return;
    }

    const btOptions = (selectedId) => {
      const sel = String(selectedId ?? "");
      const opts = (billingTypes || [])
        .map((bt) => {
          const id = String(bt.ID);
          const label = bt.BILLING_TYPE ?? id;
          return `<option value="${id}" ${id === sel ? "selected" : ""}>${label}</option>`;
        })
        .join("");
      return `<option value="">Bitte wählen …</option>` + opts;
    };

    const roots = psBuildTree(nodes);
    const flat = psFlattenTree(roots);

    const tbody = document.querySelector("#table-projektstruktur tbody");
    if (!tbody) return;

    flat.forEach(({ node, level }) => {
      const billingTypeIsFixed = Number(node.BILLING_TYPE_ID) === 2;
      const tecSum = Number(node.TEC_SP_TOT_SUM ?? 0);

      const storedRevenue = Number(node.REVENUE ?? 0);
      const revenueVal = Number(node.__REVENUE_COMPUTED ?? (billingTypeIsFixed ? tecSum : storedRevenue));
      const hasChildren = !!node.__HAS_CHILDREN;

      const extrasPercentVal = Number(node.EXTRAS_PERCENT ?? 0);

      const tr = document.createElement("tr");
      tr.dataset.id = String(node.ID);
      tr.dataset.level = String(level);
      tr.dataset.tecSum = String(tecSum);
      tr.dataset.storedRevenue = String(storedRevenue);
      tr.dataset.fatherId = node.FATHER_ID === null || node.FATHER_ID === undefined ? "" : String(node.FATHER_ID);
      tr.dataset.hasChildren = hasChildren ? "1" : "0";
      // Track originals for inheritance prompt on save
      tr.dataset.origBillingTypeId = node.BILLING_TYPE_ID === null || node.BILLING_TYPE_ID === undefined ? "" : String(node.BILLING_TYPE_ID);
      tr.dataset.origExtrasPercent = node.EXTRAS_PERCENT === null || node.EXTRAS_PERCENT === undefined ? "" : String(node.EXTRAS_PERCENT);

      tr.innerHTML = `
        <td class="ps-col-select">
          <div class="ps-select-cell">
            <input type="checkbox" class="ps-select-row" data-id="${node.ID}" />
            <span class="ps-drag-handle" draggable="true" data-id="${node.ID}" title="Ziehen zum Verschieben">⋮⋮</span>
          </div>
        </td>
        <td>
          <div class="ps-name-cell" style="padding-left:${level * 18}px">
            <input type="text" data-field="NAME_SHORT" value="${escapeHtml(node.NAME_SHORT ?? "")}" />
          </div>
        </td>
        <td>
          <input type="text" data-field="NAME_LONG" value="${escapeHtml(node.NAME_LONG ?? "")}" />
        </td>
        <td>
          <input type="number" step="0.01" data-field="REVENUE" value="${Number.isFinite(revenueVal) ? revenueVal : 0}" ${hasChildren || billingTypeIsFixed ? 'readonly class="readonly-field ' + (hasChildren ? 'ps-parent-revenue' : '') + '"' : ""} />
        </td>
        <td>
          <select data-field="BILLING_TYPE_ID" class="ps-select-billing-type">
            ${btOptions(node.BILLING_TYPE_ID)}
          </select>
        </td>
        <td>
          <input type="number" step="0.01" data-field="EXTRAS_PERCENT" value="${Number.isFinite(extrasPercentVal) ? extrasPercentVal : 0}" />
        </td>
        <td>
          <div class="ps-row-actions">
            <button type="button" class="btn-ps-save" data-id="${node.ID}">Speichern</button>
            <button type="button" class="btn-ps-del" data-id="${node.ID}">Löschen</button>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });

    psMsg("", "");
    psShowTable(true);
    // ensure parent revenues are read-only and computed from children in the current DOM
    psRecomputeParentRevenuesFromDom();
    const bulkToggle = document.getElementById("ps-bulk-toggle");
    if (bulkToggle) bulkToggle.disabled = !(nodes && nodes.length);
    psUpdateSelectedCount();
  } catch (err) {
    console.error(err);
    psMsg(err.message || "Fehler", "error");
    psShowTable(false);
  }
}

function wireProjektstrukturNeu() {
  if (__psWired) return;
  __psWired = true;

  // Project autocomplete
  setupAutocomplete({
    inputId: "ps-project",
    hiddenId: "ps-project-id",
    listId: "ps-project-autocomplete",
    minLen: 2,
    search: async (q) => {
      const res = await fetch(`${API_BASE}/projekte/search?q=${encodeURIComponent(q)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "project search failed");
      return json.data || [];
    },
    formatLabel: (p) => `${p.NAME_SHORT || ""}: ${p.NAME_LONG || ""}`.trim(),
    onSelect: async ({ id }) => {
      psClearTable();
      await psLoadProjectStructure(id);
    },
  });

  // Refresh
  document.getElementById("ps-refresh")?.addEventListener("click", async () => {
    const pid = document.getElementById("ps-project-id")?.value;
    await psLoadProjectStructure(pid);
  });

  // Ensure switching projects by typing clears old table
  document.getElementById("ps-project")?.addEventListener("input", () => {
    const hid = document.getElementById("ps-project-id");
    if (hid && !hid.value) {
      __psProjectId = null;
      psResetState();
      psClearTable();
      psShowTable(false);
      const addBtn = document.getElementById("ps-add");
      if (addBtn) addBtn.disabled = true;
    }
  });


  // Toolbar actions
  document.getElementById("ps-add")?.addEventListener("click", () => psOpenAddModal());
  document.getElementById("ps-save-all")?.addEventListener("click", async () => {
    await psSaveAllDirty();
  });
  document.getElementById("ps-bulk-toggle")?.addEventListener("click", () => {
    const panel = document.getElementById("ps-bulk-panel");
    if (!panel) return;
    panel.classList.toggle("hidden");
  });

  document.getElementById("ps-bulk-apply")?.addEventListener("click", () => psBulkApplyToSelection());
  document.getElementById("ps-select-all")?.addEventListener("click", () => {
    __psSelectedIds = new Set((__psNodes || []).map(n => String(n.ID)));
    document.querySelectorAll("#table-projektstruktur .ps-select-row").forEach((cb) => {
      cb.checked = true;
    });
    psUpdateSelectedCount();
  });
  document.getElementById("ps-select-none")?.addEventListener("click", () => {
    __psSelectedIds = new Set();
    document.querySelectorAll("#table-projektstruktur .ps-select-row").forEach((cb) => {
      cb.checked = false;
    });
    psUpdateSelectedCount();
  });

  // Add modal
  document.getElementById("ps-add-cancel")?.addEventListener("click", () => psCloseModal("ps-add-modal"));
  document.getElementById("ps-add-save")?.addEventListener("click", async () => {
    try {
      await psCreateStructure();
    } catch (err) {
      console.error(err);
      showMessage(document.getElementById("ps-add-msg"), err.message || "Fehler", "error");
    }
  });

  // Delete modal
  document.getElementById("ps-del-cancel")?.addEventListener("click", () => psCloseModal("ps-del-modal"));
  document.getElementById("ps-del-confirm")?.addEventListener("click", async () => {
    try {
      await psDeleteStructure({ cascade: false });
    } catch (err) {
      console.error(err);
      showMessage(document.getElementById("ps-del-msg"), err.message || "Fehler", "error");
    }
  });
  document.getElementById("ps-del-confirm-cascade")?.addEventListener("click", async () => {
    try {
      await psDeleteStructure({ cascade: true });
    } catch (err) {
      console.error(err);
      showMessage(document.getElementById("ps-del-msg"), err.message || "Fehler", "error");
    }
  });

}

// --- Projektstruktur: Kontextmenü (Rechtsklick) ---
function psHideContextMenu() {
  const menu = document.getElementById("ps-context-menu");
  if (!menu) return;
  menu.classList.add("hidden");
  __psCtxTargetId = null;
}

function psShowContextMenu(x, y, targetId) {
  const menu = document.getElementById("ps-context-menu");
  if (!menu) return;

  __psCtxTargetId = targetId ? String(targetId) : null;

  const selectedCount = (__psSelectedIds || new Set()).size;
  const addBtn = menu.querySelector('[data-action="add"]');
  const delBtn = menu.querySelector('[data-action="delete"]');

  // Add only if not multi-select
  if (addBtn) addBtn.disabled = selectedCount > 1 || !__psCtxTargetId;
  if (delBtn) delBtn.disabled = !__psCtxTargetId && selectedCount === 0;

  // position within viewport
  const pad = 8;
  menu.classList.remove("hidden");
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - pad;
  const maxY = window.innerHeight - rect.height - pad;
  menu.style.left = `${Math.max(pad, Math.min(x, maxX))}px`;
  menu.style.top = `${Math.max(pad, Math.min(y, maxY))}px`;
}

async function psDeleteMany(ids) {
  const uniq = Array.from(new Set((ids || []).map((x) => String(x))));
  if (!uniq.length) return;
  if (!confirm(`${uniq.length} Elemente löschen?\n\nHinweis: Löschen ist nur möglich, wenn keine Buchungen/Rechnungen darauf verweisen.`)) return;

  psMsg("Lösche Auswahl …", "info");
  const failed = [];

  // Delete deepest first (children before parents) using current father relationships in DOM
  const rows = Array.from(document.querySelectorAll("#table-projektstruktur tbody tr"));
  const fatherById = new Map(rows.map((r) => [String(r.dataset.id), String(r.dataset.fatherId || "")]));

  const depth = (id) => {
    let d = 0;
    let cursor = id;
    const seen = new Set();
    while (fatherById.has(cursor)) {
      const f = fatherById.get(cursor);
      if (!f || f === "0" || f === "" || f === "null" || f === "undefined") break;
      if (seen.has(f)) break;
      seen.add(f);
      d++;
      cursor = f;
    }
    return d;
  };

  uniq.sort((a, b) => depth(b) - depth(a));

  for (let i = 0; i < uniq.length; i++) {
    const id = uniq[i];
    try {
      psMsg(`Lösche ${i + 1} / ${uniq.length} …`, "info");
      const res = await fetch(`${API_BASE}/projekte/structure/${encodeURIComponent(id)}?cascade=0`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Fehler beim Löschen");
    } catch (err) {
      failed.push({ id, error: err.message || "Fehler" });
    }
  }

  await psLoadProjectStructure(__psProjectId);
  __psSelectedIds = new Set();
  psUpdateSelectedCount();

  if (failed.length) {
    const msg = failed.slice(0, 6).map((f) => `#${f.id}: ${f.error}`).join("\n");
    psMsg(`Einige Elemente konnten nicht gelöscht werden (${failed.length}/${uniq.length}).\n${msg}`, "error");
  } else {
    psMsg("Auswahl gelöscht.", "success");
  }
}

document.addEventListener("contextmenu", (e) => {
  const row = e.target?.closest?.("#table-projektstruktur tbody tr");
  if (!row) return;
  e.preventDefault();
  const id = row.dataset.id;
  if (!id) return;
  psShowContextMenu(e.clientX, e.clientY, id);
});

document.addEventListener("click", (e) => {
  const menu = document.getElementById("ps-context-menu");
  if (!menu || menu.classList.contains("hidden")) return;
  if (e.target?.closest?.("#ps-context-menu")) return;
  psHideContextMenu();
});

document.addEventListener("scroll", () => psHideContextMenu(), true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") psHideContextMenu();
});

document.addEventListener("click", async (e) => {
  const btn = e.target?.closest?.("#ps-context-menu .ps-context-item");
  if (!btn) return;
  const act = btn.getAttribute("data-action");
  const clickedId = __psCtxTargetId;
  psHideContextMenu();

  if (act === "add") {
    if ((__psSelectedIds || new Set()).size > 1) {
      psMsg("Element anlegen ist nur bei einer Auswahl möglich.", "error");
      return;
    }
    if (!clickedId) return;
    psOpenAddModal({ parentId: clickedId });
    return;
  }

  if (act === "delete") {
    const ids = psGetSelectedIdsOrClicked(clickedId);
    if (ids.length > 1) {
      await psDeleteMany(ids);
    } else if (ids.length === 1) {
      psOpenDeleteModal(ids[0]);
    }
  }
});

// Show view
document.getElementById("btn-projektstruktur")?.addEventListener("click", () => {
  wireProjektstrukturNeu();
  psMsg("", "");
  psShowTable(false);
  showView("view-projektstruktur");
});

// Leistungsstände (Projektübersicht)
document.getElementById("btn-leistungsstaende")?.addEventListener("click", () => {
  wireLeistungsstaende();
  lsMsg("", "");
  lsShowTable(false);
  showView("view-leistungsstaende");
});

// Billing type change behaviour in new table
document.addEventListener("change", async (e) => {
  if (!e.target.classList.contains("ps-select-billing-type")) return;

  const sel = e.target;
  const row = sel.closest("tr");
  if (!row) return;

  const billingTypeId = parseInt(sel.value, 10);
  const fixed = billingTypeId === 2;
  const hasChildren = row.dataset.hasChildren === "1";

  const revenueInput = row.querySelector('input[data-field="REVENUE"]');
  if (revenueInput) {
    // rule: if the node has children, REVENUE is always read-only and equals the sum of children
    revenueInput.readOnly = hasChildren || fixed;
    revenueInput.classList.toggle("readonly-field", hasChildren || fixed);
    revenueInput.classList.toggle("ps-parent-revenue", hasChildren);

    if (hasChildren) {
      // recompute from children in DOM
      psRecomputeParentRevenuesFromDom();
    } else if (fixed) {
      let tecSum = Number(row.dataset.tecSum ?? NaN);

      if (!Number.isFinite(tecSum)) {
        const structureId = row.dataset.id;
        if (structureId) {
          const res = await fetch(`${API_BASE}/projekte/structure/${encodeURIComponent(structureId)}/tec-sum`);
          const json = await res.json().catch(() => ({}));
          if (res.ok) tecSum = Number(json.sum ?? 0);
        }
      }

      if (Number.isFinite(tecSum)) {
        revenueInput.value = tecSum;
        row.dataset.tecSum = String(tecSum);
      }
    } else {
      const stored = Number(row.dataset.storedRevenue ?? NaN);
      if (Number.isFinite(stored)) revenueInput.value = stored;
    }
  }
  if (row.dataset.id) psSetDirty(row.dataset.id, true);
  // propagate changes to parent sums
  psRecomputeParentRevenuesFromDom();
});

// Save row (PATCH)
document.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("btn-ps-save")) return;

  const btn = e.target;
  const id = btn.dataset.id;
  const row = btn.closest("tr");
  if (!id || !row) return;

  const nameShort = row.querySelector('input[data-field="NAME_SHORT"]')?.value?.trim() ?? "";
  const nameLong = row.querySelector('input[data-field="NAME_LONG"]')?.value?.trim() ?? "";
  const revenue = parseFloat(row.querySelector('input[data-field="REVENUE"]')?.value ?? "0") || 0;
  const billingTypeIdRaw = row.querySelector('select[data-field="BILLING_TYPE_ID"]')?.value;
  const billingTypeId = billingTypeIdRaw ? parseInt(billingTypeIdRaw, 10) : null;
  const extrasPercent = parseFloat(row.querySelector('input[data-field="EXTRAS_PERCENT"]')?.value ?? "0") || 0;

  // Determine whether user changed values that can be inherited to children
  const origBtRaw = row.dataset.origBillingTypeId ?? "";
  const origBt = origBtRaw ? parseInt(origBtRaw, 10) : null;
  const origExtrasRaw = row.dataset.origExtrasPercent ?? "";
  const origExtras = origExtrasRaw === "" ? null : Number(origExtrasRaw);
  const changedBillingType = origBt !== null && billingTypeId !== null ? Number(origBt) !== Number(billingTypeId) : origBtRaw === "" ? false : true;
  const changedExtrasPercent = origExtras !== null ? Math.abs(Number(origExtras) - Number(extrasPercent)) > 1e-9 : origExtrasRaw === "" ? false : true;

  if (!nameShort) {
    psMsg("NAME_SHORT darf nicht leer sein.", "error");
    return;
  }
  if (!billingTypeId || Number.isNaN(billingTypeId)) {
    psMsg("Bitte eine Abrechnungsart auswählen.", "error");
    return;
  }

  const payload = {
    NAME_SHORT: nameShort,
    NAME_LONG: nameLong,
    REVENUE: revenue,
    BILLING_TYPE_ID: billingTypeId,
    EXTRAS_PERCENT: extrasPercent,
  };

  btn.disabled = true;
  btn.textContent = "Speichere …";
  psMsg("", "");

  try {
    const res = await fetch(`${API_BASE}/projekte/structure/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Speichern");

    // Update computed revenue/extras from backend
    if (json?.computed?.REVENUE !== undefined) {
      const revInput = row.querySelector('input[data-field="REVENUE"]');
      if (revInput) revInput.value = json.computed.REVENUE;

      // Keep stored revenue for switching away from billing type 2
      row.dataset.storedRevenue = String(json.computed.REVENUE);
      row.dataset.tecSum = String(json.computed.REVENUE);
    }

    // Persist new originals (so we don't prompt again on unchanged save)
    row.dataset.origBillingTypeId = billingTypeId == null ? "" : String(billingTypeId);
    row.dataset.origExtrasPercent = String(extrasPercent);

    // If billing type or extras percent changed AND the node has children, offer inheritance
    const hasChildren = row.dataset.hasChildren === "1";
    const shouldOfferInherit = hasChildren && (changedBillingType || changedExtrasPercent);
    if (shouldOfferInherit) {
      const parts = [];
      if (changedBillingType) parts.push("Abrechnungsart");
      if (changedExtrasPercent) parts.push("Nebenkosten %");
      const msg = `${parts.join(" und ")} wurde${parts.length === 1 ? "" : "n"} geändert. Auf alle Unterelemente übernehmen?`;
      const ok = window.confirm(msg);
      if (ok) {
        try {
          const inheritPayload = {};
          if (changedBillingType) inheritPayload.BILLING_TYPE_ID = billingTypeId;
          if (changedExtrasPercent) inheritPayload.EXTRAS_PERCENT = extrasPercent;

          const inhRes = await fetch(`${API_BASE}/projekte/structure/${encodeURIComponent(id)}/inherit`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(inheritPayload),
          });
          const inhJson = await inhRes.json().catch(() => ({}));
          if (!inhRes.ok) throw new Error(inhJson.error || "Fehler bei der Vererbung");

          psMsg("Gespeichert und auf Unterelemente übernommen.", "success");
          await psLoadProjectStructure(__psProjectId);
          return;
        } catch (inhErr) {
          console.error(inhErr);
          psMsg(inhErr.message || "Fehler bei der Vererbung", "error");
        }
      }
    }

    psSetDirty(id, false);
    psMsg("Gespeichert.", "success");
  } catch (err) {
    console.error(err);
    psMsg(err.message || "Fehler", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Speichern";
  }
});
// Delete row (modal)
document.addEventListener("click", (e) => {
  if (!e.target.classList.contains("btn-ps-del")) return;
  const id = e.target.dataset.id;
  if (!id) return;
  psOpenDeleteModal(id);
});





// Mark dirty on edits (new Projektstruktur table)
document.addEventListener("input", (e) => {
  const fieldEl = e.target?.closest?.("#table-projektstruktur [data-field]");
  if (!fieldEl) return;
  const row = fieldEl.closest("tr");
  const id = row?.dataset?.id;
  if (id) psSetDirty(id, true);

  // live recompute parent sums when leaf revenues change
  const fld = fieldEl.getAttribute("data-field");
  if (fld === "REVENUE") psRecomputeParentRevenuesFromDom();
});

document.addEventListener("change", (e) => {
  // Row selection
  if (e.target?.classList?.contains("ps-select-row")) {
    const id = e.target.getAttribute("data-id");
    if (id) {
      if (e.target.checked) __psSelectedIds.add(String(id));
      else __psSelectedIds.delete(String(id));
      psUpdateSelectedCount();
    }
    return;
  }

  const fieldEl = e.target?.closest?.("#table-projektstruktur [data-field]");
  if (!fieldEl) return;
  const row = fieldEl.closest("tr");
  const id = row?.dataset?.id;
  if (id) psSetDirty(id, true);
});

// Drag & drop to move nodes
document.addEventListener("dragstart", (e) => {
  const handle = e.target?.closest?.(".ps-drag-handle");
  if (!handle) return;
  const id = handle.getAttribute("data-id");
  if (!id) return;

  __psDragId = String(id);
  try {
    e.dataTransfer.setData("text/plain", __psDragId);
    e.dataTransfer.effectAllowed = "move";
  } catch (_) {}
});

document.addEventListener("dragend", () => {
  __psDragId = null;
  document.querySelectorAll("#table-projektstruktur tr.ps-drag-over").forEach((r) => r.classList.remove("ps-drag-over"));
  document.getElementById("ps-drop-root")?.classList.remove("ps-root-over");
});

document.addEventListener("dragover", (e) => {
  if (!__psDragId) return;

  const rootZone = e.target?.closest?.("#ps-drop-root");
  if (rootZone) {
    e.preventDefault();
    rootZone.classList.add("ps-root-over");
    return;
  }

  const row = e.target?.closest?.("#table-projektstruktur tbody tr");
  if (!row) return;

  e.preventDefault();
  row.classList.add("ps-drag-over");
});

document.addEventListener("dragleave", (e) => {
  const row = e.target?.closest?.("#table-projektstruktur tbody tr");
  if (row) row.classList.remove("ps-drag-over");

  const rootZone = e.target?.closest?.("#ps-drop-root");
  if (rootZone) rootZone.classList.remove("ps-root-over");
});

async function psMoveStructure(structureId, newFatherId) {
  const payload = { father_id: newFatherId === null ? null : newFatherId };
  const res = await fetch(`${API_BASE}/projekte/structure/${encodeURIComponent(structureId)}/move`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Verschieben");
  return true;
}

document.addEventListener("drop", async (e) => {
  if (!__psDragId) return;

  const dragId = __psDragId;
  const rootZone = e.target?.closest?.("#ps-drop-root");

  const row = e.target?.closest?.("#table-projektstruktur tbody tr");
  const targetId = row?.dataset?.id ? String(row.dataset.id) : null;

  // allow dropping to root
  if (rootZone) {
    e.preventDefault();
    try {
      await psMoveStructure(dragId, null);
      psMsg("Verschoben.", "success");
      await psLoadProjectStructure(__psProjectId);
    } catch (err) {
      console.error(err);
      psMsg(err.message || "Fehler", "error");
    }
    return;
  }

  if (!targetId) return;

  e.preventDefault();

  if (targetId === dragId) return;

  try {
    await psMoveStructure(dragId, targetId);
    psMsg("Verschoben.", "success");
    await psLoadProjectStructure(__psProjectId);
  } catch (err) {
    console.error(err);
    psMsg(err.message || "Fehler", "error");
  }
});

// Save all dirty rows
async function psSaveRowById(id) {
  const row = document.querySelector(`#table-projektstruktur tbody tr[data-id="${cssEscape(String(id))}"]`);
  if (!row) return;

  const nameShort = row.querySelector('input[data-field="NAME_SHORT"]')?.value?.trim() ?? "";
  const nameLong = row.querySelector('input[data-field="NAME_LONG"]')?.value?.trim() ?? "";
  const revenue = parseFloat(row.querySelector('input[data-field="REVENUE"]')?.value ?? "0") || 0;
  const billingTypeIdRaw = row.querySelector('select[data-field="BILLING_TYPE_ID"]')?.value;
  const billingTypeId = billingTypeIdRaw ? parseInt(billingTypeIdRaw, 10) : null;
  const extrasPercent = parseFloat(row.querySelector('input[data-field="EXTRAS_PERCENT"]')?.value ?? "0") || 0;

  if (!nameShort) throw new Error(`NAME_SHORT darf nicht leer sein (ID ${id}).`);
  if (!billingTypeId || Number.isNaN(billingTypeId)) throw new Error(`Abrechnungsart fehlt (ID ${id}).`);

  const payload = { NAME_SHORT: nameShort, NAME_LONG: nameLong, REVENUE: revenue, BILLING_TYPE_ID: billingTypeId, EXTRAS_PERCENT: extrasPercent };

  const res = await fetch(`${API_BASE}/projekte/structure/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Fehler beim Speichern (ID ${id})`);

  if (json?.computed?.REVENUE !== undefined) {
    const revInput = row.querySelector('input[data-field="REVENUE"]');
    if (revInput) revInput.value = json.computed.REVENUE;
    row.dataset.storedRevenue = String(json.computed.REVENUE);
    row.dataset.tecSum = String(json.computed.REVENUE);
  }

  psSetDirty(id, false);
}

// Toolbar wiring (bulk save / bulk apply / create / delete)
async function psSaveAllDirty() {
  const ids = Array.from(__psDirtyIds);
  if (!ids.length) return;

  const btn = document.getElementById("ps-save-all");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Speichere …";
  }
  psMsg("", "");

  try {
    for (let i = 0; i < ids.length; i++) {
      psMsg(`Speichere ${i + 1} / ${ids.length} …`, "info");
      await psSaveRowById(ids[i]);
    }
    psMsg("Alle Änderungen gespeichert.", "success");
  } catch (err) {
    console.error(err);
    psMsg(err.message || "Fehler", "error");
  } finally {
    if (btn) {
      btn.disabled = __psDirtyIds.size === 0;
      btn.textContent = "Änderungen speichern";
    }
  }
}

function psOpenAddModal(opts = {}) {
  if (!__psProjectId) {
    psMsg("Bitte zuerst ein Projekt auswählen.", "error");
    return;
  }
  psClearMessages();
  psBuildParentOptions();
  psFillBillingTypeSelect(document.getElementById("ps-add-billing-type"));
  document.getElementById("ps-add-name-short").value = "";
  document.getElementById("ps-add-name-long").value = "";
  document.getElementById("ps-add-revenue").value = "";
  document.getElementById("ps-add-extras-percent").value = "";
  document.getElementById("ps-add-parent").value = "";

  // Optional prefill from parent (right-click)
  const parentId = opts.parentId ? String(opts.parentId) : "";
  if (parentId) {
    const parentSel = document.getElementById("ps-add-parent");
    if (parentSel) parentSel.value = parentId;

    const parentNode = (__psNodes || []).find((n) => String(n.ID) === parentId);
    if (parentNode) {
      // Inherit billing type + extras percent
      const btSel = document.getElementById("ps-add-billing-type");
      if (btSel && parentNode.BILLING_TYPE_ID != null) btSel.value = String(parentNode.BILLING_TYPE_ID);
      const extrasInp = document.getElementById("ps-add-extras-percent");
      if (extrasInp && parentNode.EXTRAS_PERCENT != null) extrasInp.value = String(parentNode.EXTRAS_PERCENT);
    }
  }
  psOpenModal("ps-add-modal");
  document.getElementById("ps-add-name-short")?.focus();
}

async function psCreateStructure() {
  const msgEl = document.getElementById("ps-add-msg");
  const nameShort = document.getElementById("ps-add-name-short")?.value?.trim() ?? "";
  const nameLong = document.getElementById("ps-add-name-long")?.value?.trim() ?? "";
  const billingTypeIdRaw = document.getElementById("ps-add-billing-type")?.value;
  const billingTypeId = billingTypeIdRaw ? parseInt(billingTypeIdRaw, 10) : null;
  const revenue = parseFloat(document.getElementById("ps-add-revenue")?.value ?? "") || 0;
  const extrasPercent = parseFloat(document.getElementById("ps-add-extras-percent")?.value ?? "") || 0;
  const fatherIdRaw = document.getElementById("ps-add-parent")?.value;

  if (!nameShort) return showMessage(msgEl, "NAME_SHORT ist erforderlich.", "error");
  if (!billingTypeId) return showMessage(msgEl, "Bitte eine Abrechnungsart auswählen.", "error");

  const payload = {
    NAME_SHORT: nameShort,
    NAME_LONG: nameLong,
    BILLING_TYPE_ID: billingTypeId,
    REVENUE: revenue,
    EXTRAS_PERCENT: extrasPercent,
    FATHER_ID: fatherIdRaw ? parseInt(fatherIdRaw, 10) : null,
  };

  showMessage(msgEl, "Lege Element an …", "info");

  const res = await fetch(`${API_BASE}/projekte/${encodeURIComponent(__psProjectId)}/structure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Anlegen");

  showMessage(msgEl, "Element angelegt.", "success");
  psCloseModal("ps-add-modal");
  await psLoadProjectStructure(__psProjectId);
}

let __psDeleteId = null;

function psOpenDeleteModal(id) {
  __psDeleteId = String(id);
  psClearMessages();

  const node = (__psNodes || []).find(n => String(n.ID) === String(id));
  const name = node?.NAME_SHORT ? `${node.NAME_SHORT}` : `#${id}`;

  // detect children
  const hasChildren = (__psNodes || []).some(n => String(n.FATHER_ID || "") === String(id));
  const textEl = document.getElementById("ps-del-text");

  if (textEl) {
    textEl.innerHTML = `
      <p>Soll das Element <strong>${escapeHtml(name)}</strong> gelöscht werden?</p>
      ${hasChildren ? `<p><strong>Achtung:</strong> Das Element hat Unterelemente.</p>` : ""}
      <p>Hinweis: Löschen ist nur möglich, wenn keine Buchungen/Rechnungen darauf verweisen.</p>
    `;
  }

  const cascadeBtn = document.getElementById("ps-del-confirm-cascade");
  if (cascadeBtn) cascadeBtn.classList.toggle("hidden", !hasChildren);

  psOpenModal("ps-del-modal");
}

async function psDeleteStructure({ cascade }) {
  const id = __psDeleteId;
  const msgEl = document.getElementById("ps-del-msg");
  if (!id) return;

  showMessage(msgEl, "Lösche …", "info");

  const res = await fetch(`${API_BASE}/projekte/structure/${encodeURIComponent(id)}?cascade=${cascade ? "1" : "0"}`, {
    method: "DELETE",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Löschen");

  showMessage(msgEl, "Gelöscht.", "success");
  psCloseModal("ps-del-modal");
  await psLoadProjectStructure(__psProjectId);
}

// Apply bulk values to selected rows (UI only; then mark dirty)
function psBulkApplyToSelection() {
  if (!__psSelectedIds.size) {
    psMsg("Keine Elemente ausgewählt.", "error");
    return;
  }

  const btRaw = document.getElementById("ps-bulk-billing-type")?.value ?? "";
  const extrasRaw = document.getElementById("ps-bulk-extras-percent")?.value ?? "";

  __psSelectedIds.forEach((id) => {
    const row = document.querySelector(`#table-projektstruktur tbody tr[data-id="${cssEscape(String(id))}"]`);
    if (!row) return;

    if (btRaw) {
      const sel = row.querySelector('select[data-field="BILLING_TYPE_ID"]');
      if (sel) {
        sel.value = btRaw;
        // Trigger change so revenue readonly logic is applied
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    if (extrasRaw !== "") {
      const inp = row.querySelector('input[data-field="EXTRAS_PERCENT"]');
      if (inp) inp.value = extrasRaw;
    }

    psSetDirty(id, true);
  });

  psMsg("Auf Auswahl angewendet (bitte speichern).", "success");
}







// --- Leistungsstände eintragen (Projektübersicht) ---
let __lsWired = false;
let __lsProjectId = null;
let __lsNodes = [];
let __lsChildrenByParent = new Map();

function lsMsg(text, type = "") {
  const el = document.getElementById("ls-msg");
  if (el) showMessage(el, text, type);
}

function lsShowTable(show) {
  const wrap = document.getElementById("ls-table-wrap");
  if (!wrap) return;
  wrap.classList.toggle("hidden", !show);
}

function lsClearTable() {
  const tbody = document.querySelector("#table-leistungsstaende tbody");
  if (tbody) tbody.innerHTML = "";
}

function lsResetState() {
  __lsProjectId = null;
  __lsNodes = [];
  __lsChildrenByParent = new Map();
  lsClearTable();
  lsShowTable(false);
  const btnSave = document.getElementById("ls-save");
  if (btnSave) btnSave.disabled = true;
}

function lsBuildChildrenMap(nodes) {
  const map = new Map();
  (nodes || []).forEach((n) => {
    const fidRaw = n.FATHER_ID;
    const fid = fidRaw === 0 || fidRaw === "0" || fidRaw === null || fidRaw === undefined ? null : String(fidRaw);
    const id = String(n.ID);
    if (fid) {
      const arr = map.get(fid) || [];
      arr.push(id);
      map.set(fid, arr);
    }
    if (!map.has(id)) map.set(id, map.get(id) || []);
  });
  return map;
}

function lsComputeAggregates(nodes) {
  // Computes per node: __HAS_CHILDREN, __REVENUE_SUM, __EXTRAS_SUM (sums over leaves)
  const byId = new Map((nodes || []).map((n) => [String(n.ID), n]));
  const childMap = lsBuildChildrenMap(nodes);
  const visiting = new Set();
  const memo = new Map();

  const dfs = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return { rev: 0, ex: 0 };
    visiting.add(id);

    const node = byId.get(id);
    const children = childMap.get(id) || [];

    let rev = 0;
    let ex = 0;
    if (children.length) {
      for (const cid of children) {
        const r = dfs(String(cid));
        rev += Number(r.rev || 0);
        ex += Number(r.ex || 0);
      }
    } else {
      const tecSum = Number(node?.TEC_SP_TOT_SUM ?? 0) || 0;
      const btId = Number(node?.BILLING_TYPE_ID ?? 0) || 0;
      const storedRevenue = Number(node?.REVENUE ?? 0) || 0;
      rev = btId === 2 ? tecSum : storedRevenue;

      // For BILLING_TYPE_ID = 2, Nebenkosten are derived from Honorar * EXTRAS_PERCENT / 100 (to avoid stale stored values)
      const extrasPercent = Number(node?.EXTRAS_PERCENT ?? 0) || 0;
      ex = btId === 2 ? (rev * extrasPercent) / 100 : (Number(node?.EXTRAS ?? 0) || 0);
    }

    visiting.delete(id);
    const out = { rev, ex };
    memo.set(id, out);
    return out;
  };

  (nodes || []).forEach((n) => {
    const id = String(n.ID);
    const children = childMap.get(id) || [];
    n.__HAS_CHILDREN = children.length > 0;
    const agg = dfs(id);
    n.__REVENUE_SUM = agg.rev;
    n.__EXTRAS_SUM = agg.ex;
  });

  __lsChildrenByParent = childMap;
}

function lsRenderTable() {
  const tbody = document.querySelector("#table-leistungsstaende tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const roots = psBuildTree(__lsNodes || []);
  const flat = psFlattenTree(roots);

  flat.forEach(({ node, level }) => {
    const id = String(node.ID);
    const hasChildren = !!node.__HAS_CHILDREN;
    const btId = Number(node.BILLING_TYPE_ID || 0);
    const isLeaf = !hasChildren;
    const isEditable = isLeaf && btId === 1;

    const rev = Number(node.__REVENUE_SUM ?? node.REVENUE ?? 0) || 0;
    const ex = Number(node.__EXTRAS_SUM ?? node.EXTRAS ?? 0) || 0;

    const revPct = Number(node.REVENUE_COMPLETION_PERCENT ?? 0) || 0;
    const exPct = Number(node.EXTRAS_COMPLETION_PERCENT ?? 0) || 0;

    // UI uses a single percentage input (Lst % Honorar). Persisted values are kept in both fields.
    const uiPct = revPct;

    const revComp = (uiPct * rev) / 100;
    const exComp = (uiPct * ex) / 100;

    const tr = document.createElement("tr");
    tr.dataset.id = id;
    tr.dataset.level = String(level);
    tr.dataset.hasChildren = hasChildren ? "1" : "0";
    tr.dataset.billingTypeId = String(btId);
    tr.dataset.editable = isEditable ? "1" : "0";
    tr.dataset.revPct = String(revPct);
    tr.dataset.exPct = String(exPct);
    tr.dataset.rev = String(rev);
    tr.dataset.ex = String(ex);

    const indent = level * 18;

    const pctInput = (value) => {
      const ro = isEditable ? "" : 'readonly class="readonly-field"';
      return `<input type="number" step="0.01" data-field="COMPLETION_PERCENT" value="${Number.isFinite(value) ? value : 0}" ${ro} />`;
    };

    tr.innerHTML = `
      <td>
        <div style="padding-left:${indent}px">
          ${escapeHtml(node.NAME_SHORT ?? "")}
        </div>
      </td>
      <td>${Number.isFinite(rev) ? rev.toFixed(2) : "0.00"}</td>
      <td>${Number.isFinite(ex) ? ex.toFixed(2) : "0.00"}</td>
      <td>${pctInput(uiPct)}</td>
      <td data-role="rev-comp">${Number.isFinite(revComp) ? revComp.toFixed(2) : "0.00"}</td>
      <td data-role="ex-comp">${Number.isFinite(exComp) ? exComp.toFixed(2) : "0.00"}</td>
    `;

    // Visual cue for non-editable rows
    if (!isEditable) tr.classList.add("ls-readonly");

    tbody.appendChild(tr);
  });
}

async function lsLoadProjectStructure(projectId) {
  const pid = String(projectId || "").trim();
  if (!pid) {
    lsMsg("Bitte ein Projekt auswählen.", "error");
    lsResetState();
    return;
  }

  __lsProjectId = pid;
  lsMsg("Lade Projektstruktur …", "info");
  lsShowTable(false);
  lsClearTable();

  try {
    const res = await fetch(`${API_BASE}/projekte/${encodeURIComponent(pid)}/structure`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Projektstruktur");

    const nodes = Array.isArray(json.data) ? json.data : [];
    __lsNodes = nodes;
    lsComputeAggregates(__lsNodes);
    lsRenderTable();

    const btnSave = document.getElementById("ls-save");
    if (btnSave) btnSave.disabled = !__lsNodes.length;

    lsMsg("", "");
    lsShowTable(true);
  } catch (err) {
    console.error(err);
    lsMsg(err.message || "Fehler", "error");
    lsShowTable(false);
  }
}

async function lsPersistPercents(structureId, revenuePct, extrasPct) {
  const id = String(structureId || "").trim();
  if (!id) return;

  const row = document.querySelector(`#table-leistungsstaende tbody tr[data-id="${cssEscape(id)}"]`);
  const msg = document.getElementById("ls-msg");

  try {
    if (row) row.classList.add("ls-saving");

    const res = await fetch(`${API_BASE}/projekte/structure/${encodeURIComponent(id)}/completion-percents`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        REVENUE_COMPLETION_PERCENT: revenuePct,
        EXTRAS_COMPLETION_PERCENT: extrasPct,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

    if (row) {
      row.dataset.revPct = String(revenuePct);
      row.dataset.exPct = String(extrasPct);
      row.classList.remove("ls-saving");
      row.classList.add("ls-saved");
      window.setTimeout(() => row.classList.remove("ls-saved"), 900);
    }

    if (msg) showMessage(msg, "", "success");
  } catch (err) {
    if (row) row.classList.remove("ls-saving");
    if (msg) showMessage(msg, "Fehler: " + (err.message || err), "error");
  }
}

async function lsFinalizeSnapshot() {
  if (!__lsProjectId) {
    lsMsg("Bitte ein Projekt auswählen.", "error");
    return;
  }

  const btnSave = document.getElementById("ls-save");
  if (btnSave) btnSave.disabled = true;

  lsMsg("Speichere Leistungsstände …", "info");
  try {
    const res = await fetch(`${API_BASE}/projekte/${encodeURIComponent(__lsProjectId)}/progress-snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

    lsMsg(`Gespeichert. (${json.updated || 0} Elemente aktualisiert)`, "success");
    // Reload to reflect any computed fields or TEC changes.
    await lsLoadProjectStructure(__lsProjectId);
  } catch (err) {
    console.error(err);
    lsMsg("Fehler: " + (err.message || err), "error");
  } finally {
    if (btnSave) btnSave.disabled = !__lsProjectId;
  }
}

function wireLeistungsstaende() {
  if (__lsWired) return;
  __lsWired = true;

  // Project autocomplete
  setupAutocomplete({
    inputId: "ls-project",
    hiddenId: "ls-project-id",
    listId: "ls-project-autocomplete",
    minLen: 2,
    search: async (q) => {
      const res = await fetch(`${API_BASE}/projekte/search?q=${encodeURIComponent(q)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "project search failed");
      return json.data || [];
    },
    formatLabel: (p) => `${p.NAME_SHORT || ""}: ${p.NAME_LONG || ""}`.trim(),
    onSelect: async ({ id }) => {
      await lsLoadProjectStructure(id);
    },
  });

  // Refresh
  document.getElementById("ls-refresh")?.addEventListener("click", async () => {
    const pid = document.getElementById("ls-project-id")?.value;
    await lsLoadProjectStructure(pid);
  });

  // Finalb: if user clears the input, reset table
  document.getElementById("ls-project")?.addEventListener("input", () => {
    const hid = document.getElementById("ls-project-id");
    if (hid && !hid.value) {
      lsResetState();
    }
  });

  // Persist on focusout (save on leaving field)
  document.getElementById("table-leistungsstaende")?.addEventListener(
    "focusout",
    async (e) => {
      const inp = e.target;
      if (!inp || inp.tagName !== "INPUT") return;
      const field = inp.dataset?.field;
      if (field !== "COMPLETION_PERCENT") return;

      const row = inp.closest("tr");
      if (!row) return;
      if (row.dataset.editable !== "1") return;

      const id = row.dataset.id;
      const pct = Number(row.querySelector('input[data-field="COMPLETION_PERCENT"]')?.value ?? row.dataset.revPct ?? 0);
      const revPct = pct;
      const exPct = pct;

      // avoid roundtrips if unchanged
      const prevRev = Number(row.dataset.revPct ?? 0);
      const prevEx = Number(row.dataset.exPct ?? 0);
      if (revPct == prevRev && exPct == prevEx) return;

      await lsPersistPercents(id, revPct, exPct);
    },
    true
  );

  // Live-update computed completion columns while editing.
  document.getElementById("table-leistungsstaende")?.addEventListener(
    "input",
    (e) => {
      const inp = e.target;
      if (!inp || inp.tagName !== "INPUT") return;
      if (inp.dataset?.field !== "COMPLETION_PERCENT") return;
      const row = inp.closest("tr");
      if (!row) return;

      const pct = Number(inp.value ?? 0) || 0;
      const rev = Number(row.dataset.rev ?? 0) || 0;
      const ex = Number(row.dataset.ex ?? 0) || 0;

      const revCompEl = row.querySelector('[data-role="rev-comp"]');
      const exCompEl = row.querySelector('[data-role="ex-comp"]');
      const revComp = (pct * rev) / 100;
      const exComp = (pct * ex) / 100;
      if (revCompEl) revCompEl.textContent = Number.isFinite(revComp) ? revComp.toFixed(2) : "0.00";
      if (exCompEl) exCompEl.textContent = Number.isFinite(exComp) ? exComp.toFixed(2) : "0.00";
    },
    true
  );

  document.getElementById("ls-save")?.addEventListener("click", async () => {
    await lsFinalizeSnapshot();
  });
}
// --- Projektstruktur bearbeiten---
document.getElementById("select-project-edit")?.addEventListener("change", async () => {
  const projectId = document.getElementById("select-project-edit").value;
  const tableBody = document.querySelector("#table-structure-edit tbody");
  tableBody.innerHTML = "";

  if (!projectId) return;

  try {
    // IMPORTANT: always call the backend (port 3000) and not the frontend origin
    const res = await fetch(`${API_BASE}/projekte/${projectId}/structure`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Projektstruktur");
    if (!Array.isArray(json.data) || json.data.length === 0) return;

    const billingTypes = await getBillingTypes();
    const billingTypeOptions = (selectedId) => {
      const sel = String(selectedId ?? "");
      const opts = billingTypes
        .map((bt) => {
          const id = String(bt.ID);
          const label = bt.BILLING_TYPE ?? id;
          return `<option value="${id}" ${id === sel ? "selected" : ""}>${label}</option>`;
        })
        .join("");
      return `<option value="">Bitte wählen …</option>` + opts;
    };

    json.data.forEach((node) => {
      const billingTypeIsFixed = Number(node.BILLING_TYPE_ID) === 2;
      const tecSum = Number(node.TEC_SP_TOT_SUM ?? 0);

      // preserve original stored revenue for switching billing type in the UI
      const storedRevenue = Number(node.REVENUE ?? 0);
      const revenueVal = billingTypeIsFixed ? tecSum : storedRevenue;

      const extrasPercentVal = Number(node.EXTRAS_PERCENT ?? 0);
      const extrasVal = (revenueVal * extrasPercentVal) / 100;

      const row = document.createElement("tr");
      row.dataset.tecSum = String(tecSum);
      row.dataset.storedRevenue = String(storedRevenue);

      row.innerHTML = `
        <td>${node.NAME_SHORT ?? ""}</td>
        <td>
          <select data-field="BILLING_TYPE_ID" class="select-billing-type">
            ${billingTypeOptions(node.BILLING_TYPE_ID)}
          </select>
        </td>
        <td>
          <input type="number" step="0.01" value="${revenueVal}" data-field="REVENUE" ${billingTypeIsFixed ? 'readonly class="readonly-field"' : ""}>
        </td>
        <td>
          <input type="number" step="0.01" value="${extrasPercentVal}" data-field="EXTRAS_PERCENT">
        </td>
        <td>
          <input type="number" step="0.01" value="${extrasVal}" readonly class="readonly-field" data-role="extras-display">
        </td>
        <td>
          <input type="number" step="0.01" value="${node.REVENUE_COMPLETION_PERCENT ?? 0}" data-field="REVENUE_COMPLETION_PERCENT" ${billingTypeIsFixed ? 'readonly class="readonly-field"' : ""}>
        </td>
        <td>
          <input type="number" step="0.01" value="${node.EXTRAS_COMPLETION_PERCENT ?? 0}" data-field="EXTRAS_COMPLETION_PERCENT" ${billingTypeIsFixed ? 'readonly class="readonly-field"' : ""}>
        </td>
        <td>
          <button data-id="${node.ID}" class="btn-save-structure">Speichern</button>
        </td>
      `;

      tableBody.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    alert("Fehler: " + err.message);
  }
});

// Toggle behaviour when changing billing type (Abrechnungsart)
document.addEventListener("change", async (e) => {
  if (!e.target.classList.contains("select-billing-type")) return;

  const sel = e.target;
  const row = sel.closest("tr");
  if (!row) return;

  const billingTypeId = parseInt(sel.value, 10);
  const fixed = billingTypeId === 2;

  const revenueInput = row.querySelector('input[data-field="REVENUE"]');
  const revenuePctInput = row.querySelector('input[data-field="REVENUE_COMPLETION_PERCENT"]');
  const extrasPctInput = row.querySelector('input[data-field="EXTRAS_COMPLETION_PERCENT"]');
  const extrasPercentInput = row.querySelector('input[data-field="EXTRAS_PERCENT"]');
  const extrasDisplay = row.querySelector('input[data-role="extras-display"]');

  // Toggle readonly state for dependent fields
  [revenueInput, revenuePctInput, extrasPctInput].forEach((inp) => {
    if (!inp) return;
    inp.readOnly = fixed;
    inp.classList.toggle("readonly-field", fixed);
  });

  // If fixed billing type: set revenue from TEC sum
  if (fixed && revenueInput) {
    let tecSum = Number(row.dataset.tecSum ?? NaN);

    if (!Number.isFinite(tecSum)) {
      // Fallback: request from backend
      const structureId = row.querySelector("button.btn-save-structure")?.dataset?.id;
      if (structureId) {
        const res = await fetch(`${API_BASE}/projekte/structure/${structureId}/tec-sum`);
        const json = await res.json().catch(() => ({}));
        if (res.ok) tecSum = Number(json.sum ?? 0);
      }
    }

    if (Number.isFinite(tecSum)) {
      revenueInput.value = tecSum;
      row.dataset.tecSum = String(tecSum);
    }
  }

  // If switched away from billing type 2: restore stored revenue (if available)
  if (!fixed && revenueInput) {
    const stored = Number(row.dataset.storedRevenue ?? NaN);
    if (Number.isFinite(stored)) revenueInput.value = stored;
  }

  // Recompute view-only Nebenkosten display client-side (immediate feedback)
  if (extrasPercentInput && extrasDisplay && revenueInput) {
    const rev = Number(revenueInput.value ?? 0);
    const pct = Number(extrasPercentInput.value ?? 0);
    extrasDisplay.value = (rev * pct) / 100;
  }
});

// Live update Nebenkosten display when editing percent or revenue (if editable)
document.addEventListener("input", (e) => {
  const inp = e.target;
  const row = inp.closest("tr");
  if (!row) return;

  if (
    inp.dataset?.field !== "EXTRAS_PERCENT" &&
    inp.dataset?.field !== "REVENUE"
  )
    return;

  const revenueInput = row.querySelector('input[data-field="REVENUE"]');
  const extrasPercentInput = row.querySelector('input[data-field="EXTRAS_PERCENT"]');
  const extrasDisplay = row.querySelector('input[data-role="extras-display"]');
  if (!revenueInput || !extrasPercentInput || !extrasDisplay) return;

  const rev = Number(revenueInput.value ?? 0);
  const pct = Number(extrasPercentInput.value ?? 0);
  extrasDisplay.value = (rev * pct) / 100;
});

// Save structure row (PATCH + computed fields + progress snapshot)
document.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("btn-save-structure")) return;

  const id = e.target.dataset.id;
  const row = e.target.closest("tr");
  if (!row) return;

  const fields = row.querySelectorAll("input[data-field], select[data-field]");
  const payload = {};

  fields.forEach((el) => {
    const field = el.dataset.field;
    if (!field) return;

    if (el.tagName === "SELECT") {
      payload[field] = el.value ? parseInt(el.value, 10) : null;
      return;
    }

    payload[field] = parseFloat(el.value) || 0;
  });

  if (!payload.BILLING_TYPE_ID) {
    alert("Bitte Abrechnungsart auswählen");
    return;
  }

  const res = await fetch(`${API_BASE}/projekte/structure/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    alert(json.error || "Fehler beim Speichern");
    return;
  }

  // Update view-only fields from backend computed result
  if (json?.computed?.REVENUE !== undefined) {
    const revenueInput = row.querySelector('input[data-field="REVENUE"]');
    if (revenueInput) revenueInput.value = json.computed.REVENUE;

    // keep stored revenue for switching back (only meaningful if not billing type 2)
    row.dataset.storedRevenue = String(json.computed.REVENUE);
    row.dataset.tecSum = String(json.computed.REVENUE);
  }

  if (json?.computed?.EXTRAS !== undefined) {
    const extrasDisplay = row.querySelector('input[data-role="extras-display"]');
    if (extrasDisplay) extrasDisplay.value = json.computed.EXTRAS;
  }

  alert("Gespeichert");
});


// --- Stunden buchen---

async function applyEmployee2ProjectPreset() {
  const employeeId = document.getElementById("select-employee")?.value;
  const projectId = document.getElementById("select-project")?.value;
  const spRateEl = document.getElementById("input-sp-rate");
  if (!spRateEl) return;

  if (!employeeId || !projectId) {
    spRateEl.readOnly = false;
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/employee2project/preset?employee_id=${encodeURIComponent(employeeId)}&project_id=${encodeURIComponent(projectId)}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

    if (json.found) {
      if (json.SP_RATE !== undefined && json.SP_RATE !== null) {
        spRateEl.value = json.SP_RATE;
      }
      spRateEl.readOnly = true;
    } else {
      spRateEl.readOnly = false;
    }
  } catch (e) {
    console.error("EMPLOYEE2PROJECT preset failed:", e);
    // fail open (editable) so booking still possible
    spRateEl.readOnly = false;
  }
}

let __buchungEditId = null;
let __buchungEditReturnProjectId = "";

async function enterBuchungEditMode(row) {
  if (!row || !row.ID) return;
  __buchungEditId = row.ID;
  __buchungEditReturnProjectId = String(row.PROJECT_ID ?? "");

  const saveBtn = document.getElementById("btn-save-buchung");
  if (saveBtn) saveBtn.textContent = "Aktualisieren";

  await loadBuchungDropdowns();
  // Fill form fields
  document.getElementById("select-employee").value = String(row.EMPLOYEE_ID ?? "");
  document.getElementById("input-date").value = row.DATE_VOUCHER ?? "";
  document.getElementById("input-start").value = row.TIME_START ?? "";
  document.getElementById("input-end").value = row.TIME_FINISH ?? "";
  document.getElementById("input-quantity-int").value = row.QUANTITY_INT ?? "";
  document.getElementById("input-cp-rate").value = row.CP_RATE ?? "";
  document.getElementById("input-quantity-ext").value = row.QUANTITY_EXT ?? "";
  document.getElementById("input-sp-rate").value = row.SP_RATE ?? "";
  document.getElementById("input-description").value = row.POSTING_DESCRIPTION ?? "";

  // Project + dependent structure dropdown
  const projectId = String(row.PROJECT_ID ?? "");
  const structureId = String(row.STRUCTURE_ID ?? "");
  const projectSelect = document.getElementById("select-project");
  if (projectSelect) projectSelect.value = projectId;
  await loadStructureElements(projectId);
  const structureSelect = document.getElementById("select-structure-element");
  if (structureSelect) structureSelect.value = structureId;

  await applyEmployee2ProjectPreset();
  showView("view-buchung");
}

async function loadBuchungDropdowns() {
  await Promise.all([
    loadDropdown("employee", "mitarbeiter", "ID", "SHORT_NAME"),
    loadDropdown("project", "projekte", "ID", "NAME_SHORT", "NAME_LONG")
  ]);

  // 👇 Add this to load structure elements dynamically
  const projectSelect = document.getElementById("select-project");
  const employeeSelect = document.getElementById("select-employee");

  if (employeeSelect) {
    employeeSelect.addEventListener("change", () => {
      applyEmployee2ProjectPreset();
    });
  }

  if (projectSelect) {
    projectSelect.addEventListener("change", () => {
      const projectId = projectSelect.value;
      loadStructureElements(projectId); // 🧠 Function already exists!
      applyEmployee2ProjectPreset();
    });
  }
}


document.getElementById("btn-save-buchung").addEventListener("click", async () => {
  const msg = document.getElementById("msg-buchung");

  const payload = {
    EMPLOYEE_ID: document.getElementById("select-employee").value,
    DATE_VOUCHER: document.getElementById("input-date").value,
    TIME_START: document.getElementById("input-start").value || null,
    TIME_FINISH: document.getElementById("input-end").value || null,
    QUANTITY_INT: parseFloat(document.getElementById("input-quantity-int").value),
    CP_RATE: parseFloat(document.getElementById("input-cp-rate").value),
    QUANTITY_EXT: parseFloat(document.getElementById("input-quantity-ext").value),
    SP_RATE: parseFloat(document.getElementById("input-sp-rate").value),
    POSTING_DESCRIPTION: document.getElementById("input-description").value.trim(),
    PROJECT_ID: document.getElementById("select-project").value,
	STRUCTURE_ID: document.getElementById("select-structure-element").value || null
  };

  if (!payload.EMPLOYEE_ID || !payload.DATE_VOUCHER || !payload.QUANTITY_INT ||
      !payload.CP_RATE || !payload.QUANTITY_EXT || !payload.SP_RATE ||
      !payload.POSTING_DESCRIPTION || !payload.PROJECT_ID || !payload.STRUCTURE_ID) {
    return showMessage(msg, "Bitte alle Pflichtfelder ausfüllen", "error");
  }

  try {
    const isEdit = Boolean(__buchungEditId);
    const url = isEdit ? `${API_BASE}/buchungen/${encodeURIComponent(__buchungEditId)}` : `${API_BASE}/buchungen`;
    const method = isEdit ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    showMessage(msg, isEdit ? "Buchung aktualisiert" : "Buchung gespeichert ✅", "success");

    // Reset fields
    ["input-date", "input-start", "input-end", "input-quantity-int", "input-cp-rate",
     "input-quantity-ext", "input-sp-rate", "input-description"]
     .forEach(id => document.getElementById(id).value = "");
    ["select-employee", "select-project", "select-structure-element"]
     .forEach(id => document.getElementById(id).value = "");

    if (isEdit) {
      const returnProjectId = __buchungEditReturnProjectId;
      __buchungEditId = null;
      __buchungEditReturnProjectId = "";
      const saveBtn = document.getElementById("btn-save-buchung");
      if (saveBtn) saveBtn.textContent = "Speichern";

      // Return to list and reload
      showView("view-buchungsliste");
      const sel = document.getElementById("select-buchungsliste-projekt");
      if (sel && returnProjectId) sel.value = returnProjectId;
      await loadTecListForProject(returnProjectId);
    }
  } catch (err) {
    showMessage(msg, "Fehler: " + err.message, "error");
  }
});


async function loadStructureElements(projectId) {
  const sel = document.getElementById("select-structure-element");
  sel.innerHTML = `<option value="">Bitte wählen …</option>`;
  if (!projectId) return;

  try {
    const res = await fetch(`${API_BASE}/projekte/${projectId}/structure`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);

    json.data.forEach(el => {
      const opt = document.createElement("option");
      opt.value = el.ID;
      opt.textContent = `${el.NAME_SHORT} – ${el.NAME_LONG}`;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("Fehler beim Laden der Struktur-Elemente", err);
  }
}


// -
// ----------------------------
// Buchungsliste (TEC) – neue Listenansicht
// ----------------------------

const __tecList = {
  projectId: "",
  structureId: "",
  structureMap: {},
  structureLeafOptions: [],
  rows: [],
  sortKey: "DATE_VOUCHER",
  sortDir: "desc",
  global: "",
  filters: {},
  page: 1,
  pageSize: 25,
  wired: false,
};

function _tecEmployeeShort(row) {
  if (row?.EMPLOYEE?.SHORT_NAME) return String(row.EMPLOYEE.SHORT_NAME);
  if (row?.SHORT_NAME) return String(row.SHORT_NAME);
  return "";
}

function _normalizeTecRows(rows) {
  return (rows || []).map(r => ({
    ...r,
    EMPLOYEE_SHORT: _tecEmployeeShort(r),
    STRUCTURE_LABEL: __tecList.structureMap[String(r.STRUCTURE_ID ?? "")] || "",
  }));
}

async function loadBuchungslisteProjects() {
  const sel = document.getElementById("select-buchungsliste-projekt");
  if (!sel) return;
  sel.innerHTML = `<option value="">Bitte wählen …</option>`;

  try {
    const res = await fetch(`${API_BASE}/projekte`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

    (json.data || []).forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.ID;
      opt.textContent = `${p.NAME_SHORT} - ${p.NAME_LONG}`;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("Fehler beim Laden der Projekte", err);
  }
}

async function loadBuchungslisteStructureOptions(projectId) {
  const sel = document.getElementById("select-buchungsliste-structure");
  if (!sel) return;

  __tecList.structureMap = {};
  __tecList.structureLeafOptions = [];

  sel.innerHTML = `<option value="">Alle Elemente</option>`;

  if (!projectId) {
    __tecList.structureId = "";
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/projekte/${encodeURIComponent(projectId)}/structure`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

    const rows = (json.data || []);

    const fatherIds = new Set(rows.map(r => String(r.FATHER_ID || "")).filter(v => v && v !== "0" && v !== "null"));

    const labelOf = (r) => {
      const pos = (r.POSITION_NUMBER ?? r.POS_NR ?? "");
      const desc = (r.DESCRIPTION ?? r.NAME_LONG ?? r.NAME_SHORT ?? r.TITLE ?? "");
      const base = [String(pos).trim(), String(desc).trim()].filter(Boolean).join(" ");
      return base || String(r.ID);
    };

    rows.forEach(r => {
      __tecList.structureMap[String(r.ID)] = labelOf(r);
    });

    // leaf nodes: ID that never appears as FATHER_ID
    const leafs = rows.filter(r => !fatherIds.has(String(r.ID)));

    __tecList.structureLeafOptions = leafs
      .map(r => ({ id: String(r.ID), label: labelOf(r) }))
      .sort((a,b) => a.label.localeCompare(b.label, "de", { numeric: true, sensitivity: "base" }));

    __tecList.structureLeafOptions.forEach(optRow => {
      const opt = document.createElement("option");
      opt.value = optRow.id;
      opt.textContent = optRow.label;
      sel.appendChild(opt);
    });

    // keep current selection if possible
    if (__tecList.structureId) {
      const exists = __tecList.structureLeafOptions.some(o => o.id === __tecList.structureId);
      if (!exists) __tecList.structureId = "";
    }
    sel.value = __tecList.structureId || "";
  } catch (err) {
    console.error("Fehler beim Laden der Struktur-Elemente (Buchungsliste)", err);
  }
}


async function loadTecListForProject(projectId) {
  const msg = document.getElementById("msg-buchungsliste");
  const tbody = document.querySelector("#tbl-buchungsliste tbody");
  if (tbody) tbody.innerHTML = "";

  __tecList.projectId = projectId || "";
  __tecList.rows = [];
  __tecList.page = 1;

  if (!projectId) {
    __tecList.structureId = "";
    await loadBuchungslisteStructureOptions("");
    _renderTecList();
    return;
  }

  try {
    await loadBuchungslisteStructureOptions(projectId);
    const res = await fetch(`${API_BASE}/buchungen/project/${projectId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

    __tecList.rows = _normalizeTecRows(json.data || []);
    _renderTecList();
    showMessage(msg, "", "");
  } catch (err) {
    console.error(err);
    showMessage(msg, "Fehler beim Laden der Buchungen", "error");
  }
}

function _applyTecTransforms() {
  const g = (_str(__tecList.global)).toLowerCase();
  const filters = __tecList.filters || {};

  let rows = (__tecList.rows || []).slice();

  // structure filter (leaf selector)
  if (__tecList.structureId) {
    const sid = String(__tecList.structureId);
    rows = rows.filter(r => String(r.STRUCTURE_ID ?? "") === sid);
  }

  // global search
  if (g) {
    rows = rows.filter(r => {
      const hay = [
        r.DATE_VOUCHER,
        r.EMPLOYEE_SHORT,
        r.STRUCTURE_LABEL,
        r.TIME_START,
        r.TIME_FINISH,
        r.QUANTITY_INT,
        r.CP_RATE,
        r.CP_TOT,
        r.QUANTITY_EXT,
        r.SP_RATE,
        r.SP_TOT,
        r.POSTING_DESCRIPTION
      ].map(v => _str(v).toLowerCase()).join(" | ");
      return hay.includes(g);
    });
  }

  // column filters
  Object.keys(filters).forEach(k => {
    const val = _str(filters[k]).trim().toLowerCase();
    if (!val) return;
    rows = rows.filter(r => _str(r[k]).toLowerCase().includes(val));
  });

  // sort
  const key = __tecList.sortKey;
  const dir = __tecList.sortDir;

  rows.sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];

    // numeric-ish keys
    const numericKeys = new Set(["QUANTITY_INT","CP_RATE","CP_TOT","QUANTITY_EXT","SP_RATE","SP_TOT"]);
    if (numericKeys.has(key)) {
      const an = parseFloat(String(av ?? "").replace(",", "."));
      const bn = parseFloat(String(bv ?? "").replace(",", "."));
      const cmp = (Number.isFinite(an) ? an : 0) - (Number.isFinite(bn) ? bn : 0);
      return dir === "asc" ? cmp : -cmp;
    }

    // date-ish: YYYY-MM-DD
    if (key === "DATE_VOUCHER") {
      const cmp = _str(av).localeCompare(_str(bv));
      return dir === "asc" ? cmp : -cmp;
    }

    const cmp = _str(av).localeCompare(_str(bv), "de", { numeric: true, sensitivity: "base" });
    return dir === "asc" ? cmp : -cmp;
  });

  return rows;
}

function _updateTecTotals(filteredRows) {
  const sumQtyInt = filteredRows.reduce((acc, r) => acc + (parseFloat(String(r.QUANTITY_INT ?? "").replace(",", ".")) || 0), 0);
  const sumCp = filteredRows.reduce((acc, r) => acc + (parseFloat(String(r.CP_TOT ?? "").replace(",", ".")) || 0), 0);
  const sumSp = filteredRows.reduce((acc, r) => acc + (parseFloat(String(r.SP_TOT ?? "").replace(",", ".")) || 0), 0);

  const elQty = document.getElementById("tec-sum-qty-int");
  const elCp = document.getElementById("tec-sum-cp");
  const elSp = document.getElementById("tec-sum-sp");
  if (elQty) elQty.textContent = sumQtyInt.toFixed(2);
  if (elCp) elCp.textContent = sumCp.toFixed(2);
  if (elSp) elSp.textContent = sumSp.toFixed(2);
}

function _renderTecList() {
  const tbody = document.querySelector("#tbl-buchungsliste tbody");
  const info = document.getElementById("tec-page-info");
  if (!tbody) return;

  const filtered = _applyTecTransforms();
  _updateTecTotals(filtered);

  const totalPages = Math.max(1, Math.ceil(filtered.length / __tecList.pageSize));
  __tecList.page = Math.min(Math.max(1, __tecList.page), totalPages);

  const start = (__tecList.page - 1) * __tecList.pageSize;
  const pageRows = filtered.slice(start, start + __tecList.pageSize);

  tbody.innerHTML = "";

  pageRows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${_str(r.DATE_VOUCHER)}</td>
      <td>${_str(r.EMPLOYEE_SHORT)}</td>
      <td>${_str(r.STRUCTURE_LABEL)}</td>
      <td>${_str(r.TIME_START)}</td>
      <td>${_str(r.TIME_FINISH)}</td>
      <td class="num">${_str(r.QUANTITY_INT)}</td>
      <td class="num">${_str(r.CP_RATE)}</td>
      <td class="num">${_str(r.CP_TOT)}</td>
      <td class="num">${_str(r.QUANTITY_EXT)}</td>
      <td class="num">${_str(r.SP_RATE)}</td>
      <td class="num">${_str(r.SP_TOT)}</td>
      <td>${_str(r.POSTING_DESCRIPTION)}</td>
      <td>
        <button class="btn-small tec-edit-btn" data-id="${_str(r.ID)}">Bearbeiten</button>
        <button class="btn-small btn-danger tec-del-btn" data-id="${_str(r.ID)}">Löschen</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (info) info.textContent = `Seite ${__tecList.page} / ${totalPages}`;
}

function _openTecEditModal(row) {
  const modal = document.getElementById("tec-edit-modal");
  if (!modal) return;

  document.getElementById("tec-edit-id").value = row.ID ?? "";
  document.getElementById("tec-edit-date").value = row.DATE_VOUCHER ?? "";
  document.getElementById("tec-edit-start").value = row.TIME_START ?? "";
  document.getElementById("tec-edit-finish").value = row.TIME_FINISH ?? "";

  document.getElementById("tec-edit-qty-int").value = row.QUANTITY_INT ?? "";
  document.getElementById("tec-edit-cp-rate").value = row.CP_RATE ?? "";
  document.getElementById("tec-edit-cp-tot").value = row.CP_TOT ?? "";

  document.getElementById("tec-edit-qty-ext").value = row.QUANTITY_EXT ?? "";
  document.getElementById("tec-edit-sp-rate").value = row.SP_RATE ?? "";
  document.getElementById("tec-edit-sp-tot").value = row.SP_TOT ?? "";

  document.getElementById("tec-edit-desc").value = row.POSTING_DESCRIPTION ?? "";

  showMessage(document.getElementById("tec-edit-msg"), "", "");
  const del = document.getElementById("tec-edit-delete");
  if (del) del.disabled = !(row.ID);
  modal.classList.remove("hidden");
}

function _closeTecEditModal() {
  const modal = document.getElementById("tec-edit-modal");
  if (!modal) return;
  modal.classList.add("hidden");
}

function _recalcTecEditTotals() {
  const qInt = parseFloat(document.getElementById("tec-edit-qty-int").value || "0");
  const cpRate = parseFloat(document.getElementById("tec-edit-cp-rate").value || "0");
  const qExt = parseFloat(document.getElementById("tec-edit-qty-ext").value || "0");
  const spRate = parseFloat(document.getElementById("tec-edit-sp-rate").value || "0");
  const cpTot = (qInt * cpRate);
  const spTot = (qExt * spRate);
  document.getElementById("tec-edit-cp-tot").value = Number.isFinite(cpTot) ? cpTot.toFixed(2) : "0.00";
  document.getElementById("tec-edit-sp-tot").value = Number.isFinite(spTot) ? spTot.toFixed(2) : "0.00";
}



async function _deleteTecBooking(id) {
  if (!id) return;
  const ok = confirm("Buchung wirklich löschen?");
  if (!ok) return;

  try {
    const res = await fetch(`${API_BASE}/buchungen/${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    await loadTecListForProject(__tecList.projectId);
  } catch (err) {
    console.error(err);
    alert("Fehler beim Löschen: " + err.message);
  }
}
async function _saveTecEdit() {
  const msg = document.getElementById("tec-edit-msg");
  const id = document.getElementById("tec-edit-id").value;
  if (!id) return;

  _recalcTecEditTotals();

  const payload = {
    DATE_VOUCHER: document.getElementById("tec-edit-date").value || null,
    TIME_START: document.getElementById("tec-edit-start").value || null,
    TIME_FINISH: document.getElementById("tec-edit-finish").value || null,
    QUANTITY_INT: parseFloat(document.getElementById("tec-edit-qty-int").value || "0"),
    CP_RATE: parseFloat(document.getElementById("tec-edit-cp-rate").value || "0"),
    QUANTITY_EXT: parseFloat(document.getElementById("tec-edit-qty-ext").value || "0"),
    SP_RATE: parseFloat(document.getElementById("tec-edit-sp-rate").value || "0"),
    POSTING_DESCRIPTION: document.getElementById("tec-edit-desc").value || "",
  };

  try {
    const res = await fetch(`${API_BASE}/buchungen/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

    showMessage(msg, "Gespeichert.", "success");
    _closeTecEditModal();
    await loadTecListForProject(__tecList.projectId);
  } catch (err) {
    console.error(err);
    showMessage(msg, "Fehler beim Speichern: " + err.message, "error");
  }
}

function wireTecListEvents() {
  if (__tecList.wired) return;
  __tecList.wired = true;

  // project change
  document.getElementById("select-buchungsliste-projekt")?.addEventListener("change", (e) => {
    const projId = e.target.value;
    loadTecListForProject(projId);
  });

  // structure leaf filter
  document.getElementById("select-buchungsliste-structure")?.addEventListener("change", (e) => {
    __tecList.structureId = e.target.value || "";
    __tecList.page = 1;
    _renderTecList();
  });

  // global search
  document.getElementById("tec-list-global")?.addEventListener("input", (e) => {
    __tecList.global = e.target.value || "";
    __tecList.page = 1;
    _renderTecList();
  });

  // refresh
  document.getElementById("tec-list-refresh")?.addEventListener("click", () => {
    if (__tecList.projectId) loadTecListForProject(__tecList.projectId);
  });

  // filter row
  document.querySelectorAll(".tec-filter").forEach(inp => {
    inp.addEventListener("input", () => {
      const key = inp.getAttribute("data-filter-key");
      if (!key) return;
      __tecList.filters[key] = inp.value || "";
      __tecList.page = 1;
      _renderTecList();
    });
  });

  // sorting
  document.querySelectorAll("#tbl-buchungsliste thead tr:first-child th[data-key]").forEach(th => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-key");
      if (!key) return;
      if (__tecList.sortKey === key) {
        __tecList.sortDir = __tecList.sortDir === "asc" ? "desc" : "asc";
      } else {
        __tecList.sortKey = key;
        __tecList.sortDir = "asc";
      }
      _renderTecList();
    });
  });

  // pagination
  document.getElementById("tec-page-prev")?.addEventListener("click", () => {
    __tecList.page = Math.max(1, __tecList.page - 1);
    _renderTecList();
  });
  document.getElementById("tec-page-next")?.addEventListener("click", () => {
    __tecList.page += 1;
    _renderTecList();
  });

  // row actions
  document.querySelector("#tbl-buchungsliste tbody")?.addEventListener("click", (e) => {
    const delBtn = e.target.closest(".tec-del-btn");
    if (delBtn) {
      const did = delBtn.getAttribute("data-id");
      if (did) _deleteTecBooking(did);
      return;
    }

    const btn = e.target.closest(".tec-edit-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const row = (__tecList.rows || []).find(r => String(r.ID) === String(id));
	    if (row) enterBuchungEditMode(row);
  });

  // modal events
  document.getElementById("tec-edit-cancel")?.addEventListener("click", _closeTecEditModal);
  document.getElementById("tec-edit-save")?.addEventListener("click", _saveTecEdit);
  document.getElementById("tec-edit-delete")?.addEventListener("click", () => {
    const id = document.getElementById("tec-edit-id").value;
    _closeTecEditModal();
    _deleteTecBooking(id);
  });

  ["tec-edit-qty-int","tec-edit-cp-rate","tec-edit-qty-ext","tec-edit-sp-rate"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", _recalcTecEditTotals);
  });
}

// Initial view boot
document.addEventListener("DOMContentLoaded", () => {
  showView("main-menu");
  wireTecListEvents();
});

function setupAutocomplete({ inputId, hiddenId, listId, minLen = 2, search, formatLabel, onSelect }) {
  const input = document.getElementById(inputId);
  const hidden = document.getElementById(hiddenId);
  const list = document.getElementById(listId);
  if (!input || !hidden || !list) return;

  const close = () => {
    list.classList.remove("open");
    list.innerHTML = "";
  };

  const open = () => list.classList.add("open");

  const setSelection = (id, label, extra = {}) => {
    hidden.value = id || "";
    input.value = label || "";
    input.dataset.selectedLabel = label || "";
    Object.entries(extra).forEach(([k, v]) => {
      input.dataset[k] = String(v ?? "");
    });
    close();
    if (typeof onSelect === "function") onSelect({ id, label, extra });
  };

  const runSearch = async (q) => {
    const query = (q || "").trim();
    const selectedLabel = (input.dataset.selectedLabel || "").trim();
    if (hidden.value && selectedLabel && query !== selectedLabel) {
      hidden.value = "";
      input.dataset.selectedLabel = "";
    }
    if (query.length < minLen) {
      close();
      return;
    }

    try {
      const rows = await search(query);
      list.innerHTML = "";
      if (!rows || !rows.length) {
        const empty = document.createElement("div");
        empty.className = "autocomplete-item muted";
        empty.textContent = "Keine Treffer";
        list.appendChild(empty);
        open();
        return;
      }

      rows.forEach((row) => {
        const item = document.createElement("div");
        item.className = "autocomplete-item";
        const label = formatLabel(row);
        item.textContent = label;
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          setSelection(row.ID, label, row);
        });
        list.appendChild(item);
      });
      open();
    } catch (err) {
      console.error("Autocomplete error", err);
      list.innerHTML = "";
      const it = document.createElement("div");
      it.className = "autocomplete-item muted";
      it.textContent = "Fehler bei der Suche";
      list.appendChild(it);
      open();
    }
  };

  input.addEventListener(
    "input",
    debounce((e) => runSearch(e.target.value), 250)
  );
  input.addEventListener("focus", (e) => {
    const q = (e.target.value || "").trim();
    if (q.length >= minLen) runSearch(q);
  });
  input.addEventListener("blur", () => setTimeout(close, 150));

  // click outside
  document.addEventListener("click", (e) => {
    const clickedInside = input.contains(e.target) || list.contains(e.target);
    if (!clickedInside) close();
  });
}

// ----------------------------
// Zahlungen (PAYMENT entry)
// ----------------------------

function paymentsReset() {
  const msg = document.getElementById("msg-payments");
  if (msg) showMessage(msg, "", "");

  const idsToClear = [
    "pay-pp",
    "pay-pp-id",
    "pay-invoice",
    "pay-invoice-id",
    "pay-amount-gross",
    "pay-date",
    "pay-purpose",
    "pay-comment",
  ];
  idsToClear.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "INPUT" || el.tagName === "SELECT") el.value = "";
    if (el.dataset) el.dataset.selectedLabel = "";
  });

  const d = document.getElementById("pay-date");
  if (d && !d.value) d.value = todayIso();
}

function _clearPaymentPpSelection() {
  const inEl = document.getElementById("pay-pp");
  const idEl = document.getElementById("pay-pp-id");
  if (inEl) {
    inEl.value = "";
    inEl.dataset.selectedLabel = "";
  }
  if (idEl) idEl.value = "";
}

function _clearPaymentInvoiceSelection() {
  const inEl = document.getElementById("pay-invoice");
  const idEl = document.getElementById("pay-invoice-id");
  if (inEl) {
    inEl.value = "";
    inEl.dataset.selectedLabel = "";
  }
  if (idEl) idEl.value = "";
}

let __paymentsWired = false;

(function wirePaymentsEntryOnce() {
  if (__paymentsWired) return;
  __paymentsWired = true;

  // Abschlagsrechnung (PARTIAL_PAYMENT)
  setupAutocomplete({
    inputId: "pay-pp",
    hiddenId: "pay-pp-id",
    listId: "pay-pp-autocomplete",
    minLen: 2,
    search: async (q) => {
      const res = await fetch(`${API_BASE}/partial-payments?limit=50&q=${encodeURIComponent(q)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "partial payment search failed");
      return json.data || [];
    },
    formatLabel: (p) => {
      const num = _str(p.PARTIAL_PAYMENT_NUMBER);
      const proj = _str(p.PROJECT);
      return proj ? `${num} — ${proj}` : num;
    },
    onSelect: () => {
      // enforce exclusivity
      _clearPaymentInvoiceSelection();
    },
  });

  // Rechnung (INVOICE)
  setupAutocomplete({
    inputId: "pay-invoice",
    hiddenId: "pay-invoice-id",
    listId: "pay-invoice-autocomplete",
    minLen: 2,
    search: async (q) => {
      const res = await fetch(`${API_BASE}/invoices?limit=50&q=${encodeURIComponent(q)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "invoice search failed");
      return json.data || [];
    },
    formatLabel: (i) => {
      const num = _str(i.INVOICE_NUMBER);
      const proj = _str(i.PROJECT);
      return proj ? `${num} — ${proj}` : num;
    },
    onSelect: () => {
      // enforce exclusivity
      _clearPaymentPpSelection();
    },
  });

  // If the user starts typing in one box, clear the other selection.
  document.getElementById("pay-pp")?.addEventListener("input", () => {
    const otherId = document.getElementById("pay-invoice-id")?.value;
    if (otherId) _clearPaymentInvoiceSelection();
  });
  document.getElementById("pay-invoice")?.addEventListener("input", () => {
    const otherId = document.getElementById("pay-pp-id")?.value;
    if (otherId) _clearPaymentPpSelection();
  });

  // Save
  document.getElementById("btn-save-payment")?.addEventListener("click", async () => {
    const msg = document.getElementById("msg-payments");
    const ppId = String(document.getElementById("pay-pp-id")?.value || "").trim();
    const invId = String(document.getElementById("pay-invoice-id")?.value || "").trim();
    const grossRaw = document.getElementById("pay-amount-gross")?.value;
    const date = String(document.getElementById("pay-date")?.value || "").trim();
    const purpose = document.getElementById("pay-purpose")?.value || "";
    const comment = document.getElementById("pay-comment")?.value || "";

    if ((!!ppId && !!invId) || (!ppId && !invId)) {
      return showMessage(msg, "Bitte entweder Abschlagsrechnung ODER Rechnung auswählen.", "error");
    }

    const gross = parseFloat(String(grossRaw || ""));
    if (!Number.isFinite(gross) || gross <= 0) {
      return showMessage(msg, "Bitte eine gültige Summe (brutto) eingeben.", "error");
    }

    if (!date) {
      return showMessage(msg, "Bitte ein Zahlungsdatum wählen.", "error");
    }

    try {
      showMessage(msg, "Speichere Zahlung …", "");
      const res = await fetch(`${API_BASE}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partial_payment_id: ppId || null,
          invoice_id: invId || null,
          amount_payed_gross: gross,
          payment_date: date,
          purpose_of_payment: purpose,
          comment: comment,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Zahlung konnte nicht gespeichert werden");

      const net = json.amount_payed_net;
      const vat = json.amount_payed_vat;
      showMessage(
        msg,
        `Zahlung gespeichert ✅ (Netto: ${_fmtMoney(net)}, MwSt: ${_fmtMoney(vat)})`,
        "success"
      );

      paymentsReset();
      // keep success message visible after reset
      showMessage(
        msg,
        `Zahlung gespeichert ✅ (Netto: ${_fmtMoney(net)}, MwSt: ${_fmtMoney(vat)})`,
        "success"
      );
    } catch (e) {
      showMessage(msg, "Fehler: " + (e.message || e), "error");
    }
  });
})();

function ppReset() {
  __ppId = null;
  __ppCancelOnUnload = false;
  __ppInitInFlight = false;
  const idsToClear = [
    "pp-company",
    "pp-employee",
    "pp-employee-id",
    "pp-project",
    "pp-project-id",
    "pp-contract",
    "pp-contract-id",    "pp-date",
    "pp-due",
    "pp-period-start",
    "pp-period-finish",
    "pp-amount-performance",
    "pp-amount-bookings",
    "pp-amount-net",
    "pp-amount-extras",
    "pp-total-net",
    "pp-comment",
    "pp-vat",
    "pp-vat-id",
    "pp-payment-means",
    "pp-payment-means-id",
  ];
  idsToClear.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "INPUT") el.value = "";
    if (el.tagName === "SELECT") el.value = "";
    el.dataset && (el.dataset.selectedLabel = "");
  });

  // Reset dirty state & disable bookings editor until a proposal is loaded
  const perfEl = document.getElementById("pp-amount-performance");
  if (perfEl) perfEl.dataset.dirty = "";

  const btn = document.getElementById("pp-btn-edit-bookings");
  if (btn) btn.disabled = true;

  __ppTecState.rows = [];

  const dateEl = document.getElementById("pp-date");
  if (dateEl) dateEl.value = ppTodayIso();
}

async function ppDeleteDraftIfAny() {
  if (!__ppId) return true;
  try {
    const res = await fetch(`${API_BASE}/partial-payments/${__ppId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      // keepalive allows the request to be sent during unload/pagehide in supporting browsers
      keepalive: true,
    });
    // If deletion is blocked (e.g., RLS) or route missing, do not pretend success.
    return res.ok;
  } catch (e) {
    console.warn("Draft deletion failed", e);
    return false;
  }
}

async function loadCompaniesForPartialPayment() {
  const sel = document.getElementById("pp-company");
  if (!sel) return;

  sel.innerHTML = `<option value="">Bitte wählen …</option>`;

  try {
    const res = await fetch(`${API_BASE}/stammdaten/companies`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Firmen");
    if (!Array.isArray(json.data)) return;

    json.data.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.ID;
      opt.textContent = c.COMPANY_NAME_1 || String(c.ID);
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("Fehler beim Laden der Firmen (COMPANY)", err);
  }
}

async function initPartialPaymentWizard() {
  ppReset();
  await loadCompaniesForPartialPayment();
  ppShowPage(1);
}



function ppShowPage(pageNo) {
  // Hide all wizard pages
  document.querySelectorAll("#pp-wizard .pp-page").forEach((p) => p.classList.add("hidden"));

  // Show selected page
  const active = document.getElementById(`pp-page-${pageNo}`);
  if (active) active.classList.remove("hidden");

  // When entering billing page, load proposal (and auto-assign billable bookings)
  if (pageNo === 3) {
    ppLoadBillingProposal().catch((err) => {
      const msg = document.getElementById("pp-msg-3");
      if (msg) showMessage(msg, "Fehler: " + err.message, "error");
      console.error(err);
    });
  }

  // When entering summary page, load data
  if (pageNo === 5) {
    ppLoadSummary().catch((err) => {
      const msg = document.getElementById("pp-msg-5");
      if (msg) showMessage(msg, "Fehler: " + err.message, "error");
      console.error(err);
    });
  }
}

function ppComputeHonorarFromParts() {
  const perf = parseFloat(document.getElementById("pp-amount-performance")?.value || "0") || 0;
  const bookings = parseFloat(document.getElementById("pp-amount-bookings")?.value || "0") || 0;

  const honorar = perf + bookings;
  const honorarEl = document.getElementById("pp-amount-net");
  if (honorarEl) honorarEl.value = String(honorar);

  // Update total (honorar + extras)
  ppComputeTotalNet();
  return honorar;
}

function ppComputeTotalNet() {
  const net = parseFloat(document.getElementById("pp-amount-net")?.value || "0") || 0;
  const extras = parseFloat(document.getElementById("pp-amount-extras")?.value || "0") || 0;
  const tot = net + extras;
  const out = document.getElementById("pp-total-net");
  if (out) out.value = String(tot);
  return tot;
}

// Persist "nach Leistungsstand" (BT=1) to backend and update computed totals.
let __ppPerfSaveTimer = null;

async function ppPersistPerformanceAmount(amount) {
  if (!__ppId) return;

  const msg = document.getElementById("pp-msg-3");
  try {
    const res = await fetch(`${API_BASE}/partial-payments/${__ppId}/performance`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

    const data = json.data || {};
    const perfEl = document.getElementById("pp-amount-performance");
    if (perfEl && data.performance_amount !== undefined) {
      perfEl.value = String(_ppRound2(_ppNum(data.performance_amount)));
      perfEl.dataset.dirty = "";
    }

    const bookingsEl = document.getElementById("pp-amount-bookings");
    if (bookingsEl && data.bookings_sum !== undefined) {
      bookingsEl.value = String(_ppRound2(_ppNum(data.bookings_sum)));
    }

    const extrasEl = document.getElementById("pp-amount-extras");
    if (extrasEl && data.amount_extras_net !== undefined) {
      extrasEl.value = String(_ppRound2(_ppNum(data.amount_extras_net)));
    }

    const honorarEl = document.getElementById("pp-amount-net");
    if (honorarEl && data.amount_net !== undefined) {
      honorarEl.value = String(_ppRound2(_ppNum(data.amount_net)));
    } else {
      ppComputeHonorarFromParts();
    }

    const totEl = document.getElementById("pp-total-net");
    if (totEl && data.total_amount_net !== undefined) {
      totEl.value = String(_ppRound2(_ppNum(data.total_amount_net)));
    } else {
      ppComputeTotalNet();
    }

    if (msg) showMessage(msg, "", "success");
  } catch (err) {
    if (msg) showMessage(msg, "Fehler: " + (err.message || err), "error");
  }
}

function ppPersistPerformanceAmountDebounced(amount) {
  if (__ppPerfSaveTimer) window.clearTimeout(__ppPerfSaveTimer);
  __ppPerfSaveTimer = window.setTimeout(() => {
    ppPersistPerformanceAmount(amount);
  }, 450);
}

// --- Billing proposal & TEC bookings editor (Abschlagsrechnung) ---

const __ppTecState = {
  rows: [],
};

function _ppNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function _ppRound2(v) {
  return Math.round(_ppNum(v) * 100) / 100;
}

async function ppLoadBillingProposal() {
  if (!__ppId) return;

  const msg = document.getElementById("pp-msg-3");
  try {
    const res = await fetch(`${API_BASE}/partial-payments/${__ppId}/billing-proposal`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Vorschlag konnte nicht geladen werden");

    const data = json.data || {};
    const bookingsSum = _ppRound2(_ppNum(data.bookings_sum));
    const perfAmount = _ppRound2(_ppNum(data.performance_amount ?? data.performance_suggested));

    const bookingsEl = document.getElementById("pp-amount-bookings");
    if (bookingsEl) bookingsEl.value = String(bookingsSum);

    const perfEl = document.getElementById("pp-amount-performance");
    if (perfEl) {
      const isDirty = perfEl.dataset.dirty === "1";
      if (!isDirty && (perfEl.value === "" || perfEl.value == null)) {
        perfEl.value = String(perfAmount);
      } else if (!isDirty && data.performance_amount !== undefined) {
        // Returning to the page: keep stored performance amount
        perfEl.value = String(perfAmount);
      }
    }

    // Extras + totals are now computed from PARTIAL_PAYMENT_STRUCTURE
    const extrasEl = document.getElementById("pp-amount-extras");
    if (extrasEl && data.amount_extras_net !== undefined) {
      extrasEl.value = String(_ppRound2(_ppNum(data.amount_extras_net)));
    }

    // Compute honorar from the two parts (performance + bookings)
    ppComputeHonorarFromParts();

    // If backend already sent totals, prefer them
    const totEl = document.getElementById("pp-total-net");
    if (totEl && data.total_amount_net !== undefined) {
      totEl.value = String(_ppRound2(_ppNum(data.total_amount_net)));
    }

    // Enable bookings editor
    const btn = document.getElementById("pp-btn-edit-bookings");
    if (btn) btn.disabled = false;

    if (msg) showMessage(msg, "", "success");
  } catch (err) {
    console.error(err);
    if (msg) showMessage(msg, "Vorschlag konnte nicht geladen werden: " + err.message, "error");
  }
}

function ppTecModalSetOpen(isOpen) {
  const modal = document.getElementById("pp-tec-modal");
  if (!modal) return;
  if (isOpen) {
    const del = document.getElementById("tec-edit-delete");
  if (del) del.disabled = !(row.ID);
  modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  } else {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}

function ppTecModalRender() {
  const tbody = document.querySelector("#pp-tec-table tbody");
  const sumEl = document.getElementById("pp-tec-sum");
  if (!tbody) return;

  tbody.innerHTML = "";
  __ppTecState.rows.forEach((r) => {
    const tr = document.createElement("tr");
    const assigned = !!r.ASSIGNED;
    tr.innerHTML = `
      <td style="text-align:center;">
        <input type="checkbox" data-tec-id="${r.ID}" data-initial="${assigned ? "1" : "0"}" ${assigned ? "checked" : ""} />
      </td>
      <td>${_str(r.DATE_VOUCHER)}</td>
      <td>${_str(r.EMPLOYEE_SHORT_NAME)}</td>
      <td>${_str(r.POSTING_DESCRIPTION)}</td>
      <td>${_str(r.SP_TOT)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Bind change listeners for sum calc
  tbody.querySelectorAll("input[type=checkbox][data-tec-id]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const sum = ppTecModalComputeSelectedSum();
      if (sumEl) sumEl.textContent = String(_ppRound2(sum));
    });
  });

  // Initial sum
  const sum = ppTecModalComputeSelectedSum();
  if (sumEl) sumEl.textContent = String(_ppRound2(sum));
}

function ppTecModalComputeSelectedSum() {
  const checked = new Set(
    Array.from(document.querySelectorAll("#pp-tec-table input[type=checkbox][data-tec-id]:checked")).map((cb) =>
      String(cb.getAttribute("data-tec-id"))
    )
  );

  return (__ppTecState.rows || []).reduce((acc, r) => {
    if (checked.has(String(r.ID))) return acc + _ppNum(r.SP_TOT);
    return acc;
  }, 0);
}

async function ppOpenTecModal() {
  const msg = document.getElementById("pp-msg-3");
  if (!__ppId) return showMessage(msg, "Kein Entwurf gefunden (Bitte erneut starten)", "error");

  const modalMsg = document.getElementById("pp-tec-msg");
  if (modalMsg) showMessage(modalMsg, "", "");

  try {
    const res = await fetch(`${API_BASE}/partial-payments/${__ppId}/tec`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Buchungen konnten nicht geladen werden");

    __ppTecState.rows = Array.isArray(json.data) ? json.data : [];
    ppTecModalRender();
    ppTecModalSetOpen(true);
  } catch (err) {
    console.error(err);
    if (msg) showMessage(msg, "Fehler: " + err.message, "error");
  }
}

async function ppSaveTecSelection() {
  if (!__ppId) return;

  const modalMsg = document.getElementById("pp-tec-msg");
  if (modalMsg) showMessage(modalMsg, "", "");

  // Determine deltas
  const all = Array.from(document.querySelectorAll("#pp-tec-table input[type=checkbox][data-tec-id]"));
  const idsAssign = [];
  const idsUnassign = [];

  all.forEach((cb) => {
    const id = String(cb.getAttribute("data-tec-id"));
    const initial = cb.getAttribute("data-initial") === "1";
    const now = cb.checked;

    if (!initial && now) idsAssign.push(id);
    if (initial && !now) idsUnassign.push(id);
  });

  const perfEl = document.getElementById("pp-amount-performance");
  const performanceAmount = _ppNum(perfEl?.value);

  try {
    const res = await fetch(`${API_BASE}/partial-payments/${__ppId}/tec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids_assign: idsAssign,
        ids_unassign: idsUnassign,
        performance_amount: performanceAmount,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

    const data = json.data || {};
    const bookingsSum = _ppRound2(_ppNum(data.bookings_sum));

    const bookingsEl = document.getElementById("pp-amount-bookings");
    if (bookingsEl) bookingsEl.value = String(bookingsSum);

    // Update performance (if backend returned it)
    const perfEl2 = document.getElementById("pp-amount-performance");
    if (perfEl2 && data.performance_amount !== undefined) {
      perfEl2.value = String(_ppRound2(_ppNum(data.performance_amount)));
      perfEl2.dataset.dirty = "";
    }

    // Update computed extras + totals
    const extrasEl = document.getElementById("pp-amount-extras");
    if (extrasEl && data.amount_extras_net !== undefined) {
      extrasEl.value = String(_ppRound2(_ppNum(data.amount_extras_net)));
    }
    const honorarEl = document.getElementById("pp-amount-net");
    if (honorarEl && data.amount_net !== undefined) {
      honorarEl.value = String(_ppRound2(_ppNum(data.amount_net)));
    } else {
      // Fallback: compute from parts
      ppComputeHonorarFromParts();
    }

    const totEl = document.getElementById("pp-total-net");
    if (totEl && data.total_amount_net !== undefined) {
      totEl.value = String(_ppRound2(_ppNum(data.total_amount_net)));
    } else {
      ppComputeTotalNet();
    }

    // Close modal
    ppTecModalSetOpen(false);

    if (modalMsg) showMessage(modalMsg, "Gespeichert", "success");
  } catch (err) {
    console.error(err);
    if (modalMsg) showMessage(modalMsg, "Fehler: " + err.message, "error");
  }
}

// Modal wiring
(function wirePpTecModal() {
  const close = () => ppTecModalSetOpen(false);

  document.getElementById("pp-tec-close")?.addEventListener("click", close);
  document.getElementById("pp-tec-cancel")?.addEventListener("click", close);
  document.getElementById("pp-tec-save")?.addEventListener("click", ppSaveTecSelection);

  // Clicking outside the content closes
  document.getElementById("pp-tec-modal")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "pp-tec-modal") close();
  });
})();

// Wire autocompletes (once)
(function wirePartialPaymentWizard() {
  // Employee
  setupAutocomplete({
    inputId: "pp-employee",
    hiddenId: "pp-employee-id",
    listId: "pp-employee-autocomplete",
    minLen: 2,
    search: async (q) => {
      const res = await fetch(`${API_BASE}/mitarbeiter/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "employee search failed");
      return json.data || [];
    },
    formatLabel: (e) => `${e.SHORT_NAME || ""}: ${(e.FIRST_NAME || "").trim()} ${(e.LAST_NAME || "").trim()}`.trim(),
  });

  // Project
  setupAutocomplete({
    inputId: "pp-project",
    hiddenId: "pp-project-id",
    listId: "pp-project-autocomplete",
    minLen: 2,
    search: async (q) => {
      const res = await fetch(`${API_BASE}/projekte/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "project search failed");
      return json.data || [];
    },
    formatLabel: (p) => `${p.NAME_SHORT || ""}: ${p.NAME_LONG || ""}`.trim(),
    onSelect: () => {
      // Clear contract when project changes
      const cIn = document.getElementById("pp-contract");
      const cId = document.getElementById("pp-contract-id");
      if (cIn) {
        cIn.value = "";
        cIn.dataset.selectedLabel = "";
      }
      if (cId) cId.value = "";
    },
  });

  // Contract (filtered by project)
  setupAutocomplete({
    inputId: "pp-contract",
    hiddenId: "pp-contract-id",
    listId: "pp-contract-autocomplete",
    minLen: 2,
    search: async (q) => {
      const pid = document.getElementById("pp-project-id")?.value;
      if (!pid) return [];
      const res = await fetch(
        `${API_BASE}/projekte/contracts/search?project_id=${encodeURIComponent(pid)}&q=${encodeURIComponent(q)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "contract search failed");
      return json.data || [];
    },
    formatLabel: (c) => `${c.NAME_SHORT || ""}: ${c.NAME_LONG || ""}`.trim(),
  });

  // VAT
  setupAutocomplete({
    inputId: "pp-vat",
    hiddenId: "pp-vat-id",
    listId: "pp-vat-autocomplete",
    minLen: 1,
    search: async (q) => {
      const res = await fetch(`${API_BASE}/stammdaten/vat/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "vat search failed");
      return json.data || [];
    },
    formatLabel: (v) => `${v.VAT || ""}: ${v.VAT_PERCENT ?? ""} %`.trim(),
  });

  // Payment means
  setupAutocomplete({
    inputId: "pp-payment-means",
    hiddenId: "pp-payment-means-id",
    listId: "pp-payment-means-autocomplete",
    minLen: 2,
    search: async (q) => {
      const res = await fetch(`${API_BASE}/stammdaten/payment-means/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "payment means search failed");
      return json.data || [];
    },
    formatLabel: (p) => `${p.NAME_SHORT || ""}: ${p.NAME_LONG || ""}`.trim(),
  });

  // Total net live calc
  const perfEl = document.getElementById("pp-amount-performance");
  perfEl?.addEventListener("input", () => {
    perfEl.dataset.dirty = "1";
    ppComputeHonorarFromParts();
    ppPersistPerformanceAmountDebounced(_ppNum(perfEl.value));
  });

  // Extras are computed from PARTIAL_PAYMENT_STRUCTURE (read-only)

  // Open bookings editor
  document.getElementById("pp-btn-edit-bookings")?.addEventListener("click", ppOpenTecModal);
})();

// Page navigation handlers
document.getElementById("pp-next-1")?.addEventListener("click", async () => {
  const msg = document.getElementById("pp-msg-1");
  const nextBtn = document.getElementById("pp-next-1");

  // Prevent creating multiple draft rows (double-click / slow response).
  if (__ppInitInFlight) return;
  // If a draft already exists, reuse it.
  if (__ppId) {
    const d = document.getElementById("pp-date");
    if (d && !d.value) d.value = ppTodayIso();
    ppShowPage(2);
    return;
  }
  const companyId = document.getElementById("pp-company")?.value;
  const employeeId = document.getElementById("pp-employee-id")?.value;
  const projectId = document.getElementById("pp-project-id")?.value;
  const contractId = document.getElementById("pp-contract-id")?.value;

  if (!companyId || !employeeId || !projectId || !contractId) {
    return showMessage(msg, "Bitte alle Pflichtfelder ausfüllen", "error");
  }

  try {
    __ppInitInFlight = true;
    if (nextBtn) nextBtn.disabled = true;
    const res = await fetch(`${API_BASE}/partial-payments/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: companyId,
        employee_id: employeeId,
        project_id: projectId,
        contract_id: contractId,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "init failed");
    __ppId = json.id;
    // preselect today's date
    const d = document.getElementById("pp-date");
    if (d && !d.value) d.value = ppTodayIso();
    ppShowPage(2);
    showMessage(msg, "", "success");
  } catch (err) {
    showMessage(msg, "Fehler: " + err.message, "error");
  } finally {
    __ppInitInFlight = false;
    if (nextBtn) nextBtn.disabled = false;
  }
});

document.getElementById("pp-prev-2")?.addEventListener("click", () => ppShowPage(1));
document.getElementById("pp-prev-3")?.addEventListener("click", () => ppShowPage(2));
document.getElementById("pp-prev-4")?.addEventListener("click", () => ppShowPage(3));
document.getElementById("pp-prev-5")?.addEventListener("click", () => ppShowPage(4));

document.getElementById("pp-next-2")?.addEventListener("click", async () => {
  const msg = document.getElementById("pp-msg-2");
  if (!__ppId) return showMessage(msg, "Kein Entwurf gefunden (Bitte erneut starten)", "error");

  const payload = {
    partial_payment_date: document.getElementById("pp-date")?.value,
    due_date: document.getElementById("pp-due")?.value,
    billing_period_start: document.getElementById("pp-period-start")?.value,
    billing_period_finish: document.getElementById("pp-period-finish")?.value,
  };

  if (!payload.partial_payment_date || !payload.due_date || !payload.billing_period_start || !payload.billing_period_finish) {
    return showMessage(msg, "Bitte alle Pflichtfelder ausfüllen", "error");
  }

  try {
    const res = await fetch(`${API_BASE}/partial-payments/${__ppId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "save failed");
    ppShowPage(3);
    showMessage(msg, "", "success");
  } catch (err) {
    showMessage(msg, "Fehler: " + err.message, "error");
  }
});

document.getElementById("pp-next-3")?.addEventListener("click", async () => {
  const msg = document.getElementById("pp-msg-3");
  if (!__ppId) return showMessage(msg, "Kein Entwurf gefunden (Bitte erneut starten)", "error");

  // Amounts are computed and persisted via PARTIAL_PAYMENT_STRUCTURE.
  // We only validate that we have values and proceed.
  ppComputeHonorarFromParts();
  ppComputeTotalNet();

  const amountNetRaw = document.getElementById("pp-amount-net")?.value;
  const amountExtrasRaw = document.getElementById("pp-amount-extras")?.value;
  if (amountNetRaw === "" || amountExtrasRaw === "") {
    return showMessage(msg, "Bitte warten bis die Summen berechnet sind", "error");
  }

  ppShowPage(4);
  showMessage(msg, "", "success");
});

document.getElementById("pp-next-4")?.addEventListener("click", async () => {
  const msg = document.getElementById("pp-msg-4");
  if (!__ppId) return showMessage(msg, "Kein Entwurf gefunden (Bitte erneut starten)", "error");

  const vatId = document.getElementById("pp-vat-id")?.value;
  const pmId = document.getElementById("pp-payment-means-id")?.value;

  if (!vatId || !pmId) {
    return showMessage(msg, "Bitte alle Pflichtfelder ausfüllen", "error");
  }

  const payload = {
    comment: document.getElementById("pp-comment")?.value,
    vat_id: vatId,
    payment_means_id: pmId,
  };

  try {
    const res = await fetch(`${API_BASE}/partial-payments/${__ppId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "save failed");

    // Load summary
    await ppLoadSummary();
    ppShowPage(5);
    showMessage(msg, "", "success");
  } catch (err) {
    showMessage(msg, "Fehler: " + err.message, "error");
  }
});

async function ppLoadSummary() {
  if (!__ppId) return;
  const res = await fetch(`${API_BASE}/partial-payments/${__ppId}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "summary load failed");

  const { pp, project, contract } = json.data || {};
  const projText = project ? `${project.NAME_SHORT || ""}: ${project.NAME_LONG || ""}`.trim() : "";
  const ctrText = contract ? `${contract.NAME_SHORT || ""}: ${contract.NAME_LONG || ""}`.trim() : "";

  const totalNet = parseFloat(pp?.TOTAL_AMOUNT_NET ?? 0) || 0;
  const vatPct = parseFloat(pp?.VAT_PERCENT ?? 0) || 0;
  const tax = (totalNet * vatPct) / 100;
  const gross = totalNet + tax;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? "";
  };

  set("pp-sum-project", projText);
  set("pp-sum-contract", ctrText);
  set("pp-sum-number", pp?.PARTIAL_PAYMENT_NUMBER || "wird beim Buchen vergeben");
  set("pp-sum-date", pp?.PARTIAL_PAYMENT_DATE || "");
  set("pp-sum-due", pp?.DUE_DATE || "");
  set("pp-sum-period-start", pp?.BILLING_PERIOD_START || "");
  set("pp-sum-period-finish", pp?.BILLING_PERIOD_FINISH || "");
  set("pp-sum-address", pp?.ADDRESS_NAME_1 || "");
  set("pp-sum-contact", pp?.CONTACT || "");
  set("pp-sum-amount-net", String(pp?.AMOUNT_NET ?? ""));
  set("pp-sum-amount-extras", String(pp?.AMOUNT_EXTRAS_NET ?? ""));
  set("pp-sum-total-net", String(totalNet));
  set("pp-sum-tax", String(tax));
  set("pp-sum-gross", String(gross));
}

document.getElementById("pp-book")?.addEventListener("click", async () => {
  const msg = document.getElementById("pp-msg-5");
  if (!__ppId) return showMessage(msg, "Kein Entwurf gefunden (Bitte erneut starten)", "error");

  try {
    const res = await fetch(`${API_BASE}/partial-payments/${__ppId}/book`, {
      method: "POST",
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "booking failed");
    showMessage(msg, `Abschlagsrechnung gebucht ✅${json?.number ? " (" + json.number + ")" : ""}`, "success");
    // Reset wizard for next entry
    await initPartialPaymentWizard();
  } catch (err) {
    showMessage(msg, "Fehler: " + err.message, "error");
  }
});

// Download E-Invoice (XRechnung UBL XML)
document.getElementById("pp-einvoice-ubl")?.addEventListener("click", () => {
  const msg = document.getElementById("pp-msg-5");
  if (!__ppId) return showMessage(msg, "Kein Entwurf gefunden (Bitte erneut starten)", "error");
  // Trigger download in a new tab/window
  window.open(`${API_BASE}/partial-payments/${__ppId}/einvoice/ubl`, "_blank");
});

// Download PDF (Abschlagsrechnung)
document.getElementById("pp-pdf")?.addEventListener("click", () => {
  const msg = document.getElementById("pp-msg-5");
  if (!__ppId) return showMessage(msg, "Kein Entwurf gefunden (Bitte erneut starten)", "error");
  window.open(`${API_BASE}/partial-payments/${__ppId}/pdf?download=1`, "_blank");
});


// Download E-Invoice (XRechnung UBL XML) - Rechnungen
document.getElementById("inv-einvoice-ubl")?.addEventListener("click", () => {
  const msg = document.getElementById("inv-msg-5");
  if (!__invId) return showMessage(msg, "Kein Entwurf gefunden (Bitte erneut starten)", "error");
  window.open(`${API_BASE}/invoices/${__invId}/einvoice/ubl`, "_blank");
});

// Download PDF (Rechnungen)
document.getElementById("inv-pdf")?.addEventListener("click", () => {
  const msg = document.getElementById("inv-msg-5");
  if (!__invId) return showMessage(msg, "Kein Entwurf gefunden (Bitte erneut starten)", "error");
  window.open(`${API_BASE}/invoices/${__invId}/pdf?download=1`, "_blank");
});





/* =========================
   Mitarbeiterliste (EMPLOYEE)
   ========================= */

const __empList = {
  rows: [],
  sortKey: "SHORT_NAME",
  sortDir: "asc",
  page: 1,
  pageSize: 25,
  filters: {},
  global: "",
};

function _empMatchesFilter(row, key, needle) {
  const v = _str(row?.[key]);
  return v.toLowerCase().includes(needle.toLowerCase());
}

function _applyEmpListTransforms() {
  let rows = Array.isArray(__empList.rows) ? [...__empList.rows] : [];

  const g = (__empList.global || "").trim().toLowerCase();
  if (g) {
    rows = rows.filter(r => {
      const hay = [
        r.SHORT_NAME, r.FIRST_NAME, r.LAST_NAME, r.MAIL, r.MOBILE, r.PERSONNEL_NUMBER, r.GENDER
      ].map(_str).join(" ").toLowerCase();
      return hay.includes(g);
    });
  }

  Object.entries(__empList.filters || {}).forEach(([k, v]) => {
    const needle = (v || "").trim();
    if (!needle) return;
    rows = rows.filter(r => _empMatchesFilter(r, k, needle));
  });

  const key = __empList.sortKey;
  const dir = __empList.sortDir;
  rows.sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];
    return dir === "asc"
      ? _str(av).localeCompare(_str(bv), "de", { numeric: true, sensitivity: "base" })
      : _str(bv).localeCompare(_str(av), "de", { numeric: true, sensitivity: "base" });
  });

  return rows;
}

function _renderMitarbeiterliste() {
  const tbody = document.querySelector("#tbl-mitarbeiterliste tbody");
  const pageInfo = document.getElementById("emp-list-pageinfo");
  if (!tbody || !pageInfo) return;

  const rows = _applyEmpListTransforms();
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / __empList.pageSize));
  if (__empList.page > pages) __empList.page = pages;
  if (__empList.page < 1) __empList.page = 1;

  const start = (__empList.page - 1) * __empList.pageSize;
  const pageRows = rows.slice(start, start + __empList.pageSize);

  tbody.innerHTML = "";
  pageRows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${_str(r.SHORT_NAME)}</td>
      <td>${_str(r.FIRST_NAME)}</td>
      <td>${_str(r.LAST_NAME)}</td>
      <td>${_str(r.MAIL)}</td>
      <td>${_str(r.MOBILE)}</td>
      <td>${_str(r.PERSONNEL_NUMBER)}</td>
      <td>${_str(r.GENDER)}</td>
      <td><button class="btn-small" data-emp-edit="${_str(r.ID)}">Bearbeiten</button></td>
    `;
    tbody.appendChild(tr);
  });

  pageInfo.textContent = `Seite ${__empList.page} / ${pages} (Einträge: ${total})`;
}

async function loadMitarbeiterListe() {
  const msg = document.getElementById("msg-mitarbeiterliste");
  showMessage(msg, "Lade Mitarbeiterliste …", "");

  try {
    const res = await fetch(`${API_BASE}/mitarbeiter/list?limit=2000`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Fehler beim Laden");

    __empList.rows = Array.isArray(json.data) ? json.data : [];
    __empList.page = 1;
    _renderMitarbeiterliste();
    showMessage(msg, "", "");
  } catch (err) {
    console.error(err);
    showMessage(msg, err.message || "Fehler beim Laden", "error");
  }
}

async function _loadGenderSelect(selectEl, selectedId) {
  if (!selectEl) return;
  selectEl.innerHTML = `<option value="">Bitte wählen …</option>`;
  try {
    const res = await fetch(`${API_BASE}/mitarbeiter/genders`);
    const json = await res.json();
    (json.data || []).forEach(g => {
      const opt = document.createElement("option");
      opt.value = g.ID;
      opt.textContent = g.GENDER;
      selectEl.appendChild(opt);
    });
    if (selectedId != null) selectEl.value = String(selectedId);
  } catch (e) {
    console.error("Fehler beim Laden der Geschlechter", e);
  }
}

// Hook up list UI events (once)
(function initMitarbeiterlisteUI() {
  const root = document.getElementById("view-mitarbeiterliste");
  if (!root) return;

  // global search
  const global = document.getElementById("emp-list-global");
  global?.addEventListener("input", () => {
    __empList.global = global.value || "";
    __empList.page = 1;
    _renderMitarbeiterliste();
  });

  // refresh
  document.getElementById("emp-list-refresh")?.addEventListener("click", loadMitarbeiterListe);

  // pagination
  document.getElementById("emp-list-prev")?.addEventListener("click", () => {
    __empList.page -= 1;
    _renderMitarbeiterliste();
  });
  document.getElementById("emp-list-next")?.addEventListener("click", () => {
    __empList.page += 1;
    _renderMitarbeiterliste();
  });

  // column filters
  root.querySelectorAll("input[data-filter]").forEach(inp => {
    inp.addEventListener("input", () => {
      const k = inp.getAttribute("data-filter");
      if (!k) return;
      __empList.filters[k] = inp.value || "";
      __empList.page = 1;
      _renderMitarbeiterliste();
    });
  });

  // sorting
  root.querySelectorAll("th[data-key]").forEach(th => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-key");
      if (!key) return;
      if (__empList.sortKey === key) {
        __empList.sortDir = __empList.sortDir === "asc" ? "desc" : "asc";
      } else {
        __empList.sortKey = key;
        __empList.sortDir = "asc";
      }
      _renderMitarbeiterliste();
    });
  });

  // edit button delegation
  root.querySelector("#tbl-mitarbeiterliste tbody")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-emp-edit]");
    if (!btn) return;
    const id = btn.getAttribute("data-emp-edit");
    const row = (__empList.rows || []).find(r => String(r.ID) === String(id));
    if (!row) return;
    await openEmpEditModal(row);
  });
})();

function _openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("hidden");
  el.setAttribute("aria-hidden", "false");
}

function _closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("hidden");
  el.setAttribute("aria-hidden", "true");
}

async function openEmpEditModal(row) {
  document.getElementById("msg-emp-edit").textContent = "";
  document.getElementById("emp-edit-id").value = row.ID;
  document.getElementById("emp-edit-short-name").value = row.SHORT_NAME || "";
  document.getElementById("emp-edit-title").value = row.TITLE || "";
  document.getElementById("emp-edit-first-name").value = row.FIRST_NAME || "";
  document.getElementById("emp-edit-last-name").value = row.LAST_NAME || "";
  document.getElementById("emp-edit-mail").value = row.MAIL || "";
  document.getElementById("emp-edit-mobile").value = row.MOBILE || "";
  document.getElementById("emp-edit-personnel").value = row.PERSONNEL_NUMBER || "";

  const selGender = document.getElementById("emp-edit-gender");
  await _loadGenderSelect(selGender, row.GENDER_ID);

  _openModal("emp-edit-modal");
}

document.getElementById("emp-edit-close")?.addEventListener("click", () => _closeModal("emp-edit-modal"));
document.getElementById("emp-edit-cancel")?.addEventListener("click", () => _closeModal("emp-edit-modal"));

document.getElementById("emp-edit-save")?.addEventListener("click", async () => {
  const msg = document.getElementById("msg-emp-edit");
  if (msg) msg.textContent = "";

  const id = document.getElementById("emp-edit-id").value;
  const payload = {
    short_name: document.getElementById("emp-edit-short-name").value.trim(),
    title: document.getElementById("emp-edit-title").value.trim(),
    first_name: document.getElementById("emp-edit-first-name").value.trim(),
    last_name: document.getElementById("emp-edit-last-name").value.trim(),
    mail: document.getElementById("emp-edit-mail").value.trim(),
    mobile: document.getElementById("emp-edit-mobile").value.trim(),
    personnel_number: document.getElementById("emp-edit-personnel").value.trim(),
    gender_id: document.getElementById("emp-edit-gender").value ? Number(document.getElementById("emp-edit-gender").value) : null,
  };

  if (!payload.short_name || !payload.first_name || !payload.last_name || !payload.gender_id) {
    if (msg) msg.textContent = "Bitte Pflichtfelder ausfüllen (Kürzel, Vorname, Nachname, Geschlecht).";
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/mitarbeiter/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Fehler beim Speichern");

    // Update local row in list
    const updated = json.data;
    const idx = (__empList.rows || []).findIndex(r => String(r.ID) === String(id));
    if (idx >= 0) __empList.rows[idx] = updated;
    _renderMitarbeiterliste();

    _closeModal("emp-edit-modal");
  } catch (err) {
    console.error(err);
    if (msg) msg.textContent = err.message || "Fehler beim Speichern";
  }
});



// ================================
// Rechnungen Wizard (Frontend-only)
// ================================

let __invInitDone = false;
let __invId = null;
let __invInitInFlight = false;
let __invCancelOnUnload = false;

// State for TEC bookings editor
const __invTecState = {
  rows: [],
};

async function invDeleteDraftIfAny() {
  if (!__invId) return true;
  try {
    const res = await fetch(`${API_BASE}/invoices/${__invId}`, {
      method: "DELETE",
      keepalive: true,
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      console.error("invDeleteDraftIfAny failed", json);
      return false;
    }
    return true;
  } catch (err) {
    console.error("invDeleteDraftIfAny error", err);
    return false;
  }
}

function invReset() {
  __invId = null;
  __invInitInFlight = false;
  __invCancelOnUnload = false;

  const idsToClear = [
    "inv-company",
    "inv-employee",
    "inv-employee-id",
    "inv-project",
    "inv-project-id",
    "inv-contract",
    "inv-contract-id",    "inv-date",
    "inv-due",
    "inv-period-start",
    "inv-period-finish",
    "inv-amount-performance",
    "inv-amount-bookings",
    "inv-amount-net",
    "inv-amount-extras",
    "inv-total-net",
    "inv-comment",
    "inv-vat",
    "inv-vat-id",
    "inv-payment-means",
    "inv-payment-means-id",
  ];

  idsToClear.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "INPUT") el.value = "";
    if (el.tagName === "SELECT") el.value = "";
    el.dataset && (el.dataset.selectedLabel = "");
  });

  // Default invoice date
  const dateEl = document.getElementById("inv-date");
  if (dateEl) dateEl.value = todayIso();

  // Default amounts
  const perfEl = document.getElementById("inv-amount-performance");
  const bookEl = document.getElementById("inv-amount-bookings");
  const extrasEl = document.getElementById("inv-amount-extras");
  if (perfEl) perfEl.value = perfEl.value || "0";
  if (bookEl) bookEl.value = bookEl.value || "0";
  if (extrasEl) extrasEl.value = extrasEl.value || "0";

  // Reset computed/dirty flags and disable bookings editor until proposal is loaded
  if (perfEl) perfEl.dataset.dirty = "";
  document.getElementById("inv-btn-edit-bookings")?.setAttribute("disabled", "");
  __invTecState.rows = [];

  invComputeHonorarFromParts();

  // Clear wizard messages (avoid stale status messages when restarting the wizard)
  ["inv-msg-1","inv-msg-2","inv-msg-3","inv-msg-4","inv-msg-5"].forEach((mid) => {
    const m = document.getElementById(mid);
    if (m) showMessage(m, "", "success");
  });
}


async function loadCompaniesForInvoice() {
  const sel = document.getElementById("inv-company");
  if (!sel) return;

  sel.innerHTML = `<option value="">Bitte wählen …</option>`;

  try {
    const res = await fetch(`${API_BASE}/stammdaten/companies`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Firmen");
    if (!Array.isArray(json.data)) return;

    json.data.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.ID;
      opt.textContent = c.COMPANY_NAME_1 || String(c.ID);
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("Fehler beim Laden der Firmen (COMPANY)", err);
  }
}

async function initInvoiceWizard() {
  invReset();
  await loadCompaniesForInvoice();
  invShowPage(1);

  // Wire autocompletes once (after DOM is ready)
  if (!__invInitDone) {
    __invInitDone = true;
    wireInvoiceWizard();
  }
}

function invShowPage(pageNo) {
  document.querySelectorAll("#inv-wizard .inv-page").forEach((p) => p.classList.add("hidden"));
  const active = document.getElementById(`inv-page-${pageNo}`);
  if (active) active.classList.remove("hidden");

  if (pageNo === 3) {
    // Load backend proposal + computed values (BT=1 + BT=2)
    invLoadBillingProposal();
  }

  if (pageNo === 5) {
    const msg = document.getElementById("inv-msg-5");
    if (msg) showMessage(msg, "", "success");
    invLoadSummary().catch((e) => console.error(e));
  }
}

function invComputeHonorarFromParts() {
  const perf = parseFloat(document.getElementById("inv-amount-performance")?.value || "0") || 0;
  const bookings = parseFloat(document.getElementById("inv-amount-bookings")?.value || "0") || 0;

  const honorar = perf + bookings;
  const honorarEl = document.getElementById("inv-amount-net");
  if (honorarEl) honorarEl.value = String(honorar);

  invComputeTotalNet();
  return honorar;
}

function invComputeTotalNet() {
  const net = parseFloat(document.getElementById("inv-amount-net")?.value || "0") || 0;
  const extras = parseFloat(document.getElementById("inv-amount-extras")?.value || "0") || 0;
  const tot = net + extras;
  const out = document.getElementById("inv-total-net");
  if (out) out.value = String(tot);
  return tot;
}

// --- Billing proposal & TEC bookings editor (Rechnungen) ---

function _invNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function _invRound2(v) {
  return Math.round(_invNum(v) * 100) / 100;
}

let __invPerfSaveTimer = null;

async function invPersistPerformanceAmount(amount) {
  if (!__invId) return;

  const msg = document.getElementById("inv-msg-3");
  try {
    const res = await fetch(`${API_BASE}/invoices/${__invId}/performance`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

    const data = json.data || {};

    const perfEl = document.getElementById("inv-amount-performance");
    if (perfEl && data.performance_amount !== undefined) {
      perfEl.value = String(_invRound2(_invNum(data.performance_amount)));
      perfEl.dataset.dirty = "";
    }

    const bookingsEl = document.getElementById("inv-amount-bookings");
    if (bookingsEl && data.bookings_sum !== undefined) {
      bookingsEl.value = String(_invRound2(_invNum(data.bookings_sum)));
    }

    const extrasEl = document.getElementById("inv-amount-extras");
    if (extrasEl && data.amount_extras_net !== undefined) {
      extrasEl.value = String(_invRound2(_invNum(data.amount_extras_net)));
    }

    const honorarEl = document.getElementById("inv-amount-net");
    if (honorarEl && data.amount_net !== undefined) {
      honorarEl.value = String(_invRound2(_invNum(data.amount_net)));
    } else {
      invComputeHonorarFromParts();
    }

    const totEl = document.getElementById("inv-total-net");
    if (totEl && data.total_amount_net !== undefined) {
      totEl.value = String(_invRound2(_invNum(data.total_amount_net)));
    } else {
      invComputeTotalNet();
    }

    if (msg) showMessage(msg, "", "success");
  } catch (err) {
    if (msg) showMessage(msg, "Fehler: " + (err.message || err), "error");
  }
}

function invPersistPerformanceAmountDebounced(amount) {
  if (__invPerfSaveTimer) window.clearTimeout(__invPerfSaveTimer);
  __invPerfSaveTimer = window.setTimeout(() => {
    invPersistPerformanceAmount(amount);
  }, 450);
}

async function invLoadBillingProposal() {
  if (!__invId) return;

  const msg = document.getElementById("inv-msg-3");
  try {
    const res = await fetch(`${API_BASE}/invoices/${__invId}/billing-proposal`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Vorschlag konnte nicht geladen werden");

    const data = json.data || {};
    const bookingsSum = _invRound2(_invNum(data.bookings_sum));
    const perfAmount = _invRound2(_invNum(data.performance_amount ?? data.performance_suggested));

    const bookingsEl = document.getElementById("inv-amount-bookings");
    if (bookingsEl) bookingsEl.value = String(bookingsSum);

    const perfEl = document.getElementById("inv-amount-performance");
    if (perfEl) {
      const isDirty = perfEl.dataset.dirty === "1";
      if (!isDirty && (perfEl.value === "" || perfEl.value == null)) {
        perfEl.value = String(perfAmount);
      } else if (!isDirty && data.performance_amount !== undefined) {
        perfEl.value = String(perfAmount);
      }
    }

    const extrasEl = document.getElementById("inv-amount-extras");
    if (extrasEl && data.amount_extras_net !== undefined) {
      extrasEl.value = String(_invRound2(_invNum(data.amount_extras_net)));
    }

    const honorarEl = document.getElementById("inv-amount-net");
    if (honorarEl && data.amount_net !== undefined) {
      honorarEl.value = String(_invRound2(_invNum(data.amount_net)));
    } else {
      invComputeHonorarFromParts();
    }

    const totEl = document.getElementById("inv-total-net");
    if (totEl && data.total_amount_net !== undefined) {
      totEl.value = String(_invRound2(_invNum(data.total_amount_net)));
    }

    const btn = document.getElementById("inv-btn-edit-bookings");
    if (btn) btn.disabled = false;

    if (msg) showMessage(msg, "", "success");
  } catch (err) {
    console.error(err);
    if (msg) showMessage(msg, "Vorschlag konnte nicht geladen werden: " + err.message, "error");
  }
}

function invTecModalSetOpen(isOpen) {
  const modal = document.getElementById("inv-tec-modal");
  if (!modal) return;
  if (isOpen) {
    const del = document.getElementById("tec-edit-delete");
  if (del) del.disabled = !(row.ID);
  modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  } else {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}

function invTecModalComputeSelectedSum() {
  const checked = new Set(
    Array.from(document.querySelectorAll("#inv-tec-table input[type=checkbox][data-tec-id]:checked")).map((cb) =>
      String(cb.getAttribute("data-tec-id"))
    )
  );
  return (__invTecState.rows || []).reduce((acc, r) => {
    if (checked.has(String(r.ID))) return acc + _invNum(r.SP_TOT);
    return acc;
  }, 0);
}

function invTecModalRender() {
  const tbody = document.querySelector("#inv-tec-table tbody");
  const sumEl = document.getElementById("inv-tec-sum");
  if (!tbody) return;

  tbody.innerHTML = "";
  __invTecState.rows.forEach((r) => {
    const tr = document.createElement("tr");
    const assigned = !!r.ASSIGNED;
    tr.innerHTML = `
      <td style="text-align:center;">
        <input type="checkbox" data-tec-id="${r.ID}" data-initial="${assigned ? "1" : "0"}" ${assigned ? "checked" : ""} />
      </td>
      <td>${_str(r.DATE_VOUCHER)}</td>
      <td>${_str(r.EMPLOYEE_SHORT_NAME)}</td>
      <td>${_str(r.POSTING_DESCRIPTION)}</td>
      <td>${_str(r.SP_TOT)}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input[type=checkbox][data-tec-id]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const sum = invTecModalComputeSelectedSum();
      if (sumEl) sumEl.textContent = String(_invRound2(sum));
    });
  });

  const sum = invTecModalComputeSelectedSum();
  if (sumEl) sumEl.textContent = String(_invRound2(sum));
}

async function invOpenTecModal() {
  const msg = document.getElementById("inv-msg-3");
  if (!__invId) return showMessage(msg, "Kein Entwurf gefunden (Bitte erneut starten)", "error");

  const modalMsg = document.getElementById("inv-tec-msg");
  if (modalMsg) showMessage(modalMsg, "", "");

  try {
    const res = await fetch(`${API_BASE}/invoices/${__invId}/tec`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Buchungen konnten nicht geladen werden");

    __invTecState.rows = Array.isArray(json.data) ? json.data : [];
    invTecModalRender();
    invTecModalSetOpen(true);
  } catch (err) {
    console.error(err);
    if (msg) showMessage(msg, "Fehler: " + err.message, "error");
  }
}

async function invSaveTecSelection() {
  if (!__invId) return;

  const modalMsg = document.getElementById("inv-tec-msg");
  if (modalMsg) showMessage(modalMsg, "", "");

  const all = Array.from(document.querySelectorAll("#inv-tec-table input[type=checkbox][data-tec-id]"));
  const idsAssign = [];
  const idsUnassign = [];

  all.forEach((cb) => {
    const id = String(cb.getAttribute("data-tec-id"));
    const initial = cb.getAttribute("data-initial") === "1";
    const now = cb.checked;
    if (!initial && now) idsAssign.push(id);
    if (initial && !now) idsUnassign.push(id);
  });

  const perfEl = document.getElementById("inv-amount-performance");
  const performanceAmount = _invNum(perfEl?.value);

  try {
    const res = await fetch(`${API_BASE}/invoices/${__invId}/tec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids_assign: idsAssign,
        ids_unassign: idsUnassign,
        performance_amount: performanceAmount,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

    const data = json.data || {};

    const bookingsEl = document.getElementById("inv-amount-bookings");
    if (bookingsEl && data.bookings_sum !== undefined) {
      bookingsEl.value = String(_invRound2(_invNum(data.bookings_sum)));
    }

    const perfEl2 = document.getElementById("inv-amount-performance");
    if (perfEl2 && data.performance_amount !== undefined) {
      perfEl2.value = String(_invRound2(_invNum(data.performance_amount)));
      perfEl2.dataset.dirty = "";
    }

    const extrasEl = document.getElementById("inv-amount-extras");
    if (extrasEl && data.amount_extras_net !== undefined) {
      extrasEl.value = String(_invRound2(_invNum(data.amount_extras_net)));
    }

    const honorarEl = document.getElementById("inv-amount-net");
    if (honorarEl && data.amount_net !== undefined) {
      honorarEl.value = String(_invRound2(_invNum(data.amount_net)));
    } else {
      invComputeHonorarFromParts();
    }

    const totEl = document.getElementById("inv-total-net");
    if (totEl && data.total_amount_net !== undefined) {
      totEl.value = String(_invRound2(_invNum(data.total_amount_net)));
    } else {
      invComputeTotalNet();
    }

    invTecModalSetOpen(false);
    if (modalMsg) showMessage(modalMsg, "Gespeichert", "success");
  } catch (err) {
    console.error(err);
    if (modalMsg) showMessage(modalMsg, "Fehler: " + err.message, "error");
  }
}

(function wireInvTecModal() {
  const close = () => invTecModalSetOpen(false);

  document.getElementById("inv-tec-close")?.addEventListener("click", close);
  document.getElementById("inv-tec-cancel")?.addEventListener("click", close);
  document.getElementById("inv-tec-save")?.addEventListener("click", invSaveTecSelection);

  document.getElementById("inv-tec-modal")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "inv-tec-modal") close();
  });
})();

async function invLoadSummary() {
  if (!__invId) return;

  const res = await fetch(`${API_BASE}/invoices/${__invId}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "summary load failed");

  const { inv, project, contract } = json.data || {};
  const projText = project ? `${project.NAME_SHORT || ""}: ${project.NAME_LONG || ""}`.trim() : "";
  const ctrText = contract ? `${contract.NAME_SHORT || ""}: ${contract.NAME_LONG || ""}`.trim() : "";

  const totalNet = parseFloat(inv?.TOTAL_AMOUNT_NET ?? 0) || 0;
  const vatPct = parseFloat(inv?.VAT_PERCENT ?? 0) || 0;
  const tax = (totalNet * vatPct) / 100;
  const gross = totalNet + tax;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? "";
  };

  set("inv-sum-project", projText);
  set("inv-sum-contract", ctrText);
  set("inv-sum-number", inv?.INVOICE_NUMBER || "wird beim Buchen vergeben");
  set("inv-sum-date", inv?.INVOICE_DATE || "");
  set("inv-sum-due", inv?.DUE_DATE || "");
  set("inv-sum-period-start", inv?.BILLING_PERIOD_START || "");
  set("inv-sum-period-finish", inv?.BILLING_PERIOD_FINISH || "");
  set("inv-sum-address", inv?.ADDRESS_NAME_1 || "");
  set("inv-sum-contact", inv?.CONTACT || "");

  set("inv-sum-amount-net", String(inv?.AMOUNT_NET ?? ""));
  set("inv-sum-amount-extras", String(inv?.AMOUNT_EXTRAS_NET ?? ""));
  set("inv-sum-total-net", String(totalNet));
  set("inv-sum-tax", String(tax));
  set("inv-sum-gross", String(gross));
}

function wireInvoiceWizard() {
  // Employee
  setupAutocomplete({
    inputId: "inv-employee",
    hiddenId: "inv-employee-id",
    listId: "inv-employee-autocomplete",
    minLen: 2,
    search: async (q) => {
      const res = await fetch(`${API_BASE}/mitarbeiter/search?q=${encodeURIComponent(q)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "employee search failed");
      return json.data || [];
    },
    formatLabel: (e) => `${e.SHORT_NAME || ""}: ${(e.FIRST_NAME || "").trim()} ${(e.LAST_NAME || "").trim()}`.trim(),
  });

  // Project
  setupAutocomplete({
    inputId: "inv-project",
    hiddenId: "inv-project-id",
    listId: "inv-project-autocomplete",
    minLen: 2,
    search: async (q) => {
      const res = await fetch(`${API_BASE}/projekte/search?q=${encodeURIComponent(q)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "project search failed");
      return json.data || [];
    },
    formatLabel: (p) => `${p.NAME_SHORT || ""}: ${p.NAME_LONG || ""}`.trim(),
    onSelect: () => {
      // Clear contract when project changes
      const cIn = document.getElementById("inv-contract");
      const cId = document.getElementById("inv-contract-id");
      if (cIn) {
        cIn.value = "";
        cIn.dataset.selectedLabel = "";
      }
      if (cId) cId.value = "";
    },
  });

  // Contract (filtered by project)
  setupAutocomplete({
    inputId: "inv-contract",
    hiddenId: "inv-contract-id",
    listId: "inv-contract-autocomplete",
    minLen: 2,
    search: async (q) => {
      const pid = document.getElementById("inv-project-id")?.value;
      if (!pid) return [];
      const res = await fetch(
        `${API_BASE}/projekte/contracts/search?project_id=${encodeURIComponent(pid)}&q=${encodeURIComponent(q)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "contract search failed");
      return json.data || [];
    },
    formatLabel: (c) => `${c.NAME_SHORT || ""}: ${c.NAME_LONG || ""}`.trim(),
  });

  // VAT
  setupAutocomplete({
    inputId: "inv-vat",
    hiddenId: "inv-vat-id",
    listId: "inv-vat-autocomplete",
    minLen: 1,
    search: async (q) => {
      const res = await fetch(`${API_BASE}/stammdaten/vat/search?q=${encodeURIComponent(q)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "vat search failed");
      return json.data || [];
    },
    formatLabel: (v) => `${v.VAT || ""}: ${v.VAT_PERCENT ?? ""} %`.trim(),
  });

  // Payment means
  setupAutocomplete({
    inputId: "inv-payment-means",
    hiddenId: "inv-payment-means-id",
    listId: "inv-payment-means-autocomplete",
    minLen: 2,
    search: async (q) => {
      const res = await fetch(`${API_BASE}/stammdaten/payment-means/search?q=${encodeURIComponent(q)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "payment means search failed");
      return json.data || [];
    },
    formatLabel: (p) => `${p.NAME_SHORT || ""}: ${p.NAME_LONG || ""}`.trim(),
  });

  // Live calc for totals (Step 3)
  const perfEl = document.getElementById("inv-amount-performance");
  perfEl?.addEventListener("input", () => {
    perfEl.dataset.dirty = "1";
    invComputeHonorarFromParts();
    invPersistPerformanceAmountDebounced(_invNum(perfEl.value));
  });

  // Bookings and extras are computed (read-only)

  document.getElementById("inv-btn-edit-bookings")?.addEventListener("click", invOpenTecModal);

  // Page navigation
  document.getElementById("inv-next-1")?.addEventListener("click", async () => {
    const msg = document.getElementById("inv-msg-1");
    const companyId = document.getElementById("inv-company")?.value;
    const employeeId = document.getElementById("inv-employee-id")?.value;
    const projectId = document.getElementById("inv-project-id")?.value;
    const contractId = document.getElementById("inv-contract-id")?.value;

    // More explicit validation: Autocomplete fields must be selected (hidden id filled).
    if (!companyId) {
      showMessage(msg, "Bitte eine Firma auswählen.", "error");
      return;
    }
    if (!employeeId) {
      showMessage(msg, "Bitte einen Mitarbeiter aus der Trefferliste auswählen.", "error");
      return;
    }
    if (!projectId) {
      showMessage(msg, "Bitte ein Projekt aus der Trefferliste auswählen.", "error");
      return;
    }
    if (!contractId) {
      showMessage(msg, "Bitte einen Vertrag aus der Trefferliste auswählen.", "error");
      return;
    }

    const d = document.getElementById("inv-date");
    if (d && !d.value) d.value = todayIso();

    // If draft already exists, don't re-create it
    if (__invId) {
      showMessage(msg, "", "success");
      return invShowPage(2);
    }

    if (__invInitInFlight) return;
    __invInitInFlight = true;
    try {
      showMessage(msg, "Entwurf wird erstellt …", "info");
      const res = await fetch(`${API_BASE}/invoices/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          employee_id: employeeId,
          project_id: projectId,
          contract_id: contractId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Entwurf konnte nicht erstellt werden");
      __invId = json.id;
      __invCancelOnUnload = false;
      showMessage(msg, "", "success");
      invShowPage(2);
    } catch (err) {
      showMessage(msg, err.message || String(err), "error");
    } finally {
      __invInitInFlight = false;
    }
  });

  document.getElementById("inv-prev-2")?.addEventListener("click", () => invShowPage(1));
  document.getElementById("inv-prev-3")?.addEventListener("click", () => invShowPage(2));
  document.getElementById("inv-prev-4")?.addEventListener("click", () => invShowPage(3));
  document.getElementById("inv-prev-5")?.addEventListener("click", () => invShowPage(4));

  document.getElementById("inv-next-2")?.addEventListener("click", async () => {
    const msg = document.getElementById("inv-msg-2");

    const date = document.getElementById("inv-date")?.value;
    const due = document.getElementById("inv-due")?.value;
    const ps = document.getElementById("inv-period-start")?.value;
    const pf = document.getElementById("inv-period-finish")?.value;

    if (!date || !due || !ps || !pf) {
      return showMessage(msg, "Bitte alle Pflichtfelder ausfüllen", "error");
    }

    if (!__invId) {
      return showMessage(
        msg,
        "Entwurf fehlt (bitte Schritt 1 erneut ausführen)",
        "error"
      );
    }

    try {
      showMessage(msg, "Daten werden gespeichert …", "info");
      const res = await fetch(`${API_BASE}/invoices/${__invId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({          invoice_date: date,
          due_date: due,
          billing_period_start: ps,
          billing_period_finish: pf,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

      showMessage(msg, "", "success");
      invShowPage(3);
    } catch (err) {
      showMessage(msg, err.message || String(err), "error");
    }
  });

  document.getElementById("inv-next-3")?.addEventListener("click", () => {
    invComputeHonorarFromParts();
    invComputeTotalNet();
    invShowPage(4);
  });

  document.getElementById("inv-next-4")?.addEventListener("click", async () => {
    const msg = document.getElementById("inv-msg-4");
    if (!__invId) return showMessage(msg, "Kein Entwurf gefunden (Bitte erneut starten)", "error");

    const vatId = document.getElementById("inv-vat-id")?.value;
    const pmId = document.getElementById("inv-payment-means-id")?.value;

    if (!vatId || !pmId) {
      return showMessage(msg, "Bitte alle Pflichtfelder ausfüllen", "error");
    }

    const payload = {
      comment: document.getElementById("inv-comment")?.value,
      vat_id: vatId,
      payment_means_id: pmId,
    };

    try {
      showMessage(msg, "Daten werden gespeichert …", "info");
      const res = await fetch(`${API_BASE}/invoices/${__invId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");

      await invLoadSummary();
      invShowPage(5);
      showMessage(msg, "", "success");
    } catch (err) {
      showMessage(msg, "Fehler: " + (err.message || err), "error");
    }
  });

  document.getElementById("inv-book")?.addEventListener("click", async () => {
    const msg = document.getElementById("inv-msg-5");
    if (!__invId) return showMessage(msg, "Kein Entwurf gefunden (Bitte erneut starten)", "error");

    try {
      const res = await fetch(`${API_BASE}/invoices/${__invId}/book`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "booking failed");
      showMessage(msg, `Rechnung gebucht ✅${json?.number ? " (" + json.number + ")" : ""}`, "success");
      await initInvoiceWizard();
    } catch (err) {
      showMessage(msg, "Fehler: " + (err.message || err), "error");
    }
  });
}

// End: Rechnungen Wizard



// ----------------------------
// Stage A: Dokumente / Vorlagen (PDF)
// ----------------------------
let __docsBound = false;
let __docsState = {
  companyId: null,
  docType: "INVOICE",
  templates: [],
  currentTemplateId: null,
  logoAssetId: null,
};

function docEls() {
  return {
    company: document.getElementById("doc-company"),
    type: document.getElementById("doc-type"),
    template: document.getElementById("doc-template"),
    name: document.getElementById("doc-template-name"),
    layout: document.getElementById("doc-layout"),
    logo: document.getElementById("doc-logo"),
    logoInfo: document.getElementById("doc-logo-info"),
    primary: document.getElementById("doc-primary"),
    accent: document.getElementById("doc-accent"),
    font: document.getElementById("doc-font"),
    footerLeft: document.getElementById("doc-footer-left"),
    footerRight: document.getElementById("doc-footer-right"),
    showProject: document.getElementById("doc-show-project"),
    showContract: document.getElementById("doc-show-contract"),
    showTax: document.getElementById("doc-show-tax"),
    btnNew: document.getElementById("doc-template-new"),
    btnSave: document.getElementById("doc-template-save"),
    btnDefault: document.getElementById("doc-template-default"),
    btnPreview: document.getElementById("doc-template-preview"),
    btnDuplicate: document.getElementById("doc-template-duplicate"),
    btnPublish: document.getElementById("doc-template-publish"),
    btnArchive: document.getElementById("doc-template-archive"),
    statusInfo: document.getElementById("doc-template-status"),

    previewId: document.getElementById("doc-preview-id"),
    msg: document.getElementById("msg-documents"),
    back: document.getElementById("doc-back"),
  };
}

async function apiJson(url, opts) {
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function getDefaultThemeUi() {
  return {
    brand: { primaryColor: "#111827", accentColor: "#2563eb", fontFamily: "Inter", fontScale: 1.0 },
    header: { showLogo: true, logoMaxHeightMm: 18 },
    footer: { textLeft: "Vielen Dank für Ihren Auftrag.", textRight: "Seite {page} von {pages}", showPageNumbers: true },
    blocks: { showProject: true, showContract: true, showTaxSummary: true },
  };
}

function themeFromUi() {
  const e = docEls();
  const t = getDefaultThemeUi();
  t.brand.primaryColor = e.primary?.value || t.brand.primaryColor;
  t.brand.accentColor = e.accent?.value || t.brand.accentColor;
  t.brand.fontFamily = e.font?.value || t.brand.fontFamily;
  t.footer.textLeft = e.footerLeft?.value || "";
  t.footer.textRight = e.footerRight?.value || "";
  t.blocks.showProject = !!e.showProject?.checked;
  t.blocks.showContract = !!e.showContract?.checked;
  t.blocks.showTaxSummary = !!e.showTax?.checked;
  return t;
}

function applyThemeToUi(theme) {
  const e = docEls();
  const t = theme || getDefaultThemeUi();
  e.primary.value = t.brand?.primaryColor || "#111827";
  e.accent.value = t.brand?.accentColor || "#2563eb";
  e.font.value = t.brand?.fontFamily || "Inter";
  e.footerLeft.value = t.footer?.textLeft || "";
  e.footerRight.value = t.footer?.textRight || "";
  e.showProject.checked = t.blocks?.showProject !== false;
  e.showContract.checked = t.blocks?.showContract !== false;
  e.showTax.checked = t.blocks?.showTaxSummary !== false;
}

function fillTemplateDropdown() {
  const e = docEls();
  e.template.innerHTML = `<option value="">–</option>`;
  (__docsState.templates || []).forEach((t) => {
    const opt = document.createElement("option");
    opt.value = String(t.ID);
    const st = (t.STATUS || "PUBLISHED").toUpperCase();
	const v  = t.VERSION ? ` v${t.VERSION}` : "";
	const label = `[${st}${v}] ${t.NAME}${t.IS_DEFAULT ? " (Standard)" : ""}`;
    opt.textContent = label;
    e.template.appendChild(opt);
  });
  if (__docsState.currentTemplateId) e.template.value = String(__docsState.currentTemplateId);
}

function setCurrentTemplate(id) {
  __docsState.currentTemplateId = id ? parseInt(String(id), 10) : null;
  const tpl = (__docsState.templates || []).find((t) => String(t.ID) === String(__docsState.currentTemplateId));
  const e = docEls();

  if (!tpl) {
    e.name.value = "";
    e.layout.value = "modern_a";
    applyThemeToUi(getDefaultThemeUi());
    __docsState.logoAssetId = null;
    e.logoInfo.textContent = "";

    if (e.statusInfo) e.statusInfo.textContent = "";
    if (e.btnSave) e.btnSave.disabled = true;
    if (e.btnDefault) e.btnDefault.disabled = true;
    if (e.btnDuplicate) e.btnDuplicate.disabled = true;
    if (e.btnPublish) e.btnPublish.disabled = true;
    if (e.btnArchive) e.btnArchive.disabled = true;
    return;
  }

  e.name.value = tpl.NAME || "";
  e.layout.value = tpl.LAYOUT_KEY || "modern_a";
  applyThemeToUi(tpl.THEME_JSON || getDefaultThemeUi());
  __docsState.logoAssetId = tpl.LOGO_ASSET_ID || null;
  e.logoInfo.textContent = __docsState.logoAssetId ? `Logo Asset ID: ${__docsState.logoAssetId}` : "";

  // Stage B1 lifecycle UI
  const status = String(tpl.STATUS || "").toUpperCase();
  const version = tpl.VERSION != null ? `v${tpl.VERSION}` : "";
  const statusText = status ? `${status}${version ? " · " + version : ""}` : (version || "");
  if (e.statusInfo) e.statusInfo.textContent = statusText ? `Status: ${statusText}` : "";

  const isDraft = status === "DRAFT" || !status;
  const isPublished = status === "PUBLISHED";
  const isArchived = status === "ARCHIVED";

  if (e.btnSave) e.btnSave.disabled = !isDraft;
  if (e.btnPublish) e.btnPublish.disabled = !isDraft;
  if (e.btnArchive) e.btnArchive.disabled = isArchived || !tpl.ID;
  if (e.btnDuplicate) e.btnDuplicate.disabled = !tpl.ID;

  // default can only be set for active PUBLISHED (backend enforces too)
  if (e.btnDefault) e.btnDefault.disabled = !(isPublished && tpl.IS_ACTIVE !== false);
}

async function loadCompaniesForDocuments() {
  const e = docEls();
  const json = await apiJson(`${API_BASE}/stammdaten/companies`);
  const companies = Array.isArray(json.data) ? json.data : [];
  e.company.innerHTML = `<option value="">Bitte wählen …</option>`;
  companies.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = String(c.ID);
    opt.textContent = c.COMPANY_NAME_1 || `Company ${c.ID}`;
    e.company.appendChild(opt);
  });

  if (!e.company.value && companies.length) e.company.value = String(companies[0].ID);
  __docsState.companyId = e.company.value ? parseInt(e.company.value, 10) : null;
}

async function loadTemplates() {
  const e = docEls();
  if (!e.company.value) {
    __docsState.templates = [];
    __docsState.currentTemplateId = null;
    fillTemplateDropdown();
    setCurrentTemplate(null);
    return;
  }

  __docsState.companyId = parseInt(e.company.value, 10);
  __docsState.docType = e.type.value;

  const json = await apiJson(`${API_BASE}/document-templates?company_id=${__docsState.companyId}&doc_type=${encodeURIComponent(__docsState.docType)}`);
  __docsState.templates = Array.isArray(json.data) ? json.data : [];
  __docsState.currentTemplateId = __docsState.templates[0]?.ID || null;

  fillTemplateDropdown();
  setCurrentTemplate(__docsState.currentTemplateId);
}

async function createTemplate() {
  const e = docEls();
  if (!e.company.value) return showMessage(e.msg, "Bitte zuerst ein Unternehmen auswählen.", "error");

  const body = {
    company_id: parseInt(e.company.value, 10),
    name: `Vorlage ${new Date().toLocaleDateString("de-DE")}`,
    doc_type: e.type.value,
    layout_key: "modern_a",
    theme_json: getDefaultThemeUi(),
    logo_asset_id: null,
  };

  await apiJson(`${API_BASE}/document-templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  await loadTemplates();
  showMessage(e.msg, "Vorlage erstellt.", "success");
}

async function uploadLogoIfSelected() {
  const e = docEls();
  const file = e.logo?.files?.[0];
  if (!file) return null;
  if (!e.company.value) throw new Error("Bitte zuerst ein Unternehmen auswählen.");

  const form = new FormData();
  form.append("file", file);
  form.append("company_id", e.company.value);
  form.append("asset_type", "LOGO");

  const res = await fetch(`${API_BASE}/assets/upload`, { method: "POST", body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Logo-Upload fehlgeschlagen");

  return json.data?.ID || null;
}

async function saveTemplate() {
  const e = docEls();
  if (!__docsState.currentTemplateId) return showMessage(e.msg, "Bitte eine Vorlage auswählen oder neu erstellen.", "error");

  const logoId = await uploadLogoIfSelected().catch((err) => {
    // allow save without logo
    showMessage(e.msg, "Hinweis: Logo wurde nicht hochgeladen (" + (err.message || err) + ")", "info");
    return null;
  });

  const patch = {
    name: e.name.value,
    layout_key: e.layout.value,
    theme_json: themeFromUi(),
  };
  if (logoId) patch.logo_asset_id = logoId;

  await apiJson(`${API_BASE}/document-templates/${__docsState.currentTemplateId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

  await loadTemplates();
  showMessage(e.msg, "Gespeichert.", "success");
  // reset file input
  if (e.logo) e.logo.value = "";
}

async function setDefaultTemplate() {
  const e = docEls();
  if (!__docsState.currentTemplateId) return showMessage(e.msg, "Bitte eine Vorlage auswählen.", "error");
  await apiJson(`${API_BASE}/document-templates/${__docsState.currentTemplateId}/set-default`, { method: "POST" });
  await loadTemplates();
  showMessage(e.msg, "Als Standard gesetzt.", "success");
}


async function duplicateTemplate() {
  const e = docEls();
  if (!__docsState.currentTemplateId) return showMessage(e.msg, "Bitte eine Vorlage auswählen.", "error");

  await apiJson(`${API_BASE}/document-templates/${__docsState.currentTemplateId}/duplicate`, { method: "POST" });
  await loadTemplates();
  showMessage(e.msg, "Entwurf erstellt (Duplikat).", "success");
}

async function publishTemplate() {
  const e = docEls();
  if (!__docsState.currentTemplateId) return showMessage(e.msg, "Bitte eine Vorlage auswählen.", "error");

  await apiJson(`${API_BASE}/document-templates/${__docsState.currentTemplateId}/publish`, { method: "POST" });
  await loadTemplates();
  showMessage(e.msg, "Vorlage veröffentlicht.", "success");
}

async function archiveTemplate() {
  const e = docEls();
  if (!__docsState.currentTemplateId) return showMessage(e.msg, "Bitte eine Vorlage auswählen.", "error");

  await apiJson(`${API_BASE}/document-templates/${__docsState.currentTemplateId}/archive`, { method: "POST" });
  await loadTemplates();
  showMessage(e.msg, "Vorlage archiviert.", "success");
}

function previewPdf() {
  const e = docEls();
  const id = parseInt(String(e.previewId.value || ""), 10);
  if (!id || Number.isNaN(id)) return showMessage(e.msg, "Bitte eine gültige Dokument-ID für die Vorschau eingeben.", "error");

  const tplId = __docsState.currentTemplateId ? `template_id=${__docsState.currentTemplateId}` : "";
  const url =
    e.type.value === "INVOICE"
      ? `${API_BASE}/invoices/${id}/pdf?${tplId}`
      : `${API_BASE}/partial-payments/${id}/pdf?${tplId}`;

  window.open(url, "_blank");
}

async function initDocumentsView() {
  const e = docEls();
  if (!__docsBound) {
    __docsBound = true;

    e.back?.addEventListener("click", async () => {
      if (!(await guardLeaveDraftIfNeeded())) return;
      showView("view-administration");
    });

    e.company?.addEventListener("change", async () => {
      showMessage(e.msg, "");
      await loadTemplates().catch((err) => showMessage(e.msg, "Fehler: " + (err.message || err), "error"));
    });

    e.type?.addEventListener("change", async () => {
      showMessage(e.msg, "");
      await loadTemplates().catch((err) => showMessage(e.msg, "Fehler: " + (err.message || err), "error"));
    });

    e.template?.addEventListener("change", () => {
      showMessage(e.msg, "");
      setCurrentTemplate(e.template.value);
    });

    e.btnNew?.addEventListener("click", async () => {
      showMessage(e.msg, "");
      await createTemplate().catch((err) => showMessage(e.msg, "Fehler: " + (err.message || err), "error"));
    });

    e.btnSave?.addEventListener("click", async () => {
      showMessage(e.msg, "");
      await saveTemplate().catch((err) => showMessage(e.msg, "Fehler: " + (err.message || err), "error"));
    });

    e.btnDefault?.addEventListener("click", async () => {
      showMessage(e.msg, "");
      await setDefaultTemplate().catch((err) => showMessage(e.msg, "Fehler: " + (err.message || err), "error"));
    });

    e.btnDuplicate?.addEventListener("click", async () => {
      showMessage(e.msg, "");
      await duplicateTemplate().catch((err) => showMessage(e.msg, "Fehler: " + (err.message || err), "error"));
    });

    e.btnPublish?.addEventListener("click", async () => {
      showMessage(e.msg, "");
      await publishTemplate().catch((err) => showMessage(e.msg, "Fehler: " + (err.message || err), "error"));
    });

    e.btnArchive?.addEventListener("click", async () => {
      showMessage(e.msg, "");
      await archiveTemplate().catch((err) => showMessage(e.msg, "Fehler: " + (err.message || err), "error"));
    });

    e.btnPreview?.addEventListener("click", () => {
      showMessage(e.msg, "");
      previewPdf();
    });
  }

  showMessage(e.msg, "");
  await loadCompaniesForDocuments().catch((err) => showMessage(e.msg, "Fehler: " + (err.message || err), "error"));
  await loadTemplates().catch((err) => showMessage(e.msg, "Fehler: " + (err.message || err), "error"));
}

// navigation.js — view switching, bottom nav, guard, global nav bindings
import { API_BASE } from "./config.js";
import { showMessage } from "./utils.js";

// ── View helpers ──────────────────────────────────────────────────────────────

export function showView(viewId) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(viewId)?.classList.remove("hidden");
}

export function isViewActive(viewId) {
  const el = document.getElementById(viewId);
  return !!el && !el.classList.contains("hidden");
}

// ── Bottom nav ────────────────────────────────────────────────────────────────

export function setBottomNavActive(targetId) {
  document.querySelectorAll(".bottom-nav-item").forEach((b) => b.classList.remove("active"));
  const btn = document.querySelector(`.bottom-nav-item[data-target="${targetId}"]`);
  if (btn) btn.classList.add("active");
}

// ── bindClick helper ──────────────────────────────────────────────────────────

export function bindClick(id, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("click", handler);
}

// ── Draft guard ───────────────────────────────────────────────────────────────
// These are set by other modules to avoid circular imports at module-level.
// Each module calls registerDraftGuard() to plug in its guard function.

const _draftGuards = [];

export function registerDraftGuard(fn) {
  _draftGuards.push(fn);
}

export async function guardLeaveDraftIfNeeded() {
  for (const guard of _draftGuards) {
    const ok = await guard();
    if (ok === false) return false;
  }
  return true;
}

// ── initBottomNav ─────────────────────────────────────────────────────────────
// Called from main.js after all modules are loaded.

export function initBottomNav({
  loadRechnungsliste,
  loadProjektListe,
  loadMitarbeiterListe,
} = {}) {
  const bottomNav = document.getElementById("bottom-nav");
  if (!bottomNav) return;

  bottomNav.querySelectorAll(".bottom-nav-item").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";

    btn.addEventListener("click", async () => {
      if (!(await guardLeaveDraftIfNeeded())) return;
      const target = btn.getAttribute("data-target");
      if (!target) return;
      showView(target);
      setBottomNavActive(target);

      if (target === "view-rechnungsliste" && loadRechnungsliste) await loadRechnungsliste();
      if (target === "view-projektliste"   && loadProjektListe)   await loadProjektListe();
      if (target === "view-mitarbeiterliste" && loadMitarbeiterListe) await loadMitarbeiterListe();
    });
  });
}

// ── Global nav bindings (called from main.js after all modules available) ─────

export function initNavBindings({
  loadDashboard,
  loadRechnungsliste,
  loadProjektListe,
  loadAddressListe,
  loadKontaktListe,
  loadMitarbeiterListe,
  loadCountriesForAddress,
  loadSalutationsForKontakte,
  loadGendersForKontakte,
  resetKontakteAddressSelection,
  loadBuchungDropdowns,
  wireBuchungDropdownEvents,
  loadBuchungslisteProjects,
  wireLeistungsstaende,
  lsMsg,
  lsShowTable,
  wireProjektstrukturNeu,
  psMsg,
  psShowTable,
  prjInitWizard,
  feeInitWizard,
  initPartialPaymentWizard,
  initInvoiceWizard,
  initFinalInvoiceWizard,
  getBuchungEditId,
  setBuchungEditId,
  getBuchungEditReturnProjectId,
  setBuchungEditReturnProjectId,
}) {
  // Dashboard / main menu quick nav
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
    setBuchungEditId(null);
    setBuchungEditReturnProjectId("");
    const saveBtn = document.getElementById("btn-save-buchung");
    if (saveBtn) saveBtn.textContent = "Speichern";
    loadBuchungDropdowns();
    wireBuchungDropdownEvents();
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

  // Menu pages
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

  bindClick("btn-honorar-berechnen-menu", async () => {
    if (!(await guardLeaveDraftIfNeeded())) return;
    showView("view-honorar-berechnen");
    await feeInitWizard();
  });

  bindClick("btn-projektstruktur-menu", async () => {
    if (!(await guardLeaveDraftIfNeeded())) return;
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
    setBuchungEditId(null);
    setBuchungEditReturnProjectId("");
    const saveBtn = document.getElementById("btn-save-buchung");
    if (saveBtn) saveBtn.textContent = "Speichern";
    loadBuchungDropdowns();
    wireBuchungDropdownEvents();
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

  bindClick("btn-schlussrechnungen-menu", async () => {
    if (!(await guardLeaveDraftIfNeeded())) return;
    await initFinalInvoiceWizard();
    showView("view-schlussrechnung");
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
}

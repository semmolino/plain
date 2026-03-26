// main.js — application entry point
import { initAuth } from "./auth.js";
import { initBottomNav, initNavBindings } from "./navigation.js";
import { loadDashboard } from "./dashboard.js";
import {
  loadRechnungsliste,
  initInvoiceWizard,
  initPartialPaymentWizard,
  initFinalInvoiceWizard,
} from "./invoices.js";
import {
  loadProjektListe,
  loadAddressListe,
  loadKontaktListe,
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
  getBuchungEditId,
  setBuchungEditId,
  getBuchungEditReturnProjectId,
  setBuchungEditReturnProjectId,
} from "./projekte.js";
import {
  loadCountriesForAddress,
  loadSalutationsForKontakte,
  loadGendersForKontakte,
  resetKontakteAddressSelection,
} from "./stammdaten.js";
import { loadMitarbeiterListe } from "./mitarbeiter.js";

initBottomNav({ loadRechnungsliste, loadProjektListe, loadMitarbeiterListe });

initNavBindings({
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
});

initAuth();

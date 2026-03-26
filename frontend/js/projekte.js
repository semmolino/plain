// projekte.js — Fee wizard, Projekt wizard, Address/Contact lists,
// Projektstruktur, Leistungsstände, Buchungen
import { API_BASE } from "./config.js";
import { showMessage, debounce, todayIso, escapeHtml } from "./utils.js";
import { showView, isViewActive, setBottomNavActive, guardLeaveDraftIfNeeded } from "./navigation.js";
import { setupAutocomplete } from "./autocomplete.js";
import { buildStructureTree, flattenTree } from "./treeUtils.js";
import { getBillingTypes } from "./globals.js";

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
const __feeWizard = {
  step: 1,
  feeGroups: [],
  feeMasters: [],
  feeZones: [],
  projects: [],
  phaseRows: [],
  structureRows: [],
  selectedFeeGroupId: "",
  selectedFeeMasterId: "",
  calcMasterId: "",
  calcMasterRow: null,
};

function feeSetMsg(text, type = "info") {
  showMessage(document.getElementById("msg-fee-wizard"), text, type);
}

function feeLabel(row) {
  const s = (row?.NAME_SHORT || "").toString().trim();
  const l = (row?.NAME_LONG || "").toString().trim();
  if (s && l) return `${s}: ${l}`;
  return s || l || "";
}

function feeShowStep(step) {
  __feeWizard.step = step;
  [1, 2, 3, 4, 5].forEach((s) => {
    const el = document.getElementById(`fee-step-${s}`);
    if (el) el.classList.toggle("hidden", s !== step);
  });

  document.querySelectorAll("#fee-steps .wizard-step").forEach((el) => {
    const s = Number.parseInt(el.getAttribute("data-step") || "0", 10);
    el.classList.toggle("active", s === step);
  });
}

function feeResetWizardState() {
  __feeWizard.step = 1;
  __feeWizard.feeGroups = [];
  __feeWizard.feeMasters = [];
  __feeWizard.feeZones = [];
  __feeWizard.projects = [];
  __feeWizard.phaseRows = [];
  __feeWizard.structureRows = [];
  __feeWizard.selectedFeeGroupId = "";
  __feeWizard.selectedFeeMasterId = "";
  __feeWizard.calcMasterId = "";
  __feeWizard.calcMasterRow = null;
  __feeCancelOnUnload = false;

  feeSetMsg("", "info");
  const groupSel = document.getElementById("fee-group-select");
  if (groupSel) groupSel.value = "";
  const masterSel = document.getElementById("fee-master-select");
  if (masterSel) masterSel.innerHTML = `<option value="">Bitte zuerst Honorarordnung w�hlen �</option>`;
  const structureSel = document.getElementById("fee-structure-select");
  if (structureSel) structureSel.innerHTML = `<option value="">Bitte w�hlen �</option>`;
  const phaseBody = document.getElementById("fee-summary-phase-body");
  if (phaseBody) phaseBody.innerHTML = "";
  const phaseFoot = document.getElementById("fee-summary-phase-foot");
  if (phaseFoot) phaseFoot.innerHTML = "";
  feeSetText("fee-summary-master", "");
  feeSetText("fee-summary-zone", "");
  feeResetBasisInputs();
  feeShowStep(1);
}

function feeResetBasisInputs() {
  const ids = [
    "fee-calc-id",
    "fee-basis-paragraph",
    "fee-basis-name",
    "fee-project-select",
    "fee-zone-select",
    "fee-zone-percent",
    "fee-k0",
    "fee-k1",
    "fee-k2",
    "fee-k3",
    "fee-k4",
    "fee-r0",
    "fee-r1",
    "fee-r2",
    "fee-r3",
    "fee-r4",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "SELECT") {
      el.innerHTML = `<option value="">Bitte wählen …</option>`;
    } else {
      el.value = "";
    }
  });
}

function feeFormatNumber(value) {
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return String(num);
}

function feeRevenueByKx(kx) {
  const row = __feeWizard.calcMasterRow || {};
  const mapping = {
    K0: row.REVENUE_K0,
    K1: row.REVENUE_K1,
    K2: row.REVENUE_K2,
    K3: row.REVENUE_K3,
    K4: row.REVENUE_K4,
  };
  return feeNumOrNull(mapping[kx] ?? null);
}

function feeComputePhaseRevenue(base, percent) {
  const baseNum = feeNumOrNull(base);
  const pctNum = feeNumOrNull(percent);
  if (baseNum === null || pctNum === null) return null;
  return (pctNum * baseNum) / 100;
}

function feeSyncPhaseRow(row) {
  row.REVENUE_BASE = feeRevenueByKx(row.KX || "K0");
  row.PHASE_REVENUE = feeComputePhaseRevenue(row.REVENUE_BASE, row.FEE_PERCENT);
}

function feeRenderPhaseTable() {
  const tbody = document.getElementById("fee-phase-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  (__feeWizard.phaseRows || []).forEach((row) => {
    const tr = document.createElement("tr");

    const tdPhase = document.createElement("td");
    tdPhase.textContent = row.PHASE_LABEL || "";

    const tdBasePct = document.createElement("td");
    tdBasePct.textContent = feeFormatNumber(row.FEE_PERCENT_BASE);

    const tdKx = document.createElement("td");
    const selKx = document.createElement("select");
    ["K0", "K1", "K2", "K3", "K4"].forEach((kx) => {
      const opt = document.createElement("option");
      opt.value = kx;
      opt.textContent = kx;
      selKx.appendChild(opt);
    });
    selKx.value = row.KX || "K0";

    const tdBase = document.createElement("td");
    const baseOut = document.createElement("input");
    baseOut.type = "number";
    baseOut.step = "0.01";
    baseOut.readOnly = true;
    baseOut.value = feeFormatNumber(row.REVENUE_BASE);

    const tdPct = document.createElement("td");
    const pctInp = document.createElement("input");
    pctInp.type = "number";
    pctInp.step = "0.01";
    pctInp.value = feeFormatNumber(row.FEE_PERCENT);

    const tdRevenue = document.createElement("td");
    const revenueOut = document.createElement("input");
    revenueOut.type = "number";
    revenueOut.step = "0.01";
    revenueOut.readOnly = true;
    revenueOut.value = feeFormatNumber(row.PHASE_REVENUE);

    selKx.addEventListener("change", () => {
      row.KX = selKx.value;
      feeSyncPhaseRow(row);
      baseOut.value = feeFormatNumber(row.REVENUE_BASE);
      revenueOut.value = feeFormatNumber(row.PHASE_REVENUE);
      feeRenderPhaseFooter();
    });

    pctInp.addEventListener("input", () => {
      row.FEE_PERCENT = feeNumOrNull(pctInp.value);
      feeSyncPhaseRow(row);
      revenueOut.value = feeFormatNumber(row.PHASE_REVENUE);
      feeRenderPhaseFooter();
    });

    tdKx.appendChild(selKx);
    tdBase.appendChild(baseOut);
    tdPct.appendChild(pctInp);
    tdRevenue.appendChild(revenueOut);

    tr.appendChild(tdPhase);
    tr.appendChild(tdBasePct);
    tr.appendChild(tdKx);
    tr.appendChild(tdBase);
    tr.appendChild(tdPct);
    tr.appendChild(tdRevenue);
    tbody.appendChild(tr);
  });

  feeRenderPhaseFooter();
}

function feeRenderPhaseFooter() {
  const tfoot = document.getElementById("fee-phase-foot");
  if (!tfoot) return;

  const rows = Array.isArray(__feeWizard.phaseRows) ? __feeWizard.phaseRows : [];
  const sum = (key) => rows.reduce((acc, row) => acc + (feeNumOrNull(row[key]) ?? 0), 0);

  const totalBasePct = sum("FEE_PERCENT_BASE");
  const totalFeePercent = sum("FEE_PERCENT");
  const totalPhaseRevenue = sum("PHASE_REVENUE");

  tfoot.innerHTML = `
    <tr>
      <th>Summe</th>
      <th>${feeFormatNumber(totalBasePct)}</th>
      <th></th>
      <th></th>
      <th>${feeFormatNumber(totalFeePercent)}</th>
      <th>${feeFormatNumber(totalPhaseRevenue)}</th>
    </tr>
  `;
}

function feeRenderGroupDropdown() {
  const sel = document.getElementById("fee-group-select");
  if (!sel) return;
  sel.innerHTML = `<option value="">Bitte wählen …</option>`;
  (__feeWizard.feeGroups || []).forEach((row) => {
    const opt = document.createElement("option");
    opt.value = row.ID;
    opt.textContent = feeLabel(row) || `ID ${row.ID}`;
    sel.appendChild(opt);
  });
  sel.value = __feeWizard.selectedFeeGroupId || "";
}

function feeRenderMasterDropdown() {
  const sel = document.getElementById("fee-master-select");
  if (!sel) return;
  if (!__feeWizard.selectedFeeGroupId) {
    sel.innerHTML = `<option value="">Bitte zuerst Honorarordnung wählen …</option>`;
    return;
  }
  sel.innerHTML = `<option value="">Bitte wählen …</option>`;
  (__feeWizard.feeMasters || []).forEach((row) => {
    const opt = document.createElement("option");
    opt.value = row.ID;
    opt.textContent = feeLabel(row) || `ID ${row.ID}`;
    sel.appendChild(opt);
  });
  sel.value = __feeWizard.selectedFeeMasterId || "";
}

function feeRenderProjectDropdown() {
  const sel = document.getElementById("fee-project-select");
  if (!sel) return;
  sel.innerHTML = `<option value="">Bitte wählen …</option>`;
  (__feeWizard.projects || []).forEach((row) => {
    const opt = document.createElement("option");
    opt.value = row.ID;
    opt.textContent = `${row.NAME_SHORT || ""}: ${row.NAME_LONG || ""}`.replace(/:\s*$/, "");
    sel.appendChild(opt);
  });
}

function feeRenderZoneDropdown() {
  const sel = document.getElementById("fee-zone-select");
  if (!sel) return;
  sel.innerHTML = `<option value="">Bitte wählen …</option>`;
  (__feeWizard.feeZones || []).forEach((row) => {
    const opt = document.createElement("option");
    opt.value = row.ID;
    opt.textContent = feeLabel(row) || `ID ${row.ID}`;
    sel.appendChild(opt);
  });
}

function feeSetText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value == null ? "" : String(value);
}

function feeCurrentZoneLabel() {
  const zoneId = String(__feeWizard.calcMasterRow?.ZONE_ID || "");
  const zone = (__feeWizard.feeZones || []).find((row) => String(row.ID) === zoneId);
  return feeLabel(zone);
}

function feeRenderStructureDropdown() {
  const sel = document.getElementById("fee-structure-select");
  if (!sel) return;
  sel.innerHTML = `<option value="">Bitte wählen …</option>`;
  (__feeWizard.structureRows || []).forEach((row) => {
    const opt = document.createElement("option");
    opt.value = row.ID;
    opt.textContent = `${row.NAME_SHORT || ""} � ${row.NAME_LONG || ""}`.replace(/\s+�\s*$/, "");
    sel.appendChild(opt);
  });
}

async function feeLoadStructureRows(projectId) {
  const pid = String(projectId || "").trim();
  __feeWizard.structureRows = [];
  if (!pid) {
    feeRenderStructureDropdown();
    return;
  }
  const res = await fetch(`${API_BASE}/projekte/${encodeURIComponent(pid)}/structure`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Projektstruktur");
  __feeWizard.structureRows = Array.isArray(json.data) ? json.data : [];
  feeRenderStructureDropdown();
}

function feeRenderOverview() {
  const row = __feeWizard.calcMasterRow || {};
  const masterText = [row.NAME_SHORT, row.NAME_LONG].filter(Boolean).join(" | ");
  const zoneText = [feeCurrentZoneLabel(), row.ZONE_PERCENT != null && row.ZONE_PERCENT !== "" ? `${row.ZONE_PERCENT} %` : ""]
    .filter(Boolean)
    .join(" | ");

  feeSetText("fee-summary-master", masterText);
  feeSetText("fee-summary-zone", zoneText);

  const tbody = document.getElementById("fee-summary-phase-body");
  const tfoot = document.getElementById("fee-summary-phase-foot");
  if (!tbody || !tfoot) return;
  tbody.innerHTML = "";

  (__feeWizard.phaseRows || []).forEach((phase) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(phase.PHASE_LABEL || "")}</td>
      <td>${escapeHtml(feeFormatNumber(phase.FEE_PERCENT))}</td>
      <td>${escapeHtml(feeFormatNumber(phase.PHASE_REVENUE))}</td>
    `;
    tbody.appendChild(tr);
  });

  const totalPercent = (__feeWizard.phaseRows || []).reduce((acc, rowItem) => acc + (feeNumOrNull(rowItem.FEE_PERCENT) ?? 0), 0);
  const totalRevenue = (__feeWizard.phaseRows || []).reduce((acc, rowItem) => acc + (feeNumOrNull(rowItem.PHASE_REVENUE) ?? 0), 0);
  tfoot.innerHTML = `
    <tr>
      <th>Summe</th>
      <th>${escapeHtml(feeFormatNumber(totalPercent))}</th>
      <th>${escapeHtml(feeFormatNumber(totalRevenue))}</th>
    </tr>
  `;
}

async function feeLoadGroups() {
  const res = await fetch(`${API_BASE}/stammdaten/fee-groups`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Honorarordnungen");
  __feeWizard.feeGroups = Array.isArray(json.data) ? json.data : [];
  feeRenderGroupDropdown();
}

async function feeLoadMastersByGroup(feeGroupId) {
  const gid = String(feeGroupId || "").trim();
  __feeWizard.selectedFeeGroupId = gid;
  __feeWizard.selectedFeeMasterId = "";
  __feeWizard.feeMasters = [];
  if (!gid) {
    feeRenderMasterDropdown();
    return;
  }
  const url = `${API_BASE}/stammdaten/fee-masters?fee_group_id=${encodeURIComponent(gid)}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Leistungsbilder");
  __feeWizard.feeMasters = Array.isArray(json.data) ? json.data : [];
  feeRenderMasterDropdown();
}

async function feeLoadProjects() {
  const res = await fetch(`${API_BASE}/projekte/list?limit=2000`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Projekte");
  __feeWizard.projects = Array.isArray(json.data) ? json.data : [];
  feeRenderProjectDropdown();
}

async function feeLoadZonesByMaster(feeMasterId) {
  const url = `${API_BASE}/stammdaten/fee-zones?fee_master_id=${encodeURIComponent(feeMasterId)}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Honorarzonen");
  __feeWizard.feeZones = Array.isArray(json.data) ? json.data : [];
  feeRenderZoneDropdown();
}

function feeSetInputValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value === null || value === undefined ? "" : String(value);
}

function feePopulateBasis(row) {
  if (!row) return;
  __feeWizard.calcMasterId = row.ID ? String(row.ID) : "";
  __feeWizard.calcMasterRow = row;

  feeSetInputValue("fee-calc-id", row.ID);
  feeSetInputValue("fee-basis-paragraph", row.NAME_SHORT);
  feeSetInputValue("fee-basis-name", row.NAME_LONG);
  feeSetInputValue("fee-zone-percent", row.ZONE_PERCENT);
  feeSetInputValue("fee-k0", row.CONSTRUCTION_COSTS_K0);
  feeSetInputValue("fee-k1", row.CONSTRUCTION_COSTS_K1);
  feeSetInputValue("fee-k2", row.CONSTRUCTION_COSTS_K2);
  feeSetInputValue("fee-k3", row.CONSTRUCTION_COSTS_K3);
  feeSetInputValue("fee-k4", row.CONSTRUCTION_COSTS_K4);
  feeSetInputValue("fee-r0", row.REVENUE_K0);
  feeSetInputValue("fee-r1", row.REVENUE_K1);
  feeSetInputValue("fee-r2", row.REVENUE_K2);
  feeSetInputValue("fee-r3", row.REVENUE_K3);
  feeSetInputValue("fee-r4", row.REVENUE_K4);

  const projectSel = document.getElementById("fee-project-select");
  if (projectSel) projectSel.value = row.PROJECT_ID ? String(row.PROJECT_ID) : "";
  const zoneSel = document.getElementById("fee-zone-select");
  if (zoneSel) zoneSel.value = row.ZONE_ID ? String(row.ZONE_ID) : "";
}

function feeNumOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function feeCreateCalculationMaster() {
  const feeMasterId = String(__feeWizard.selectedFeeMasterId || "").trim();
  if (!feeMasterId) throw new Error("Bitte Leistungsbild auswählen.");

  const res = await fetch(`${API_BASE}/stammdaten/fee-calculation-masters/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fee_master_id: Number.parseInt(feeMasterId, 10) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Anlegen der Honorarberechnung");
  return json.data || null;
}

async function feeSaveBasis() {
  const calcId = String(__feeWizard.calcMasterId || "").trim();
  if (!calcId) throw new Error("Keine Honorarberechnung ausgewählt.");

  const payload = {
    NAME_SHORT: document.getElementById("fee-basis-paragraph")?.value?.trim() || null,
    NAME_LONG: document.getElementById("fee-basis-name")?.value?.trim() || null,
    PROJECT_ID: feeNumOrNull(document.getElementById("fee-project-select")?.value),
    ZONE_ID: feeNumOrNull(document.getElementById("fee-zone-select")?.value),
    ZONE_PERCENT: feeNumOrNull(document.getElementById("fee-zone-percent")?.value),
    CONSTRUCTION_COSTS_K0: feeNumOrNull(document.getElementById("fee-k0")?.value),
    CONSTRUCTION_COSTS_K1: feeNumOrNull(document.getElementById("fee-k1")?.value),
    CONSTRUCTION_COSTS_K2: feeNumOrNull(document.getElementById("fee-k2")?.value),
    CONSTRUCTION_COSTS_K3: feeNumOrNull(document.getElementById("fee-k3")?.value),
    CONSTRUCTION_COSTS_K4: feeNumOrNull(document.getElementById("fee-k4")?.value),
  };

  const res = await fetch(`${API_BASE}/stammdaten/fee-calculation-masters/${encodeURIComponent(calcId)}/basis`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Speichern der Basis");
  return json.data || null;
}

async function feeInitPhases() {
  const calcId = String(__feeWizard.calcMasterId || "").trim();
  if (!calcId) throw new Error("Keine Honorarberechnung ausgew�hlt.");

  const res = await fetch(`${API_BASE}/stammdaten/fee-calculation-masters/${encodeURIComponent(calcId)}/phases/init`, {
    method: "POST",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Leistungsphasen");
  __feeWizard.phaseRows = Array.isArray(json.data) ? json.data : [];
  feeRenderPhaseTable();
}

async function feeSavePhases() {
  const rows = Array.isArray(__feeWizard.phaseRows) ? __feeWizard.phaseRows : [];
  if (!rows.length) {
    feeRenderPhaseTable();
    return;
  }
  const calcId = String(__feeWizard.calcMasterId || "").trim();
  if (!calcId) throw new Error("Keine Honorarberechnung ausgew�hlt.");

  const res = await fetch(`${API_BASE}/stammdaten/fee-calculation-masters/${encodeURIComponent(calcId)}/phases/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rows: rows.map((row) => ({
        ID: row.ID,
        KX: row.KX,
        FEE_PERCENT: row.FEE_PERCENT,
      })),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Speichern der Leistungsphasen");
  __feeWizard.phaseRows = Array.isArray(json.data) ? json.data : [];
  feeRenderPhaseTable();
}

async function feeDeleteDraftIfAny() {
  if (!__feeWizard.calcMasterId) return true;
  try {
    const res = await fetch(`${API_BASE}/stammdaten/fee-calculation-masters/${encodeURIComponent(__feeWizard.calcMasterId)}`, {
      method: "DELETE",
      keepalive: true,
    });
    return res.ok;
  } catch (err) {
    console.error("feeDeleteDraftIfAny error", err);
    return false;
  }
}

export async function feeInitWizard() {
  feeResetWizardState();
  await feeLoadGroups();
}

document.getElementById("fee-group-select")?.addEventListener("change", async (e) => {
  try {
    feeSetMsg("", "info");
    await feeLoadMastersByGroup(e.target.value || "");
  } catch (err) {
    feeSetMsg("Fehler: " + (err.message || err), "error");
  }
});

document.getElementById("fee-master-select")?.addEventListener("change", (e) => {
  __feeWizard.selectedFeeMasterId = String(e.target.value || "");
});

document.getElementById("fee-back-menu")?.addEventListener("click", async () => {
  if (!(await guardLeaveDraftIfNeeded())) return;
  showView("view-projekte-menu");
  setBottomNavActive("view-projekte-menu");
});

document.getElementById("fee-next-1")?.addEventListener("click", async () => {
  try {
    const feeMasterId = String(document.getElementById("fee-master-select")?.value || "").trim();
    if (!feeMasterId) {
      feeSetMsg("Bitte Leistungsbild auswählen.", "error");
      return;
    }
    __feeWizard.selectedFeeMasterId = feeMasterId;
    feeSetMsg("Anlegen der Honorarberechnung …", "info");
    const row = await feeCreateCalculationMaster();
    __feeCancelOnUnload = true;
    await Promise.all([feeLoadProjects(), feeLoadZonesByMaster(feeMasterId)]);
    feePopulateBasis(row);
    feeShowStep(2);
    feeSetMsg("Basisdaten geladen.", "success");
  } catch (err) {
    feeSetMsg("Fehler: " + (err.message || err), "error");
  }
});

document.getElementById("fee-prev-2")?.addEventListener("click", () => {
  feeShowStep(1);
});

document.getElementById("fee-save-2")?.addEventListener("click", async () => {
  try {
    feeSetMsg("Speichere Basisdaten …", "info");
    const row = await feeSaveBasis();
    feePopulateBasis(row);
    feeSetMsg("Basisdaten gespeichert.", "success");
  } catch (err) {
    feeSetMsg("Fehler: " + (err.message || err), "error");
  }
});

document.getElementById("fee-next-2")?.addEventListener("click", async () => {
  try {
    feeSetMsg("Speichere Basisdaten …", "info");
    const row = await feeSaveBasis();
    feePopulateBasis(row);
    feeSetMsg("Lade Leistungsphasen …", "info");
    await feeInitPhases();
    feeShowStep(3);
    feeSetMsg("Leistungsphasen geladen.", "success");
  } catch (err) {
    feeSetMsg("Fehler: " + (err.message || err), "error");
  }
});

document.getElementById("fee-prev-3")?.addEventListener("click", () => {
  feeShowStep(2);
});

document.getElementById("fee-save-3")?.addEventListener("click", async () => {
  try {
    feeSetMsg("Speichere Leistungsphasen …", "info");
    await feeSavePhases();
    feeSetMsg("Leistungsphasen gespeichert.", "success");
  } catch (err) {
    feeSetMsg("Fehler: " + (err.message || err), "error");
  }
});

document.getElementById("fee-next-3")?.addEventListener("click", () => {
  feeSavePhases()
    .then(() => {
      feeShowStep(4);
      feeSetMsg("Zu- und Abschl�ge k�nnen sp�ter erg�nzt werden.", "info");
    })
    .catch((err) => {
      feeSetMsg("Fehler: " + (err.message || err), "error");
    });
});

document.getElementById("fee-prev-4")?.addEventListener("click", () => {
  feeShowStep(3);
});

document.getElementById("fee-next-4")?.addEventListener("click", async () => {
  try {
    await feeSavePhases();
    await feeLoadStructureRows(__feeWizard.calcMasterRow?.PROJECT_ID);
    feeRenderOverview();
    feeShowStep(5);
    feeSetMsg("�bersicht geladen.", "success");
  } catch (err) {
    feeSetMsg("Fehler: " + (err.message || err), "error");
  }
});

document.getElementById("fee-prev-5")?.addEventListener("click", () => {
  feeShowStep(4);
});

document.getElementById("fee-finish")?.addEventListener("click", async () => {
  try {
    const calcId = String(__feeWizard.calcMasterId || "").trim();
    const fatherId = String(document.getElementById("fee-structure-select")?.value || "").trim();
    const projectId = String(__feeWizard.calcMasterRow?.PROJECT_ID || "").trim();
    if (!calcId) throw new Error("Keine Honorarberechnung ausgew�hlt.");
    if (!fatherId) throw new Error("Bitte ein �bergeordnetes Projektelement ausw�hlen.");
    if (!projectId) throw new Error("Bitte zuerst ein Projekt in der Basis ausw�hlen.");

    feeSetMsg("Erzeuge Projektstruktur aus HOAI �", "info");
    const res = await fetch(`${API_BASE}/stammdaten/fee-calculation-masters/${encodeURIComponent(calcId)}/add-to-project-structure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ father_id: Number.parseInt(fatherId, 10) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Anlegen der Projektstruktur");

    __feeCancelOnUnload = false;
    feeSetMsg(json.message || "Projektstruktur wurde angelegt.", "success");

    wireProjektstrukturNeu();
    showView("view-projektstruktur");
    await psLoadProjectStructure(projectId);
    psMsg(json.message || "HOAI-Struktur wurde angelegt.", "success");
  } catch (err) {
    feeSetMsg("Fehler: " + (err.message || err), "error");
  }
});

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

export async function prjInitWizard() {
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

export async function loadProjektListe() {
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

export async function loadAddressListe() {
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

export async function loadKontaktListe() {
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

export function psMsg(text, type = "") {
  const el = document.getElementById("ps-msg");
  if (el) showMessage(el, text, type);
}

export function psShowTable(show) {
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

export function wireProjektstrukturNeu() {
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

export function lsMsg(text, type = "") {
  const el = document.getElementById("ls-msg");
  if (el) showMessage(el, text, type);
}

export function lsShowTable(show) {
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

export function wireLeistungsstaende() {
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
  wireBuchungDropdownEvents();
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

export async function loadBuchungDropdowns() {
  await Promise.all([
    loadDropdown("employee", "mitarbeiter", "ID", "SHORT_NAME"),
    loadDropdown("project", "projekte", "ID", "NAME_SHORT", "NAME_LONG")
  ]);
}

export function wireBuchungDropdownEvents() {
  if (wireBuchungDropdownEvents.__wired) return;
  wireBuchungDropdownEvents.__wired = true;

  const projectSelect = document.getElementById("select-project");
  const employeeSelect = document.getElementById("select-employee");

  if (employeeSelect) {
    employeeSelect.addEventListener("change", () => applyEmployee2ProjectPreset());
  }

  if (projectSelect) {
    projectSelect.addEventListener("change", () => {
      loadStructureElements(projectSelect.value);
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

export async function loadBuchungslisteProjects() {
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

// ─────────────────────────────────────────────────────────────────────────────
// State accessors for Buchung edit mode
// ─────────────────────────────────────────────────────────────────────────────

let __buchungEditId = null;
let __buchungEditReturnProjectId = "";

export function getBuchungEditId() {
  return __buchungEditId;
}

export function setBuchungEditId(id) {
  __buchungEditId = id;
}

export function getBuchungEditReturnProjectId() {
  return __buchungEditReturnProjectId;
}

export function setBuchungEditReturnProjectId(id) {
  __buchungEditReturnProjectId = String(id ?? "");
}
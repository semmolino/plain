// dashboard.js — Dashboard KPIs, charts, and project search
import { API_BASE } from "./config.js";
import { escapeHtml, debounce } from "./utils.js";
import { showView, setBottomNavActive, guardLeaveDraftIfNeeded } from "./navigation.js";

const __dashCharts = {};

const MONTH_NAMES_DE = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];

// getTenantId is injected at init time to avoid circular dep on auth.js
let _getTenantId = () => null;
let _loadProjektListe = async () => {};

export function initDashboard({ getTenantId, loadProjektListe }) {
  _getTenantId     = getTenantId;
  _loadProjektListe = loadProjektListe;
}

function dashFmtEur(val) {
  if (val == null) return "—";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(val);
}
function dashFmtH(val) {
  if (val == null) return "—";
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(val) + " h";
}
function dashMonthLabel(yyyymm) {
  if (!yyyymm) return "";
  const m = parseInt(yyyymm.split("-")[1], 10);
  return (MONTH_NAMES_DE[m - 1] || yyyymm);
}

export async function loadDashboard() {
  if (!_getTenantId()) return;

  try {
    const [kpisRes, projRes, monthlyRes, statusRes] = await Promise.all([
      fetch(`${API_BASE}/reports/dashboard/kpis`),
      fetch(`${API_BASE}/reports/dashboard/projects`),
      fetch(`${API_BASE}/reports/dashboard/monthly`),
      fetch(`${API_BASE}/reports/dashboard/by-status`),
    ]);

    const kpis    = (await kpisRes.json().catch(() => ({}))).data || {};
    const projs   = (await projRes.json().catch(() => ({}))).data || [];
    const monthly = (await monthlyRes.json().catch(() => ({}))).data || [];
    const byStatus = (await statusRes.json().catch(() => ({}))).data || [];

    dashRenderKpis(kpis);
    dashRenderMonthlyChart(monthly);
    dashRenderProjectTable(projs);
    dashRenderDonut(kpis);
    dashRenderByStatus(byStatus);
  } catch (err) {
    console.error("Dashboard load error", err);
  }
}

function dashRenderKpis(kpis) {
  const now = new Date();
  const monthLabel = `${MONTH_NAMES_DE[now.getMonth()]} ${now.getFullYear()}`;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("kpi-honorar",       dashFmtEur(kpis.HONORAR_GESAMT));
  set("kpi-leistungsstand", dashFmtEur(kpis.LEISTUNGSSTAND_VALUE));
  set("kpi-offen",         dashFmtEur(kpis.OFFENE_LEISTUNG));
  set("kpi-stunden",       dashFmtH(kpis.STUNDEN_MONAT));
  set("kpi-stunden-meta",  monthLabel);
}

function dashRenderMonthlyChart(monthly) {
  const canvas = document.getElementById("dash-monthly-chart");
  if (!canvas) return;

  if (__dashCharts.monthly) { __dashCharts.monthly.destroy(); delete __dashCharts.monthly; }

  const labels = monthly.map(r => dashMonthLabel(r.MONTH));
  const hours  = monthly.map(r => Number(r.HOURS_TOTAL) || 0);
  const costs  = monthly.map(r => Number(r.COST_TOTAL)  || 0);

  __dashCharts.monthly = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Stunden (h)",
          data: hours,
          backgroundColor: "rgba(59,130,246,0.65)",
          borderRadius: 5,
          yAxisID: "yH",
        },
        {
          label: "Kosten (€)",
          data: costs,
          backgroundColor: "rgba(249,115,22,0.55)",
          borderRadius: 5,
          yAxisID: "yC",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { font: { size: 11 }, boxWidth: 10 } } },
      scales: {
        yH: { type: "linear", position: "left",  ticks: { font: { size: 10 } }, grid: { color: "rgba(0,0,0,0.05)" } },
        yC: { type: "linear", position: "right", ticks: { font: { size: 10 }, callback: v => dashFmtEur(v) }, grid: { display: false } },
        x:  { ticks: { font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

function dashRenderProjectTable(projs) {
  const wrap = document.getElementById("dash-proj-table-wrap");
  if (!wrap) return;
  if (!projs.length) { wrap.innerHTML = '<div style="opacity:.5;font-size:13px;padding:8px 0">Keine Projekte gefunden.</div>'; return; }

  const rows = projs.map(p => `
    <tr>
      <td>${escapeHtml(p.NAME_SHORT || p.NAME_LONG || "—")}</td>
      <td class="num">${dashFmtEur(p.BUDGET_TOTAL_NET)}</td>
      <td class="num">${dashFmtEur(p.LEISTUNGSSTAND_VALUE)}</td>
      <td class="num">${dashFmtH(p.HOURS_TOTAL)}</td>
      <td class="num">${dashFmtEur(p.COST_TOTAL)}</td>
    </tr>`).join("");

  wrap.innerHTML = `
    <table class="dash-proj-table">
      <thead>
        <tr>
          <th>Projekt</th>
          <th class="num">Budget</th>
          <th class="num">Leistungsstand</th>
          <th class="num">Stunden</th>
          <th class="num">Kosten</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function dashRenderDonut(kpis) {
  const canvas = document.getElementById("dash-donut-chart");
  if (!canvas) return;

  if (__dashCharts.donut) { __dashCharts.donut.destroy(); delete __dashCharts.donut; }

  const abschl = Number(kpis.ABSCHLAGSRECHNUNGEN) || 0;
  const schluss = Number(kpis.SCHLUSSGERECHNET)    || 0;
  const offen   = Math.max(0, Number(kpis.OFFENE_LEISTUNG) || 0);
  const total   = abschl + schluss + offen;

  const colors = ["rgba(59,130,246,0.75)", "rgba(34,197,94,0.75)", "rgba(156,163,175,0.55)"];
  const labels = ["Abschlagsrechnungen", "Schlussgerechnet", "Offene Leistung"];
  const values = [abschl, schluss, offen];

  __dashCharts.donut = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      cutout: "65%",
    },
  });

  const legend = document.getElementById("dash-donut-legend");
  if (legend) {
    legend.innerHTML = labels.map((lbl, i) => {
      const pct = total > 0 ? ((values[i] / total) * 100).toFixed(0) : 0;
      return `<div class="dash-donut-legend-item">
        <div class="dash-donut-legend-dot" style="background:${colors[i]}"></div>
        <span>${escapeHtml(lbl)}: <strong>${dashFmtEur(values[i])}</strong> (${pct}%)</span>
      </div>`;
    }).join("");
  }
}

function dashRenderByStatus(byStatus) {
  const list = document.getElementById("dash-status-list");
  if (!list) return;
  if (!byStatus.length) { list.innerHTML = '<div style="opacity:.5;font-size:13px">Keine Daten.</div>'; return; }

  const max = Math.max(...byStatus.map(r => Number(r.PROJECT_COUNT) || 0), 1);
  list.innerHTML = byStatus.map(r => {
    const count = Number(r.PROJECT_COUNT) || 0;
    const pct   = Math.round((count / max) * 100);
    return `<div class="dash-status-row">
      <div class="dash-status-label-row">
        <span>${escapeHtml(r.STATUS_NAME || "—")}</span>
        <span class="dash-status-count">${count}</span>
      </div>
      <div class="dash-status-bar-wrap">
        <div class="dash-status-bar" style="width:${pct}%"></div>
      </div>
    </div>`;
  }).join("");
}

// ── Dashboard search ──────────────────────────────────────────────────────────

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
  await _loadProjektListe();
  const inp = document.getElementById("prj-list-global");
  if (inp) {
    inp.value = q;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export function initDashboardSearch() {
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

  document.addEventListener("click", (e) => {
    if (!box || box.classList.contains("hidden")) return;
    if (e.target === input) return;
    if (box.contains(e.target)) return;
    dashRenderSuggestions([], "");
  });

  box?.addEventListener("click", async (e) => {
    const item = e.target?.closest?.(".suggest-item");
    if (!item) return;
    const q = input.value;
    dashRenderSuggestions([], "");
    await dashGoToProjectSearch(q);
  });
}

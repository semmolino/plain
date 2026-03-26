// reports.js — Project reporting view
import { API_BASE } from "./config.js";
import { showMessage, escapeHtml } from "./utils.js";
import { showView, guardLeaveDraftIfNeeded } from "./navigation.js";
import { setupAutocomplete } from "./autocomplete.js";
import { buildStructureTree, flattenTree } from "./treeUtils.js";

let __repWired = false;

const repFmtEur = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
};
const repFmtH = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(n) + " h";
};

export function repShowSections(visible) {
  ["rep-kpi-section", "rep-billing-section", "rep-structure-section"].forEach(id => {
    document.getElementById(id)?.classList.toggle("hidden", !visible);
  });
}

export function wireRepView() {
  if (__repWired) return;
  __repWired = true;

  document.querySelectorAll("input[name='rep-filter-mode']").forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = document.querySelector("input[name='rep-filter-mode']:checked")?.value || "now";
      document.getElementById("rep-filter-as-of").classList.toggle("hidden", mode !== "as_of");
      document.getElementById("rep-filter-period").classList.toggle("hidden", mode !== "period");
    });
  });

  setupAutocomplete({
    inputId: "rep-project",
    hiddenId: "rep-project-id",
    listId: "rep-project-autocomplete",
    minLen: 2,
    search: async (q) => {
      const res = await fetch(`${API_BASE}/projekte/search?q=${encodeURIComponent(q)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Suche fehlgeschlagen");
      return json.data || [];
    },
    formatLabel: (p) => `${p.NAME_SHORT || ""}: ${p.NAME_LONG || ""}`.trim(),
    onSelect: () => {},
  });
}

export function initReportsBindings() {
  document.getElementById("btn-reporting-project")?.addEventListener("click", async () => {
    if (!(await guardLeaveDraftIfNeeded())) return;
    repShowSections(false);
    showMessage(document.getElementById("msg-reporting-project"), "", "");
    document.getElementById("rep-project-structure").innerHTML = "";
    showView("view-reporting-project");
    wireRepView();
  });

  document.getElementById("btn-load-project-report")?.addEventListener("click", async () => {
    const msgEl = document.getElementById("msg-reporting-project");
    const projectId = String(document.getElementById("rep-project-id")?.value || "").trim();

    if (!projectId) {
      showMessage(msgEl, "Bitte ein Projekt auswählen.", "error");
      return;
    }

    const filterMode = document.querySelector("input[name='rep-filter-mode']:checked")?.value || "now";
    const filterParams = new URLSearchParams({ filter_mode: filterMode });

    if (filterMode === "as_of") {
      const asOf = String(document.getElementById("rep-as-of-date")?.value || "").trim();
      if (!asOf) { showMessage(msgEl, "Bitte einen Stichtag angeben.", "error"); return; }
      filterParams.set("as_of_date", asOf);
    } else if (filterMode === "period") {
      const dateFrom = String(document.getElementById("rep-date-from")?.value || "").trim();
      const dateTo   = String(document.getElementById("rep-date-to")?.value || "").trim();
      if (!dateFrom || !dateTo) { showMessage(msgEl, "Bitte Von- und Bis-Datum angeben.", "error"); return; }
      filterParams.set("date_from", dateFrom);
      filterParams.set("date_to", dateTo);
    }

    repShowSections(false);
    showMessage(msgEl, "Lade Report …", "info");

    try {
      const base = `${API_BASE}/reports/project/${encodeURIComponent(projectId)}`;
      const [hRes, sRes] = await Promise.all([
        fetch(`${base}/header?${filterParams}`),
        fetch(`${base}/structure?${filterParams}`),
      ]);

      const hJson = await hRes.json().catch(() => ({}));
      const sJson = await sRes.json().catch(() => ({}));

      if (!hRes.ok) throw new Error(hJson.error || "Header konnte nicht geladen werden");
      if (!sRes.ok) throw new Error(sJson.error || "Struktur konnte nicht geladen werden");

      const header = hJson.data;
      const rows = Array.isArray(sJson.data) ? sJson.data : [];

      document.getElementById("rep-project-name").textContent = header.NAME_SHORT || "—";
      document.getElementById("rep-kpi-honorar").textContent      = repFmtEur(header.BUDGET_TOTAL_NET);
      document.getElementById("rep-kpi-leistungsstand").textContent = repFmtEur(header.LEISTUNGSSTAND_VALUE);
      document.getElementById("rep-kpi-stunden").textContent      = repFmtH(header.HOURS_TOTAL);
      document.getElementById("rep-kpi-kosten").textContent       = repFmtEur(header.COST_TOTAL);
      document.getElementById("rep-kpi-abschlag").textContent     = repFmtEur(header.PARTIAL_PAYMENT_NET_TOTAL);
      document.getElementById("rep-kpi-schluss").textContent      = repFmtEur(header.INVOICE_NET_TOTAL);

      const root = buildStructureTree(rows);
      const flat = flattenTree(root);

      const lines = flat.map(({ node, depth }) => {
        const label = escapeHtml(node.STRUCTURE_NAME_SHORT || node.NAME_SHORT || node.STRUCTURE_ID);
        const isParent = flat.some(r => r.node.PARENT_STRUCTURE_ID == node.STRUCTURE_ID || r.node.FATHER_ID == node.STRUCTURE_ID);
        const rowClass = isParent ? ' class="rep-row-parent"' : '';
        return `<tr${rowClass}>
          <td style="padding-left:${depth * 16 + 8}px">${label}</td>
          <td class="num">${repFmtEur(node.HONORAR_NET)}</td>
          <td class="num">${repFmtEur(node.EARNED_VALUE_NET)}</td>
          <td class="num">${repFmtEur(node.REST_HONORAR)}</td>
          <td class="num">${repFmtH(node.HOURS_TOTAL)}</td>
          <td class="num">${repFmtEur(node.COST_TOTAL)}</td>
        </tr>`;
      }).join("");

      document.getElementById("rep-project-structure").innerHTML = `
        <table class="dash-proj-table rep-structure-table">
          <thead>
            <tr>
              <th>Element</th>
              <th class="num">Honorar</th>
              <th class="num">Leistungsstand</th>
              <th class="num">Resthonorar</th>
              <th class="num">Stunden</th>
              <th class="num">Kosten</th>
            </tr>
          </thead>
          <tbody>${lines}</tbody>
        </table>`;

      repShowSections(true);
      showMessage(msgEl, "", "");
    } catch (err) {
      showMessage(msgEl, err.message || String(err), "error");
    }
  });
}

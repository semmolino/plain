// invoices.js — Rechnungsliste and Rechnungen (invoice) wizard
import { API_BASE } from "./config.js";
import { showMessage, debounce, todayIso } from "./utils.js";
import { setupAutocomplete } from "./autocomplete.js";
import { showView, guardLeaveDraftIfNeeded } from "./navigation.js";

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

export async function loadRechnungsliste() {
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
export function initRechnungslisteUi() {
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
}

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

export async function initInvoiceWizard() {
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

// ─────────────────────────────────────────────────────────────────────────────
// Abschlagsrechnung Wizard  (prefix: pp-)
// ─────────────────────────────────────────────────────────────────────────────

let __ppId = null;
let __ppCancelOnUnload = false;
let __ppInitInFlight = false;

function ppTodayIso() {
  return todayIso();
}

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

export async function initPartialPaymentWizard() {
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

// ─────────────────────────────────────────────────────────────────────────────
// Teil-/Schlussrechnung Wizard  (prefix: fi-)
// ─────────────────────────────────────────────────────────────────────────────

let __fiId = null;
let __fiInitInFlight = false;
let __fiInitDone = false;

const _fiNum = (v) => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : 0; };
const _fiRound2 = (v) => Math.round(_fiNum(v) * 100) / 100;
const _fiFmt = (v) => _fiRound2(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function fiDeleteDraftIfAny() {
  if (!__fiId) return true;
  try { await fetch(`${API_BASE}/invoices/${__fiId}`, { method: "DELETE", keepalive: true }); } catch (_) {}
  return true;
}

function fiReset() {
  __fiId = null;
  __fiInitInFlight = false;
  const ids = [
    "fi-company","fi-employee","fi-employee-id","fi-project","fi-project-id",
    "fi-contract","fi-contract-id","fi-date","fi-due","fi-period-start","fi-period-finish",
    "fi-comment","fi-vat","fi-vat-id","fi-payment-means","fi-payment-means-id",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "INPUT" || el.tagName === "SELECT") el.value = "";
    if (el.dataset) el.dataset.selectedLabel = "";
  });
  const dateEl = document.getElementById("fi-date");
  if (dateEl) dateEl.value = todayIso();
  const radio = document.getElementById("fi-type-teilschluss");
  if (radio) radio.checked = true;
  const tbody3 = document.getElementById("fi-phases-tbody");
  if (tbody3) tbody3.innerHTML = "";
  const tbody4 = document.getElementById("fi-deductions-tbody");
  if (tbody4) tbody4.innerHTML = "";
  ["fi-phases-honorar-total","fi-phases-extras-total","fi-phases-total","fi-deductions-total","fi-net-due"].forEach((id) => {
    const el = document.getElementById(id); if (el) el.textContent = "0,00";
  });
  ["fi-msg-1","fi-msg-2","fi-msg-3","fi-msg-3-load","fi-msg-4","fi-msg-4-load","fi-msg-5","fi-msg-6"].forEach((mid) => {
    const m = document.getElementById(mid); if (m) showMessage(m, "", "success");
  });
}

function fiShowPage(pageNo) {
  document.querySelectorAll("#fi-wizard .fi-page").forEach((p) => p.classList.add("hidden"));
  const active = document.getElementById(`fi-page-${pageNo}`);
  if (active) active.classList.remove("hidden");
}

function fiGetType() {
  const r = document.querySelector('input[name="fi-type"]:checked');
  return r ? r.value : "teilschlussrechnung";
}

async function loadCompaniesForFinalInvoice() {
  const sel = document.getElementById("fi-company");
  if (!sel) return;
  sel.innerHTML = '<option value="">Bitte wählen …</option>';
  try {
    const res = await fetch(`${API_BASE}/stammdaten/companies`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Laden");
    (json.data || []).forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.ID;
      opt.textContent = c.COMPANY_NAME_1 || String(c.ID);
      sel.appendChild(opt);
    });
  } catch (err) { console.error("loadCompaniesForFinalInvoice", err); }
}

async function fiLoadPhases() {
  const msgLoad = document.getElementById("fi-msg-3-load");
  const tbody = document.getElementById("fi-phases-tbody");
  if (!__fiId) return;
  showMessage(msgLoad, "Leistungspositionen werden geladen …", "info");
  tbody.innerHTML = "";
  try {
    const res = await fetch(`${API_BASE}/final-invoices/${__fiId}/phases`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler");
    showMessage(msgLoad, "", "success");
    fiRenderPhases(json.data || []);
  } catch (err) { showMessage(msgLoad, err.message || String(err), "error"); }
}

function fiRenderPhases(phases) {
  const tbody = document.getElementById("fi-phases-tbody");
  tbody.innerHTML = "";
  phases.forEach((ps) => {
    const tr = document.createElement("tr");
    if (ps.CLOSED) tr.style.opacity = "0.45";
    const closedNote = ps.CLOSED ? ' <span style="font-size:0.8em;color:#888;">(abgeschlossen)</span>' : "";
    const label = (ps.NAME_SHORT || "") + (ps.NAME_LONG ? " – " + ps.NAME_LONG : "") + closedNote;
    tr.innerHTML =
      '<td><input type="checkbox" data-ps-id="' + ps.ID + '" data-honorar="' + ps.AMOUNT_NET + '" data-extras="' + ps.AMOUNT_EXTRAS_NET + '"' +
      (ps.SELECTED ? " checked" : "") + (ps.CLOSED ? " disabled" : "") + '></td>' +
      "<td>" + label + "</td>" +
      '<td style="text-align:right">' + _fiFmt(ps.TOTAL_EARNED) + "</td>" +
      '<td style="text-align:right">' + _fiFmt(ps.ALREADY_BILLED) + "</td>" +
      '<td style="text-align:right">' + _fiFmt(ps.AMOUNT_NET) + "</td>" +
      '<td style="text-align:right">' + _fiFmt(ps.AMOUNT_EXTRAS_NET) + "</td>";
    tbody.appendChild(tr);
  });
  fiRecomputePhaseTotals();
}

function fiRecomputePhaseTotals() {
  let honorar = 0, extras = 0;
  document.querySelectorAll("#fi-phases-tbody input[type=checkbox]:checked").forEach((cb) => {
    honorar += _fiNum(cb.dataset.honorar);
    extras  += _fiNum(cb.dataset.extras);
  });
  const honorarEl = document.getElementById("fi-phases-honorar-total");
  const extrasEl  = document.getElementById("fi-phases-extras-total");
  const totalEl   = document.getElementById("fi-phases-total");
  if (honorarEl) honorarEl.textContent = _fiFmt(honorar);
  if (extrasEl)  extrasEl.textContent  = _fiFmt(extras);
  if (totalEl)   totalEl.textContent   = _fiFmt(honorar + extras);
}

async function fiSavePhases() {
  const checked = Array.from(document.querySelectorAll("#fi-phases-tbody input[type=checkbox]:checked"))
    .map((cb) => parseInt(cb.dataset.psId, 10)).filter((n) => Number.isFinite(n));
  const res = await fetch(`${API_BASE}/final-invoices/${__fiId}/phases`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structure_ids: checked }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Phasen konnten nicht gespeichert werden");
  return json;
}

async function fiLoadDeductions() {
  const msgLoad = document.getElementById("fi-msg-4-load");
  const tbody = document.getElementById("fi-deductions-tbody");
  if (!__fiId) return;
  showMessage(msgLoad, "Abschlagsrechnungen werden geladen …", "info");
  tbody.innerHTML = "";
  try {
    const res = await fetch(`${API_BASE}/final-invoices/${__fiId}/deductions`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler");
    showMessage(msgLoad, "", "success");
    fiRenderDeductions(json.data || []);
  } catch (err) { showMessage(msgLoad, err.message || String(err), "error"); }
}

function fiRenderDeductions(items) {
  const tbody = document.getElementById("fi-deductions-tbody");
  tbody.innerHTML = "";
  if (items.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="4" style="text-align:center;color:#888;">Keine Abschlagsrechnungen vorhanden</td>';
    tbody.appendChild(tr);
    fiRecomputeDeductionTotals();
    return;
  }
  items.forEach((pp) => {
    const tr = document.createElement("tr");
    const dateStr = pp.PARTIAL_PAYMENT_DATE ? new Date(pp.PARTIAL_PAYMENT_DATE).toLocaleDateString("de-DE") : "";
    tr.innerHTML =
      '<td><input type="checkbox" data-pp-id="' + pp.PARTIAL_PAYMENT_ID + '" data-amount="' + pp.DEDUCTION_AMOUNT_NET + '"' +
      (pp.SELECTED ? " checked" : "") + '></td>' +
      "<td>" + (pp.PARTIAL_PAYMENT_NUMBER || pp.PARTIAL_PAYMENT_ID) + "</td>" +
      "<td>" + dateStr + "</td>" +
      '<td style="text-align:right">' + _fiFmt(pp.TOTAL_AMOUNT_NET) + "</td>";
    tbody.appendChild(tr);
  });
  fiRecomputeDeductionTotals();
}

function fiRecomputeDeductionTotals() {
  let deductions = 0;
  document.querySelectorAll("#fi-deductions-tbody input[type=checkbox]:checked").forEach((cb) => {
    deductions += _fiNum(cb.dataset.amount);
  });
  const phaseTotalText = (document.getElementById("fi-phases-total") || {}).textContent || "0";
  const phaseTotal = _fiNum(phaseTotalText.replace(/\./g, "").replace(",", "."));
  const deductEl = document.getElementById("fi-deductions-total");
  const netEl    = document.getElementById("fi-net-due");
  if (deductEl) deductEl.textContent = _fiFmt(deductions);
  if (netEl)    netEl.textContent    = _fiFmt(phaseTotal - deductions);
}

async function fiSaveDeductions() {
  const items = Array.from(document.querySelectorAll("#fi-deductions-tbody input[type=checkbox]:checked"))
    .map((cb) => ({ partial_payment_id: parseInt(cb.dataset.ppId, 10), deduction_amount_net: _fiNum(cb.dataset.amount) }))
    .filter((item) => Number.isFinite(item.partial_payment_id));
  const res = await fetch(`${API_BASE}/final-invoices/${__fiId}/deductions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Abzüge konnten nicht gespeichert werden");
  return json;
}

async function fiLoadSummary() {
  if (!__fiId) return;
  const res = await fetch(`${API_BASE}/final-invoices/${__fiId}`);
  const inv = await res.json().catch(() => ({}));
  if (!res.ok) return;

  const typeLabel = inv.INVOICE_TYPE === "schlussrechnung" ? "Schlussrechnung" : "Teilschlussrechnung";
  const titleEl = document.getElementById("fi-view-title");
  if (titleEl) titleEl.textContent = typeLabel + " erstellen";

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("fi-sum-type", typeLabel);
  const projLabel = (document.getElementById("fi-project") || {}).dataset.selectedLabel || (document.getElementById("fi-project") || {}).value || String(inv.PROJECT_ID || "");
  set("fi-sum-project", projLabel);
  const contractLabel = (document.getElementById("fi-contract") || {}).dataset.selectedLabel || (document.getElementById("fi-contract") || {}).value || String(inv.CONTRACT_ID || "");
  set("fi-sum-contract", contractLabel);
  set("fi-sum-number", inv.INVOICE_NUMBER || "wird beim Buchen vergeben");
  set("fi-sum-date", inv.INVOICE_DATE ? new Date(inv.INVOICE_DATE).toLocaleDateString("de-DE") : "");
  set("fi-sum-due",  inv.DUE_DATE ? new Date(inv.DUE_DATE).toLocaleDateString("de-DE") : "");
  set("fi-sum-address", [inv.ADDRESS_NAME_1, inv.ADDRESS_STREET, ((inv.ADDRESS_POST_CODE || "") + " " + (inv.ADDRESS_CITY || "")).trim()].filter(Boolean).join(", "));
  set("fi-sum-contact", inv.CONTACT || "");

  const phaseTotal      = _fiNum(inv.PHASE_TOTAL);
  const deductionsTotal = _fiNum(inv.DEDUCTIONS_TOTAL);
  const totalNet        = _fiNum(inv.TOTAL_AMOUNT_NET);
  const vatPct          = _fiNum(inv.VAT_PERCENT);
  const tax             = _fiRound2(totalNet * vatPct / 100);
  const gross           = _fiRound2(totalNet + tax);

  set("fi-sum-phase-total",  _fiFmt(phaseTotal));
  set("fi-sum-deductions",   _fiFmt(deductionsTotal));
  set("fi-sum-total-net",    _fiFmt(totalNet));
  set("fi-sum-tax",          _fiFmt(tax) + " (" + vatPct + " %)");
  set("fi-sum-gross",        _fiFmt(gross));
}

export async function initFinalInvoiceWizard() {
  fiReset();
  await loadCompaniesForFinalInvoice();
  fiShowPage(1);
  if (!__fiInitDone) {
    __fiInitDone = true;
    wireFinalInvoiceWizard();
  }
}

function wireFinalInvoiceWizard() {
  document.querySelectorAll('input[name="fi-type"]').forEach((r) => {
    r.addEventListener("change", () => {
      const titleEl = document.getElementById("fi-view-title");
      if (titleEl) titleEl.textContent = r.value === "schlussrechnung" ? "Schlussrechnung erstellen" : "Teilschlussrechnung erstellen";
    });
  });

  setupAutocomplete({
    inputId: "fi-employee", hiddenId: "fi-employee-id", listId: "fi-employee-autocomplete", minLen: 2,
    search: async (q) => { const res = await fetch(`${API_BASE}/mitarbeiter/search?q=${encodeURIComponent(q)}`); const json = await res.json().catch(() => ({})); return json.data || []; },
    formatLabel: (e) => (e.SHORT_NAME || "") + ": " + ((e.FIRST_NAME || "").trim() + " " + (e.LAST_NAME || "").trim()).trim(),
  });

  setupAutocomplete({
    inputId: "fi-project", hiddenId: "fi-project-id", listId: "fi-project-autocomplete", minLen: 2,
    search: async (q) => { const res = await fetch(`${API_BASE}/projekte/search?q=${encodeURIComponent(q)}`); const json = await res.json().catch(() => ({})); return json.data || []; },
    formatLabel: (p) => (p.NAME_SHORT || "") + ": " + (p.NAME_LONG || ""),
    onSelect: () => {
      const cIn = document.getElementById("fi-contract"); const cId = document.getElementById("fi-contract-id");
      if (cIn) { cIn.value = ""; cIn.dataset.selectedLabel = ""; } if (cId) cId.value = "";
    },
  });

  setupAutocomplete({
    inputId: "fi-contract", hiddenId: "fi-contract-id", listId: "fi-contract-autocomplete", minLen: 2,
    search: async (q) => {
      const pid = (document.getElementById("fi-project-id") || {}).value; if (!pid) return [];
      const res = await fetch(`${API_BASE}/projekte/contracts/search?project_id=${encodeURIComponent(pid)}&q=${encodeURIComponent(q)}`);
      const json = await res.json().catch(() => ({})); return json.data || [];
    },
    formatLabel: (c) => (c.NAME_SHORT || "") + ": " + (c.NAME_LONG || ""),
  });

  setupAutocomplete({
    inputId: "fi-vat", hiddenId: "fi-vat-id", listId: "fi-vat-autocomplete", minLen: 1,
    search: async (q) => { const res = await fetch(`${API_BASE}/stammdaten/vat/search?q=${encodeURIComponent(q)}`); const json = await res.json().catch(() => ({})); return json.data || []; },
    formatLabel: (v) => (v.VAT || "") + ": " + (v.VAT_PERCENT != null ? v.VAT_PERCENT : "") + " %",
  });

  setupAutocomplete({
    inputId: "fi-payment-means", hiddenId: "fi-payment-means-id", listId: "fi-payment-means-autocomplete", minLen: 2,
    search: async (q) => { const res = await fetch(`${API_BASE}/stammdaten/payment-means/search?q=${encodeURIComponent(q)}`); const json = await res.json().catch(() => ({})); return json.data || []; },
    formatLabel: (p) => (p.NAME_SHORT || "") + ": " + (p.NAME_LONG || ""),
  });

  document.getElementById("fi-phases-tbody")?.addEventListener("change", (e) => { if (e.target.type === "checkbox") fiRecomputePhaseTotals(); });
  document.getElementById("fi-deductions-tbody")?.addEventListener("change", (e) => { if (e.target.type === "checkbox") fiRecomputeDeductionTotals(); });

  document.getElementById("fi-back-1")?.addEventListener("click", async () => {
    if (!(await guardLeaveDraftIfNeeded())) return;
    showView("view-vertraege-rechnungen-menu");
  });

  // Page 1 -> 2: create draft
  document.getElementById("fi-next-1")?.addEventListener("click", async () => {
    const msg = document.getElementById("fi-msg-1");
    const companyId  = (document.getElementById("fi-company") || {}).value;
    const employeeId = (document.getElementById("fi-employee-id") || {}).value;
    const projectId  = (document.getElementById("fi-project-id") || {}).value;
    const contractId = (document.getElementById("fi-contract-id") || {}).value;
    if (!companyId)  return showMessage(msg, "Bitte eine Firma auswählen.", "error");
    if (!employeeId) return showMessage(msg, "Bitte einen Mitarbeiter auswählen.", "error");
    if (!projectId)  return showMessage(msg, "Bitte ein Projekt auswählen.", "error");
    if (!contractId) return showMessage(msg, "Bitte einen Vertrag auswählen.", "error");
    const d = document.getElementById("fi-date"); if (d && !d.value) d.value = todayIso();
    if (__fiId) { showMessage(msg, "", "success"); return fiShowPage(2); }
    if (__fiInitInFlight) return;
    __fiInitInFlight = true;
    try {
      showMessage(msg, "Entwurf wird erstellt …", "info");
      const res = await fetch(`${API_BASE}/invoices/init`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, employee_id: employeeId, project_id: projectId, contract_id: contractId, invoice_type: fiGetType() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Entwurf konnte nicht erstellt werden");
      __fiId = json.id; showMessage(msg, "", "success"); fiShowPage(2);
    } catch (err) { showMessage(msg, err.message || String(err), "error"); }
    finally { __fiInitInFlight = false; }
  });

  document.getElementById("fi-prev-2")?.addEventListener("click", () => fiShowPage(1));

  // Page 2 -> 3: save dates
  document.getElementById("fi-next-2")?.addEventListener("click", async () => {
    const msg  = document.getElementById("fi-msg-2");
    const date = (document.getElementById("fi-date") || {}).value;
    const due  = (document.getElementById("fi-due") || {}).value;
    const ps   = (document.getElementById("fi-period-start") || {}).value;
    const pf   = (document.getElementById("fi-period-finish") || {}).value;
    if (!date || !due || !ps || !pf) return showMessage(msg, "Bitte alle Pflichtfelder ausfüllen", "error");
    if (!__fiId) return showMessage(msg, "Entwurf fehlt", "error");
    try {
      showMessage(msg, "Daten werden gespeichert …", "info");
      const res = await fetch(`${API_BASE}/invoices/${__fiId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_date: date, due_date: due, billing_period_start: ps, billing_period_finish: pf }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");
      showMessage(msg, "", "success"); fiShowPage(3); await fiLoadPhases();
    } catch (err) { showMessage(msg, err.message || String(err), "error"); }
  });

  document.getElementById("fi-prev-3")?.addEventListener("click", () => fiShowPage(2));

  // Page 3 -> 4: save phase selection
  document.getElementById("fi-next-3")?.addEventListener("click", async () => {
    const msg = document.getElementById("fi-msg-3");
    if (!__fiId) return showMessage(msg, "Entwurf fehlt", "error");
    const checked = document.querySelectorAll("#fi-phases-tbody input[type=checkbox]:checked");
    if (checked.length === 0) return showMessage(msg, "Bitte mindestens eine Leistungsposition auswählen.", "error");
    try {
      showMessage(msg, "Phasen werden gespeichert …", "info");
      await fiSavePhases();
      showMessage(msg, "", "success"); fiShowPage(4); await fiLoadDeductions();
    } catch (err) { showMessage(msg, err.message || String(err), "error"); }
  });

  document.getElementById("fi-prev-4")?.addEventListener("click", () => fiShowPage(3));

  // Page 4 -> 5: save deductions
  document.getElementById("fi-next-4")?.addEventListener("click", async () => {
    const msg = document.getElementById("fi-msg-4");
    if (!__fiId) return showMessage(msg, "Entwurf fehlt", "error");
    try {
      showMessage(msg, "Abzüge werden gespeichert …", "info");
      await fiSaveDeductions();
      showMessage(msg, "", "success"); fiShowPage(5);
    } catch (err) { showMessage(msg, err.message || String(err), "error"); }
  });

  document.getElementById("fi-prev-5")?.addEventListener("click", () => fiShowPage(4));

  // Page 5 -> 6: save VAT/comment/payment-means
  document.getElementById("fi-next-5")?.addEventListener("click", async () => {
    const msg            = document.getElementById("fi-msg-5");
    const vatId          = (document.getElementById("fi-vat-id") || {}).value;
    const paymentMeansId = (document.getElementById("fi-payment-means-id") || {}).value;
    if (!vatId)          return showMessage(msg, "Bitte einen Mehrwertsteuersatz auswählen.", "error");
    if (!paymentMeansId) return showMessage(msg, "Bitte eine Zahlungsart auswählen.", "error");
    if (!__fiId) return showMessage(msg, "Entwurf fehlt", "error");
    try {
      showMessage(msg, "Daten werden gespeichert …", "info");
      const res = await fetch(`${API_BASE}/invoices/${__fiId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: (document.getElementById("fi-comment") || {}).value || "", vat_id: vatId, payment_means_id: paymentMeansId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Speichern fehlgeschlagen");
      showMessage(msg, "", "success"); fiShowPage(6); await fiLoadSummary();
    } catch (err) { showMessage(msg, err.message || String(err), "error"); }
  });

  document.getElementById("fi-prev-6")?.addEventListener("click", () => fiShowPage(5));

  document.getElementById("fi-pdf")?.addEventListener("click", () => {
    if (!__fiId) return;
    window.open(`${API_BASE}/invoices/${__fiId}/pdf?download=1`, "_blank");
  });

  document.getElementById("fi-book")?.addEventListener("click", async () => {
    const msg = document.getElementById("fi-msg-6");
    if (!__fiId) return showMessage(msg, "Kein Entwurf gefunden", "error");
    if (!window.confirm("Rechnung jetzt buchen? Dieser Vorgang kann nicht rückgängig gemacht werden.")) return;
    try {
      showMessage(msg, "Rechnung wird gebucht …", "info");
      const res = await fetch(`${API_BASE}/final-invoices/${__fiId}/book`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Buchen fehlgeschlagen");
      showMessage(msg, "Rechnung " + (json.number || "") + " wurde erfolgreich gebucht.", "success");
      const bookBtn = document.getElementById("fi-book");
      if (bookBtn) bookBtn.disabled = true;
      await fiLoadSummary();
    } catch (err) { showMessage(msg, err.message || String(err), "error"); }
  });
}
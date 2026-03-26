// mitarbeiter.js — Mitarbeiter anlegen, Projekt-Dropdowns, invoice address/contact
import { API_BASE } from "./config.js";
import { showMessage } from "./utils.js";
import { setupAutocomplete } from "./autocomplete.js";

// --- MITARBEITER ---
export async function loadGeschlechter() {
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

// ─────────────────────────────────────────────────────────────────────────────
// Mitarbeiterliste (EMPLOYEE)
// ─────────────────────────────────────────────────────────────────────────────

function _str(v) {
  return String(v ?? "").trim();
}

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

export async function loadMitarbeiterListe() {
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

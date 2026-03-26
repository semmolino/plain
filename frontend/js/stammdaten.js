// stammdaten.js — Stammdaten, Unternehmen, Address, Rollen, Kontakte
import { API_BASE } from "./config.js";
import { showMessage } from "./utils.js";

// --- UNTERNEHMEN ---
export async function loadCountriesForUnternehmen() {
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
export async function loadCountriesForAddress() {
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
export async function loadSalutationsForKontakte() {
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

export async function loadGendersForKontakte() {
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


export function resetKontakteAddressSelection() {
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

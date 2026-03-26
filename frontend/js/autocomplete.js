// autocomplete.js — reusable autocomplete widget
import { debounce } from "./utils.js";

export function setupAutocomplete({ inputId, hiddenId, listId, minLen = 2, search, formatLabel, onSelect }) {
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

  document.addEventListener("click", (e) => {
    const clickedInside = input.contains(e.target) || list.contains(e.target);
    if (!clickedInside) close();
  });
}

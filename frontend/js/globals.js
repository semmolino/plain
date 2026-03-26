// globals.js — shared cached data loaders
import { API_BASE } from "./config.js";

let __billingTypesCache = null;

export async function getBillingTypes() {
  if (Array.isArray(__billingTypesCache)) return __billingTypesCache;
  const res = await fetch(`${API_BASE}/stammdaten/billing-types`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Fehler beim Laden der Abrechnungsarten");
  __billingTypesCache = Array.isArray(json.data) ? json.data : [];
  return __billingTypesCache;
}

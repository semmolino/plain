"use strict";

/**
 * Adressen und Kontakte — Geschaeftslogik (UI-Pilot Runde 8).
 *
 * Die Handler in controllers/stammdaten.js hatten die Logik bisher selbst.
 * Hier liegt, was prueffaehig sein muss: welche Belege an einer Adresse
 * haengen, ob eine Adresse dem Mandanten gehoert, und dass es je Adresse nur
 * einen Hauptansprechpartner gibt.
 */

/** Verknuepfte Belege je Recht — was man nicht sehen darf, kommt nicht mit. */
const LINK_PERMISSIONS = {
  projects:   "projects.view",
  groups:     "projects.view",
  offers:     "offers.view",
  contracts:  "projects.contracts.view",
  invoices:   "invoices.view",
  partials:   "invoices.view",
  nachtraege: "nachtraege.view",
};

/**
 * Wo eine Adresse verwendet wird: Projekte und Angebote (Auftraggeber),
 * Vertraege, Rechnungen und Abschlaege (Rechnungsempfaenger), Nachtraege.
 *
 * Rechnungen und Abschlaege fuehren die Adresse als INVOICE_ADDRESS_ID bzw.
 * ADVANCE_INVOICE_ADDRESS_ID. Bis Runde 8 fragte die Detailseite ADDRESS_ID
 * ab — die Spalte gibt es dort nicht, der Fehler wurde geschluckt, und die
 * Listen „Rechnungen" und „Abschlaege" waren immer leer.
 *
 * @param {(key: string) => boolean} can  Recht des Aufrufers
 */
async function addressLinks(supabase, { tenantId, addressId, can }) {
  const q = (kind, run) => (can(LINK_PERMISSIONS[kind]) ? run() : Promise.resolve({ data: [] }));
  const soft = async (p) => {
    const r = await p;
    if (r.error) throw r.error;
    return r.data || [];
  };
  const [projects, offers, contracts, invoices, partials, nachtraege] = await Promise.all([
    soft(q("projects", () => supabase.from("PROJECT").select("ID, ABBR, NAME")
      .eq("TENANT_ID", tenantId).eq("ADDRESS_ID", addressId).order("ABBR", { ascending: true }))),
    soft(q("offers", () => supabase.from("OFFER").select("ID, ABBR, NAME")
      .eq("TENANT_ID", tenantId).eq("ADDRESS_ID", addressId).order("ABBR", { ascending: true }))),
    soft(q("contracts", () => supabase.from("CONTRACT").select("ID, ABBR, NAME, PROJECT_ID")
      .eq("TENANT_ID", tenantId).eq("INVOICE_ADDRESS_ID", addressId).order("ABBR", { ascending: true }))),
    soft(q("invoices", () => supabase.from("INVOICE").select("ID, INVOICE_NUMBER, INVOICE_DATE, PROJECT_ID")
      .eq("TENANT_ID", tenantId).eq("INVOICE_ADDRESS_ID", addressId).order("INVOICE_DATE", { ascending: false }))),
    soft(q("partials", () => supabase.from("ADVANCE_INVOICE").select("ID, ADVANCE_INVOICE_NUMBER, ADVANCE_INVOICE_DATE, PROJECT_ID")
      .eq("TENANT_ID", tenantId).eq("ADVANCE_INVOICE_ADDRESS_ID", addressId).order("ADVANCE_INVOICE_DATE", { ascending: false }))),
    soft(q("nachtraege", () => supabase.from("NACHTRAG").select("ID, ABBR, NAME, PROJECT_ID")
      .eq("TENANT_ID", tenantId).eq("ADDRESS_ID", addressId).order("ABBR", { ascending: true }))),
  ]);
  const { groups, groupOfProject } = can(LINK_PERMISSIONS.groups)
    ? await groupsForAddress(supabase, { tenantId, addressId, projectIds: projects.map((p) => p.ID) })
    : { groups: [], groupOfProject: new Map() };
  return {
    projects: projects.map((p) => ({ ...p, GROUP_NAME: groupOfProject.get(String(p.ID)) ?? null })),
    groups, offers, contracts, invoices, partials, nachtraege,
  };
}

/**
 * Gesamtprojekte zu einer Adresse: die, deren Auftraggeber sie ist, und die,
 * zu denen ihre Projekte gehoeren — beim Stufenvertrag steht der Bauherr oft
 * nur an den Projekten. Dazu je Projekt der Name seines Gesamtprojekts.
 *
 * Im Deploy-Fenster (Migration 0181 noch nicht eingespielt) leer statt
 * Fehler — die Adressseite soll daran nicht scheitern. Jeder andere Fehler
 * bleibt ein Fehler.
 */
async function groupsForAddress(supabase, { tenantId, addressId, projectIds }) {
  const hard = async (p) => {
    const r = await p;
    if (r.error) throw r.error;
    return r.data || [];
  };
  try {
    const [own, links] = await Promise.all([
      hard(supabase.from("PROJECT_GROUP").select("ID, ABBR, NAME")
        .eq("TENANT_ID", tenantId).eq("ADDRESS_ID", addressId)),
      projectIds.length
        ? hard(supabase.from("PROJECT").select("ID, PROJECT_GROUP_ID")
          .eq("TENANT_ID", tenantId).in("ID", projectIds).not("PROJECT_GROUP_ID", "is", null))
        : Promise.resolve([]),
    ]);
    const byId = new Map(own.map((g) => [String(g.ID), g]));
    const missing = [...new Set(links.map((l) => l.PROJECT_GROUP_ID))].filter((id) => !byId.has(String(id)));
    if (missing.length) {
      for (const g of await hard(supabase.from("PROJECT_GROUP").select("ID, ABBR, NAME")
        .eq("TENANT_ID", tenantId).in("ID", missing))) byId.set(String(g.ID), g);
    }
    const groupOfProject = new Map();
    for (const l of links) {
      const g = byId.get(String(l.PROJECT_GROUP_ID));
      if (g) groupOfProject.set(String(l.ID), g.NAME);
    }
    const groups = [...byId.values()].sort((a, b) => String(a.NAME).localeCompare(String(b.NAME), "de"));
    return { groups, groupOfProject };
  } catch (e) {
    if (/PROJECT_GROUP/.test(String(e?.message || ""))) return { groups: [], groupOfProject: new Map() };
    throw e;
  }
}

/**
 * Gehoert die Adresse diesem Mandanten? Ein Fremdschluessel prueft das
 * nicht — er umgeht RLS —, ein Kontakt liesse sich sonst an die Adresse
 * eines fremden Bueros haengen.
 */
async function assertOwnAddress(supabase, { tenantId, addressId }) {
  const { data, error } = await supabase.from("ADDRESS").select("ID")
    .eq("ID", addressId).eq("TENANT_ID", tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw { status: 400, message: "Diese Adresse gibt es nicht (mehr)." };
}

/**
 * Gehoert der Kontakt zu genau dieser Adresse (und diesem Mandanten)? Ein
 * Beleg mit dem Kontakt einer anderen Adresse haette im PDF einen fremden
 * Namen unter dem Empfaenger.
 */
async function assertContactOfAddress(supabase, { tenantId, addressId, contactId }) {
  const { data, error } = await supabase.from("CONTACTS").select("ID")
    .eq("ID", contactId).eq("ADDRESS_ID", addressId).eq("TENANT_ID", tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw { status: 400, message: "Dieser Kontakt gehört nicht zur gewählten Adresse." };
}

/**
 * „Hauptansprechpartner dieser Adresse" heisst genau einer. Vorher liess sich
 * das Kaestchen an beliebig vielen Kontakten derselben Adresse setzen.
 */
async function ensureSinglePrimary(supabase, { tenantId, addressId, contactId }) {
  const { error } = await supabase.from("CONTACTS").update({ IS_PRIMARY: 0 })
    .eq("TENANT_ID", tenantId).eq("ADDRESS_ID", addressId).eq("IS_PRIMARY", 1).neq("ID", contactId);
  if (error && !/IS_PRIMARY/i.test(String(error.message))) throw error;
}

const trimOrNull = (v) => {
  const s = v == null ? "" : String(v).trim();
  return s || null;
};

/**
 * Pflichtfelder einer Adresse, bereinigt. Vorher pruefte PATCH nur auf
 * „irgendetwas" — ein Name aus Leerzeichen wurde gespeichert, und POST
 * pruefte vor dem Kuerzen.
 */
function addressRequired(body) {
  const name = trimOrNull(body?.address_name_1);
  const country = parseInt(String(body?.country_id ?? ""), 10);
  if (!name) throw { status: 400, message: "Bitte einen Namen angeben (Name 1)." };
  if (!country || Number.isNaN(country)) throw { status: 400, message: "Bitte ein Land wählen." };
  return { ADDRESS_NAME_1: name, COUNTRY_ID: country };
}

/** Pflichtfelder eines Kontakts, bereinigt (POST und PATCH gleich). */
function contactRequired(body) {
  const first = trimOrNull(body?.first_name);
  const last = trimOrNull(body?.last_name);
  const int = (v) => { const n = parseInt(String(v ?? ""), 10); return n && !Number.isNaN(n) ? n : null; };
  const salutation = int(body?.salutation_id);
  const gender = int(body?.gender_id);
  const address = int(body?.address_id);
  const missing = [
    !first && "Vorname", !last && "Nachname", !salutation && "Anrede", !gender && "Geschlecht", !address && "Adresse",
  ].filter(Boolean);
  if (missing.length) throw { status: 400, message: `Bitte noch angeben: ${missing.join(", ")}.` };
  return { FIRST_NAME: first, LAST_NAME: last, SALUTATION_ID: salutation, GENDER_ID: gender, ADDRESS_ID: address };
}

module.exports = {
  LINK_PERMISSIONS, addressLinks, assertOwnAddress, assertContactOfAddress, ensureSinglePrimary,
  addressRequired, contactRequired, trimOrNull,
};

"use strict";

/**
 * E-Mail-Textvorlagen fuer den Beleg- und Mahnungsversand.
 *
 * Pro Mandant existiert je eine Vorlage fuer Rechnungen ('invoice') und fuer
 * Mahnungen ('dunning') — EMAIL_TEMPLATE, Migration 0114. Betreff und Text
 * duerfen Platzhalter {{token}} enthalten. Aufgeloest wird IMMER beim Versand,
 * auch wenn der Nutzer den Text im Versanddialog vorher angepasst hat: nur so
 * funktioniert der Sammelversand, bei dem ein Text fuer viele Belege gilt.
 *
 * Fehlt die Tabelle (Migration noch nicht eingespielt) oder die Zeile, greifen
 * die Standardtexte aus DEFAULTS — die Funktion bleibt dadurch nutzbar, bevor
 * jemand etwas konfiguriert hat.
 */

const TABLE = "EMAIL_TEMPLATE";

/** Gueltige Vorlagenschluessel. */
const TEMPLATE_KEYS = ["invoice", "dunning"];

const DEFAULTS = {
  invoice: {
    subject: "{{belegart}} {{belegnummer}}",
    body: [
      "Sehr geehrte Damen und Herren,",
      "",
      "anbei erhalten Sie unsere {{belegart}} {{belegnummer}} vom {{belegdatum}} über {{betrag}}.",
      "Wir bitten um Ausgleich des Betrages bis zum {{faelligkeit}}.",
      "",
      "Mit freundlichen Grüßen",
      "{{firma}}",
    ].join("\n"),
  },
  dunning: {
    subject: "{{mahnstufe}} zu {{belegart}} {{belegnummer}}",
    body: [
      "Sehr geehrte Damen und Herren,",
      "",
      "zu unserer {{belegart}} {{belegnummer}} vom {{belegdatum}} über {{betrag}} konnten wir bisher",
      "keinen vollständigen Zahlungseingang feststellen. Der offene Betrag beträgt {{offener_betrag}};",
      "die Forderung ist seit {{tage_ueberfaellig}} Tagen überfällig.",
      "",
      "Wir bitten Sie, den Betrag kurzfristig auszugleichen. Einzelheiten entnehmen Sie bitte der",
      "beigefügten {{mahnstufe}}.",
      "",
      "Mit freundlichen Grüßen",
      "{{firma}}",
    ].join("\n"),
  },
};

/** Erkennt "Tabelle existiert nicht" (Migration 0114 noch nicht eingespielt). */
function isMissingRelation(error) {
  return error && /relation .* does not exist|does not exist|could not find the table/i.test(error.message || "");
}

function assertKey(key) {
  if (!TEMPLATE_KEYS.includes(key)) {
    throw { status: 400, message: `Unbekannte Vorlage "${key}". Erlaubt: ${TEMPLATE_KEYS.join(", ")}` };
  }
  return key;
}

// ── Platzhalter ───────────────────────────────────────────────────────────────

/**
 * Ersetzt {{token}} durch konkrete Werte. Unbekannte Tokens bleiben stehen
 * (kein versehentliches Loeschen) — gleiches Verhalten wie bei den Kopf-/
 * Fusstexten der PDFs (services_pdf_render.js).
 */
function renderText(text, values) {
  if (!text || typeof text !== "string") return text || "";
  return text.replace(/\{\{\s*([\wäöüÄÖÜß]+)\s*\}\}/g, (m, key) => {
    const k = String(key).toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, k)
      ? (values[k] == null ? "" : String(values[k]))
      : m;
  });
}

const FMT_EUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

function fmtEur(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return FMT_EUR.format(Number.isFinite(n) ? n : 0);
}

function fmtDateDE(d) {
  if (!d) return "";
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split("-");
  return y && m && dd ? `${dd}.${m}.${y}` : s;
}

const INVOICE_TYPE_LABELS = {
  rechnung:            "Rechnung",
  schlussrechnung:     "Schlussrechnung",
  teilschlussrechnung: "Teilschlussrechnung",
  stornorechnung:      "Stornorechnung",
  gutschrift:          "Gutschrift",
};

// ── Vorlagen lesen / schreiben ────────────────────────────────────────────────

async function loadRow(supabase, tenantId, key) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("TEMPLATE_KEY, SUBJECT, BODY")
    .eq("TENANT_ID", tenantId)
    .eq("TEMPLATE_KEY", key)
    .maybeSingle();
  if (error) {
    if (isMissingRelation(error)) return null; // Soft-Fallback auf DEFAULTS
    throw error;
  }
  return data || null;
}

/** Beide Vorlagen fuer das Einstellungs-UI — immer vollstaendig befuellt. */
async function getTemplates(supabase, { tenantId }) {
  let rows = [];
  const { data, error } = await supabase
    .from(TABLE)
    .select("TEMPLATE_KEY, SUBJECT, BODY")
    .eq("TENANT_ID", tenantId);
  if (error && !isMissingRelation(error)) throw error;
  rows = data || [];

  const byKey = {};
  for (const r of rows) byKey[r.TEMPLATE_KEY] = r;

  return TEMPLATE_KEYS.map(key => {
    const row = byKey[key];
    const hasCustom = !!(row && (row.SUBJECT || row.BODY));
    return {
      key,
      subject:        (row && row.SUBJECT) || DEFAULTS[key].subject,
      body:           (row && row.BODY)    || DEFAULTS[key].body,
      isCustom:       hasCustom,
      defaultSubject: DEFAULTS[key].subject,
      defaultBody:    DEFAULTS[key].body,
    };
  });
}

async function saveTemplate(supabase, { tenantId, key, subject, body }) {
  assertKey(key);
  const { error } = await supabase.from(TABLE).upsert({
    TENANT_ID:    tenantId,
    TEMPLATE_KEY: key,
    SUBJECT:      (subject || "").trim() || null,
    BODY:         (body    || "").trim() || null,
    UPDATED_AT:   new Date().toISOString(),
  }, { onConflict: "TENANT_ID,TEMPLATE_KEY" });
  if (error) {
    if (isMissingRelation(error)) {
      throw { status: 503, message: "Tabelle EMAIL_TEMPLATE fehlt — bitte Migration 0114 einspielen." };
    }
    throw error;
  }
  return { ok: true };
}

/** Setzt eine Vorlage auf den Standardtext zurueck (Zeile loeschen). */
async function resetTemplate(supabase, { tenantId, key }) {
  assertKey(key);
  const { error } = await supabase.from(TABLE).delete()
    .eq("TENANT_ID", tenantId)
    .eq("TEMPLATE_KEY", key);
  if (error && !isMissingRelation(error)) throw error;
  return { ok: true };
}

/** Betreff/Text einer Vorlage — mit Standardtext als Fallback. */
async function resolveTemplate(supabase, { tenantId, key }) {
  assertKey(key);
  const row = await loadRow(supabase, tenantId, key);
  return {
    subject: (row && row.SUBJECT) || DEFAULTS[key].subject,
    body:    (row && row.BODY)    || DEFAULTS[key].body,
  };
}

// ── Belegkontext (Platzhalterwerte) ───────────────────────────────────────────

/**
 * Laedt die Platzhalterwerte eines Belegs.
 * @param {'INVOICE'|'PARTIAL_PAYMENT'} docType
 * @returns {Promise<{values: object, to: string, number: string}|null>}
 */
async function loadDocumentContext(supabase, { tenantId, docType, docId }) {
  const isInvoice = docType === "INVOICE";
  const table     = isInvoice ? "INVOICE" : "PARTIAL_PAYMENT";
  const numberCol = isInvoice ? "INVOICE_NUMBER" : "PARTIAL_PAYMENT_NUMBER";
  const dateCol   = isInvoice ? "INVOICE_DATE"   : "PARTIAL_PAYMENT_DATE";
  const typeCols  = isInvoice ? ", INVOICE_TYPE" : "";

  const { data: doc, error } = await supabase
    .from(table)
    .select(`ID, ${numberCol}, ${dateCol}, DUE_DATE, TOTAL_AMOUNT_GROSS, TOTAL_AMOUNT_NET, VAT_PERCENT, PROJECT_ID, COMPANY_ID, ADDRESS_NAME_1, CONTACT, CONTACT_MAIL${typeCols}`)
    .eq("ID", docId)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!doc) return null;

  // Brutto: bevorzugt der gebuchte Wert, sonst aus Netto + USt rekonstruiert.
  let gross = doc.TOTAL_AMOUNT_GROSS != null ? Number(doc.TOTAL_AMOUNT_GROSS) : null;
  if (gross == null && doc.TOTAL_AMOUNT_NET != null) {
    gross = Math.round(Number(doc.TOTAL_AMOUNT_NET) * (1 + Number(doc.VAT_PERCENT ?? 0) / 100) * 100) / 100;
  }

  const payCol = isInvoice ? "INVOICE_ID" : "PARTIAL_PAYMENT_ID";
  const { data: pays } = await supabase
    .from("PAYMENT")
    .select("AMOUNT_PAYED_GROSS")
    .eq(payCol, docId);
  const paid = (pays || []).reduce((s, p) => {
    const v = parseFloat(String(p.AMOUNT_PAYED_GROSS ?? "0"));
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);
  const open = gross != null ? Math.round((gross - paid) * 100) / 100 : null;

  let projekt = "";
  if (doc.PROJECT_ID) {
    const { data: p } = await supabase
      .from("PROJECT").select("NAME_SHORT, NAME_LONG").eq("ID", doc.PROJECT_ID).maybeSingle();
    if (p) projekt = [p.NAME_SHORT, p.NAME_LONG].filter(Boolean).join(": ");
  }

  // Eigener Firmenname: bevorzugt die am Beleg haengende Firma, sonst die
  // erste des Mandanten. TENANT_ID bleibt in beiden Faellen gesetzt (App-Layer
  // ist die einzige Mandantentrennung — es gibt keine RLS).
  let firma = "";
  {
    let q = supabase.from("COMPANY").select("COMPANY_NAME_1").eq("TENANT_ID", tenantId);
    q = doc.COMPANY_ID ? q.eq("ID", doc.COMPANY_ID) : q.limit(1);
    const { data: comp } = await q.maybeSingle();
    firma = comp?.COMPANY_NAME_1 || "";
  }

  const belegart = isInvoice
    ? (INVOICE_TYPE_LABELS[String(doc.INVOICE_TYPE || "").toLowerCase()] || "Rechnung")
    : "Abschlagsrechnung";

  const number = doc[numberCol] || "";

  return {
    to:     doc.CONTACT_MAIL || "",
    number,
    dueDate: doc.DUE_DATE || null,
    values: {
      belegart,
      belegnummer:     number,
      belegdatum:      fmtDateDE(doc[dateCol]),
      faelligkeit:     fmtDateDE(doc.DUE_DATE),
      betrag:          gross != null ? fmtEur(gross) : "",
      bezahlt:         fmtEur(paid),
      offener_betrag:  open != null ? fmtEur(open) : "",
      projekt,
      kunde:           doc.ADDRESS_NAME_1 || "",
      ansprechpartner: doc.CONTACT || "",
      firma,
    },
  };
}

function daysBetweenToday(dateStr) {
  if (!dateStr) return 0;
  const due   = new Date(String(dateStr).slice(0, 10) + "T00:00:00Z");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(due.getTime())) return 0;
  return Math.max(0, Math.round((today - due) / 86400000));
}

// ── Compose ───────────────────────────────────────────────────────────────────

function pick(given, fallback) {
  return given != null && String(given).trim() !== "" ? String(given) : fallback;
}

/**
 * Baut Betreff + Text fuer den Rechnungsversand. Uebergebene Texte gewinnen
 * gegenueber der Vorlage; Platzhalter werden in beiden Faellen aufgeloest.
 * @returns {Promise<{to:string, subject:string, body:string}>}
 */
async function composeInvoiceEmail(supabase, { tenantId, docType, docId, subject, body }) {
  const ctx = await loadDocumentContext(supabase, { tenantId, docType, docId });
  if (!ctx) throw { status: 404, message: "Beleg nicht gefunden" };
  const tpl = await resolveTemplate(supabase, { tenantId, key: "invoice" });
  return {
    to:      ctx.to,
    subject: renderText(pick(subject, tpl.subject), ctx.values),
    body:    renderText(pick(body,    tpl.body),    ctx.values),
  };
}

/**
 * Baut Betreff + Text fuer den Mahnungsversand.
 * @param {object} mahnung – MAHNUNG-Zeile (INVOICE_ID/PP_ID/MAHNSTUFE)
 */
async function composeMahnungEmail(supabase, { tenantId, mahnung, subject, body }) {
  const docType = mahnung.INVOICE_ID ? "INVOICE" : "PARTIAL_PAYMENT";
  const docId   = mahnung.INVOICE_ID || mahnung.PP_ID;
  const ctx = await loadDocumentContext(supabase, { tenantId, docType, docId });
  if (!ctx) throw { status: 404, message: "Beleg zur Mahnung nicht gefunden" };

  const { data: lv } = await supabase
    .from("MAHNUNG_SETTINGS")
    .select("LABEL, FEE")
    .eq("TENANT_ID", tenantId)
    .eq("MAHNSTUFE", mahnung.MAHNSTUFE)
    .maybeSingle();

  const FALLBACK_LABELS = { 1: "Zahlungserinnerung", 2: "1. Mahnung", 3: "2. Mahnung", 4: "3. Mahnung" };
  const values = {
    ...ctx.values,
    mahnstufe:         lv?.LABEL || FALLBACK_LABELS[mahnung.MAHNSTUFE] || `Mahnstufe ${mahnung.MAHNSTUFE}`,
    mahngebuehr:       fmtEur(lv?.FEE ?? 0),
    tage_ueberfaellig: String(daysBetweenToday(ctx.dueDate)),
  };

  const tpl = await resolveTemplate(supabase, { tenantId, key: "dunning" });
  return {
    to:      ctx.to,
    subject: renderText(pick(subject, tpl.subject), values),
    body:    renderText(pick(body,    tpl.body),    values),
  };
}

module.exports = {
  TEMPLATE_KEYS,
  DEFAULTS,
  getTemplates,
  saveTemplate,
  resetTemplate,
  resolveTemplate,
  renderText,
  loadDocumentContext,
  composeInvoiceEmail,
  composeMahnungEmail,
};

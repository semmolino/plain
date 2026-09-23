"use strict";

// ---------------------------------------------------------------------------
// Domaene "Zahlungseingaenge" — Zahlungen zu bereits vorhandenen Belegen.
//
// WARUM EINE EIGENE DOMAENE
//   Der Belegimport kennt ein Feld "bereits bezahlt": eine Zahlung je Beleg,
//   mit einem Datum. Das genuegt fuer den einfachen Fall und verliert alles
//   andere — Teilzahlungen, einen zweiten Eingang, Skonto, und vor allem
//   Zahlungen zu Belegen, die in einem FRUEHEREN Stapel oder in plan&simple
//   selbst entstanden sind.
//
//   n Zahlungen je Beleg lassen sich in der Belegdatei nicht ohne Kunstgriffe
//   abbilden. Eine eigene Datei ist hier nicht Mehraufwand, sondern die
//   einzige Form, die dem entspricht, was das Altsystem wirklich fuehrt.
//
// WAS SIE NICHT TUT
//   Sie legt keine Belege an. Findet sie den Beleg nicht, ist das ein Fehler —
//   eine Zahlung ohne Forderung waere eine Behauptung ueber Geld.
// ---------------------------------------------------------------------------

const belegeSvc = require("./importBelege");
const { insertProgressSnapshot } = require("./projectProgress");

const { fmt2, num, stapeln, einfuegen, IN_CHUNK } = belegeSvc;

const s = (v) => (v === null || v === undefined ? "" : String(v).trim());
const norm = (v) => s(v).toLowerCase().replace(/\s+/g, " ");

const PAYMENT_FIELDS = [
  { key: "doc_number",     header: "Belegnummer",            required: false, example: "RE-2025-044", aliases: ["belegnummer", "rechnungsnummer", "invoicenum", "nr"], type: "text" },
  { key: "doc_legacy_ref", header: "Beleg-ID im Altsystem",  required: false, example: "",            aliases: ["belegidimaltsystem", "altid", "legacyref", "wikoid", "belegid"], type: "text" },
  { key: "project_number", header: "Projektnummer (Kontrolle)", required: false, example: "",         aliases: ["projektnummer", "projektnr", "nameshort"] },
  { key: "payment_date",   header: "Zahlungsdatum",          required: true,  example: "20.12.2025",  aliases: ["zahlungsdatum", "zahldatum", "paymentdate", "valuta", "datum"], type: "date" },
  { key: "amount_gross",   header: "Zahlbetrag brutto",      required: true,  example: "14875",       aliases: ["zahlbetragbrutto", "betrag", "brutto", "payed", "zahlbetrag"], type: "money" },
  { key: "cash_discount_gross", header: "Skontoabzug brutto", required: false, example: "",           aliases: ["skontoabzugbrutto", "skonto", "skontobetrag", "discountvalue"], type: "money" },
  { key: "purpose",        header: "Verwendungszweck",       required: false, example: "",            aliases: ["verwendungszweck", "zweck", "purpose"] },
  { key: "comment",        header: "Bemerkung",              required: false, example: "",            aliases: ["bemerkung", "kommentar", "comment", "notiz"] },
];

// ---------------------------------------------------------------------------

async function loadPaymentContext(supabase, tenantId) {
  const holen = async (tabelle, spalten) => {
    const { data } = await supabase.from(tabelle).select(spalten).eq("TENANT_ID", tenantId).limit(100000);
    if ((data || []).length >= 100000) {
      throw { status: 500, message: `Bestand zu gross: ${tabelle} wurde beim Lesen abgeschnitten.` };
    }
    return data || [];
  };

  const [rechnungen, abschlaege, zahlungen, projekte] = await Promise.all([
    holen("INVOICE", "ID, INVOICE_NUMBER, PROJECT_ID, CONTRACT_ID, STATUS_ID, TOTAL_AMOUNT_GROSS, VAT_PERCENT, LEGACY_REF"),
    holen("ADVANCE_INVOICE", "ID, ADVANCE_INVOICE_NUMBER, PROJECT_ID, CONTRACT_ID, STATUS_ID, TOTAL_AMOUNT_GROSS, VAT_PERCENT, LEGACY_REF"),
    holen("PAYMENT", "INVOICE_ID, ADVANCE_INVOICE_ID, AMOUNT_PAYED_GROSS"),
    holen("PROJECT", "ID, ABBR"),
  ]);

  const docsByNumber = new Map();
  const docsByLegacy = new Map();
  const merke = (kind, r, nummer) => {
    const eintrag = {
      kind, id: r.ID, nummer, projectId: r.PROJECT_ID, contractId: r.CONTRACT_ID,
      statusId: Number(r.STATUS_ID) || null,
      brutto: num(r.TOTAL_AMOUNT_GROSS), vatPercent: num(r.VAT_PERCENT),
    };
    if (nummer) {
      const k = norm(nummer);
      // Eine doppelt vergebene Nummer trifft sonst stillschweigend den
      // erstbesten Beleg. Es gibt nirgends einen Unique-Index darauf.
      if (docsByNumber.has(k)) docsByNumber.get(k).mehrdeutig = true;
      else docsByNumber.set(k, eintrag);
    }
    if (r.LEGACY_REF) {
      const k = norm(r.LEGACY_REF);
      if (docsByLegacy.has(k)) docsByLegacy.get(k).mehrdeutig = true;
      else docsByLegacy.set(k, eintrag);
    }
  };
  for (const r of rechnungen) merke("invoice", r, r.INVOICE_NUMBER);
  for (const r of abschlaege) merke("advance", r, r.ADVANCE_INVOICE_NUMBER);

  // Was schon bezahlt ist — sonst laesst sich nicht sagen, ob eine weitere
  // Zahlung den Beleg uebersteigt.
  const bezahlt = new Map();
  for (const z of zahlungen) {
    const key = z.INVOICE_ID != null ? `invoice|${z.INVOICE_ID}` : z.ADVANCE_INVOICE_ID != null ? `advance|${z.ADVANCE_INVOICE_ID}` : null;
    if (!key) continue;
    bezahlt.set(key, fmt2((bezahlt.get(key) || 0) + num(z.AMOUNT_PAYED_GROSS)));
  }

  const projektNummer = new Map(projekte.map((p) => [String(p.ID), p.ABBR]));

  return { docsByNumber, docsByLegacy, bezahlt, projektNummer, existingKeys: new Set() };
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

async function commitPaymentRows(rows, { supabase, tenantId, batchId }) {
  if (!rows.length) return { inserted: 0 };

  // Positionen der betroffenen Belege in einem Zug — die Zahlung verteilt sich
  // proportional darauf, nicht ueber die Pauschal-Knoten des Projekts: sie
  // gehoert zu dem, was berechnet wurde.
  const invIds = [...new Set(rows.filter((r) => r._dbRow.beleg.kind === "invoice").map((r) => r._dbRow.beleg.id))];
  const advIds = [...new Set(rows.filter((r) => r._dbRow.beleg.kind === "advance").map((r) => r._dbRow.beleg.id))];

  const posJeBeleg = new Map();
  const ladePositionen = async (tabelle, spalte, ids, kind) => {
    for (const teil of stapeln(ids, IN_CHUNK)) {
      if (!teil.length) continue;
      const { data } = await supabase.from(tabelle)
        .select(`${spalte}, STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET`).in(spalte, teil);
      for (const z of data || []) {
        const k = `${kind}|${z[spalte]}`;
        if (!posJeBeleg.has(k)) posJeBeleg.set(k, []);
        posJeBeleg.get(k).push(z);
      }
    }
  };
  await ladePositionen("INVOICE_STRUCTURE", "INVOICE_ID", invIds, "invoice");
  await ladePositionen("ADVANCE_INVOICE_STRUCTURE", "ADVANCE_INVOICE_ID", advIds, "advance");

  const kopfZeilen = [];
  const bauplan = [];
  for (const r of rows) {
    const e = r._dbRow;
    const satz = num(e.beleg.vatPercent);
    const netto = fmt2(e.brutto / (1 + satz / 100));

    const zeile = {
      [e.beleg.kind === "invoice" ? "INVOICE_ID" : "ADVANCE_INVOICE_ID"]: e.beleg.id,
      PROJECT_ID: e.beleg.projectId, CONTRACT_ID: e.beleg.contractId,
      AMOUNT_PAYED_GROSS: fmt2(e.brutto),
      AMOUNT_PAYED_NET: netto,
      AMOUNT_PAYED_VAT: fmt2(e.brutto - netto),
      AMOUNT_PAYED_EXTRAS_NET: null,
      PAYMENT_DATE: e.datum,
      PURPOSE_OF_PAYMENT: e.zweck || `Zahlung zu ${e.beleg.nummer} (Import)`,
      COMMENT: e.comment || null,
      TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
    };
    kopfZeilen.push(zeile);
    bauplan.push({ e, netto });

    // Skonto als EIGENE Zahlung: sonst schliesst der offene Posten nie auf
    // null, und der Beleg bleibt fuer immer teilbezahlt stehen.
    if (num(e.skonto) > 0) {
      const sNetto = fmt2(num(e.skonto) / (1 + satz / 100));
      kopfZeilen.push({
        ...zeile,
        AMOUNT_PAYED_GROSS: fmt2(e.skonto),
        AMOUNT_PAYED_NET: sNetto,
        AMOUNT_PAYED_VAT: fmt2(num(e.skonto) - sNetto),
        PURPOSE_OF_PAYMENT: `Skonto zu ${e.beleg.nummer} (Import)`,
      });
      bauplan.push({ e, netto: sNetto });
    }
  }

  const ids = await einfuegen(supabase, "PAYMENT", kopfZeilen, "ID", "Zahlungen schreiben", batchId, "Zahlungen");

  const strukturZeilen = [];
  bauplan.forEach((b, i) => {
    const positionen = posJeBeleg.get(`${b.e.beleg.kind}|${b.e.beleg.id}`) || [];
    if (!positionen.length) return;   // Beleg ohne Positionen: nur der Kopf
    const gesamt = positionen.reduce((a, p) => a + num(p.AMOUNT_NET) + num(p.AMOUNT_EXTRAS_NET), 0);
    const anteile = positionen.map((p) => {
      const teil = num(p.AMOUNT_NET) + num(p.AMOUNT_EXTRAS_NET);
      return fmt2(gesamt !== 0 ? b.netto * teil / gesamt : b.netto / positionen.length);
    });
    // Rundungsrest auf die betragsgroesste Position — bei vielen kleinen
    // Positionen faellt er auf der ersten sonst auf.
    const rest = fmt2(b.netto - anteile.reduce((a, x) => a + x, 0));
    if (rest !== 0) {
      let g = 0;
      for (let k = 1; k < anteile.length; k++) if (Math.abs(anteile[k]) > Math.abs(anteile[g])) g = k;
      anteile[g] = fmt2(anteile[g] + rest);
    }
    positionen.forEach((p, k) => strukturZeilen.push({
      PAYMENT_ID: ids[i]?.ID,
      [b.e.beleg.kind === "invoice" ? "INVOICE_ID" : "ADVANCE_INVOICE_ID"]: b.e.beleg.id,
      STRUCTURE_ID: p.STRUCTURE_ID,
      AMOUNT_PAYED_NET: anteile[k], AMOUNT_PAYED_EXTRAS_NET: 0,
      TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
    }));
  });
  await einfuegen(supabase, "PAYMENT_STRUCTURE", strukturZeilen, null, "Zahlungspositionen schreiben", batchId, "Zahlungen");

  // ── Aggregate: setzen, nicht fortschreiben ──────────────────────────────
  const knoten = new Map();
  for (const z of strukturZeilen) knoten.set(String(z.STRUCTURE_ID), z.STRUCTURE_ID);
  const zuwachs = new Map();
  for (const z of strukturZeilen) {
    const k = String(z.STRUCTURE_ID);
    zuwachs.set(k, fmt2((zuwachs.get(k) || 0) + num(z.AMOUNT_PAYED_NET)));
  }

  for (const [k, id] of knoten) {
    const { data } = await supabase.from("PAYMENT_STRUCTURE").select("AMOUNT_PAYED_NET").eq("STRUCTURE_ID", id);
    await supabase.from("PROJECT_STRUCTURE")
      .update({ PAYED: fmt2((data || []).reduce((a, z) => a + num(z.AMOUNT_PAYED_NET), 0)) })
      .eq("ID", id).eq("TENANT_ID", tenantId);
    void k;
  }

  const projekte = [...new Set(rows.map((r) => r._dbRow.beleg.projectId).filter((x) => x != null))];
  for (const pid of projekte) {
    const { data } = await supabase.from("PAYMENT").select("AMOUNT_PAYED_NET").eq("PROJECT_ID", pid).eq("TENANT_ID", tenantId);
    await supabase.from("PROJECT")
      .update({ PAYED: fmt2((data || []).reduce((a, z) => a + num(z.AMOUNT_PAYED_NET), 0)) })
      .eq("ID", pid).eq("TENANT_ID", tenantId);
  }

  // Der Schnappschuss bekommt den ZUWACHS: insertProgressSnapshot fuehrt PAYED
  // als kumulierte Spalte und addiert.
  const snapshots = [...zuwachs.entries()].map(([k, betrag]) => ({
    TENANT_ID: tenantId, STRUCTURE_ID: knoten.get(k), PAYED: betrag,
  }));
  if (snapshots.length) await insertProgressSnapshot(supabase, snapshots);

  return {
    inserted: rows.length,
    belege: { zahlungen: kopfZeilen.length, positionen: strukturZeilen.length, knoten: knoten.size, projekte: projekte.length },
  };
}

module.exports = { PAYMENT_FIELDS, loadPaymentContext, commitPaymentRows, norm };

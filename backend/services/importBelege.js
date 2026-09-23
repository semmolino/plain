"use strict";

// ---------------------------------------------------------------------------
// Belege gebuendelt schreiben.
//
// WARUM ES DIESEN WEG GIBT
//   Der bisherige Weg (bookReferenceDocument) legt EINEN Beleg je Aufruf an:
//   initInvoice mit 14 Abfragen, Kopf-Update, Positionen, Summenlauf, Beleg
//   neu lesen, buchen, Aggregate je Beleg fortschreiben, ein Schnappschuss je
//   Knoten. Das sind rund 30 sequentielle Anfragen je Beleg.
//
//   Bei 5.000 Belegen sind das 150.000 Anfragen. Bei 5 ms je Rundreise reisst
//   der Gateway-Schnitt nach 30 Sekunden — also bei etwa 150 Belegen. Und der
//   Abbruch kommt nicht an einer Belegrenze, sondern mitten im Beleg, mit halb
//   fortgeschriebenen Aggregaten.
//
//   Genau dieses Muster hat den Projektimport umgebracht (siehe den Kommentar
//   ueber commitProjectFullRows). Die Antwort ist dieselbe: wenige Stapel
//   statt vieler Rundreisen.
//
// ZWEI EINSICHTEN TRAGEN DEN UMBAU
//   1. Der Stammdaten-Abzug haengt an (Firma, Mitarbeiter, Vertrag), nicht am
//      Beleg. Einmal laden, hineinspreizen (services/belegSnapshot.js).
//   2. Der Beleg wird gleich GEBUCHT eingefuegt — mit Status 2 und allen fuenf
//      Summenspalten. Damit entfallen Kopf-Update, Summenlauf und das Buchen,
//      und es gibt keinen halbfertigen Beleg, den ein Abbruch hinterlassen
//      koennte.
//
// DIE SOLLBRUCHSTELLE
//   Alle Belegzeilen tragen ihre Stapel-Kennung schon im Insert, und die
//   Aggregate werden ERST GANZ AM ENDE gesetzt — aus den Rohzeilen, nicht
//   fortgeschrieben. Bricht der Lauf vorher ab, stehen verwaiste, vollstaendig
//   gekennzeichnete Belegzeilen da und KEIN verschobener Zaehler. Der Rollback
//   raeumt sie restlos ab. Bricht er innerhalb der Aggregatphase ab, ist das
//   folgenlos: ein erneuter Lauf rechnet dasselbe.
// ---------------------------------------------------------------------------

const { belegSnapshot } = require("./belegSnapshot");
const { belegSummen } = require("./belegRechnung");
const { insertProgressSnapshot } = require("./projectProgress");
const { recomputeBilledByStructure } = require("./finalInvoices");
const { bumpNumberRanges } = require("./numberRangeBump");
const { defaultPaymentMeansId } = require("./paymentMeans");

const CHUNK = 500;
const IN_CHUNK = 200;
const fmt2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const stapeln = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

/**
 * Gestapeltes Einfuegen mit positionsgleicher ID-Rueckgabe.
 * Die Fehlermeldung nennt, wieviel schon steht und was NICHT angefasst wurde —
 * ohne diesen Zusatz ruft der Nutzer den Support an.
 */
async function einfuegen(supabase, tabelle, zeilen, spalten, was, batchId, phase) {
  if (!zeilen.length) return [];
  const raus = [];
  for (const teil of stapeln(zeilen, CHUNK)) {
    const q = supabase.from(tabelle).insert(teil);
    const { data, error } = spalten ? await q.select(spalten) : await q;
    if (error) {
      throw {
        status: 500,
        message: `${was} fehlgeschlagen bei ${raus.length} von ${zeilen.length}${phase ? ` (${phase})` : ""}` +
          ` — Summen wurden nicht angefasst. Stapel #${batchId} kann zurückgesetzt werden. Ursache: ${error.message}`,
      };
    }
    if (spalten) raus.push(...(data || []));
  }
  return raus;
}

// ---------------------------------------------------------------------------
// Stammdaten in einem Zug
// ---------------------------------------------------------------------------

async function ladeStammdaten(supabase, tenantId, employeeId, gruppen) {
  const ids = (f) => [...new Set(gruppen.map((g) => g[0]._dbRow[f]).filter((x) => x != null))];
  const contractIds = ids("contractId");
  const companyIds = ids("companyId");

  const holen = async (tabelle, spalten, spalte, werte) => {
    const out = [];
    for (const teil of stapeln(werte, IN_CHUNK)) {
      const { data } = await supabase.from(tabelle).select(spalten).in(spalte, teil);
      out.push(...(data || []));
    }
    return out;
  };

  // Bewusst `await` statt `.then()`-Ketten am Query-Builder: der ist nur
  // eingeschraenkt thenable, ein angehaengtes `.catch` gibt es dort nicht.
  const einzeln = async (fn, fallback) => {
    try { const { data } = await fn(); return data ?? fallback; }
    catch (_) { return fallback; }
  };

  const vertraege = await holen("CONTRACT", "ID, PROJECT_ID, CURRENCY_ID, VAT_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID, VAT_CATEGORY, VAT_EXEMPTION_REASON_CODE, VAT_EXEMPTION_REASON_TEXT", "ID", contractIds);
  const firmen = await holen("COMPANY", `ID, COMPANY_NAME_1, COMPANY_NAME_2, STREET, POST_CODE, CITY, COUNTRY_ID, POST_OFFICE_BOX, BIC, TAX_NUMBER, IBAN, "TAX-ID", "CREDITOR-ID"`, "ID", companyIds);
  const mitarbeiter = await einzeln(() => supabase.from("EMPLOYEE")
    .select("ID, FIRST_NAME, LAST_NAME, ABBR, MAIL, MOBILE, SALUTATION_ID")
    .eq("ID", employeeId).eq("TENANT_ID", tenantId).maybeSingle(), null);
  const laender = await einzeln(() => supabase.from("COUNTRY").select("ID, NAME, ABBR"), []);
  const anreden = await einzeln(() => supabase.from("SALUTATION").select("ID, NAME"), []);
  const vatSaetze = await einzeln(() => supabase.from("VAT").select("ID, VAT_PERCENT"), []);
  const settings = await einzeln(() => supabase.from("TENANT_SETTINGS")
    .select("KEY, VALUE").eq("TENANT_ID", tenantId).eq("KEY", "default_vat_id"), []);

  const adressIds = [...new Set(vertraege.map((c) => c.INVOICE_ADDRESS_ID).filter((x) => x != null))];
  const kontaktIds = [...new Set(vertraege.map((c) => c.INVOICE_CONTACT_ID).filter((x) => x != null))];
  const adressen = await holen("ADDRESS", "ID, ADDRESS_NAME_1, ADDRESS_NAME_2, STREET, POST_CODE, CITY, COUNTRY_ID, POST_OFFICE_BOX, CUSTOMER_NUMBER, BUYER_REFERENCE", "ID", adressIds);
  const kontakte = await holen("CONTACTS", "ID, FIRST_NAME, LAST_NAME, SALUTATION_ID, EMAIL, MOBILE", "ID", kontaktIds);

  const proId = (arr) => new Map((arr || []).map((r) => [String(r.ID), r]));
  const landLang = (id) => laender.find((l) => String(l.ID) === String(id))?.NAME ?? null;
  const landKurz = (id) => laender.find((l) => String(l.ID) === String(id))?.ABBR ?? null;
  const anrede = (id) => anreden.find((a) => String(a.ID) === String(id))?.NAME ?? null;

  const standardVatId = settings?.[0]?.VALUE ? Number(settings[0].VALUE) : null;
  const vatProzent = (id) => {
    const v = vatSaetze.find((x) => String(x.ID) === String(id));
    return v ? num(v.VAT_PERCENT) : null;
  };

  const firmenMap = proId(firmen);
  const adressMap = proId(adressen);
  const kontaktMap = proId(kontakte);
  let paymentMeansId = null;
  try { paymentMeansId = await defaultPaymentMeansId(supabase, tenantId); } catch (_) { /* ungepflegt: bleibt leer */ }

  const vertragMap = proId(vertraege);

  // Der Abzug haengt an (Vertrag, Firma) — mehr braucht es nicht, und genau
  // das ist der Kern der Einsparung: alle Belege desselben Vertrags teilen
  // ihn, statt ihn je Beleg mit 14 Abfragen neu zu erfragen.
  const abzuege = new Map();
  const abzugFuer = (contractId, companyId) => {
    const key = `${contractId}|${companyId}`;
    if (abzuege.has(key)) return abzuege.get(key);

    const c = vertragMap.get(String(contractId));
    const firma = firmenMap.get(String(companyId));
    const adresse = adressMap.get(String(c?.INVOICE_ADDRESS_ID));
    const kontakt = kontaktMap.get(String(c?.INVOICE_CONTACT_ID));
    const vatId = c?.VAT_ID ?? standardVatId ?? null;

    const wert = {
      contract: c ?? null,
      company: firma ?? null,
      companyCountryLong: landLang(firma?.COUNTRY_ID),
      employee: mitarbeiter ?? null,
      employeeSalutation: anrede(mitarbeiter?.SALUTATION_ID),
      address: adresse ?? null,
      addressCountryShort: landKurz(adresse?.COUNTRY_ID),
      addressId: c?.INVOICE_ADDRESS_ID ?? null,
      contact: kontakt ?? null,
      contactSalutation: anrede(kontakt?.SALUTATION_ID),
      contactId: c?.INVOICE_CONTACT_ID ?? null,
      vatId,
      vatPercent: vatProzent(vatId) ?? 0,
      paymentMeansId,
    };
    abzuege.set(key, wert);
    return wert;
  };

  return { abzugFuer, vatSaetze };
}

/** Den Steuerschluessel zum Satz aus der Datei finden — oder gar keinen. */
function vatIdZuSatz(vatSaetze, prozent) {
  if (prozent == null) return undefined;
  const treffer = (vatSaetze || []).find((v) => Math.abs(num(v.VAT_PERCENT) - num(prozent)) < 0.001);
  return treffer ? treffer.ID : null;
}

// ---------------------------------------------------------------------------
// Der gebuendelte Schreibweg
// ---------------------------------------------------------------------------

/**
 * @param {Array} gruppen  Belege, bereits gebuendelt und sortiert:
 *                         [[zeile, …], …], je Gruppe ein Beleg
 */
async function schreibeBelege(supabase, { tenantId, batchId, employeeId, gruppen, ctx }) {
  const stamm = await ladeStammdaten(supabase, tenantId, employeeId, gruppen);

  // ── 1. Belegzeilen bauen (noch nichts geschrieben) ────────────────────────
  const gebaut = gruppen.map((group) => {
    const e = group[0]._dbRow;
    const abzug = stamm.abzugFuer(e.contractId, e.companyId);
    const kind = e.docType === "invoice" ? "invoice" : "advance";

    // MwSt aus der Datei schlaegt den Vertragssatz — ein Altbeleg kann 16 %
    // tragen, wo heute 19 % gelten. Der Steuerschluessel muss dann MITgehen:
    // stand bisher der Satz aus der Datei neben dem Schluessel des Vertrags,
    // war der Beleg in sich widerspruechlich. Findet sich kein passender
    // Schluessel, bleibt er leer — lieber keiner als ein falscher.
    const vatPercent = e.vatPercent != null ? num(e.vatPercent) : num(abzug.vatPercent);
    const vatIdAusDatei = e.vatPercent != null ? vatIdZuSatz(stamm.vatSaetze, e.vatPercent) : undefined;

    const positionen = (e._positionen || []).map((p) => ({
      STRUCTURE_ID: p.id,
      AMOUNT_NET: fmt2(p.amt),
      AMOUNT_EXTRAS_NET: p.extrasAmt != null ? fmt2(p.extrasAmt) : fmt2(p.amt * num(p.extrasPercent) / 100),
    }));

    const abzugSumme = fmt2((e.abzuege || []).reduce((a, d) => a + num(d.betrag), 0));
    const summen = belegSummen({ positionen, vatPercent, abzuege: abzugSumme });

    const row = {
      ...belegSnapshot({
        kind, tenantId,
        projectId: e.projectId, contractId: e.contractId,
        companyId: e.companyId, employeeId,
        invoiceType: e.invoiceType,
        ...abzug,
        vatId: vatIdAusDatei !== undefined ? vatIdAusDatei : abzug.vatId,
        vatPercent,
      }),
      // Gleich gebucht: kein Entwurf, den ein Abbruch hinterlassen koennte.
      STATUS_ID: 2,
      ...summen,
      [kind === "invoice" ? "INVOICE_NUMBER" : "ADVANCE_INVOICE_NUMBER"]: e.docNumber,
      [kind === "invoice" ? "INVOICE_DATE" : "ADVANCE_INVOICE_DATE"]: e.docDate,
      DUE_DATE: e.dueDate ?? null,
      COMMENT: e.comment ?? null,
      IMPORT_BATCH_ID: batchId,
    };
    if (e.legacyRef) row.LEGACY_REF = e.legacyRef;
    if (e.text1) row.TEXT_1 = e.text1;
    if (e.text2) row.TEXT_2 = e.text2;
    if (e.buyerReference) row.BUYER_REFERENCE = e.buyerReference;
    if (e.periodStart) row.BILLING_PERIOD_START = e.periodStart;
    if (e.periodEnd) row.BILLING_PERIOD_FINISH = e.periodEnd;
    if (e.cashDiscountPercent != null) row.CASH_DISCOUNT_PERCENT = e.cashDiscountPercent;
    if (e.cashDiscountDays != null) row.CASH_DISCOUNT_DAYS = e.cashDiscountDays;

    return { group, e, kind, row, positionen, stufe: num(e.commitSeq) };
  });

  // ── 2. Belege in Wellen einfuegen ─────────────────────────────────────────
  // Innerhalb einer Stufe ist die Reihenfolge egal; zwischen den Stufen nicht:
  // eine Schlussrechnung braucht die Kennungen ihrer Abschlaege, ein Storno
  // die seines Originals.
  const idNachNummer = new Map(); // norm. Nummer -> { id, kind }
  const schluessel = (v) => String(v || "").trim().toLowerCase();

  for (const stufe of [0, 1, 2]) {
    for (const kind of ["advance", "invoice"]) {
      const welle = gebaut.filter((b) => b.stufe === stufe && b.kind === kind);
      if (!welle.length) continue;

      // Bezuege aufloesen — jetzt stehen die Belege der frueheren Stufen.
      for (const b of welle) {
        if (b.e.istStorno) {
          const ziel = idNachNummer.get(schluessel(b.e.stornoZu)) || ctx?.docsByNumber?.get(schluessel(b.e.stornoZu));
          if (!ziel) throw { status: 400, message: `Storno „${b.e.docNumber}“: der Beleg „${b.e.stornoZu}“ wurde nicht geschrieben` };
          b.stornoZielId = ziel.id;
          b.row[kind === "invoice" ? "CANCELS_INVOICE_ID" : "CANCELS_ADVANCE_INVOICE_ID"] = ziel.id;
        }
      }

      const tabelle = kind === "invoice" ? "INVOICE" : "ADVANCE_INVOICE";
      const ids = await einfuegen(supabase, tabelle, welle.map((b) => b.row), "ID", `${tabelle} schreiben`, batchId, `Stufe ${stufe}`);
      welle.forEach((b, i) => {
        b.docId = ids[i]?.ID;
        idNachNummer.set(schluessel(b.e.docNumber), { id: b.docId, kind });
      });
    }
  }

  // ── 3. Positionen ─────────────────────────────────────────────────────────
  for (const kind of ["advance", "invoice"]) {
    const tabelle = kind === "invoice" ? "INVOICE_STRUCTURE" : "ADVANCE_INVOICE_STRUCTURE";
    const spalte = kind === "invoice" ? "INVOICE_ID" : "ADVANCE_INVOICE_ID";
    const zeilen = gebaut.filter((b) => b.kind === kind).flatMap((b) =>
      b.positionen.map((p) => ({ ...p, [spalte]: b.docId, TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId })));
    await einfuegen(supabase, tabelle, zeilen, null, `${tabelle} schreiben`, batchId, "Positionen");
  }

  // ── 4. Abzugskette ────────────────────────────────────────────────────────
  const abzugZeilen = gebaut.flatMap((b) => (b.e.abzuege || []).map((d) => {
    const ziel = idNachNummer.get(schluessel(d.nummer)) || ctx?.docsByNumber?.get(schluessel(d.nummer));
    if (!ziel) throw { status: 400, message: `Schlussrechnung „${b.e.docNumber}“: der Abschlag „${d.nummer}“ wurde nicht geschrieben` };
    return {
      TENANT_ID: tenantId, INVOICE_ID: b.docId,
      ADVANCE_INVOICE_ID: ziel.id, DEDUCTION_AMOUNT_NET: d.betrag,
      IMPORT_BATCH_ID: batchId,
    };
  }));
  await einfuegen(supabase, "INVOICE_DEDUCTION", abzugZeilen, null, "Abzüge schreiben", batchId, "Abzüge");

  // ── 5. Stornierte Originale auf Status 3 ──────────────────────────────────
  // Zwingend: recomputeBilledByStructure liest Status 2 UND 3, damit sich ein
  // Storno-Paar auf null aufhebt. Bleibt das Original auf 2, zaehlt sein
  // Betrag in jeder Rueckrechnung doppelt.
  for (const b of gebaut.filter((x) => x.stornoZielId != null)) {
    const tabelle = b.kind === "invoice" ? "INVOICE" : "ADVANCE_INVOICE";
    await supabase.from(tabelle)
      .update({ STATUS_ID: 3, CANCELLATION_DATE: b.e.cancellationDate || b.e.docDate })
      .eq("ID", b.stornoZielId).eq("TENANT_ID", tenantId);
  }

  // ── 6. Abgeschlossene Knoten ──────────────────────────────────────────────
  // Ohne das haelt der Schlussrechnungs-Assistent einen bereits abgerechneten
  // Knoten fuer offen und schlaegt ihn erneut vor — ein falscher Vorschlag mit
  // unmittelbarer Geldfolge.
  for (const b of gebaut.filter((x) => x.kind === "invoice" && x.e.closesProject && x.positionen.length)) {
    await supabase.from("PROJECT_STRUCTURE")
      .update({ CLOSED_BY_INVOICE_ID: b.docId })
      .in("ID", b.positionen.map((p) => p.STRUCTURE_ID)).eq("TENANT_ID", tenantId);
  }

  return { gebaut, idNachNummer };
}

/**
 * Zahlungen zu den gerade geschriebenen Belegen — ebenfalls gestapelt.
 *
 * Verteilt wird proportional zu den POSITIONEN des Belegs, nicht ueber die
 * Pauschal-Knoten des Projekts: die Zahlung gehoert zu dem, was berechnet
 * wurde. Die Rundungsdifferenz landet auf der betragsgroessten Position — bei
 * vielen kleinen Positionen faellt sie auf der ersten sonst auf.
 */
async function schreibeZahlungen(supabase, { tenantId, batchId, gebaut }) {
  const mitZahlung = gebaut.filter((b) => num(b.e.paid) > 0 && b.positionen.length);
  if (!mitZahlung.length) return { zahlungen: 0 };

  const kopfZeilen = mitZahlung.map((b) => {
    const netto = fmt2(b.e.paid);
    const satz = num(b.row.VAT_PERCENT);
    return {
      [b.kind === "invoice" ? "INVOICE_ID" : "ADVANCE_INVOICE_ID"]: b.docId,
      PROJECT_ID: b.e.projectId, CONTRACT_ID: b.e.contractId,
      AMOUNT_PAYED_NET: netto,
      AMOUNT_PAYED_VAT: fmt2(netto * satz / 100),
      AMOUNT_PAYED_GROSS: fmt2(netto * (1 + satz / 100)),
      AMOUNT_PAYED_EXTRAS_NET: null,
      PAYMENT_DATE: b.e.paidDate || b.e.docDate,
      PURPOSE_OF_PAYMENT: `Zahlung zu ${b.e.docNumber} (Import)`,
      TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
    };
  });

  const ids = await einfuegen(supabase, "PAYMENT", kopfZeilen, "ID", "Zahlungen schreiben", batchId, "Zahlungen");

  const strukturZeilen = [];
  mitZahlung.forEach((b, i) => {
    const paymentId = ids[i]?.ID;
    const gesamt = b.positionen.reduce((a, p) => a + num(p.AMOUNT_NET) + num(p.AMOUNT_EXTRAS_NET), 0);
    const netto = fmt2(b.e.paid);
    const anteile = b.positionen.map((p) => {
      const teil = num(p.AMOUNT_NET) + num(p.AMOUNT_EXTRAS_NET);
      return fmt2(gesamt !== 0 ? netto * teil / gesamt : netto / b.positionen.length);
    });
    const rest = fmt2(netto - anteile.reduce((a, x) => a + x, 0));
    if (rest !== 0) {
      let groesste = 0;
      for (let k = 1; k < anteile.length; k++) if (Math.abs(anteile[k]) > Math.abs(anteile[groesste])) groesste = k;
      anteile[groesste] = fmt2(anteile[groesste] + rest);
    }
    b.positionen.forEach((p, k) => strukturZeilen.push({
      PAYMENT_ID: paymentId,
      [b.kind === "invoice" ? "INVOICE_ID" : "ADVANCE_INVOICE_ID"]: b.docId,
      STRUCTURE_ID: p.STRUCTURE_ID,
      AMOUNT_PAYED_NET: anteile[k], AMOUNT_PAYED_EXTRAS_NET: 0,
      TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
    }));
  });

  await einfuegen(supabase, "PAYMENT_STRUCTURE", strukturZeilen, null, "Zahlungspositionen schreiben", batchId, "Zahlungen");
  return { zahlungen: kopfZeilen.length };
}

/**
 * Die Aggregate EINMAL am Ende setzen — aus den Rohzeilen, nicht fortgeschrieben.
 *
 * Quelle ist recomputeBilledByStructure, also dieselbe Rechnung, mit der sich
 * die Anwendung selbst heilt. Weicht der Import davon ab, ist das ein Fehler
 * des Imports — und dann will man es wissen, nicht ueberschreiben. Deshalb ist
 * ihr ok:false hier ein Abbruch und kein stiller Rueckfall auf den Cache.
 */
async function setzeAggregate(supabase, { tenantId, gebaut }) {
  const contractIds = [...new Set(gebaut.map((b) => b.e.contractId).filter((x) => x != null))];
  const projectIds = [...new Set(gebaut.map((b) => b.e.projectId).filter((x) => x != null))];

  const r = await recomputeBilledByStructure(supabase, { contractIds });
  if (!r.ok) {
    throw { status: 500, message: "Die Summen konnten nicht nachgerechnet werden — die Belege stehen, die Aggregate nicht. Stapel zurücksetzen und erneut versuchen." };
  }

  const knotenIds = new Set([...r.invoiced.keys(), ...r.partial.keys()]);

  // ACHTUNG, zwei verschiedene Zahlen:
  //
  //   PROJECT_STRUCTURE bekommt den ABSOLUTEN Stand aus der Rueckrechnung —
  //   die Spalte ist ein Zwischenspeicher und soll danach stimmen, egal was
  //   vorher drinstand.
  //
  //   PROJECT_PROGRESS bekommt den ZUWACHS dieses Stapels. insertProgressSnapshot
  //   fuehrt INVOICED, ADVANCE_INVOICED und PAYED als kumulierte Spalten und
  //   ADDIERT den uebergebenen Wert auf den letzten Schnappschuss. Ein
  //   absoluter Wert wuerde dort doppelt zaehlen. Genau so uebergibt es auch
  //   bookInvoice: den Betrag DIESES Belegs, nicht den Gesamtstand.
  const zuwachs = new Map();
  const addiere = (sid, feld, betrag) => {
    const k = String(sid);
    if (!zuwachs.has(k)) zuwachs.set(k, { INVOICED: 0, ADVANCE_INVOICED: 0 });
    zuwachs.get(k)[feld] = fmt2(zuwachs.get(k)[feld] + num(betrag));
  };
  for (const b of gebaut) {
    const feld = b.kind === "invoice" ? "INVOICED" : "ADVANCE_INVOICED";
    for (const p of b.positionen) addiere(p.STRUCTURE_ID, feld, num(p.AMOUNT_NET) + num(p.AMOUNT_EXTRAS_NET));
  }

  // Die Rueckrechnung liefert ihre Schluessel als Text. Gefiltert werden muss
  // aber mit der ORIGINALKENNUNG — eine in Text verwandelte Kennung trifft in
  // einem strikten Vergleich ihre Zeile nicht mehr. PostgREST buegelt das aus,
  // ein Test nicht.
  const echteId = new Map();
  for (const b of gebaut) for (const p of b.positionen) echteId.set(String(p.STRUCTURE_ID), p.STRUCTURE_ID);

  const snapshots = [];
  for (const sid of knotenIds) {
    const id = echteId.get(String(sid)) ?? sid;
    const invoiced = fmt2(r.invoiced.get(sid) || 0);
    const partial = fmt2(r.partial.get(sid) || 0);
    await supabase.from("PROJECT_STRUCTURE")
      .update({ INVOICED: invoiced, ADVANCE_INVOICED: partial })
      .eq("ID", id).eq("TENANT_ID", tenantId);

    const d = zuwachs.get(String(sid));
    if (d) snapshots.push({ TENANT_ID: tenantId, STRUCTURE_ID: id, INVOICED: d.INVOICED, ADVANCE_INVOICED: d.ADVANCE_INVOICED });
  }

  // Projektebene aus den BELEGSUMMEN, nicht aus den Positionen — sonst zaehlt
  // man die Nebenkosten anders als bookInvoice es tut.
  for (const pid of projectIds) {
    const [inv, adv, zahl] = await Promise.all([
      supabase.from("INVOICE").select("TOTAL_AMOUNT_NET").eq("PROJECT_ID", pid).eq("TENANT_ID", tenantId).in("STATUS_ID", [2, 3]),
      supabase.from("ADVANCE_INVOICE").select("TOTAL_AMOUNT_NET").eq("PROJECT_ID", pid).eq("TENANT_ID", tenantId).in("STATUS_ID", [2, 3]),
      supabase.from("PAYMENT").select("AMOUNT_PAYED_NET").eq("PROJECT_ID", pid).eq("TENANT_ID", tenantId),
    ]);
    await supabase.from("PROJECT").update({
      INVOICED:         fmt2((inv.data || []).reduce((a, x) => a + num(x.TOTAL_AMOUNT_NET), 0)),
      ADVANCE_INVOICED: fmt2((adv.data || []).reduce((a, x) => a + num(x.TOTAL_AMOUNT_NET), 0)),
      PAYED:            fmt2((zahl.data || []).reduce((a, x) => a + num(x.AMOUNT_PAYED_NET), 0)),
    }).eq("ID", pid).eq("TENANT_ID", tenantId);
  }

  // Bezahlt je Knoten aus PAYMENT_STRUCTURE — dieselbe Rechnung wie in
  // services/paymentAggregates.js, nur gestapelt.
  const bezahltJeKnoten = new Map();
  for (const teil of stapeln([...knotenIds], IN_CHUNK)) {
    const { data } = await supabase.from("PAYMENT_STRUCTURE")
      .select("STRUCTURE_ID, AMOUNT_PAYED_NET").in("STRUCTURE_ID", teil);
    for (const z of data || []) {
      const k = String(z.STRUCTURE_ID);
      bezahltJeKnoten.set(k, fmt2((bezahltJeKnoten.get(k) || 0) + num(z.AMOUNT_PAYED_NET)));
    }
  }
  // Auch hier: absolut in die Struktur, Zuwachs in den Schnappschuss.
  const bezahltZuwachs = new Map();
  for (const b of gebaut) {
    if (!(num(b.e.paid) > 0) || !b.positionen.length) continue;
    const gesamt = b.positionen.reduce((a, p) => a + num(p.AMOUNT_NET) + num(p.AMOUNT_EXTRAS_NET), 0);
    for (const p of b.positionen) {
      const teil = num(p.AMOUNT_NET) + num(p.AMOUNT_EXTRAS_NET);
      const anteil = fmt2(gesamt !== 0 ? num(b.e.paid) * teil / gesamt : num(b.e.paid) / b.positionen.length);
      const k = String(p.STRUCTURE_ID);
      bezahltZuwachs.set(k, fmt2((bezahltZuwachs.get(k) || 0) + anteil));
    }
  }
  for (const [sid, betrag] of bezahltJeKnoten) {
    await supabase.from("PROJECT_STRUCTURE").update({ PAYED: betrag })
      .eq("ID", echteId.get(String(sid)) ?? sid).eq("TENANT_ID", tenantId);
  }
  for (const s of snapshots) {
    const d = bezahltZuwachs.get(String(s.STRUCTURE_ID));
    if (d) s.PAYED = d;
  }

  // EIN Schnappschuss je Knoten mit dem Endstand. Einer je Beleg waere keine
  // Historie: PROJECT_PROGRESS hat kein Stichtagsfeld, die Zeitachse ist
  // created_at — alle Zeilen eines Laufs traegen denselben Zeitstempel, und
  // gelesen wird ohnehin nur die jeweils letzte.
  if (snapshots.length) await insertProgressSnapshot(supabase, snapshots);

  return { knoten: snapshots.length, projekte: projectIds.length };
}

// ---------------------------------------------------------------------------
// Ruecksetzen
// ---------------------------------------------------------------------------

const geld = (n) => `${fmt2(n).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`;

/**
 * Was spricht dagegen, diesen Stapel zurueckzunehmen?
 *
 * Geprueft wird der BEZUG AUF DIE BELEGE DES STAPELS, nicht die Koexistenz am
 * selben Projekt. Der alte Blocker ("am Projekt haengt irgendein fremder
 * gebuchter Beleg") ist bei mehrjaehriger Historie nach der ersten echten
 * Rechnung dauerhaft aktiv — der Rollback waere damit genau dann tot, wenn man
 * ihn braucht. Noetig war er nur, weil die Aggregate gemindert statt neu
 * gerechnet wurden; die Neurechnung zaehlt Fremdbelege von selbst mit.
 *
 * Jede Meldung nennt Belegnummer und Betrag: "auf RE-2024-0117 (12.400 €) ist
 * eine Zahlung eingegangen" ist handlungsfaehig, "3 Rechnung(en)" nicht.
 */
async function rollbackBlocker(supabase, { tenantId, batchId, belege }) {
  const invIds = belege.filter((b) => b.kind === "invoice").map((b) => b.id);
  const advIds = belege.filter((b) => b.kind === "advance").map((b) => b.id);
  const nummerVon = new Map(belege.map((b) => [`${b.kind}|${b.id}`, b]));
  const gruende = [];

  // 1. Echte Zahlung auf einem importierten Beleg — Geld, das NACH dem Import
  //    eingegangen ist. Loeschen waere Datenverlust.
  for (const [spalte, ids, kind] of [["INVOICE_ID", invIds, "invoice"], ["ADVANCE_INVOICE_ID", advIds, "advance"]]) {
    for (const teil of stapeln(ids, IN_CHUNK)) {
      if (!teil.length) continue;
      const { data } = await supabase.from("PAYMENT")
        .select(`ID, ${spalte}, AMOUNT_PAYED_NET, PAYMENT_DATE, IMPORT_BATCH_ID`)
        .eq("TENANT_ID", tenantId).in(spalte, teil);
      for (const z of data || []) {
        if (z.IMPORT_BATCH_ID === batchId) continue;   // aus diesem Stapel: geht mit
        const b = nummerVon.get(`${kind}|${z[spalte]}`);
        gruende.push(`auf ${b?.nummer ?? "einem Beleg"} (${geld(b?.betrag)}) ist am ${z.PAYMENT_DATE || "unbekannt"} eine Zahlung über ${geld(z.AMOUNT_PAYED_NET)} eingegangen`);
      }
    }
  }

  // 2. Mahnung — sie bezieht sich auf eine Forderung, die es danach nicht mehr
  //    gaebe.
  for (const [spalte, ids, kind] of [["INVOICE_ID", invIds, "invoice"], ["PP_ID", advIds, "advance"]]) {
    for (const teil of stapeln(ids, IN_CHUNK)) {
      if (!teil.length) continue;
      const { data, error } = await supabase.from("MAHNUNG")
        .select(`ID, ${spalte}`).eq("TENANT_ID", tenantId).in(spalte, teil);
      if (error) continue;   // Tabelle fehlt im Mandanten: kein Hindernis
      for (const z of data || []) {
        const b = nummerVon.get(`${kind}|${z[spalte]}`);
        gruende.push(`zu ${b?.nummer ?? "einem Beleg"} (${geld(b?.betrag)}) wurde bereits gemahnt`);
      }
    }
  }

  // 3. Ein Storno von ausserhalb, der auf einen Beleg dieses Stapels zeigt —
  //    er haenge sonst in der Luft.
  for (const [tabelle, spalte, ids, kind] of [
    ["INVOICE", "CANCELS_INVOICE_ID", invIds, "invoice"],
    ["ADVANCE_INVOICE", "CANCELS_ADVANCE_INVOICE_ID", advIds, "advance"],
  ]) {
    for (const teil of stapeln(ids, IN_CHUNK)) {
      if (!teil.length) continue;
      const { data } = await supabase.from(tabelle)
        .select(`ID, ${spalte}, IMPORT_BATCH_ID`).eq("TENANT_ID", tenantId).in(spalte, teil);
      for (const z of data || []) {
        if (z.IMPORT_BATCH_ID === batchId) continue;
        const b = nummerVon.get(`${kind}|${z[spalte]}`);
        gruende.push(`${b?.nummer ?? "ein Beleg"} (${geld(b?.betrag)}) wurde inzwischen storniert`);
      }
    }
  }

  // 4. Eine Schlussrechnung von ausserhalb hat einen importierten Abschlag
  //    angerechnet.
  for (const teil of stapeln(advIds, IN_CHUNK)) {
    if (!teil.length) continue;
    const { data } = await supabase.from("INVOICE_DEDUCTION")
      .select("INVOICE_ID, ADVANCE_INVOICE_ID, IMPORT_BATCH_ID").eq("TENANT_ID", tenantId).in("ADVANCE_INVOICE_ID", teil);
    for (const z of data || []) {
      if (z.IMPORT_BATCH_ID === batchId) continue;
      const b = nummerVon.get(`advance|${z.ADVANCE_INVOICE_ID}`);
      gruende.push(`der Abschlag ${b?.nummer ?? ""} (${geld(b?.betrag)}) ist von einer Schlussrechnung angerechnet`);
    }
  }

  return gruende;
}

/**
 * Den Stapel zuruecknehmen.
 *
 * Die Aggregate werden NEU GERECHNET, nicht gemindert. Mindern traegt die
 * unausgesprochene Annahme, dass zwischen Import und Ruecknahme niemand sonst
 * diese Spalte angefasst hat — bei einem Onboarding-Import, der Wochen im
 * System steht, traegt sie nicht. Und wenn sie bricht, bricht sie still.
 */
async function rollbackBelegImport({ supabase, tenantId, batchId }) {
  // ── Bestand des Stapels einsammeln ──────────────────────────────────────
  const belege = [];
  for (const [tabelle, kind, nrSpalte] of [
    ["ADVANCE_INVOICE", "advance", "ADVANCE_INVOICE_NUMBER"],
    ["INVOICE", "invoice", "INVOICE_NUMBER"],
  ]) {
    const { data } = await supabase.from(tabelle)
      .select(`ID, ${nrSpalte}, PROJECT_ID, CONTRACT_ID, TOTAL_AMOUNT_NET, CANCELS_INVOICE_ID, CANCELS_ADVANCE_INVOICE_ID`)
      .eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
    for (const r of data || []) {
      belege.push({
        kind, id: r.ID, nummer: r[nrSpalte], projectId: r.PROJECT_ID, contractId: r.CONTRACT_ID,
        betrag: num(r.TOTAL_AMOUNT_NET),
        storniert: r.CANCELS_INVOICE_ID ?? r.CANCELS_ADVANCE_INVOICE_ID ?? null,
      });
    }
  }
  if (!belege.length) return { deleted: 0 };

  const gruende = await rollbackBlocker(supabase, { tenantId, batchId, belege });
  if (gruende.length) {
    const zeigen = gruende.slice(0, 5);
    const rest = gruende.length - zeigen.length;
    throw {
      status: 409,
      message: `Zurücksetzen nicht möglich — ${zeigen.join("; ")}${rest > 0 ? ` (und ${rest} weitere)` : ""}.`,
    };
  }

  // ── Zuwachs dieses Stapels je Knoten merken, VOR dem Loeschen ───────────
  // Danach ist er nicht mehr ermittelbar, und ohne ihn traegt der letzte
  // Fortschritts-Schnappschuss die importierten Betraege fuer immer weiter.
  const zuwachs = new Map();
  const merken = async (tabelle, spalte, feld) => {
    const { data } = await supabase.from(tabelle)
      .select(`STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET, AMOUNT_PAYED_NET`)
      .eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
    for (const z of data || []) {
      const k = String(z.STRUCTURE_ID);
      if (!zuwachs.has(k)) zuwachs.set(k, { id: z.STRUCTURE_ID, INVOICED: 0, ADVANCE_INVOICED: 0, PAYED: 0 });
      const w = zuwachs.get(k);
      w[feld] = fmt2(w[feld] + (feld === "PAYED"
        ? num(z.AMOUNT_PAYED_NET)
        : num(z.AMOUNT_NET) + num(z.AMOUNT_EXTRAS_NET)));
    }
  };
  await merken("INVOICE_STRUCTURE", "INVOICE_ID", "INVOICED");
  await merken("ADVANCE_INVOICE_STRUCTURE", "ADVANCE_INVOICE_ID", "ADVANCE_INVOICED");
  await merken("PAYMENT_STRUCTURE", "PAYMENT_ID", "PAYED");

  // ── Referenzen loesen ───────────────────────────────────────────────────
  // Sie tragen selbst keine Stapel-Kennung, zeigen aber auf Belege des
  // Stapels — ueber deren Kennungen sind sie trotzdem auffindbar.
  const invIds = belege.filter((b) => b.kind === "invoice").map((b) => b.id);
  for (const teil of stapeln(invIds, IN_CHUNK)) {
    if (!teil.length) continue;
    await supabase.from("PROJECT_STRUCTURE").update({ CLOSED_BY_INVOICE_ID: null }).in("CLOSED_BY_INVOICE_ID", teil).eq("TENANT_ID", tenantId);
    await supabase.from("ADVANCE_INVOICE").update({ SE_RELEASED_BY_INVOICE_ID: null }).in("SE_RELEASED_BY_INVOICE_ID", teil).eq("TENANT_ID", tenantId);
  }

  // Ein Original, das ein Storno DIESES Stapels auf Status 3 gesetzt hat, muss
  // zurueck auf 2 — sonst bleibt es fuer immer als storniert stehen, obwohl
  // sein Storno verschwindet.
  for (const b of belege.filter((x) => x.storniert != null)) {
    const tabelle = b.kind === "invoice" ? "INVOICE" : "ADVANCE_INVOICE";
    await supabase.from(tabelle).update({ STATUS_ID: 2, CANCELLATION_DATE: null })
      .eq("ID", b.storniert).eq("TENANT_ID", tenantId);
  }

  // ── Loeschen, in Fremdschluessel-Reihenfolge ────────────────────────────
  let deleted = 0;
  for (const tabelle of [
    "PAYMENT_STRUCTURE", "PAYMENT", "SE_RELEASE", "INVOICE_DEDUCTION",
    "INVOICE_STRUCTURE", "ADVANCE_INVOICE_STRUCTURE",
    "INVOICE", "ADVANCE_INVOICE", "PROJECT_PROGRESS",
  ]) {
    const { data, error } = await supabase.from(tabelle).delete()
      .eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId).select("ID");
    if (error) {
      if (/relation .* does not exist|column .* does not exist/i.test(error.message || "")) continue;
      throw { status: 500, message: `${tabelle} konnte nicht geleert werden: ${error.message}` };
    }
    deleted += (data || []).length;
  }

  // ── Aggregate NEU rechnen ───────────────────────────────────────────────
  const contractIds = [...new Set(belege.map((b) => b.contractId).filter((x) => x != null))];
  const projectIds = [...new Set(belege.map((b) => b.projectId).filter((x) => x != null))];

  const r = await recomputeBilledByStructure(supabase, { contractIds });
  if (!r.ok) {
    throw { status: 500, message: "Die Belege sind entfernt, die Summen konnten aber nicht nachgerechnet werden. Bitte den Support verständigen." };
  }
  for (const [k, w] of zuwachs) {
    await supabase.from("PROJECT_STRUCTURE").update({
      INVOICED:         fmt2(r.invoiced.get(k) || 0),
      ADVANCE_INVOICED: fmt2(r.partial.get(k) || 0),
    }).eq("ID", w.id).eq("TENANT_ID", tenantId);
  }

  // Bezahlt je Knoten aus dem, was noch steht.
  for (const [k, w] of zuwachs) {
    const { data } = await supabase.from("PAYMENT_STRUCTURE").select("AMOUNT_PAYED_NET").eq("STRUCTURE_ID", w.id);
    await supabase.from("PROJECT_STRUCTURE")
      .update({ PAYED: fmt2((data || []).reduce((a, z) => a + num(z.AMOUNT_PAYED_NET), 0)) })
      .eq("ID", w.id).eq("TENANT_ID", tenantId);
  }

  for (const pid of projectIds) {
    const [inv, adv, zahl] = await Promise.all([
      supabase.from("INVOICE").select("TOTAL_AMOUNT_NET").eq("PROJECT_ID", pid).eq("TENANT_ID", tenantId).in("STATUS_ID", [2, 3]),
      supabase.from("ADVANCE_INVOICE").select("TOTAL_AMOUNT_NET").eq("PROJECT_ID", pid).eq("TENANT_ID", tenantId).in("STATUS_ID", [2, 3]),
      supabase.from("PAYMENT").select("AMOUNT_PAYED_NET").eq("PROJECT_ID", pid).eq("TENANT_ID", tenantId),
    ]);
    await supabase.from("PROJECT").update({
      INVOICED:         fmt2((inv.data || []).reduce((a, x) => a + num(x.TOTAL_AMOUNT_NET), 0)),
      ADVANCE_INVOICED: fmt2((adv.data || []).reduce((a, x) => a + num(x.TOTAL_AMOUNT_NET), 0)),
      PAYED:            fmt2((zahl.data || []).reduce((a, x) => a + num(x.AMOUNT_PAYED_NET), 0)),
    }).eq("ID", pid).eq("TENANT_ID", tenantId);
  }

  // ── Gegen-Schnappschuss ─────────────────────────────────────────────────
  // Die Schnappschuesse des Stapels sind geloescht, aber jeder SPAETERE traegt
  // die importierten Betraege bereits weitergetragen in sich. Ohne diese
  // Gegenbuchung bliebe die Zeitreihe dauerhaft zu hoch.
  const gegen = [...zuwachs.values()].map((w) => ({
    TENANT_ID: tenantId, STRUCTURE_ID: w.id,
    INVOICED: fmt2(-w.INVOICED), ADVANCE_INVOICED: fmt2(-w.ADVANCE_INVOICED), PAYED: fmt2(-w.PAYED),
  }));
  if (gegen.length) {
    const { error } = (await insertProgressSnapshot(supabase, gegen)) || {};
    // Ein Fehler hier darf den Rollback nicht kippen — die Belege sind weg.
    // Er gehoert aber ins Ergebnis und nicht ins Protokoll: sonst ist die
    // Zeitreihe still falsch. Genau das war der Befund am alten Weg.
    if (error) return { deleted, hinweis: `Die Zeitreihe konnte nicht bereinigt werden: ${error.message}` };
  }

  return { deleted, knoten: zuwachs.size, projekte: projectIds.length };
}

module.exports = {
  einfuegen, ladeStammdaten, vatIdZuSatz, schreibeBelege, schreibeZahlungen, setzeAggregate,
  rollbackBelegImport, rollbackBlocker,
  bumpNumberRanges,
  CHUNK, IN_CHUNK, fmt2, num, stapeln,
};

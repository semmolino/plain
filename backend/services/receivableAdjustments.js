"use strict";

/**
 * Rest ausbuchen (Forderungsminderung) — Migration 0177.
 *
 * Zahlt der Kunde weniger und das Buero akzeptiert das, wird der Rest hier
 * ausgebucht statt storniert. Eine reine Entgeltminderung braucht keine
 * Rechnungsberichtigung (§ 17 UStG; BMF 15.10.2025, Rn. 51a) — festgehalten
 * wird nur, was fuer den Nachweis noetig ist: Datum, Betrag, USt-Anteil, Grund.
 *
 * Zwei Arten:
 *   endgueltig          das Honorar ist gemindert (Nachlass, Kulanz, Ausfall,
 *                       Skonto). Das Abgerechnete bleibt, wie es ist.
 *   wieder abrechenbar  nur bei „Kürzung" auf Abschlags- und Einzelrechnungen:
 *                       der Betrag gilt als nicht abgerechnet. Die naechste
 *                       Rechnung schlaegt ihn wieder vor, Reporting und
 *                       Teilfertige Leistungen sehen ihn als unfertig. Dafuer
 *                       werden dieselben Summen fortgeschrieben wie bei einem
 *                       Storno (PROJECT/PROJECT_STRUCTURE.INVOICED bzw.
 *                       ADVANCE_INVOICED und ein PROJECT_PROGRESS-Snapshot).
 *
 * Verteilt wird ein wieder abrechenbarer Betrag nur auf Leistungen nach
 * Honorar (BILLING_TYPE_ID = 1). Stunden haengen an Buchungen, und eine
 * abgerechnete Buchung wird nie erneut vorgeschlagen — ein Anteil darauf
 * waere einfach verschwunden.
 */

const { CLAIM_COLS, claimOf, openAmountsFor, effectiveVatPercent, round2, toNum, TOL } = require("./openAmount");
const { insertProgressSnapshot } = require("./projectProgress");

const REASONS = {
  skonto:   "Skonto",
  kuerzung: "Kürzung / Mängelrüge",
  kulanz:   "Kulanz / Nachlass",
  ausfall:  "Forderungsausfall",
  rundung:  "Rundungsdifferenz",
};

const META = {
  INVOICE: {
    table: "INVOICE", idCol: "INVOICE_ID", structTable: "INVOICE_STRUCTURE", cachedCol: "INVOICED",
    cols: `ID, STATUS_ID, PROJECT_ID, CONTRACT_ID, INVOICE_TYPE, CANCELS_INVOICE_ID, ${CLAIM_COLS.INVOICE}`,
    label: "Rechnung",
  },
  ADVANCE_INVOICE: {
    table: "ADVANCE_INVOICE", idCol: "ADVANCE_INVOICE_ID", structTable: "ADVANCE_INVOICE_STRUCTURE", cachedCol: "ADVANCE_INVOICED",
    cols: `ID, STATUS_ID, PROJECT_ID, CONTRACT_ID, CANCELS_ADVANCE_INVOICE_ID, ${CLAIM_COLS.ADVANCE_INVOICE}`,
    label: "Abschlagsrechnung",
  },
};

const ADJ_COLS = "ID, INVOICE_ID, ADVANCE_INVOICE_ID, ADJUSTMENT_DATE, AMOUNT_GROSS, AMOUNT_NET, AMOUNT_VAT, REASON, REBILLABLE, COMMENT, CREATED_BY_EMPLOYEE_ID, created_at";

function fail(status, message) {
  return { status, message };
}

function kindOf(body) {
  const inv = body?.invoice_id ?? null;
  const adv = body?.advance_invoice_id ?? null;
  if (!!inv === !!adv) throw fail(400, "Bitte entweder eine Rechnung ODER eine Abschlagsrechnung angeben.");
  const id = parseInt(String(inv ?? adv), 10);
  if (!Number.isFinite(id) || id <= 0) throw fail(400, "Ungültige Belegnummer.");
  return { kind: inv ? "INVOICE" : "ADVANCE_INVOICE", id };
}

async function loadDoc(supabase, { kind, id, tenantId }) {
  const m = META[kind];
  const { data, error } = await supabase.from(m.table).select(m.cols).eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail(404, `${m.label} nicht gefunden.`);
  return data;
}

/** Storno-Belege, stornierte Originale, Entwuerfe und Gutschriften haben keinen ausbuchbaren Rest. */
function assertAdjustable(doc, kind) {
  if (Number(doc.STATUS_ID) !== 2) throw fail(400, "Ausbuchen geht nur bei gebuchten, nicht stornierten Belegen.");
  const isStorno = kind === "INVOICE"
    ? (doc.INVOICE_TYPE === "stornorechnung" || doc.CANCELS_INVOICE_ID != null)
    : doc.CANCELS_ADVANCE_INVOICE_ID != null;
  if (isStorno) throw fail(400, "Bei einer Stornorechnung gibt es keinen Rest auszubuchen.");
  if (kind === "INVOICE" && doc.INVOICE_TYPE === "gutschrift") throw fail(400, "Bei einer Gutschrift gibt es keinen Rest auszubuchen.");
}

/** Darf der Rest dieses Belegs „wieder abrechenbar" sein? Nicht nach einer Schlussrechnung. */
function rebillableAllowed(doc, kind) {
  if (kind === "ADVANCE_INVOICE") return true;
  const t = String(doc.INVOICE_TYPE || "rechnung");
  return t === "rechnung";
}

// ── Verteilung auf die Strukturelemente ─────────────────────────────────────

/**
 * Verteilt den Nettobetrag einer Minderung auf die Honorar-Zeilen eines Belegs.
 *
 * Die Strukturzeilen tragen den Betrag VOR Nachlass I/II, die Minderung ist
 * auf den Betrag NACH Nachlass bezogen — deshalb wird zurueckgerechnet. Sonst
 * bekaeme der Kunde auf den wieder abrechenbaren Teil den Nachlass zweimal.
 *
 * @param {number} amountNet
 * @param {{net:number, discounts:number}} claim
 * @param {{STRUCTURE_ID:number, AMOUNT_NET:number, AMOUNT_EXTRAS_NET:number}[]} rows  nur Honorar-Zeilen
 * @returns {{STRUCTURE_ID:number, net:number, extras:number, total:number}[]}
 */
function splitRebillable(amountNet, claim, rows) {
  const usable = (rows || [])
    .map(r => ({ sid: r.STRUCTURE_ID, net: toNum(r.AMOUNT_NET), extras: toNum(r.AMOUNT_EXTRAS_NET) }))
    .map(r => ({ ...r, total: round2(r.net + r.extras) }))
    .filter(r => r.total > 0);
  const sum = round2(usable.reduce((s, r) => s + r.total, 0));
  if (usable.length === 0 || sum <= 0) return [];

  const afterDiscount = round2(toNum(claim.net) - toNum(claim.discounts));
  const scale = toNum(claim.net) > 0 && afterDiscount > 0 ? toNum(claim.net) / afterDiscount : 1;
  const target = round2(toNum(amountNet) * scale);

  let running = 0;
  return usable.map((r, i) => {
    const total = i === usable.length - 1 ? round2(target - running) : round2(target * r.total / sum);
    running = round2(running + total);
    const net = r.total > 0 ? round2(total * r.net / r.total) : 0;
    return { STRUCTURE_ID: r.sid, net, extras: round2(total - net), total };
  });
}

/** Honorar-Zeilen (BT 1) je Beleg. */
async function honorarRowsByDoc(supabase, kind, docIds) {
  const m = META[kind];
  const out = new Map();
  const ids = Array.from(new Set((docIds || []).filter(Boolean)));
  if (ids.length === 0) return out;
  const { data: rows, error } = await supabase.from(m.structTable)
    .select(`${m.idCol}, STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET`).in(m.idCol, ids);
  if (error) throw new Error(error.message);
  const sids = Array.from(new Set((rows || []).map(r => r.STRUCTURE_ID)));
  const bt1 = new Set();
  if (sids.length > 0) {
    const { data: ps, error: psErr } = await supabase.from("PROJECT_STRUCTURE").select("ID, BILLING_TYPE_ID").in("ID", sids);
    if (psErr) throw new Error(psErr.message);
    for (const p of ps || []) if (Number(p.BILLING_TYPE_ID) === 1) bt1.add(String(p.ID));
  }
  for (const r of rows || []) {
    if (!bt1.has(String(r.STRUCTURE_ID))) continue;
    const k = String(r[m.idCol]);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}

function tableMissing(err) {
  const msg = String(err?.message || "");
  return /does not exist|schema cache|Could not find the table/i.test(msg) || err?.code === "42P01" || err?.code === "PGRST205";
}

/**
 * Wieder abrechenbare Anteile je Strukturelement, fuer die Rechnungsvorschlaege.
 * Nur Minderungen auf gebuchten Belegen zaehlen — beim Storno werden sie
 * ohnehin entfernt (removeForCancelledDoc).
 *
 * @returns {Promise<Map<string, {net:number, extras:number}>>}
 */
async function rebillableByStructure(supabase, { invoiceIds = [], advanceInvoiceIds = [] }) {
  const out = new Map();
  const add = (sid, net, extras) => {
    const k = String(sid);
    const cur = out.get(k) || { net: 0, extras: 0 };
    out.set(k, { net: round2(cur.net + net), extras: round2(cur.extras + extras) });
  };

  for (const [kind, ids] of [["INVOICE", invoiceIds], ["ADVANCE_INVOICE", advanceInvoiceIds]]) {
    const uniq = Array.from(new Set((ids || []).filter(Boolean)));
    if (uniq.length === 0) continue;
    const m = META[kind];
    const { data: adjs, error } = await supabase.from("RECEIVABLE_ADJUSTMENT")
      .select(`${m.idCol}, AMOUNT_NET`).eq("REBILLABLE", true).in(m.idCol, uniq);
    if (error) {
      if (tableMissing(error)) return out;
      throw new Error(error.message);
    }
    if (!adjs || adjs.length === 0) continue;

    const docIds = Array.from(new Set(adjs.map(a => a[m.idCol])));
    const { data: docs, error: dErr } = await supabase.from(m.table).select(`ID, STATUS_ID, ${CLAIM_COLS[kind]}`).in("ID", docIds);
    if (dErr) throw new Error(dErr.message);
    const docById = new Map((docs || []).map(d => [String(d.ID), d]));
    const rowsByDoc = await honorarRowsByDoc(supabase, kind, docIds);

    for (const a of adjs) {
      const doc = docById.get(String(a[m.idCol]));
      if (!doc || Number(doc.STATUS_ID) !== 2) continue;
      for (const part of splitRebillable(a.AMOUNT_NET, claimOf(doc, kind), rowsByDoc.get(String(doc.ID)) || [])) {
        add(part.STRUCTURE_ID, part.net, part.extras);
      }
    }
  }
  return out;
}

/**
 * Schreibt die zwischengespeicherten Summen fort, wie Buchen und Storno es tun.
 * sign = -1 beim Ausbuchen (weniger abgerechnet), +1 beim Zuruecknehmen.
 */
async function applyCacheDelta(supabase, { kind, doc, parts, sign, tenantId }) {
  const m = META[kind];
  const total = round2(parts.reduce((s, p) => s + p.total, 0));
  if (Math.abs(total) < TOL) return;

  const { data: proj } = await supabase.from("PROJECT").select(`ID, ${m.cachedCol}`)
    .eq("ID", doc.PROJECT_ID).eq("TENANT_ID", tenantId).maybeSingle();
  if (proj) {
    await supabase.from("PROJECT").update({ [m.cachedCol]: round2(toNum(proj[m.cachedCol]) + sign * total) })
      .eq("ID", doc.PROJECT_ID).eq("TENANT_ID", tenantId);
  }

  const sids = parts.map(p => p.STRUCTURE_ID);
  const { data: ps } = await supabase.from("PROJECT_STRUCTURE").select(`ID, ${m.cachedCol}`).in("ID", sids).eq("TENANT_ID", tenantId);
  const current = new Map((ps || []).map(p => [String(p.ID), toNum(p[m.cachedCol])]));
  // update statt upsert: der INSERT-Teil eines upsert scheitert an den
  // Pflichtspalten, und geaendert wird hier nur eine vorhandene Zeile.
  for (const p of parts) {
    if (!current.has(String(p.STRUCTURE_ID))) continue;
    await supabase.from("PROJECT_STRUCTURE")
      .update({ [m.cachedCol]: round2(current.get(String(p.STRUCTURE_ID)) + sign * p.total) })
      .eq("ID", p.STRUCTURE_ID).eq("TENANT_ID", tenantId);
  }

  const snap = parts.map(p => ({ TENANT_ID: tenantId, STRUCTURE_ID: p.STRUCTURE_ID, [m.cachedCol]: round2(sign * p.total) }));
  const res = await insertProgressSnapshot(supabase, snap);
  if (res?.error) console.error("[ADJUSTMENT][PROGRESS]", res.error.message);
}

async function partsFor(supabase, { kind, doc, amountNet }) {
  const rowsByDoc = await honorarRowsByDoc(supabase, kind, [doc.ID]);
  return splitRebillable(amountNet, claimOf(doc, kind), rowsByDoc.get(String(doc.ID)) || []);
}

// ── Oeffentliche Funktionen ────────────────────────────────────────────────

async function listAdjustments(supabase, { tenantId, query }) {
  const { kind, id } = kindOf(query);
  const m = META[kind];
  const { data, error } = await supabase.from("RECEIVABLE_ADJUSTMENT").select(ADJ_COLS)
    .eq("TENANT_ID", tenantId).eq(m.idCol, id).order("ADJUSTMENT_DATE", { ascending: true });
  if (error) {
    if (tableMissing(error)) return [];
    throw new Error(error.message);
  }
  return data || [];
}

async function createAdjustment(supabase, { tenantId, employeeId = null, body }) {
  const { kind, id } = kindOf(body);
  const doc = await loadDoc(supabase, { kind, id, tenantId });
  assertAdjustable(doc, kind);

  const open = (await openAmountsFor(supabase, { kind, docs: [doc], tenantId })).get(String(doc.ID));
  if (open.absorbedBy != null) {
    throw fail(400, "Diese Abschlagsrechnung ist in einer Schlussrechnung aufgegangen — ein Rest wird dort ausgebucht.");
  }

  const reason = String(body.reason || "").trim();
  if (!REASONS[reason]) throw fail(400, `Unbekannter Grund. Erlaubt: ${Object.values(REASONS).join(", ")}.`);

  const date = String(body.adjustment_date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, "Datum ist erforderlich (JJJJ-MM-TT).");

  const gross = round2(body.amount_gross);
  if (!(gross > 0)) throw fail(400, "Betrag (brutto) muss größer als 0 sein.");

  const rebillable = body.rebillable === true;
  if (rebillable && reason !== "kuerzung") {
    throw fail(400, "„Wieder abrechenbar“ gibt es nur beim Grund „Kürzung / Mängelrüge“ — die übrigen Gründe mindern das Honorar endgültig.");
  }
  if (rebillable && !rebillableAllowed(doc, kind)) {
    throw fail(400, "Nach einer Schluss- oder Teilschlussrechnung wird nichts mehr abgerechnet — bitte endgültig ausbuchen.");
  }

  if (gross > round2(open.open) + TOL) {
    throw fail(400, `Es sind nur noch ${open.open.toFixed(2).replace(".", ",")} € offen.`);
  }

  const vatPct = effectiveVatPercent(doc);
  const net = round2(gross / (1 + vatPct / 100));
  const vat = round2(gross - net);

  let parts = [];
  if (rebillable) {
    parts = await partsFor(supabase, { kind, doc, amountNet: net });
    if (parts.length === 0) {
      throw fail(400, "Dieser Beleg enthält keine Leistung nach Honorar. Abgerechnete Stunden werden nicht erneut vorgeschlagen — bitte endgültig ausbuchen oder stornieren.");
    }
  }

  const row = {
    TENANT_ID: tenantId,
    [META[kind].idCol]: id,
    ADJUSTMENT_DATE: date,
    AMOUNT_GROSS: gross,
    AMOUNT_NET: net,
    AMOUNT_VAT: vat,
    REASON: reason,
    REBILLABLE: rebillable,
    COMMENT: String(body.comment || "").trim() || null,
    CREATED_BY_EMPLOYEE_ID: employeeId ?? null,
  };
  const { data: created, error } = await supabase.from("RECEIVABLE_ADJUSTMENT").insert([row]).select(ADJ_COLS).single();
  if (error) {
    if (tableMissing(error)) throw fail(503, "Ausbuchen ist noch nicht eingerichtet (Migration 0177 fehlt).");
    throw new Error(error.message);
  }

  if (rebillable) await applyCacheDelta(supabase, { kind, doc, parts, sign: -1, tenantId });
  return created;
}

/** Zeitpunkt, zu dem ein Beleg gebucht wurde (PDF-Erzeugung), sonst angelegt — als ms. */
const bookedAt = d => {
  const t = Date.parse(d.DOCUMENT_RENDERED_AT || d.created_at || "");
  return Number.isFinite(t) ? t : null;
};

async function deleteAdjustment(supabase, { tenantId, id }) {
  const adjId = parseInt(String(id), 10);
  if (!Number.isFinite(adjId)) throw fail(400, "Ungültige ID.");
  const { data: adj, error } = await supabase.from("RECEIVABLE_ADJUSTMENT").select(ADJ_COLS)
    .eq("ID", adjId).eq("TENANT_ID", tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!adj) throw fail(404, "Ausgebuchter Rest nicht gefunden.");

  const kind = adj.INVOICE_ID ? "INVOICE" : "ADVANCE_INVOICE";
  const doc = await loadDoc(supabase, { kind, id: adj.INVOICE_ID ?? adj.ADVANCE_INVOICE_ID, tenantId });

  let parts = [];
  if (adj.REBILLABLE && Number(doc.STATUS_ID) === 2) {
    // Wurde der Betrag inzwischen wieder abgerechnet, stuende er nach dem
    // Zuruecknehmen zweimal in Rechnung.
    for (const t of ["INVOICE", "ADVANCE_INVOICE"]) {
      let q = supabase.from(t).select("ID, DOCUMENT_RENDERED_AT, created_at").eq("TENANT_ID", tenantId).eq("STATUS_ID", 2);
      q = doc.CONTRACT_ID ? q.eq("CONTRACT_ID", doc.CONTRACT_ID) : q.eq("PROJECT_ID", doc.PROJECT_ID);
      const { data: later } = await q;
      const since = Date.parse(adj.created_at || "");
      const hit = Number.isFinite(since) && (later || []).some(d =>
        !(t === kind && String(d.ID) === String(doc.ID)) && bookedAt(d) !== null && bookedAt(d) > since);
      if (hit) {
        throw fail(409, "Nach dem Ausbuchen wurde bereits wieder abgerechnet. Zurücknehmen würde den Betrag doppelt fordern — bitte über ein Storno der späteren Rechnung korrigieren.");
      }
    }
    parts = await partsFor(supabase, { kind, doc, amountNet: adj.AMOUNT_NET });
  }

  const { error: delErr } = await supabase.from("RECEIVABLE_ADJUSTMENT").delete().eq("ID", adjId).eq("TENANT_ID", tenantId);
  if (delErr) throw new Error(delErr.message);
  if (parts.length > 0) await applyCacheDelta(supabase, { kind, doc, parts, sign: +1, tenantId });
  return { ok: true };
}

/**
 * Beim Storno eines Belegs: seine ausgebuchten Reste gehen mit. Der Storno
 * nimmt den ganzen Beleg zurueck — ein wieder abrechenbarer Anteil, der die
 * Summen schon gemindert hat, wuerde sie sonst ein zweites Mal mindern.
 * Aufzurufen, solange das Original noch STATUS_ID = 2 hat.
 */
async function removeForCancelledDoc(supabase, { tenantId, kind, id }) {
  const m = META[kind];
  const { data: adjs, error } = await supabase.from("RECEIVABLE_ADJUSTMENT").select(ADJ_COLS)
    .eq("TENANT_ID", tenantId).eq(m.idCol, id);
  if (error) {
    if (tableMissing(error)) return 0;
    throw new Error(error.message);
  }
  if (!adjs || adjs.length === 0) return 0;

  const rebillable = adjs.filter(a => a.REBILLABLE);
  if (rebillable.length > 0) {
    const doc = await loadDoc(supabase, { kind, id, tenantId });
    const net = round2(rebillable.reduce((s, a) => s + toNum(a.AMOUNT_NET), 0));
    const parts = await partsFor(supabase, { kind, doc, amountNet: net });
    await applyCacheDelta(supabase, { kind, doc, parts, sign: +1, tenantId });
  }
  const { error: delErr } = await supabase.from("RECEIVABLE_ADJUSTMENT").delete().eq("TENANT_ID", tenantId).eq(m.idCol, id);
  if (delErr) throw new Error(delErr.message);
  return adjs.length;
}

module.exports = {
  REASONS,
  splitRebillable,
  rebillableByStructure,
  listAdjustments,
  createAdjustment,
  deleteAdjustment,
  removeForCancelledDoc,
};

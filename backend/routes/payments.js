const express = require("express");
const { insertProgressSnapshot } = require("../services/projectProgress");
const { requirePermission } = require("../middleware/permissions");
const adjustments = require("../services/receivableAdjustments");
const { removePayments } = require("../services/paymentRemoval");
const { openAmountsFor, withClaimCols, TOL } = require("../services/openAmount");

const eur = (n) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

// Payment routes
// Base path: /api/payments
module.exports = (supabase) => {
  const router = express.Router();

  // Phase 6: GET = payments.view, POST = create, PATCH = edit, DELETE = delete
  // (kein blanket .use, weil die Methoden sich unterscheiden)

  const toNum = (v) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n : NaN;
  };

  const round2 = (n) => {
    const x = typeof n === "number" ? n : toNum(n);
    if (!Number.isFinite(x)) return NaN;
    return Math.round((x + Number.EPSILON) * 100) / 100;
  };

  async function resolveVatPercent({ vat_percent, vat_id }) {
    if (vat_percent !== null && vat_percent !== undefined && vat_percent !== "") {
      const p = toNum(vat_percent);
      if (Number.isFinite(p)) return p;
    }
    if (!vat_id) return 0;
    const { data, error } = await supabase
      .from("VAT")
      .select("VAT_PERCENT")
      .eq("ID", vat_id)
      .maybeSingle();
    if (error) return 0;
    const p = toNum(data?.VAT_PERCENT);
    return Number.isFinite(p) ? p : 0;
  }

  /** Nummer der Schlussrechnung, in der die Abschlagsrechnung aufgegangen ist — oder null. */
  async function absorbedBy(advanceInvoiceId, tenantId) {
    const { data, error } = await supabase
      .from("ADVANCE_INVOICE")
      .select("ABSORBED_BY_INVOICE_ID")
      .eq("ID", advanceInvoiceId)
      .eq("TENANT_ID", tenantId)
      .maybeSingle();
    if (error || !data?.ABSORBED_BY_INVOICE_ID) return null;   // Spalte fehlt (vor 0178) → nicht gesperrt
    const { data: inv } = await supabase
      .from("INVOICE").select("INVOICE_NUMBER").eq("ID", data.ABSORBED_BY_INVOICE_ID).eq("TENANT_ID", tenantId).maybeSingle();
    return inv?.INVOICE_NUMBER || `#${data.ABSORBED_BY_INVOICE_ID}`;
  }

  // Re-aggregate PROJECT_STRUCTURE upward from a given node's parent
  // GET /api/payments?invoice_id=X  or  ?advance_invoice_id=X
  router.get("/", requirePermission("payments.view"), async (req, res) => {
    try {
      const invoiceId = req.query.invoice_id ? parseInt(req.query.invoice_id, 10) : null;
      const ppId = req.query.advance_invoice_id ? parseInt(req.query.advance_invoice_id, 10) : null;
      if (!invoiceId && !ppId) {
        return res.status(400).json({ error: "invoice_id oder advance_invoice_id erforderlich." });
      }

      let query = supabase
        .from("PAYMENT")
        .select("ID, AMOUNT_PAYED_GROSS, AMOUNT_PAYED_NET, AMOUNT_PAYED_VAT, PAYMENT_DATE, PURPOSE_OF_PAYMENT, COMMENT")
        .eq("TENANT_ID", req.tenantId)
        .order("PAYMENT_DATE", { ascending: true });

      if (invoiceId) query = query.eq("INVOICE_ID", invoiceId);
      else query = query.eq("ADVANCE_INVOICE_ID", ppId);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ data: data || [] });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  // POST /api/payments
  router.post("/", requirePermission("payments.create"), async (req, res) => {
    try {
      const b = req.body || {};
      const partialPaymentId = b.advance_invoice_id ?? null;
      const invoiceId = b.invoice_id ?? null;

      if (!!partialPaymentId === !!invoiceId) {
        return res.status(400).json({ error: "Bitte entweder Abschlagsrechnung ODER Rechnung wählen (nicht beides)." });
      }

      const gross = toNum(b.amount_payed_gross);
      if (!Number.isFinite(gross) || gross <= 0) {
        return res.status(400).json({ error: "Summe (brutto) ist erforderlich." });
      }

      const paymentDate = String(b.payment_date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
        return res.status(400).json({ error: "Zahlungsdatum ist erforderlich (YYYY-MM-DD)." });
      }

      let ref = null;

      if (partialPaymentId) {
        const { data, error } = await supabase
          .from("ADVANCE_INVOICE")
          .select(withClaimCols("ADVANCE_INVOICE", "ID, PROJECT_ID, CONTRACT_ID, VAT_ID, VAT_PERCENT, VAT_CATEGORY"))
          .eq("ID", partialPaymentId)
          .eq("TENANT_ID", req.tenantId)
          .maybeSingle();
        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: "Abschlagsrechnung nicht gefunden." });
        ref = data;

        // In einer Schlussrechnung aufgegangen (Migration 0178): der Rest steht
        // dort in Rechnung — eine Zahlung hier wuerde ihn doppelt erledigen.
        const absorbed = await absorbedBy(partialPaymentId, req.tenantId);
        if (absorbed) {
          return res.status(409).json({
            error: `Diese Abschlagsrechnung ist in der Schlussrechnung ${absorbed} aufgegangen — bitte die Zahlung dort erfassen.`,
          });
        }
      }

      if (invoiceId) {
        const { data, error } = await supabase
          .from("INVOICE")
          .select(withClaimCols("INVOICE", "ID, PROJECT_ID, CONTRACT_ID, VAT_ID, VAT_PERCENT, VAT_CATEGORY"))
          .eq("ID", invoiceId)
          .eq("TENANT_ID", req.tenantId)
          .maybeSingle();
        if (error) {
          const msg = (error.message || "").toLowerCase();
          if (msg.includes("relation") && msg.includes("invoice") && msg.includes("does not exist")) {
            return res.status(501).json({ error: "INVOICE Tabelle ist in der Datenbank nicht vorhanden." });
          }
          return res.status(500).json({ error: error.message });
        }
        if (!data) return res.status(404).json({ error: "Rechnung nicht gefunden." });
        ref = data;
      }

      const projectId = ref?.PROJECT_ID;
      const contractId = ref?.CONTRACT_ID;
      if (!projectId || !contractId) {
        return res.status(400).json({ error: "Referenz enthält kein PROJECT_ID / CONTRACT_ID." });
      }

      // Ueberzahlung (Nebenbefund 4): vorher nahm der Endpunkt jeden Betrag > 0,
      // der offene Betrag wurde negativ, ohne dass es jemand merkte. Mehr als
      // offen geht jetzt nur mit ausdruecklicher Bestaetigung — Doppel- und
      // Tippfehler fallen so auf, echte Ueberzahlungen bleiben erfassbar.
      const kind = invoiceId ? "INVOICE" : "ADVANCE_INVOICE";
      const openInfo = (await openAmountsFor(supabase, { kind, docs: [ref], tenantId: req.tenantId })).get(String(ref.ID));
      if (openInfo && gross > openInfo.open + TOL && b.allow_overpayment !== true) {
        const open = Math.max(0, openInfo.open);
        return res.status(409).json({
          error: open > TOL
            ? `Die Zahlung übersteigt den offenen Betrag von ${eur(open)} um ${eur(gross - open)}. Bitte bestätigen, dass die Überzahlung so erfasst werden soll.`
            : `Der Beleg ist bereits vollständig erledigt. Bitte bestätigen, dass die Zahlung über ${eur(gross)} als Überzahlung erfasst werden soll.`,
          code: "OVERPAYMENT",
          open_amount: open,
        });
      }

      // Steuer nur bei Regelsatz (S): bei Reverse-Charge/steuerfrei ist die
      // ganze Zahlung Entgelt — vorher wurden auch dort 19 % herausgerechnet.
      const category = String(ref?.VAT_CATEGORY ?? "S").trim().toUpperCase() || "S";
      const vatPercent = category !== "S" ? 0 : await resolveVatPercent({ vat_percent: ref?.VAT_PERCENT, vat_id: ref?.VAT_ID });

      const net = round2(gross / (1 + vatPercent / 100));
      const vat = round2(gross - net);
      if (!Number.isFinite(net) || !Number.isFinite(vat)) {
        return res.status(500).json({ error: "Fehler bei der MwSt.-Berechnung." });
      }

      const insertRow = {
        ADVANCE_INVOICE_ID: partialPaymentId ? parseInt(String(partialPaymentId), 10) : null,
        INVOICE_ID: invoiceId ? parseInt(String(invoiceId), 10) : null,
        AMOUNT_PAYED_GROSS: gross,
        AMOUNT_PAYED_NET: net,
        AMOUNT_PAYED_VAT: vat,
        PAYMENT_DATE: paymentDate,
        PROJECT_ID: projectId,
        CONTRACT_ID: contractId,
        PURPOSE_OF_PAYMENT: String(b.purpose_of_payment || "").trim() || null,
        COMMENT: String(b.comment || "").trim() || null,
        TENANT_ID: req.tenantId ?? null,
        AMOUNT_PAYED_EXTRAS_NET: null,
      };

      const { data: created, error: insErr } = await supabase
        .from("PAYMENT")
        .insert([insertRow])
        .select("ID")
        .single();
      if (insErr) return res.status(500).json({ error: insErr.message });

      // Update PROJECT.PAYED += net
      const { data: projRow } = await supabase.from("PROJECT").select("PAYED").eq("ID", projectId).maybeSingle();
      const currentPayed = toNum(projRow?.PAYED);
      const newPayed = round2((Number.isFinite(currentPayed) ? currentPayed : 0) + net);
      const { error: updErr } = await supabase.from("PROJECT").update({ PAYED: newPayed }).eq("ID", projectId);
      if (updErr) return res.status(500).json({ error: updErr.message });

      // Distribute payment across structure elements
      try {
        let structureRows = [];
        if (partialPaymentId) {
          const { data } = await supabase
            .from("ADVANCE_INVOICE_STRUCTURE")
            .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET")
            .eq("ADVANCE_INVOICE_ID", partialPaymentId);
          structureRows = data || [];
        } else if (invoiceId) {
          const { data } = await supabase
            .from("INVOICE_STRUCTURE")
            .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET")
            .eq("INVOICE_ID", invoiceId);
          structureRows = data || [];
        }

        if (structureRows.length > 0) {
          const totalAllocated = structureRows.reduce(
            (s, r) => s + toNum(r.AMOUNT_NET) + toNum(r.AMOUNT_EXTRAS_NET), 0
          );

          const payStructRows = structureRows.map((r) => {
            const rowTotal = toNum(r.AMOUNT_NET) + toNum(r.AMOUNT_EXTRAS_NET);
            const share = totalAllocated !== 0
              ? round2(net * rowTotal / totalAllocated)
              : round2(net / structureRows.length);
            return {
              PAYMENT_ID:              created.ID,
              ADVANCE_INVOICE_ID:      partialPaymentId ? parseInt(String(partialPaymentId), 10) : null,
              INVOICE_ID:              invoiceId ? parseInt(String(invoiceId), 10) : null,
              STRUCTURE_ID:            r.STRUCTURE_ID,
              AMOUNT_PAYED_NET:        share,
              AMOUNT_PAYED_EXTRAS_NET: 0,
              TENANT_ID:               req.tenantId ?? null,
            };
          });

          const rowSum = payStructRows.reduce((s, r) => s + r.AMOUNT_PAYED_NET, 0);
          const diff   = round2(net - rowSum);
          if (diff !== 0 && payStructRows.length > 0) {
            payStructRows[0].AMOUNT_PAYED_NET = round2(payStructRows[0].AMOUNT_PAYED_NET + diff);
          }

          const { error: psInsErr } = await supabase.from("PAYMENT_STRUCTURE").insert(payStructRows);
          if (psInsErr) {
            console.error("[PAYMENT][PAYMENT_STRUCTURE]", psInsErr.message);
          } else {
            const payProgressRows = payStructRows.map((r) => ({
              TENANT_ID:    req.tenantId ?? null,
              STRUCTURE_ID: r.STRUCTURE_ID,
              PAYED:        r.AMOUNT_PAYED_NET,
            }));
            const { error: ppErr } = await insertProgressSnapshot(supabase, payProgressRows);
            if (ppErr) console.error("[PAYMENT][PROGRESS]", ppErr.message);
          }
        }
      } catch (progressErr) {
        console.error("[PAYMENT][PROGRESS_OUTER]", progressErr?.message || progressErr);
      }

      return res.json({
        success: true,
        id: created?.ID,
        project_id: projectId,
        contract_id: contractId,
        vat_percent: vatPercent,
        amount_payed_net: net,
        amount_payed_vat: vat,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  // ── Rest ausbuchen (Forderungsminderung, Migration 0177) ──────────────────
  // Gleiche Rechte wie die Zahlungen selbst: wer einen Zahlungseingang
  // erfassen darf, darf auch den akzeptierten Rest ausbuchen.

  // GET /api/payments/adjustments?invoice_id=X  or  ?advance_invoice_id=X
  router.get("/adjustments", requirePermission("payments.view"), async (req, res) => {
    try {
      const data = await adjustments.listAdjustments(supabase, { tenantId: req.tenantId, query: req.query });
      return res.json({ data });
    } catch (e) {
      return res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // POST /api/payments/adjustments
  router.post("/adjustments", requirePermission("payments.create"), async (req, res) => {
    try {
      const data = await adjustments.createAdjustment(supabase, {
        tenantId: req.tenantId, employeeId: req.employeeId ?? null, body: req.body || {},
      });
      return res.json({ data });
    } catch (e) {
      return res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // DELETE /api/payments/adjustments/:id
  router.delete("/adjustments/:id", requirePermission("payments.delete"), async (req, res) => {
    try {
      const data = await adjustments.deleteAdjustment(supabase, { tenantId: req.tenantId, id: req.params.id });
      return res.json(data);
    } catch (e) {
      return res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // DELETE /api/payments/:id
  router.delete("/:id", requirePermission("payments.delete"), async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Ungültige ID." });

      // 1. Load the payment (tenant check)
      const { data: payment, error: pErr } = await supabase
        .from("PAYMENT")
        .select("ID, PROJECT_ID, INVOICE_ID, ADVANCE_INVOICE_ID, AMOUNT_PAYED_NET, TENANT_ID")
        .eq("ID", id)
        .eq("TENANT_ID", req.tenantId)
        .maybeSingle();
      if (pErr) return res.status(500).json({ error: pErr.message });
      if (!payment) return res.status(404).json({ error: "Zahlung nicht gefunden." });

      // 2.–6. Aufteilung und Zahlung loeschen, PAYED an Projekt und Struktur
      // (samt Vaetern) neu summieren, Snapshot — dieselbe Routine wie beim
      // Storno mit „Zahlungen loeschen" (services/paymentRemoval.js).
      await removePayments(supabase, { tenantId: req.tenantId, paymentIds: [payment.ID] });

      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  return router;
};

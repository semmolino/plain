const express = require("express");
const { insertProgressSnapshot } = require("../services/projectProgress");

// Payment routes
// Base path: /api/payments
module.exports = (supabase) => {
  const router = express.Router();

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

  // Re-aggregate PROJECT_STRUCTURE upward from a given node's parent
  async function propagatePayedUpwards(structureId) {
    const { data: node } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("FATHER_ID")
      .eq("ID", structureId)
      .maybeSingle();
    if (!node || node.FATHER_ID == null) return;
    const parentId = String(node.FATHER_ID);

    const { data: siblings } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("REVENUE, EXTRAS, COSTS, REVENUE_COMPLETION, EXTRAS_COMPLETION, PARTIAL_PAYMENTS, INVOICED, PAYED")
      .eq("FATHER_ID", parentId);
    if (siblings && siblings.length > 0) {
      const s = (f) => siblings.reduce((acc, c) => acc + Number(c[f] ?? 0), 0);
      await supabase.from("PROJECT_STRUCTURE").update({
        REVENUE:                   s("REVENUE"),
        EXTRAS:                    s("EXTRAS"),
        COSTS:                     s("COSTS"),
        REVENUE_COMPLETION:        s("REVENUE_COMPLETION"),
        EXTRAS_COMPLETION:         s("EXTRAS_COMPLETION"),
        PARTIAL_PAYMENTS:          s("PARTIAL_PAYMENTS"),
        INVOICED:                  s("INVOICED"),
        PAYED:                     s("PAYED"),
      }).eq("ID", parentId);
    }
    await propagatePayedUpwards(parentId);
  }

  // GET /api/payments?invoice_id=X  or  ?partial_payment_id=X
  router.get("/", async (req, res) => {
    try {
      const invoiceId = req.query.invoice_id ? parseInt(req.query.invoice_id, 10) : null;
      const ppId = req.query.partial_payment_id ? parseInt(req.query.partial_payment_id, 10) : null;
      if (!invoiceId && !ppId) {
        return res.status(400).json({ error: "invoice_id oder partial_payment_id erforderlich." });
      }

      let query = supabase
        .from("PAYMENT")
        .select("ID, AMOUNT_PAYED_GROSS, AMOUNT_PAYED_NET, AMOUNT_PAYED_VAT, PAYMENT_DATE, PURPOSE_OF_PAYMENT, COMMENT")
        .eq("TENANT_ID", req.tenantId)
        .order("PAYMENT_DATE", { ascending: true });

      if (invoiceId) query = query.eq("INVOICE_ID", invoiceId);
      else query = query.eq("PARTIAL_PAYMENT_ID", ppId);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ data: data || [] });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  // POST /api/payments
  router.post("/", async (req, res) => {
    try {
      const b = req.body || {};
      const partialPaymentId = b.partial_payment_id ?? null;
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
          .from("PARTIAL_PAYMENT")
          .select("ID, PROJECT_ID, CONTRACT_ID, VAT_ID, VAT_PERCENT")
          .eq("ID", partialPaymentId)
          .eq("TENANT_ID", req.tenantId)
          .maybeSingle();
        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: "Abschlagsrechnung nicht gefunden." });
        ref = data;
      }

      if (invoiceId) {
        const { data, error } = await supabase
          .from("INVOICE")
          .select("ID, PROJECT_ID, CONTRACT_ID, VAT_ID, VAT_PERCENT")
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

      const vatPercent = await resolveVatPercent({ vat_percent: ref?.VAT_PERCENT, vat_id: ref?.VAT_ID });

      const net = round2(gross / (1 + vatPercent / 100));
      const vat = round2(gross - net);
      if (!Number.isFinite(net) || !Number.isFinite(vat)) {
        return res.status(500).json({ error: "Fehler bei der MwSt.-Berechnung." });
      }

      const insertRow = {
        PARTIAL_PAYMENT_ID: partialPaymentId ? parseInt(String(partialPaymentId), 10) : null,
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
            .from("PARTIAL_PAYMENT_STRUCTURE")
            .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET")
            .eq("PARTIAL_PAYMENT_ID", partialPaymentId);
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
              PARTIAL_PAYMENT_ID:      partialPaymentId ? parseInt(String(partialPaymentId), 10) : null,
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

  // DELETE /api/payments/:id
  router.delete("/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Ungültige ID." });

      // 1. Load the payment (tenant check)
      const { data: payment, error: pErr } = await supabase
        .from("PAYMENT")
        .select("ID, PROJECT_ID, INVOICE_ID, PARTIAL_PAYMENT_ID, AMOUNT_PAYED_NET, TENANT_ID")
        .eq("ID", id)
        .eq("TENANT_ID", req.tenantId)
        .maybeSingle();
      if (pErr) return res.status(500).json({ error: pErr.message });
      if (!payment) return res.status(404).json({ error: "Zahlung nicht gefunden." });

      // 2. Load PAYMENT_STRUCTURE rows before deletion (needed for reversal + propagation)
      const { data: psRows } = await supabase
        .from("PAYMENT_STRUCTURE")
        .select("STRUCTURE_ID, AMOUNT_PAYED_NET")
        .eq("PAYMENT_ID", id);
      const structureRows = psRows || [];

      // 3. Delete PAYMENT_STRUCTURE, then PAYMENT
      await supabase.from("PAYMENT_STRUCTURE").delete().eq("PAYMENT_ID", id);
      const { error: delErr } = await supabase.from("PAYMENT").delete().eq("ID", id).eq("TENANT_ID", req.tenantId);
      if (delErr) return res.status(500).json({ error: delErr.message });

      // 4. Re-sum PROJECT.PAYED from remaining payments (accurate re-aggregate, not a delta)
      const { data: remainingPayments } = await supabase
        .from("PAYMENT")
        .select("AMOUNT_PAYED_NET")
        .eq("PROJECT_ID", payment.PROJECT_ID)
        .eq("TENANT_ID", req.tenantId);
      const newProjectPayed = round2(
        (remainingPayments || []).reduce((s, r) => s + (Number.isFinite(toNum(r.AMOUNT_PAYED_NET)) ? toNum(r.AMOUNT_PAYED_NET) : 0), 0)
      );
      await supabase.from("PROJECT").update({ PAYED: newProjectPayed }).eq("ID", payment.PROJECT_ID);

      // 5. Re-sum PROJECT_STRUCTURE.PAYED per affected leaf, then propagate upward
      const uniqueStructureIds = [...new Set(structureRows.map(r => String(r.STRUCTURE_ID)))];
      for (const sid of uniqueStructureIds) {
        const { data: sPayments } = await supabase
          .from("PAYMENT_STRUCTURE")
          .select("AMOUNT_PAYED_NET")
          .eq("STRUCTURE_ID", sid);
        const newPayed = round2(
          (sPayments || []).reduce((s, r) => s + (Number.isFinite(toNum(r.AMOUNT_PAYED_NET)) ? toNum(r.AMOUNT_PAYED_NET) : 0), 0)
        );
        await supabase.from("PROJECT_STRUCTURE").update({ PAYED: newPayed }).eq("ID", sid);
        await propagatePayedUpwards(sid);
      }

      // 6. Insert PROJECT_PROGRESS reversal rows with carry-forward
      if (structureRows.length > 0) {
        const reversalRows = structureRows.map(r => ({
          TENANT_ID:    req.tenantId ?? null,
          STRUCTURE_ID: r.STRUCTURE_ID,
          PAYED:        -round2(toNum(r.AMOUNT_PAYED_NET)),
        }));
        const { error: prErr } = await insertProgressSnapshot(supabase, reversalRows);
        if (prErr) console.error("[PAYMENT_DELETE][PROGRESS]", prErr.message);
      }

      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  return router;
};

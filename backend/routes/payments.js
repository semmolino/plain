const express = require("express");

// Payment creation
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

  async function getProjectPayed(projectId) {
    const { data, error } = await supabase
      .from("PROJECT")
      .select("PAYED")
      .eq("ID", projectId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const cur = toNum(data?.PAYED);
    return Number.isFinite(cur) ? cur : 0;
  }

  // POST /api/payments
  // Body:
  //   - partial_payment_id OR invoice_id (exactly one)
  //   - amount_payed_gross (mandatory)
  //   - payment_date (mandatory, YYYY-MM-DD)
  //   - purpose_of_payment (optional)
  //   - comment (optional)
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

      // Resolve reference (project/contract/vat)
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
        // Not used yet in UI:
        AMOUNT_PAYED_EXTRAS_NET: null,
      };

      const { data: created, error: insErr } = await supabase
        .from("PAYMENT")
        .insert([insertRow])
        .select("ID")
        .single();
      if (insErr) return res.status(500).json({ error: insErr.message });

      // Update PROJECT.PAYED += net
      const currentPayed = await getProjectPayed(projectId);
      const newPayed = round2(currentPayed + net);
      const { error: updErr } = await supabase
        .from("PROJECT")
        .update({ PAYED: newPayed })
        .eq("ID", projectId);
      if (updErr) return res.status(500).json({ error: updErr.message });

      // PROJECT_PROGRESS: distribute payment proportionally across linked structures
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

          // Build PAYMENT_STRUCTURE rows with proportional net distribution
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

          // Fix rounding so rows sum exactly to net
          const rowSum = payStructRows.reduce((s, r) => s + r.AMOUNT_PAYED_NET, 0);
          const diff   = round2(net - rowSum);
          if (diff !== 0 && payStructRows.length > 0) {
            payStructRows[0].AMOUNT_PAYED_NET = round2(payStructRows[0].AMOUNT_PAYED_NET + diff);
          }

          const { error: psInsErr } = await supabase.from("PAYMENT_STRUCTURE").insert(payStructRows);
          if (psInsErr) {
            console.error("[PAYMENT][PAYMENT_STRUCTURE]", psInsErr.message);
          } else {
            // PROJECT_PROGRESS: one row per structure with the PAYED delta
            const payProgressRows = payStructRows.map((r) => ({
              TENANT_ID:    req.tenantId ?? null,
              STRUCTURE_ID: r.STRUCTURE_ID,
              PAYED:        r.AMOUNT_PAYED_NET,
            }));
            const { error: ppErr } = await supabase.from("PROJECT_PROGRESS").insert(payProgressRows);
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

  return router;
};

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

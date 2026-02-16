const express = require("express");

module.exports = (supabase) => {
  const router = express.Router();

  const currentYear = () => new Date().getFullYear();

  // Get number ranges for a company/year
  // - GLOBAL: shared counter for INVOICE/PARTIAL_PAYMENT
  // - PROJECT: separate counter for projects
  router.get("/", async (req, res) => {
    const companyId = req.query.company_id;
    const year = parseInt(String(req.query.year || currentYear()), 10);

    if (!companyId) return res.status(400).json({ error: "company_id ist erforderlich" });
    if (!Number.isFinite(year) || year < 2000 || year > 3000) {
      return res.status(400).json({ error: "Ungültiges Jahr" });
    }

    const { data, error } = await supabase
      .from("DOCUMENT_NUMBER_RANGE")
      .select("DOC_TYPE, NEXT_COUNTER, YEAR")
      .eq("COMPANY_ID", companyId)
      .eq("YEAR", year);

    if (error) return res.status(500).json({ error: error.message });

    let nextCounter = 1;
    let hasGlobal = false;
    let projectNextCounter = 1;

    (data || []).forEach((r) => {
      const t = String(r.DOC_TYPE || "").toUpperCase();
      const v = parseInt(String(r.NEXT_COUNTER ?? 1), 10);
      if (!Number.isFinite(v) || v < 1) return;
      if (t === "GLOBAL") {
        hasGlobal = true;
        nextCounter = v;
      }
      if (t === "PROJECT") {
        projectNextCounter = v;
      }
    });

    // If GLOBAL does not exist yet, show the highest NEXT_COUNTER across legacy rows
    if (!hasGlobal) {
      (data || []).forEach((r) => {
        const v = parseInt(String(r.NEXT_COUNTER ?? 1), 10);
        if (Number.isFinite(v) && v >= 1) nextCounter = Math.max(nextCounter, v);
      });
    }

    return res.json({ year, next_counter: nextCounter, project_next_counter: projectNextCounter });
  });

  // Upsert the ranges
  // Body:
  // - company_id (required)
  // - year (optional)
  // - next_counter (required, 1..9999) => GLOBAL
  // - project_next_counter (optional, 1..999) => PROJECT
  router.post("/set", async (req, res) => {
    const b = req.body || {};
    const companyId = b.company_id;
    const year = parseInt(String(b.year || currentYear()), 10);
    const nextCounter = parseInt(String(b.next_counter || ""), 10);

    const projectProvided = b.project_next_counter !== undefined && b.project_next_counter !== null && String(b.project_next_counter) !== "";
    const projectNextCounter = projectProvided ? parseInt(String(b.project_next_counter), 10) : null;

    if (!companyId) return res.status(400).json({ error: "company_id ist erforderlich" });
    if (!Number.isFinite(year) || year < 2000 || year > 3000) {
      return res.status(400).json({ error: "Ungültiges Jahr" });
    }
    if (!Number.isFinite(nextCounter) || nextCounter < 1 || nextCounter > 9999) {
      return res.status(400).json({ error: "next_counter muss zwischen 1 und 9999 liegen" });
    }
    if (projectProvided && (!Number.isFinite(projectNextCounter) || projectNextCounter < 1 || projectNextCounter > 999)) {
      return res.status(400).json({ error: "project_next_counter muss zwischen 1 und 999 liegen" });
    }

    const upsert = async (docType, counter) => {
      const { error } = await supabase
        .from("DOCUMENT_NUMBER_RANGE")
        .upsert(
          {
            COMPANY_ID: companyId,
            DOC_TYPE: docType,
            YEAR: year,
            NEXT_COUNTER: counter,
            UPDATED_AT: new Date().toISOString(),
          },
          { onConflict: "COMPANY_ID,DOC_TYPE,YEAR" }
        );
      if (error) throw new Error(error.message);
    };

    try {
      await upsert("GLOBAL", nextCounter);
      if (projectProvided) {
        await upsert("PROJECT", projectNextCounter);
      }
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  });

  return router;
};

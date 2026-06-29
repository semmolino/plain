"use strict";
const express = require("express");
const { requirePermission, requireAnyPermission } = require("../middleware/permissions");

// ── Routen: Service-Bereich (Phase 0 — Fundament) ─────────────────────────────
// Liefert das Zugangs-Gate (Haftungs-/Nutzungsbestätigung) und die Verwaltung
// des „Produkt-Sprechers" (genau ein abstimmungs-/kommentarberechtigter
// Mitarbeiter pro Organisation). Die eigentlichen Vorschlags-/Feedback-/Support-
// Funktionen folgen in Phase 1/2. Siehe docs/SERVICE_AREA_CONCEPT.md.
//
// Tenant-Isolation: jede Query filtert auf req.tenantId.
module.exports = (supabase) => {
  const router = express.Router();

  // Version des Haftungs-/Nutzungshinweises. Bei Textänderung hochzählen →
  // erzwingt erneute Bestätigung (PORTAL_CONSENT ist je Version eindeutig).
  const CONSENT_VERSION = "2026-06-29";

  const DELEGATE_KEY = "suggestion_delegate_employee_id";

  function employeeName(e) {
    if (!e) return null;
    const full = [e.FIRST_NAME, e.LAST_NAME].filter(Boolean).join(" ").trim();
    return full || e.SHORT_NAME || `#${e.ID}`;
  }

  // ── Zugangs-Gate: Haftungs-/Nutzungsbestätigung ─────────────────────────────
  // GET /consent → ob der aktuelle Mitarbeiter die aktuelle Textversion akzeptiert hat
  router.get("/consent", async (req, res) => {
    const { data, error } = await supabase
      .from("PORTAL_CONSENT")
      .select("DOC_VERSION, ACCEPTED_AT")
      .eq("EMPLOYEE_ID", req.employeeId)
      .eq("DOC_VERSION", CONSENT_VERSION)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({
      current_version: CONSENT_VERSION,
      accepted:        !!data,
      accepted_at:     data?.ACCEPTED_AT || null,
    });
  });

  // POST /consent → Bestätigung der aktuellen Textversion festhalten
  router.post("/consent", async (req, res) => {
    const row = {
      TENANT_ID:   req.tenantId,
      EMPLOYEE_ID: req.employeeId,
      DOC_VERSION: CONSENT_VERSION,
      ACCEPTED_AT: new Date().toISOString(),
    };
    // Idempotent: zweite Bestätigung derselben Version verändert nichts.
    const { error } = await supabase
      .from("PORTAL_CONSENT")
      .upsert([row], { onConflict: "EMPLOYEE_ID,DOC_VERSION" });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ accepted: true, current_version: CONSENT_VERSION });
  });

  // ── Produkt-Sprecher (eine Stimme pro Organisation) ─────────────────────────
  // GET /delegate → wer ist der abstimmungs-/kommentarberechtigte Mitarbeiter?
  router.get(
    "/delegate",
    requireAnyPermission("service.suggestions.view", "service.suggestions.admin"),
    async (req, res) => {
      const { data: setting } = await supabase
        .from("TENANT_SETTINGS")
        .select("VALUE")
        .eq("TENANT_ID", req.tenantId)
        .eq("KEY", DELEGATE_KEY)
        .maybeSingle();
      const delegateId = setting?.VALUE ? Number(setting.VALUE) : null;

      let name = null;
      if (delegateId) {
        const { data: emp } = await supabase
          .from("EMPLOYEE")
          .select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME")
          .eq("ID", delegateId)
          .eq("TENANT_ID", req.tenantId)
          .maybeSingle();
        name = employeeName(emp);
      }
      res.json({
        employee_id:   delegateId,
        employee_name: name,
        is_me:         delegateId === req.employeeId,
      });
    }
  );

  // PUT /delegate → Produkt-Sprecher festlegen (nur Admin)
  router.put("/delegate", requirePermission("service.suggestions.admin"), async (req, res) => {
    const empId = req.body?.employee_id != null ? Number(req.body.employee_id) : null;

    if (empId != null) {
      // Mitarbeiter muss zur eigenen Organisation gehören.
      const { data: emp } = await supabase
        .from("EMPLOYEE")
        .select("ID")
        .eq("ID", empId)
        .eq("TENANT_ID", req.tenantId)
        .maybeSingle();
      if (!emp) return res.status(400).json({ error: "Mitarbeiter nicht gefunden" });
    }

    const { error } = await supabase.from("TENANT_SETTINGS").upsert(
      [{ TENANT_ID: req.tenantId, KEY: DELEGATE_KEY, VALUE: empId != null ? String(empId) : "", UPDATED_AT: new Date().toISOString() }],
      { onConflict: "TENANT_ID,KEY" }
    );
    if (error) return res.status(500).json({ error: error.message });
    res.json({ employee_id: empId });
  });

  return router;
};

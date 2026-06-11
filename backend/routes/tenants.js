"use strict";

const express = require("express");
const { requirePermission } = require("../middleware/permissions");

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

module.exports = (supabase) => {
  const router = express.Router();

  // GET /api/v1/tenants/me -- liefert Slug + Name fuer den eingeloggten Tenant
  router.get("/me", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("TENANTS")
        .select("ID, TENANT, SLUG")
        .eq("ID", req.tenantId)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data)  return res.status(404).json({ error: "Tenant nicht gefunden." });
      res.json({ data });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // PUT /api/v1/tenants/me/slug -- setzt den Slug. Validiert auf Format
  // und Eindeutigkeit (DB-Unique-Index). Leerer/null Slug = entfernen.
  router.put("/me/slug", requirePermission("settings.company.edit"), async (req, res) => {
    try {
      const raw = (req.body?.slug ?? "").toString().trim().toLowerCase();
      const slug = raw === "" ? null : raw;

      if (slug !== null && !SLUG_REGEX.test(slug)) {
        return res.status(400).json({
          error: "Slug darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten (3-60 Zeichen).",
        });
      }

      const { error } = await supabase
        .from("TENANTS")
        .update({ SLUG: slug })
        .eq("ID", req.tenantId);
      if (error) {
        if (/duplicate key/i.test(error.message)) {
          return res.status(409).json({ error: "Dieser Slug ist bereits vergeben." });
        }
        return res.status(500).json({ error: error.message });
      }
      res.json({ data: { slug } });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  return router;
};

"use strict";

const express = require("express");
const { supabase } = require("../services/db");

const router = express.Router();

// Letzte Änderungen aus dem Audit-Log (Control-Plane-Nachvollziehbarkeit).
router.get("/audit", async (_req, res) => {
  const { data, error } = await supabase
    .from("LICENSE_CHANGE_LOG")
    .select("ID, ACTOR, ENTITY, ENTITY_REF, ACTION, AT")
    .order("AT", { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ entries: data || [] });
});

module.exports = router;

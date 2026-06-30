"use strict";

// ── Owner-Konsole: Auswertungen (read-only, plan&simple-weit) ─────────────────
// Aggregiert Vorschläge + Service-Anfragen. Kennzahlen enthalten KEINE
// Identitäten — Organisationen fließen nur als anonyme Anzahl ein.
// Aggregation in JS (supabase-js ohne GROUP BY); nur benötigte Spalten laden.

const express = require("express");
const { supabase } = require("../services/db");

const router = express.Router();

function tally(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = r[key] || "—";
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

// Letzte `n` Monate als YYYY-MM (chronologisch), mit Zählung aus CREATED_AT.
function perMonth(rows, n = 6) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const k = String(r.CREATED_AT || "").slice(0, 7);
    if (k in counts) counts[k] += 1;
  }
  return keys.map((k) => ({ month: k, count: counts[k] }));
}

router.get("/analytics", async (_req, res) => {
  const [{ data: sugg, error: e1 }, { data: reqs, error: e2 }] = await Promise.all([
    supabase.from("SUGGESTION").select("ID, PUBLIC_TITLE, TITLE, CATEGORY, MODERATION_STATE, LIFECYCLE_STATUS, MERGED_INTO_ID, VOTE_COUNT, TENANT_ID, CREATED_AT"),
    supabase.from("SERVICE_REQUEST").select("KIND, CATEGORY, STATUS, CREATED_AT"),
  ]);
  if (e1) return res.status(500).json({ error: e1.message });
  if (e2) return res.status(500).json({ error: e2.message });

  const s = sugg || [];
  const r = reqs || [];

  const published = s.filter((x) => x.MODERATION_STATE === "published" && !x.MERGED_INTO_ID);
  const top = [...published]
    .sort((a, b) => (b.VOTE_COUNT || 0) - (a.VOTE_COUNT || 0))
    .slice(0, 10)
    .map((x) => ({ id: x.ID, title: x.PUBLIC_TITLE || x.TITLE, votes: x.VOTE_COUNT || 0, lifecycle_status: x.LIFECYCLE_STATUS }));

  const openStatuses = new Set(["new", "in_progress", "waiting"]);

  res.json({
    suggestions: {
      total: s.length,
      pending: s.filter((x) => x.MODERATION_STATE === "pending").length,
      published: published.length,
      by_moderation: tally(s, "MODERATION_STATE"),
      by_lifecycle: tally(published, "LIFECYCLE_STATUS"),
      by_category: tally(s, "CATEGORY"),
      orgs_participating: new Set(s.map((x) => x.TENANT_ID)).size,
      per_month: perMonth(s),
      top,
    },
    requests: {
      total: r.length,
      open: r.filter((x) => openStatuses.has(x.STATUS)).length,
      by_kind: tally(r, "KIND"),
      by_status: tally(r, "STATUS"),
      by_category: tally(r, "CATEGORY"),
      per_month: perMonth(r),
    },
  });
});

module.exports = router;

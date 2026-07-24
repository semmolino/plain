"use strict";

const express = require("express");
const { supabase } = require("../services/db");
const { describeEntry, ENTITY_LABELS, ACTION_LABELS } = require("../services/audit");

const router = express.Router();

const MAX_LIMIT = 200;

/** Felder, die im Diff nie interessieren (reine Technik). */
const DIFF_IGNORE = new Set(["UPDATED_AT", "CREATED_AT", "AT", "ID"]);

/** Sprechende Feldnamen für den Vorher/Nachher-Vergleich. */
const FIELD_LABELS = {
  PLAN_ID: "Plan", PLAN_VERSION: "Plan-Version", STATE: "Zustand",
  VALID_UNTIL: "Gültig bis", TRIAL_UNTIL: "Test bis", GRACE_UNTIL: "Kulanz bis",
  STARTS_AT: "Beginn", NAME_DE: "Name", DESCRIPTION_DE: "Beschreibung",
  PRICE_MONTHLY: "Preis/Monat", PRICE_YEARLY: "Preis/Jahr", IS_ACTIVE: "Aktiv",
  IS_DEFAULT: "Standard-Plan", POSITION: "Reihenfolge", KEY: "Schlüssel",
  NUMERIC_LIMIT: "Limit", MODE: "Art", REASON: "Begründung", EXPIRES_AT: "Läuft ab",
  CAPABILITY_KEY: "Capability", PERMISSION_KEY: "Funktion", TENANT_ID: "Mandant",
  VERSION: "Version",
};

/** Berechnet die geänderten Felder zwischen BEFORE und AFTER. */
function buildDiff(before, after) {
  if (!before && !after) return [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  for (const k of keys) {
    if (DIFF_IGNORE.has(k)) continue;
    const b = before ? before[k] : undefined;
    const a = after ? after[k] : undefined;
    const same = JSON.stringify(b ?? null) === JSON.stringify(a ?? null);
    if (same) continue;
    out.push({ field: k, label: FIELD_LABELS[k] || k, before: b ?? null, after: a ?? null });
  }
  return out.sort((x, y) => x.label.localeCompare(y.label));
}

/**
 * Audit-Log mit Filtern und Paginierung.
 * Query: entity, action, actor, q (Freitext auf ENTITY_REF), from, to, limit, offset
 */
router.get("/audit", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, MAX_LIMIT);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  let q = supabase
    .from("LICENSE_CHANGE_LOG")
    .select("ID, ACTOR, ENTITY, ENTITY_REF, ACTION, BEFORE, AFTER, CONTEXT, IP, AT", { count: "exact" })
    .order("AT", { ascending: false })
    .range(offset, offset + limit - 1);

  if (req.query.entity) q = q.eq("ENTITY", req.query.entity);
  if (req.query.action) q = q.eq("ACTION", req.query.action);
  if (req.query.actor) q = q.ilike("ACTOR", `%${req.query.actor}%`);
  if (req.query.q) q = q.ilike("ENTITY_REF", `%${req.query.q}%`);
  if (req.query.from) q = q.gte("AT", req.query.from);
  if (req.query.to) q = q.lte("AT", req.query.to);

  const { data, error, count } = await q;
  if (error) {
    // CONTEXT/IP fehlen, wenn Migration 0102 noch nicht eingespielt wurde —
    // dann ohne die neuen Spalten erneut versuchen statt zu scheitern.
    if (/column .* does not exist/i.test(error.message)) {
      const fb = await supabase
        .from("LICENSE_CHANGE_LOG")
        .select("ID, ACTOR, ENTITY, ENTITY_REF, ACTION, BEFORE, AFTER, AT", { count: "exact" })
        .order("AT", { ascending: false })
        .range(offset, offset + limit - 1);
      if (fb.error) return res.status(500).json({ error: fb.error.message });
      return res.json({
        entries: (fb.data || []).map((e) => ({ ...describeEntry(e), DIFF: buildDiff(e.BEFORE, e.AFTER) })),
        total: fb.count ?? 0, limit, offset,
        filters: filterOptions(),
        warning: "Migration 0102 nicht eingespielt — Kontext, IP und Anmelde-Protokoll fehlen.",
      });
    }
    return res.status(500).json({ error: error.message });
  }

  res.json({
    entries: (data || []).map((e) => ({ ...describeEntry(e), DIFF: buildDiff(e.BEFORE, e.AFTER) })),
    total: count ?? 0,
    limit,
    offset,
    filters: filterOptions(),
  });
});

function filterOptions() {
  return {
    entities: Object.entries(ENTITY_LABELS).map(([key, v]) => ({ key, label: v.label })),
    actions: Object.entries(ACTION_LABELS).map(([key, label]) => ({ key, label })),
  };
}

/** CSV-Export der gefilterten Ansicht (Nachweisführung / Ablage). */
router.get("/audit/export", async (req, res) => {
  let q = supabase
    .from("LICENSE_CHANGE_LOG")
    .select("ID, ACTOR, ENTITY, ENTITY_REF, ACTION, BEFORE, AFTER, AT")
    .order("AT", { ascending: false })
    .limit(5000);
  if (req.query.entity) q = q.eq("ENTITY", req.query.entity);
  if (req.query.action) q = q.eq("ACTION", req.query.action);
  if (req.query.from) q = q.gte("AT", req.query.from);
  if (req.query.to) q = q.lte("AT", req.query.to);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Zeitpunkt", "Wer", "Aktion", "Bereich", "Objekt", "Referenz"].map(esc).join(";")];
  for (const e of data || []) {
    const d = describeEntry(e);
    lines.push([
      new Date(e.AT).toLocaleString("de-DE"),
      e.ACTOR, d.ACTION_LABEL, d.ENTITY_LABEL, d.OBJECT_LABEL, e.ENTITY_REF,
    ].map(esc).join(";"));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + lines.join("\r\n")); // BOM -> Excel erkennt UTF-8
});

module.exports = router;

"use strict";

const { supabase } = require("./db");

/**
 * Schreibt einen Eintrag ins LICENSE_CHANGE_LOG. Jede mutierende Aktion der
 * Konsole MUSS hierdurch protokolliert werden (Nachvollziehbarkeit + Rollback).
 * Best-effort: ein fehlgeschlagenes Log darf die eigentliche Aktion nicht
 * zurückrollen, wird aber laut geloggt.
 */
async function writeChangeLog({ actor, entity, entityRef, action, before, after }) {
  try {
    const { error } = await supabase.from("LICENSE_CHANGE_LOG").insert([{
      ACTOR: actor || "unknown",
      ENTITY: entity,
      ENTITY_REF: entityRef != null ? String(entityRef) : null,
      ACTION: action,
      BEFORE: before ?? null,
      AFTER: after ?? null,
    }]);
    if (error) console.error("[audit] insert failed:", error.message);
  } catch (e) {
    console.error("[audit] insert threw:", e?.message || e);
  }
}

module.exports = { writeChangeLog };

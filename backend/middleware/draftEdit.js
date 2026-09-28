"use strict";

const { requirePermission } = require("./permissions");

/**
 * Entwurf einer Rechnung bearbeiten (UI-Pilot Runde 3).
 *
 * Bis hierher verlangte jeder Speicherschritt im Assistenten `invoices.edit`.
 * Eine Rolle mit „Abschlagsrechnung anlegen", aber ohne „Rechnungen
 * bearbeiten", legte den Entwurf an und kam dann nicht ueber Schritt 1: der
 * erste PATCH scheiterte mit 403. Die Standardrollen haben beides, eigene
 * Rollen nicht unbedingt.
 *
 * Jetzt reicht fuer einen ENTWURF (STATUS_ID = 1) auch das Anlege-Recht
 * seiner Belegart. Alles andere bleibt, wie es war:
 *   - ein gebuchter Beleg braucht weiter `invoices.edit` (und die Controller
 *     lehnen das Aendern gebuchter Belege ohnehin ab),
 *   - Buchen bleibt `invoices.book`, Loeschen `invoices.delete`,
 *   - wer `invoices.edit` hat, geht ohne Datenbankabfrage durch.
 *
 * Die Belegart kommt aus der Datenbank, nicht aus der Anfrage — sonst koennte
 * eine Rolle mit „Gutschrift anlegen" eine Schlussrechnung bearbeiten, indem
 * sie die Art behauptet. Ein Beleg, den es fuer den Mandanten nicht gibt, wird
 * wie ein fehlendes Recht behandelt (403), damit die Antwort nichts ueber
 * fremde Belege verraet.
 */

/** Anlege-Recht je INVOICE_TYPE (INVOICE). Unbekannte Arten: keins. */
const CREATE_KEY_BY_INVOICE_TYPE = {
  rechnung:            "invoices.create_single",
  schlussrechnung:     "invoices.create_final",
  teilschlussrechnung: "invoices.create_final",
  gutschrift:          "invoices.create_credit",
};

function createKeyFor(table, row) {
  if (table === "ADVANCE_INVOICE") return "invoices.create_partial";
  const type = row.INVOICE_TYPE == null || row.INVOICE_TYPE === "" ? "rechnung" : String(row.INVOICE_TYPE);
  return CREATE_KEY_BY_INVOICE_TYPE[type] || null;
}

/**
 * @param supabase  Client der Route (laeuft hinter tenantScope, traegt den Claim)
 * @param table     "INVOICE" | "ADVANCE_INVOICE"
 */
function requireDraftEdit(supabase, table) {
  const denyAsEdit = requirePermission("invoices.edit");
  const cols = table === "INVOICE" ? "ID, STATUS_ID, INVOICE_TYPE" : "ID, STATUS_ID";

  return async (req, res, next) => {
    if (req._permissionsUnrestricted || req.permissions?.has("invoices.edit")) return next();

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return denyAsEdit(req, res, next);

    try {
      const { data: row, error } = await supabase
        .from(table)
        .select(cols)
        .eq("ID", id)
        .eq("TENANT_ID", req.tenantId)
        .maybeSingle();
      if (error) return res.status(500).json({ error: "Beleg konnte nicht geprüft werden." });
      if (row && String(row.STATUS_ID) === "1") {
        const key = createKeyFor(table, row);
        if (key && req.permissions?.has(key)) return next();
      }
    } catch (e) {
      return res.status(500).json({ error: "Beleg konnte nicht geprüft werden." });
    }
    // Gleiche Antwort (403/402) wie bisher bei fehlendem invoices.edit
    return denyAsEdit(req, res, next);
  };
}

module.exports = { requireDraftEdit, CREATE_KEY_BY_INVOICE_TYPE };

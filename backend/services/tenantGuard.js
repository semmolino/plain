"use strict";

/**
 * Besitzpruefungen: gehoert ein Datensatz dem Mandanten des Aufrufers?
 *
 * Hintergrund (Pentest 2026-08-06): Der wiederkehrende Fehler in diesem
 * Projekt war nicht eine vergessene Bedingung, sondern ein Muster — der
 * Mandant wurde aus dem ANGEFRAGTEN OBJEKT abgeleitet statt aus der Sitzung:
 *
 *     const tenantId = projRow?.TENANT_ID;        // services/buchungen.js
 *     const tenantId = rawDoc.TENANT_ID ?? null;  // services_pdf_render.js
 *
 * Damit bestaetigt die Pruefung nur, dass ein fremder Datensatz zu seinem
 * eigenen Mandanten gehoert — sie ist wirkungslos. Schlimmer noch: beim
 * Schreiben uebernimmt der neue Datensatz dann den FREMDEN Mandanten.
 *
 * Diese Helfer drehen die Richtung um: geprueft wird gegen den Mandanten aus
 * dem JWT, und wer keinen mitgibt, bekommt einen Fehler statt Vollzugriff.
 */

const NOT_FOUND = () => ({ status: 404, message: "Nicht gefunden." });

/**
 * Prueft, dass ein Datensatz existiert UND dem Mandanten gehoert.
 *
 * @returns {Promise<number>} die validierte, numerische ID
 * @throws  {{status:404}}    wenn nicht vorhanden ODER fremd — bewusst nicht
 *                            unterscheidbar, sonst liessen sich ueber den
 *                            Statuscode fremde IDs ermitteln.
 */
async function assertInTenant(supabase, table, id, tenantId) {
  if (tenantId === undefined || tenantId === null || tenantId === "") {
    throw new Error(`assertInTenant(${table}): tenantId ist erforderlich`);
  }
  const numericId = parseInt(String(id), 10);
  if (!Number.isFinite(numericId)) throw NOT_FOUND();

  const { data, error } = await supabase
    .from(table)
    .select("ID")
    .eq("ID", numericId)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  if (error) throw { status: 500, message: error.message };
  if (!data) throw NOT_FOUND();
  return numericId;
}

const assertProjectInTenant   = (supabase, id, tenantId) => assertInTenant(supabase, "PROJECT", id, tenantId);
const assertStructureInTenant = (supabase, id, tenantId) => assertInTenant(supabase, "PROJECT_STRUCTURE", id, tenantId);
const assertContractInTenant  = (supabase, id, tenantId) => assertInTenant(supabase, "CONTRACT", id, tenantId);
const assertEmployeeInTenant  = (supabase, id, tenantId) => assertInTenant(supabase, "EMPLOYEE", id, tenantId);
const assertTecInTenant       = (supabase, id, tenantId) => assertInTenant(supabase, "TEC", id, tenantId);
const assertCompanyInTenant   = (supabase, id, tenantId) => assertInTenant(supabase, "COMPANY", id, tenantId);
const assertInvoiceInTenant   = (supabase, id, tenantId) => assertInTenant(supabase, "INVOICE", id, tenantId);

module.exports = {
  assertInTenant,
  assertProjectInTenant,
  assertStructureInTenant,
  assertContractInTenant,
  assertEmployeeInTenant,
  assertTecInTenant,
  assertCompanyInTenant,
  assertInvoiceInTenant,
  NOT_FOUND,
};

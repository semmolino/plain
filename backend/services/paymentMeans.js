"use strict";

/**
 * Zahlungsart (BT-81) — ein globaler, schreibgeschuetzter Katalog.
 *
 * Seit Migration 0163 traegt PAYMENT_MEANS keinen Mandanten mehr: die
 * zulaessigen Werte stehen in UNTDID 4461, einer Codeliste der EN 16931, und
 * sind nichts, was ein Buero selbst definiert. ABBR ist der Code, NAME die
 * deutsche Bezeichnung. Geschrieben wird die Tabelle nur noch aus einer
 * Migration heraus — die Policy in der Datenbank laesst nichts anderes zu.
 *
 * Dieses Modul buendelt die drei Dinge, die der Rest der Anwendung davon
 * braucht, damit sie nicht an drei Stellen auseinanderlaufen:
 * pruefen, vorbelegen, und den Code fuer die E-Rechnung aufloesen.
 */

const codelists = require("../einvoice/codelists");

const SETTINGS_KEY = "default_payment_means_id";

/**
 * Laedt eine Katalogzeile. Liefert null, wenn es sie nicht gibt.
 * @returns {Promise<{ID: number, ABBR: string, NAME: string}|null>}
 */
async function loadPaymentMeans(supabase, id) {
  if (id === null || id === undefined || id === "") return null;
  const { data, error } = await supabase
    .from("PAYMENT_MEANS").select("ID, ABBR, NAME").eq("ID", id).maybeSingle();
  if (error) throw { status: 500, message: "Zahlungsart konnte nicht geladen werden" };
  return data || null;
}

/**
 * Prueft eine vom Client geschickte Zahlungsart und gibt die ID zurueck.
 *
 * Vor 09/2026 wurde `payment_means_id` ungeprueft in INVOICE bzw.
 * ADVANCE_INVOICE geschrieben. Solange die Tabelle noch mandantenbezogen war,
 * konnte damit die Zeile eines fremden Mandanten referenziert werden; seit sie
 * global ist, bleibt der Fall "ID gibt es gar nicht" — der lief bis zum
 * Fremdschluesselfehler durch und kam als 500er heraus.
 *
 * @throws {{status:number, message:string}} 400, wenn der Wert fehlt oder unbekannt ist
 */
async function assertPaymentMeans(supabase, id) {
  if (!id) throw { status: 400, message: "Zahlungsart ist erforderlich" };
  const row = await loadPaymentMeans(supabase, id);
  if (!row) throw { status: 400, message: "Unbekannte Zahlungsart" };
  return row.ID;
}

/**
 * Vorbelegung des Mandanten, sofern gepflegt UND im Katalog vorhanden.
 *
 * Ungepflegt heisst hier null und nicht "irgendeine" — ein stillschweigend
 * gesetzter Wert waere auf der Rechnung nicht als Vermutung erkennbar. Die
 * E-Rechnung faellt fuer einen Beleg ohne Zahlungsart ohnehin auf den Code
 * zurueck, der bis 09/2026 fest verdrahtet war.
 */
async function defaultPaymentMeansId(supabase, tenantId) {
  if (!tenantId) return null;
  const { data, error } = await supabase
    .from("TENANT_SETTINGS").select("VALUE")
    .eq("TENANT_ID", tenantId).eq("KEY", SETTINGS_KEY).maybeSingle();
  if (error || !data?.VALUE) return null;
  const row = await loadPaymentMeans(supabase, Number(data.VALUE));
  return row ? row.ID : null;
}

/**
 * Zahlungsart eines Belegs fuer die E-Rechnung.
 *
 * Liefert immer einen ausgebbaren Code: fehlt die Zuordnung oder ist sie kein
 * gueltiger UNTDID-4461-Code, bleibt es beim Rueckfall 58 (SEPA-Ueberweisung),
 * also genau bei dem Verhalten, das bis 09/2026 fest im Bauplan stand.
 *
 * @returns {Promise<{code: string, name: string|null}>}
 */
async function paymentMeansForEinvoice(supabase, id) {
  const row = await loadPaymentMeans(supabase, id).catch(() => null);
  const code = codelists.normalizePaymentMeansCode(row?.ABBR);
  if (!code) return { code: codelists.PAYMENT_MEANS_SEPA_CREDIT_TRANSFER, name: null };
  return { code, name: row.NAME ?? null };
}

module.exports = {
  SETTINGS_KEY,
  loadPaymentMeans,
  assertPaymentMeans,
  defaultPaymentMeansId,
  paymentMeansForEinvoice,
};

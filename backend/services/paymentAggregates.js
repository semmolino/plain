"use strict";

// ---------------------------------------------------------------------------
// Bezahlte Betraege auf der Projektstruktur fortschreiben
//
// BEFUND 2026-09-23: Das lief bisher NUR beim Loeschen einer Zahlung. Beim
// Anlegen schrieb routes/payments.js zwar PAYMENT, PAYMENT_STRUCTURE,
// PROJECT.PAYED und einen Fortschritts-Schnappschuss — aber nicht den Wert am
// Knoten. Das "bezahlt" je Position blieb deshalb auf 0, bis irgendwann jemand
// eine Zahlung LOESCHTE; dann sprang es auf einmal auf den richtigen Wert.
//
// Getroffen hat das jede Auswertung, die auf den Knotenwerten aufsetzt — allen
// voran den Bericht ueber teilfertige Leistungen, der die Aggregate der
// Struktur liest und nicht die Rohtabellen.
//
// Warum hier und nicht in der Route: die Logik wird an zwei Stellen gebraucht
// (Anlegen und Loeschen), und nur als Dienst laesst sie sich pruefen — die
// Routen dieses Projekts kennen kein supertest.
// ---------------------------------------------------------------------------

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const zahl = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Den Elternpfad eines Knotens neu aufsummieren — rekursiv bis zur Wurzel.
 * Summiert alle Geschwister, nicht nur den geaenderten Zweig: das Ergebnis
 * haengt damit nicht davon ab, welcher Knoten den Lauf ausgeloest hat.
 */
async function propagatePayedUpwards(supabase, structureId) {
  const { data: node } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("FATHER_ID")
    .eq("ID", structureId)
    .maybeSingle();
  if (!node || node.FATHER_ID == null) return;
  const parentId = node.FATHER_ID;   // unveraendert weiterreichen, siehe neuSummierenPayed

  const { data: siblings } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("REVENUE, EXTRAS, COSTS, REVENUE_COMPLETION, EXTRAS_COMPLETION, ADVANCE_INVOICED, INVOICED, PAYED")
    .eq("FATHER_ID", parentId);

  if (siblings && siblings.length > 0) {
    const s = (f) => siblings.reduce((acc, c) => acc + zahl(c[f]), 0);
    await supabase.from("PROJECT_STRUCTURE").update({
      REVENUE:            s("REVENUE"),
      EXTRAS:             s("EXTRAS"),
      COSTS:              s("COSTS"),
      REVENUE_COMPLETION: s("REVENUE_COMPLETION"),
      EXTRAS_COMPLETION:  s("EXTRAS_COMPLETION"),
      ADVANCE_INVOICED:   s("ADVANCE_INVOICED"),
      INVOICED:           s("INVOICED"),
      PAYED:              s("PAYED"),
    }).eq("ID", parentId);
  }

  await propagatePayedUpwards(supabase, parentId);
}

/**
 * Den bezahlten Betrag der genannten Knoten aus PAYMENT_STRUCTURE neu
 * summieren und nach oben weitergeben.
 *
 * Bewusst neu summiert statt fortgeschrieben: das Ergebnis haengt dann nicht
 * davon ab, wie oft und in welcher Reihenfolge diese Funktion laeuft — und ein
 * Abbruch mittendrin ist folgenlos, weil der naechste Lauf dasselbe Ergebnis
 * liefert.
 */
async function neuSummierenPayed(supabase, structureIds) {
  // Entdoppeln ueber den String, weitergereicht wird der ORIGINALWERT: eine
  // pauschal in Text verwandelte ID trifft sonst in keinem strikten Vergleich
  // mehr ihre Zeile. PostgREST buegelt das aus, ein Test nicht — und genau
  // deshalb faellt es sonst erst im Betrieb auf.
  const eindeutig = new Map();
  for (const id of structureIds || []) {
    if (id != null) eindeutig.set(String(id), id);
  }

  for (const sid of eindeutig.values()) {
    const { data: zeilen } = await supabase
      .from("PAYMENT_STRUCTURE")
      .select("AMOUNT_PAYED_NET")
      .eq("STRUCTURE_ID", sid);

    const summe = round2((zeilen || []).reduce((s, r) => s + zahl(r.AMOUNT_PAYED_NET), 0));
    await supabase.from("PROJECT_STRUCTURE").update({ PAYED: summe }).eq("ID", sid);
    await propagatePayedUpwards(supabase, sid);
  }
}

module.exports = { neuSummierenPayed, propagatePayedUpwards };

"use strict";

/**
 * Serverfehler nach aussen neutralisieren, nach innen vollstaendig behalten.
 *
 * WAS DAS PROBLEM WAR (Sicherheitsaudit 2026-09-03, M8)
 *   376 Stellen antworten mit `error: e?.message` bzw. `error.message`. Bei
 *   einem Datenbankfehler ist das die PostgREST- oder Postgres-Meldung im
 *   Original — Tabellen- und Spaltennamen, Constraint-Namen, Policy-Texte:
 *
 *     new row violates row-level security policy for table "INVOICE"
 *     column "SE_AMOUNT" of relation "PARTIAL_PAYMENT" does not exist
 *
 *   Für Nutzer ist das unbrauchbar, für jemanden, der das System sondiert,
 *   eine Landkarte. Und weil dieselbe Zeile im Code auch die fachlichen Fehler
 *   ausliefert, lässt sich das nicht durch Suchen und Ersetzen trennen.
 *
 * WARUM EIN FILTER UND KEINE 376 ÄNDERUNGEN
 *   Das Fehlermuster des Projekts ist bewusst so gebaut (siehe CLAUDE.md):
 *   Services werfen `{ status, message }`, Controller reichen beides weiter.
 *   Bei `status < 500` ist die Meldung für den Nutzer gedacht und muss
 *   ankommen ("Pflichtfeld fehlt", "Rechnung ist bereits gebucht"). Nur die
 *   500er sind das Leck.
 *
 *   Diese Unterscheidung steht schon im Statuscode. Sie an 376 Stellen von
 *   Hand nachzuziehen wäre viel Änderung für eine Regel, die sich einmal
 *   formulieren lässt — und jede vergessene Stelle bliebe ein Leck.
 *
 * AUSNAHMEN
 *   Ein paar 500er tragen bewusst eine Meldung, die der Nutzer braucht
 *   ("E-Mail-Versand nicht konfiguriert"). Sie kennzeichnen sich mit
 *   `userFacing: true`; das Feld wird vor dem Senden entfernt.
 *
 * FEHLERREFERENZ
 *   Jede neutralisierte Antwort bekommt eine kurze Kennung, die auch im
 *   Protokoll steht. Damit kann ein Nutzer "Fehler a3f9c1" melden und die
 *   Ursache ist auffindbar — ohne dass die Meldung selbst etwas verrät.
 */

const crypto = require("crypto");

const GENERISCHE_MELDUNG =
  "Es ist ein interner Fehler aufgetreten. Bitte versuchen Sie es erneut. " +
  "Bleibt es dabei, nennen Sie dem Administrator bitte die Fehlerkennung.";

/**
 * Beim Entwickeln ist die Originalmeldung das Wertvollste am Fehler — dann
 * bleibt sie in der Antwort, zusätzlich zur Kennung.
 *
 * Die Bedingung ist bewusst positiv formuliert: NUR ein ausdrückliches
 * NODE_ENV=development öffnet sie. Ein nicht gesetztes oder vertipptes
 * NODE_ENV auf dem Server neutralisiert weiter. Die Umkehrung
 * (`!== "production"`) wäre genau die Falle, die einen Schutz still abschaltet,
 * wenn eine Umgebungsvariable fehlt.
 */
const istEntwicklung = () => process.env.NODE_ENV === "development";

function makeMiddleware() {
  return function errorSanitizer(req, res, next) {
    const echtesJson = res.json.bind(res);

    res.json = (body) => {
      const istServerfehler = res.statusCode >= 500;
      const hatMeldung = body && typeof body === "object" && typeof body.error === "string";

      if (!istServerfehler || !hatMeldung) return echtesJson(body);

      // Bewusst nutzerlesbar: durchlassen, aber den Marker nicht mitsenden.
      if (body.userFacing) {
        const { userFacing, ...rest } = body;
        return echtesJson(rest);
      }

      const ref = crypto.randomBytes(3).toString("hex");
      console.error(
        `[${res.statusCode}] ${req.method} ${req.originalUrl} ` +
        `(Mandant ${req.tenantId ?? "-"}, Mitarbeiter ${req.employeeId ?? "-"}, Kennung ${ref}): ${body.error}`
      );

      // Die uebrigen Felder bleiben: das Frontend wertet Flags wie
      // limit_reached oder upgrade aus, und die verraten nichts.
      const { error: original, ...rest } = body;
      if (istEntwicklung()) return echtesJson({ ...rest, error: original, ref, dev: true });
      return echtesJson({ ...rest, error: GENERISCHE_MELDUNG, ref });
    };

    next();
  };
}

module.exports = { makeMiddleware, GENERISCHE_MELDUNG };

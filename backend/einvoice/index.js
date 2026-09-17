"use strict";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  einvoice/ — das Normwissen der E-Rechnung an einer Stelle
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  | Datei                  | Beantwortet                                     |
 *  |------------------------|-------------------------------------------------|
 *  | `btRegistry.js`        | WELCHES Feld geht in welches XML-Element?        |
 *  | `codelists.js`         | WELCHE Werte darf ein Feld tragen?               |
 *  | `profiles.js`          | WELCHE Ausbaustufe erzeugen wir?                 |
 *  | `referenceDocument.js` | An welchem Beleg wird das geprüft?               |
 *  | `registryCheck.js`     | Stimmt die Tabelle noch mit dem Code überein?    |
 *  | `xmlPaths.js`          | Werkzeug für die Prüfung                         |
 *  | `generateMappingDoc.js`| Erzeugt `docs/EINVOICE_BT_MAPPING.md`            |
 *
 *  Diese Ordnung ersetzt `backend/config/Mapping BT.xlsx` samt ihrem Lader
 *  `services_bt_mapping.js` (Befund S1 im Audit vom 25.08.2026: toter Code).
 *
 *  Die Erzeugung des XML bleibt, wo sie war — in `services_einvoice_cii.js`
 *  und `services_einvoice_ubl.js`. Bewusst: die beiden Builder sind geprüft,
 *  auditiert und gegen Norm-Eigenheiten gehärtet, die sich in einem
 *  generischen Serializer nicht besser ausdrücken ließen (Elementreihenfolge
 *  nach D16B-Sequenz, negative Menge statt negativem Preis beim Storno,
 *  bedingte Gruppen). Getauscht wurde das, was wirklich risikobehaftet war:
 *  die unbeweisbare Tabelle daneben.
 */

module.exports = {
  ...require("./btRegistry"),
  codelists: require("./codelists"),
  profiles: require("./profiles"),
  registry: require("./btRegistry"),
  referenceDocuments: require("./referenceDocument").referenceDocuments,
  runRegistryCheck: require("./registryCheck").runRegistryCheck,
  leafPaths: require("./xmlPaths").leafPaths,
};

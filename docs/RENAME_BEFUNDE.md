# Umbenennung von Tabellen und Spalten — Befunde je Block

Arbeitsunterlage für das Umbenennungsvorhaben. Die Daten selbst stehen in
`backend/scripts/rename/rename-map.json` — hier steht, was man je Block wissen
muss, bevor man ihn anfasst.

> **Stand: gegen die laufende Datenbank geprüft** (16.09.2026). `rename.js check`
> läuft über alle acht Blöcke ohne Befund. Die Spaltenzahlen stammen aus der
> Datenbank, die Fundstellen aus Trockenläufen von `rename.js apply`.
>
> Die erste Fassung dieses Blatts stützte sich auf `db/schema/schema_2026-08-20.sql`
> und lag an drei Stellen daneben: `TEC_REBOOKING` und `WIP_CLOSING_LINE` fehlten
> ganz, und das Schema `REPORTING` war unsichtbar, weil der Dump mit
> `--schema=public` gezogen war. Der Dump ist als Quelle für dieses Vorhaben
> untauglich.

---

## Korrekturen an der Vorlage

Vier Fehler, gefunden beim Abgleich der Liste mit dem Schema:

| Vorlage | Korrigiert zu | Warum |
|---|---|---|
| `OFFER_STRUCTURE.ROLE_NAME_SHORT => ABBR` | `ROLE_ABBR` | `OFFER_STRUCTURE.NAME_SHORT` zeigt auf dasselbe Ziel — zwei Spalten, ein Name. `ROLE_ABBR` ist auch das, was `EMPLOYEE2PROJECT` und `TEC` bekommen |
| `TEC.PARTIAL_PAYMENT_ID => ADVANCED_INVOICE_ID` | `ADVANCE_INVOICE_ID` | überall sonst `ADVANCE` |
| `TEC => BOOKINGS` / `BOOKING.` gemischt | `BOOKING` | Singular wie `BOOKING_TYPE`, `PROJECT`, `INVOICE` |
| `TEC.DATE_VOUCHER => DATE` | `BOOKING_DATE` | `DATE` ist SQL-Typwort; erspart durchgehendes Quoting in den plpgsql-Rümpfen |

**Ergänzte Trägertabellen.** Jede Quellspalte wird jetzt auf *allen* Tabellen
umbenannt, die sie tragen. Bliebe auch nur eine übrig, wäre der Name mehrdeutig
und jede Fundstelle müsste einzeln beurteilt werden (`scope: "table"` statt
`"global"`):

`NAME_SHORT` +`DIN276_COST_ESTIMATE` +`LPH_BLOCK` · `NAME_LONG` +`DIN276_COST_ESTIMATE` ·
`SP_RATE` +`NACHTRAG_STRUCTURE` +`PROJECT_BOOKING_PRICE` · `CP_RATE` +`PROJECT_BOOKING_PRICE` ·
`PARTIAL_PAYMENT_ID` +`INVOICE_DEDUCTION` +`SE_RELEASE` · `ROLE_NAME_SHORT`/`ROLE_NAME_LONG`
+`NACHTRAG_STRUCTURE` · `ARBZG_AUDIT.TEC_ID` · `ARBZG_AUDIT.DATE_VOUCHER`

Die letzten drei sind zusätzlich fachlich nötig: sonst zeigen Fremdschlüssel­spalten
auf Tabellennamen, die es nicht mehr gibt.

**Geklärt: `TEC_REBOOKING`.** Die Tabelle existiert in der Datenbank. Die
zugehörige Migration `0139_booking_rebook.sql` war dort als eingespielt vermerkt,
**die Datei fehlte im Repository** — deshalb kannte weder der Dump noch die
Migrationshistorie die Tabelle. Sie ist aus dem laufenden Schema rekonstruiert
und liegt wieder unter `backend/migrations/`.

Die Spalten aus der Vorlage waren die *Zielnamen* ohne Pfeile. Zugeordnet:
`TEC_ID`→`BOOKING_ID`, `DATE_VOUCHER`→`BOOKING_DATE`, `CP_TOT`→`COST_TOTAL`,
`SP_RATE_BEFORE/AFTER`→`HOURLY_RATE_BEFORE/AFTER`,
`SP_TOT_BEFORE/AFTER`→`HOURLY_RATE_TOTAL_BEFORE/AFTER`, Tabelle →
`BOOKING_REBOOKING`.

**Kein Codepfad benutzt sie.** Die Trockenläufe finden null Fundstellen für
`SP_RATE_BEFORE` und Verwandte; `rebook` und `Umbuchung` kommen repo-weit nicht
vor. Die Tabelle hat 3 Zeilen und keine Fremdschlüssel. Für die Umbenennung
unkritisch — aber es lohnt zu wissen, ob dahinter eine begonnene oder eine
aufgegebene Funktion steht.

---

## Die Blöcke

Reihenfolge: Bezeichnerfamilien zuerst, Tabellen-Renames danach — so trägt jeder
Spalten-Block noch den gültigen Tabellennamen. Darin nach wachsendem Umfang.

| # | Block | Spalten | Fundstellen | Dateien |
|---|---|---|---|---|
| 1 | `01-cost-rate` | 5 | 185 | 28 |
| 2 | `02-hourly-rate` | 12 | 316 | 40 |
| 3 | `03-role-name` | 8 | 181 | 14 |
| 4 | `04-employee-abbr` | 1 | 253 | 62 |
| 5 | `05-advance-invoice` | 13 | 575 | 49 |
| 6 | `06-booking` | 5 | 355 | 50 |
| 7 | `07-abbr` | 29 | 1029 | 104 |
| 8 | `08-name` | 23 | 716 | 97 |

Zusammen rund 3.600 Fundstellen. Block 4 fällt auf: eine einzige Spalte, aber
62 Dateien — `SHORT_NAME` steht überall dort, wo ein Mitarbeiterkürzel angezeigt
wird, und die Anmeldeantwort selbst trägt das Feld als `short_name`.

---

## Welche SQL-Objekte je Block nachgezogen werden müssen

`ALTER … RENAME` fasst plpgsql-Rümpfe nicht an, und Views behalten ihre alten
Ausgabespaltennamen. `rename.js functions --block <id>` erzeugt die zweite
Migration dafür; diese Tabelle sagt, was darin stehen wird.

Aus `rename.js check` gegen die laufende Datenbank — mit Schema `REPORTING`,
das im Dump fehlte:

| Objekt | betroffen in Block |
|---|---|
| `fn_project_report_header` | 01, 02, 04, 05, 06, 07, 08 |
| `fn_project_list_report` | 01, 02, 04, 05, 06, 07, 08 |
| `REPORTING.FN_REPORT_PROJECT_DETAIL` | 01, 04, 05, 06, 07, 08 |
| `fn_project_report_structure` | 01, 02, 06, 07, 08 |
| `fn_dashboard_monthly` | 01, 06 |
| `fn_dashboard_kpis` | 05, 06 |
| `fn_dashboard_by_status` | 07 |
| `protect_arbzg_audit_immutability` | 06 |
| `VW_REPORT_PROJECT_DETAIL` | 04, 05, 07, 08 |
| `VW_REPORT_PROJECT_DETAIL_STRUCTURE` | 01, 06, 07, 08 |
| `VW_REPORT_PROJECT_LIST_ROOT` | 05, 07, 08 |
| `REPORTING.VW_REPORT_PROJECT_DETAIL_STRUCTURE` | 01, 06, 07, 08 |
| `REPORTING.VW_PROJECT_TIME_AGG` | 01, 02, 06 |
| `REPORTING.VW_PROJECT_BILLING_AGG` | 05 |

Block 03 als einziger: **keine SQL-Objekte betroffen.**

**`fn_project_report_header` und `fn_project_list_report` sind in sieben von acht
Blöcken dabei**, `REPORTING.FN_REPORT_PROJECT_DETAIL` in sechs. Deshalb werden
sie erzeugt statt getippt — die erste ist rund 250 Zeilen plpgsql. Die erzeugte
Datei bleibt trotzdem Lesestoff: bei einer `table`-scoped Spalte kann die
Ersetzung im Rumpf zu weit gegriffen haben.

Die vier `REPORTING`-Objekte sind in keiner Migrationsdatei und in keinem Dump
des Repositories enthalten. Sie existieren nur in der Datenbank — `functions`
liest sie von dort.

---

## Was je Block besonders zu beachten ist

**01 — `CP_*` → `COST_*`.** Der Probelauf. Klein, vollständig, keine fachliche
Tücke. Nebenbei: `AdminPage.tsx` erklärt `CP_RATE` und `CP_TOT` im sichtbaren
Hilfetext — dort ist die Ersetzung richtig, der Text bleibt korrekt.

**02 — `SP_RATE` → `HOURLY_RATE`.** Berührt die Honorarkalkulation
(`ROLE.SP_RATE`, `PROJECT_HOURLY_RATES`, `OFFER_STRUCTURE`). Danach
`hoai-kalkulation-reviewer` laufen lassen.

**03 — `ROLE_NAME_*`.** Rein mechanisch, keine SQL-Objekte betroffen. Der
einfachste Block überhaupt.

**04 — `EMPLOYEE.SHORT_NAME` → `ABBR`.** Der Zwilling `short_name` steht in der
**Anmeldeantwort** (`routes/auth.js`) und damit im Auth-Store des Frontends.
Nach diesem Block zuerst die Anmeldung prüfen.

**05 — `PARTIAL_PAYMENT` → `ADVANCE_INVOICE`.** Fachlich der schwerste. Berührt
die E-Rechnung: `services_einvoice_data.js` liest `PARTIAL_PAYMENT` für die
Vorauszahlungs-BTs, und `tests/einvoice_cii_snapshot.test.js` ist ein
Snapshot-Test, der bei jeder Feldänderung anschlägt, die ins XML durchschlägt.
`erechnung-reviewer` einplanen. Sechs Tabellen tragen `PARTIAL_PAYMENT_ID`.

**06 — `TEC` → `BOOKING`.** Die Vorarbeit ist erledigt: `TEC` stand an acht
Stellen als deutscher Oberflächentext („Stunden/TEC"), sechs davon sichtbar.
Ein blinder Wortgrenzen-Ersatz hätte daraus „Stunden/BOOKING" gemacht — ohne
Fehler, ohne Test, der es merkt. Übrig sind zwei Code-Kommentare, die der
Codemod mitnehmen darf. Zweiter Punkt: `ARBZG_AUDIT` hat Schutz-Trigger gegen
Änderungen (`protect_arbzg_audit_immutability`) — prüfen, ob sie einem `ALTER`
im Weg stehen.

**07 — `NAME_SHORT` → `ABBR`.** Der größte Block, 29 Tabellen. Nach der
Ergänzung der Restträger vollständig automatisierbar. `ABBR` liegt danach auf
30 Tabellen (mit `EMPLOYEE` aus Block 04), ist also für künftige Umbenennungen selbst wieder mehrdeutig.

**08 — `NAME_LONG` → `NAME`.** 23 Tabellen. `NAME` existiert bereits auf
`ABSENCE_TYPE`, `BREAK_RULE`, `DOCUMENT_TEMPLATE`, `FEE_CALCULATION_BL`,
`PUBLIC_HOLIDAY`, `WORKING_TIME_MODEL` — keine Kollision, weil keine dieser
Tabellen ein `NAME_LONG` trägt (geprüft). Der Zwilling `name_long` → `name` ist
in der Map ausgeschrieben statt abgeleitet, weil `name` als Kleinwort überall
vorkommt und als Zielname mit lokalen Variablen kollidieren kann.

---

## Stellen, die kein Suchlauf findet

Bezeichner, die zur Laufzeit zusammengesetzt werden. Weder Codemod noch Guard
sehen sie, weil der Token nirgends wörtlich dasteht. `rename.js check` und
`apply` melden die erste Gruppe; die zweite steht als feste Leseliste in der Map
unter `alwaysReview`, weil dort der Spaltenname vollständig aus einer Variablen
kommt und es nichts zu suchen gibt.

| Stelle | Muster |
|---|---|
| `services/nachtraege.js:312-342` | `` `SURCHARGE_${i}_LABEL/_PCT/_CUMUL` `` über `[1,2,3]` |
| `services/einvoiceSnapshot.js:58` | `` `XML_ZUGFERD_${docType}` `` |
| `services/emailTemplates.js:218` | `` .select(`ID, ${numberCol}, ${dateCol}, …`) `` |
| `services/stammdaten.js:7-12,143,342` | `FEE_ZONE_COLUMN_BY_ROMAN` baut `ZONE_*`-Namen |
| `services/dependencyCheck.js` | `safeReferences(table, selectFields, filter)` |
| `services/importService.js` | `DOMAINS`-Registry: `table`, `dependents[].column` |
| `demo/exportTenant.js`, `demo/seed/lib/reset.js` | Tabellenlisten als Konstanten |

Dazu eine Regel, die beim Bauen aufgefallen ist: **Kommentare in den gescannten
Wurzeln werden mitgeändert.** Meistens richtig — ein Kommentar über eine Spalte
soll ihr folgen. Falsch wird es, wo der Kommentar über die Umbenennung selbst
spricht; solche Sätze dürfen die Altnamen nicht wörtlich nennen.

---

## Womit geprüft wird

Jede Stufe findet etwas, das die vorige durchlässt:

| Stufe | findet |
|---|---|
| `rename.js check` | Altname fehlt, Ziel kollidiert, Spalte mehrdeutig, betroffene SQL-Objekte |
| `rename.js guard` | Altbezeichner im Code — außer den zusammengesetzten |
| `tsc -b` | nur getypte Zugriffe; dynamische (`a[sortKey as keyof Address]`) und ~120 String-Literale fallen durch |
| Jest / Vitest / Playwright | Logik-Regressionen, **keine** Rename-Fehler |
| `rename.js verify` | DB entspricht der Map, kein Funktionsrumpf nennt den Altnamen |
| `smoke.mjs` | der Durchstich: `undefined` aus Property-Reads, leere PDF-Felder, gebrochene Report-Funktionen |

Der Rauchtest entscheidet, ob ein Block fertig ist. Er prüft nicht nur
Statuscodes, sondern liest die Map: kommt jeder **neue** Name in einer Antwort
an, taucht noch ein **alter** auf, haben die PDFs Substanz. Ein alter Name in
einer Antwort ist fast immer eine View, die ihre Ausgabespalten behalten hat.

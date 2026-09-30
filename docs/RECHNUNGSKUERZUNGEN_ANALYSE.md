# Rechnungskürzungen und Restposten — Ist-Stand, Rechtslage, Vorschlag

Stand: 30.09.2026, geprüft gegen `origin/main` `adb9742`. Branch `feature/rechnungslegung`.

Zwei Fragen stehen im Mittelpunkt:

1. **Kürzung akzeptieren.** Der Kunde zahlt weniger, das Büro akzeptiert es. Muss
   storniert werden, oder lässt sich die Kürzung anders abbilden?
2. **Teilzahlung, Rest wird noch erwartet.** Wie wird der Rest geführt, und wird er
   in der nächsten Rechnung nicht doppelt abgerechnet?

---

## Kurzantwort

| | Heute in plan&simple | Was richtig wäre |
|---|---|---|
| **Kürzung akzeptieren** | Nur Voll-Storno + neue Rechnung. Die „Gutschrift" taugt dafür nicht (siehe unten). Ohne Storno bleibt der Rest **für immer offen** und wird gemahnt. | Eine reine Entgeltminderung (Skonto, Nachlass wegen Mängelrüge, Kulanz) braucht **keine** Rechnungsberichtigung (BMF 15.10.2025, Rn. 51a). Es fehlt eine Funktion „Rest ausbuchen" mit Grund. Nur wenn sich die **Leistung** ändert (Aufmaß, Umfang), ist eine Rechnungskorrektur nötig — dann als E-Rechnung mit Bezug auf das Original (Rn. 51b). |
| **Rest erwartet, nächste Abschlagsrechnung** | Richtig: abgezogen wird das bisher **Abgerechnete**, nicht das Bezahlte. Der Rest bleibt auf der alten Abschlagsrechnung offen und wird nicht doppelt berechnet. | — |
| **Rest erwartet, Schlussrechnung** | Lücke: die Schlussrechnung zieht die Abschläge mit dem **fakturierten** Betrag ab. Der offene Rest steht danach weder in der Schlussrechnung noch ist er noch durchsetzbar — wird aber weiter gemahnt. | Abzuziehen sind die **vereinnahmten** Teilentgelte (§ 14 Abs. 5 S. 2 UStG, UStAE 14.8 Abs. 7). Der offene Rest geht in die Schlussrechnung ein, die Abschlagsrechnung gilt danach als erledigt. |

Deine Annahme „bei E-Rechnungen muss ich die Rechnung anpassen" stimmt also nur zur
Hälfte: bei einer geänderten **Leistung** ja, bei einer bloßen **Kürzung des
Entgelts** nein.

---

## 1. Wie plan&simple heute rechnet

| Größe | Wie gerechnet | Wo |
|---|---|---|
| Zahlungseingang | eine `PAYMENT`-Zeile je Eingang, Netto/USt aus dem Brutto zurückgerechnet, anteilig auf die Strukturelemente verteilt | [routes/payments.js](../backend/routes/payments.js) |
| Offener Betrag (Mahnwesen, Fälligkeitshinweise) | `TOTAL_AMOUNT_GROSS − Σ Zahlungen` | [mahnungenService.js](../backend/services/mahnungenService.js), [dueDateChecker.js](../backend/services/dueDateChecker.js) |
| Offener Betrag (Rechnungsliste) | wie oben, aber **abzüglich Sicherheitseinbehalt**, und **0**, sobald der Betrag abzüglich Skonto bezahlt ist — ohne Prüfung der Skontofrist | [RechnungenListe.tsx](../frontend-react/src/pages/rechnungen/RechnungenListe.tsx) `fromInvoice`/`fromPp` |
| Storno | Vollstorno, sofort gebucht, Nummer `S-…`, Belegart 384; Zahlungen wahlweise löschen oder am stornierten Original lassen | `cancelInvoice` in [services/invoices.js](../backend/services/invoices.js) |
| „Gutschrift" | technisch eine Einzelrechnung mit `INVOICE_TYPE = 'gutschrift'` und Belegart 381 | [invoiceKinds.ts](../frontend-react/src/components/rechnungen/invoiceKinds.ts), [codelists.js](../backend/einvoice/codelists.js) |
| Nächste Abschlagsrechnung | Vorschlag = Leistungsstand − bisher **abgerechnet**; PDF „abzgl. bisheriger Abschlagsrechnungen" | `loadPreviouslyBilledByStructure`, [invoice.njk](../backend/templates/modern_a/invoice.njk) |
| Schlussrechnung | „abzgl. Abschlagsrechnungen" mit dem **fakturierten** Netto je Abschlag (je Abschlag änderbar); XML: BT-113 „bereits bezahlt" = fakturiertes Brutto − Einbehalt | `getDeductions` in [finalInvoices.js](../backend/services/finalInvoices.js), [services_einvoice_data.js](../backend/services_einvoice_data.js) |

Es gibt **kein** Feld und keine Tabelle für „akzeptierte Kürzung", „ausgebucht" oder
„in Schlussrechnung aufgegangen". Alles, was nicht als Zahlung erfasst ist, bleibt offen.

---

## 2. Szenario 1: Kürzung akzeptieren

### Rechtslage

- **Reine Entgeltminderung** (Skonto, Rabatt, Nachlass wegen Mängelrüge ohne
  Auswirkung auf die abgerechnete Leistung, Rückgängigmachung): nach § 17 UStG
  mindert sich die Bemessungsgrundlage, eine Rechnungsberichtigung ist **nicht
  erforderlich** (BMF 15.10.2025, Rn. 51a; UStAE 17.1 Abs. 8). Die USt wird im
  Zeitraum der Minderung berichtigt — das ist Sache der Buchhaltung, plan&simple muss
  den Vorgang aber **nachweisbar festhalten** (Datum, Betrag, USt-Anteil, Grund).
- **Änderung der Leistung** (Aufmaß, Leistungsumfang): das ist keine bloße Minderung;
  die Rechnung ist zu berichtigen, mindestens die Leistungsbeschreibung (Rn. 51b).
  Auch per Gutschrift des Kunden möglich, dann mit eindeutigem Bezug auf die
  Ursprungsrechnung (§ 31 Abs. 5 UStDV).
- **Form**: war das Original eine E-Rechnung, muss auch die Berichtigung eine sein,
  mit spezifischem und eindeutigem Bezug auf das Original (BMF 15.10.2024).
- **Begriff**: „Gutschrift" heißt im Umsatzsteuerrecht die Abrechnung **durch den
  Leistungsempfänger** (§ 14 Abs. 2 S. 5 UStG). Was plan&simple „Gutschrift" nennt, ist
  eine kaufmännische Gutschrift bzw. Rechnungskorrektur. Der Name ist irreführend.

### Was heute geht und was nicht

**Storno + neue Rechnung** funktioniert, ist aber schwerfällig: neue Nummer, neuer
Beleg, und die Zahlungen bleiben entweder am stornierten Original hängen oder werden
gelöscht und müssen neu erfasst werden. Übertragen lassen sie sich nicht.

**Die „Gutschrift" ist für eine Kürzung ungeeignet**, und zwar aus sechs Gründen:

1. **Kein Bezug zum Original.** Weder `CANCELS_INVOICE_ID` noch BT-25 werden
   gesetzt — die Pflicht aus § 31 Abs. 5 UStDV ist nicht erfüllbar.
2. **Falsches Vorzeichen.** Der Assistent verteilt einen **positiven** Leistungsbetrag
   (`applyPerformanceAmount` verwirft alles ≤ 0), und `bookInvoice` **erhöht**
   `INVOICED` an Projekt und Struktur. Eine Gutschrift über 5.000 € steigert also das
   Abgerechnete um 5.000 €; „Teilfertige Leistungen" und Reporting rechnen falsch.
3. **Sie wird zur Forderung.** Rechnungsliste, Mahnwesen und Fälligkeitshinweise
   behandeln sie wie eine Rechnung — mit Fälligkeitsdatum wird eine Gutschrift gemahnt.
4. **Das Original bleibt offen.** Nichts verrechnet die Gutschrift mit der Rechnung,
   die sie mindern soll.
5. **E-Rechnung.** Im UBL steht Belegart 381 in einer `Invoice`-Wurzel
   (Kommentar in [services_einvoice_ubl.js](../backend/services_einvoice_ubl.js):
   „kept as Invoice for simplicity"). Peppol verlangt dafür eine `CreditNote`-Wurzel
   (Regeln PEPPOL-EN16931-P0100/P0101) — der Peppol-Export einer Gutschrift wird
   abgewiesen. Für XRechnung-UBL ist das mit dem KoSIT-Validator zu prüfen.
6. **Zwei Vorzeichen nach dem Merge.** `feature/rechnungsimport` (noch nicht in
   `main`) speichert importierte Gutschriften mit **negativen** Beträgen, der
   Assistent mit positiven. Das muss vor dem Merge einheitlich werden.

**Ohne Storno** bleibt der gekürzte Rest dauerhaft offen: er steht in den Offenen
Posten, landet im Mahnwesen und erzeugt Fälligkeitshinweise.

**Skonto** ist ein Sonderfall derselben Lücke: die Liste zeigt eine Skontozahlung als
erledigt (auch nach Ablauf der Frist), Mahnwesen und Fälligkeitshinweise rechnen den
Skontobetrag als offen und mahnen ihn.

### Vorschlag

**A — „Rest ausbuchen" (Forderungsminderung), ohne neuen Beleg.** Für den häufigen
Fall der reinen Entgeltminderung.

- Neue Tabelle, z. B. `RECEIVABLE_ADJUSTMENT`: Beleg (`INVOICE_ID` oder
  `ADVANCE_INVOICE_ID`), Datum, Betrag brutto/netto/USt, **Grund**
  (Skonto · Kürzung/Mängel · Kulanz/Nachlass · Forderungsausfall · Rundung), Kommentar.
- **Eine** Funktion für den offenen Betrag im Backend:
  `Brutto − Einbehalt − Σ Zahlungen − Σ Minderungen`. Liste, Mahnwesen,
  Fälligkeitshinweise und Reports lesen sie — heute rechnen drei Stellen drei
  verschiedene Werte.
- Im Zahlungsdialog: ist die Zahlung kleiner als der offene Betrag, fragt plan&simple
  „Rest offen lassen" oder „Rest ausbuchen" (Grund wählbar, Skonto vorbelegt, wenn die
  Frist eingehalten ist).
- **Offene Fachfrage (Entscheidung nötig):** Soll eine Kürzung das *Abgerechnete*
  mindern (der Betrag wird mit der nächsten Abschlagsrechnung wieder abrechenbar —
  typisch, wenn der Kunde den Leistungsstand bestreitet) oder das *Honorar* (endgültiger
  Nachlass)? Vorschlag: beides anbieten, als Feld „wieder abrechenbar ja/nein". Beim
  endgültigen Nachlass muss die Schlussrechnung ihn als eigene Zeile „abzgl.
  vereinbarter Minderung" zeigen, sonst stimmt das Gesamtentgelt nicht.

**B — Echte Rechnungskorrektur**, für geänderte Leistung.

- „Gutschrift" umbenennen in „Rechnungskorrektur" (Pflicht-Bezug auf das Original,
  BT-25 + `BillingReference`).
- Intern negative Beträge (einheitlich mit dem Import), `INVOICED` sinkt, der Betrag
  wird mit dem offenen Betrag des Originals verrechnet, kein Mahnwesen.
- E-Rechnung: UBL als `CreditNote` mit 381 oder wie beim Storno als 384 mit negativen
  Mengen (BR-27). Vor der Umsetzung klären, was die Empfänger erwarten.

**C — Storno + Neu komfortabler.** Eine Aktion „Stornieren und neu ausstellen", die
das Original als Entwurf kopiert und die Zahlungen auf die neue Rechnung **überträgt**.

---

## 3. Szenario 2: Teilzahlung, Rest wird noch erwartet

### Ist

- Die Teilzahlung wird erfasst, der Rest bleibt offen, Mahnwesen und
  Fälligkeitshinweise greifen. **Richtig.**
- **Nächste Abschlagsrechnung:** der Vorschlag zieht das bisher *Abgerechnete* ab
  (`loadPreviouslyBilledByStructure`, auch mit Storno-Paaren), das PDF zeigt
  „abzgl. bisheriger Abschlagsrechnungen". Der Rest steht weiter auf der alten
  Abschlagsrechnung und wird **nicht doppelt** berechnet. **Richtig.**
- **Schlussrechnung:** `getDeductions` schlägt je Abschlag den **fakturierten**
  Nettobetrag zum Abzug vor. Das hat drei Folgen:
  1. **Steuerlich:** In der Endrechnung sind die **vereinnahmten** Teilentgelte samt
     USt abzusetzen (§ 14 Abs. 5 S. 2 UStG, UStAE 14.8 Abs. 7). Ist eine Anzahlung
     niedriger vereinnahmt als in Rechnung gestellt, entsteht die USt nur auf das
     Vereinnahmte (UStAE 14.8 Abs. 5). Im XML behauptet BT-113 „bezahlt", setzt aber
     den fakturierten Betrag ein — der Kommentar im Code sagt „vereinnahmt", der Code
     rechnet „fakturiert".
  2. **Zivilrechtlich:** Nach Abnahme und Schlussrechnung kann eine Abschlagsforderung
     nicht mehr gesondert geltend gemacht werden (BGH, 20.08.2009, VII ZR 205/07 —
     zum Bauvertrag entschieden; ob und wie das für den konkreten Planervertrag gilt,
     sollte anwaltlich bestätigt werden). Der offene Rest ist dann **in der
     Schlussrechnung nicht enthalten und separat nicht mehr durchsetzbar** —
     plan&simple mahnt ihn trotzdem weiter.
  3. **Der Umweg erzeugt die Doppelung.** Setzt man den Abzug von Hand auf das
     Bezahlte, steht der Rest in der Schlussrechnung **und** bleibt auf der
     Abschlagsrechnung offen — genau die doppelte Forderung, die du befürchtest.

### Vorschlag

- Die Schlussrechnung setzt je Abschlag das **Vereinnahmte** ab (Σ Zahlungen, getrennt
  nach Entgelt und USt) und zeigt je Abschlag: fakturiert · vereinnahmt · offen. Der
  offene Rest steckt damit in der Restforderung der Schlussrechnung.
- Beim Buchen der Schlussrechnung werden die abgesetzten Abschläge als „in
  Schlussrechnung aufgegangen" markiert (z. B. `ADVANCE_INVOICE.SETTLED_BY_INVOICE_ID`).
  Ihr offener Betrag ist ab dann 0: kein Mahnwesen, keine Fälligkeitshinweise. Eine
  spätere Zahlung auf eine solche Abschlagsrechnung leitet der Zahlungsdialog auf die
  Schlussrechnung um.
- Das Vereinnahmte wird **beim Buchen** neu gelesen, nicht beim Anlegen des
  Entwurfs — Zahlungen zwischen Entwurf und Buchung fließen sonst nicht ein.
- Mit Sicherheitseinbehalt abstimmen: heute gilt „vereinnahmt = fakturiert − Einbehalt"
  (Befund N10). Mit echten Zahlungen muss die Auflösung des Einbehalts dazu passen.
- Teilschlussrechnungen genauso.

---

## 4. Nebenbefunde

1. **Offener Betrag an drei Stellen verschieden** (Liste / Mahnwesen /
   Fälligkeitshinweise). Folge: Skontozahler und einbehaltene Sicherheiten werden
   gemahnt, die Liste nennt dieselbe Rechnung erledigt. Behebt sich mit Vorschlag A.
2. **XML der Schlussrechnung zieht doppelt ab — bestätigt und in (b) behoben.**
   `finalInvoices.recomputeTotal` speichert `TOTAL_AMOUNT_NET = Honorar − Abzüge`. Im
   XML waren die Positionen das volle Honorar, BT-109 dieser Restbetrag und BT-113 zog
   die Abschläge ein zweites Mal ab: BR-CO-13 schlug fehl (Buchen nur mit „trotzdem
   buchen"), und bei 100.000 € Honorar und 30.000 € Abschlag forderte das XML
   47.600 € statt 83.300 €. Der Test [einvoice_security_retention.test.js](../backend/tests/einvoice_security_retention.test.js)
   hatte `TOTAL_AMOUNT_NET` = volles Honorar angelegt, also nicht so, wie der echte
   Weg speichert.
3. **Storno mit „Zahlungen löschen" lässt `PAYED` stehen.** `cancelInvoice` (und das
   Gegenstück bei Abschlägen) rechnet `PROJECT_STRUCTURE.PAYED` nur für Elemente neu,
   die **noch** Zahlungen haben. War die gelöschte Zahlung die einzige, bleibt der alte
   Wert stehen; die Väter werden nicht nachgezogen. Die Variable `affectedSids` ist
   toter Code.
4. **Überzahlung ohne Hinweis.** `POST /payments` prüft nur `> 0`, nicht gegen den
   offenen Betrag; der offene Betrag wird negativ.

---

## 5. Entscheidungen und Umsetzungsstand

Entschieden am 30.09.2026:

1. „Wieder abrechenbar" und „endgültig" — **beides**.
2. Recht für „Rest ausbuchen" — **`payments.create`** (Löschen `payments.delete`).
3. „Gutschrift" wird **„Rechnungskorrektur"**.
4. Reihenfolge (a) → (b) → (c) → (d) wie vorgeschlagen.
5. Einbehalt in der Schlussrechnung — **nur Gezahltes abziehen**: der nie gezahlte
   Einbehalt steht im Restentgelt; eine separate Auflösung gibt es nur noch für
   Abschläge, die diese Rechnung nicht abzieht.

| Schritt | Stand |
|---|---|
| (a) Rest ausbuchen + ein offener Betrag | umgesetzt (Migration 0177, `openAmount.js`, `receivableAdjustments.js`, `ZahlungDialog.tsx`). Nebenbefund 1 behoben, dazu: Mahnungs-PDF forderte den vollen Betrag trotz Teilzahlung, Mahnstatistik und Mahn-Checker zählten bezahlte Belege. |
| (b) Schlussrechnung auf Vereinnahmtes + „aufgegangen" | umgesetzt (Migration 0178, `arDeduction.js`, `refreshDeductions`, XML als Restrechnung). Nebenbefund 2 behoben. |
| (c) Rechnungskorrektur statt Gutschrift | offen |
| (d) Storno + Neu mit Zahlungsübertrag | offen |

---

## Quellen

- BMF-Schreiben vom 15.10.2025 (E-Rechnung, 2. Schreiben), Rn. 51a/51b —
  [bundesfinanzministerium.de](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-10-15-einfuehrung-obligatorische-e-rechnung.pdf)
- BMF-Schreiben vom 15.10.2024 (E-Rechnung), Rechnungsberichtigung —
  [NWB](https://datenbank.nwb.de/Dokument/1046425/)
- UStAE 14.8 (Rechnungserteilung bei Anzahlungen, Endrechnung) —
  [NWB](https://datenbank.nwb.de/Dokument/378652_14___8/)
- § 14 UStG — [gesetze-im-internet.de](https://www.gesetze-im-internet.de/ustg_1980/__14.html)
- BGH, Urt. v. 20.08.2009 – VII ZR 205/07 —
  [dejure.org](https://dejure.org/dienste/vernetzung/rechtsprechung?Text=VII+ZR+205%2F07)
- Peppol BIS Billing 3.0, PEPPOL-EN16931-P0101 —
  [docs.peppol.eu](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/PEPPOL-EN16931-P0101/)
- Vergleich: gleicher Befund im Projekt opengewerk —
  [opengewerk#189](https://github.com/opengewerk/opengewerk/issues/189)

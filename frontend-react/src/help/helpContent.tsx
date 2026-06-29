import type { ReactNode } from 'react'

/**
 * Zentrale Hilfe-Registry — eine Quelle der Wahrheit für alle erklärenden
 * Tooltips/Hilfetexte im Produkt.
 *
 * Warum zentral: Wording bleibt konsistent, Begriffe werden überall gleich
 * erklärt (z. B. „Deckungsbeitrag" in mehreren Reports), und bei
 * Funktionsänderungen muss nur EINE Stelle gepflegt werden.
 *
 * Verwendung im UI:  <HelpHint id="einvoice.what" />
 * Naming-Konvention: "<modul>.<thema>" (kebab/snake im Thema erlaubt).
 *
 * Tonalität: sachlich, B2B, deutsch. Erklärt das WAS/WARUM und was einzugeben
 * ist — nicht das Label wiederholen. Siehe docs/HELP_TOOLTIP_CONCEPT.md.
 */
export interface HelpEntry {
  title: string
  body: ReactNode
}

export const HELP = {
  // ── Geführter Datenimport (Onboarding) ───────────────────────────────────
  'import.overview': {
    title: 'Geführter Datenimport',
    body: (
      <>
        Übernimm bestehende Daten aus Excel/CSV, statt alles neu zu tippen. Der Import läuft in drei
        Schritten: <strong>Vorlage füllen → hochladen & prüfen → importieren</strong>. Es wird nichts
        gespeichert, bevor du die Vorschau bestätigt hast. Jeder Import ist ein nachvollziehbarer
        „Stapel", den du als Ganzes wieder zurücksetzen kannst.
      </>
    ),
  },
  'import.template': {
    title: 'Vorlage verwenden',
    body: (
      <>
        Die heruntergeladene Excel-Vorlage hat genau die richtigen Spalten (Pflichtfelder mit
        <code> *</code>) und eine Beispielzeile. Wenn du sie nutzt, ordnet das System die Spalten
        automatisch korrekt zu und es entstehen kaum Fehler. Eigene Dateien gehen auch — dann ggf. die
        Zuordnung im nächsten Schritt anpassen.
      </>
    ),
  },
  'import.mapping': {
    title: 'Spalten zuordnen',
    body: (
      <>
        Jedes Feld in plan&simple wird einer Spalte deiner Datei zugeordnet. Die Zuordnung wird anhand
        der Spaltenüberschriften automatisch vorgeschlagen. Stimmt etwas nicht, hier per Auswahlfeld
        korrigieren — die Vorschau aktualisiert sich sofort. Nicht benötigte Felder auf
        „nicht importieren" stellen.
      </>
    ),
  },
  'import.preview': {
    title: 'Vorschau & Status',
    body: (
      <>
        Jede Zeile bekommt einen Status: <strong>OK</strong> (wird importiert),
        <strong> Dublette</strong> (gibt es schon — wird standardmäßig übersprungen) oder
        <strong> Fehler</strong> (Pflichtangabe fehlt/ungültig — wird übersprungen, mit Hinweis).
        Importiert werden nur OK-Zeilen. Fehlerhafte Zeilen in der Datei korrigieren und erneut
        hochladen.
      </>
    ),
  },
  'import.duplicates': {
    title: 'Dubletten',
    body: (
      <>
        Eine Dublette ist ein Datensatz, den es bereits gibt oder der doppelt in der Datei steht
        (erkannt z. B. an Name + PLZ). Standardmäßig werden Dubletten übersprungen, damit nichts
        doppelt entsteht. Nur aktivieren, wenn du sie bewusst zusätzlich anlegen willst.
      </>
    ),
  },
  'import.doc_type': {
    title: 'Beleg-Art des Anfangsbestands',
    body: (
      <>
        „Bereits berechnet" wird als echter, gebuchter Beleg am Projekt hinterlegt (ohne PDF/E-Rechnung),
        damit Reporting und offene Posten korrekt sind. Du wählst die Art:
        <br /><strong>Abschlagsrechnung</strong> — für laufende Projekte, bei denen noch eine
        Schlussrechnung folgt. Der Betrag wird bei der späteren Schlussrechnung automatisch abgezogen.
        <br /><strong>Rechnung</strong> — für bereits einzeln/abschließend berechnete Beträge.
        <br />Der Betrag darf die Honorarsumme des Projekts nicht übersteigen. Optional kann in der
        Spalte „Bereits bezahlt" der bereits gezahlte Anteil mitgegeben werden — er wird als echte
        Zahlung gegen den Beleg gebucht, sodass die offenen Posten ab Tag 1 stimmen.
      </>
    ),
  },
  'import.structure_mode': {
    title: 'Leistungsstruktur beim Honorar-Import',
    body: (
      <>
        Die Honorarsumme wird als Leistungsstruktur am Projekt gespeichert. Du wählst, wie:
        <br /><strong>Eine Honorar-Position</strong> — die volle Summe als ein Pauschal-Posten. Einfach,
        immer korrekt, sofort abrechenbar; eine Aufteilung in Leistungsphasen ist später im
        HOAI-Assistenten möglich.
        <br /><strong>HOAI-Leistungsphasen LP1–9</strong> — die Summe wird nach den Standard-Prozentsätzen
        des §34 (Gebäude) auf neun Phasen verteilt. Vollständiger, aber schematisch — bei real nur
        teilweise erbrachten Altprojekten meist nachzubearbeiten.
        <br />Für stundenbasierte Projekte (Abrechnungsart „Stunden") wird die Struktur ohne festen
        Erlös angelegt (die Summe dient dann als Budget-Orientierung).
      </>
    ),
  },
  'import.rollback': {
    title: 'Import zurücksetzen',
    body: (
      <>
        Jeder Import lässt sich vollständig rückgängig machen — alle damit angelegten Datensätze werden
        gelöscht. <strong>Schutz:</strong> Hängt inzwischen andere Arbeit daran (z. B. ein Projekt an
        einer importierten Adresse), wird das Zurücksetzen blockiert und nennt dir, was im Weg steht.
      </>
    ),
  },

  // ── Buchungsarten: Pauschalen & Stückleistungen ──────────────────────────
  'bookings.special': {
    title: 'Pauschalen & Stückleistungen',
    body: (
      <>
        Neben Stunden lassen sich auch nicht-stundenbasierte Kosten/Leistungen auf
        ein Projekt buchen:
        <br /><strong>Stückleistung</strong> = Menge × Stückpreis (z. B. 50 Pläne ×
        12 €), optional mit Stückkosten.
        <br /><strong>Pauschale (Kosten)</strong> = feste Summe, die das Projekt
        belastet (z. B. eine erhaltene Lieferantenrechnung).
        <br /><strong>Pauschale (Erlös)</strong> = feste, abrechenbare Summe.
        <br />Erlös-Positionen werden auf Stunden-Projektelementen genauso
        abgerechnet wie Stundenbuchungen. Diese Buchungen zählen <em>nicht</em> als
        Arbeitszeit (kein Einfluss auf Saldo/Produktivität). Vordefinierte
        Buchungsarten kommen aus dem Katalog (Einstellungen → Stammdaten); per
        „Freitext" geht es auch ohne Katalog-Eintrag.
      </>
    ),
  },
  'bookings.text_snippets': {
    title: 'Textbausteine',
    body: (
      <>
        Persönliche, wiederkehrende Beschreibungstexte für deine Stunden-Buchungen.
        Mit „Als Baustein speichern" sicherst du den aktuellen Beschreibungstext;
        ein Klick auf einen Baustein fügt ihn in die Beschreibung ein. Die Bausteine
        sind privat (nur für dich sichtbar).
      </>
    ),
  },
  'settings.booking_text_templates': {
    title: 'Textvorlagen für Stundenleistungen',
    body: (
      <>
        Wiederkehrende Beschreibungstexte, die <strong>allen</strong> Mitarbeitern beim
        Buchen von <strong>Stundenleistungen</strong> als Baustein zur Auswahl stehen
        (z. B. „Abstimmung mit Bauherr", „Vor-Ort-Termin"). Texte für Pauschalen oder
        Stückleistungen werden direkt bei der jeweiligen <strong>Buchungsart</strong>
        gepflegt. Ergänzend legt jeder Mitarbeiter eigene, private Bausteine an. Ein
        Klick fügt den Text in die Beschreibung ein.
      </>
    ),
  },
  'settings.booking_types': {
    title: 'Katalog der Buchungsarten',
    body: (
      <>
        Vordefinierte Pauschalen und Stückleistungen mit Standardpreis — das Pendant
        zu den Mitarbeiter-Rollen mit Stundensätzen. Beim Buchen werden sie
        ausgewählt und füllen Bezeichnung und Preis vor.
        <br /><strong>Stückleistung</strong>: Standard-Stückpreis (Verkauf) und
        optional Stückkosten, dazu eine Einheit (Stk, m², …).
        <br /><strong>Pauschale</strong>: ein Standardbetrag (Kosten- oder
        Erlös-Pauschale). Einträge mit Geltung „global" stehen in allen Projekten
        zur Auswahl.
      </>
    ),
  },

  // ── E-Rechnung / Peppol ──────────────────────────────────────────────────
  'einvoice.what': {
    title: 'Was ist eine E-Rechnung?',
    body: (
      <>
        Eine E-Rechnung ist eine maschinenlesbare Rechnung im strukturierten
        XML-Format (XRechnung, als CII oder UBL) — kein PDF-Bild, sondern Daten,
        die der Empfänger automatisch einlesen kann. Für öffentliche Auftraggeber
        (Behörden) ist sie Pflicht; zunehmend auch im B2B-Bereich. plan&simple
        erzeugt sie serverseitig aus den Rechnungsdaten.
      </>
    ),
  },
  'einvoice.leitweg': {
    title: 'Leitweg-ID',
    body: (
      <>
        Eindeutige Adressierungs-Kennung des öffentlichen Empfängers im
        XRechnung-Standard (Format z. B. <code>991-12345-67</code>). Du erhältst
        sie von deinem Auftraggeber — ohne sie kann eine Behörde die E-Rechnung
        nicht zuordnen. Nur für Rechnungen an öffentliche Stellen nötig.
      </>
    ),
  },
  'einvoice.peppol': {
    title: 'Wofür ist Peppol?',
    body: (
      <>
        Peppol ist ein europäisches Netzwerk zum direkten elektronischen Versand
        von E-Rechnungen an Behörden und große Unternehmen. <strong>Du brauchst es
        nur</strong>, wenn du über Peppol zustellen willst — für PDF- oder
        E-Mail-Rechnungen ist es nicht erforderlich. Endpoint-ID = deine Kennung
        im Netz (oft die USt-IdNr.); Schema (EAS) gibt deren Typ an. Beides
        bekommst du bei deinem Peppol-Access-Point-Anbieter.
      </>
    ),
  },

  // ── Dokumentvorlagen / Branding ──────────────────────────────────────────
  'vorlagen.accent': {
    title: 'Hausfarbe',
    body: (
      <>
        Die Farbe, in der die Überschriften deiner PDF-Dokumente erscheinen (z. B.
        „Rechnung", „Angebot"). Wähle eine zur Außenwirkung deines Büros passende
        Farbe oder lege über das Feld <strong>+</strong> eine eigene fest. Die Wirkung
        siehst du sofort rechts in der Vorschau.
      </>
    ),
  },
  'vorlagen.font': {
    title: 'Schrift',
    body: (
      <>
        Die Schrift für den gesamten Belegtext. <strong>Serifenlose</strong> Schriften
        (Inter, Roboto, Montserrat …) wirken modern und sachlich, <strong>Serif</strong>-
        Schriften (Merriweather, Lora, Playfair …) klassisch und seriös. Jede Schrift
        wird fest in das PDF eingebettet, damit der Beleg bei jedem Empfänger und Drucker
        identisch aussieht.
      </>
    ),
  },
  'vorlagen.logo': {
    title: 'Logo-Position',
    body: (
      <>
        Legt fest, ob dein Firmenlogo oben <strong>links</strong>, <strong>mittig</strong>
        oder <strong>rechts</strong> steht. Das Logo selbst lädst du unter
        <strong> Einstellungen → Unternehmen</strong> hoch — ohne hinterlegtes Logo
        zeigt die Vorschau einen Platzhalter.
      </>
    ),
  },

  'vorlagen.preset': {
    title: 'Stil-Vorlage',
    body: (
      <>
        Ein fertiger Look als Startpunkt: ein Klick setzt <strong>Hausfarbe</strong>,
        <strong> Schrift</strong> und <strong>Logo-Position</strong> gemeinsam. Danach
        kannst du jedes Detail einzeln anpassen — die Stil-Vorlage ist nur die
        Ausgangsbasis, keine feste Bindung.
      </>
    ),
  },
  'vorlagen.anhaenge': {
    title: 'Inhalte & Anhänge',
    body: (
      <>
        Lege fest, welche zusätzlichen Seiten an deine Belege angehängt werden:
        <strong> Projektübersicht</strong> (Leistungsstand je Projektelement),
        <strong> Stundennachweis</strong> (erfasste Stunden/TEC),
        <strong> HOAI-/Kalkulationsübersicht</strong> und
        <strong> Zahlungsübersicht</strong> (bisherige Abschläge). Die Auswahl ist
        <strong> je Belegtyp</strong> (Rechnungen, Abschlagsrechnungen, Angebote)
        getrennt einstellbar — Rechnung, Schluss-/Teilschlussrechnung, Abschlagsrechnung
        und Angebot können also unterschiedliche Anhänge haben. Die <strong>Reihenfolge</strong>
        legst du über die Pfeile fest. Ein Anhang erscheint nur, wenn er hier aktiv ist
        <em> und</em> tatsächlich Daten dafür vorliegen. Bereits gebuchte Belege bleiben unverändert.
      </>
    ),
  },

  // ── Rechnungen / Verträge ────────────────────────────────────────────────
  'invoice.abschlag_vs_schluss': {
    title: 'Abschlag, Rechnung oder Schlussrechnung?',
    body: (
      <>
        <strong>Abschlagsrechnung</strong>: Teilbetrag eines laufenden Vertrags
        (Zwischenstand). <strong>Schlussrechnung</strong>: rechnet den Vertrag
        final ab und verrechnet alle vorherigen Abschläge. <strong>Einzelrechnung</strong>:
        einmalige Leistung/Nebenkosten ohne Vertragsbezug.
      </>
    ),
  },
  'invoice.skonto': {
    title: 'Skonto',
    body: (
      <>
        Preisnachlass für schnelle Zahlung: der Kunde darf z. B. <strong>2 %</strong>
        abziehen, wenn er innerhalb von <strong>14 Tagen</strong> zahlt. Wird als
        Vorbelegung übernommen und ist pro Vertrag/Rechnung überschreibbar.
      </>
    ),
  },
  'invoice.sicherheitseinbehalt': {
    title: 'Sicherheitseinbehalt',
    body: (
      <>
        Ein vereinbarter Prozentsatz der Schlussrechnung, der vorübergehend
        einbehalten wird (Gewährleistungssicherheit). Er mindert den jetzt
        fälligen Betrag und wird später gesondert freigegeben.
      </>
    ),
  },

  // ── HOAI-Kalkulation ─────────────────────────────────────────────────────
  'hoai.zone': {
    title: 'Honorarzone',
    body: (
      <>
        Schwierigkeitsgrad der Leistung (I = sehr gering … V = sehr hoch). Sie
        bestimmt zusammen mit den anrechenbaren Kosten das Honorar aus der
        HOAI-Tabelle. Der <strong>Zonenanteil %</strong> erlaubt die Feinjustierung
        zwischen zwei Tabellenwerten.
      </>
    ),
  },
  'hoai.lph': {
    title: 'Leistungsphasen (LPH)',
    body: (
      <>
        Die HOAI teilt die Planung in Leistungsphasen 1–9 (z. B.
        Grundlagenermittlung, Entwurf, Ausführung). Jede Phase hat einen
        prozentualen Anteil am Gesamthonorar — hier wählst du, welche Phasen
        beauftragt sind und mit welchem Anteil sie eingehen.
      </>
    ),
  },
  'hoai.zuschlag': {
    title: 'Zuschläge & Nachlässe',
    body: (
      <>
        Prozentuale Auf- oder Abschläge auf das Honorar — z. B. Umbau-/
        Bestandszuschlag, Komplexitätszuschlag oder ein vereinbarter Nachlass.
        Mehrere können kumulativ oder jeweils auf die Grundsumme wirken.
      </>
    ),
  },

  // ── Reporting / Kennzahlen ───────────────────────────────────────────────
  'report.deckungsbeitrag': {
    title: 'Deckungsbeitrag',
    body: (
      <>
        Honorar/Erlös minus zurechenbare Kosten (v. a. Personalkosten über den
        Kostensatz). Zeigt, was nach Deckung der direkten Kosten zur Deckung der
        Gemeinkosten und zum Gewinn übrig bleibt. Negativ = das Projekt trägt
        sich nicht.
      </>
    ),
  },
  'report.kostenquote': {
    title: 'Kostenquote',
    body: (
      <>
        Kosten im Verhältnis zum Honorar (Kosten ÷ Honorar). Niedriger ist besser;
        über 100 % bedeutet, die Kosten übersteigen das Honorar.
      </>
    ),
  },
  'report.offener_betrag': {
    title: 'Offener Betrag',
    body: (
      <>
        Noch nicht fakturierter Anteil des Auftragswerts — also das, was bei
        aktuellem Leistungsstand grundsätzlich noch abgerechnet werden kann.
        Grundlage der Liste „Abrechenbare Projekte".
      </>
    ),
  },
  'report.restbudget': {
    title: 'Restbudget',
    body: (
      <>
        Vereinbartes Budget minus bereits verbrauchte/gebuchte Kosten. Wird über
        die Budget-Warnschwellen überwacht; bei Über­schreitung der Schwellen
        gibt es Benachrichtigungen.
      </>
    ),
  },
  'report.leistungsstand': {
    title: 'Leistungsstand',
    body: (
      <>
        Anteil der bereits erbrachten Leistung am Gesamtauftrag (in % bzw. €).
        Bestimmt, wie viel bereits abgerechnet werden kann. Wird je
        Projektelement gepflegt und nach oben aggregiert.
      </>
    ),
  },
  'report.abrechenbar': {
    title: 'Abrechenbar',
    body: (
      <>
        Bei aktuellem Leistungsstand noch nicht fakturierter Betrag — also das,
        was jetzt grundsätzlich in Rechnung gestellt werden kann
        (Leistungsstand − bereits abgerechnet).
      </>
    ),
  },
  'report.auslastung': {
    title: 'Auslastung',
    body: (
      <>
        Anteil der fakturierbaren (produktiven) Stunden an der verfügbaren
        Arbeitszeit. Richtwert je nach Rolle; dauerhaft sehr niedrig oder über
        100 % ist ein Warnsignal.
      </>
    ),
  },

  // ── Mitarbeiter / Arbeitszeit ────────────────────────────────────────────
  'mitarbeiter.saldo': {
    title: 'Gleitzeitsaldo',
    body: (
      <>
        Differenz aus tatsächlich gebuchter und laut Arbeitszeitmodell
        geschuldeter Zeit. Positiv = Überstunden, negativ = Minusstunden. Wird
        fortlaufend pro Monat fortgeschrieben.
      </>
    ),
  },
  'arbzg.strict': {
    title: 'Strikter Modus (ArbZG)',
    body: (
      <>
        Behandelt arbeitszeitrechtliche Warnungen (z. B. fehlende Pause,
        Höchstarbeitszeit, Ruhezeit) als <strong>harte Sperre</strong> statt als
        Hinweis — die Buchung wird dann blockiert, bis sie regelkonform ist.
      </>
    ),
  },
  'arbzg.break_rule': {
    title: 'Pausenregel',
    body: (
      <>
        Legt fest, ab welcher Arbeitsdauer wie viel Pause Pflicht ist
        (§ 4 ArbZG: ab <strong>6 h</strong> mind. 30 min, ab <strong>9 h</strong>
        mind. 45 min). Wird beim Prüfen der Pflichtpause herangezogen und ist pro
        Arbeitszeitmodell überschreibbar.
      </>
    ),
  },

  // ── Rollen & Berechtigungen ──────────────────────────────────────────────
  'roles.concept': {
    title: 'Rollen & Berechtigungen',
    body: (
      <>
        Eine Rolle bündelt Berechtigungen (lesen, bearbeiten, löschen,
        verwalten). Jeder Mitarbeiter bekommt eine oder mehrere Rollen (Tab
        Mitarbeiter) und erhält damit deren Rechte. <strong>System-Rollen</strong>
        sind vordefiniert und nicht löschbar; eigene Rollen legst du per „Neue
        Rolle" oder Duplizieren an. Die <strong>Default-Rolle</strong> erhalten
        neu angelegte Mitarbeiter automatisch.
      </>
    ),
  },

  // ── Mahnungen ────────────────────────────────────────────────────────────
  'dunning.process': {
    title: 'Wie funktioniert die Mahnung?',
    body: (
      <>
        Bleibt eine Rechnung nach Fälligkeit offen, durchläuft sie gestufte
        Mahnungen. Pro Stufe legst du Bezeichnung, <strong>Mahngebühr</strong> und
        den zeitlichen Abstand fest (Stufe 1 ab Fälligkeit, weitere ab der
        vorherigen Mahnung). Kopf-/Fußtext erscheinen im Mahnungs-PDF. Die Gebühr
        sollte in angemessenem Verhältnis zum tatsächlichen Aufwand stehen.
      </>
    ),
  },

  // ── Benachrichtigungen ───────────────────────────────────────────────────
  'notifications.audience': {
    title: 'Wer bekommt Benachrichtigungen?',
    body: (
      <>
        Pro Typ wählbar: <strong>Organisations-Standard</strong> (alle
        Mitarbeiter) oder eine gezielte Empfängerliste aus Rollen, Abteilungen
        und/oder einzelnen Mitarbeitern. Die Listen sind <strong>ODER-verknüpft</strong> —
        wer in mindestens einer steht, erhält die Nachricht. „Bearbeiten" öffnet
        die Auswahl je Typ.
      </>
    ),
  },

  // ── Unternehmen / Monatsabschluss ────────────────────────────────────────
  'company.creditor_id': {
    title: 'Gläubiger-Identifikationsnummer',
    body: (
      <>
        Eindeutige Kennung für den SEPA-Lastschrifteinzug (Format z. B.{' '}
        <code>DE98ZZZ09999999999</code>). Nur nötig, wenn du Beträge per
        Lastschrift einziehst; bei der Deutschen Bundesbank kostenlos zu
        beantragen.
      </>
    ),
  },
  'monthclose.concept': {
    title: 'Was ist der Monatsabschluss?',
    body: (
      <>
        Friert am Monatsende den Stand der Projekte ein (Snapshot der Kennzahlen)
        für die gewählten Projektstatus — Grundlage für Auswertungen und einen
        nachvollziehbaren Verlauf über die Zeit. Mitarbeiter können zusätzlich
        ihre Monatsstunden abschließen.
      </>
    ),
  },

  // ── E-Mail-Versand ───────────────────────────────────────────────────────
  'email.smtp': {
    title: 'Eigener E-Mail-Versand (SMTP)',
    body: (
      <>
        Damit Rechnungen/Mahnungen aus <strong>deinem</strong> Postfach versendet
        werden, hinterlegst du hier deinen Postausgangsserver (SMTP). Für
        Gmail/Microsoft 365 brauchst du meist ein <strong>App-Passwort</strong>,
        nicht dein normales Login. Ohne eigene Konfiguration nutzt plan&simple
        den System-Absender.
      </>
    ),
  },

  // ── Einstellungen ────────────────────────────────────────────────────────
  'budget.warnschwellen': {
    title: 'Budget-Warnschwellen',
    body: (
      <>
        Prozentwerte (z. B. <code>75, 90, 100</code>), bei deren Erreichen des
        verbrauchten Budgets eine Benachrichtigung ausgelöst wird. Werden beim
        Anlegen neuer Projekte als Standard übernommen und sind pro Projekt
        anpassbar.
      </>
    ),
  },
} satisfies Record<string, HelpEntry>

export type HelpId = keyof typeof HELP

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
        <strong>Serifenlos</strong> wirkt modern und sachlich, <strong>Serif</strong>
        klassisch und seriös. Die Schrift gilt für den gesamten Belegtext. Es werden
        bewusst nur druck­sichere Standard­schriften angeboten, damit das PDF überall
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

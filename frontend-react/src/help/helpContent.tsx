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
        Die heruntergeladene Excel-Vorlage hat vier Blätter: <strong>Anleitung</strong> (Vorgehen und
        Reihenfolge), <strong>Daten</strong> (hier trägst du ein — Pflichtfelder mit <code>*</code>,
        Auswahlfelder als Klappliste), <strong>Beispiel</strong> (Musterzeilen) und
        <strong> Listen</strong> (die in deinem Konto erlaubten Werte, z. B. Status oder
        Mitarbeiter-Kürzel). Eingelesen wird nur das Blatt „Daten". Eigene Dateien gehen auch — dann
        ggf. die Zuordnung im nächsten Schritt anpassen.
      </>
    ),
  },
  'import.structure_tree': {
    title: 'Leistungsstruktur als Baum importieren',
    body: (
      <>
        Eine Zeile je Knoten. Die <strong>Gliederungsnummer</strong> bestimmt, was unter was liegt:
        <code> 1</code>, <code>1.1</code>, <code>1.2</code>, <code>2</code> … — <code>1.1</code> ist ein
        Unterpunkt von <code>1</code>. Aus ihr ergibt sich auch die Reihenfolge, unabhängig davon, wie
        die Zeilen in der Datei sortiert sind.<br /><br />
        <strong>Honorar und Abrechnungsart gehören an die untersten Zeilen.</strong> Übergeordnete
        Zeilen rechnet plan&simple aus ihren Unterzeilen — ein dort eingetragener Betrag wird
        ignoriert, damit beide Angaben nicht auseinanderlaufen. Stunden-Positionen bekommen kein
        Honorar; ihr Umsatz entsteht später aus den Buchungen.<br /><br />
        Ist eine Zeile eines Projekts fehlerhaft, wird das <strong>ganze Projekt</strong> übersprungen —
        ein Baum ohne seinen Elternknoten wäre schlimmer als gar keiner. Wer keine Gliederungsnummern
        hat, kann die Spalte „Ebene" (1/2/3) nutzen; dann zählt die Zeilenreihenfolge.
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
  'bookings.pause': {
    title: 'Pause buchen',
    body: (
      <>
        Trägt eine <strong>Pause</strong> nachträglich manuell ein — z. B. wenn morgens
        nicht per Timer eingestempelt wurde und der Tag am Ende vollständig erfasst wird.
        <br />Eine Pause ist <strong>kostenneutral</strong> (kein Kostensatz, kein Erlös,
        kein Projektelement) und zählt <em>nicht</em> als Arbeitszeit im Zeitkonto.
        <br />Sie erfüllt aber die <strong>Pausenpflicht nach § 4 ArbZG</strong>: ab 6 h
        Arbeit sind 30 min, ab 9 h sind 45 min Pause vorgeschrieben.
        <br /><strong>So erfasst du einen ganzen Tag:</strong> die geleistete
        (Netto-)Arbeitszeit als Stundenbuchung auf das Projekt buchen und die Pause
        separat hier eintragen — Von/Bis füllt die Dauer automatisch.
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

  // ── Adressen & Kontakte ──────────────────────────────────────────────────
  'addresses.type': {
    title: 'Kategorie der Adresse',
    body: (
      <>
        Ordnet die Adresse fachlich ein — <strong>Kunde/Bauherr</strong>, <strong>Fachplaner</strong>,
        <strong> Behörde</strong>, <strong>Nachunternehmer</strong>, <strong>Lieferant</strong> oder
        <strong> Sonstige</strong>. Rein organisatorisch: die Kategorie hilft beim Filtern und Sortieren
        des Adressbuchs und hat keine Auswirkung auf Angebote oder Rechnungen. Kann leer bleiben.
      </>
    ),
  },
  'addresses.ustid': {
    title: 'USt-IdNr. vs. Steuernummer',
    body: (
      <>
        Die <strong>USt-IdNr.</strong> (Umsatzsteuer-Identifikationsnummer, Format z. B.
        <code> DE123456789</code>) ist die für den B2B- und EU-Geschäftsverkehr relevante Kennung — sie
        wird u. a. für E-Rechnungen und die Reverse-Charge-Prüfung benötigt. Die <strong>Steuernummer</strong>
        ist die nationale Nummer des Finanzamts. Beide sind optional; für Rechnungen an Unternehmen ist die
        USt-IdNr. meist die wichtigere Angabe.
      </>
    ),
  },
  'addresses.notes': {
    title: 'Notizen',
    body: (
      <>
        Interner Freitext zu dieser Adresse (z. B. Zahlungsmoral, Zuständigkeiten, Besonderheiten). Nur
        intern sichtbar — erscheint <strong>nicht</strong> auf Angeboten, Rechnungen oder E-Rechnungen.
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
    title: 'Logo-Position & -Größe',
    body: (
      <>
        Legt fest, ob dein Firmenlogo oben <strong>links</strong>, <strong>mittig</strong>
        oder <strong>rechts</strong> steht und wie groß es erscheint. Position und Größe
        gelten für <strong>alle Belege und Gesellschaften</strong>. Das Logo-Bild selbst
        lädst du direkt darüber hoch — bei mehreren Gesellschaften je Unternehmen einzeln.
        Ohne hinterlegtes Logo zeigt die Vorschau einen Platzhalter.
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
        <br /><br />
        Zwei Hilfen stehen bereit, statt die Zone zu schätzen:
        <br />
        <strong>Bewertungsmerkmale</strong> — der eigentliche Weg nach § 5 Abs. 2 HOAI: je
        Merkmal Punkte vergeben, die Summe ergibt die Zone. Nicht jedes Leistungsbild hat ein
        solches Punktesystem; Tragwerksplanung, Technische Ausrüstung, Geotechnik sowie Bau- und
        Raumakustik ordnen die Zone rein beschreibend zu.
        <br />
        <strong>Objektliste</strong> — die Regelbeispiele der Anlagen: Sachverhalt auswählen, Zone
        ablesen. Manche Objekte führt die HOAI in zwei Zonen; dann ist die zutreffende zu wählen.
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
  'hoai.mischhonorar': {
    title: 'Mischhonorar bei gemischten Honorarzonen',
    body: (
      <>
        Für die Technische Ausrüstung: Gehören die Anlagen einer Anlagengruppe verschiedenen
        Honorarzonen an, wird das Honorar aus gewichteten Einzelhonoraren gebildet. Je Zone wird das
        Honorar so berechnet, als läge die <strong>gesamte</strong> anrechenbare Kostensumme in dieser Zone;
        dieses Vollhonorar wird dann mit dem Kostenanteil der Zone gewichtet. So wirkt die Degression der
        Honorartafel auf die Gesamtsumme. Die anrechenbaren Gesamtkosten (K0) ergeben sich als Summe der
        Zonenbeträge; ein separates K0-Feld entfällt in diesem Modus. „Position %" ist die Lage innerhalb
        des Zonenbands (0 = untere, 100 = obere Tafelgrenze).
        <br /><br />
        <strong>Hinweis zur Rechtsgrundlage:</strong> Die HOAI regelt diese Aufteilung nicht
        ausdrücklich. § 54 Abs. 1 stellt auf die Summe der anrechenbaren Kosten je Anlagengruppe ab,
        was für eine einzige Zone je Anlagengruppe spricht; die gewichtete Mischung ist eine in der
        Praxis verbreitete Auslegung. Vor Rechnungsstellung fachlich absichern.
      </>
    ),
  },
  'din276.anrechenbare_kosten': {
    title: 'Anrechenbare Kosten (DIN 276 → HOAI)',
    body: (
      <>
        Die anrechenbaren Kosten sind die Grundlage der Honorarberechnung. Sie werden aus den Baukosten
        je Kostengruppe nach DIN 276 abgeleitet. Für Gebäude (§ 33 HOAI) gilt: KG 300 (Baukonstruktionen)
        voll; KG 400 (Technische Anlagen) voll, wenn selbst geplant/überwacht, sonst voll bis 25 % der
        sonstigen anrechenbaren Kosten und darüber zur Hälfte; mitverarbeitete Bausubstanz kommt hinzu.
        KG 100/500/700 und nicht selbst geplante KG 200/600 sind nicht anrechenbar. Das Ergebnis wird als
        Baukosten-Basis (K0) in die Honorarberechnung übernommen. Maßgeblich ist die Kostenberechnung
        (LPH 3) nach DIN 276-1:2008-12.
      </>
    ),
  },
  'din276.stufe': {
    title: 'Kostenstufe',
    body: (
      <>
        Genauigkeit/Zeitpunkt der Kostenermittlung: die <strong>Kostenschätzung</strong> entsteht meist zur
        Vorplanung (LPH 2), die <strong>Kostenberechnung</strong> zur Entwurfsplanung (LPH 3). Für die
        anrechenbaren Kosten ist grundsätzlich die Kostenberechnung maßgeblich; in frühen Phasen dient die
        Schätzung als Ersatz.
      </>
    ),
  },
  'din276.bausubstanz': {
    title: 'Mitverarbeitete Bausubstanz (§ 4 Abs. 3)',
    body: (
      <>
        Vorhandene Bausubstanz, die bei Umbau/Modernisierung technisch oder gestalterisch mitverarbeitet
        wird, ist angemessen in die anrechenbaren Kosten einzubeziehen (schriftlich zu vereinbaren). Sie
        zählt zu den „sonstigen anrechenbaren Kosten" und beeinflusst damit auch die 25-%-Schwelle der
        KG-400-Regel. Ohne Umbau/Bestand: 0 lassen.
      </>
    ),
  },
  'din276.raumakustik_volumen': {
    title: 'Rauminhalt und Bruttorauminhalt (Anlage 1.2.5)',
    body: (
      <>
        Die Raumakustik wird <strong>je Innenraum</strong> honoriert, nicht für das ganze Gebäude. Als
        anrechenbare Kosten gilt deshalb nur der Anteil, der auf den Raum entfällt: KG 300 + KG 400 werden
        durch den Bruttorauminhalt des Gebäudes geteilt und mit dem Rauminhalt des Innenraums multipliziert.
        Die Ausstattung des Innenraums (KG 610) kommt voll hinzu — sie verteilt sich nicht nach Volumen.
        Beide Werte in m³ eintragen. Für mehrere Räume je Raum eine eigene Berechnung anlegen.
      </>
    ),
  },
  'din276.bauphysik': {
    title: 'Anrechenbare Kosten der Bauphysik (Anlage 1.2)',
    body: (
      <>
        Die drei Teilgebiete rechnen <strong>unterschiedlich</strong>: Der <strong>Wärmeschutz</strong>
        {' '}(1.2.3) übernimmt die Gebäuderegel des § 33 samt der 25-/50-%-Kappung für fremdgeplante KG 400.
        Die <strong>Bauakustik</strong> (1.2.4) rechnet KG 300 und KG 400 voll an — die Kappung gilt dort
        nicht, sie betrifft nur den Gebäudeplaner. Die <strong>Raumakustik</strong> (1.2.5) rechnet je
        Innenraum anteilig. Das Leistungsbild ist für alle drei gleich: sieben Leistungsphasen bis zur
        Mitwirkung bei der Vergabe, LPH 8/9 gibt es nicht.
      </>
    ),
  },
  'stammdaten.lph_bloecke': {
    title: 'Leistungsphasen-Blöcke',
    body: (
      <>
        Ein Block bündelt mehrere HOAI-Leistungsphasen zu einer Auswertungseinheit — z. B.
        „Planung" für LPH 1–4, „Ausführung" für LPH 5–7, „Überwachung" für LPH 8–9. In der
        Projekt-Auswertung „Leistungsphasen" siehst du dann zuerst diese Blöcke und kannst jeden
        auf die einzelnen Phasen aufklappen. Das Schema wird je Leistungsbild gepflegt, weil
        verschiedene Leistungsbilder unterschiedliche Phasenschnitte haben. „HOAI-Standard" legt die
        gängige Aufteilung 1–4 / 5–7 / 8–9 in einem Klick an; danach frei anpassbar.
      </>
    ),
  },
  'report.lph_matrix': {
    title: 'Leistungsphasen-Matrix',
    body: (
      <>
        Alle Projekte mit Leistungsphasen-Struktur auf einen Blick: Zeilen sind Projekte, Spalten die
        Leistungsphasen (LPH 1–9). Die Zellenfarbe zeigt die Ampel (grün = im Plan, gelb = Kostenquote
        erhöht, rot = kritisch oder Deckungsbeitrag negativ). Über die Umschalter oben wählst du, welche
        Kennzahl in den Zellen steht. So erkennst du sofort, in welcher Phase welches Projekt brennt.
        Klick auf einen Projektnamen öffnet den Einzelprojekt-Report.
      </>
    ),
  },
  'report.lph_stundenanteil': {
    title: 'Stundenanteil vs. Honoraranteil',
    body: (
      <>
        Aggregiert über alle Projekte: Wie verteilen sich die tatsächlich gebuchten Stunden auf die
        Leistungsphasen (Stundenanteil) — verglichen mit der Verteilung des Honorars (Honoraranteil, was
        grob der HOAI-Gewichtung entspricht). Liegt der Stundenanteil einer Phase deutlich über ihrem
        Honoraranteil, verbraucht diese Phase systematisch mehr Aufwand als sie einbringt — ein Hinweis
        auf Unterkalkulation oder nötige Besondere Leistungen. Solche Phasen sind rot hervorgehoben.
      </>
    ),
  },
  'report.leistungsphasen': {
    title: 'Auswertung nach Leistungsphase',
    body: (
      <>
        Die Kennzahlen des Projekts — Honorar, Leistungsstand, Stunden, Kosten,
        Kostenquote und Deckungsbeitrag — verdichtet je HOAI-Leistungsphase
        (LPH). So siehst du, welche Phase wirtschaftlich läuft und welche über
        Budget ist, nicht erst am Projektende. Grundlage sind die Buchungen und
        der Leistungsstand, den Phasen-Knoten zugeordnet, die aus der
        Honorarberechnung stammen. Buchungen ohne Phasenbezug erscheinen unter
        „Ohne Phasenzuordnung". Der Report wird nur angezeigt, wenn das Projekt
        eine Leistungsphasen-Struktur besitzt.
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
        Pro Typ über „Bearbeiten" wählbar:
        <br />
        <strong>Alle Mitarbeiter</strong> — jede Person im Büro.
        <br />
        <strong>Nur bestimmte Personen</strong> — ausschließlich die gewählten
        Mitarbeiter, sonst niemand.
        <br />
        <strong>Nach Rollen und Abteilungen</strong> — alle Treffer aus Rollen
        und Abteilungen, wahlweise ergänzt um einzelne Personen. Die Listen sind{' '}
        <strong>ODER-verknüpft</strong>: wer in mindestens einer steht, erhält
        die Nachricht.
        <br />
        Unter der Auswahl steht immer, wer damit tatsächlich erreicht wird —
        inklusive Warnung, wenn am Ende niemand übrig bleibt.
      </>
    ),
  },
  'notifications.reminder.pm_mode': {
    title: 'Eine Benachrichtigung je Projekt oder eine insgesamt?',
    body: (
      <>
        <strong>Eine je Projekt</strong> — für jedes betroffene Projekt eine
        eigene Nachricht. Jede führt direkt in das jeweilige Projekt. Sinnvoll
        bei wenigen Projekten je Person oder wenn jedes einzeln abgehakt werden
        soll.
        <br />
        <strong>Eine insgesamt</strong> — eine Sammelnachricht je Person,
        unabhängig davon, wie viele Projekte sie führt. Sie nennt die ersten
        Projekte beim Namen und verlinkt auf die eigenen Leistungsstände.
        Sinnvoll, sobald jemand viele Projekte betreut — zwanzig Meldungen am
        selben Morgen werden überlesen.
        <br />
        Die Einstellung betrifft nur die Projektleitung. Empfänger aus
        Rollen, Abteilungen oder der Personenliste bekommen ohnehin genau eine
        Sammelnachricht.
      </>
    ),
  },
  'notifications.schedule.time': {
    title: 'Uhrzeit des Zeitplans',
    body: (
      <>
        Die Uhrzeit steht hier in <strong>deiner Gerätezeit</strong> — du musst
        nichts umrechnen. Gespeichert wird sie als feste Bürozeit, damit der
        Versandzeitpunkt für alle derselbe bleibt und sich nicht danach richtet,
        wer zuletzt gespeichert hat. Sitzt du in einer anderen Zeitzone als das
        Büro, steht die entsprechende Bürozeit als Hinweis unter dem Feld.
        <br />
        Die Erinnerung geht <strong>ab</strong> dieser Uhrzeit raus — geprüft
        wird stündlich, es kann also einige Minuten später werden.
        <br />
        Pro Tag wird höchstens einmal erinnert. Wer bereits erledigt hat, worum
        es geht (z. B. Stunden gebucht), wird übersprungen.
      </>
    ),
  },
  'notifications.budget.recipients': {
    title: 'Empfänger einer Budget-Warnung',
    body: (
      <>
        Alle angehakten Quellen zusammen ergeben die Empfänger:{' '}
        <strong>Projektleiter</strong> des Projekts, die{' '}
        <strong>verursachende Person</strong> (wer die auslösende Buchung erfasst
        hat) und die Liste <strong>Weitere Personen</strong>.
        <br />
        Soll <strong>nur eine bestimmte Person</strong> die Warnung bekommen: die
        beiden Haken abwählen und die Person unter „Weitere Personen" auswählen.
        <br />
        <strong>Stumm schalten</strong> überwacht das Budget weiter, verschickt
        aber nichts.
      </>
    ),
  },
  'notifications.push': {
    title: 'Push-Benachrichtigungen',
    body: (
      <>
        Erhalte dieselben Benachrichtigungen wie in der App zusätzlich als
        <strong> Push direkt aufs Gerät</strong> — auch wenn plan&amp;simple gerade
        geschlossen ist. Die Freigabe gilt <strong>nur für dieses Gerät</strong>;
        auf jedem Handy/Tablet/Rechner separat aktivierbar. <strong>Welche</strong>{' '}
        Benachrichtigungen du bekommst, steuert unverändert die normale
        Benachrichtigungs-Konfiguration — Push ist nur ein zusätzlicher
        Zustellweg.
        <br />
        <strong>iPhone/iPad:</strong> funktioniert erst, wenn du plan&amp;simple
        über „Teilen → Zum Home-Bildschirm" installiert und aus diesem Symbol
        geöffnet hast.
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
  'email.bcc': {
    title: 'Kopie an mich (BCC)',
    body: (
      <>
        Weil der Versand über den System-Mailserver läuft und nicht über dein
        Postfach, liegt dort keine Kopie im Ordner „Gesendet". Trägst du hier
        eine Adresse ein, bekommst du jede versendete <strong>Rechnung,
        Abschlags- und Stornorechnung sowie jede Mahnung</strong> zusätzlich als
        Blindkopie — inklusive PDF-Anhang. Der Empfänger sieht diese Adresse
        nicht.
        <br />
        <br />
        Gilt unabhängig davon, ob du den System-Absender oder eine eigene
        Absenderadresse nutzt. Konto-Mails wie „Passwort vergessen" werden
        <strong> nicht</strong> kopiert. Die Testnachricht unten geht ebenfalls
        an die Kopie-Adresse — damit lässt sich die Einstellung sofort prüfen.
      </>
    ),
  },
  'email.smtp': {
    title: 'Absenderadresse',
    body: (
      <>
        Rechnungen und Mahnungen verlassen plan&amp;simple immer über den
        System-Mailserver — nicht über dein eigenes Postfach. Hier legst du nur
        fest, <strong>wie der Absender aussieht</strong>: Adresse, Anzeigename
        und optional eine Antwort-an-Adresse, an die Kundenantworten gehen.
        Ohne eigene Angaben gilt der System-Absender.
        <br />
        <br />
        Weil der Versand nicht über dein Postfach läuft, taucht dort auch keine
        Kopie im <strong>Postausgang / Gesendet</strong> auf. Was verschickt
        wurde, steht in plan&amp;simple: bei Mahnungen im Mahnverlauf, bei
        Rechnungen im Ergebnis des Versanddialogs.
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

  // ── Service-Bereich (Vorschläge · Feedback · Unterstützung) ───────────────
  'service.vorschlaege': {
    title: 'Vorschläge für Funktionen',
    body: (
      <>
        Funktionswünsche darf <strong>jeder im Haus</strong> einreichen. Ein Vorschlag durchläuft danach
        zwei Stationen:
        <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          <li>
            <strong>Freigabe durch den Produkt-Sprecher</strong> Ihrer Organisation. Bis dahin steht der
            Vorschlag auf „Wartet auf Freigabe" und ist ausschließlich intern sichtbar — plan&simple
            erfährt nichts davon.
          </li>
          <li>
            <strong>Prüfung durch plan&simple.</strong> Erst danach erscheint der Vorschlag im Portal, wo
            der Sprecher für Ihre Organisation abstimmen kann.
          </li>
        </ol>
        <p style={{ margin: '8px 0 0' }}>
          Die Freigabe ist bewusst eine Person und keine Formalie: ein Vorschlag spricht nach außen für
          das ganze Büro, und der eingegebene Originaltext kann Projekt-, Bauherren- oder Kollegennamen
          enthalten. Gibt der Sprecher einen Vorschlag nicht frei, sieht der Einreicher die Begründung.
        </p>
        <p style={{ margin: '8px 0 0' }}>
          Aus Datenschutzgründen sehen andere Anwender <strong>nie</strong> Ihren Namen, Ihre E-Mail oder
          Ihre Organisation — nur den von plan&simple geprüften Inhalt, den Status und die Stimmenzahl.
        </p>
      </>
    ),
  },
  'service.freigabe': {
    title: 'Freigabe durch den Produkt-Sprecher',
    body: (
      <>
        Als Produkt-Sprecher entscheiden Sie, welche Vorschläge Ihres Hauses an plan&simple gehen.
        <strong> Freigeben</strong> übergibt den Vorschlag zur Prüfung; <strong>Nicht freigeben</strong>
        stoppt ihn und verlangt eine kurze Begründung, die der Einreicher zu sehen bekommt.
        <p style={{ margin: '8px 0 0' }}>
          Prüfen Sie vor der Freigabe vor allem den Text: er wird bei plan&simple im Original gelesen.
          Projektnamen, Bauherren oder Namen von Kolleginnen und Kollegen gehören nicht hinein — lieber
          nicht freigeben, kurz umformulieren lassen und neu einreichen.
        </p>
        <p style={{ margin: '8px 0 0' }}>
          Eigene Vorschläge sind sofort freigegeben; Sie müssten sich sonst selbst bestätigen. Ist kein
          Sprecher benannt, kann ein Administrator freigeben, damit nichts liegenbleibt.
        </p>
      </>
    ),
  },
  'service.feedback': {
    title: 'Feedback & Kontakt',
    body: (
      <>
        Eine direkte Nachricht an plan&simple — für Lob, Kritik oder Fragen. Organisation, Name und
        E-Mail aus Ihrem Login sind vorbelegt. Die Nachricht ist <strong>privat</strong> und für andere
        Anwender nicht sichtbar.
      </>
    ),
  },
  'service.unterstuetzung': {
    title: 'Unterstützung anfragen',
    body: (
      <>
        Hilfe bei einer konkreten Aufgabe, z. B. der Übernahme Ihrer Altdaten. Wählen Sie eine Kategorie —
        passende Antworten zeigen wir vorab. Bleibt etwas offen, geht Ihre Anfrage <strong>privat</strong>{' '}
        an plan&simple und Sie können ihren Status verfolgen.
      </>
    ),
  },

  // ── Abwesenheit ──────────────────────────────────────────────────────────
  'absence.carryover_expiry': {
    title: 'Verfall des Resturlaub-Übertrags',
    body: (
      <>
        Ist der Verfall aktiv, muss nicht genommener <strong>Übertrag aus dem Vorjahr</strong> bis zum
        Stichtag (Vorgabe <strong>31.03.</strong>, gesetzlicher Standard nach BUrlG) genutzt sein — danach
        verfällt der Rest. Der Übertrag wird dabei <strong>zuerst</strong> verbraucht, erst dann der
        Anspruch des laufenden Jahres. Vor dem Stichtag zieht der Saldo noch nichts ab, sondern weist die
        gefährdeten Tage als Hinweis aus. Ist der Verfall aus, wird der Übertrag unbegrenzt vorgetragen.
      </>
    ),
  },

  // ── Nachträge ────────────────────────────────────────────────────────────
  'nachtrag.overview': {
    title: 'Was ist ein Nachtrag?',
    body: (
      <>
        Ein Nachtrag hält eine <strong>Änderung oder Ergänzung des beauftragten Leistungs- und
        Vergütungsumfangs</strong> fest — z. B. geänderte oder zusätzliche Leistungen (§ 650b BGB,
        § 10 HOAI). Er wird geprüft, ganz oder teilweise <strong>ins Projekt freigegeben</strong> und ist
        danach ganz normal buch- und abrechenbar. So wächst der Auftragswert kontrolliert und nachvollziehbar.
      </>
    ),
  },
  'nachtrag.kategorie': {
    title: 'Kategorie',
    body: (
      <>
        Ordnet den Anlass ein: <strong>geänderte</strong> Leistung (Bauherr ändert das Ziel),
        <strong> zusätzliche</strong> Leistung (außerhalb des Solls), <strong>Mengen-/Umfangsänderung</strong>,
        <strong> besondere</strong> Leistung, <strong>gestörter Bauablauf</strong> sowie Bauinhalts- vs.
        Bauumstandsnachtrag. Die Kategorie steuert Auswertung und Wording — nicht die Berechnung.
      </>
    ),
  },
  'nachtrag.anspruchsgrundlage': {
    title: 'Anspruchsgrundlage',
    body: (
      <>
        Die rechtliche Basis des Mehr-/Änderungsanspruchs, z. B. <strong>§ 650b/c BGB</strong>,
        <strong> § 10 HOAI</strong> (geänderte/zusätzliche Leistungen) oder <strong>VOB/B § 2</strong>. Eine
        klar benannte Grundlage plus nachvollziehbare Begründung ist Voraussetzung dafür, dass der Nachtrag
        <strong> prüffähig</strong> ist und anerkannt wird.
      </>
    ),
  },
  'nachtrag.fristen': {
    title: 'Fristen & Prüffrist',
    body: (
      <>
        Nachträge sind fristgebunden: idealerweise <strong>vor Ausführung angekündigt</strong>, fristgerecht
        vorgelegt und innerhalb der <strong>Prüf-/Entscheidungsfrist</strong> beschieden. Versäumte Fristen
        sind ein häufiger Grund für verlorene Ansprüche — die Prüffrist hält den nächsten fälligen Schritt
        sichtbar.
      </>
    ),
  },
  'nachtrag.pruefbarkeit': {
    title: 'Prüfbarkeit',
    body: (
      <>
        Vor der Freigabe wird geprüft, ob der Nachtrag <strong>formell</strong> (fristgerecht, Form und
        Ankündigung gewahrt), <strong>inhaltlich</strong> (Anspruchsgrundlage schlüssig und nachgewiesen)
        und <strong>rechnerisch</strong> (Mengen und Preise nachvollziehbar) tragfähig ist. Ergebnis ist
        ein <strong>Prüfvermerk</strong> mit Empfehlung (anerkennen, kürzen, ablehnen, Rückfrage) — die
        Grundlage für eine begründete Freigabe-Entscheidung.
      </>
    ),
  },
  'nachtrag.freigabe': {
    title: 'Freigabe ins Projekt',
    body: (
      <>
        Bei der Freigabe werden die <strong>anerkannten Positionen ins Projekt übernommen</strong> (unter dem
        Sammelknoten „Nachträge") und damit buch- und abrechenbar; der Auftragswert steigt entsprechend.
        Möglich sind <strong>Teilfreigaben</strong> (nur bestimmte Positionen), Kürzungen „der Höhe nach"
        (anerkannter Betrag&nbsp;&lt;&nbsp;gefordert) und eine <strong>vorläufige Anordnung</strong>, wenn schon
        vor der endgültigen Einigung gearbeitet werden soll. Jede Freigabe wird protokolliert.
      </>
    ),
  },
  // ── Projekt- und Angebotsstruktur: Rechtsklick-Menü ──────────────────────
  // Die Funktionen lagen ausschliesslich hinter der rechten Maustaste und waren
  // dadurch praktisch unauffindbar. Der Hinweis in der Leiste macht sie
  // sichtbar, dieser Text erklaert, was dahinter steckt.
  'structure.contextmenu': {
    title: 'Rechtsklick auf eine Zeile',
    body: (
      <>
        Ein <strong>Rechtsklick</strong> auf eine Zeile (auf dem Handy: langes Antippen) öffnet die
        Funktionen zu genau diesem Element:
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          <li>
            <strong>Element anlegen</strong> — legt ein <em>untergeordnetes</em> Element darunter an.
            Abrechnungsart und Nebenkosten-Prozentsatz werden von der angeklickten Zeile übernommen,
            lassen sich im Dialog aber ändern.
          </li>
          <li>
            <strong>Zuschlag hinzufügen</strong> — bis zu drei prozentuale Zu- oder Abschläge auf das
            Honorar dieses Elements (z.&nbsp;B. Umbauzuschlag, Nachlass). „Kumulativ" bedeutet: der
            Zuschlag rechnet auf die bereits erhöhte Zwischensumme statt auf den Ausgangswert.
          </li>
          <li>
            <strong>Kalkulation anlegen</strong> — hängt eine HOAI-/AHO-Honorarermittlung unter dieses
            Element; die ermittelten Beträge fließen als Unterelemente zurück in die Struktur.
          </li>
          <li>
            <strong>Element löschen</strong> — löscht das Element samt Kind-Elementen. Nicht möglich,
            solange Buchungen oder Rechnungen darauf verweisen.
          </li>
        </ul>
        <p style={{ margin: '8px 0 0' }}>
          Rechtsklick auf die <strong>oberste Zeile</strong> (Projekt bzw. Angebot) legt Elemente auf
          oberster Ebene an und setzt Zuschläge auf die Gesamtsumme. Sind mehrere Zeilen über die
          Kästchen ausgewählt, bezieht sich das Löschen auf die ganze Auswahl.
        </p>
      </>
    ),
  },
} satisfies Record<string, HelpEntry>

export type HelpId = keyof typeof HELP

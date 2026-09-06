/**
 * Darstellung von Geldbetraegen.
 *
 * „Rote Zahlen" ist die aelteste und stabilste Konvention im Rechnungswesen —
 * ein negativer Betrag wird rot gesetzt. Sie war im Reporting nur an einer
 * einzigen Stelle umgesetzt (Deckungsbeitrag im Leistungsphasen-Report);
 * ueberall sonst standen negative Betraege schwarz, ein negativer
 * Abrechenbar-Wert sogar blau, weil die Spalte pauschal die Akzentfarbe trug.
 *
 * Warum --kpi-critical und nicht --danger: Ein negativer Betrag ist keine
 * Fehlermeldung. --danger heisst „Fehler / loeschen", --kpi-critical gehoert
 * zur Controlling-Ebene und ist gegen alle Theme-Untergruende geprueft.
 * Konzept: docs/FARBKONZEPT_2026-09.md §3 und §4.
 *
 * Zweiter Wahrnehmungskanal ist hier das Minuszeichen selbst — es steht immer
 * im formatierten Text. Deshalb kein zusaetzliches Symbol wie bei der Ampel
 * (WCAG 1.4.1 ist damit erfuellt).
 */

/**
 * Stil fuer eine Betragszelle: rot, wenn der Wert negativ ist, sonst nichts.
 *
 * Bewusst als Stil-Helfer und nicht als Komponente: Die Betraege werden in
 * sieben Reporting-Dateien mit jeweils eigenem `fmtEur` gesetzt (mal zwei,
 * mal null Nachkommastellen). Ein Helfer laesst sich vor jede dieser Zellen
 * setzen, ohne die Formatierung anzufassen.
 *
 *     <td className="num" style={negativeStyle(v)}>{fmtEur(v)}</td>
 */
export function negativeStyle(v: number | null | undefined): { color: string } | undefined {
  return v != null && Number.isFinite(v) && v < 0 ? { color: 'var(--kpi-critical)' } : undefined
}

/**
 * Wie `negativeStyle`, behaelt aber eine vorhandene Farbe fuer nicht-negative
 * Werte bei. Fuer Zellen, die im Normalfall schon eine eigene Farbe tragen —
 * etwa „Abrechenbar" in der Akzentfarbe. Ein negativer Wert dort heisst
 * ueberzahlt und muss die Akzentfarbe schlagen.
 */
export function negativeOr(v: number | null | undefined, fallback: string): { color: string } {
  return negativeStyle(v) ?? { color: fallback }
}

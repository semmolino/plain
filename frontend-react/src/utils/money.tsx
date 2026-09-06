import type { CSSProperties, ReactNode } from 'react'

/**
 * Geldbetraege — Formatierung UND Darstellung, an einer Stelle.
 *
 * Vorher: 28 eigene `fmtEur`-Definitionen in 27 Dateien, dazu 36 eigene
 * `Intl.NumberFormat`-Instanzen. Fast alle identisch, ein paar minimal
 * verschieden (Gedankenstrich vs. Bindestrich fuer „kein Wert", null statt
 * zwei Nachkommastellen). Genau diese Streuung hat dazu gefuehrt, dass die
 * Konvention „rote Zahlen" im ganzen Produkt an EINER Stelle umgesetzt war:
 * Es gab keinen gemeinsamen Ort, an dem man sie haette hinschreiben koennen.
 *
 * Regel: Kein neuer `Intl.NumberFormat` mit `currency` im Produktcode —
 * `npm run check:design` laesst das fehlschlagen. Wer eine Betragsdarstellung
 * braucht, nimmt `money()` (gefaerbt) oder `fmtEur()` (reiner Text, etwa fuer
 * Diagramm-Tooltips und aria-Label).
 *
 * Konzept: docs/FARBKONZEPT_2026-09.md §4.5.
 */

// ── Formatierung ──────────────────────────────────────────────────────────

const FMT_EUR  = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FMT_EUR0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

/**
 * Platzhalter fuer „kein Wert". Bewusst der Gedankenstrich (—) und nicht der
 * Bindestrich: Er war die Mehrheitsvariante (24 von 28 Fundstellen) und ist
 * typografisch der richtige.
 *
 * WICHTIG: „kein Wert" ist nicht „0 €". Wo eine 0 fachlich stimmt, gehoert
 * auch eine 0 hin — der Platzhalter sagt aus, dass nichts vorliegt.
 */
export const NO_VALUE = '—'

/** Betrag als Text, zwei Nachkommastellen. Fuer Tooltips, Titel, aria-Label. */
export function fmtEur(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? NO_VALUE : FMT_EUR.format(v)
}

/** Betrag als Text, ohne Nachkommastellen. Fuer Uebersichten und Achsen. */
export function fmtEur0(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? NO_VALUE : FMT_EUR0.format(v)
}

// ── Darstellung ───────────────────────────────────────────────────────────

/**
 * Stil fuer eine Betragszelle: rot, wenn der Wert negativ ist, sonst nichts.
 *
 * „Rote Zahlen" ist die aelteste und stabilste Konvention im Rechnungswesen.
 * Sie ist KEINE Bewertung — sie sagt nichts ueber Handlungsbedarf, nur ueber
 * das Vorzeichen. Deshalb auch kein Symbol wie bei der Controlling-Ampel:
 * Der zweite Wahrnehmungskanal ist das Minuszeichen, das immer im Text steht
 * (WCAG 1.4.1 ist damit erfuellt).
 *
 * Warum --kpi-critical und nicht --danger: Ein negativer Betrag ist keine
 * Fehlermeldung. --danger heisst „Fehler / loeschen"; die Controlling-Farbe
 * gehoert zur Bedeutungsebene und ist gegen alle Theme-Untergruende geprueft.
 *
 * Die Grenze ist `< 0`, nicht `<= 0`: Null ist kein Verlust — sonst waere
 * jede leere Spalte rot.
 */
export function negativeStyle(v: number | null | undefined): CSSProperties | undefined {
  return v != null && Number.isFinite(v) && v < 0 ? { color: 'var(--kpi-critical)' } : undefined
}

/**
 * Wie `negativeStyle`, behaelt aber eine vorhandene Farbe fuer nicht-negative
 * Werte bei. Fuer Zellen, die im Normalfall schon eine eigene Farbe tragen —
 * etwa „Abrechenbar" in der Akzentfarbe. Ein negativer Wert dort heisst
 * ueberzahlt und muss die Akzentfarbe schlagen.
 */
export function negativeOr(v: number | null | undefined, fallback: string): CSSProperties {
  return negativeStyle(v) ?? { color: fallback }
}

/** Betrag als fertige Zelle: formatiert, negative Werte rot. Der Normalfall. */
export function money(v: number | null | undefined): ReactNode {
  return <span style={negativeStyle(v)}>{fmtEur(v)}</span>
}

/** Wie `money`, ohne Nachkommastellen. */
export function money0(v: number | null | undefined): ReactNode {
  return <span style={negativeStyle(v)}>{fmtEur0(v)}</span>
}

/**
 * Betrag als Zelle mit eigener Grundfarbe (z. B. Akzent), die ein negativer
 * Wert schlaegt.
 */
export function moneyOr(v: number | null | undefined, fallback: string): ReactNode {
  return <span style={negativeOr(v, fallback)}>{fmtEur(v)}</span>
}

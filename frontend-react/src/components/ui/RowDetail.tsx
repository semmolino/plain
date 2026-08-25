import { useCallback, useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

/**
 * Aufklappbare Detailzeile fuer Listen, die Spalten aus Platzmangel weglassen.
 *
 * ── Wozu ─────────────────────────────────────────────────────────────────
 *
 * `useFitColumns` laesst Spalten weg, wenn die Tabelle sonst ueberliefe. Auf
 * einem breiten Bildschirm faellt nichts weg; auf einem schmalen fehlen die
 * Werte dann aber ganz — der Spaltenwaehler hilft dort nicht, weil ohnehin
 * kein Platz ist. Diese Zeile faengt genau die weggefallenen Werte auf.
 *
 * ── Zwei bewusste Entscheidungen ─────────────────────────────────────────
 *
 * 1. **Der Ausloeser sitzt IN der ersten Datenzelle, nicht in einer eigenen
 *    Spalte.** Eine eigene Spalte kostet auf Touch-Geraeten 44px plus
 *    Polsterung — genau die Breite, die auf 390px fehlt. Ausserdem aendert
 *    sie die Spaltenzahl und damit jeden `colSpan` in der Tabelle.
 *
 * 2. **Der Zeilenklick wird NICHT belegt.** In der Projektliste oeffnet er
 *    bereits das Projekt. In der Rechnungsliste waere er frei — dann
 *    verhielte sich dieselbe Geste in zwei Listen verschieden, und genau
 *    diese Uneinheitlichkeit hat das Projekt bei FilterChip und SortTh schon
 *    einmal teuer bezahlt. `rowClickHandler` (utils/rowClick.ts) ignoriert
 *    `<button>`, der Chevron loest also keine Navigation aus.
 *
 * ── Barrierefreiheit ─────────────────────────────────────────────────────
 *
 * Muster ist Disclosure (WAI-ARIA APG), nicht Grid: ein echter `<button>` mit
 * `aria-expanded`, Enter und Leertaste kommen vom Browser. Kein `tabIndex` an
 * der `<tr>`, keine Pfeiltasten, keine erfundene Rolle.
 *
 * Der Name benennt die ZEILE, nicht die Aktion — zwanzigmal „Details" waere
 * mehrdeutig (WCAG 2.4.6). Er bleibt ueber den Zustandswechsel STABIL, weil
 * Sprachsteuerung sonst den Knopf nicht mehr findet; den Zustand traegt
 * ausschliesslich `aria-expanded`.
 *
 * Der Fokus wird beim Aufklappen NICHT verschoben: Der Inhalt folgt direkt im
 * DOM, der naechste Tabulator erreicht ihn von selbst. Ein Sprung waere ein
 * unangekuendigter Kontextwechsel (WCAG 3.2.1).
 */

/** Ein Beschriftung/Wert-Paar im aufgeklappten Bereich. */
export interface DetailFeld {
  label: string
  wert:  ReactNode
}

/** Zustand aller aufgeklappten Zeilen einer Liste. */
export function useRowDisclosure() {
  const [offen, setOffen] = useState<Set<string>>(() => new Set())

  const toggle = useCallback((key: string) => {
    setOffen(prev => {
      const s = new Set(prev)
      if (s.has(key)) s.delete(key); else s.add(key)
      return s
    })
  }, [])

  // Bewusst NICHT ueber useStickyState: Ein gespeicherter Zustand klappt nach
  // einem Filterwechsel Zeilen auf, die es gar nicht mehr gibt. Die
  // Detailzeile ist eine Momentaufnahme („was hat die Tabelle mir gerade
  // verschwiegen"), keine Voreinstellung. Ein Schluessel ohne Zeile ist
  // folgenlos — er findet nichts.
  return {
    istOffen: useCallback((key: string) => offen.has(key), [offen]),
    toggle,
  }
}

/**
 * Der Chevron-Knopf. Gehoert IN die erste Datenzelle der Zeile.
 * Rendert nichts, wenn es nichts aufzuklappen gibt — ein Bedienelement, das
 * ein leeres Panel oeffnet, verspricht mehr als es haelt.
 */
export function RowExpandButton({
  offen, onToggle, bezeichnung, panelId, sichtbar = true,
}: {
  offen:        boolean
  onToggle:     () => void
  /** Benennt die ZEILE, z.B. „Rechnung RE-2026-0042". */
  bezeichnung:  string
  panelId:      string
  sichtbar?:    boolean
}) {
  if (!sichtbar) return null
  return (
    <button
      type="button"
      className="row-expand-btn"
      aria-expanded={offen}
      aria-controls={offen ? panelId : undefined}
      aria-label={`Weitere Angaben zu ${bezeichnung}`}
      onClick={e => { e.stopPropagation(); onToggle() }}
    >
      <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}

/**
 * Die Detailzeile selbst. Gehoert unmittelbar hinter ihre Datenzeile, beide
 * zusammen in einem `<Fragment key={zeilenSchluessel}>` — dann wandert der
 * aufgeklappte Zustand beim Sortieren mit der Zeile.
 *
 * `spalten` ist die Spaltenzahl der Kopfzeile. Sie muss dieselbe Groesse sein,
 * aus der auch die Leerzeile ihren colSpan bezieht; ein zu grosser Wert
 * spannt eine Phantomspalte auf und verbreitert die Tabelle.
 */
export function RowDetailRow({
  offen, panelId, spalten, felder,
}: {
  offen:    boolean
  panelId:  string
  spalten:  number
  felder:   DetailFeld[]
}) {
  if (!offen || felder.length === 0) return null
  return (
    <tr className="row-detail">
      <td colSpan={spalten}>
        {/* <dl> mit <div>-Gruppen ist seit HTML 5.2 gueltig und wird als
            Liste von Paaren vorgelesen. */}
        <dl className="row-detail-list" id={panelId}>
          {felder.map(f => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.wert}</dd>
            </div>
          ))}
        </dl>
      </td>
    </tr>
  )
}

/** Stabile ID fuer die Verknuepfung Ausloeser -> Panel. */
export function useDetailPanelId(): (key: string) => string {
  const basis = useId()
  return useCallback((key: string) => `${basis}-${key}`.replace(/[^\w-]/g, '_'), [basis])
}

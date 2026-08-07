import type { MouseEvent } from 'react'

/**
 * Elemente, bei denen ein Zeilen-Klick NICHT ausloesen darf. In den Listen
 * stehen Inline-Selects, Checkboxen und Aktions-Knoepfe in derselben Zeile —
 * ohne diese Abgrenzung wuerde ein Klick ins Statusfeld die Navigation
 * ausloesen, statt das Feld zu oeffnen.
 */
const INTERACTIVE = [
  'button', 'a', 'input', 'select', 'textarea', 'label',
  '[role="menu"]', '[role="menuitem"]', '[contenteditable="true"]',
].join(',')

/**
 * Macht eine Tabellenzeile als Ganzes anklickbar.
 *
 * WICHTIG fuer die Barrierefreiheit: Die Zeile selbst bekommt bewusst KEIN
 * `tabIndex`. Ein `<tr>` ist kein Bedienelement, und acht zusaetzliche
 * Tab-Stopps pro Seite waeren fuer Tastaturnutzer eher Ballast. Stattdessen
 * traegt die erste Zelle einen echten Button mit derselben Aktion — der ist
 * fokussierbar, wird vorgelesen und dient zugleich als sichtbarer Hinweis,
 * dass die Zeile zu etwas fuehrt.
 */
export function rowClickHandler(onOpen: () => void) {
  return (e: MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement | null
    if (target?.closest(INTERACTIVE)) return
    // Wer Text in der Zeile markiert, will nicht navigieren.
    if (window.getSelection()?.toString()) return
    onOpen()
  }
}

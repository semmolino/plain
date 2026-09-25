interface Props {
  /** Beschriftungen der Schritte. Rein numerische Wizards uebergeben ['1','2',…]. */
  steps: string[]
  /** Index des aktuellen Schritts (0-basiert). */
  current: number
  /** Wenn gesetzt, sind bereits erledigte Schritte anwaehlbar. */
  onStepClick?: (index: number) => void
  /** Auf dem Handy „Schritt 2 von 4 · Name" mit Balken statt vier
   *  gequetschter Kacheln (UI-Pilot 2026-09). */
  compactOnMobile?: boolean
}

/**
 * Fortschrittsanzeige eines Wizards.
 *
 * Loest fuenf lokale Kopien ab (Honorar-, Projekt-Anlage-, Rechnungs-,
 * Abschlags- und Schlussrechnungs-Wizard) mit drei verschiedenen Signaturen.
 *
 * Gegenueber den Kopien korrigiert:
 * - Erledigte Schritte waren anklickbare `<div>` ohne Tastaturzugang. Jetzt
 *   echte `<button>`, wenn sie anwaehlbar sind — sonst `<li>` ohne Fokus.
 * - `aria-current="step"` markiert den aktuellen Schritt; zusaetzlich nennt
 *   eine nur fuer Screenreader sichtbare Zeile Position und Gesamtzahl.
 *   Vorher war der Fortschritt ausschliesslich farblich kodiert.
 * - Die Liste ist eine `<ol>`, damit die Reihenfolge auch vorgelesen wird.
 */
export function StepIndicator({ steps, current, onStepClick, compactOnMobile }: Props) {
  return (
    <>
      <p className="sr-only">Schritt {current + 1} von {steps.length}: {steps[current]}</p>
      {compactOnMobile && (
        <div className="wizard-steps-mobile" aria-hidden="true">
          <span className="wizard-steps-mobile-label">Schritt {current + 1} von {steps.length} · <strong>{steps[current]}</strong></span>
          <span className="wizard-steps-mobile-bar">
            {steps.map((s, i) => <span key={s + i} className={`wizard-steps-mobile-seg${i <= current ? ' done' : ''}`} />)}
          </span>
        </div>
      )}
      <ol className={`wizard-steps${compactOnMobile ? ' wizard-steps--compact' : ''}`}>
        {steps.map((label, i) => {
          const state = i === current ? ' active' : i < current ? ' done' : ''
          const selectable = onStepClick && i < current
          return (
            <li key={label + i} className={`wizard-step${state}`} aria-current={i === current ? 'step' : undefined}>
              {selectable
                ? <button type="button" className="wizard-step-btn" onClick={() => onStepClick(i)}>{label}</button>
                : label}
            </li>
          )
        })}
      </ol>
    </>
  )
}

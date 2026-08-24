import { X } from 'lucide-react'
import { useToastStore } from '@/store/toastStore'

/**
 * Meldungen — Anzeige und Ansage bewusst getrennt.
 *
 * **Das Problem vorher:** Der Bereich wurde nur gerendert, wenn es etwas zu
 * melden gab (`if (!toasts.length) return null`). Screenreader beobachten
 * aber Live-Bereiche, die beim Seitenaufbau schon da sind — ein Bereich, der
 * gemeinsam mit seinem Inhalt neu ins Dokument kommt, wird in der Regel NICHT
 * vorgelesen. Das `role="alert"` an der Meldung lief damit ins Leere: optisch
 * eine Rueckmeldung, akustisch keine. Messbar war das an `aria-live`: null
 * Vorkommen in der gesamten Anwendung.
 *
 * **Warum zwei Bereiche statt einem:** „assertive" unterbricht den
 * Vorlesefluss sofort, „polite" laesst den laufenden Satz zu Ende. Fuer
 * „Konnte nicht gespeichert werden" ist Unterbrechen richtig, fuer
 * „Gespeichert" zu aufdringlich. Ein `role="alert"` INNERHALB eines
 * `role="status"` zu verschachteln waere der naheliegende Weg gewesen — das
 * Verhalten ist zwischen Screenreadern aber nicht verlaesslich. Zwei
 * getrennte, dauerhaft vorhandene Bereiche sind eindeutig.
 *
 * **Warum die sichtbaren Meldungen `aria-hidden` sind:** Sonst kaeme jede
 * Meldung doppelt an — einmal aus dem Ansage-Bereich, einmal aus dem
 * sichtbaren. Der Schliessen-Knopf bleibt bedienbar; er traegt seinen eigenen
 * Namen und liegt ausserhalb des ausgeblendeten Textes.
 */
export function ToastContainer() {
  const { toasts, remove } = useToastStore()

  // Jeweils die juengste Meldung je Dringlichkeit. Mehr braucht die Ansage
  // nicht: Wer drei Meldungen gleichzeitig vorgelesen bekommt, versteht keine.
  const letzteMeldung = (dringend: boolean) => {
    for (let i = toasts.length - 1; i >= 0; i--) {
      if ((toasts[i].type === 'error') === dringend) return toasts[i].message
    }
    return ''
  }

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">{letzteMeldung(false)}</div>
      <div className="sr-only" role="alert"  aria-live="assertive">{letzteMeldung(true)}</div>

      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-message" aria-hidden="true">{t.message}</span>
            <button
              className="toast-close"
              onClick={() => remove(t.id)}
              aria-label={`Meldung schließen: ${t.message}`}
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

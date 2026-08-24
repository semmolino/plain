import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDefaults } from '@/api/stammdaten'
import { addDaysIso } from '@/utils/vorbelegung'

/**
 * Vorbelegungen des Mandanten (Einstellungen → Vorbelegungen).
 *
 * Zentral, weil die Werte in Adressen, Projekten, Angeboten und allen
 * Rechnungs-Assistenten gebraucht werden — der gemeinsame Query-Key sorgt
 * dafür, dass alle Formulare denselben Stand sehen und nach dem Speichern in
 * den Einstellungen gemeinsam aktualisiert werden.
 */
export function useTenantDefaults() {
  const { data } = useQuery({ queryKey: ['defaults'], queryFn: fetchDefaults })
  return data?.data ?? {}
}

/** Vorbelegung als String ('' wenn nicht gesetzt) — passend für Select/Input-Value. */
export function useDefaultString(key: string): string {
  return useTenantDefaults()[key] ?? ''
}

/** Zahlungsziel in Kalendertagen — null, wenn keine Vorbelegung gepflegt ist. */
export function usePaymentTermDays(): number | null {
  const raw = useTenantDefaults().default_payment_term_days
  const n = parseInt(String(raw ?? ''), 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Fälligkeitsdatum eines Belegs, vorbelegt aus Belegdatum + Zahlungsziel.
 *
 * Verhalten wie bei „Gültig bis" im Angebots-Assistenten: die Vorbelegung folgt
 * dem Belegdatum, solange der Nutzer das Fälligkeitsdatum nicht selbst
 * angefasst hat. Danach bleibt seine Eingabe stehen.
 *
 * @param documentDate Belegdatum (ISO, 'YYYY-MM-DD')
 * @returns [dueDate, setDueDate, resetDueDate, termDays]
 *          resetDueDate stellt die Vorbelegung wieder her (nach dem Buchen);
 *          termDays ist null, wenn kein Zahlungsziel gepflegt ist.
 */
export function useDueDatePreset(documentDate: string) {
  const termDays = usePaymentTermDays()
  const [dueDate, setState] = useState('')
  const [touched, setTouched] = useState(false)
  // Zählt jeden Reset mit, damit die Vorbelegung auch dann neu greift, wenn
  // sich weder Belegdatum noch Zahlungsziel geändert haben.
  const [resetNonce, setResetNonce] = useState(0)

  useEffect(() => {
    if (touched || termDays === null) return
    const next = addDaysIso(documentDate, termDays)
    if (next) setState(prev => (prev === next ? prev : next))
  }, [documentDate, termDays, touched, resetNonce])

  const setDueDate = useCallback((v: string) => { setTouched(true); setState(v) }, [])
  const resetDueDate = useCallback(() => { setTouched(false); setState(''); setResetNonce(n => n + 1) }, [])

  return [dueDate, setDueDate, resetDueDate, termDays] as const
}

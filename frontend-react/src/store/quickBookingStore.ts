import { create } from 'zustand'

export interface QuickBookingPrefill {
  projectId?:   number
  structureId?: number
  date?:        string
  /** Beschreibung vorbelegen („Nochmal buchen" in „Meine Zeit"). */
  description?: string
  /** Mitarbeiter waehlbar (nur aus dem Projekt-Tab „Buchungen" heraus). */
  allowOtherEmployee?: boolean
}

interface QuickBookingState {
  isOpen:  boolean
  prefill: QuickBookingPrefill
  open:    (prefill?: QuickBookingPrefill) => void
  close:   () => void
}

/**
 * Oeffnet den einen Dialog „Zeit buchen" (components/zeit/QuickBookingDialog)
 * von ueberall — Kopfzeile, Uebersicht, Buchungen-Tab. Der Dialog selbst ist
 * einmal in AppLayout eingehaengt.
 */
export const useQuickBooking = create<QuickBookingState>(set => ({
  isOpen:  false,
  prefill: {},
  open:    (prefill = {}) => set({ isOpen: true, prefill }),
  close:   () => set({ isOpen: false }),
}))

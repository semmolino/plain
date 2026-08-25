import type { ReactNode } from 'react'

export interface ShellProps {
  /** Stempeluhr in der Kopfzeile — kann mandantenweit abgeschaltet sein. */
  timerEnabled: boolean
  /** Seiteninhalt inkl. Toasts und Lizenzbanner. */
  children: ReactNode
}

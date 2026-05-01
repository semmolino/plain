import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface TimerSession {
  employeeId:       number
  employeeName:     string
  cpRate:           number
  projectId:        number
  projectName:      string
  structureId:      number
  structureName:    string
  blockStartIso:    string  // ISO timestamp when current block started
}

interface TimerStore {
  session:     TimerSession | null
  showReview:  boolean

  startSession: (s: TimerSession) => void
  nextBlock:    (structureId: number, structureName: string, projectId: number, projectName: string) => void
  endSession:   () => void
  openReview:   () => void
  closeReview:  () => void
}

export const useTimerStore = create<TimerStore>()(
  persist(
    (set, get) => ({
      session:    null,
      showReview: false,

      startSession: (s) => set({ session: s, showReview: false }),

      nextBlock: (structureId, structureName, projectId, projectName) => {
        const prev = get().session
        if (!prev) return
        set({
          session: {
            ...prev,
            structureId,
            structureName,
            projectId,
            projectName,
            blockStartIso: new Date().toISOString(),
          },
        })
      },

      endSession: () => set({ session: null, showReview: false }),

      openReview:  () => set({ showReview: true }),
      closeReview: () => set({ showReview: false }),
    }),
    {
      name: 'plain-timer-session',
    }
  )
)

// Helpers used by components
export function elapsedSeconds(isoStart: string): number {
  return Math.floor((Date.now() - new Date(isoStart).getTime()) / 1000)
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDurationHuman(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  if (h > 0 && m > 0) return `${h}h ${m}min`
  if (h > 0) return `${h}h`
  return `${m}min`
}

export function quantityFromSeconds(totalSeconds: number): number {
  return Math.round((totalSeconds / 3600) * 100) / 100
}

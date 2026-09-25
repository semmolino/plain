import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'
import { GuardContext, type GuardEntry } from '@/hooks/useDirtyGuard'
import { Modal } from './Modal'
import { DialogFooter } from './DialogFooter'
import { Message } from './Message'

/**
 * Warnung bei ungespeicherten Aenderungen (UI-Pilot 2026-09).
 *
 * Anlass: In der Projektstruktur gingen Eingaben beim Tab- oder
 * Projektwechsel still verloren — der Speichern-Knopf stand am Tabellenende,
 * und nichts sagte, dass es etwas zu speichern gab.
 *
 * Aufbau: ein Provider je Seite, bei dem sich bearbeitbare Bereiche mit
 * `useRegisterDirty` melden. Seitenwechsel innerhalb der Seite (Tabs, anderes
 * Projekt, Zurueck-Link) laufen ueber `useGuardedAction()` und fragen nach,
 * wenn etwas offen ist. Neuladen und Schliessen des Tabs faengt
 * `beforeunload` ab — nur als Rueckfrage, ohne Server-Aufruf.
 *
 * Seit Runde 2 (Data-Router, App.tsx) faengt `useBlocker` auch, was an der
 * Seite vorbeilaeuft: ein Klick in die Seitennavigation (anderer Pfad) und
 * Zurueck/Vor des Browsers. Seiteninterne Wechsel mit demselben Pfad
 * (`?tab=…`, Korrekturen per `replace`) blockiert er nicht — die laufen
 * ueber `useGuardedAction()`, und deren „Verwerfen" darf nicht ein zweites
 * Mal fragen (`bypass`).
 */


export function DirtyGuardProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, { current: GuardEntry }>())
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const dirtyEntries = () => [...entries.current.values()].map(e => e.current).filter(e => e.dirty)

  const register   = useCallback((key: string, entry: { current: GuardEntry }) => { entries.current.set(key, entry) }, [])
  const unregister = useCallback((key: string) => { entries.current.delete(key) }, [])
  // Eine bestaetigte (oder rueckfragefreie) Aktion laeuft am Blocker vorbei.
  const bypass = useRef(false)
  const runUnblocked = useCallback((action: () => void) => {
    bypass.current = true
    try { action() } finally { queueMicrotask(() => { bypass.current = false }) }
  }, [])
  const request    = useCallback((action: () => void) => {
    if (dirtyEntries().length === 0) { runUnblocked(action); return }
    setError(null)
    setPending(() => action)
  }, [runUnblocked])

  const blocker = useBlocker(({ currentLocation, nextLocation, historyAction }) => {
    if (bypass.current || dirtyEntries().length === 0) return false
    return currentLocation.pathname !== nextLocation.pathname || historyAction === 'POP'
  })
  const blocked = blocker.state === 'blocked'

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyEntries().length === 0) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const open    = pending !== null || blocked
  const current = open ? dirtyEntries() : []
  const canSave = current.length > 0 && current.every(e => !!e.save)
  const what    = current.map(e => (e.count ? `${e.count} ${e.count === 1 ? 'Änderung' : 'Änderungen'}` : 'Änderungen')
    + (e.label ? ` in „${e.label}"` : '')).join(', ')

  function proceed() {
    if (blocked) { blocker.proceed?.(); return }
    const action = pending
    setPending(null)
    if (action) runUnblocked(action)
  }
  function cancel() {
    if (blocked) blocker.reset?.()
    setPending(null)
  }

  async function saveAndProceed() {
    setSaving(true); setError(null)
    try {
      for (const e of current) await e.save?.()
      proceed()
    } catch (err) {
      setError((err as Error)?.message || 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  return (
    <GuardContext.Provider value={{ register, unregister, request }}>
      {children}
      <Modal open={open} onClose={cancel} title="Ungespeicherte Änderungen">
        <p className="guard-text">
          {what ? `${what} ${current.length === 1 && (current[0].count ?? 2) === 1 ? 'ist' : 'sind'} noch nicht gespeichert.` : 'Es gibt ungespeicherte Änderungen.'}
          {' '}Beim Wechseln gehen sie verloren.
        </p>
        <Message text={error} type="error" />
        <DialogFooter
          secondary={<button type="button" className="btn-secondary" onClick={proceed} disabled={saving}>Verwerfen</button>}
        >
          <button type="button" className="btn-secondary" onClick={cancel} disabled={saving}>Abbrechen</button>
          {canSave && (
            <button type="button" className="btn-primary" onClick={() => void saveAndProceed()} disabled={saving}>
              {saving ? 'Speichert …' : 'Speichern und wechseln'}
            </button>
          )}
        </DialogFooter>
      </Modal>
    </GuardContext.Provider>
  )
}


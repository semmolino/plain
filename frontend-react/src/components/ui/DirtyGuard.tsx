import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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
 * Grenze (bewusst, Runde 1): Klicks in der Seitennavigation und der
 * Zurueck-Knopf des Browsers laufen am Guard vorbei. Das zu fangen braucht
 * den Data-Router von React Router (`useBlocker`); die Umstellung ist ein
 * eigener Schritt.
 */


export function DirtyGuardProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, { current: GuardEntry }>())
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const dirtyEntries = () => [...entries.current.values()].map(e => e.current).filter(e => e.dirty)

  const register   = useCallback((key: string, entry: { current: GuardEntry }) => { entries.current.set(key, entry) }, [])
  const unregister = useCallback((key: string) => { entries.current.delete(key) }, [])
  const request    = useCallback((action: () => void) => {
    if (dirtyEntries().length === 0) { action(); return }
    setError(null)
    setPending(() => action)
  }, [])

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyEntries().length === 0) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const open    = pending !== null
  const current = open ? dirtyEntries() : []
  const canSave = current.length > 0 && current.every(e => !!e.save)
  const what    = current.map(e => (e.count ? `${e.count} ${e.count === 1 ? 'Änderung' : 'Änderungen'}` : 'Änderungen')
    + (e.label ? ` in „${e.label}"` : '')).join(', ')

  function proceed() {
    const action = pending
    setPending(null)
    action?.()
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
      <Modal open={open} onClose={() => setPending(null)} title="Ungespeicherte Änderungen">
        <p className="guard-text">
          {what ? `${what} ${current.length === 1 && (current[0].count ?? 2) === 1 ? 'ist' : 'sind'} noch nicht gespeichert.` : 'Es gibt ungespeicherte Änderungen.'}
          {' '}Beim Wechseln gehen sie verloren.
        </p>
        <Message text={error} type="error" />
        <DialogFooter
          secondary={<button type="button" className="btn-secondary" onClick={proceed} disabled={saving}>Verwerfen</button>}
        >
          <button type="button" className="btn-secondary" onClick={() => setPending(null)} disabled={saving}>Abbrechen</button>
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


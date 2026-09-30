import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { useToast } from '@/store/toastStore'
import { copyProject } from '@/api/projekte'
import { useDerivedAbbr, useInvalidateGroups } from './gesamtprojektUi'

/**
 * Folgeprojekt: Kopie eines Projekts im selben Gesamtprojekt (Struktur, Team,
 * Vertrag gehen mit — wie „Kopieren" in der Projektliste). Einziger
 * Unterschied: die Nummer darf vom Gesamtprojekt abgeleitet sein.
 */
export function FolgeprojektDialog({ source, groupId, onClose, onCreated }: {
  source:    { ID: number; ABBR: string; NAME: string } | null
  groupId:   number
  onClose:   () => void
  onCreated: (projectId: number) => void
}) {
  if (!source) return null
  return <Inner source={source} groupId={groupId} onClose={onClose} onCreated={onCreated} />
}

function Inner({ source, groupId, onClose, onCreated }: {
  source:    { ID: number; ABBR: string; NAME: string }
  groupId:   number
  onClose:   () => void
  onCreated: (projectId: number) => void
}) {
  const toast = useToast()
  const invalidate = useInvalidateGroups()
  const derivedAbbr = useDerivedAbbr(String(groupId))
  const [derived, setDerived] = useState(true)
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const useDerived = derived && !!derivedAbbr

  async function save() {
    if (pending) return
    setPending(true)
    setErr(null)
    try {
      const res = await copyProject(source.ID, useDerived ? derivedAbbr! : undefined)
      await invalidate()
      toast.success(`Folgeprojekt ${res.data.project.ABBR} angelegt.`)
      onCreated(res.data.project.ID)
    } catch (e) {
      setErr((e as Error)?.message || 'Anlegen fehlgeschlagen')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal open onClose={() => { if (!pending) onClose() }} title="Folgeprojekt anlegen">
      <div className="pg-dialog-body">
        <p className="form-field-hint">
          Kopie von <strong>{source.ABBR}</strong> · {source.NAME}: Struktur, Team und Vertrag gehen mit,
          Buchungen und Rechnungen nicht. Das neue Projekt gehört zum selben Gesamtprojekt.
        </p>
        <fieldset className="pg-fieldset pg-wahl-nummer">
          <legend>Projektnummer</legend>
          <label className="pg-radio">
            <input type="radio" name="fp-abbr" checked={useDerived} disabled={!derivedAbbr} onChange={() => setDerived(true)} />
            {derivedAbbr ? <>Abgeleitet: <strong>{derivedAbbr}</strong></> : 'Abgeleitet — das Gesamtprojekt hat kein Kürzel'}
          </label>
          <label className="pg-radio">
            <input type="radio" name="fp-abbr" checked={!useDerived} onChange={() => setDerived(false)} />
            Nächste Nummer aus dem Nummernkreis
          </label>
        </fieldset>
        <Message type="error" text={err} />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={pending}>
            {pending ? 'Legt an …' : 'Folgeprojekt anlegen'}
          </button>
        </DialogFooter>
      </div>
    </Modal>
  )
}

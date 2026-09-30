import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, KeyRound, CircleCheck, CircleAlert } from 'lucide-react'
import { useConfirm } from '@/hooks/useConfirm'
import { useAuthStore } from '@/store/authStore'
import { fetchEmployeeAccess, sendEmployeeInvite, setEmployeePassword, type Employee, type EmployeeAccessState } from '@/api/mitarbeiter'
import { FormSection } from '@/components/ui/FormSection'
import { Message } from '@/components/ui/Message'

/**
 * Reiter „Zugang" der Mitarbeiterseite (UI-Pilot Runde 10) — nur mit dem
 * Recht „Passwörter setzen" sichtbar.
 *
 * Vorher löschte „Passwort löschen" ohne Rückfrage, und der Reiter stand
 * auch ohne das Recht da: der Stand lud mit einer Fehlermeldung, beide
 * Knöpfe endeten mit „Fehlende Berechtigung".
 */

function accessText(a: EmployeeAccessState | undefined): { ok: boolean; text: string } {
  if (!a) return { ok: false, text: 'Stand wird geladen …' }
  if (a.can_login) return { ok: true, text: 'Anmeldung möglich — ein Passwort ist gesetzt.' }
  if (!a.has_mail) return { ok: false, text: 'Keine Anmeldung möglich: keine E-Mail-Adresse hinterlegt.' }
  if (!a.active)   return { ok: false, text: 'Keine Anmeldung möglich: der Mitarbeiter ist inaktiv.' }
  return { ok: false, text: 'Keine Anmeldung möglich: es ist noch kein Passwort gesetzt.' }
}

export function MitarbeiterZugang({ employee }: { employee: Employee }) {
  const qc = useQueryClient()
  const ownId = useAuthStore(s => s.employeeId)
  const isSelf = ownId != null && Number(ownId) === employee.ID
  const [confirm, confirmDialog] = useConfirm()
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const { data: access, isError } = useQuery({
    queryKey: ['employee-access', employee.ID],
    queryFn:  () => fetchEmployeeAccess(employee.ID),
  })
  const state = accessText(access)
  const name = `${employee.FIRST_NAME} ${employee.LAST_NAME}`.trim()
  const inactive = employee.ACTIVE === 2

  async function invite() {
    setPending(true); setMsg(null)
    try {
      const r = await sendEmployeeInvite(employee.ID)
      setMsg({ type: 'success', text: `Einladung an ${r.mail} gesendet. Der Link ist 7 Tage gültig.` })
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error)?.message || 'Einladung nicht gesendet' })
    } finally { setPending(false) }
  }

  async function lock() {
    const ok = await confirm({
      title: 'Passwort löschen?',
      message: `${name} wird sofort abgemeldet und kann sich erst wieder anmelden, wenn eine neue Einladung angenommen ist. Das Konto, seine Buchungen und Rollen bleiben.`,
      confirmLabel: 'Passwort löschen',
    })
    if (!ok) return
    setPending(true); setMsg(null)
    try {
      await setEmployeePassword(employee.ID, null)
      await qc.invalidateQueries({ queryKey: ['employee-access', employee.ID] })
      setMsg({ type: 'success', text: 'Passwort gelöscht — Anmeldung erst nach einer neuen Einladung möglich.' })
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error)?.message || 'Passwort nicht gelöscht' })
    } finally { setPending(false) }
  }

  return (
    <div className="ws-form">
      <FormSection title="Anmeldung" layout="block"
        hint="Das Passwort wählt der Mitarbeiter selbst: er bekommt eine Einladung mit einem einmaligen Link. Ein von dir vergebenes Passwort gibt es bewusst nicht.">
        {isError
          ? <Message type="error" text="Der Stand ließ sich nicht laden." />
          : (
            <p className={`ma-access ${state.ok ? 'ma-access--ok' : 'ma-access--open'}`}>
              {state.ok
                ? <CircleCheck size={16} strokeWidth={2} aria-hidden="true" />
                : <CircleAlert size={16} strokeWidth={2} aria-hidden="true" />}
              {state.text}
            </p>
          )}
      </FormSection>

      <FormSection title="Einladung" layout="block"
        hint="Der Link ist 7 Tage gültig und entwertet frühere Einladungen. Hat der Mitarbeiter schon ein Passwort, legt er damit ein neues fest.">
        {!employee.MAIL && <p className="form-field-hint">Zuerst unter „Stammdaten" eine E-Mail-Adresse eintragen.</p>}
        {inactive && <p className="form-field-hint">Der Mitarbeiter ist inaktiv — erst unter „Stammdaten" wieder auf aktiv stellen.</p>}
        <div className="ma-access-actions">
          <button type="button" className="btn-primary" onClick={() => void invite()} disabled={pending || !employee.MAIL || inactive}>
            <Mail size={14} strokeWidth={2} aria-hidden="true" />{pending ? 'Sendet …' : 'Einladung senden'}
          </button>
        </div>
      </FormSection>

      {!isSelf && (
        <FormSection title="Zugang sperren" layout="block"
          hint="Löscht das Passwort und beendet laufende Sitzungen sofort, ohne den Mitarbeiter zu löschen. Wieder herein kommt er nur über eine neue Einladung.">
          <div className="ma-access-actions">
            <button type="button" className="btn-danger" onClick={() => void lock()} disabled={pending || access?.has_password === false}>
              <KeyRound size={14} strokeWidth={2} aria-hidden="true" />Passwort löschen
            </button>
          </div>
        </FormSection>
      )}

      <Message type={msg?.type ?? 'info'} text={msg?.text ?? null} />
      {confirmDialog}
    </div>
  )
}

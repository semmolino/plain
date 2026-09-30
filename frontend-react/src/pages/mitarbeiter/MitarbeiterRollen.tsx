import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings } from 'lucide-react'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { usePermission } from '@/store/permissionsStore'
import { fetchRoles, fetchEmployeeRoleMap, setEmployeeRoles } from '@/api/rbac'
import type { Employee } from '@/api/mitarbeiter'
import { ActionBar } from '@/components/ui/ActionBar'
import { FormSection } from '@/components/ui/FormSection'
import { Message } from '@/components/ui/Message'

/**
 * Reiter „Rollen" der Mitarbeiterseite (UI-Pilot Runde 10).
 *
 * Vorher im Dialog: die Auswahl wurde beim Öffnen einmal aus dem geladenen
 * Stand übernommen. Kam der Stand erst danach an (erster Aufruf), standen
 * alle Kästchen leer — ein „Rollen speichern" nahm dem Mitarbeiter dann
 * jede Rolle. Ohne das Recht „Rollen sehen" feuerten die Abfragen trotzdem
 * und endeten als Fehlermeldung.
 *
 * Jetzt liegt die Auswahl über dem geladenen Stand (wie jedes Formular im
 * Arbeitsbereich), Speichern gibt es erst, wenn der Stand da ist, und der
 * Server prüft seit Runde 10, dass niemand Rollen über die eigenen Rechte
 * hinaus vergibt.
 */
export function MitarbeiterRollen({ employee }: { employee: Employee }) {
  const qc = useQueryClient()
  const canView   = usePermission('roles.view')
  const canAssign = usePermission('employees.role.assign')
  const { data: rolesData, isLoading: rolesLoading, isError: rolesError } = useQuery({ queryKey: ['user-roles'], queryFn: fetchRoles, enabled: canView })
  const { data: mapData,   isLoading: mapLoading,   isError: mapError }   = useQuery({ queryKey: ['employee-role-map'], queryFn: fetchEmployeeRoleMap, enabled: canView })
  const [picked, setPicked] = useState<Set<number> | null>(null)
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const roles = rolesData?.data ?? []
  const saved = useMemo(
    () => new Set((mapData?.data ?? []).filter(m => m.EMPLOYEE_ID === employee.ID).map(m => m.ROLE_ID)),
    [mapData, employee.ID],
  )
  const loaded = !!rolesData && !!mapData
  const selected = picked ?? saved
  const dirty = loaded && picked != null && (picked.size !== saved.size || [...picked].some(id => !saved.has(id)))

  function toggle(id: number) {
    setPicked(() => {
      const next = new Set(selected)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setMsg(null)
  }

  async function save() {
    if (!loaded) throw new Error('Die Rollen sind noch nicht geladen.')
    setPending(true)
    setMsg(null)
    try {
      await setEmployeeRoles(employee.ID, [...selected])
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['employee-role-map'] }),
        qc.invalidateQueries({ queryKey: ['user-roles'] }),
      ])
      setPicked(null)
      setMsg({ type: 'success', text: 'Rollen gespeichert. Laufende Sitzungen des Mitarbeiters enden — er meldet sich mit den neuen Rechten an.' })
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error)?.message || 'Speichern fehlgeschlagen' })
      throw e
    } finally {
      setPending(false)
    }
  }

  useRegisterDirty('mitarbeiter-rollen', { dirty, label: 'Rollen', count: dirty ? 1 : 0, save })
  useCtrlS(() => { if (dirty && !pending) void save().catch(() => {}) }, canAssign)

  if (!canView) {
    return (
      <div className="ws-form">
        <Message type="info" text={'Welche Rollen es gibt, sieht nur, wer das Recht „Rollen sehen" hat.'} />
      </div>
    )
  }
  if (rolesError || mapError) return <div className="ws-form"><Message type="error" text="Die Rollen konnten nicht geladen werden." /></div>

  const none = loaded && selected.size === 0
  return (
    <div className="ws-form">
      {!canAssign && <p className="ws-form-readonly">Nur Lesen — zum Ändern fehlt das Recht „Rollen zuweisen".</p>}
      <FormSection
        title="Rollen und Rechte"
        hint="Mehrere Rollen sind möglich — der Mitarbeiter bekommt alle Rechte, die in einer seiner Rollen stehen."
        layout="block"
        actions={(
          <Link to="/admin?tab=rollen" className="ws-facts-link">
            <Settings size={13} strokeWidth={1.75} aria-hidden="true" />Rollen verwalten
          </Link>
        )}
      >
        {rolesLoading || mapLoading ? <p className="empty-note">Lädt …</p> : !roles.length ? (
          <div className="empty-block">
            <p className="empty-note">Noch keine Rollen angelegt.</p>
            <p className="empty-block-why">Rollen bündeln Rechte — angelegt werden sie unter Einstellungen → Rollen &amp; Berechtigungen.</p>
          </div>
        ) : (
          <fieldset className="ma-roles" disabled={!canAssign || pending}>
            <legend className="sr-only">Rollen von {employee.FIRST_NAME} {employee.LAST_NAME}</legend>
            {roles.map(r => {
              const on = selected.has(r.ID)
              return (
                <label key={r.ID} className={`ma-role${on ? ' ma-role--on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(r.ID)} />
                  <span className="ma-role-dot" style={{ background: r.COLOR || 'var(--text-3)' }} aria-hidden="true" />
                  <span className="ma-role-text">
                    <span className="ma-role-name">{r.ABBR}</span>
                    {r.NAME && r.NAME !== r.ABBR && <span className="ma-role-sub">{r.NAME}</span>}
                  </span>
                  {r.IS_SYSTEM && <span className="status-pill">System</span>}
                </label>
              )
            })}
          </fieldset>
        )}
        {none && (
          <p className="form-field-hint">Ohne Rolle hat der Mitarbeiter keine Rechte — er kann sich anmelden, sieht aber fast nichts.</p>
        )}
      </FormSection>

      <Message type={msg?.type ?? 'info'} text={msg?.text ?? null} />

      {canAssign && (
        <ActionBar
          dirty={dirty}
          quiet={!dirty && !pending}
          status={pending ? 'Speichert …' : dirty ? 'Rollen geändert' : 'Keine Änderungen'}
          secondary={dirty ? <button type="button" className="btn-secondary" onClick={() => { setPicked(null); setMsg(null) }} disabled={pending}>Verwerfen</button> : undefined}
        >
          <button type="button" className="btn-primary" onClick={() => void save().catch(() => {})} disabled={!dirty || pending || !loaded}>
            {pending ? 'Speichert …' : 'Speichern'}
          </button>
        </ActionBar>
      )}
    </div>
  )
}

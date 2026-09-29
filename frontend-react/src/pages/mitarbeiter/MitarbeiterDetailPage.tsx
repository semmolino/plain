import { useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, Phone, Smartphone, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import { RowMenu } from '@/components/ui/RowMenu'
import { DirtyGuardProvider } from '@/components/ui/DirtyGuard'
import { useGuardedAction } from '@/hooks/useDirtyGuard'
import { useConfirm } from '@/hooks/useConfirm'
import { usePermission } from '@/store/permissionsStore'
import { useFeature } from '@/store/licenseStore'
import { useAuthStore } from '@/store/authStore'
import { useToast } from '@/store/toastStore'
import { fetchEmployeeList, fetchEmployeeAvatar, fetchRunningBalance, deleteEmployee, type Employee } from '@/api/mitarbeiter'
import { fmtEur } from '@/utils/money'
import { fmtBalance, fmtDateShort } from './mitarbeiterFormat'
import { isMaTab, type MaTab } from './mitarbeiterUrl'
import { MitarbeiterStammdaten } from './MitarbeiterStammdaten'
import { ArbeitszeitVerlauf, KostensatzVerlauf } from './EmployeeHistory'
import { EmployeeTimeAccount } from './EmployeeTimeAccount'
import { EmployeeAbsenceSection } from './EmployeeAbsenceSection'
import { EmployeeProjectsSection } from './EmployeeProjectsSection'
import { MitarbeiterRollen } from './MitarbeiterRollen'
import { MitarbeiterZugang } from './MitarbeiterZugang'

/**
 * Mitarbeiter als Arbeitsbereich (UI-Pilot Runde 10) — im Muster von
 * Projekt, Angebot und Adresse: Kopf mit dem, was man am häufigsten sucht,
 * darunter Reiter, deren Stand in der URL steht (/mitarbeiter/:id?tab=…).
 *
 * Vorher: ein Dialog mit acht Abschnitten, der zum Speichern der Stammdaten
 * von selbst zuging, beim Schließen nichts fragte und im Kopf eine Farbe mit
 * festem Weiß zeigte. Wer einen Mitarbeiter verlinken wollte, konnte es
 * nicht — der Dialog hatte keine Adresse.
 *
 * Einen Einzelabruf gibt es am Server nicht; die Seite liest aus derselben
 * Liste wie die Übersicht (Query-Key `['employees']`). Speichern in einem
 * Reiter aktualisiert damit Kopf und Liste in einem Zug.
 */

export function MitarbeiterDetailPage() {
  return (
    <DirtyGuardProvider>
      <MitarbeiterDetailInner />
    </DirtyGuardProvider>
  )
}

function MitarbeiterDetailInner() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = Number(idParam)
  const navigate = useNavigate()
  const guarded = useGuardedAction()
  const [params, setParams] = useSearchParams()

  const canBookings = usePermission('employees.bookings.view_all')
  const canSalary   = usePermission('employees.salary.view')
  const canAbsence  = usePermission('absence.view')
  const canRoles    = usePermission('roles.view')
  const canAssign   = usePermission('employees.role.assign')
  const canAccess   = usePermission('employees.password.set')

  const { data, isLoading, isError } = useQuery({ queryKey: ['employees'], queryFn: fetchEmployeeList })
  const employees = useMemo(() => data?.data ?? [], [data])
  const employee = employees.find(e => e.ID === id)

  const tabs = useMemo(() => [
    { id: 'stammdaten',  label: 'Stammdaten' },
    { id: 'arbeitszeit', label: 'Arbeitszeit' },
    ...(canSalary   ? [{ id: 'kostensatz',  label: 'Kostensatz' }] : []),
    ...(canBookings ? [{ id: 'zeitkonto',   label: 'Zeitkonto' }] : []),
    ...(canAbsence  ? [{ id: 'abwesenheit', label: 'Abwesenheiten' }] : []),
    { id: 'projekte',    label: 'Projekte' },
    ...(canRoles || canAssign ? [{ id: 'rollen', label: 'Rollen' }] : []),
    ...(canAccess   ? [{ id: 'zugang',      label: 'Zugang' }] : []),
  ] as { id: MaTab; label: string }[], [canSalary, canBookings, canAbsence, canRoles, canAssign, canAccess])

  const raw = params.get('tab')
  const tab: MaTab = isMaTab(raw) && tabs.some(t => t.id === raw) ? raw : 'stammdaten'
  const setTab = (t: string) => guarded(() => setParams(t === 'stammdaten' ? {} : { tab: t }))
  const back = () => guarded(() => navigate('/mitarbeiter'))

  if (isLoading) return <div className="master-page"><p className="empty-note">Lädt …</p></div>
  if (isError || !employee) return (
    <div className="master-page">
      <PageHeader title="Mitarbeiter nicht gefunden" back={{ label: 'Mitarbeiter', onClick: () => navigate('/mitarbeiter') }} />
      <p className="empty-note">Diesen Mitarbeiter gibt es nicht (mehr), oder die Liste ließ sich nicht laden.</p>
    </div>
  )

  return (
    <div className="master-page">
      <MitarbeiterHeader employee={employee} onBack={back} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="master-tab-content">
        {tab === 'stammdaten'  && <MitarbeiterStammdaten employee={employee} employees={employees} />}
        {tab === 'arbeitszeit' && <ArbeitszeitVerlauf key={employee.ID} employee={employee} />}
        {tab === 'kostensatz'  && <KostensatzVerlauf key={employee.ID} employee={employee} />}
        {tab === 'zeitkonto'   && <EmployeeTimeAccount key={employee.ID} empId={employee.ID} />}
        {tab === 'abwesenheit' && <EmployeeAbsenceSection key={employee.ID} employeeId={employee.ID} employeeLabel={`${employee.FIRST_NAME} ${employee.LAST_NAME}`} />}
        {tab === 'projekte'    && <EmployeeProjectsSection key={employee.ID} employeeId={employee.ID} />}
        {tab === 'rollen'      && <MitarbeiterRollen key={employee.ID} employee={employee} />}
        {tab === 'zugang'      && <MitarbeiterZugang key={employee.ID} employee={employee} />}
      </div>
    </div>
  )
}

// ── Kopf ────────────────────────────────────────────────────────────────────

function MitarbeiterHeader({ employee, onBack }: { employee: Employee; onBack: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const canDelete   = usePermission('employees.delete')
  const canSalary   = usePermission('employees.salary.view')
  const inTariff    = useFeature('employees.salary')
  const canBookings = usePermission('employees.bookings.view_all')
  const ownId = useAuthStore(s => s.employeeId)
  const isSelf = ownId != null && Number(ownId) === employee.ID

  const { data: avatarRes } = useQuery({ queryKey: ['emp-avatar', employee.ID], queryFn: () => fetchEmployeeAvatar(employee.ID) })
  // Gleicher Query-Key wie das Zeitkonto — nach einer Buchungsänderung dort
  // zieht der Kopf von selbst nach.
  const { data: runRes } = useQuery({
    queryKey: ['emp-balance-running', employee.ID],
    queryFn:  () => fetchRunningBalance(employee.ID),
    enabled:  canBookings,
  })
  const running = runRes?.data?.totalBalance ?? null
  const avatar = avatarRes?.data?.data_uri ?? null
  const name = `${employee.FIRST_NAME ?? ''} ${employee.LAST_NAME ?? ''}`.trim() || employee.ABBR
  const initials = `${employee.FIRST_NAME?.[0] ?? ''}${employee.LAST_NAME?.[0] ?? ''}`.toUpperCase() || '?'
  const inactive = employee.ACTIVE === 2

  async function remove() {
    const ok = await confirm({
      title: 'Mitarbeiter löschen?',
      message: `${employee.ABBR} · ${name} wird endgültig gelöscht. Hat er schon gebucht, ist Zuständiger an Belegen oder hat Abwesenheiten, lehnt plan&simple das ab und sagt, wo — dann ist „inaktiv" der richtige Weg.`,
      confirmLabel: 'Löschen',
    })
    if (!ok) return
    try {
      await deleteEmployee(employee.ID)
      void qc.invalidateQueries({ queryKey: ['employees'] })
      void qc.invalidateQueries({ queryKey: ['license-usage'] })
      toast.success(`${name} gelöscht.`)
      navigate('/mitarbeiter')
    } catch (e) {
      toast.error((e as Error)?.message || 'Löschen fehlgeschlagen')
    }
  }

  return (
    <>
      <PageHeader
       
        back={{ label: 'Mitarbeiter', onClick: onBack }}
        eyebrow={<>
          <span>{employee.ABBR}</span>
          {employee.PERSONNEL_NUMBER && <span>Pers.-Nr. {employee.PERSONNEL_NUMBER}</span>}
          <span className={`status-pill${inactive ? ' ma-pill-inactive' : ''}`}>{inactive ? 'Inaktiv' : 'Aktiv'}</span>
        </>}
        title={<span className="ma-title">
          <span className="ma-avatar" aria-hidden="true">
            {avatar ? <img src={avatar} alt="" /> : initials}
          </span>
          {name}
        </span>}
        meta={<>
          {(employee.DEPARTMENT_NAME || employee.CURRENT_MODEL_NAME) && (
            <span>{[employee.DEPARTMENT_NAME, employee.CURRENT_MODEL_NAME].filter(Boolean).join(' · ')}</span>
          )}
          {employee.ENTRY_DATE && <span>seit {fmtDateShort(employee.ENTRY_DATE)}{employee.EXIT_DATE ? ` · bis ${fmtDateShort(employee.EXIT_DATE)}` : ''}</span>}
          {employee.MAIL && <a className="ad-meta-link" href={`mailto:${employee.MAIL}`}><Mail size={13} strokeWidth={1.75} aria-hidden="true" />{employee.MAIL}</a>}
          {employee.PHONE && <a className="ad-meta-link" href={`tel:${employee.PHONE}`}><Phone size={13} strokeWidth={1.75} aria-hidden="true" />{employee.PHONE}</a>}
          {employee.MOBILE && <a className="ad-meta-link" href={`tel:${employee.MOBILE}`}><Smartphone size={13} strokeWidth={1.75} aria-hidden="true" />{employee.MOBILE}</a>}
          {canSalary && inTariff && employee.CURRENT_COST_RATE != null && (
            <span><span className="page-header-meta-label">Kostensatz</span> {fmtEur(Number(employee.CURRENT_COST_RATE))}/h</span>
          )}
          {canBookings && running != null && (
            <span><span className="page-header-meta-label">Saldo</span>
              <span className={running < 0 ? 'ma-balance-neg' : undefined}>{fmtBalance(running)}</span>
            </span>
          )}
        </>}
        actions={canDelete && !isSelf ? (
          <RowMenu label="Weitere Aktionen zum Mitarbeiter" triggerClassName="btn-secondary pw-more-btn">
            <button type="button" role="menuitem" className="row-menu-item danger" onClick={() => void remove()}>
              <Trash2 size={13} strokeWidth={1.75} style={{ marginRight: 8 }} aria-hidden="true" />Mitarbeiter löschen
            </button>
          </RowMenu>
        ) : undefined}
      />
      {confirmDialog}
    </>
  )
}

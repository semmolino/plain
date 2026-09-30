import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Modal } from '@/components/ui/Modal'
import { Message } from '@/components/ui/Message'
import { HelpHint } from '@/components/ui/HelpHint'
import {
  fetchProjectStatuses, fetchProjectManagers, fetchProjectTypes, fetchDepartments,
  fetchActiveEmployees, fetchProjectsShort, fetchBillingTypes,
} from '@/api/projekte'
import type { OfferStructureNode, ConvertOfferPayload } from '@/api/angebote'
import { useTenantDefaults } from '@/hooks/useTenantDefaults'
import { presetId, todayIso } from '@/utils/vorbelegung'
import { fmtEur, money } from '@/utils/money'
import { fmtHours } from '@/utils/zeit'
import { linesFee, linesHours, nodeLines, type EffortLineEdit } from './struktur/offerStrukturCalc'
import { GesamtprojektWahl } from '@/pages/projekte/gesamtprojekt/GesamtprojektWahl'
import {
  gruppenPayload, KEINE_GRUPPE, useDerivedAbbr, type GruppenWahl,
} from '@/pages/projekte/gesamtprojekt/gesamtprojektUi'

interface Props {
  open:        boolean
  offerName:   string
  structNodes: OfferStructureNode[]
  /** Zustaendige Person des Angebots — Vorschlag fuer die Projektleitung */
  presetManagerId?: number | null
  onConvert:   (body: ConvertOfferPayload) => void
  onMarkOrdered: (body: { order_date: string; project_id?: number | null }) => void
  onClose:     () => void
  isPending:   boolean
  error:       string | null
}

type Mode = 'create' | 'mark'

/** Eine Rolle mit Satz aus den Aufwandszeilen — je Gruppe waehlt man, wer bucht. */
type RoleGroup = { key: string; line: EffortLineEdit; elements: string[] }

function flatten(nodes: OfferStructureNode[]) {
  const kids = new Map<number | null, OfferStructureNode[]>()
  for (const n of nodes) {
    const f = n.FATHER_ID ?? null
    kids.set(f, [...(kids.get(f) ?? []), n])
  }
  const out: { node: OfferStructureNode; depth: number; leaf: boolean }[] = []
  const walk = (f: number | null, depth: number) => {
    for (const n of [...(kids.get(f) ?? [])].sort((a, b) => (a.SORT_ORDER - b.SORT_ORDER) || (a.ID - b.ID))) {
      out.push({ node: n, depth, leaf: !kids.has(n.ID) })
      walk(n.ID, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/**
 * „Beauftragt …" (UI-Pilot Runde 5): statt eines Formulars mit einer
 * Tabelle am Ende zeigt der Dialog zuerst, was ins Projekt uebergeht —
 * je Element, mit dem Plan fuer die Elemente nach Aufwand. Die Mitarbeiter
 * werden je Rolle aus den Aufwandszeilen zugeordnet (vorher je Element, mit
 * nur einer Rolle je Element). Projektstatus und Projektleitung sind
 * vorbelegt (Vorbelegung bzw. Zustaendige des Angebots).
 */
export function BeauftragtModal({ open, offerName, structNodes, presetManagerId, onConvert, onMarkOrdered, onClose, isPending, error }: Props) {
  const defaults = useTenantDefaults()

  const [mode,             setMode]             = useState<Mode>('create')
  const [orderDate,        setOrderDate]        = useState(todayIso())
  const [projectStatusId,  setProjectStatusId]  = useState<string | null>(null)
  const [projectManagerId, setProjectManagerId] = useState<string | null>(null)
  const [projectTypeId,    setProjectTypeId]    = useState('')
  const [departmentId,     setDepartmentId]     = useState('')
  const [linkedProjectId,  setLinkedProjectId]  = useState('')
  const [transferPlan,     setTransferPlan]     = useState(true)
  const [employeeMap, setEmployeeMap] = useState<Record<string, string>>({})
  const [gruppe,           setGruppe]           = useState<GruppenWahl>(KEINE_GRUPPE)
  const derivedAbbr = useDerivedAbbr(gruppe.groupId)

  const { data: statusData  } = useQuery({ queryKey: ['project-statuses'],  queryFn: fetchProjectStatuses  })
  const { data: mgrData     } = useQuery({ queryKey: ['project-managers'],  queryFn: fetchProjectManagers  })
  const { data: typeData    } = useQuery({ queryKey: ['project-types'],     queryFn: fetchProjectTypes     })
  const { data: deptData    } = useQuery({ queryKey: ['departments'],       queryFn: fetchDepartments      })
  const { data: empData     } = useQuery({ queryKey: ['active-employees'],  queryFn: fetchActiveEmployees  })
  const { data: projData    } = useQuery({ queryKey: ['projects-short'],    queryFn: fetchProjectsShort    })
  const { data: btData      } = useQuery({ queryKey: ['billing-types'],     queryFn: fetchBillingTypes     })

  const statuses  = statusData?.data ?? []
  const managers  = mgrData?.data    ?? []
  const types     = typeData?.data   ?? []
  const depts     = deptData?.data   ?? []
  const employees = empData?.data    ?? []
  const projects  = projData?.data   ?? []
  const btypes    = btData?.data     ?? []

  // Vorbelegt, bis jemand waehlt (null = noch nicht angefasst)
  const statusVal  = projectStatusId  ?? presetId(statuses, defaults.default_project_status_id)
  const managerVal = projectManagerId ?? presetId(managers, presetManagerId != null ? String(presetManagerId) : '')

  const flat = useMemo(() => flatten(structNodes), [structNodes])
  const hourlyLeaves = flat.filter(f => f.leaf && Number(f.node.BILLING_TYPE_ID) === 2)

  const planRows = hourlyLeaves.map(f => ({ id: f.node.ID, lines: nodeLines(f.node) })).filter(r => linesFee(r.lines) > 0 || linesHours(r.lines) > 0)
  const planHours   = planRows.reduce((s, r) => s + linesHours(r.lines), 0)
  const planRevenue = planRows.reduce((s, r) => s + linesFee(r.lines), 0)

  // Je Rolle und Satz eine Zeile — dieselbe Rolle in BL1 und BL2 waehlt man einmal.
  const groupMap = new Map<string, RoleGroup>()
  for (const f of hourlyLeaves) {
    for (const l of nodeLines(f.node)) {
      const key = `${l.roleId || l.roleAbbr || '-'}|${Number(l.rate) || 0}`
      const g = groupMap.get(key) ?? { key, line: l, elements: [] }
      if (!g.elements.includes(f.node.ABBR ?? '')) g.elements.push(f.node.ABBR ?? '')
      groupMap.set(key, g)
    }
  }
  const groups = [...groupMap.values()]

  function transferLabel(n: OfferStructureNode, leaf: boolean): { text: string; muted?: boolean } {
    if (!leaf) return { text: 'Summe der Unterelemente', muted: true }
    if (Number(n.BILLING_TYPE_ID) !== 2) return { text: `Honorar ${fmtEur(Number(n.REVENUE_BASIS ?? n.REVENUE ?? 0))}` }
    const ls = nodeLines(n)
    if (!transferPlan || (linesFee(ls) === 0 && linesHours(ls) === 0)) return { text: 'startet bei 0, nach Aufwand', muted: true }
    return { text: `Plan ${fmtHours(linesHours(ls))} h · ${fmtEur(linesFee(ls))}` }
  }

  function handleCreateSubmit() {
    if (!orderDate || !statusVal || !managerVal) return
    const e2p: ConvertOfferPayload['employee2project'] = []
    for (const g of groups) {
      const empId = employeeMap[g.key]
      if (!empId) continue
      e2p.push({
        employee_id: Number(empId),
        role_id:     g.line.roleId ? Number(g.line.roleId) : null,
        role_abbr:   g.line.roleAbbr,
        role_name:   g.line.roleName,
        hourly_rate: Number(g.line.rate) || null,
      })
    }
    onConvert({
      order_date:         orderDate,
      project_status_id:  Number(statusVal),
      project_manager_id: Number(managerVal),
      project_type_id:    projectTypeId ? Number(projectTypeId) : null,
      department_id:      departmentId  ? Number(departmentId)  : null,
      transfer_plan:      transferPlan,
      employee2project:   e2p,
      ...gruppenPayload(gruppe, derivedAbbr),
    })
  }

  function handleMarkSubmit() {
    if (!orderDate) return
    onMarkOrdered({ order_date: orderDate, project_id: linkedProjectId ? Number(linkedProjectId) : null })
  }

  return (
    <Modal open={open} onClose={onClose} title={`Beauftragt – ${offerName}`} className="modal-wide">
      <div className="seg-toggle bw-mode" role="group" aria-label="Wie wird beauftragt?">
        <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Projekt anlegen</button>
        <button type="button" aria-pressed={mode === 'mark'} onClick={() => setMode('mark')}>Nur als beauftragt markieren</button>
      </div>

      <div className="qb-form">
        <div className="qb-times">
          <div className="form-group">
            <label htmlFor="bw-date">Auftragsdatum*</label>
            <input id="bw-date" type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
          </div>
          {mode === 'create' && (
            <div className="form-group">
              <label htmlFor="bw-status">Projektstatus*</label>
              <select id="bw-status" value={statusVal} onChange={e => setProjectStatusId(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {statuses.map(s => <option key={s.ID} value={s.ID}>{s.ABBR}</option>)}
              </select>
            </div>
          )}
        </div>

        {mode === 'create' && (
          <>
            <div className="qb-times">
              <div className="form-group">
                <label htmlFor="bw-pm">Projektleitung*</label>
                <select id="bw-pm" value={managerVal} onChange={e => setProjectManagerId(e.target.value)}>
                  <option value="">Bitte wählen …</option>
                  {managers.map(m => <option key={m.ID} value={m.ID}>{m.ABBR}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="bw-type">Projekttyp</label>
                <select id="bw-type" value={projectTypeId} onChange={e => setProjectTypeId(e.target.value)}>
                  <option value="">—</option>
                  {types.map(t => <option key={t.ID} value={t.ID}>{t.ABBR}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="bw-dept">Abteilung</label>
              <select id="bw-dept" value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
                <option value="">—</option>
                {depts.map(d => <option key={d.ID} value={d.ID}>{d.ABBR}</option>)}
              </select>
            </div>
            {/* Nächste Stufe eines Stufenvertrags: gleich ins Gesamtprojekt der ersten */}
            <GesamtprojektWahl value={gruppe} onChange={setGruppe} idPrefix="bw" />

            <section className="bw-section" aria-labelledby="bw-preview-title">
              <h3 className="bw-title" id="bw-preview-title">
                Was ins Projekt übergeht <HelpHint id="offers.convert.preview" size={13} />
              </h3>
              {flat.length === 0 ? (
                <p className="guard-text">Das Angebot hat keine Struktur — das Projekt startet ohne Elemente.</p>
              ) : (
                <div className="bw-preview">
                  <table className="bw-table">
                    <thead>
                      <tr><th scope="col">Element</th><th scope="col" className="bw-hide-narrow">Abrechnung</th><th scope="col" className="num">Im Projekt</th></tr>
                    </thead>
                    <tbody>
                      {flat.map(({ node, depth, leaf }) => {
                        const t = transferLabel(node, leaf)
                        return (
                          <tr key={node.ID}>
                            <td style={{ paddingLeft: `calc(${depth} * var(--space-4) + var(--space-2))` }}>
                              <strong>{node.ABBR}</strong> {node.NAME}
                            </td>
                            <td className="bw-hide-narrow">{btypes.find(b => b.ID === Number(node.BILLING_TYPE_ID))?.ABBR ?? '—'}</td>
                            <td className={`num${t.muted ? ' sx-muted' : ''}`}>{t.text}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {planRows.length > 0 && (
                <label className="bw-check">
                  <input type="checkbox" checked={transferPlan} onChange={e => setTransferPlan(e.target.checked)} />
                  <span>
                    Schätzung als Plan übernehmen: {planRows.length} {planRows.length === 1 ? 'Element' : 'Elemente'} nach Aufwand,{' '}
                    {fmtHours(planHours)} h · {money(planRevenue)}
                    <span className="form-field-hint">Die Budgetwarnung vergleicht das Gebuchte damit.</span>
                  </span>
                </label>
              )}
            </section>

            {groups.length > 0 && (
              <section className="bw-section" aria-labelledby="bw-staff-title">
                <h3 className="bw-title" id="bw-staff-title">Wer bucht mit welcher Rolle?</h3>
                <ul className="bw-roles">
                  {groups.map(g => (
                    <li key={g.key} className="bw-role">
                      <span className="bw-role-name">
                        <strong>{g.line.roleAbbr || 'ohne Rolle'}</strong>{g.line.roleName ? ` – ${g.line.roleName}` : ''}
                        <span className="bw-role-meta">{fmtEur(Number(g.line.rate) || 0)}/h · in {g.elements.join(', ')}</span>
                      </span>
                      <select aria-label={`Mitarbeiter für ${g.line.roleAbbr || 'ohne Rolle'}`} value={employeeMap[g.key] ?? ''}
                        onChange={e => setEmployeeMap(m => ({ ...m, [g.key]: e.target.value }))}>
                        <option value="">— später —</option>
                        {employees.map(emp => (
                          <option key={emp.ID} value={emp.ID}>{emp.ABBR || `${emp.FIRST_NAME ?? ''} ${emp.LAST_NAME ?? ''}`.trim()}</option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {mode === 'mark' && (
          <>
            <div className="form-group">
              <label htmlFor="bw-project">Bestehendes Projekt verknüpfen (optional)</label>
              <select id="bw-project" value={linkedProjectId} onChange={e => setLinkedProjectId(e.target.value)}>
                <option value="">— Kein Projekt verknüpfen —</option>
                {projects.map(p => <option key={p.ID} value={p.ID}>{p.ABBR}{p.NAME ? ` – ${p.NAME}` : ''}</option>)}
              </select>
            </div>
            <p className="guard-text">
              Das Angebot wird als beauftragt markiert. Es wird <strong>kein neues Projekt angelegt</strong>;
              optional lässt sich ein bestehendes verknüpfen.
            </p>
          </>
        )}
      </div>

      <Message type="error" text={error} />

      <DialogFooter>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={isPending}>Abbrechen</button>
        {mode === 'create' ? (
          <button type="button" className="btn-primary" onClick={handleCreateSubmit}
            disabled={isPending || !orderDate || !statusVal || !managerVal}>
            {isPending ? 'Legt an …' : 'Projekt anlegen'}
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={handleMarkSubmit} disabled={isPending || !orderDate}>
            {isPending ? 'Speichert …' : 'Als beauftragt markieren'}
          </button>
        )}
      </DialogFooter>
    </Modal>
  )
}

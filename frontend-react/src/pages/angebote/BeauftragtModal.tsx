import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Message } from '@/components/ui/Message'
import { fetchProjectStatuses, fetchProjectManagers, fetchProjectTypes, fetchDepartments, fetchActiveEmployees, fetchProjectsShort } from '@/api/projekte'
import type { OfferStructureNode } from '@/api/angebote'
import type { ConvertOfferPayload } from '@/api/angebote'

interface Props {
  open:        boolean
  offerName:   string
  structNodes: OfferStructureNode[]
  onConvert:   (body: ConvertOfferPayload) => void
  onMarkOrdered: (body: { order_date: string; project_id?: number | null }) => void
  onClose:     () => void
  isPending:   boolean
  error:       string | null
}

type Mode = 'create' | 'mark'

export function BeauftragtModal({ open, offerName, structNodes, onConvert, onMarkOrdered, onClose, isPending, error }: Props) {
  const today = new Date().toISOString().slice(0, 10)

  const [mode,             setMode]             = useState<Mode>('create')
  const [orderDate,        setOrderDate]        = useState(today)
  const [projectStatusId,  setProjectStatusId]  = useState('')
  const [projectManagerId, setProjectManagerId] = useState('')
  const [projectTypeId,    setProjectTypeId]    = useState('')
  const [departmentId,     setDepartmentId]     = useState('')
  const [linkedProjectId,  setLinkedProjectId]  = useState('')
  const [employeeMap, setEmployeeMap] = useState<Record<number, string>>({})

  const { data: statusData  } = useQuery({ queryKey: ['project-statuses'],  queryFn: fetchProjectStatuses  })
  const { data: mgrData     } = useQuery({ queryKey: ['project-managers'],  queryFn: fetchProjectManagers  })
  const { data: typeData    } = useQuery({ queryKey: ['project-types'],     queryFn: fetchProjectTypes     })
  const { data: deptData    } = useQuery({ queryKey: ['departments'],       queryFn: fetchDepartments      })
  const { data: empData     } = useQuery({ queryKey: ['active-employees'],  queryFn: fetchActiveEmployees  })
  const { data: projData    } = useQuery({ queryKey: ['projects-short'],    queryFn: fetchProjectsShort    })

  const statuses  = statusData?.data ?? []
  const managers  = mgrData?.data    ?? []
  const types     = typeData?.data   ?? []
  const depts     = deptData?.data   ?? []
  const employees = empData?.data    ?? []
  const projects  = projData?.data   ?? []

  const bt2Nodes = structNodes.filter(n => n.BILLING_TYPE_ID === 2)

  function handleCreateSubmit() {
    if (!orderDate || !projectStatusId || !projectManagerId) return
    const e2p: ConvertOfferPayload['employee2project'] = []
    for (const node of bt2Nodes) {
      const empId = employeeMap[node.ID]
      if (!empId) continue
      e2p.push({
        employee_id:    Number(empId),
        role_id:        node.ROLE_ID ?? null,
        role_name_short: node.ROLE_NAME_SHORT ?? '',
        role_name_long:  node.ROLE_NAME_LONG  ?? '',
        sp_rate:        node.SP_RATE ?? null,
      })
    }
    onConvert({
      order_date:         orderDate,
      project_status_id:  Number(projectStatusId),
      project_manager_id: Number(projectManagerId),
      project_type_id:    projectTypeId  ? Number(projectTypeId)  : null,
      department_id:      departmentId   ? Number(departmentId)   : null,
      employee2project:   e2p,
    })
  }

  function handleMarkSubmit() {
    if (!orderDate) return
    onMarkOrdered({
      order_date: orderDate,
      project_id: linkedProjectId ? Number(linkedProjectId) : null,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={`Beauftragt – ${offerName}`}>
      <div style={{ minWidth: 560, maxWidth: 640 }}>

        {/* Mode selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, padding: 4, background: 'rgba(17,24,39,0.04)', borderRadius: 6 }}>
          <button
            type="button"
            onClick={() => setMode('create')}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: mode === 'create' ? '#fff' : 'transparent',
              fontWeight: mode === 'create' ? 600 : 400,
              boxShadow: mode === 'create' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              fontSize: 13,
            }}>
            Projekt anlegen
          </button>
          <button
            type="button"
            onClick={() => setMode('mark')}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: mode === 'mark' ? '#fff' : 'transparent',
              fontWeight: mode === 'mark' ? 600 : 400,
              boxShadow: mode === 'mark' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              fontSize: 13,
            }}>
            Nur als beauftragt markieren
          </button>
        </div>

        <div className="form-group">
          <label>Auftragsdatum*</label>
          <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
        </div>

        {mode === 'create' && (
          <>
            <div className="form-group">
              <label>Projektstatus*</label>
              <select value={projectStatusId} onChange={e => setProjectStatusId(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {statuses.map(s => <option key={s.ID} value={s.ID}>{s.NAME_SHORT}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Projektleiter*</label>
              <select value={projectManagerId} onChange={e => setProjectManagerId(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {managers.map(m => <option key={m.ID} value={m.ID}>{m.SHORT_NAME}</option>)}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Projekttyp</label>
                <select value={projectTypeId} onChange={e => setProjectTypeId(e.target.value)}>
                  <option value="">—</option>
                  {types.map(t => <option key={t.ID} value={t.ID}>{t.NAME_SHORT}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Abteilung</label>
                <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
                  <option value="">—</option>
                  {depts.map(d => <option key={d.ID} value={d.ID}>{d.NAME_SHORT}</option>)}
                </select>
              </div>
            </div>

            {bt2Nodes.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h4 style={{ fontWeight: 600, marginBottom: 8 }}>Mitarbeiterzuweisung</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #e5e7eb' }}>Position</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #e5e7eb' }}>Rolle</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #e5e7eb' }}>Mitarbeiter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bt2Nodes.map(n => (
                      <tr key={n.ID}>
                        <td style={{ padding: '4px 8px' }}>{n.NAME_SHORT || '—'}</td>
                        <td style={{ padding: '4px 8px', color: '#6b7280' }}>{n.ROLE_NAME_SHORT || '—'}</td>
                        <td style={{ padding: '4px 8px' }}>
                          <select
                            value={employeeMap[n.ID] ?? ''}
                            onChange={e => setEmployeeMap(m => ({ ...m, [n.ID]: e.target.value }))}
                            style={{ width: '100%' }}>
                            <option value="">—</option>
                            {employees.map(emp => (
                              <option key={emp.ID} value={emp.ID}>
                                {emp.SHORT_NAME || `${emp.FIRST_NAME ?? ''} ${emp.LAST_NAME ?? ''}`.trim()}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {mode === 'mark' && (
          <>
            <div className="form-group">
              <label>Bestehendes Projekt verknüpfen (optional)</label>
              <select value={linkedProjectId} onChange={e => setLinkedProjectId(e.target.value)}>
                <option value="">— Kein Projekt verknüpfen —</option>
                {projects.map(p => (
                  <option key={p.ID} value={p.ID}>
                    {p.NAME_SHORT}{p.NAME_LONG ? ` – ${p.NAME_LONG}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Das Angebot wird als beauftragt markiert. Es wird <strong>kein neues Projekt angelegt</strong>.
              Optional kann ein bereits existierendes Projekt verknüpft werden.
            </p>
          </>
        )}

        {error && (
          <div style={{ marginTop: 12 }}>
            <Message type="error" text={error} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} disabled={isPending}>Abbrechen</button>
          {mode === 'create' ? (
            <button
              className="btn btn-primary"
              disabled={isPending || !orderDate || !projectStatusId || !projectManagerId}
              onClick={handleCreateSubmit}>
              {isPending ? 'Erstellt …' : 'Projekt anlegen'}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={isPending || !orderDate}
              onClick={handleMarkSubmit}>
              {isPending ? 'Speichert …' : 'Als beauftragt markieren'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

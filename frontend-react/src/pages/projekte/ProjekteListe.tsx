import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal }     from '@/components/ui/Modal'
import { Message }   from '@/components/ui/Message'
import {
  fetchProjectListFull, updateProject,
  fetchProjectStatuses, fetchProjectTypes, fetchProjectManagers,
  type Project,
} from '@/api/projekte'

const PAGE_SIZE = 25
type SortKey = 'NAME_SHORT' | 'NAME_LONG' | 'STATUS_NAME' | 'MANAGER_NAME'

function SortTh({ label, k, sortKey, dir, onClick }: {
  label: string; k: SortKey; sortKey: SortKey; dir: 'asc'|'desc'; onClick: (k: SortKey) => void
}) {
  return (
    <th className="sortable-th" onClick={() => onClick(k)}>
      {label} {sortKey === k ? (dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )
}

export function ProjekteListe({ onSelectProject }: { onSelectProject?: (id: number) => void }) {
  const qc = useQueryClient()
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('NAME_SHORT')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc')
  const [page,    setPage]    = useState(1)
  const [editRow, setEditRow] = useState<Project | null>(null)
  const [editForm, setEditForm] = useState({ name_short: '', name_long: '', project_status_id: '', project_type_id: '', project_manager_id: '' })
  const [editMsg, setEditMsg]   = useState<{ text: string; type: 'success'|'error' } | null>(null)

  const { data: listData, isLoading } = useQuery({ queryKey: ['projects-full'], queryFn: fetchProjectListFull })
  const { data: statusData }          = useQuery({ queryKey: ['project-statuses'], queryFn: fetchProjectStatuses })
  const { data: typeData }            = useQuery({ queryKey: ['project-types'], queryFn: fetchProjectTypes })
  const { data: mgrData }             = useQuery({ queryKey: ['project-managers'], queryFn: fetchProjectManagers })

  const projects = listData?.data ?? []
  const statuses = statusData?.data ?? []
  const types    = typeData?.data   ?? []
  const managers = mgrData?.data    ?? []

  const processed = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q
      ? projects.filter(p => `${p.NAME_SHORT} ${p.NAME_LONG} ${p.STATUS_NAME} ${p.MANAGER_NAME}`.toLowerCase().includes(q))
      : projects
    rows = [...rows].sort((a, b) => {
      const av = String(a[sortKey] ?? '')
      const bv = String(b[sortKey] ?? '')
      return sortDir === 'asc'
        ? av.localeCompare(bv, 'de', { sensitivity: 'base', numeric: true })
        : bv.localeCompare(av, 'de', { sensitivity: 'base', numeric: true })
    })
    return rows
  }, [projects, search, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = processed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
    setPage(1)
  }

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof updateProject>[1] }) => updateProject(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects-full'] })
      setEditMsg({ text: 'Gespeichert ✅', type: 'success' })
      setTimeout(() => setEditRow(null), 800)
    },
    onError: (e: Error) => setEditMsg({ text: e.message, type: 'error' }),
  })

  function openEdit(p: Project) {
    setEditForm({
      name_short:         p.NAME_SHORT ?? '',
      name_long:          p.NAME_LONG  ?? '',
      project_status_id:  String(p.PROJECT_STATUS_ID  ?? ''),
      project_type_id:    String(p.PROJECT_TYPE_ID    ?? ''),
      project_manager_id: String(p.PROJECT_MANAGER_ID ?? ''),
    })
    setEditMsg(null)
    setEditRow(p)
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editRow) return
    updateMut.mutate({
      id: editRow.ID,
      body: {
        name_short:         editForm.name_short,
        name_long:          editForm.name_long,
        project_status_id:  editForm.project_status_id  ? Number(editForm.project_status_id)  : undefined,
        project_type_id:    editForm.project_type_id    ? Number(editForm.project_type_id)    : undefined,
        project_manager_id: editForm.project_manager_id ? Number(editForm.project_manager_id) : undefined,
      },
    })
  }

  const setE = (k: keyof typeof editForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditForm(f => ({ ...f, [k]: e.target.value }))

  const sortProps = { sortKey, dir: sortDir, onClick: toggleSort }

  return (
    <>
      <div className="list-toolbar">
        <input
          className="list-search"
          placeholder="Suchen …"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <span className="list-info">{processed.length} Projekte · Seite {safePage}/{totalPages}</span>
      </div>

      {isLoading && <p className="empty-note">Laden …</p>}
      {!isLoading && (
        <>
          <div className="list-section">
            <table className="master-table">
              <thead>
                <tr>
                  <SortTh label="Kürzel"   k="NAME_SHORT"   {...sortProps} />
                  <SortTh label="Name"     k="NAME_LONG"    {...sortProps} />
                  <SortTh label="Status"   k="STATUS_NAME"  {...sortProps} />
                  <SortTh label="Leitung"  k="MANAGER_NAME" {...sortProps} />
                  <th></th>
                  {onSelectProject && <th></th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(p => (
                  <tr key={p.ID}>
                    <td>{p.NAME_SHORT}</td>
                    <td>{p.NAME_LONG}</td>
                    <td>{p.STATUS_NAME}</td>
                    <td>{p.MANAGER_NAME}</td>
                    <td><button className="btn-small" onClick={() => openEdit(p)}>Bearbeiten</button></td>
                    {onSelectProject && (
                      <td><button className="btn-small btn-save" onClick={() => onSelectProject(p.ID)}>Öffnen</button></td>
                    )}
                  </tr>
                ))}
                {!pageRows.length && <tr><td colSpan={6} className="empty-note">Keine Einträge</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>← Zurück</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>Weiter →</button>
          </div>
        </>
      )}

      <Modal open={editRow !== null} onClose={() => setEditRow(null)} title="Projekt bearbeiten">
        <form onSubmit={submitEdit} className="master-form">
          <div className="form-group">
            <label>Kürzel</label>
            <input value={editForm.name_short} onChange={setE('name_short')} />
          </div>
          <div className="form-group">
            <label>Name</label>
            <input value={editForm.name_long} onChange={setE('name_long')} />
          </div>
          <div className="form-group">
            <label>Status</label>
            <select value={editForm.project_status_id} onChange={setE('project_status_id')}>
              <option value="">—</option>
              {statuses.map(s => <option key={s.ID} value={s.ID}>{s.NAME_SHORT}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Typ</label>
            <select value={editForm.project_type_id} onChange={setE('project_type_id')}>
              <option value="">—</option>
              {types.map(t => <option key={t.ID} value={t.ID}>{t.NAME_SHORT}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Projektleitung</label>
            <select value={editForm.project_manager_id} onChange={setE('project_manager_id')}>
              <option value="">—</option>
              {managers.map(m => <option key={m.ID} value={m.ID}>{m.SHORT_NAME}</option>)}
            </select>
          </div>
          <Message text={editMsg?.text ?? null} type={editMsg?.type} />
          <div className="modal-actions">
            <button className="btn-primary" type="submit" disabled={updateMut.isPending}>
              {updateMut.isPending ? 'Speichert …' : 'Speichern'}
            </button>
            <button type="button" onClick={() => setEditRow(null)}>Abbrechen</button>
          </div>
        </form>
      </Modal>
    </>
  )
}

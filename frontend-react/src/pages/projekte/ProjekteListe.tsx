import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal }         from '@/components/ui/Modal'
import { Message }       from '@/components/ui/Message'
import { Autocomplete }  from '@/components/ui/Autocomplete'
import { useCtrlS }      from '@/hooks/useCtrlS'
import {
  fetchProjectListFull, updateProject, fetchContractByProject, patchContract,
  fetchProjectStatuses, fetchProjectTypes, fetchProjectManagers, fetchDepartments,
  type Project,
} from '@/api/projekte'
import { searchAddressesApi, fetchContactsByAddress } from '@/api/stammdaten'

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

type ContactOption = { ID: number; FIRST_NAME: string; LAST_NAME: string }
type ContractConfirm = { contractId: number; addressId: number | null; contactId: number | null }

export function ProjekteListe({ onSelectProject }: { onSelectProject?: (id: number) => void }) {
  const qc = useQueryClient()

  // list state
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('NAME_SHORT')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc')
  const [page,    setPage]    = useState(1)

  // edit modal state
  const [editRow, setEditRow] = useState<Project | null>(null)
  const [editForm, setEditForm] = useState({
    name_short: '', name_long: '',
    project_status_id: '', project_type_id: '', project_manager_id: '',
    department_id: '',
    address_id: '', address_text: '',
    contact_id: '',
  })
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [contractConfirm, setContractConfirm] = useState<ContractConfirm | null>(null)
  const [editMsg, setEditMsg] = useState<{ text: string; type: 'success'|'error' } | null>(null)

  const editFormRef = useRef<HTMLFormElement>(null)

  const { data: listData, isLoading } = useQuery({ queryKey: ['projects-full'], queryFn: fetchProjectListFull })
  const { data: statusData }          = useQuery({ queryKey: ['project-statuses'], queryFn: fetchProjectStatuses })
  const { data: typeData }            = useQuery({ queryKey: ['project-types'], queryFn: fetchProjectTypes })
  const { data: mgrData }             = useQuery({ queryKey: ['project-managers'], queryFn: fetchProjectManagers })
  const { data: deptData }            = useQuery({ queryKey: ['project-departments'], queryFn: fetchDepartments })

  const projects    = listData?.data ?? []
  const statuses    = statusData?.data ?? []
  const types       = typeData?.data   ?? []
  const managers    = mgrData?.data    ?? []
  const departments = deptData?.data   ?? []

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
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof updateProject>[1] }) =>
      updateProject(id, body),
    onSuccess: async (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['projects-full'] })

      const origAddressId = editRow?.ADDRESS_ID ? String(editRow.ADDRESS_ID) : ''
      const origContactId = editRow?.CONTACT_ID ? String(editRow.CONTACT_ID) : ''
      const addrChanged   = editForm.address_id !== origAddressId
      const ctctChanged   = editForm.contact_id !== origContactId

      if (addrChanged || ctctChanged) {
        try {
          const res = await fetchContractByProject(variables.id)
          const contract = res.data
          if (contract?.ID) {
            setEditMsg({ text: 'Projekt gespeichert ✅', type: 'success' })
            setContractConfirm({
              contractId: contract.ID,
              addressId:  editForm.address_id ? Number(editForm.address_id) : null,
              contactId:  editForm.contact_id ? Number(editForm.contact_id) : null,
            })
            return
          }
        } catch {
          // contract not found — just close
        }
      }

      setEditMsg({ text: 'Gespeichert ✅', type: 'success' })
      setTimeout(() => closeEdit(), 800)
    },
    onError: (e: Error) => setEditMsg({ text: e.message, type: 'error' }),
  })

  async function applyToContract(confirm: ContractConfirm) {
    try {
      await patchContract(confirm.contractId, {
        INVOICE_ADDRESS_ID: confirm.addressId,
        INVOICE_CONTACT_ID: confirm.contactId,
      })
    } catch (e: unknown) {
      setEditMsg({ text: `Vertrag konnte nicht aktualisiert werden: ${e instanceof Error ? e.message : String(e)}`, type: 'error' })
    } finally {
      setContractConfirm(null)
      closeEdit()
    }
  }

  function closeEdit() {
    setEditRow(null)
    setContractConfirm(null)
    setContacts([])
    setEditMsg(null)
  }

  async function openEdit(p: Project) {
    setEditForm({
      name_short:         p.NAME_SHORT ?? '',
      name_long:          p.NAME_LONG  ?? '',
      project_status_id:  String(p.PROJECT_STATUS_ID  ?? ''),
      project_type_id:    String(p.PROJECT_TYPE_ID    ?? ''),
      project_manager_id: String(p.PROJECT_MANAGER_ID ?? ''),
      department_id:      String(p.DEPARTMENT_ID      ?? ''),
      address_id:         String(p.ADDRESS_ID         ?? ''),
      address_text:       p.ADDRESS_NAME              ?? '',
      contact_id:         String(p.CONTACT_ID         ?? ''),
    })
    setContacts([])
    setContractConfirm(null)
    setEditMsg(null)
    setEditRow(p)
    if (p.ADDRESS_ID) {
      try {
        const r = await fetchContactsByAddress(p.ADDRESS_ID)
        setContacts(r.data ?? [])
      } catch { /* ignore */ }
    }
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
        project_type_id:    editForm.project_type_id    ? Number(editForm.project_type_id)    : null,
        project_manager_id: editForm.project_manager_id ? Number(editForm.project_manager_id) : undefined,
        department_id:      editForm.department_id      ? Number(editForm.department_id)      : null,
        address_id:         editForm.address_id         ? Number(editForm.address_id)         : null,
        contact_id:         editForm.contact_id         ? Number(editForm.contact_id)         : null,
      },
    })
  }

  useCtrlS(() => editFormRef.current?.requestSubmit(), editRow !== null && contractConfirm === null)

  const setE = (k: keyof typeof editForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setEditForm(f => ({ ...f, [k]: e.target.value }))

  const searchAddresses = useCallback(async (q: string) => {
    const r = await searchAddressesApi(q)
    return (r.data ?? []).map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  async function handleAddressSelect(id: string | number, label: string) {
    setEditForm(f => ({ ...f, address_id: String(id), address_text: label, contact_id: '' }))
    setContacts([])
    try {
      const r = await fetchContactsByAddress(Number(id))
      setContacts(r.data ?? [])
    } catch { /* ignore */ }
  }

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
              <tfoot>
                <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                  <td colSpan={6} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                    {processed.length !== projects.length ? `${processed.length} / ${projects.length} Einträge` : `${projects.length} Einträge`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="pagination">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>← Zurück</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>Weiter →</button>
          </div>
        </>
      )}

      <Modal open={editRow !== null} onClose={closeEdit} title="Projekt bearbeiten">
        {contractConfirm ? (
          <div className="master-form">
            <p style={{ marginBottom: 16 }}>
              Soll die Adresse / der Kontakt auch im Vertrag übernommen werden?
            </p>
            <Message text={editMsg?.text ?? null} type={editMsg?.type} />
            <div className="modal-actions">
              <button className="btn-primary" onClick={() => applyToContract(contractConfirm)}>
                Ja, übernehmen
              </button>
              <button type="button" onClick={closeEdit}>Nein</button>
            </div>
          </div>
        ) : (
          <form ref={editFormRef} onSubmit={submitEdit} className="master-form">
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
            <div className="form-group">
              <label>Abteilung</label>
              <select value={editForm.department_id} onChange={setE('department_id')}>
                <option value="">—</option>
                {departments.map(d => <option key={d.ID} value={d.ID}>{d.NAME_SHORT}</option>)}
              </select>
            </div>
            <Autocomplete
              label="Adresse"
              htmlId="edit-proj-address"
              value={editForm.address_text}
              onChange={text => setEditForm(f => ({ ...f, address_text: text, address_id: '', contact_id: '' }))}
              onSelect={handleAddressSelect}
              search={searchAddresses}
              placeholder="Name eingeben …"
            />
            <div className="form-group">
              <label>Kontakt</label>
              <select
                value={editForm.contact_id}
                onChange={setE('contact_id')}
                disabled={!editForm.address_id}
              >
                <option value="">—</option>
                {contacts.map(c => (
                  <option key={c.ID} value={c.ID}>
                    {`${c.FIRST_NAME} ${c.LAST_NAME}`.trim()}
                  </option>
                ))}
              </select>
            </div>
            <Message text={editMsg?.text ?? null} type={editMsg?.type} />
            <div className="modal-actions">
              <button className="btn-primary" type="submit" disabled={updateMut.isPending}>
                {updateMut.isPending ? 'Speichert …' : 'Speichern'}
              </button>
              <button type="button" onClick={closeEdit}>Abbrechen</button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}

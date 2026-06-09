import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { Modal }        from '@/components/ui/Modal'
import { Message }      from '@/components/ui/Message'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { FormField }    from '@/components/ui/FormField'
import { useToast }     from '@/store/toastStore'
import {
  fetchRoles, fetchRole, fetchPermissionCatalog,
  createRole, patchRole, deleteRole,
  type UserRole, type Permission,
} from '@/api/rbac'

const MODULE_LABELS: Record<string, string> = {
  dashboard:  'Übersicht',
  addresses:  'Adressen',
  projects:   'Projekte',
  reports:    'Reporting',
  invoices:   'Rechnungen',
  dunning:    'Mahnungen',
  offers:     'Angebote',
  employees:  'Mitarbeiter',
  settings:   'Einstellungen',
  roles:      'Rollen & Berechtigungen',
}

const CATEGORY_COLOR: Record<string, string> = {
  reading:        '#16a34a',
  editing:        '#2563eb',
  destructive:    '#dc2626',
  administration: '#7c3aed',
}

export function RollenSection() {
  const qc = useQueryClient()
  const toast = useToast()

  const { data: rolesData, isLoading: rolesLoading } = useQuery({ queryKey: ['user-roles'], queryFn: fetchRoles })
  const { data: catData,    isLoading: catLoading } = useQuery({ queryKey: ['permission-catalog'], queryFn: fetchPermissionCatalog })

  const roles = rolesData?.data ?? []
  const permissions = catData?.data ?? []

  const [editId, setEditId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

  const delMut = useMutation({
    mutationFn: deleteRole,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-roles'] })
      toast.success('Rolle gelöscht')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div style={{ maxWidth: 920 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Rollen & Berechtigungen</h2>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0 0' }}>
            Lege Rollen an und steuere, welche Berechtigungen sie haben. Mitarbeiter werden den Rollen einzeln zugeordnet (Tab Mitarbeiter).
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreateOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} /> Neue Rolle
        </button>
      </div>

      {(rolesLoading || catLoading) && <p style={{ fontSize: 13, color: '#6b7280' }}>Laden …</p>}

      {!rolesLoading && roles.length === 0 && (
        <p style={{ fontSize: 13, color: '#6b7280' }}>
          Noch keine Rollen vorhanden. Wenn die Migration 0062 noch nicht eingespielt wurde, lege sie zuerst an.
        </p>
      )}

      {!rolesLoading && roles.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {roles.map(r => (
            <RoleRow
              key={r.ID}
              role={r}
              onEdit={() => setEditId(r.ID)}
              onDelete={() => setConfirmState({
                title: 'Rolle löschen',
                message: `Soll die Rolle „${r.NAME_SHORT}" wirklich gelöscht werden? Mitarbeiter, die nur diese Rolle haben, verlieren damit ihre Berechtigungen.`,
                onConfirm: () => delMut.mutate(r.ID),
              })}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <RoleEditModal
          permissions={permissions}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); void qc.invalidateQueries({ queryKey: ['user-roles'] }) }}
        />
      )}

      {editId !== null && (
        <RoleEditModal
          roleId={editId}
          permissions={permissions}
          onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); void qc.invalidateQueries({ queryKey: ['user-roles'] }); void qc.invalidateQueries({ queryKey: ['user-role', editId] }) }}
        />
      )}

      <ConfirmModal
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel="Löschen"
        onConfirm={() => { confirmState?.onConfirm(); setConfirmState(null) }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  )
}

// ── Rolle eine Zeile ────────────────────────────────────────────────────────

function RoleRow({ role, onEdit, onDelete }: { role: UserRole; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: role.COLOR || '#6b7280', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 14 }}>{role.NAME_SHORT}</strong>
          {role.IS_SYSTEM && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#374151', background: '#e5e7eb', padding: '1px 6px', borderRadius: 4, letterSpacing: 0.4 }}>
              SYSTEM
            </span>
          )}
          {role.IS_DEFAULT && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e', background: '#fef3c7', padding: '1px 6px', borderRadius: 4, letterSpacing: 0.4 }}>
              DEFAULT
            </span>
          )}
        </div>
        {role.NAME_LONG && (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{role.NAME_LONG}</div>
        )}
      </div>
      <span style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
        {role.EMPLOYEE_COUNT} {role.EMPLOYEE_COUNT === 1 ? 'Mitarbeiter' : 'Mitarbeiter'}
      </span>
      <button className="row-action-btn" onClick={onEdit} title="Bearbeiten">
        <Pencil size={14} strokeWidth={2} />
      </button>
      {!role.IS_SYSTEM && (
        <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }} onClick={onDelete} title="Löschen">
          <Trash2 size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

// ── Edit-Modal ──────────────────────────────────────────────────────────────

function RoleEditModal({ roleId, permissions, onClose, onSaved }: {
  roleId?: number
  permissions: Permission[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const isCreate = roleId == null

  const { data: roleData, isLoading } = useQuery({
    queryKey: ['user-role', roleId],
    queryFn:  () => fetchRole(roleId!),
    enabled:  !isCreate,
  })

  const [form, setForm] = useState<{ name_short: string; name_long: string; color: string; is_default: boolean }>({
    name_short: '', name_long: '', color: '#2563eb', is_default: false,
  })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)

  // Init form when role data loads (useEffect statt setState waehrend Render)
  useEffect(() => {
    if (isCreate || !roleData?.data) return
    const d = roleData.data
    setForm({
      name_short: d.NAME_SHORT,
      name_long:  d.NAME_LONG  || '',
      color:      d.COLOR      || '#2563eb',
      is_default: d.IS_DEFAULT,
    })
    setSelected(new Set(d.PERMISSION_IDS))
  }, [roleData?.data, isCreate])

  const isSystem = roleData?.data?.IS_SYSTEM === true

  // Gruppierung nach Modul
  const grouped = useMemo(() => {
    const m = new Map<string, Permission[]>()
    for (const p of permissions) {
      const arr = m.get(p.MODULE) ?? []
      arr.push(p)
      m.set(p.MODULE, arr)
    }
    return m
  }, [permissions])

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleModule(moduleKey: string, on: boolean) {
    const ids = (grouped.get(moduleKey) ?? []).map(p => p.ID)
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id); else next.delete(id)
      }
      return next
    })
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      if (isCreate) {
        return createRole({
          name_short:     form.name_short.trim(),
          name_long:      form.name_long.trim() || null,
          color:          form.color || null,
          permission_ids: Array.from(selected),
        })
      } else {
        return patchRole(roleId!, {
          name_short:     isSystem ? undefined : form.name_short.trim(),
          name_long:      form.name_long.trim() || null,
          color:          form.color || null,
          is_default:     isSystem ? undefined : form.is_default,
          permission_ids: Array.from(selected),
        })
      }
    },
    onSuccess: () => {
      toast.success(isCreate ? 'Rolle angelegt' : 'Rolle aktualisiert')
      onSaved()
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function handleSave() {
    if (!form.name_short.trim()) { setMsg({ text: 'Name erforderlich', type: 'error' }); return }
    setMsg(null); saveMut.mutate()
  }

  return (
    <Modal open onClose={onClose} title={isCreate ? 'Neue Rolle' : `Rolle bearbeiten — ${form.name_short || roleData?.data?.NAME_SHORT || ''}`} className="modal-xl">
      {!isCreate && isLoading && <p>Lade …</p>}
      {(isCreate || !isLoading) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 10 }}>
            <FormField label="Name *" id="role-name" value={form.name_short}
              onChange={e => setForm(f => ({ ...f, name_short: e.target.value }))}
              disabled={isSystem} />
            <FormField label="Beschreibung" id="role-long" value={form.name_long}
              onChange={e => setForm(f => ({ ...f, name_long: e.target.value }))} />
            <div className="form-group">
              <label>Farbe</label>
              <input type="color" value={form.color}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                style={{ width: '100%', height: 38, padding: 2, border: '1px solid var(--border)', borderRadius: 6 }} />
            </div>
          </div>

          {!isSystem && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_default}
                onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} />
              Default-Rolle für neue Mitarbeiter
            </label>
          )}

          <div style={{ marginTop: 6, padding: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>Berechtigungen</strong>
              <span style={{ fontSize: 12, color: '#6b7280' }}>{selected.size} von {permissions.length} aktiv</span>
            </div>

            <div style={{ maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
              {Array.from(grouped.entries()).map(([moduleKey, perms]) => {
                const moduleLabel = MODULE_LABELS[moduleKey] ?? moduleKey
                const onCount  = perms.filter(p => selected.has(p.ID)).length
                const allOn    = onCount === perms.length
                const anyOn    = onCount > 0

                return (
                  <div key={moduleKey} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <input type="checkbox" checked={allOn} ref={el => { if (el) el.indeterminate = anyOn && !allOn }}
                        onChange={e => toggleModule(moduleKey, e.target.checked)} />
                      <strong style={{ fontSize: 13 }}>{moduleLabel}</strong>
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>{onCount}/{perms.length}</span>
                    </div>
                    <div style={{ marginLeft: 22, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      {perms.map(p => (
                        <label key={p.ID} title={p.DESCRIPTION_DE || ''} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', padding: '2px 4px', borderRadius: 4 }}>
                          <input type="checkbox" checked={selected.has(p.ID)} onChange={() => toggle(p.ID)} />
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: CATEGORY_COLOR[p.CATEGORY ?? ''] || '#9ca3af', flexShrink: 0 }} />
                          {p.LABEL_DE}
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <Message text={msg?.text ?? null} type={msg?.type} />

          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
            <button className="btn-primary" onClick={handleSave} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Speichert …' : 'Speichern'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

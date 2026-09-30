import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useToast } from '@/store/toastStore'
import { ContactForm, emptyContact, contactToPayload } from '@/pages/adressen/addressForms'
import {
  fetchSalutations, fetchGenders, searchAddressesApi, createContact, updateContact,
  type Contact, type ContactPayload,
} from '@/api/stammdaten'

export type ContactDialogState =
  | { mode: 'new'; addressId?: number | null; addressName?: string }
  | { mode: 'edit'; contact: Contact }
  | null

/** Pflichtfelder eines Kontakts — dieselben, die der Server verlangt. */
export function missingContactFields(f: ContactPayload): string[] {
  const m: string[] = []
  if (!f.first_name.trim()) m.push('Vorname')
  if (!f.last_name.trim())  m.push('Nachname')
  if (!f.gender_id)         m.push('Geschlecht')
  if (!f.salutation_id)     m.push('Anrede')
  if (!f.address_id)        m.push('Adresse')
  return m
}

/**
 * Kontakt anlegen oder bearbeiten (UI-Pilot Runde 8) — eine Stelle für die
 * Adressseite und den Reiter „Kontakte".
 *
 * Vorher: vier Kopien desselben Dialogs. Escape, Klick daneben und
 * „Abbrechen" verwarfen Eingaben ohne Rückfrage; „Schließen" hieß der Knopf
 * beim Anlegen, weil der Dialog nach dem Speichern offen blieb und sich
 * leerte; nach dem Ändern schloss er sich 0,8 s später von selbst. Welche
 * Pflichtangabe fehlte, sagte er nicht.
 */
export function ContactDialog({ state, onClose }: { state: ContactDialogState; onClose: () => void }) {
  if (!state) return null
  const key = state.mode === 'edit' ? `edit-${state.contact.ID}` : `new-${state.addressId ?? ''}`
  return <ContactDialogInner key={key} state={state} onClose={onClose} />
}

function ContactDialogInner({ state, onClose }: { state: NonNullable<ContactDialogState>; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const isEdit = state.mode === 'edit'

  const initial = useMemo<{ form: ContactPayload; addr: string }>(() => state.mode === 'edit'
    ? { form: contactToPayload(state.contact), addr: state.contact.ADDRESS ?? '' }
    : { form: { ...emptyContact(), address_id: state.addressId ?? '' }, addr: state.addressName ?? '' },
  [state])
  const [form, setForm] = useState(initial.form)
  const [addrText, setAddrText] = useState(initial.addr)
  const [invalid, setInvalid] = useState<string[]>([])
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [pending, setPending] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(initial.form)

  const { data: salData } = useQuery({ queryKey: ['salutations'], queryFn: fetchSalutations })
  const { data: genData } = useQuery({ queryKey: ['genders-std'], queryFn: fetchGenders })

  const setK = useCallback((k: keyof ContactPayload) => (v: string) => {
    setForm(f => ({ ...f, [k]: v }))
    setMsg(null)
  }, [])
  const setPrimary = useCallback((v: boolean) => setForm(f => ({ ...f, is_primary: v })), [])
  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return (res.data ?? []).map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  async function requestClose() {
    if (pending) return
    if (dirty) {
      const ok = await confirm({
        title: 'Änderungen verwerfen?',
        message: isEdit ? 'Der Kontakt bleibt, wie er gespeichert ist.' : 'Der Kontakt wird nicht angelegt.',
        confirmLabel: 'Verwerfen',
      })
      if (!ok) return
    }
    onClose()
  }

  async function save() {
    if (pending) return
    const missing = missingContactFields(form)
    setInvalid(missing)
    if (missing.length) { setMsg({ type: 'error', text: `Bitte noch angeben: ${missing.join(', ')}.` }); return }
    setPending(true)
    setMsg(null)
    try {
      if (state.mode === 'edit') await updateContact(state.contact.ID, form)
      else await createContact(form)
      void qc.invalidateQueries({ queryKey: ['address-detail'] })
      void qc.invalidateQueries({ queryKey: ['contacts'] })
      void qc.invalidateQueries({ queryKey: ['contacts-by-address'] })
      toast.success(isEdit ? 'Kontakt gespeichert.' : `${form.first_name.trim()} ${form.last_name.trim()} angelegt.`)
      onClose()
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error)?.message || 'Speichern fehlgeschlagen' })
    } finally {
      setPending(false)
    }
  }

  useCtrlS(() => void save(), true)

  return (
    <>
      <Modal open onClose={() => void requestClose()} title={isEdit ? 'Kontakt bearbeiten' : 'Kontakt hinzufügen'}>
        <div className="master-form">
          <ContactForm vals={form} setK={setK} onPrimaryChange={setPrimary} addrTxt={addrText} setAddrTxt={setAddrText}
            msg={msg} isEdit={isEdit} invalid={invalid}
            salutations={salData?.data ?? []} genders={genData?.data ?? []} searchAddresses={searchAddresses} />
          <DialogFooter>
            <button type="button" className="btn-secondary" onClick={() => void requestClose()} disabled={pending}>Abbrechen</button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={pending}>
              {pending ? 'Speichert …' : isEdit ? 'Speichern' : 'Anlegen'}
            </button>
          </DialogFooter>
        </div>
      </Modal>
      {confirmDialog}
    </>
  )
}

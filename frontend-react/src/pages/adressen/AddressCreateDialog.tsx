import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useToast } from '@/store/toastStore'
import { useDefaultString } from '@/hooks/useTenantDefaults'
import { emptyAddr } from '@/pages/adressen/addressForms'
import { AddressFields, missingAddressFields, type AddressField } from '@/pages/adressen/AddressFields'
import { fetchCountries, createAddress, searchAddressesApi, type AddressPayload } from '@/api/stammdaten'

/**
 * Neue Adresse (UI-Pilot Runde 8).
 *
 * Vorher blieb der Dialog nach dem Speichern offen und leerte sich
 * („Schließen" statt „Abbrechen"), die neue Adresse musste man danach in der
 * Liste suchen. Jetzt öffnet sich die Adresse, damit man gleich Kontakte
 * anlegen kann.
 *
 * Gleicher Name: Seit Migration 0164 verbietet die Datenbank keine
 * Dubletten mehr (die Regel sperrte fremde Büros aus). Die Prüfung gehört
 * deshalb hierher, wo sie fragen kann statt abzuweisen.
 */
export function AddressCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return <CreateInner onClose={onClose} />
}

function CreateInner({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const defaultCountryId = useDefaultString('default_country_id')
  const [initial] = useState(() => emptyAddr(defaultCountryId))
  const [vals, setVals] = useState<AddressPayload>(initial)
  const [invalid, setInvalid] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const { data: countriesData } = useQuery({ queryKey: ['countries'], queryFn: fetchCountries })
  const dirty = JSON.stringify(vals) !== JSON.stringify(initial)

  const set = (k: AddressField, v: string) => { setVals(x => ({ ...x, [k]: v })); setErr(null) }

  async function requestClose() {
    if (pending) return
    if (dirty && !(await confirm({ title: 'Eingaben verwerfen?', message: 'Die Adresse wird nicht angelegt.', confirmLabel: 'Verwerfen' }))) return
    onClose()
  }

  async function save() {
    if (pending) return
    const missing = missingAddressFields(vals)
    setInvalid(missing)
    if (missing.length) { setErr(`Bitte noch angeben: ${missing.join(', ')}.`); return }
    setPending(true)
    setErr(null)
    try {
      const name = vals.address_name_1.trim()
      const same = ((await searchAddressesApi(name)).data ?? [])
        .filter(a => a.ADDRESS_NAME_1.trim().toLowerCase() === name.toLowerCase())
      if (same.length) {
        setPending(false)
        const ok = await confirm({
          title: 'Diese Adresse gibt es schon',
          message: `„${same[0].ADDRESS_NAME_1}" steht bereits im Adressbuch${same.length > 1 ? ` (${same.length}-mal)` : ''}. Trotzdem eine weitere anlegen?`,
          confirmLabel: 'Trotzdem anlegen',
          confirmClass: 'btn-primary',
        })
        if (!ok) return
        setPending(true)
      }
      const res = await createAddress(vals)
      void qc.invalidateQueries({ queryKey: ['addresses'] })
      toast.success(`${name} angelegt.`)
      const newId = res.data?.ID
      onClose()
      if (newId) navigate(`/adressen/${newId}`)
    } catch (e) {
      setErr((e as Error)?.message || 'Anlegen fehlgeschlagen')
    } finally {
      setPending(false)
    }
  }

  useCtrlS(() => void save(), true)

  return (
    <>
      <Modal open onClose={() => void requestClose()} title="Neue Adresse" className="modal-wide">
        <div className="ad-create-body">
          <AddressFields vals={vals} set={set} countries={countriesData?.data ?? []} prefix="adn" invalid={invalid} compact />
          <Message type="error" text={err} />
          <DialogFooter>
            <button type="button" className="btn-secondary" onClick={() => void requestClose()} disabled={pending}>Abbrechen</button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={pending}>
              {pending ? 'Legt an …' : 'Anlegen'}
            </button>
          </DialogFooter>
        </div>
      </Modal>
      {confirmDialog}
    </>
  )
}

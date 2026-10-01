import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchProjectManagers, fetchProjectStatuses, type Project } from '@/api/projekte'
import { fetchAddressDetail, fetchContactsByAddress } from '@/api/stammdaten'
import type { Nachtrag, ReleaseTarget } from '@/api/nachtraege'
import { useTenantDefaults } from '@/hooks/useTenantDefaults'
import { presetContact } from '@/hooks/useContactPreset'
import { presetId } from '@/utils/vorbelegung'
import { useDerivedAbbr } from '@/pages/projekte/gesamtprojekt/gesamtprojektUi'

/**
 * Ziel einer Nachtrags-Freigabe (Gesamtprojekt Stufe 3, Migration 0182).
 *
 * Felder auf `null`/`undefined` heißen „Vorbelegung": Name des Nachtrags,
 * Projektstatus aus den Vorbelegungen, Leitung des Ursprungsprojekts,
 * Auftraggeber/Rechnungsempfänger aus dem Nachtrag (sonst vom Projekt) samt
 * dessen Kontakt. Wer eine andere Adresse wählt, bekommt deren Haupt-
 * ansprechpartner (oder einzigen Kontakt) — wie überall beim Wählen einer
 * Adresse (`presetContact`).
 */
export type ZielKind = 'origin' | 'release_project' | 'new_project'

export interface ZielForm {
  kind:             ZielKind
  releaseProjectId: number | null
  name:             string | null
  statusId:         string | null
  managerId:        string | null
  /** undefined = Vorbelegung, null = bewusst leer */
  addressId:        number | null | undefined
  addrText:         string | null
  contactId:        number | null | undefined
  abbrMode:         'range' | 'derived'
}

const START: ZielForm = {
  kind: 'origin', releaseProjectId: null, name: null, statusId: null, managerId: null,
  addressId: undefined, addrText: null, contactId: undefined, abbrMode: 'derived',
}

export function useFreigabeZiel({ nachtrag, source }: { nachtrag: Nachtrag; source: Project | undefined }) {
  const [form, setForm] = useState<ZielForm>(START)
  const set = (patch: Partial<ZielForm>) => setForm(f => ({ ...f, ...patch }))
  const isNew = form.kind === 'new_project'

  const defaults = useTenantDefaults()
  const { data: statusData } = useQuery({ queryKey: ['project-statuses'], queryFn: fetchProjectStatuses, enabled: isNew })
  const { data: mgrData }    = useQuery({ queryKey: ['project-managers'], queryFn: fetchProjectManagers, enabled: isNew })
  const nachtragAddrId = nachtrag.ADDRESS_ID ?? null
  const { data: addrData } = useQuery({
    queryKey: ['address-detail', nachtragAddrId],
    queryFn:  () => fetchAddressDetail(nachtragAddrId!),
    enabled:  isNew && nachtragAddrId != null,
    retry:    false,
  })

  const addressId = form.addressId !== undefined ? form.addressId : (nachtragAddrId ?? source?.ADDRESS_ID ?? null)
  const { data: contactData } = useQuery({
    queryKey: ['contacts-by-address', addressId],
    queryFn:  () => fetchContactsByAddress(addressId!),
    enabled:  isNew && addressId != null,
  })
  const contacts = addressId != null ? contactData?.data ?? [] : []

  const defaultAddrText =
    addressId != null && addressId === nachtragAddrId ? addrData?.data.address.ADDRESS_NAME_1 ?? ''
      : addressId != null && addressId === source?.ADDRESS_ID ? source?.ADDRESS_NAME ?? ''
        : ''
  const defaultContact =
    addressId == null ? null
      : form.addressId === undefined && addressId === nachtragAddrId ? nachtrag.CONTACT_ID ?? presetContact(contacts)?.id ?? null
        : form.addressId === undefined && addressId === source?.ADDRESS_ID ? source?.CONTACT_ID ?? presetContact(contacts)?.id ?? null
          : presetContact(contacts)?.id ?? null

  const statuses = statusData?.data ?? []
  const managers = mgrData?.data ?? []
  const effective = {
    name:      form.name ?? nachtrag.NAME,
    statusId:  form.statusId ?? presetId(statuses, defaults.default_project_status_id),
    managerId: form.managerId ?? (source?.PROJECT_MANAGER_ID != null ? String(source.PROJECT_MANAGER_ID) : ''),
    addressId,
    addrText:  form.addrText ?? defaultAddrText,
    contactId: form.contactId !== undefined ? form.contactId : defaultContact,
  }

  // Abgeleitete Nummer: mit Gesamtprojekt vom Server; ohne entsteht es aus dem
  // Ursprungsprojekt, das dann als 01 zählt — der Vorschlag ist eine Schätzung.
  const groupId = source?.PROJECT_GROUP_ID ?? null
  const derivedFromServer = useDerivedAbbr(isNew && groupId ? String(groupId) : '')
  const derivedPreview = groupId ? derivedFromServer : source?.ABBR ? `${source.ABBR}-02` : null

  const missing: string[] = []
  if (isNew) {
    if (!effective.name.trim()) missing.push('Projektname')
    if (!effective.statusId)    missing.push('Status')
    if (!effective.managerId)   missing.push('Projektleitung')
    if (effective.addressId == null) missing.push('Rechnungsempfänger')
    if (effective.contactId == null) missing.push('Kontakt')
  }

  function payload(): ReleaseTarget {
    if (form.kind === 'release_project' && form.releaseProjectId != null) {
      return { kind: 'release_project', project_id: form.releaseProjectId }
    }
    if (form.kind === 'new_project') {
      return {
        kind: 'new_project', name: effective.name.trim(),
        project_status_id: Number(effective.statusId), project_manager_id: Number(effective.managerId),
        address_id: Number(effective.addressId), contact_id: Number(effective.contactId),
        abbr_mode: form.abbrMode,
      }
    }
    return { kind: 'origin' }
  }

  return {
    form, set, effective, statuses, managers, contacts,
    groupId, groupName: source?.GROUP_NAME || null, sourceName: source?.NAME ?? null, sourceAbbr: source?.ABBR ?? null,
    derivedPreview, derivedEstimated: !groupId,
    missing, payload,
  }
}

export type FreigabeZiel = ReturnType<typeof useFreigabeZiel>

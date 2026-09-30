import { useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { FileSignature } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useConfirm } from '@/hooks/useConfirm'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { presetNote, useContactPreset } from '@/hooks/useContactPreset'
import { usePermission } from '@/store/permissionsStore'
import {
  fetchProjectListFull, fetchProject, updateProject, cascadeProjectInternal,
  fetchContractByProject, patchContract,
  fetchProjectStatuses, fetchProjectTypes, fetchProjectManagers, fetchDepartments,
  type Project,
} from '@/api/projekte'
import { searchAddressesApi, fetchContactsByAddress, fetchCompanies } from '@/api/stammdaten'
import { fetchOffer } from '@/api/angebote'
import { angebotHref } from '@/pages/angebote/angebotUrlState'
import { ActionBar } from '@/components/ui/ActionBar'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { FormSection } from '@/components/ui/FormSection'
import { HelpHint } from '@/components/ui/HelpHint'
import { Message } from '@/components/ui/Message'

/**
 * Reiter „Projektdaten" (UI-Pilot Runde 8).
 *
 * Vorher änderte man Name, Status, Leitung und Auftraggeber nur über einen
 * Dialog in der Projektliste — also genau dort, wo man nicht ist, wenn man in
 * einem Projekt arbeitet. Die Felder hatten keine verknüpfte Beschriftung
 * (Screenreader lasen „Eingabefeld"), ein leerer Name ging ungeprüft an den
 * Server, und „Gespeichert ✅" schloss den Dialog nach 0,8 s von selbst.
 *
 * Jetzt im Muster von Vertrag und Preislisten: Eingaben liegen über dem
 * geladenen Stand, die Aktionsleiste zählt die Änderungen, Verlassen fragt
 * nach. Die beiden Folgefragen des alten Dialogs bleiben — Auftraggeber in den
 * Vertrag übernehmen, „intern" an die Elemente weitergeben — aber erst nach
 * dem Speichern und nur, wenn sie etwas ändern würden.
 */

interface DatenForm {
  abbr:       string
  name:       string
  statusId:   string
  typeId:     string
  managerId:  string
  deptId:     string
  addressId:  number | null
  addrText:   string
  contactId:  number | null
  isInternal: boolean
}

/** Was als Änderung zählt — `addrText` ist nur die Anzeige zu `addressId`. */
const FIELDS: (keyof DatenForm)[] = [
  'abbr', 'name', 'statusId', 'typeId', 'managerId', 'deptId', 'addressId', 'contactId', 'isInternal',
]

const idStr = (v: number | null | undefined) => (v == null ? '' : String(v))
const idNum = (v: string) => (v ? Number(v) : null)

function formFrom(p: Project): DatenForm {
  return {
    abbr:       p.ABBR ?? '',
    name:       p.NAME ?? '',
    statusId:   idStr(p.PROJECT_STATUS_ID),
    typeId:     idStr(p.PROJECT_TYPE_ID),
    managerId:  idStr(p.PROJECT_MANAGER_ID),
    deptId:     idStr(p.DEPARTMENT_ID),
    addressId:  p.ADDRESS_ID ?? null,
    addrText:   p.ADDRESS_NAME ?? '',
    contactId:  p.CONTACT_ID ?? null,
    isInternal: !!p.IS_INTERNAL,
  }
}

/** Pflichtfelder wie beim Anlegen — der Server prüft nur das Kürzel. */
function missingFields(f: DatenForm): string[] {
  const m: string[] = []
  if (!f.abbr.trim())  m.push('Projektnummer')
  if (!f.name.trim())  m.push('Projektname')
  if (!f.statusId)     m.push('Status')
  if (!f.managerId)    m.push('Projektleitung')
  return m
}

const FMT_DATE = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

export function Projektdaten({ initialProjectId }: { initialProjectId?: number }) {
  // Neuer Zustand je Projekt — offene Eingaben gehören zu genau einem Projekt.
  return <ProjektdatenProjekt key={initialProjectId ?? 'none'} projectId={initialProjectId ?? null} />
}

function ProjektdatenProjekt({ projectId }: { projectId: number | null }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['projects-full'], queryFn: fetchProjectListFull, staleTime: 60_000 })
  const project = data?.data.find(p => p.ID === projectId) ?? null

  if (projectId == null) return <p className="ls-empty">Bitte oben ein Projekt auswählen.</p>
  if (isLoading)         return <p className="ls-empty">Lädt …</p>
  if (isError)           return <Message type="error" text="Die Projektdaten konnten nicht geladen werden." />
  if (!project)          return <Message type="error" text="Dieses Projekt gibt es nicht (mehr)." />
  return <ProjektdatenFormular project={project} />
}

function ProjektdatenFormular({ project }: { project: Project }) {
  const qc = useQueryClient()
  const pid = project.ID
  const canEdit          = usePermission('projects.edit')
  const canEditContract  = usePermission('projects.contracts.edit')
  const canViewOffers    = usePermission('offers.view')
  const [confirm, confirmDialog] = useConfirm()
  const [edits, setEdits] = useState<Partial<DatenForm>>({})
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [tried, setTried] = useState(false)

  const saved = useMemo(() => formFrom(project), [project])
  const form: DatenForm = { ...saved, ...edits }
  const changed = FIELDS.filter(k => form[k] !== saved[k]).length
  const dirty = changed > 0
  const missing = missingFields(form)

  const { data: statusData } = useQuery({ queryKey: ['project-statuses'],    queryFn: fetchProjectStatuses })
  const { data: typeData }   = useQuery({ queryKey: ['project-types'],       queryFn: fetchProjectTypes })
  const { data: mgrData }    = useQuery({ queryKey: ['project-managers'],    queryFn: fetchProjectManagers })
  const { data: deptData }   = useQuery({ queryKey: ['project-departments'], queryFn: fetchDepartments })
  const { data: companyData } = useQuery({ queryKey: ['companies'], queryFn: fetchCompanies })
  const { data: detailData } = useQuery({ queryKey: ['project-detail', pid], queryFn: () => fetchProject(pid) })
  const { data: contactData } = useQuery({
    queryKey: ['contacts-by-address', form.addressId],
    queryFn:  () => fetchContactsByAddress(form.addressId!),
    enabled:  form.addressId != null,
  })
  const contacts = form.addressId != null ? contactData?.data ?? [] : []
  // Kontakt nach der Adresswahl vorbelegen (Runde 9)
  const applyContact = useCallback((id: number) => setEdits(e => ({ ...e, contactId: id })), [])
  const contactPreset = useContactPreset(form.addressId, form.addressId != null ? contactData?.data : [], applyContact)
  const contactNote = presetNote(contactPreset.preset, form.contactId)

  // Herkunft: GET /projekte/:id liefert die ganze Zeile (select *), der Typ
  // kennt nur die Spalten der Liste.
  const detail = detailData?.data as (Project & {
    created_at?: string | null; OFFER_ID?: number | null; COMPANY_ID?: number | null
  }) | undefined
  const companies = companyData?.data ?? []
  const company = companies.find(c => c.ID === detail?.COMPANY_ID)
  const offerId = detail?.OFFER_ID ?? null
  const { data: offerData } = useQuery({
    queryKey: ['offer', offerId], queryFn: () => fetchOffer(offerId!),
    enabled: offerId != null && canViewOffers, retry: false,
  })
  const offer = offerData?.data

  function set<K extends keyof DatenForm>(k: K, v: DatenForm[K]) {
    setEdits(e => ({ ...e, [k]: v }))
    setMsg(null)
  }
  function patch(p: Partial<DatenForm>) {
    setEdits(e => ({ ...e, ...p }))
    setMsg(null)
  }

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return (res.data ?? []).map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  async function save() {
    setTried(true)
    if (missing.length) {
      const text = `Bitte noch angeben: ${missing.join(', ')}.`
      setMsg({ type: 'error', text })
      throw new Error(text)
    }
    const f = form
    const addrChanged = f.addressId !== saved.addressId || f.contactId !== saved.contactId
    const internalChanged = f.isInternal !== saved.isInternal
    setPending(true)
    setMsg(null)
    try {
      await updateProject(pid, {
        abbr:               f.abbr.trim(),
        name:               f.name.trim(),
        project_status_id:  idNum(f.statusId) ?? undefined,
        project_type_id:    idNum(f.typeId),
        project_manager_id: idNum(f.managerId) ?? undefined,
        department_id:      idNum(f.deptId),
        address_id:         f.addressId,
        contact_id:         f.addressId != null ? f.contactId : null,
        is_internal:        f.isInternal,
      })
      await qc.invalidateQueries({ queryKey: ['projects-full'] })
      void qc.invalidateQueries({ queryKey: ['projects-short'] })
      void qc.invalidateQueries({ queryKey: ['project-detail', pid] })
      setEdits({})
      setTried(false)
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error)?.message || 'Speichern fehlgeschlagen' })
      throw e
    } finally {
      setPending(false)
    }

    const notes: string[] = ['Projektdaten gespeichert.']
    if (internalChanged) {
      const ok = await confirm({
        title: f.isInternal ? 'Elemente als intern markieren?' : 'Elemente wieder als extern markieren?',
        message: f.isInternal
          ? 'Sollen auch alle Elemente der Projektstruktur als intern gelten? Rechnungen lassen sie dann aus.'
          : 'Sollen auch alle Elemente der Projektstruktur wieder als extern gelten?',
        confirmLabel: 'Elemente anpassen',
        confirmClass: 'btn-primary',
      })
      if (ok) {
        try {
          await cascadeProjectInternal(pid, f.isInternal)
          void qc.invalidateQueries({ queryKey: ['structure', pid] })
          notes.push('Die Elemente der Struktur sind angepasst.')
        } catch (e) {
          notes.push(`Die Elemente konnten nicht angepasst werden: ${(e as Error)?.message ?? e}`)
        }
      }
    }
    if (addrChanged && canEditContract && f.addressId != null) {
      const contract = await fetchContractByProject(pid).then(r => r.data).catch(() => null)
      const differs = contract?.ID != null
        && (contract.INVOICE_ADDRESS_ID !== f.addressId || (contract.INVOICE_CONTACT_ID ?? null) !== f.contactId)
      if (contract && differs) {
        const ok = await confirm({
          title: 'Auch im Vertrag übernehmen?',
          message: `Der Vertrag schickt die Rechnungen bisher an „${contract.INVOICE_ADDRESS_NAME || 'eine andere Adresse'}". Soll „${f.addrText}" auch Rechnungsempfänger werden?`,
          confirmLabel: 'Im Vertrag übernehmen',
          confirmClass: 'btn-primary',
        })
        if (ok) {
          try {
            await patchContract(contract.ID, { INVOICE_ADDRESS_ID: f.addressId, INVOICE_CONTACT_ID: f.contactId })
            void qc.invalidateQueries({ queryKey: ['contract', pid] })
            notes.push('Der Vertrag geht jetzt an denselben Empfänger.')
          } catch (e) {
            notes.push(`Der Vertrag konnte nicht angepasst werden: ${(e as Error)?.message ?? e}`)
          }
        }
      }
    }
    setMsg({ type: notes.some(n => n.includes('nicht angepasst')) ? 'error' : 'success', text: notes.join(' ') })
  }

  async function discard() {
    const ok = await confirm({
      title: 'Änderungen verwerfen?',
      message: `${changed === 1 ? '1 Änderung geht' : `${changed} Änderungen gehen`} verloren. Das Projekt bleibt, wie es gespeichert ist.`,
      confirmLabel: 'Verwerfen',
    })
    if (ok) { setEdits({}); setMsg(null); setTried(false) }
  }

  useRegisterDirty('projektdaten', { dirty, label: 'Projektdaten', count: changed, save })
  useCtrlS(() => { if (dirty && !pending) void save().catch(() => {}) }, canEdit)

  const status = pending ? 'Speichert …'
    : dirty ? `${changed} ${changed === 1 ? 'Feld' : 'Felder'} geändert`
    : 'Keine Änderungen'
  const invalid = (label: string) => tried && missing.includes(label)

  return (
    <div className="ws-form">
      {!canEdit && (
        <p className="ws-form-readonly">Nur Lesen — zum Ändern fehlt das Recht „Projekte bearbeiten".</p>
      )}

      <fieldset className="ws-form-fields" disabled={!canEdit || pending}>
        <legend className="sr-only">Projektdaten</legend>

        <FormSection title="Projekt">
          <div className="form-group">
            <label htmlFor="pd-abbr">Projektnummer*</label>
            <input id="pd-abbr" type="text" value={form.abbr} aria-invalid={invalid('Projektnummer') || undefined}
              onChange={e => set('abbr', e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="pd-name">Projektname*</label>
            <input id="pd-name" type="text" value={form.name} aria-invalid={invalid('Projektname') || undefined}
              onChange={e => set('name', e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="pd-status">Status*</label>
            <select id="pd-status" value={form.statusId} aria-invalid={invalid('Status') || undefined}
              onChange={e => set('statusId', e.target.value)}>
              <option value="">Bitte wählen …</option>
              {(statusData?.data ?? []).map(s => <option key={s.ID} value={s.ID}>{s.ABBR}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="pd-manager">Projektleitung*</label>
            <select id="pd-manager" value={form.managerId} aria-invalid={invalid('Projektleitung') || undefined}
              onChange={e => set('managerId', e.target.value)}>
              <option value="">Bitte wählen …</option>
              {(mgrData?.data ?? []).map(m => <option key={m.ID} value={m.ID}>{m.ABBR}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="pd-type">Typ</label>
            <select id="pd-type" value={form.typeId} onChange={e => set('typeId', e.target.value)}>
              <option value="">— kein Typ —</option>
              {(typeData?.data ?? []).map(t => <option key={t.ID} value={t.ID}>{t.ABBR}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="pd-dept">Abteilung</label>
            <select id="pd-dept" value={form.deptId} onChange={e => set('deptId', e.target.value)}>
              <option value="">— keine Abteilung —</option>
              {(deptData?.data ?? []).map(d => <option key={d.ID} value={d.ID}>{d.ABBR}</option>)}
            </select>
          </div>
          <label className="ws-check form-section-wide">
            <input type="checkbox" checked={form.isInternal} onChange={e => set('isInternal', e.target.checked)}
              aria-describedby="pd-internal-hint" />
            <span>Internes Projekt</span>
            <HelpHint id="projects.internal" size={13} />
          </label>
          <p id="pd-internal-hint" className="form-field-hint form-section-wide">
            Für Büroarbeit ohne Auftraggeber (Akquise, Verwaltung, Fortbildung). Stunden darauf zählen nicht als Projektarbeit.
          </p>
        </FormSection>

        <FormSection title="Auftraggeber" hint="Für wen das Projekt läuft. An wen die Rechnungen gehen, steht im Vertrag.">
          <Autocomplete
            label="Adresse"
            htmlId="pd-address"
            value={form.addrText}
            onChange={text => { if (text) set('addrText', text); else { patch({ addrText: '', addressId: null, contactId: null }); contactPreset.arm(null) } }}
            onSelect={(id, label) => { patch({ addressId: Number(id), addrText: label, contactId: null }); contactPreset.arm(Number(id)) }}
            search={searchAddresses}
            placeholder="Adresse suchen …"
          />
          <div className="form-group">
            <label htmlFor="pd-contact">Ansprechpartner</label>
            <select id="pd-contact" value={form.contactId ?? ''} disabled={form.addressId == null}
              aria-describedby={contactNote ? 'pd-contact-hint' : undefined}
              onChange={e => set('contactId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">{form.addressId == null ? 'Erst eine Adresse wählen' : '— kein Ansprechpartner —'}</option>
              {contacts.map(c => (
                <option key={c.ID} value={c.ID}>
                  {`${c.FIRST_NAME ?? ''} ${c.LAST_NAME ?? ''}`.trim()}{Number(c.IS_PRIMARY) === 1 ? ' (Hauptansprechpartner)' : ''}
                </option>
              ))}
            </select>
            {contactNote && <p id="pd-contact-hint" className="form-field-hint">{contactNote}</p>}
          </div>
        </FormSection>
      </fieldset>

      {(detail?.created_at || detail?.OFFER_ID || (company && companies.length > 1)) && (
        <FormSection title="Herkunft">
          <dl className="ws-facts form-section-wide">
            {company && companies.length > 1 && (
              <div><dt>Firma</dt><dd>{company.COMPANY_NAME_1}</dd></div>
            )}
            {detail?.created_at && (
              <div><dt>Angelegt am</dt><dd>{FMT_DATE.format(new Date(detail.created_at))}</dd></div>
            )}
            {detail?.OFFER_ID != null && (
              <div><dt>Aus Angebot</dt><dd>
                {canViewOffers ? (
                  <Link to={angebotHref(detail.OFFER_ID)} className="ws-facts-link">
                    <FileSignature size={13} strokeWidth={1.75} aria-hidden="true" />
                    {offer ? [offer.ABBR, offer.NAME].filter(Boolean).join(' · ') : 'Angebot öffnen'}
                  </Link>
                ) : 'beauftragtes Angebot'}
              </dd></div>
            )}
          </dl>
        </FormSection>
      )}

      <Message type={msg?.type ?? 'info'} text={msg?.text ?? null} />

      {canEdit && (
        <ActionBar
          dirty={dirty}
          quiet={!dirty && !pending}
          status={status}
          secondary={dirty ? <button type="button" className="btn-secondary" onClick={() => void discard()} disabled={pending}>Verwerfen</button> : undefined}
        >
          <button type="button" className="btn-primary" onClick={() => void save().catch(() => {})} disabled={!dirty || pending}>
            {pending ? 'Speichert …' : 'Speichern'}
          </button>
        </ActionBar>
      )}
      {confirmDialog}
    </div>
  )
}

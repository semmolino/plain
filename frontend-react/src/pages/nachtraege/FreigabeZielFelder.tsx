import { useCallback } from 'react'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { HelpHint } from '@/components/ui/HelpHint'
import { searchAddressesApi } from '@/api/stammdaten'
import type { FreigabeZiel } from './freigabeZiel'

/**
 * „Wohin?" im Freigabedialog: ins Projekt des Nachtrags (wie bisher), in ein
 * Projekt aus einer früheren Freigabe oder als eigenes Projekt im
 * Gesamtprojekt — eigener Vertrag, eigener Rechnungsempfänger.
 *
 * Ein eigenes Projekt braucht `projects.create`; gehört das Projekt noch zu
 * keinem Gesamtprojekt, entsteht eins, und das braucht `projects.edit`. Fehlt
 * ein Recht, bleibt die Wahl sichtbar, aber gesperrt — mit Grund.
 */
export function FreigabeZielFelder({ ziel, projectLabel, releaseProjects, canCreate, canEditProjects }: {
  ziel:            FreigabeZiel
  projectLabel:    string
  releaseProjects: { ID: number; ABBR: string | null; NAME: string | null; releaseNos: number[] }[]
  canCreate:       boolean
  canEditProjects: boolean
}) {
  const { form, set, effective } = ziel
  const needsGroup = ziel.groupId == null
  const newAllowed = canCreate && (!needsGroup || canEditProjects)
  const newBlocked = !canCreate
    ? 'Dafür fehlt das Recht, Projekte anzulegen.'
    : needsGroup && !canEditProjects
      ? 'Das Projekt gehört noch zu keinem Gesamtprojekt — es anzulegen braucht das Recht „Projekte bearbeiten".'
      : null

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return (res.data ?? []).map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  return (
    <div className="nt-target">
      <fieldset className="pg-fieldset">
        <legend>Wohin? <HelpHint id="nachtrag.eigenes_projekt" size={12} /></legend>
        <label className="pg-radio">
          <input type="radio" name="nt-target" checked={form.kind === 'origin'} onChange={() => set({ kind: 'origin' })} />
          <span>Ins Projekt {projectLabel} — unter „Nachträge" in der Struktur</span>
        </label>
        {releaseProjects.map(p => (
          <label key={p.ID} className="pg-radio">
            <input type="radio" name="nt-target"
              checked={form.kind === 'release_project' && form.releaseProjectId === p.ID}
              onChange={() => set({ kind: 'release_project', releaseProjectId: p.ID })} />
            <span>In {[p.ABBR, p.NAME].filter(Boolean).join(' · ')} — angelegt mit Freigabe {p.releaseNos.join(', ')}</span>
          </label>
        ))}
        <label className="pg-radio">
          <input type="radio" name="nt-target" checked={form.kind === 'new_project'} disabled={!newAllowed}
            onChange={() => set({ kind: 'new_project' })} />
          <span>
            Als eigenes Projekt im Gesamtprojekt
            {ziel.groupName ? <> „{ziel.groupName}"</> : null}
            {newBlocked && <span className="nt-target-why"> — {newBlocked}</span>}
          </span>
        </label>
      </fieldset>

      {form.kind === 'new_project' && (
        <div className="nt-target-new">
          <p className="form-field-hint">
            {needsGroup
              ? <>Das Projekt gehört noch zu keinem Gesamtprojekt. Es entsteht jetzt aus „{ziel.sourceName}", und beide Projekte gehören dazu. </>
              : null}
            Firma, Typ, Team und Vertragskonditionen (Steuer, Skonto, Einbehalt) kommen vom Projekt {projectLabel};
            der Rechnungsempfänger ist der des neuen Vertrags.
          </p>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="nt-new-name">Projektname*</label>
              <input id="nt-new-name" type="text" value={effective.name} onChange={e => set({ name: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="nt-new-status">Status*</label>
              <select id="nt-new-status" value={effective.statusId} onChange={e => set({ statusId: e.target.value })}>
                <option value="">Bitte wählen …</option>
                {ziel.statuses.map(s => <option key={s.ID} value={s.ID}>{s.ABBR}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="nt-new-manager">Projektleitung*</label>
              <select id="nt-new-manager" value={effective.managerId} onChange={e => set({ managerId: e.target.value })}>
                <option value="">Bitte wählen …</option>
                {ziel.managers.map(m => <option key={m.ID} value={m.ID}>{m.ABBR}</option>)}
              </select>
            </div>
            <Autocomplete
              label="Auftraggeber und Rechnungsempfänger*"
              htmlId="nt-new-address"
              value={effective.addrText}
              onChange={text => { if (text) set({ addrText: text }); else set({ addrText: '', addressId: null, contactId: undefined }) }}
              onSelect={(id, label) => set({ addressId: Number(id), addrText: label, contactId: undefined })}
              search={searchAddresses}
              placeholder="Adresse suchen …"
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="nt-new-contact">Kontakt*</label>
              <select id="nt-new-contact" value={effective.contactId ?? ''} disabled={effective.addressId == null}
                onChange={e => set({ contactId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{effective.addressId == null ? 'Erst eine Adresse wählen' : 'Bitte wählen …'}</option>
                {ziel.contacts.map(c => (
                  <option key={c.ID} value={c.ID}>
                    {`${c.FIRST_NAME ?? ''} ${c.LAST_NAME ?? ''}`.trim()}{Number(c.IS_PRIMARY) === 1 ? ' (Hauptansprechpartner)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="pg-fieldset pg-wahl-nummer">
              <legend>Projektnummer</legend>
              <label className="pg-radio">
                <input type="radio" name="nt-new-abbr" checked={form.abbrMode === 'derived' && !!ziel.derivedPreview}
                  disabled={!ziel.derivedPreview} onChange={() => set({ abbrMode: 'derived' })} />
                {ziel.derivedPreview
                  ? <>Abgeleitet: <strong>{ziel.derivedPreview}</strong>{ziel.derivedEstimated ? ' (voraussichtlich)' : ''}</>
                  : 'Abgeleitet — das Gesamtprojekt hat kein Kürzel'}
              </label>
              <label className="pg-radio">
                <input type="radio" name="nt-new-abbr" checked={form.abbrMode === 'range' || !ziel.derivedPreview}
                  onChange={() => set({ abbrMode: 'range' })} />
                Nächste Nummer aus dem Nummernkreis
              </label>
            </fieldset>
          </div>
        </div>
      )}
    </div>
  )
}

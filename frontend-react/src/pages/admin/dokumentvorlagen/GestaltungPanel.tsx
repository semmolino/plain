import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlignCenter, AlignLeft, AlignRight, Check, Plus } from 'lucide-react'
import { FormSection } from '@/components/ui/FormSection'
import { AssetUploadBlock } from '@/components/admin/AssetUploadBlock'
import { useToast } from '@/store/toastStore'
import { fetchCompanies, fetchCompanyAssets, putCompanyLogo } from '@/api/stammdaten'
import {
  FONT_OPTIONS, LOGO_SIZES, STYLE_PRESETS,
  type DocTheme, type LogoPosition, type StylePreset,
} from '@/api/documentTemplates'

// Kuratierte, dezent-professionelle Hausfarben + freie Farbwahl. Die Werte
// landen im PDF — dort ist eine CSS-Variable kein Farbwert.
const ACCENT_PALETTE = [
  '#111827', '#1e3a5f', '#0f766e', '#7c2d12', '#5b21b6',
  '#9f1239', '#15803d', '#b45309', '#0369a1', '#3f3f46',
]

const LOGO_POSITIONS: { id: LogoPosition; label: string; Icon: typeof AlignLeft }[] = [
  { id: 'left',   label: 'Links',  Icon: AlignLeft },
  { id: 'center', label: 'Mitte',  Icon: AlignCenter },
  { id: 'right',  label: 'Rechts', Icon: AlignRight },
]

const FONT_GROUP: Record<string, 'sans' | 'serif'> = Object.fromEntries(FONT_OPTIONS.map(f => [f.key, f.group]))

// Mini-Beleg für eine Stil-Vorlage: Akzentfarbe, Serif/Sans, Logo-Position.
// Bewusst papierweiß — gedrucktes Papier kippt im Dark-Theme nicht mit.
function PresetThumb({ accent, serif, logoPosition }: { accent: string; serif: boolean; logoPosition: LogoPosition }) {
  const justify = logoPosition === 'left' ? 'flex-start' : logoPosition === 'center' ? 'center' : 'flex-end'
  return (
    <div className="dv-thumb" style={{ fontFamily: serif ? 'Georgia, "Times New Roman", serif' : 'Arial, Helvetica, sans-serif', background: '#ffffff' }}>
      <div style={{ display: 'flex', justifyContent: justify }}>
        <div style={{ width: 26, height: 9, background: '#d1d5db', borderRadius: 2 }} />
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: accent, lineHeight: 1.1 }}>Rechnung</div>
      <div style={{ height: 3, background: '#e5e7eb', borderRadius: 2, width: '90%' }} />
      <div style={{ height: 3, background: '#eef0f2', borderRadius: 2, width: '70%' }} />
      <div style={{ height: 3, background: '#eef0f2', borderRadius: 2, width: '80%' }} />
      <div style={{ marginTop: 'auto', borderTop: `1.5px solid ${accent}`, paddingTop: 3, fontSize: 8, fontWeight: 700, color: accent, textAlign: 'right' }}>26.418,00 €</div>
    </div>
  )
}

// Logo je Unternehmen — wird sofort beim Hochladen gespeichert. Position und
// Größe (Theme) gelten für alle Gesellschaften.
function CompanyLogoBlock() {
  const qc = useQueryClient()
  const toast = useToast()
  const [companyId, setCompanyId] = useState<number | null>(null)
  const { data: companiesData } = useQuery({ queryKey: ['companies'], queryFn: fetchCompanies })
  const companies = companiesData?.data ?? []
  const effectiveId = companyId ?? companies[0]?.ID ?? null

  const assetsKey = ['company-assets', effectiveId]
  const { data: assetsData } = useQuery({
    queryKey: assetsKey,
    queryFn: () => fetchCompanyAssets(effectiveId as number),
    enabled: effectiveId !== null,
  })
  const assets = assetsData?.data

  const logoMut = useMutation({
    mutationFn: (assetId: number | null) => putCompanyLogo(effectiveId as number, assetId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: assetsKey }) },
    onError: (e: Error) => toast.error(e.message),
  })

  if (companies.length === 0) {
    return (
      <p className="dv-empty">
        Noch kein Unternehmen angelegt — hinterlege zuerst unter <strong>Einstellungen → Unternehmen</strong> deine
        Firmendaten, dann kannst du hier ein Logo hochladen.
      </p>
    )
  }

  return (
    <div className="form-section-wide">
      {companies.length > 1 && (
        <div className="admin-company-selector" style={{ marginBottom: 12 }}>
          {companies.map(c => (
            <button key={c.ID} type="button" className={`admin-company-btn${effectiveId === c.ID ? ' active' : ''}`} onClick={() => setCompanyId(c.ID)}>
              {c.COMPANY_NAME_1}
            </button>
          ))}
        </div>
      )}
      <AssetUploadBlock
        label={companies.length > 1 ? 'Logo dieser Gesellschaft' : 'Firmenlogo'}
        assetId={assets?.logo_asset_id ?? null}
        dataUri={assets?.logo_data_uri ?? null}
        onSave={id => logoMut.mutate(id)}
        onRemove={() => logoMut.mutate(null)}
        isPending={logoMut.isPending}
        assetType="LOGO"
      />
    </div>
  )
}

export function GestaltungPanel({ theme, onChange }: { theme: DocTheme; onChange: (fn: (t: DocTheme) => DocTheme) => void }) {
  const accent = theme.brand.accentColor.toLowerCase()
  const accentInPalette = ACCENT_PALETTE.includes(accent)

  const setAccent = (c: string) => onChange(t => ({ ...t, brand: { ...t.brand, accentColor: c, primaryColor: c } }))
  const applyPreset = (p: StylePreset) => onChange(t => ({
    ...t,
    brand:  { ...t.brand, accentColor: p.accentColor, primaryColor: p.accentColor, fontFamily: p.fontFamily },
    header: { ...t.header, logoPosition: p.logoPosition },
  }))

  return (
    <>
      <FormSection title="Stil-Vorlage" help="vorlagen.preset" layout="block"
        hint="Setzt Farbe, Schrift und Logo-Position auf einen Schlag — danach frei anpassbar.">
        <div className="dv-presets">
          {STYLE_PRESETS.map(p => {
            const active = accent === p.accentColor.toLowerCase() && theme.brand.fontFamily === p.fontFamily && theme.header.logoPosition === p.logoPosition
            return (
              <button key={p.id} type="button" className={`dv-preset${active ? ' active' : ''}`} aria-pressed={active} onClick={() => applyPreset(p)}>
                <PresetThumb accent={p.accentColor} serif={FONT_GROUP[p.fontFamily] === 'serif'} logoPosition={p.logoPosition} />
                <span>{p.label}</span>
              </button>
            )
          })}
        </div>
      </FormSection>

      <FormSection title="Hausfarbe" help="vorlagen.accent" layout="block" hint="Färbt Überschriften und Linien auf dem Dokument.">
        <div className="dv-swatches">
          {ACCENT_PALETTE.map(c => {
            const active = accent === c
            return (
              <button key={c} type="button" className={`dv-swatch${active ? ' active' : ''}`} style={{ background: c }}
                onClick={() => setAccent(c)} aria-label={`Hausfarbe ${c}`} aria-pressed={active}>
                {active && <Check size={14} strokeWidth={3} style={{ color: '#ffffff' }} />}
              </button>
            )
          })}
          <label className={`dv-swatch dv-swatch--custom${!accentInPalette ? ' active' : ''}`} style={!accentInPalette ? { background: theme.brand.accentColor } : undefined} title="Eigene Farbe">
            <input type="color" value={theme.brand.accentColor} onChange={e => setAccent(e.target.value)} aria-label="Eigene Hausfarbe" />
            {accentInPalette && <Plus size={14} strokeWidth={2} aria-hidden="true" />}
          </label>
        </div>
      </FormSection>

      <FormSection title="Schrift und Logo">
        <div className="form-group">
          <label htmlFor="dv-font" className="ws-label-help">Schrift</label>
          <select id="dv-font" value={theme.brand.fontFamily} onChange={e => { const v = e.target.value; onChange(t => ({ ...t, brand: { ...t.brand, fontFamily: v } })) }}>
            <optgroup label="Serifenlos">
              {FONT_OPTIONS.filter(f => f.group === 'sans').map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </optgroup>
            <optgroup label="Serif">
              {FONT_OPTIONS.filter(f => f.group === 'serif').map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </optgroup>
          </select>
        </div>
        <fieldset className="ws-radio-group">
          <legend>Logo-Position</legend>
          <div className="dv-seg">
            {LOGO_POSITIONS.map(({ id, label, Icon }) => (
              <button key={id} type="button" aria-pressed={theme.header.logoPosition === id}
                className={theme.header.logoPosition === id ? 'btn-small btn-save' : 'btn-small'}
                onClick={() => onChange(t => ({ ...t, header: { ...t.header, logoPosition: id } }))}>
                <Icon size={14} strokeWidth={2} /> {label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="ws-radio-group">
          <legend>Logo-Größe</legend>
          <div className="dv-seg">
            {LOGO_SIZES.map(s => (
              <button key={s.id} type="button" aria-pressed={(theme.header.logoMaxHeightMm ?? 20) === s.mm}
                className={(theme.header.logoMaxHeightMm ?? 20) === s.mm ? 'btn-small btn-save' : 'btn-small'}
                onClick={() => onChange(t => ({ ...t, header: { ...t.header, logoMaxHeightMm: s.mm } }))}>
                {s.label}
              </button>
            ))}
          </div>
        </fieldset>
        <CompanyLogoBlock />
      </FormSection>

      <FormSection title="Kopfangaben" help="vorlagen.bauvorhaben" layout="block">
        <label className="dv-check">
          <input type="checkbox" checked={theme.header.showBauvorhaben !== false}
            onChange={e => { const on = e.target.checked; onChange(t => ({ ...t, header: { ...t.header, showBauvorhaben: on } })) }} />
          Zeile „Bauvorhaben: …“ auf Belegen — nur bei Projekten, die zu einem Gesamtprojekt gehören
        </label>
      </FormSection>
    </>
  )
}

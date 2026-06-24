import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlignLeft, AlignCenter, AlignRight, Check } from 'lucide-react'
import { Message }  from '@/components/ui/Message'
import { HelpHint } from '@/components/ui/HelpHint'
import { InfoHint } from '@/components/ui/InfoHint'
import {
  fetchBranding, saveBranding, previewBranding,
  DEFAULT_THEME, FONT_OPTIONS, APPENDIX_BLOCKS, APPENDIX_BLOCKS_BY_TYPE, DOC_TYPE_LABELS,
  type DocTheme, type LogoPosition, type ThemeBlocks, type DocTemplateType,
} from '@/api/documentTemplates'

// Kuratierte, dezent-professionelle Hausfarben + freie Farbwahl.
const ACCENT_PALETTE = [
  '#111827', '#1e3a5f', '#0f766e', '#7c2d12', '#5b21b6',
  '#9f1239', '#15803d', '#b45309', '#0369a1', '#3f3f46',
]

function mergeTheme(t?: Partial<DocTheme> | null): DocTheme {
  return {
    ...DEFAULT_THEME,
    ...(t ?? {}),
    brand:  { ...DEFAULT_THEME.brand,  ...(t?.brand  ?? {}) },
    header: { ...DEFAULT_THEME.header, ...(t?.header ?? {}) },
    blocks: { ...DEFAULT_THEME.blocks, ...(t?.blocks ?? {}) },
  }
}

const LOGO_POSITIONS: { id: LogoPosition; label: string; Icon: typeof AlignLeft }[] = [
  { id: 'left',   label: 'Links',   Icon: AlignLeft },
  { id: 'center', label: 'Mitte',   Icon: AlignCenter },
  { id: 'right',  label: 'Rechts',  Icon: AlignRight },
]

const APPENDIX_LABEL: Record<string, string> = Object.fromEntries(APPENDIX_BLOCKS.map(b => [b.key, b.label]))
const DOC_TYPES = Object.keys(DOC_TYPE_LABELS) as DocTemplateType[]

export function DokumentvorlagenSection() {
  const qc = useQueryClient()
  const [theme, setTheme]   = useState<DocTheme>(DEFAULT_THEME)
  const [loaded, setLoaded] = useState(false)
  const [previewHtml, setPreviewHtml]       = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [blocksByType, setBlocksByType] = useState<Record<DocTemplateType, ThemeBlocks>>({
    INVOICE: DEFAULT_THEME.blocks, PARTIAL_PAYMENT: DEFAULT_THEME.blocks, OFFER: DEFAULT_THEME.blocks,
  })
  const [appendixType, setAppendixType] = useState<DocTemplateType>('INVOICE')

  const { data } = useQuery({ queryKey: ['doc-branding'], queryFn: fetchBranding })
  useEffect(() => {
    if (data?.data && !loaded) {
      setTheme(mergeTheme(data.data.theme))
      const b = data.data.blocksByType
      if (b) setBlocksByType({
        INVOICE:         { ...DEFAULT_THEME.blocks, ...(b.INVOICE ?? {}) },
        PARTIAL_PAYMENT: { ...DEFAULT_THEME.blocks, ...(b.PARTIAL_PAYMENT ?? {}) },
        OFFER:           { ...DEFAULT_THEME.blocks, ...(b.OFFER ?? {}) },
      })
      setLoaded(true)
    }
  }, [data, loaded])

  // Debounced Live-Vorschau: jedes Mal, wenn sich das Theme aendert, rendert das
  // Backend einen synthetischen Beispiel-Beleg mit genau dieser Gestaltung.
  useEffect(() => {
    let cancelled = false
    setPreviewLoading(true)
    const previewTheme = { ...theme, blocks: blocksByType[appendixType] }
    const h = setTimeout(() => {
      previewBranding(previewTheme, appendixType)
        .then(r => { if (!cancelled) setPreviewHtml(r.html) })
        .catch(() => { if (!cancelled) setPreviewHtml('<p style="font-family:sans-serif;color:#b91c1c;padding:24px">Vorschau nicht verfügbar.</p>') })
        .finally(() => { if (!cancelled) setPreviewLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(h) }
  }, [theme, blocksByType, appendixType])

  const saveMut = useMutation({
    mutationFn: () => saveBranding(theme, blocksByType),
    onSuccess: () => { setMsg({ text: 'Gestaltung gespeichert ✅', type: 'success' }); void qc.invalidateQueries({ queryKey: ['doc-branding'] }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const setAccent  = (c: string)        => { setMsg(null); setTheme(t => ({ ...t, brand: { ...t.brand, accentColor: c, primaryColor: c } })) }
  const setFont    = (key: string)      => { setMsg(null); setTheme(t => ({ ...t, brand: { ...t.brand, fontFamily: key } })) }
  const setLogoPos = (p: LogoPosition)  => { setMsg(null); setTheme(t => ({ ...t, header: { ...t.header, logoPosition: p } })) }
  const setBlock   = (key: keyof ThemeBlocks, val: boolean) => { setMsg(null); setBlocksByType(prev => ({ ...prev, [appendixType]: { ...prev[appendixType], [key]: val } })) }

  const accentInPalette = ACCENT_PALETTE.includes(theme.brand.accentColor.toLowerCase())

  return (
    <div className="admin-section">
      <p className="admin-section-hint" style={{ marginTop: 0, display: 'flex', alignItems: 'flex-start' }}>
        <span>
          Lege fest, wie deine PDF-Dokumente aussehen — Hausfarbe, Schrift und Logo-Position.
          Die Gestaltung gilt für alle Belege (Rechnungen, Abschlags-/Schlussrechnungen, Angebote,
          Auftragsbestätigungen). Bereits gebuchte Belege bleiben unverändert.
        </span>
        <InfoHint title="So funktioniert's">
          <strong>1.</strong> Links Farbe, Schrift und Logo-Position wählen.<br />
          <strong>2.</strong> Rechts in der Vorschau live sehen, wie ein echter Beleg damit aussieht.<br />
          <strong>3.</strong> „Gestaltung speichern" — gilt ab dem nächsten neuen Beleg.
        </InfoHint>
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>

        {/* ── Steuerung ─────────────────────────────────────────────── */}
        <div style={{ flex: '1 1 300px', minWidth: 280 }}>

          {/* Akzentfarbe */}
          <div className="admin-block">
            <h3 className="admin-block-title" style={{ display: 'inline-flex', alignItems: 'center' }}>
              Hausfarbe <HelpHint id="vorlagen.accent" />
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {ACCENT_PALETTE.map(c => {
                const active = theme.brand.accentColor.toLowerCase() === c.toLowerCase()
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setAccent(c)}
                    title={c}
                    aria-label={`Hausfarbe ${c}`}
                    style={{
                      width: 32, height: 32, borderRadius: 8, background: c, cursor: 'pointer',
                      border: active ? '2px solid var(--text-1)' : '1px solid #d1d5db',
                      boxShadow: active ? '0 0 0 2px #fff inset' : 'none',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {active && <Check size={14} strokeWidth={3} color="#fff" />}
                  </button>
                )
              })}
              <label
                title="Eigene Farbe"
                style={{
                  width: 32, height: 32, borderRadius: 8, cursor: 'pointer', overflow: 'hidden',
                  border: !accentInPalette ? '2px solid var(--text-1)' : '1px dashed #9ca3af',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: !accentInPalette ? theme.brand.accentColor : '#fff',
                }}
              >
                <input
                  type="color"
                  value={theme.brand.accentColor}
                  onChange={e => setAccent(e.target.value)}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                {accentInPalette && <span style={{ fontSize: 13, color: '#6b7280' }}>+</span>}
              </label>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0 }}>
              Färbt Überschriften auf dem Dokument.
            </p>
          </div>

          {/* Schrift */}
          <div className="admin-block">
            <h3 className="admin-block-title" style={{ display: 'inline-flex', alignItems: 'center' }}>
              Schrift <HelpHint id="vorlagen.font" />
            </h3>
            <select
              value={theme.brand.fontFamily}
              onChange={e => setFont(e.target.value)}
              style={{ minWidth: 220 }}
            >
              <optgroup label="Serifenlos">
                {FONT_OPTIONS.filter(f => f.group === 'sans').map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </optgroup>
              <optgroup label="Serif">
                {FONT_OPTIONS.filter(f => f.group === 'serif').map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </optgroup>
            </select>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '8px 0 0' }}>
              Wirkung sofort rechts in der Vorschau sichtbar.
            </p>
          </div>

          {/* Logo-Position */}
          <div className="admin-block">
            <h3 className="admin-block-title" style={{ display: 'inline-flex', alignItems: 'center' }}>
              Logo-Position <HelpHint id="vorlagen.logo" />
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {LOGO_POSITIONS.map(({ id, label, Icon }) => {
                const active = theme.header.logoPosition === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setLogoPos(id)}
                    className={active ? 'btn-small btn-save' : 'btn-small'}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    <Icon size={14} strokeWidth={2} /> {label}
                  </button>
                )
              })}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '8px 0 0' }}>
              Das Logo selbst lädst du unter <strong>Einstellungen → Unternehmen</strong> hoch.
            </p>
          </div>

          {/* Inhalte & Anhänge — je Belegtyp einzeln */}
          <div className="admin-block">
            <h3 className="admin-block-title" style={{ display: 'inline-flex', alignItems: 'center' }}>
              Inhalte &amp; Anhänge <HelpHint id="vorlagen.anhaenge" />
            </h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {DOC_TYPES.map(dt => (
                <button
                  key={dt}
                  type="button"
                  onClick={() => { setMsg(null); setAppendixType(dt) }}
                  className={appendixType === dt ? 'btn-small btn-save' : 'btn-small'}
                >
                  {DOC_TYPE_LABELS[dt]}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {APPENDIX_BLOCKS_BY_TYPE[appendixType].map(key => (
                <label key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={blocksByType[appendixType][key] !== false}
                    onChange={e => setBlock(key, e.target.checked)}
                  />
                  {APPENDIX_LABEL[key]}
                </label>
              ))}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '10px 0 0' }}>
              Gilt für <strong>{DOC_TYPE_LABELS[appendixType]}</strong>. Anhänge erscheinen nur, wenn dafür auch Daten vorliegen (z. B. erfasste Stunden).
            </p>
          </div>

          <Message text={msg?.text ?? null} type={msg?.type} />
          <button
            className="btn-primary"
            style={{ marginTop: 8 }}
            onClick={() => { setMsg(null); saveMut.mutate() }}
            disabled={saveMut.isPending}
            type="button"
          >
            {saveMut.isPending ? 'Speichert …' : 'Gestaltung speichern'}
          </button>
        </div>

        {/* ── Live-Vorschau ─────────────────────────────────────────── */}
        <div style={{ flex: '1 1 360px', minWidth: 320 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Vorschau</span>
            {previewLoading && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>aktualisiert …</span>}
          </div>
          <iframe
            title="Belegvorschau"
            srcDoc={previewHtml}
            style={{
              width: '100%', height: 560, border: '1px solid var(--border)',
              borderRadius: 8, background: '#fff',
            }}
          />
        </div>

      </div>
    </div>
  )
}

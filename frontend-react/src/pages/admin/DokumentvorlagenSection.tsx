import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlignLeft, AlignCenter, AlignRight, Check, ChevronUp, ChevronDown } from 'lucide-react'
import { Message }  from '@/components/ui/Message'
import { HelpHint } from '@/components/ui/HelpHint'
import { InfoHint } from '@/components/ui/InfoHint'
import {
  fetchBranding, saveBranding, previewBranding,
  DEFAULT_THEME, FONT_OPTIONS, APPENDIX_BLOCKS, APPENDIX_BLOCKS_BY_CATEGORY, DOC_CATEGORY_LABELS,
  STYLE_PRESETS, LOGO_SIZES,
  type DocTheme, type LogoPosition, type ThemeBlocks, type DocCategory, type StylePreset, type AppendixKey,
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
const DOC_CATEGORIES = Object.keys(DOC_CATEGORY_LABELS) as DocCategory[]
const FONT_GROUP: Record<string, 'sans' | 'serif'> = Object.fromEntries(FONT_OPTIONS.map(f => [f.key, f.group]))
const A4_PREVIEW_WIDTH = 794 // A4-Breite bei 96dpi — die Vorschau wird darauf gerendert und skaliert

// Mini-Beleg-Vorschau für eine Stil-Vorlage-Karte: zeigt Akzentfarbe (Titel +
// Summenlinie), Serif/Sans und Logo-Position. Bewusst generische Schrift —
// die echte eingebettete Schrift erscheint in der großen Live-Vorschau rechts.
function PresetThumb({ accent, serif, logoPosition }: { accent: string; serif: boolean; logoPosition: LogoPosition }) {
  const justify = logoPosition === 'left' ? 'flex-start' : logoPosition === 'center' ? 'center' : 'flex-end'
  return (
    <div style={{ width: 132, height: 92, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 5, fontFamily: serif ? 'Georgia, "Times New Roman", serif' : 'Arial, Helvetica, sans-serif' }}>
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

export function DokumentvorlagenSection() {
  const qc = useQueryClient()
  const [theme, setTheme]   = useState<DocTheme>(DEFAULT_THEME)
  const [loaded, setLoaded] = useState(false)
  const [previewHtml, setPreviewHtml]       = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewScale, setPreviewScale]     = useState(0.5)
  const [previewContentH, setPreviewContentH] = useState(900)
  const previewWrapRef = useRef<HTMLDivElement>(null)
  const previewIframeRef = useRef<HTMLIFrameElement>(null)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [blocksByCategory, setBlocksByCategory] = useState<Record<DocCategory, ThemeBlocks>>({
    invoice_rechnung: DEFAULT_THEME.blocks, invoice_schluss: DEFAULT_THEME.blocks,
    invoice_abschlags: DEFAULT_THEME.blocks, offer_angebot: DEFAULT_THEME.blocks,
  })
  const [appendixCategory, setAppendixCategory] = useState<DocCategory>('invoice_rechnung')

  const { data } = useQuery({ queryKey: ['doc-branding'], queryFn: fetchBranding })
  useEffect(() => {
    if (data?.data && !loaded) {
      setTheme(mergeTheme(data.data.theme))
      const b = data.data.blocksByCategory
      if (b) setBlocksByCategory({
        invoice_rechnung:  { ...DEFAULT_THEME.blocks, ...(b.invoice_rechnung ?? {}) },
        invoice_schluss:   { ...DEFAULT_THEME.blocks, ...(b.invoice_schluss ?? {}) },
        invoice_abschlags: { ...DEFAULT_THEME.blocks, ...(b.invoice_abschlags ?? {}) },
        offer_angebot:     { ...DEFAULT_THEME.blocks, ...(b.offer_angebot ?? {}) },
      })
      setLoaded(true)
    }
  }, [data, loaded])

  // Debounced Live-Vorschau: jedes Mal, wenn sich das Theme aendert, rendert das
  // Backend einen synthetischen Beispiel-Beleg mit genau dieser Gestaltung.
  useEffect(() => {
    let cancelled = false
    setPreviewLoading(true)
    const previewTheme = { ...theme, blocks: blocksByCategory[appendixCategory] }
    const h = setTimeout(() => {
      previewBranding(previewTheme, appendixCategory)
        .then(r => { if (!cancelled) setPreviewHtml(r.html) })
        .catch(() => { if (!cancelled) setPreviewHtml('<p style="font-family:sans-serif;color:#b91c1c;padding:24px">Vorschau nicht verfügbar.</p>') })
        .finally(() => { if (!cancelled) setPreviewLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(h) }
  }, [theme, blocksByCategory, appendixCategory])

  // Vorschau (A4-Breite) passgenau auf die Containerbreite skalieren -> kein Scrollen.
  useEffect(() => {
    const el = previewWrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (w > 0) setPreviewScale(Math.min(1, w / A4_PREVIEW_WIDTH))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function handlePreviewLoad() {
    const doc = previewIframeRef.current?.contentDocument
    if (doc) setPreviewContentH(doc.documentElement?.scrollHeight || doc.body?.scrollHeight || 900)
  }

  const saveMut = useMutation({
    mutationFn: () => saveBranding(theme, blocksByCategory),
    onSuccess: () => { setMsg({ text: 'Gestaltung gespeichert ✅', type: 'success' }); void qc.invalidateQueries({ queryKey: ['doc-branding'] }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const setAccent  = (c: string)        => { setMsg(null); setTheme(t => ({ ...t, brand: { ...t.brand, accentColor: c, primaryColor: c } })) }
  const setFont    = (key: string)      => { setMsg(null); setTheme(t => ({ ...t, brand: { ...t.brand, fontFamily: key } })) }
  const setLogoPos = (p: LogoPosition)  => { setMsg(null); setTheme(t => ({ ...t, header: { ...t.header, logoPosition: p } })) }
  const setBlock   = (key: AppendixKey, val: boolean) => { setMsg(null); setBlocksByCategory(prev => ({ ...prev, [appendixCategory]: { ...prev[appendixCategory], [key]: val } })) }
  const moveBlock  = (key: AppendixKey, dir: -1 | 1) => {
    setMsg(null)
    setBlocksByCategory(prev => {
      const cur = prev[appendixCategory]
      const avail = APPENDIX_BLOCKS_BY_CATEGORY[appendixCategory]
      const ord = (cur.order ?? DEFAULT_THEME.blocks.order ?? []).slice()
      for (const k of avail) if (!ord.includes(k)) ord.push(k)
      const i = ord.indexOf(key), j = i + dir
      if (i < 0 || j < 0 || j >= ord.length) return prev
      ;[ord[i], ord[j]] = [ord[j], ord[i]]
      return { ...prev, [appendixCategory]: { ...cur, order: ord } }
    })
  }
  const setLogoSize = (mm: number) => { setMsg(null); setTheme(t => ({ ...t, header: { ...t.header, logoMaxHeightMm: mm } })) }
  const applyPreset = (p: StylePreset) => { setMsg(null); setTheme(t => ({
    ...t,
    brand:  { ...t.brand, accentColor: p.accentColor, primaryColor: p.accentColor, fontFamily: p.fontFamily },
    header: { ...t.header, logoPosition: p.logoPosition },
  })) }

  const accentInPalette = ACCENT_PALETTE.includes(theme.brand.accentColor.toLowerCase())

  const availableKeys = APPENDIX_BLOCKS_BY_CATEGORY[appendixCategory]
  const blockOrder = blocksByCategory[appendixCategory].order ?? DEFAULT_THEME.blocks.order ?? []
  const orderedKeys = availableKeys.slice().sort((a, b) => {
    const ia = blockOrder.indexOf(a), ib = blockOrder.indexOf(b)
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
  })

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

          {/* Stil-Vorlage (1-Klick-Look) */}
          <div className="admin-block">
            <h3 className="admin-block-title" style={{ display: 'inline-flex', alignItems: 'center' }}>
              Stil-Vorlage <HelpHint id="vorlagen.preset" />
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {STYLE_PRESETS.map(p => {
                const active = theme.brand.accentColor.toLowerCase() === p.accentColor.toLowerCase()
                  && theme.brand.fontFamily === p.fontFamily
                  && theme.header.logoPosition === p.logoPosition
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p)}
                    title={p.label}
                    style={{
                      padding: 5, borderRadius: 8, cursor: 'pointer', background: 'transparent',
                      border: active ? '2px solid var(--text-1)' : '1px solid #e5e7eb',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                    }}
                  >
                    <PresetThumb accent={p.accentColor} serif={FONT_GROUP[p.fontFamily] === 'serif'} logoPosition={p.logoPosition} />
                    <span style={{ fontSize: 12, fontWeight: active ? 700 : 500 }}>{p.label}</span>
                  </button>
                )
              })}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '8px 0 0' }}>
              Setzt Farbe, Schrift und Logo-Position auf einen Schlag — danach frei anpassbar.
            </p>
          </div>

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
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Größe:</span>
              {LOGO_SIZES.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setLogoSize(s.mm)}
                  className={(theme.header.logoMaxHeightMm ?? 20) === s.mm ? 'btn-small btn-save' : 'btn-small'}
                >
                  {s.label}
                </button>
              ))}
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
              {DOC_CATEGORIES.map(dt => (
                <button
                  key={dt}
                  type="button"
                  onClick={() => { setMsg(null); setAppendixCategory(dt) }}
                  className={appendixCategory === dt ? 'btn-small btn-save' : 'btn-small'}
                >
                  {DOC_CATEGORY_LABELS[dt]}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {orderedKeys.map((key, idx) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={blocksByCategory[appendixCategory][key] !== false}
                      onChange={e => setBlock(key, e.target.checked)}
                    />
                    {APPENDIX_LABEL[key]}
                  </label>
                  {orderedKeys.length > 1 && (
                    <span style={{ display: 'inline-flex', gap: 2 }}>
                      <button type="button" className="row-action-btn" disabled={idx === 0} onClick={() => moveBlock(key, -1)} title="Nach oben">
                        <ChevronUp size={14} strokeWidth={2} />
                      </button>
                      <button type="button" className="row-action-btn" disabled={idx === orderedKeys.length - 1} onClick={() => moveBlock(key, 1)} title="Nach unten">
                        <ChevronDown size={14} strokeWidth={2} />
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '10px 0 0' }}>
              Gilt für <strong>{DOC_CATEGORY_LABELS[appendixCategory]}</strong>. Reihenfolge per Pfeile. Anhänge erscheinen nur, wenn dafür auch Daten vorliegen (z. B. erfasste Stunden).
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
        <div style={{ flex: '1.3 1 360px', minWidth: 320 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Vorschau</span>
            {previewLoading && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>aktualisiert …</span>}
          </div>
          <div
            ref={previewWrapRef}
            style={{
              width: '100%', border: '1px solid var(--border)', borderRadius: 8,
              overflow: 'hidden', background: '#fff',
              height: Math.max(120, Math.round(previewContentH * previewScale)),
            }}
          >
            <iframe
              ref={previewIframeRef}
              title="Belegvorschau"
              srcDoc={previewHtml}
              scrolling="no"
              onLoad={handlePreviewLoad}
              style={{
                width: A4_PREVIEW_WIDTH, height: previewContentH, border: 'none', display: 'block',
                transform: `scale(${previewScale})`, transformOrigin: 'top left',
              }}
            />
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '6px 0 0', textAlign: 'center' }}>
            Maßstabsgetreue Vorschau (auf Fensterbreite verkleinert).
          </p>
        </div>

      </div>
    </div>
  )
}

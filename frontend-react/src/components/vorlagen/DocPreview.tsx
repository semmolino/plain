import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const A4_WIDTH = 794 // A4-Breite bei 96 dpi — gerendert wird darauf, angezeigt skaliert

/**
 * Vorschau eines Belegs: rendert am Server die echte Vorlage (kein Nachbau
 * im Browser) und zeigt sie maßstabsgetreu auf die verfügbare Breite
 * verkleinert. `requestKey` bestimmt, wann neu geladen wird — er sollte alles
 * enthalten, was die Vorschau verändert.
 */
export function DocPreview({ requestKey, load, label = 'Vorschau' }: {
  requestKey: string
  load:       () => Promise<string>
  label?:     string
}) {
  const [html, setHtml] = useState('')
  // geladen ist, was zum aktuellen Schlüssel gehört — sonst „aktualisiert …“
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== requestKey
  const [failed, setFailed] = useState(false)
  const [scale, setScale] = useState(0.5)
  const [contentH, setContentH] = useState(1123)
  const wrapRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const loadRef = useRef(load)
  useLayoutEffect(() => { loadRef.current = load })

  useEffect(() => {
    let cancelled = false
    const h = setTimeout(() => {
      loadRef.current()
        .then(r => { if (!cancelled) { setHtml(r); setFailed(false) } })
        .catch(() => { if (!cancelled) setFailed(true) })
        .finally(() => { if (!cancelled) setLoadedKey(requestKey) })
    }, 300)
    return () => { cancelled = true; clearTimeout(h) }
  }, [requestKey])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (w > 0) setScale(Math.min(1, w / A4_WIDTH))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function measure() {
    const doc = frameRef.current?.contentDocument
    if (doc) setContentH(doc.documentElement?.scrollHeight || doc.body?.scrollHeight || 1123)
  }

  return (
    <div className="dv-preview">
      <div className="dv-preview-head">
        <span>{label}</span>
        <span className="dv-preview-state" aria-live="polite">{loading ? 'aktualisiert …' : ''}</span>
      </div>
      {failed && <p className="dv-preview-error">Vorschau nicht verfügbar.</p>}
      <div ref={wrapRef} className="dv-preview-paper" style={{ height: Math.max(160, Math.round(contentH * scale)) }}>
        <iframe
          ref={frameRef}
          title={label}
          srcDoc={html}
          // Ohne Skripte: die Vorschau trägt Texte des Mandanten. `allow-same-origin`
          // allein ist harmlos und nötig, damit sich die Höhe messen lässt.
          sandbox="allow-same-origin"
          scrolling="no"
          onLoad={measure}
          style={{ width: A4_WIDTH, height: contentH, transform: `scale(${scale})` }}
        />
      </div>
      <p className="dv-preview-note">Maßstabsgetreu, auf die Breite verkleinert. Mit Beispieldaten.</p>
    </div>
  )
}

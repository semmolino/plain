import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiRequestError } from '@/api/client'

/**
 * Seitenansicht eines Belegs: rendert am Server das echte PDF und zeigt jede
 * Seite als Blatt — mit Seitenrändern, Fußzeile, Seitenumbrüchen, Briefpapier,
 * Falzmarken und Folgeseitenkopf.
 *
 * Bis 10/2026 zeigte die Vorschau das HTML des Belegs. Das ist randlos: die
 * Seitenränder setzt erst der PDF-Druck (`renderPdf`), Fußzeile, Briefpapier
 * und Folgeseitenkopf kommen erst danach dazu — die Vorschau lief bis an den
 * Rand und zeigte weniger als das PDF.
 *
 * `requestKey` bestimmt, wann neu geladen wird — er sollte alles enthalten,
 * was die Vorschau verändert.
 */

type PdfJs = typeof import('pdfjs-dist')

// pdf.js erst laden, wenn eine Vorschau gebraucht wird — es ist groß. Die
// Legacy-Fassung läuft auch in älteren Browsern (Safari auf älteren iPads).
let pdfJs: Promise<PdfJs> | null = null
function loadPdfJs(): Promise<PdfJs> {
  pdfJs ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default
    return lib
  }).catch(e => { pdfJs = null; throw e })
  return pdfJs
}

interface PageImage { url: string; width: number; height: number }

const MAX_PIXEL_WIDTH = 1800 // schärfer bringt am Bildschirm nichts, kostet aber Speicher

/** Rendert alle Seiten zu Bildern; Breite in Pixeln passend zur Anzeige. */
async function renderPages(data: ArrayBuffer, targetWidth: number, isCancelled: () => boolean): Promise<PageImage[]> {
  const lib = await loadPdfJs()
  const task = lib.getDocument({ data: new Uint8Array(data) })
  try {
    const doc = await task.promise
    const out: PageImage[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      if (isCancelled()) break
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(MAX_PIXEL_WIDTH, targetWidth) / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport }).promise
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'))
      page.cleanup()
      if (!blob) throw new Error('Seite ließ sich nicht darstellen.')
      // Seitenverhältnis aus dem PDF selbst (Punkte), nicht aus den Pixeln
      out.push({ url: URL.createObjectURL(blob), width: base.width, height: base.height })
    }
    return out
  } finally {
    void task.destroy()
  }
}

function revoke(pages: PageImage[]) {
  for (const p of pages) URL.revokeObjectURL(p.url)
}

export function DocPreview({ requestKey, load, label = 'Vorschau', note = 'Seitenansicht wie im PDF. Mit Beispieldaten.' }: {
  requestKey: string
  /** Liefert das PDF des Belegs */
  load:       () => Promise<ArrayBuffer>
  label?:     string
  note?:      string
}) {
  const [pages, setPages] = useState<PageImage[]>([])
  // geladen ist, was zum aktuellen Schlüssel gehört — sonst „aktualisiert …“
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== requestKey
  const [error, setError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const loadRef = useRef(load)
  useLayoutEffect(() => { loadRef.current = load })
  const pagesRef = useRef<PageImage[]>([])

  useEffect(() => {
    let cancelled = false
    // Jede Vorschau ist ein PDF-Druck am Server — erst rendern, wenn die
    // Eingabe zur Ruhe gekommen ist.
    const h = setTimeout(() => {
      const width = (wrapRef.current?.clientWidth || 600) * (window.devicePixelRatio || 1)
      loadRef.current()
        .then(data => renderPages(data, Math.max(800, width * 1.25), () => cancelled))
        .then(next => {
          if (cancelled) { revoke(next); return }
          // die bisherigen Seiten bleiben stehen, bis die neuen fertig sind — kein Flackern
          revoke(pagesRef.current)
          pagesRef.current = next
          setPages(next)
          setError(null)
        })
        .catch((e: unknown) => {
          if (cancelled) return
          setError(e instanceof ApiRequestError && e.status === 429
            ? 'Zu viele Vorschauen in kurzer Zeit — bitte einen Moment warten.'
            : 'Vorschau nicht verfügbar.')
        })
        .finally(() => { if (!cancelled) setLoadedKey(requestKey) })
    }, 450)
    return () => { cancelled = true; clearTimeout(h) }
  }, [requestKey])

  useEffect(() => () => revoke(pagesRef.current), [])

  const count = pages.length
  return (
    <div className="dv-preview">
      <div className="dv-preview-head">
        <span>{label}</span>
        <span className="dv-preview-state" aria-live="polite">
          {loading ? 'aktualisiert …' : count > 1 ? `${count} Seiten` : ''}
        </span>
      </div>
      {error && <p className="dv-preview-error" role="status">{error}</p>}
      <div
        ref={wrapRef}
        className="dv-preview-pages"
        // scrollt am Desktop in sich (s. globals.css) — dann per Tastatur erreichbar
        tabIndex={0}
        role="region"
        aria-label={label}
        aria-busy={loading}
      >
        {count === 0
          ? <div className="dv-preview-sheet dv-preview-sheet-empty" aria-hidden="true" />
          : pages.map((p, i) => (
            <figure key={p.url} className="dv-preview-page">
              <img className="dv-preview-sheet" style={{ aspectRatio: `${p.width} / ${p.height}` }} src={p.url} alt={count > 1 ? `${label}, Seite ${i + 1} von ${count}` : label} />
              {/* unter dem Blatt, nicht darauf — dort stünde sie auf der Fußzeile des Belegs */}
              {count > 1 && <figcaption className="dv-preview-pageno" aria-hidden="true">Seite {i + 1} von {count}</figcaption>}
            </figure>
          ))}
      </div>
      <p className="dv-preview-note">{note}</p>
    </div>
  )
}

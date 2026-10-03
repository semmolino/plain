import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
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
 * Gezeichnet wird nur, was zu sehen ist: jede Seite erst, wenn sie in den
 * sichtbaren Bereich kommt, direkt in ein Canvas. Die erste Fassung malte alle
 * Seiten und wandelte jede in ein PNG — bei einem Beleg mit Anhängen knapp drei
 * Sekunden, bevor überhaupt etwas zu sehen war.
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

interface Loaded {
  task:  PDFDocumentLoadingTask
  doc:   PDFDocumentProxy
  /** Seitenzahl und Maße der ersten Seite in Punkt — das Seitenverhältnis aller
   *  Blätter, bis sie gezeichnet sind (Belege sind A4; jede Seite einzeln
   *  abzufragen kostete je einen Umweg über den Worker) */
  count: number
  size:  { w: number; h: number }
}

async function openPdf(data: ArrayBuffer): Promise<Loaded> {
  const lib = await loadPdfJs()
  const task = lib.getDocument({ data: new Uint8Array(data) })
  try {
    const doc = await task.promise
    const vp = (await doc.getPage(1)).getViewport({ scale: 1 })
    return { task, doc, count: doc.numPages, size: { w: vp.width, h: vp.height } }
  } catch (e) {
    void task.destroy()
    throw e
  }
}

const MIN_PIXEL_WIDTH = 600
const MAX_PIXEL_WIDTH = 1600 // schärfer bringt am Bildschirm nichts, kostet aber Zeit

/** Eine Seite: zeichnet, sobald sie sichtbar ist, und bei jedem neuen PDF. */
function PdfPage({ doc, n, size, alt }: { doc: PDFDocumentProxy; n: number; size: { w: number; h: number }; alt: string }) {
  const sheetRef = useRef<HTMLDivElement>(null)
  // Seite 1 sofort; die übrigen, wenn sie in die Nähe des Bildschirms kommen
  // (ohne IntersectionObserver alle sofort)
  const [seen, setSeen] = useState(n === 1 || typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const el = sheetRef.current
    if (seen || !el) return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setSeen(true); io.disconnect() }
    }, { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])

  useEffect(() => {
    const el = sheetRef.current
    if (!seen || !el) return
    let cancelled = false
    let task: RenderTask | null = null
    void (async () => {
      try {
        const page = await doc.getPage(n)
        if (cancelled) return
        const width = Math.min(MAX_PIXEL_WIDTH, Math.max(MIN_PIXEL_WIDTH, el.clientWidth * (window.devicePixelRatio || 1)))
        const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width })
        // In ein neues Canvas zeichnen und erst dann tauschen — bis dahin
        // bleibt die bisherige Fassung stehen, nichts flackert.
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        task = page.render({ canvas, viewport })
        await task.promise
        if (!cancelled) el.replaceChildren(canvas)
      } catch {
        // abgebrochen (neues PDF) oder PDF schon geschlossen — die nächste Fassung zeichnet neu
      }
    })()
    return () => { cancelled = true; task?.cancel() }
  }, [doc, n, seen])

  return (
    <div ref={sheetRef} className="dv-preview-sheet" role="img" aria-label={alt}
      style={{ aspectRatio: `${size.w} / ${size.h}` }} />
  )
}

export function DocPreview({ requestKey, load, label = 'Vorschau', note = 'Seitenansicht wie im PDF. Mit Beispieldaten.' }: {
  requestKey: string
  /** Liefert das PDF des Belegs */
  load:       () => Promise<ArrayBuffer>
  label?:     string
  note?:      string
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  // geladen ist, was zum aktuellen Schlüssel gehört — sonst „aktualisiert …“
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== requestKey
  const [error, setError] = useState<string | null>(null)
  const loadRef = useRef(load)
  useLayoutEffect(() => { loadRef.current = load })

  useEffect(() => {
    let cancelled = false
    // Jede Vorschau ist ein PDF-Druck am Server — erst anfragen, wenn die
    // Eingabe kurz ruht.
    const h = setTimeout(() => {
      loadRef.current()
        .then(openPdf)
        .then(next => {
          if (cancelled) { void next.task.destroy(); return }
          setLoaded(next)
          setError(null)
        })
        .catch((e: unknown) => {
          if (cancelled) return
          setError(e instanceof ApiRequestError && e.status === 429
            ? 'Zu viele Vorschauen in kurzer Zeit — bitte einen Moment warten.'
            : 'Vorschau nicht verfügbar.')
        })
        .finally(() => { if (!cancelled) setLoadedKey(requestKey) })
    }, 300)
    return () => { cancelled = true; clearTimeout(h) }
  }, [requestKey])

  // Ein abgelöstes PDF schließen — die Seiten haben ihre Bilder schon
  useEffect(() => () => { if (loaded) void loaded.task.destroy() }, [loaded])

  const count = loaded?.count ?? 0
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
        className="dv-preview-pages"
        // scrollt am Desktop in sich (s. globals.css) — dann per Tastatur erreichbar
        tabIndex={0}
        role="region"
        aria-label={label}
        aria-busy={loading}
      >
        {!loaded
          ? <div className="dv-preview-sheet dv-preview-sheet-empty" aria-hidden="true" />
          : Array.from({ length: count }, (_, i) => (
            <figure key={i} className="dv-preview-page">
              <PdfPage doc={loaded.doc} n={i + 1} size={loaded.size} alt={count > 1 ? `${label}, Seite ${i + 1} von ${count}` : label} />
              {/* unter dem Blatt, nicht darauf — dort stünde sie auf der Fußzeile des Belegs */}
              {count > 1 && <figcaption className="dv-preview-pageno" aria-hidden="true">Seite {i + 1} von {count}</figcaption>}
            </figure>
          ))}
      </div>
      <p className="dv-preview-note">{note}</p>
    </div>
  )
}

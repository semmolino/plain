import { createRequire } from 'node:module'
import type { Page, Route } from '@playwright/test'

/**
 * Einstellungen → Dokumentvorlagen: Branding, Katalog, Standardtexte und
 * Textbausteine mit Zustand — was gespeichert wird, kommt beim nächsten
 * Laden zurück.
 *
 * Der Katalog ist die Ausgabe des Servers selbst (documentLayout.documentCatalog),
 * keine Kopie: ein neuer Baustein oder Platzhalter landet ohne Pflege hier.
 */
const require = createRequire(import.meta.url)
export const CATALOG = require('../../../backend/services/documentLayout.js').documentCatalog()

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

export interface DvState {
  theme:     Record<string, unknown>
  puts:      Record<string, unknown>[]
  previews:  { theme_json: Record<string, unknown>; category: string }[]
  texts:     Record<string, { headerText: string | null; footerText: string | null }>
  textPuts:  { type: string; body: Record<string, unknown> }[]
  snippets:  Record<string, unknown>[]
  snippetCalls: { method: string; url: string; body: Record<string, unknown> | null }[]
  uploads:   string[]
  pdfPreviews: Record<string, unknown>[]
}

export async function mockDokumentvorlagen(page: Page, init: Partial<Pick<DvState, 'theme' | 'texts' | 'snippets'>> = {}): Promise<DvState> {
  const state: DvState = {
    theme: init.theme ?? {
      version: 2, brand: { primaryColor: '#111827', accentColor: '#111827', fontFamily: 'system-sans', fontScale: 1 },
      header: { showLogo: true, logoMaxHeightMm: 20, logoPosition: 'right', showBauvorhaben: true }, blocks: {},
    },
    puts: [], previews: [], textPuts: [], snippetCalls: [], uploads: [], pdfPreviews: [],
    texts: init.texts ?? {},
    snippets: init.snippets ?? [],
  }
  let nextId = 100
  const r = (re: string, h: (route: Route) => unknown) => page.route(new RegExp(`/api/v1/${re}(\\?|$)`), h)

  await r('document-templates/catalog', route => route.fulfill(json({ data: CATALOG })))
  await r('document-templates/branding', route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON()
      state.puts.push(body)
      state.theme = { ...body.theme_json, blocksByCategory: body.blocks_by_category }
      return route.fulfill(json({ data: { ok: true } }))
    }
    return route.fulfill(json({ data: { theme: state.theme, blocksByCategory: state.theme.blocksByCategory ?? {}, companyId: 1 } }))
  })
  await r('document-templates/preview/pdf', route => {
    state.pdfPreviews.push(route.request().postDataJSON())
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.7\n%%EOF' })
  })
  await r('assets/upload', route => {
    state.uploads.push(route.request().postData() ?? '')
    return route.fulfill(json({ data: { ID: 77 }, url: '/assets/77' }))
  })
  await r('document-templates/preview', route => {
    state.previews.push(route.request().postDataJSON())
    return route.fulfill(json({ html: '<p>Vorschau</p>' }))
  })
  await r('mahnungen/text-templates(/[a-z_]+)?', route => {
    const req = route.request()
    if (req.method() === 'PUT') {
      const type = req.url().split('/').pop()!.split('?')[0]
      const body = req.postDataJSON()
      state.textPuts.push({ type, body })
      state.texts[type] = { headerText: body.headerText, footerText: body.footerText }
      return route.fulfill(json({ ok: true }))
    }
    return route.fulfill(json({ data: Object.entries(state.texts).map(([documentType, t]) => ({ documentType, ...t })) }))
  })
  await r('document-texts(/\\d+)?', route => {
    const req = route.request()
    const m = req.method()
    const body = m === 'GET' || m === 'DELETE' ? null : req.postDataJSON()
    state.snippetCalls.push({ method: m, url: req.url(), body })
    const id = Number(req.url().match(/document-texts\/(\d+)/)?.[1])
    if (m === 'POST') {
      const row = { id: nextId++, sortOrder: 0, category: null, position: 'free', ...body }
      state.snippets.push(row)
      return route.fulfill(json({ data: row }, 201))
    }
    if (m === 'PATCH') {
      state.snippets = state.snippets.map(s => (s.id === id ? { ...s, ...body } : s))
      return route.fulfill(json({ data: state.snippets.find(s => s.id === id) }))
    }
    if (m === 'DELETE') {
      state.snippets = state.snippets.filter(s => s.id !== id)
      return route.fulfill(json({ data: { ok: true } }))
    }
    return route.fulfill(json({ data: state.snippets }))
  })
  await r('stammdaten/companies', route => route.fulfill(json({ data: [{ ID: 1, COMPANY_NAME_1: 'Messina Architekten GmbH' }] })))
  await r('stammdaten/companies/\\d+/assets', route => route.fulfill(json({ data: { logo_asset_id: null, logo_data_uri: null } })))
  return state
}

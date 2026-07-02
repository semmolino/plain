/**
 * Client-seitige Export-Helfer (CSV / vCard / Datei-Download).
 *
 * Bewusst ohne Backend: die Listen liegen bereits vollständig im Client vor
 * (Tanstack-Query-Cache), also reicht ein Blob-Download. CSV nutzt `;` als
 * Trenner und ein UTF-8-BOM, damit deutsches Excel Umlaute korrekt anzeigt.
 */

type CsvCell = string | number | null | undefined

function csvEscape(v: CsvCell): string {
  const s = v == null ? '' : String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  const sep = ';'
  const lines = [headers.map(csvEscape).join(sep), ...rows.map(r => r.map(csvEscape).join(sep))]
  const content = '﻿' + lines.join('\r\n') // BOM → Excel erkennt UTF-8
  triggerDownload(new Blob([content], { type: 'text/csv;charset=utf-8;' }), filename)
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  triggerDownload(new Blob([text], { type: `${mime};charset=utf-8;` }), filename)
}

interface VCardInput {
  FIRST_NAME: string
  LAST_NAME: string
  TITLE?: string | null
  POSITION?: string | null
  EMAIL?: string | null
  MOBILE?: string | null
  PHONE?: string | null
  ADDRESS?: string | null
}

/** Erzeugt einen vCard-3.0-String für einen Kontakt. */
export function contactVCard(c: VCardInput): string {
  const esc = (s: string) => s.replace(/([,;\\])/g, '\\$1')
  const full = `${c.FIRST_NAME || ''} ${c.LAST_NAME || ''}`.trim()
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${esc(c.LAST_NAME || '')};${esc(c.FIRST_NAME || '')};;${esc(c.TITLE || '')};`,
    `FN:${esc(full)}`,
  ]
  if (c.ADDRESS)  lines.push(`ORG:${esc(c.ADDRESS)}`)
  if (c.POSITION) lines.push(`TITLE:${esc(c.POSITION)}`)
  if (c.EMAIL)    lines.push(`EMAIL;TYPE=INTERNET:${c.EMAIL}`)
  if (c.MOBILE)   lines.push(`TEL;TYPE=CELL:${c.MOBILE}`)
  if (c.PHONE)    lines.push(`TEL;TYPE=WORK,VOICE:${c.PHONE}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

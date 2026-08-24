/**
 * Reine Hilfsfunktionen rund um Vorbelegungen (Einstellungen → Vorbelegungen).
 *
 * Bewusst ohne React-Bezug, damit sie in `vorbelegung.test.ts` direkt geprüft
 * werden können — die Regeln (Nummernfortschreibung, Anrede aus Geschlecht,
 * Fristberechnung) sind fachlich und nicht am Formular festzumachen.
 */

/** Heutiges Datum als ISO-String in der Zeitzone des Nutzers. */
export function todayIso(): string {
  return isoOf(new Date())
}

/**
 * Datum plus Kalendertage als ISO-String.
 * Gibt '' zurück, wenn kein oder kein lesbares Datum übergeben wurde.
 */
export function addDaysIso(isoDate: string, days: number): string {
  if (!isoDate) return ''
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + days)
  return isoOf(d)
}

// toISOString() rechnet nach UTC um und liegt östlich von Greenwich nachts
// einen Tag daneben — deshalb aus den lokalen Datumsteilen gebaut.
function isoOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Prüft eine Vorbelegung gegen die tatsächlich vorhandene Auswahlliste.
 * Gibt '' zurück, wenn der gespeicherte Wert gelöscht wurde — sonst stünde im
 * Formular eine ID, zu der es keinen Eintrag mehr gibt.
 */
export function presetId(list: { ID: number | string }[], preset: string | null | undefined): string {
  return preset && list.some(x => String(x.ID) === String(preset)) ? String(preset) : ''
}

/**
 * Nächste freie Personalnummer aus den vorhandenen Nummern.
 *
 * Präfix und Nullauffüllung der höchsten bestehenden Nummer werden übernommen
 * ("MA-007" → "MA-008"), damit der Vorschlag zum geführten Schema passt. Ohne
 * verwertbare Nummer beginnt die Zählung bei 1.
 */
export function nextPersonnelNumber(numbers: (string | null | undefined)[]): string {
  let best: { prefix: string; value: number; width: number } | null = null
  for (const raw of numbers) {
    const m = /^(.*?)(\d+)$/.exec(String(raw ?? '').trim())
    if (!m) continue
    const value = parseInt(m[2], 10)
    if (!Number.isFinite(value)) continue
    if (!best || value > best.value) best = { prefix: m[1], value, width: m[2].length }
  }
  if (!best) return '1'
  const next = String(best.value + 1)
  return best.prefix + (next.length >= best.width ? next : next.padStart(best.width, '0'))
}

/**
 * Leitet die Anrede aus dem gewählten Geschlecht ab.
 *
 * Beide Listen sind mandantenübergreifende Stammdaten („männlich/weiblich/
 * divers" bzw. „Sehr geehrter Herr / Sehr geehrte Frau / Sehr geehrte/r").
 * Gematcht wird über den Text statt über feste IDs, damit ergänzte Einträge
 * weiter greifen. Rückgabe '' = keine passende Anrede gefunden.
 */
export function salutationForGender(
  genderId:    string | number,
  genders:     { ID: number | string; GENDER: string }[],
  salutations: { ID: number | string; SALUTATION: string }[],
): string {
  const g = genders.find(x => String(x.ID) === String(genderId))
  const t = (g?.GENDER ?? '').trim().toLowerCase()
  if (!t) return ''
  const find = (pred: (s: string) => boolean) =>
    salutations.find(s => pred((s.SALUTATION ?? '').toLowerCase()))
  const hit =
    t.startsWith('m') ? find(s => s.includes('herr'))
    : t.startsWith('w') || t.startsWith('f') ? find(s => s.includes('frau'))
    : find(s => !s.includes('herr') && !s.includes('frau'))
  return hit ? String(hit.ID) : ''
}

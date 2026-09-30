/**
 * Punktfarbe eines Status-Schilds (Design „Testversion 1").
 *
 * Projekt- und Angebotsstatus kommen aus globalen Katalogen
 * (PROJECT_STATUS, OFFER_STATUS) ohne Farbspalte, und ihre Namen stehen in der
 * Datenbank — nicht im Code. Die Farbe des Punkts wird deshalb aus dem Namen
 * abgeleitet; was nicht erkannt wird, bekommt den neutralen grauen Punkt.
 *
 * Rein optisch: das Wort im Schild traegt die Bedeutung, der Punkt ist nur
 * der zweite Kanal (WCAG 1.4.1). Die Farben stehen als --ps-status-* in
 * globals.css, der Selektor ist `[data-tone="…"]`.
 */
export type StatusTone = 'aktiv' | 'angeboten' | 'ruhend' | 'abgeschlossen' | 'ueber'

const RULES: [RegExp, StatusTone][] = [
  [/abgelehnt|abgebrochen|storn|verloren|gek(ü|ue)ndigt/i, 'ueber'],
  [/abgeschlossen|beauftragt|erledigt|fertig|bezahlt|gebucht|archiv/i, 'abgeschlossen'],
  [/pausiert|ruh|gestoppt|inaktiv|zur(ü|ue)ckgestellt/i, 'ruhend'],
  [/angebot|versendet|angefragt|verhandlung/i, 'angeboten'],
  [/lauf|aktiv|bearbeitung|in arbeit|entwurf|offen|neu/i, 'aktiv'],
]

export function statusTone(name: string | null | undefined): StatusTone {
  if (!name) return 'ruhend'
  for (const [re, tone] of RULES) if (re.test(name)) return tone
  return 'ruhend'
}

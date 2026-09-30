import { describe, it, expect } from 'vitest'
import { statusTone } from './statusTone'

describe('statusTone', () => {
  it('erkennt die ueblichen Projektstatus', () => {
    expect(statusTone('Laufend')).toBe('aktiv')
    expect(statusTone('Angebot')).toBe('angeboten')
    expect(statusTone('Pausiert')).toBe('ruhend')
    expect(statusTone('Abgeschlossen')).toBe('abgeschlossen')
  })

  it('erkennt die Angebotsstatus', () => {
    expect(statusTone('In Bearbeitung')).toBe('aktiv')
    expect(statusTone('Entwurf')).toBe('aktiv')
    expect(statusTone('Versendet')).toBe('angeboten')
    expect(statusTone('Beauftragt')).toBe('abgeschlossen')
    expect(statusTone('Abgelehnt')).toBe('ueber')
    expect(statusTone('Abgebrochen')).toBe('ueber')
  })

  // „Abgeschlossen" enthaelt kein „lauf", aber „Abgelehnt" darf nicht als
  // abgeschlossen durchgehen — die Reihenfolge der Regeln ist die Aussage.
  it('prueft Ablehnung vor Abschluss', () => {
    expect(statusTone('Nicht beauftragt – abgelehnt')).toBe('ueber')
  })

  it('faellt fuer Unbekanntes und Leeres auf den neutralen Punkt zurueck', () => {
    expect(statusTone('Irgendwas')).toBe('ruhend')
    expect(statusTone('')).toBe('ruhend')
    expect(statusTone(null)).toBe('ruhend')
    expect(statusTone(undefined)).toBe('ruhend')
  })
})

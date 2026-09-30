import { useEffect, useState } from 'react'
import type { AddressContactOption } from '@/api/stammdaten'

/**
 * Kontakt vorbelegen, sobald eine Adresse gewählt wird (UI-Pilot Runde 9).
 *
 * Vorher musste man in Projekt, Angebot und Vertrag nach jeder Adresse den
 * Kontakt selbst aus der Liste holen — auch wenn die Adresse einen
 * Hauptansprechpartner hat oder überhaupt nur einen Kontakt. Vorbelegt wird
 * nur nach einer Auswahl im Adressfeld (`arm`), nie beim Laden eines
 * gespeicherten Stands: ein bewusst leerer Kontakt bleibt leer.
 */

export interface ContactPreset { id: number; primary: boolean }

/** Hauptansprechpartner, sonst der einzige Kontakt, sonst keiner. */
export function presetContact(contacts: AddressContactOption[]): ContactPreset | null {
  const primary = contacts.find(c => Number(c.IS_PRIMARY) === 1)
  if (primary) return { id: primary.ID, primary: true }
  return contacts.length === 1 ? { id: contacts[0].ID, primary: false } : null
}

/** Hinweis unter dem Feld, solange der vorbelegte Kontakt gewählt ist. */
export function presetNote(preset: ContactPreset | null, value: number | string | null | undefined): string | null {
  if (!preset || value == null || value === '' || String(value) !== String(preset.id)) return null
  return preset.primary ? 'Vorbelegt: Hauptansprechpartner der Adresse.' : 'Vorbelegt: einziger Kontakt der Adresse.'
}

/**
 * @param addressId aktuell gewählte Adresse
 * @param contacts  deren Kontakte — `undefined`, solange sie laden
 * @param apply     setzt den Kontakt im Formular
 */
export function useContactPreset(
  addressId: number | null,
  contacts: AddressContactOption[] | undefined,
  apply: (contactId: number) => void,
) {
  const [armed, setArmed] = useState<number | null>(null)
  const [preset, setPreset] = useState<ContactPreset | null>(null)

  useEffect(() => {
    if (armed == null || armed !== addressId || !contacts) return
    setArmed(null)
    const p = presetContact(contacts)
    setPreset(p)
    if (p) apply(p.id)
  }, [armed, addressId, contacts, apply])

  return {
    /** Nach der Auswahl einer Adresse aufrufen. */
    arm: (id: number | null) => { setArmed(id); setPreset(null) },
    preset,
  }
}

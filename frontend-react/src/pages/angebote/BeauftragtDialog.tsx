import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  convertOffer, fetchOfferStatuses, fetchOfferStructure, updateOffer,
  type ConvertOfferPayload,
} from '@/api/angebote'
import { PROJECT_GROUP_QUERY_KEYS } from '@/api/gesamtprojekte'
import { BeauftragtModal } from './BeauftragtModal'

/**
 * „Als beauftragt markieren" samt Umwandlung in ein Projekt — aus der
 * Angebotsliste herausgezogen, damit der Kopf des Angebots-Arbeitsbereichs
 * denselben Ablauf benutzt statt einer zweiten Kopie der beiden Aufrufe.
 */
export function BeauftragtDialog({ offer, onClose, onDone }: {
  offer:   { ID: number; ABBR: string | null; NAME: string; EMPLOYEE_ID?: number | null } | null
  onClose: () => void
  onDone:  (message: string) => void
}) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const oid = offer?.ID ?? null

  const { data: statusData } = useQuery({ queryKey: ['offer-statuses'], queryFn: fetchOfferStatuses })
  const beauftragtId = statusData?.data?.find(s => s.ABBR === 'Beauftragt')?.ID ?? null
  const { data: structData } = useQuery({
    queryKey: ['offer-structure', oid],
    queryFn:  () => fetchOfferStructure(oid!),
    enabled:  oid !== null,
  })

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['offers'] })
    void qc.invalidateQueries({ queryKey: ['offer', oid] })
    void qc.invalidateQueries({ queryKey: ['offer-detail', oid] })
    // Das neue Projekt kann in einem Gesamtprojekt gelandet sein.
    for (const k of PROJECT_GROUP_QUERY_KEYS) void qc.invalidateQueries({ queryKey: [...k] })
  }

  const convertMut = useMutation({
    mutationFn: (body: ConvertOfferPayload) => convertOffer(oid!, body),
    onSuccess: (res) => { setError(null); refresh(); onDone(`Projekt ${res.data.projectName} wurde angelegt`) },
    onError: (e: Error) => setError(e.message),
  })
  const markOrderedMut = useMutation({
    mutationFn: (body: { order_date: string; project_id?: number | null }) =>
      updateOffer(oid!, {
        order_date: body.order_date,
        project_id: body.project_id ?? null,
        ...(beauftragtId ? { offer_status_id: beauftragtId } : {}),
      }),
    onSuccess: () => { setError(null); refresh(); onDone('Angebot als beauftragt markiert') },
    onError: (e: Error) => setError(e.message),
  })

  if (!offer) return null
  return (
    <BeauftragtModal
      open
      offerName={offer.ABBR ?? offer.NAME}
      structNodes={structData?.data ?? []}
      presetManagerId={offer.EMPLOYEE_ID ?? null}
      onConvert={body => convertMut.mutate(body)}
      onMarkOrdered={body => markOrderedMut.mutate(body)}
      onClose={() => { setError(null); onClose() }}
      isPending={convertMut.isPending || markOrderedMut.isPending}
      error={error}
    />
  )
}

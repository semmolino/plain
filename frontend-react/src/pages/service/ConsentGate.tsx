import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { fetchConsent, acceptConsent } from '@/api/service'

/**
 * Zugangs-Gate für den gesamten Service-Bereich.
 *
 * Vor der ersten Nutzung (bzw. nach Versionswechsel des Hinweistexts) muss der
 * Anwender den Haftungs-/Nutzungshinweis bestätigen. Ohne Bestätigung werden die
 * Inhalte (children) nicht gerendert. Siehe docs/SERVICE_AREA_CONCEPT.md §9.
 *
 * Hinweis: Der Text ist eine Nutzungsbedingung (keine DSGVO-Einwilligung) und
 * darf daher für alle Anwender verpflichtend sein. Formulierungen sind Entwürfe
 * und vor Produktivnahme anwaltlich zu prüfen.
 */
export function ConsentGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [checked, setChecked] = useState(false)

  const consentQuery = useQuery({
    queryKey: ['service', 'consent'],
    queryFn: () => fetchConsent(),
    staleTime: 1000 * 60 * 30,
  })

  const accept = useMutation({
    mutationFn: () => acceptConsent(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service', 'consent'] }),
  })

  if (consentQuery.isLoading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Laden …</div>
  }

  if (consentQuery.data?.accepted) {
    return <>{children}</>
  }

  return (
    <div className="consent-gate">
      <div className="consent-card">
        <div className="consent-head">
          <ShieldCheck size={20} strokeWidth={1.75} />
          <h2>Nutzungsbedingungen &amp; Haftungshinweis</h2>
        </div>

        <p className="consent-intro">
          Im Service-Bereich (Vorschläge, Feedback &amp; Kontakt, Unterstützung) können Sie Texte,
          Screenshots und Dateien an plan&amp;simple übermitteln. Bitte beachten Sie:
        </p>

        <ol className="consent-list">
          <li>
            <strong>Eigenverantwortung.</strong> Sie entscheiden selbst, welche Inhalte Sie eingeben oder
            hochladen. Geben Sie nur Informationen an, die zur Beschreibung Ihres Anliegens erforderlich sind.
          </li>
          <li>
            <strong>Keine Daten Dritter.</strong> Übermitteln Sie keine personenbezogenen Daten Dritter
            (z. B. Namen, Kontaktdaten oder Adressen Ihrer Kundinnen, Mitarbeitenden oder Geschäftspartner)
            und keine vertraulichen Geschäftsdaten. Schwärzen oder anonymisieren Sie Screenshots vor dem
            Hochladen.
          </li>
          <li>
            <strong>Sichtbarkeit im Vorschlagsportal.</strong> Inhalte, die Sie unter „Vorschläge für
            Funktionen" einreichen, können — nach Prüfung und ggf. Bearbeitung durch plan&amp;simple — für
            andere Anwenderinnen und Anwender sichtbar gemacht werden. <strong>Ihr Name, Ihre E-Mail-Adresse
            und Ihre Organisation werden dabei nicht angezeigt.</strong>
          </li>
          <li>
            <strong>Haftung.</strong> Für Inhalte, die Sie entgegen den vorstehenden Hinweisen übermitteln,
            übernimmt plan&amp;simple keine Haftung. Im gesetzlich zulässigen Rahmen stellen Sie plan&amp;simple
            von Ansprüchen Dritter frei, die auf einer von Ihnen zu vertretenden, unzulässigen Übermittlung
            personenbezogener oder vertraulicher Daten beruhen.
          </li>
          <li>
            <strong>Datenschutz.</strong> Die Verarbeitung Ihrer Eingaben erfolgt gemäß unserer
            Datenschutzerklärung. Sie können die Löschung der von Ihnen übermittelten Inhalte verlangen,
            soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen.
          </li>
        </ol>

        <label className="consent-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>
            Ich habe die Nutzungsbedingungen und Haftungshinweise gelesen und akzeptiere sie. Mir ist
            bewusst, dass ich für die von mir übermittelten Inhalte selbst verantwortlich bin.
          </span>
        </label>

        {accept.isError && (
          <p className="consent-error">Die Bestätigung konnte nicht gespeichert werden. Bitte erneut versuchen.</p>
        )}

        <div className="consent-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!checked || accept.isPending}
            onClick={() => accept.mutate()}
          >
            {accept.isPending ? 'Wird gespeichert …' : 'Akzeptieren und fortfahren'}
          </button>
        </div>
      </div>
    </div>
  )
}

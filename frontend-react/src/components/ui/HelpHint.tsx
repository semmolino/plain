import { InfoHint } from './InfoHint'
import { HELP, type HelpId } from '@/help/helpContent'

/**
 * HelpHint — Tooltip aus der zentralen Hilfe-Registry (helpContent).
 *
 * Bevorzugt vor inline-<InfoHint> verwenden, wo derselbe Begriff mehrfach
 * vorkommt oder das Wording zentral gepflegt werden soll:
 *
 *   <HelpHint id="report.deckungsbeitrag" />
 *
 * Für rein lokale, einmalige Erklärungen bleibt <InfoHint> (freier Text) ok.
 */
export function HelpHint({
  id,
  align = 'left',
  size = 14,
}: {
  id: HelpId
  align?: 'left' | 'right'
  size?: number
}) {
  const entry = HELP[id]
  if (!entry) return null
  return (
    <InfoHint title={entry.title} align={align} size={size}>
      {entry.body}
    </InfoHint>
  )
}

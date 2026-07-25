import { HelpHint } from '@/components/ui/HelpHint'
import { NachtraegeListe } from '@/pages/nachtraege/NachtraegeListe'

export function NachtraegePage() {
  return (
    <div className="master-page">
      <h1 className="master-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        Nachträge <HelpHint id="nachtrag.overview" />
      </h1>
      <NachtraegeListe />
    </div>
  )
}

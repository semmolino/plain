import { type ReactNode } from 'react'
import { useLicenseStore } from '@/store/licenseStore'

interface Props {
  /** Erforderliche Lizenz-Capability (z.B. "einvoice.peppol"). */
  feature: string
  /** Fallback, wenn die Capability nicht lizenziert ist. Default: nichts rendern. */
  fallback?: ReactNode
  children: ReactNode
}

/**
 * <HasFeature feature="einvoice.peppol">…</HasFeature>
 * <HasFeature feature="reports.advanced" fallback={<UpgradeHint plan="Pro" />}>…</HasFeature>
 *
 * L2 (Soft-Gating): blendet Inhalte aus, wenn der Tenant die Capability nicht
 * hat. unrestricted=true (Soft-Fail / Lizenz nicht aktiv) -> immer anzeigen.
 * Sicherheit kommt serverseitig (L3, requireFeature). Kombinierbar mit <Can>.
 */
export function HasFeature({ feature, fallback = null, children }: Props) {
  const unrestricted = useLicenseStore(s => s.unrestricted)
  const capabilities = useLicenseStore(s => s.capabilities)
  const granted = unrestricted || capabilities.has(feature)
  return <>{granted ? children : fallback}</>
}

/** Kleiner Hinweis, dass eine Funktion einen höheren Tarif erfordert. */
export function UpgradeHint({ plan, text }: { plan?: string; text?: string }) {
  return (
    <div
      role="note"
      style={{
        fontSize: 13,
        color: '#92400e',
        background: '#fffbeb',
        border: '1px solid #fde68a',
        borderRadius: 8,
        padding: '8px 12px',
      }}
    >
      {text || `Diese Funktion ist in deinem Tarif nicht enthalten${plan ? ` — verfügbar ab „${plan}".` : '.'}`}
    </div>
  )
}

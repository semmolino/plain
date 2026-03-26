interface Tab { id: string; label: string }

interface Props {
  tabs:     Tab[]
  active:   string
  onChange: (id: string) => void
}

export function Tabs({ tabs, active, onChange }: Props) {
  return (
    <div className="tabs">
      {tabs.map(t => (
        <button
          key={t.id}
          className={'tab-btn' + (active === t.id ? ' active' : '')}
          onClick={() => onChange(t.id)}
          type="button"
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

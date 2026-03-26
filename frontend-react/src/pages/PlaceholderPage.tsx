interface Props { title: string }

export function PlaceholderPage({ title }: Props) {
  return (
    <div className="placeholder-page">
      <h1>{title}</h1>
      <p>Kommt in einer der nächsten Phasen.</p>
    </div>
  )
}

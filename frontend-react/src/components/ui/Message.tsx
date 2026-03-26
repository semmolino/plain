interface MessageProps {
  text: string | null
  type?: 'success' | 'error' | 'info'
}

export function Message({ text, type = 'info' }: MessageProps) {
  if (!text) return null
  return <p className={`message ${type}`}>{text}</p>
}

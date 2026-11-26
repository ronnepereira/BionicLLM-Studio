/** Local time of the original message, stable while a response streams. */
export function MessageTimestamp({ timestamp }: { timestamp: number }) {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return null
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })
  const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  return <time dateTime={date.toISOString()} className="px-1 text-[11px] text-gray-500 whitespace-nowrap">({time} - {day})</time>
}

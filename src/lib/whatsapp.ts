export function parseWhatsappChats(input: string): string[] {
  const parts = input.trim().split(/[\s,;]+/)
  if (!input.trim() || parts.length > 50) throw new Error('Informe de 1 a 50 números ou IDs de grupo do WhatsApp.')
  const chats = parts.map(part => {
    const value = part.startsWith('+') ? part.slice(1) : part
    if (/^[1-9]\d{6,14}$/.test(value)) return `${value}@s.whatsapp.net`
    if (/^[1-9]\d{6,14}@s\.whatsapp\.net$/.test(value) || /^\d{5,22}(?:-\d{1,16})?@g\.us$/.test(value)) return value
    throw new Error('Use números completos com código do país, sem espaços, ou IDs de grupo terminados em @g.us.')
  })
  return [...new Set(chats)]
}
export function parseMetaChats(input: string): string[] {
  const chats = parseWhatsappChats(input)
  if (chats.some(chat => !chat.endsWith('@s.whatsapp.net'))) throw new Error('O WhatsApp oficial desta integração aceita somente números individuais completos, sem grupos.')
  return chats
}

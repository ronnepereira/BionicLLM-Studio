/** The native host also checks these boundaries. No status/broadcast/newsletter or arbitrary JID. */
export function validChat(jid) {
  return typeof jid === 'string' && (/^[1-9]\d{6,14}@s\.whatsapp\.net$/.test(jid) || /^\d{5,22}(?:-\d{1,16})?@g\.us$/.test(jid))
}
export function textEvent(message, type, allowed, since) {
  const jid = message?.key?.remoteJid?.endsWith('@lid') ? message.key.remoteJidAlt : message?.key?.remoteJid
  if (type !== 'notify' || message?.key?.fromMe !== false || !validChat(jid) || !allowed.has(jid)) return null
  if (typeof message.key.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(message.key.id)) return null
  const date = Number(message.messageTimestamp)
  if (!Number.isSafeInteger(date) || date < since) return null
  // Wrappers, edits, polls, media, view-once and protocol messages are intentionally not unwrapped.
  const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text
  if (typeof text !== 'string' || !text.trim() || [...text].length > 6000 || text.includes('\0')) return null
  return { chat_id: jid, remote_id: message.key.id, text, timestamp: date }
}
export function sending(command, allowed, receiving) {
  if (!receiving || !validChat(command.chat_id) || !allowed.has(command.chat_id) || typeof command.text !== 'string'
    || !command.text.trim() || command.text.length > 4000 || command.text.includes('\0')) throw new Error('Send refused')
  return { text: command.text, linkPreview: null }
}

/** Monotonic generations prevent delayed commands from reactivating a stopped receiver. */
export class ReceiverGate {
  generation = 0
  session = ''
  allowed = new Set()
  since = 0
  active = false
  start(value) {
    if (!Array.isArray(value.chats) || !value.chats.length || value.chats.length > 50 || !value.chats.every(validChat)
      || !Number.isSafeInteger(value.since) || !Number.isSafeInteger(value.generation) || value.generation <= this.generation
      || typeof value.session_id !== 'string' || !value.session_id) throw new Error('Invalid receiver')
    this.allowed = new Set(value.chats); this.since = value.since; this.generation = value.generation; this.session = value.session_id; this.active = true
  }
  pause(generation) {
    if (Number.isSafeInteger(generation) && generation >= this.generation) { this.generation = generation; this.stop() }
  }
  stop() { this.active = false; this.allowed.clear(); this.session = '' }
  event(message, type) { return this.active ? textEvent(message, type, this.allowed, this.since) : null }
  payload(command) {
    if (command.session_id !== this.session) throw new Error('Stale receiver')
    return sending(command, this.allowed, this.active)
  }
}

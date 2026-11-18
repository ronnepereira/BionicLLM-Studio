import { makeWASocket, DisconnectReason, Browsers, jidNormalizedUser } from '@whiskeysockets/baileys'
import pino from 'pino'
import { encryptedAuth } from './auth.mjs'
import { ReceiverGate } from './protocol.mjs'
import { readFileSync } from 'node:fs'

// stdout is a bounded JSON-lines protocol; never print library diagnostics, keys or raw errors.
const write = value => {
  if (process.stdout.writableLength > 1024 * 1024) process.exit(1)
  process.stdout.write(`${JSON.stringify(value)}\n`)
}
console.log = console.info = console.warn = console.error = console.debug = console.trace = () => {}
if (process.argv[2] === '--check') {
  const installed = JSON.parse(readFileSync(new URL('./node_modules/@whiskeysockets/baileys/package.json', import.meta.url)))
  write({ ready: installed.version === '7.0.0-rc13', version: installed.version }); process.exit(installed.version === '7.0.0-rc13' ? 0 : 1)
}
let socket, auth, stopping = false, restarts = 0
const receiver = new ReceiverGate()
const logger = pino({ level: 'silent' })
const status = (phase, extra = {}) => write({ type: 'state', phase, ...extra })
function connect() {
  if (stopping) return
  socket = makeWASocket({ auth: auth.state, logger, browser: Browsers.appropriate('BionicLLM Studio'),
    syncFullHistory: false, shouldSyncHistoryMessage: () => false, markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false, getMessage: async () => undefined })
  const current = socket
  current.ev.on('creds.update', () => { try { auth.save() } catch { fatal() } })
  current.ev.on('connection.update', update => {
    if (current !== socket || stopping) return
    if (update.qr) status('qr', { qr: update.qr })
    if (update.connection === 'open') { restarts = 0; status('connected', { account: jidNormalizedUser(current.user?.id ?? '') }) }
    if (update.connection === 'close') {
      receiver.stop()
      const code = update.lastDisconnect?.error?.output?.statusCode
      // A fresh QR pairing requires one reconnect. Other failures require a deliberate retry.
      if (code === DisconnectReason.restartRequired && restarts++ < 2) { status('connecting'); connect(); return }
      status(code === DisconnectReason.loggedOut ? 'logged-out' : 'disconnected')
    }
  })
  current.ev.on('messages.upsert', ({ messages, type }) => {
    if (current !== socket || stopping || !receiver.active) return
    for (const message of messages) {
      const event = receiver.event(message, type)
      if (event) write({ type: 'message', ...event })
    }
  })
}
function fatal() { status('error'); stopping = true; receiver.stop(); try { socket?.end(undefined) } catch {}; process.exitCode = 1; process.stdin.destroy() }
async function command(value) {
  const reply = result => { if (value.request_id) write({ type: 'result', request_id: value.request_id, ok: true, result }) }
  try {
    if (value.command === 'initialize' && !auth) {
      const key = Buffer.from(value.key, 'base64')
      auth = encryptedAuth(value.file, key)
      connect(); reply(true)
    } else if (value.command === 'receive' && auth && !stopping) {
      receiver.start(value); reply(true)
    } else if (value.command === 'pause') {
      receiver.pause(value.generation); reply(true)
    } else if (value.command === 'send' && socket && !stopping) {
      const payload = receiver.payload(value)
      const sent = await socket.sendMessage(value.chat_id, payload)
      if (!sent?.key?.id || sent.key.remoteJid !== value.chat_id) throw new Error('Send not confirmed')
      reply(true)
    } else throw new Error('Command refused')
  } catch { if (value.request_id) write({ type: 'result', request_id: value.request_id, ok: false }) }
}
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', part => {
  buffer += part
  if (Buffer.byteLength(buffer) > 64 * 1024) { fatal(); return }
  let line
  while ((line = buffer.indexOf('\n')) >= 0) {
    const raw = buffer.slice(0, line); buffer = buffer.slice(line + 1)
    try { void command(JSON.parse(raw)) } catch { fatal() }
  }
})
process.stdin.on('end', () => { stopping = true; receiver.stop(); try { socket?.end(undefined) } catch {}; process.exit(0) })
process.on('uncaughtException', fatal)
process.on('unhandledRejection', fatal)

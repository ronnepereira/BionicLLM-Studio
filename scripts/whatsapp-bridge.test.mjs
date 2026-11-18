import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { encryptedAuth } from '../src-tauri/resources/whatsapp/auth.mjs'
import { validChat, textEvent, sending, ReceiverGate } from '../src-tauri/resources/whatsapp/protocol.mjs'

test('session snapshot is encrypted, authenticated and restores keys', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bionic-whatsapp-test-'))
  try {
    const file = join(dir, 'session.enc'), key = randomBytes(32)
    const auth = encryptedAuth(file, key)
    auth.state.creds.registered = true
    await auth.state.keys.set({ session: { contact: Buffer.from('private-session-data') } })
    const bytes = readFileSync(file)
    assert.equal(bytes.includes(Buffer.from('private-session-data')), false)
    const restored = encryptedAuth(file, key)
    assert.equal(restored.state.creds.registered, true)
    assert.deepEqual((await restored.state.keys.get('session', ['contact'])).contact, Buffer.from('private-session-data'))
    assert.throws(() => encryptedAuth(file, randomBytes(32)))
    bytes[30] ^= 1; writeFileSync(file, bytes)
    assert.throws(() => encryptedAuth(file, key))
  } finally {
    for (const name of ['session.enc', 'session.enc.tmp']) if (existsSync(join(dir, name))) unlinkSync(join(dir, name))
    rmdirSync(dir)
  }
})
test('only allowed fresh incoming human text is forwarded', () => {
  const chat = '5511999999999@s.whatsapp.net', allowed = new Set([chat])
  const message = { key: { id: 'ABC123', remoteJid: chat, fromMe: false }, messageTimestamp: 100, message: { conversation: 'Olá!' } }
  assert.equal(textEvent(message, 'notify', allowed, 100).text, 'Olá!')
  assert.equal(textEvent({ ...message, key: { ...message.key, remoteJid: '123456@lid', remoteJidAlt: chat } }, 'notify', allowed, 100).chat_id, chat)
  assert.equal(textEvent(message, 'append', allowed, 100), null)
  assert.equal(textEvent(message, 'notify', new Set(), 100), null)
  assert.equal(textEvent(message, 'notify', allowed, 101), null)
  assert.equal(textEvent({ ...message, key: { ...message.key, fromMe: true } }, 'notify', allowed, 100), null)
  assert.equal(textEvent({ ...message, message: { protocolMessage: { editedMessage: { conversation: 'edit' } } } }, 'notify', allowed, 100), null)
})
test('sends require an active allowlist and cannot choose status/broadcast destinations', () => {
  const chat = '5511999999999@s.whatsapp.net', allowed = new Set([chat])
  assert.equal(validChat('status@broadcast'), false)
  assert.equal(validChat('5511999999999@s.whatsapp.net/attack'), false)
  assert.equal(validChat('120363123456789012@g.us'), true)
  assert.deepEqual(sending({ chat_id: chat, text: 'Olá!' }, allowed, true), { text: 'Olá!', linkPreview: null })
  assert.throws(() => sending({ chat_id: chat, text: 'Olá!' }, allowed, false))
  assert.throws(() => sending({ chat_id: chat, text: 'Olá!' }, new Set(), true))
})
test('the dependency lock permits only registry packages with pinned integrity', () => {
  const lock = JSON.parse(readFileSync(new URL('../src-tauri/resources/whatsapp/package-lock.json', import.meta.url)))
  assert.equal(lock.packages['node_modules/@whiskeysockets/baileys'].version, '7.0.0-rc13')
  for (const [name, pkg] of Object.entries(lock.packages)) {
    if (!name) continue
    assert.ok(pkg.resolved.startsWith('https://registry.npmjs.org/'))
    assert.ok(pkg.integrity.startsWith('sha512-'))
  }
})
test('Stop invalidates delayed receive/send commands even after a new receiver starts', () => {
  const receiver = new ReceiverGate(), chat = '5511999999999@s.whatsapp.net'
  const start = { chats: [chat], since: 100, session_id: 'old', generation: 1 }
  receiver.start(start)
  assert.equal(receiver.payload({ chat_id: chat, text: 'Olá!', session_id: 'old' }).text, 'Olá!')
  receiver.pause(2)
  assert.throws(() => receiver.start(start))
  receiver.start({ ...start, session_id: 'new', generation: 3 })
  assert.throws(() => receiver.payload({ chat_id: chat, text: 'resposta atrasada', session_id: 'old' }))
  receiver.pause(2)
  assert.equal(receiver.payload({ chat_id: chat, text: 'Nova resposta', session_id: 'new' }).text, 'Nova resposta')
})

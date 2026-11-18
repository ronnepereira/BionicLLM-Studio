import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys'

/** One encrypted snapshot, with a random nonce per commit. The key arrives only over stdin. */
export function encryptedAuth(file, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Invalid session key')
  let state = { creds: initAuthCreds(), keys: {} }
  if (existsSync(file)) {
    const bytes = readFileSync(file)
    if (bytes.length < 29 || bytes.length > 16 * 1024 * 1024 || bytes[0] !== 1) throw new Error('Invalid auth snapshot')
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(1, 13))
    decipher.setAuthTag(bytes.subarray(13, 29))
    state = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString('utf8'), BufferJSON.reviver)
    if (!state.creds || !state.keys) throw new Error('Invalid auth state')
  }
  const save = () => {
    const plain = Buffer.from(JSON.stringify(state, BufferJSON.replacer))
    if (plain.length > 16 * 1024 * 1024) throw new Error('Auth snapshot limit')
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
    const bytes = Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted])
    mkdirSync(dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    writeFileSync(temp, bytes, { mode: 0o600 })
    renameSync(temp, file)
  }
  return {
    state: {
      creds: state.creds,
      keys: {
        get: async (type, ids) => {
          const result = {}
          for (const id of ids) {
            let value = state.keys[type]?.[id]
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value)
            result[id] = value
          }
          return result
        },
        set: async updates => {
          for (const [type, values] of Object.entries(updates)) {
            state.keys[type] ??= {}
            for (const [id, value] of Object.entries(values)) {
              if (value == null) delete state.keys[type][id]
              else state.keys[type][id] = value
            }
          }
          save()
        },
      },
    },
    save,
  }
}

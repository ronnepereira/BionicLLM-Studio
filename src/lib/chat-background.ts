export type ChatBackground = {
  kind: 'none' | 'image' | 'video'
  source: string
  name: string
  dim: number
  paused: boolean
}

export const DEFAULT_CHAT_BACKGROUND: ChatBackground = { kind: 'none', source: '', name: '', dim: 75, paused: false }
export const BACKGROUND_MAX_BYTES = 30 * 1024 * 1024
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'video/mp4', 'video/webm'])

export function backgroundFileKind(file: Pick<File, 'type' | 'size'>): 'image' | 'video' {
  if (!TYPES.has(file.type)) throw new Error('Escolha PNG, JPG, WebP, GIF, AVIF, MP4 ou WebM.')
  if (file.size <= 0 || file.size > BACKGROUND_MAX_BYTES) throw new Error('O arquivo deve ter até 30 MB e não pode estar vazio.')
  return file.type.startsWith('video/') ? 'video' : 'image'
}

export function backgroundUrl(value: string): string {
  const url = new URL(value.trim())
  if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 4096) throw new Error('Informe uma URL HTTPS direta de imagem ou vídeo, sem usuário e senha.')
  return url.href
}

export function normalizeChatBackground(value: unknown): ChatBackground {
  if (!value || typeof value !== 'object') return { ...DEFAULT_CHAT_BACKGROUND }
  const v = value as Partial<ChatBackground>
  const kind = v.kind === 'image' || v.kind === 'video' ? v.kind : 'none'
  let source = typeof v.source === 'string' ? v.source : ''
  if (!/^local:[a-f0-9-]{36}$/.test(source)) {
    try { source = backgroundUrl(source) } catch { source = '' }
  }
  return { kind: source ? kind : 'none', source, name: typeof v.name === 'string' ? v.name.slice(0, 180) : '', dim: typeof v.dim === 'number' && Number.isFinite(v.dim) ? Math.max(60, Math.min(95, v.dim)) : 75, paused: v.paused === true }
}

// Cosmetic media lives in its own database, never in conversation snapshots.
function openBackgroundDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bionic-chat-backgrounds', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('media')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Feche outra janela do aplicativo e tente novamente.'))
  })
}

export async function saveBackgroundFile(file: File): Promise<string> {
  backgroundFileKind(file)
  const db = await openBackgroundDB()
  const id = 'local:' + crypto.randomUUID()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('media', 'readwrite')
      tx.objectStore('media').put(file, id)
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Não foi possível guardar o fundo.'))
    })
    return id
  } finally { db.close() }
}

export async function readBackgroundFile(id: string): Promise<Blob> {
  const db = await openBackgroundDB()
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const request = db.transaction('media').objectStore('media').get(id)
      request.onsuccess = () => request.result instanceof Blob ? resolve(request.result) : reject(new Error('O arquivo local do fundo não está disponível. Selecione-o novamente em Aparência.'))
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}

export async function removeBackgroundFile(id: string): Promise<void> {
  if (!id.startsWith('local:')) return
  const db = await openBackgroundDB()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('media', 'readwrite')
      tx.objectStore('media').delete(id)
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () => reject(tx.error)
    })
  } finally { db.close() }
}

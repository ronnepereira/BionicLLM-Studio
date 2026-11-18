import { beforeEach, expect, it, vi } from 'vitest'
const backend = vi.hoisted(() => vi.fn())
// localStorage é um global do navegador; sob vitest/node precisa ser provido.
vi.mock('../../api/backend', () => ({ isTauri: () => true, backendCall: backend }))

function provideLocalStorage() {
  const mem = new Map<string, string>()
  const storage: Storage = {
    get length() { return mem.size },
    key: (i) => [...mem.keys()][i] ?? null,
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => { mem.set(k, String(v)) },
    removeItem: (k) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).localStorage = storage
}
import { conversationsToRecover, recoverChatsFromBackup, mergeChatsFromBackup, purgeDeletedConversationsFromBackup, getDeletedConversationIds, RECOVERY_DONE_KEY, readMissingBackupChats } from '../chat-backup-recovery'
import type { Conversation } from '../../types/chat'

const chat = (id: string, updatedAt: number, messages = 1) =>
  ({ id, title: id, createdAt: 0, updatedAt, messages: Array.from({ length: messages }, (_, i) => ({ id: `${id}${i}`, role: 'user', content: 'x', timestamp: i })) }) as unknown as Conversation
const backupWith = (conversations: Conversation[]) =>
  JSON.stringify({ 'chat-conversations': JSON.stringify({ state: { conversations }, version: 0 }), settings: '{}' })
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }

beforeEach(() => {
  provideLocalStorage()
  backend.mockReset()
  // Limpa tombstones entre testes para não vazar estado.
  ;(globalThis as any).localStorage.removeItem('lu-deleted-conversation-ids')
  ;(globalThis as any).localStorage.removeItem(RECOVERY_DONE_KEY)
})

it('keeps missing older chats and newer copies unless explicitly deleted', () => {
  const live = [chat('a', 10), chat('b', 20, 1)]
  const backup = [chat('a', 10), chat('b', 30, 4), chat('lost', 40), chat('older-missing', 5)]
  expect(conversationsToRecover(live, backup).map(c => c.id)).toEqual(['b', 'lost', 'older-missing'])
})

it('never replaces a chat the store has a newer copy of, and ignores malformed entries', () => {
  const live = [chat('a', 50, 3)]
  expect(conversationsToRecover(live, [chat('a', 40, 9), null as unknown as Conversation, { id: 'x' } as Conversation])).toEqual([])
})

it('runs once, hands the chats to the store, and retries after a failure', async () => {
  const storage = memory()
  const add = vi.fn()
  backend.mockRejectedValueOnce(new Error('no backup yet'))
  await expect(recoverChatsFromBackup(() => [chat('a', 10)], add, storage)).rejects.toThrow()
  expect(storage.getItem(RECOVERY_DONE_KEY)).toBeNull()
  backend.mockResolvedValue(backupWith([chat('a', 10), chat('lost', 99)]))
  expect(await recoverChatsFromBackup(() => [chat('a', 10)], add, storage)).toBe(1)
  expect(add.mock.calls[0][0].map((c: Conversation) => c.id)).toEqual(['lost'])
  expect(await recoverChatsFromBackup(() => [chat('a', 10)], add, storage)).toBe(0)
  expect(backend).toHaveBeenCalledTimes(2)
})

it('a backup without chats is fine', async () => {
  backend.mockResolvedValue(JSON.stringify({ settings: '{}' }))
  expect(await recoverChatsFromBackup(() => [], vi.fn(), memory())).toBe(0)
  backend.mockResolvedValue(null)
  expect(await recoverChatsFromBackup(() => [], vi.fn(), memory())).toBe(0)
})

it('explicit recovery finds missing older chats without replacing current conversations', async () => {
  backend.mockResolvedValue(JSON.stringify([chat('kept', 100), chat('older-missing', 2)]))
  const missing = await readMissingBackupChats(() => [chat('kept', 20)])
  expect(missing.map(chat => chat.id)).toEqual(['older-missing'])
})
it('rechecks current history after the backup read and accepts an empty backup collection', async () => {
  let live: Conversation[] = []
  backend.mockImplementationOnce(async () => { live = [chat('arrived', 3)]; return JSON.stringify([chat('arrived', 2)]) })
  expect(await readMissingBackupChats(() => live)).toEqual([])
  backend.mockResolvedValue('[]')
  expect(await readMissingBackupChats(() => live)).toEqual([])
})

describe('tombstone safeguards', () => {
  it('excludes explicitly deleted chats from automatic recovery', () => {
    const live = [chat('a', 10)]
    const backup = [chat('b', 99), chat('deleted-tombstone', 999)]
    ;(globalThis as any).localStorage.setItem('lu-deleted-conversation-ids', JSON.stringify(['deleted-tombstone']))
    expect(conversationsToRecover(live, backup).map(c => c.id)).toEqual(['b'])
    expect(conversationsToRecover(live, backup).find(c => c.id === 'deleted-tombstone')).toBeUndefined()
  })

  it('marks recovery complete even when the backup has nothing to restore', async () => {
    const storage = memory()
    const add = vi.fn()
    backend.mockResolvedValue(backupWith([]))
    expect(await recoverChatsFromBackup(() => [chat('a', 10)], add, storage)).toBe(0)
    expect(add).not.toHaveBeenCalled()
    expect(storage.getItem(RECOVERY_DONE_KEY)).toBe('1')
    // Second call is a no-op: no second backend call.
    expect(await recoverChatsFromBackup(() => [chat('a', 10)], add, storage)).toBe(0)
    expect(backend).toHaveBeenCalledTimes(1)
  })

  it('marks recovery complete when live is empty and backup is empty', async () => {
    const storage = memory()
    backend.mockResolvedValue(JSON.stringify({ settings: '{}' }))
    expect(await recoverChatsFromBackup(() => [], vi.fn(), storage)).toBe(0)
    expect(storage.getItem(RECOVERY_DONE_KEY)).toBe('1')
  })

  it('still retries after a failed read (flag stays unset)', async () => {
    const storage = memory()
    backend.mockRejectedValueOnce(new Error('no backup yet'))
    await expect(recoverChatsFromBackup(() => [chat('a', 10)], vi.fn(), storage)).rejects.toThrow()
    expect(storage.getItem(RECOVERY_DONE_KEY)).toBeNull()
    backend.mockResolvedValue(JSON.stringify({ settings: '{}' }))
    expect(await recoverChatsFromBackup(() => [chat('a', 10)], vi.fn(), storage)).toBe(0)
    expect(storage.getItem(RECOVERY_DONE_KEY)).toBe('1')
  })

  it('mergeChatsFromBackup also excludes tombstones', async () => {
    const add = vi.fn()
    backend.mockResolvedValue(backupWith([chat('b', 99), chat('deleted-tombstone', 999)]))
    ;(globalThis as any).localStorage.setItem('lu-deleted-conversation-ids', JSON.stringify(['deleted-tombstone']))
    expect(await mergeChatsFromBackup(() => [chat('a', 10)], add)).toBe(1)
    expect(add.mock.calls[0][0].map((c: Conversation) => c.id)).toEqual(['b'])
  })

  it('getDeletedConversationIds reads from localStorage', () => {
    ;(globalThis as any).localStorage.setItem('lu-deleted-conversation-ids', JSON.stringify(['deleted-tombstone']))
    expect(getDeletedConversationIds().has('deleted-tombstone')).toBe(true)
  })

  describe('durable deletion migration', () => {
    it('migrates explicit IDs without rewriting snapshots or removing other chats', async () => {
      backend.mockResolvedValue(undefined)
      localStorage.setItem('lu-deleted-conversation-ids', JSON.stringify(['deleted-tombstone']))
      await purgeDeletedConversationsFromBackup(['a'])
      expect(backend).toHaveBeenCalledWith('chat_deletions_update', { ids: ['deleted-tombstone'], deleted: true })
      expect(backend).not.toHaveBeenCalledWith('purge_chat_archives')
    })
    it('does not infer deletion from an incomplete live list', async () => {
      await purgeDeletedConversationsFromBackup([])
      expect(backend).not.toHaveBeenCalled()
    })
  })
})

it('missing backup history excludes deleted chats even when the live history is empty', async () => {
  localStorage.setItem('lu-deleted-conversation-ids', JSON.stringify(['deleted']))
  backend.mockResolvedValue(JSON.stringify([chat('older-kept', 1), chat('deleted', 99)]))
  expect((await readMissingBackupChats(() => [])).map(chat => chat.id)).toEqual(['older-kept'])
})
it('a deletion made while the backup is read cannot resurrect the chat', async () => {
  backend.mockImplementationOnce(async () => {
    localStorage.setItem('lu-deleted-conversation-ids', JSON.stringify(['deleted-during-read']))
    return JSON.stringify([chat('deleted-during-read', 99)])
  })
  expect(await readMissingBackupChats(() => [])).toEqual([])
})

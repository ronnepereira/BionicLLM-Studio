/**
 * Merge durable history after hydration. Missing nondeleted chats remain part
 * of the user's history regardless of age. Only explicit deletion tombstones
 * remove conversations; absence from one storage layer never implies deletion.
 */
import { backendCall, isTauri } from '../api/backend'
import { log } from './logger'
import type { Conversation } from '../types/chat'

export const RECOVERY_DONE_KEY = 'lu-chat-backup-recovery-v1'

export { DELETED_CONVERSATIONS_KEY, getDeletedConversationIds, markConversationDeleted, unmarkConversationDeleted } from './chat-deletion-ledger'
import { getDeletedConversationIds } from './chat-deletion-ledger'

export function conversationsToRecover(live: readonly Conversation[], backup: readonly Conversation[]): Conversation[] {
  const byId = new Map(live.map(c => [c.id, c]))
  const deleted = getDeletedConversationIds()
  return backup.filter(c => {
    if (!c || typeof c.id !== 'string' || !Array.isArray(c.messages) || deleted.has(c.id)) return false
    const mine = byId.get(c.id)
    return mine ? (c.updatedAt || 0) > (mine.updatedAt || 0) : true
  })
}

function backupConversations(raw: string | null): Conversation[] {
  if (!raw) return []
  const outer: unknown = JSON.parse(raw)
  const chat = outer && typeof outer === 'object' ? (outer as Record<string, unknown>)['chat-conversations'] : undefined
  if (typeof chat !== 'string' || !chat) return []
  const list = (JSON.parse(chat) as { state?: { conversations?: unknown } })?.state?.conversations
  return Array.isArray(list) ? list as Conversation[] : []
}

/**
 * Returns how many chats came back. Runs at most once per installation of
 * this version; a failure leaves the flag unset, so the next launch tries
 * again.
 */
export async function recoverChatsFromBackup(
  live: () => readonly Conversation[],
  add: (conversations: Conversation[]) => void,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): Promise<number> {
  if (!isTauri() || !storage || storage.getItem(RECOVERY_DONE_KEY)) return 0
  // restore_stores moves inline images into files natively and hands back
  // the small form, so this never parses a large backup in the renderer.
  const backup = backupConversations(await backendCall<string | null>('restore_stores'))
  const recovered = conversationsToRecover(live(), backup)
  if (recovered.length > 0) {
    add(recovered)
    log.warn('[chat-backup-recovery] chats the store never saved came back from the native backup', { count: recovered.length })
  }
  // A successful inspection is complete even when there is nothing to restore.
  storage.setItem(RECOVERY_DONE_KEY, '1')
  return recovered.length
}

/**
 * The same look into the native backup, asked again whenever the phone
 * journal says so (mobile/lib/store-journal.ts), not once per installation.
 * Same rules, so a chat comes back once and a deleted one does not: a chat
 * already in the store is only replaced by a newer copy of itself.
 * Returns how many chats came back. Rejects when the backup cannot be read.
 */
export async function mergeChatsFromBackup(
  live: () => readonly Conversation[],
  add: (conversations: Conversation[]) => void,
): Promise<number> {
  const backup = backupConversations(await backendCall<string | null>('restore_stores'))
  const recovered = conversationsToRecover(live(), backup)
  if (recovered.length > 0) add(recovered)
  return recovered.length
}

/** Explicit recovery may include deleted chats. Existing chats stay authoritative. */
export async function readMissingBackupChats(live: () => readonly Conversation[], includeDeleted = false): Promise<Conversation[]> {
  const raw = await backendCall<string>('chat_backup_conversations')
  if (raw === '[]') return []
  const { parseImportedChats } = await import('./chat-export')
  const candidates = parseImportedChats(raw)
  const present = new Set(live().map(chat => chat.id))
  const deleted = getDeletedConversationIds()
  return candidates.filter(chat => !present.has(chat.id) && (includeDeleted || !deleted.has(chat.id)))
}

export async function restoreMissingBackupChats(includeDeleted = false): Promise<number> {
  const { useChatStore, flushChatPersist } = await import('../stores/chatStore')
  const { idbStorage, hasFailedRead } = await import('./idbStorage')
  const { backupStoresNow } = await import('./store-backup')
  const missing = await readMissingBackupChats(() => useChatStore.getState().conversations, includeDeleted)
  const present = new Set(useChatStore.getState().conversations.map(chat => chat.id))
  const additions = missing.filter(chat => !present.has(chat.id))
  const expected = new Set([...present, ...additions.map(chat => chat.id)])
  if (additions.length) useChatStore.getState().importConversations(additions, 'merge', includeDeleted)
  await flushChatPersist()
  const persisted = await idbStorage.getItem('chat-conversations')
  const saved = persisted ? JSON.parse(persisted)?.state?.conversations : []
  const ids = new Set(Array.isArray(saved) ? saved.map(chat => chat.id) : [])
  if (hasFailedRead('chat-conversations') || !useChatStore.getState().conversations.every(chat => !expected.has(chat.id) || ids.has(chat.id))) {
    throw new Error('Could not confirm saved chats. Retry after resolving the storage error.')
  }
  if (!await backupStoresNow()) throw new Error('Chats were restored, but the native backup could not be confirmed.')
  return additions.length
}

/** Migrate legacy explicit deletions only. Never infer deletion from absence. */
export async function purgeDeletedConversationsFromBackup(_liveIds?: readonly string[]): Promise<void> {
  if (!isTauri()) return
  const ids = [...getDeletedConversationIds()]
  if (ids.length) await backendCall('chat_deletions_update', { ids, deleted: true })
}

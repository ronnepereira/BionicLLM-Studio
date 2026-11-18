// Imported before persisted stores: native deletions must win on the first read.
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../api/in-tauri'

export const DELETED_CONVERSATIONS_KEY = 'lu-deleted-conversation-ids'
let nativeIds = new Set<string>()
let pending: Promise<unknown> = Promise.resolve()

export function getDeletedConversationIds(): Set<string> {
  let local: unknown = []
  try { local = JSON.parse(localStorage.getItem(DELETED_CONVERSATIONS_KEY) || '[]') } catch { /* native ledger remains authoritative */ }
  return new Set([...nativeIds, ...(Array.isArray(local) ? local.filter((id): id is string => typeof id === 'string') : [])])
}

function cache(ids: Set<string>) {
  if (isTauri()) nativeIds = ids
  try { localStorage.setItem(DELETED_CONVERSATIONS_KEY, JSON.stringify([...ids])) } catch { /* durable native copy already exists */ }
}

export async function prepareChatDeletions(): Promise<void> {
  if (!isTauri()) return
  const local = getDeletedConversationIds()
  const disk = await invoke<string[]>('chat_deletions_read')
  const merged = new Set([...disk, ...local])
  if ([...local].some(id => !disk.includes(id))) {
    await invoke('chat_deletions_update', { ids: [...local], deleted: true })
  }
  cache(merged)
}

export async function deleteChatDurably(id: string): Promise<void> {
  if (isTauri()) await invoke('chat_deletions_update', { ids: [id], deleted: true })
  const ids = getDeletedConversationIds(); ids.add(id); cache(ids)
}

export function markConversationDeleted(id: string): void {
  const ids = getDeletedConversationIds(); ids.add(id); cache(ids)
}

export function unmarkConversationDeleted(id: string): void {
  const ids = getDeletedConversationIds(); ids.delete(id); cache(ids)
  if (isTauri()) {
    pending = pending.catch(() => {}).then(() => invoke('chat_deletions_update', { ids: [id], deleted: false }))
    // Callers that confirm persistence await this promise. Also report failures
    // for older import callers that do not explicitly flush.
    void pending.catch(error => window.dispatchEvent(new CustomEvent('bionic-storage-error', { detail: String(error) })))
  }
}

export async function flushChatDeletionChanges(): Promise<void> { await pending }

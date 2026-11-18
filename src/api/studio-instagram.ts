import { backendCall, isTauri } from './backend'
import { isMobile } from '../lib/device-kind'
import type { ReviewDraft } from '../lib/review-actions'
export interface InstagramCredentials { page_id: string; instagram_id: string; app_id: string; app_secret: string; access_token: string; publishing: boolean }
export interface InstagramStatus { configured: boolean; enabled: boolean; publishing: boolean; identity: { id: string; username: string; page_id: string; expires_at: number | null } | null }
export interface InstagramMedia { items: { id: string; caption: string; media_type: string; timestamp: string }[]; has_more: boolean }
export type InstagramPost = { kind: 'image'; url: string; caption: string } | { kind: 'reel'; url: string; caption: string; share_to_feed: boolean }
export type InstagramDraft = ReviewDraft<InstagramPost>
export function instagramAvailable() { return isTauri() && !isMobile() }
async function call<T>(name: string, args?: Record<string, unknown>) {
  if (!instagramAvailable()) throw new Error('Configure o Instagram no aplicativo desktop.')
  return backendCall<T>(name, args)
}
function changed() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('bionic-instagram-changed')) }
async function operation<T>(name: string, args: Record<string, unknown>, signal: AbortSignal) {
  if (signal.aborted) throw new Error('Operação Instagram cancelada.')
  const requestId = crypto.randomUUID()
  const stop = () => { void call<void>('studio_instagram_cancel', { requestId }).catch(() => {}) }
  signal.addEventListener('abort', stop, { once: true })
  try { const result = await call<T>(name, { ...args, requestId }); if (signal.aborted) throw new Error('Operação Instagram cancelada.'); return result }
  finally { signal.removeEventListener('abort', stop); changed() }
}
export const instagramStatus = () => call<InstagramStatus>('studio_instagram_status')
export const instagramDrafts = () => call<InstagramDraft[]>('studio_instagram_drafts')
export const verifyInstagram = (input: InstagramCredentials | null, signal: AbortSignal) => operation<InstagramStatus>('studio_instagram_verify', { input }, signal)
export const instagramMedia = (signal: AbortSignal) => operation<InstagramMedia>('studio_instagram_media', {}, signal)
export const prepareInstagram = (input: InstagramPost, signal: AbortSignal) => operation<InstagramDraft>('studio_instagram_prepare', { input }, signal)
export const publishInstagram = (id: string, signal: AbortSignal) => operation<InstagramDraft[]>('studio_instagram_publish', { id }, signal)
export async function updateInstagram(enabled: boolean | null) { try { return await call<InstagramStatus>('studio_instagram_update', { enabled }) } finally { changed() } }
export async function discardInstagram(id: string) { try { return await call<InstagramDraft[]>('studio_instagram_discard', { id }) } finally { changed() } }

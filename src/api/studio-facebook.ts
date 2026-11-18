import { backendCall, isTauri } from './backend'
import { isMobile } from '../lib/device-kind'
import type { ReviewDraft } from '../lib/review-actions'
export interface FacebookCredentials { page_id: string; app_id: string; app_secret: string; access_token: string; publishing: boolean }
export interface FacebookStatus { configured: boolean; enabled: boolean; publishing: boolean; identity: { id: string; name: string; expires_at: number | null } | null }
export interface FacebookPosts { items: { id: string; message: string; created_time: string }[]; has_more: boolean }
export type FacebookDraft = ReviewDraft<{ message: string }>
export function facebookAvailable() { return isTauri() && !isMobile() }
async function call<T>(name: string, args?: Record<string, unknown>) {
  if (!facebookAvailable()) throw new Error('Configure o Facebook no aplicativo desktop.')
  return backendCall<T>(name, args)
}
function changed() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('bionic-facebook-changed')) }
async function operation<T>(name: string, args: Record<string, unknown>, signal: AbortSignal) {
  if (signal.aborted) throw new Error('Operação Facebook cancelada.')
  const requestId = crypto.randomUUID()
  const stop = () => { void call<void>('studio_facebook_cancel', { requestId }).catch(() => {}) }
  signal.addEventListener('abort', stop, { once: true })
  try { const result = await call<T>(name, { ...args, requestId }); if (signal.aborted) throw new Error('Operação Facebook cancelada.'); return result }
  finally { signal.removeEventListener('abort', stop); changed() }
}
export const facebookStatus = () => call<FacebookStatus>('studio_facebook_status')
export const facebookDrafts = () => call<FacebookDraft[]>('studio_facebook_drafts')
export const verifyFacebook = (input: FacebookCredentials | null, signal: AbortSignal) => operation<FacebookStatus>('studio_facebook_verify', { input }, signal)
export const facebookPosts = (signal: AbortSignal) => operation<FacebookPosts>('studio_facebook_posts', {}, signal)
export const prepareFacebook = (message: string, signal: AbortSignal) => operation<FacebookDraft>('studio_facebook_prepare', { input: { message } }, signal)
export const publishFacebook = (id: string, signal: AbortSignal) => operation<FacebookDraft[]>('studio_facebook_publish', { id }, signal)
export async function updateFacebook(enabled: boolean | null) { try { return await call<FacebookStatus>('studio_facebook_update', { enabled }) } finally { changed() } }
export async function discardFacebook(id: string) { try { return await call<FacebookDraft[]>('studio_facebook_discard', { id }) } finally { changed() } }

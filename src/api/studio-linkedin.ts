import { backendCall, isTauri } from './backend'
import { isMobile } from '../lib/device-kind'
import type { ReviewDraft } from '../lib/review-actions'
export type LinkedInTarget = { kind: 'member' } | { kind: 'organization'; id: string }
export interface LinkedInCredentials { client_id: string; client_secret: string; access_token: string; target: LinkedInTarget; publishing: boolean; read_posts: boolean }
export interface LinkedInIdentity { author: string; name: string; member: string; expires_at: number }
export interface LinkedInStatus { configured: boolean; enabled: boolean; publishing: boolean; read_posts: boolean; target: LinkedInTarget; identity: LinkedInIdentity | null }
export interface LinkedInPosts { items: { id: string; message: string; modified_at: number | null }[]; has_more: boolean }
export type LinkedInDraft = ReviewDraft<{ message: string }>
export function linkedinAvailable() { return isTauri() && !isMobile() }
async function call<T>(name: string, args?: Record<string, unknown>) {
  if (!linkedinAvailable()) throw new Error('Configure o LinkedIn no aplicativo desktop.')
  return backendCall<T>(name, args)
}
function changed() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('bionic-linkedin-changed')) }
async function operation<T>(name: string, args: Record<string, unknown>, signal: AbortSignal) {
  if (signal.aborted) throw new Error('Operação LinkedIn cancelada.')
  const requestId = crypto.randomUUID()
  const stop = () => { void call<void>('studio_linkedin_cancel', { requestId }).catch(() => {}) }
  signal.addEventListener('abort', stop, { once: true })
  try { const result = await call<T>(name, { ...args, requestId }); if (signal.aborted) throw new Error('Operação LinkedIn cancelada.'); return result }
  finally { signal.removeEventListener('abort', stop); changed() }
}
export const linkedinStatus = () => call<LinkedInStatus>('studio_linkedin_status')
export const linkedinDrafts = () => call<LinkedInDraft[]>('studio_linkedin_drafts')
export const verifyLinkedIn = (input: LinkedInCredentials | null, signal: AbortSignal) => operation<LinkedInStatus>('studio_linkedin_verify', { input }, signal)
export const linkedinProfile = (signal: AbortSignal) => operation<LinkedInIdentity>('studio_linkedin_profile', {}, signal)
export const linkedinPosts = (signal: AbortSignal) => operation<LinkedInPosts>('studio_linkedin_posts', {}, signal)
export const prepareLinkedIn = (message: string, signal: AbortSignal) => operation<LinkedInDraft>('studio_linkedin_prepare', { input: { message } }, signal)
export const publishLinkedIn = (id: string, signal: AbortSignal) => operation<LinkedInDraft[]>('studio_linkedin_publish', { id }, signal)
export async function updateLinkedIn(enabled: boolean | null) { try { return await call<LinkedInStatus>('studio_linkedin_update', { enabled }) } finally { changed() } }
export async function discardLinkedIn(id: string) { try { return await call<LinkedInDraft[]>('studio_linkedin_discard', { id }) } finally { changed() } }

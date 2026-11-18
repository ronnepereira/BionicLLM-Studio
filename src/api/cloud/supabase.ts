// Tombstones for removed LU authentication. No SDK runtime, vault reads,
// OAuth listeners, browser launch, session refresh, or credentials deletion.
import type { SupabaseClient } from '@supabase/supabase-js'
import { rejectLuCloud } from './retired'

export type OAuthProvider = 'google' | 'github'

export type OAuthCallbackResult =
  /** Not the sign-in link. Nothing happened. */
  | { handled: false }
  | { handled: true; ok: true }
  /** `error` is a sentence for the user. */
  | { handled: true; ok: false; error: string }
export const MOBILE_OAUTH_NOT_OPENED = 'The sign-in page could not be opened.'

export const MOBILE_OAUTH_WAIT_MS = 300_000

export const OAUTH_SIGNIN_WINDOW_MS = 15 * 60_000

export const OAUTH_RESET_WINDOW_MS = 60 * 60_000

export const OAUTH_NOT_EXPECTED = 'This sign-in link was not asked for on this phone, or it is too old. Start the sign-in again.'

export const keychainStorage = {
  async getItem(_key: string): Promise<string | null> { return null },
  async setItem(_key: string, _value: string): Promise<void> { rejectLuCloud() },
  async removeItem(_key: string): Promise<void> { rejectLuCloud() },
}
export function retryKeychainStorage(): void {}
export async function savedSessionUser(): Promise<{ id: string; email?: string } | null> { return null }
export function supabaseCloud(): SupabaseClient { return rejectLuCloud() }
export async function getAccessToken(): Promise<string | null> { return rejectLuCloud() }
export async function loginWithProvider(_provider: OAuthProvider, _signal?: AbortSignal, _onBrowserOpen?: () => void): Promise<void> { rejectLuCloud() }
export function oauthCallbackExpected(_now?: number): boolean { return false }
export function oauthCallbackSeenSince(_since: number): boolean { return false }
export function onOAuthSignedIn(_fn: () => void): () => void { return () => {} }
export async function handleOAuthCallbackUrl(_url: string): Promise<OAuthCallbackResult> { return { handled: false } }
export function __resetMobileOAuthForTests(): void {}
export async function requestPasswordReset(_email: string): Promise<void> { rejectLuCloud() }
export function onPasswordRecovery(_fn: () => void): () => void { return () => {} }
export async function setNewPassword(_password: string): Promise<void> { rejectLuCloud() }

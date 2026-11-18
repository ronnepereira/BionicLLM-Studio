// Historical consumers see no LU account; no polling, OAuth, or session boot.
import { useCloudAuthStore } from '../stores/cloudAuthStore'
import { rejectLuCloud } from '../api/cloud/retired'
export async function probeAccount(): Promise<void> { useCloudAuthStore.getState().setSignedOut() }
export async function signOutAccount(): Promise<void> { useCloudAuthStore.getState().setSignedOut() }
async function login(_email: string, _password: string): Promise<void> { rejectLuCloud() }
export function useCloudAuth() {
  const status = useCloudAuthStore(s => s.status)
  const user = useCloudAuthStore(s => s.user)
  return { status, user, login, signup: login, logout: signOutAccount, refresh: probeAccount }
}

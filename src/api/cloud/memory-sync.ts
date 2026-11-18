// Local memory data is retained; the removed LU synchronization never runs.
import { LU_CLOUD_REMOVED } from './retired'

export interface SyncedMemoryRecord {
  memory_id: string
  revision: number
  deleted: boolean
  /** Still untrusted record data; the store must validate its memory schema. */
  payload: Record<string, unknown> | null
  updated_at: string
}

export class MemorySyncError extends Error {
  readonly kind: 'account' | 'conflict' | 'network' | 'invalid' | 'cancelled' | 'consent'
  constructor(kind: MemorySyncError['kind'], message: string) { super(message); this.kind = kind }
}

export interface MemorySyncSession {
  assertCurrent(): void
  pull(): Promise<SyncedMemoryRecord[]>
  /**
   * Die alte Kontokopie, wie sie vor dem heutigen Protokoll geschrieben wurde
   * (R5-30, Entscheid vom 12.09.2026). Roh und ungeprueft: was in dieser
   * Zeile steht, hat eine aeltere Fassung dieser App geschrieben, und der
   * Leser prueft jedes Feld selbst.
   */
  pullLegacy(): Promise<unknown[]>
  /**
   * Die alte Kopie endgueltig entfernen. Nur mit einem Beleg, den jemand
   * gesehen hat: die genaue alte Liste und die Revision jeder neuen Fassung.
   * Der Server vergleicht beides und riegelt in einem Zug ab.
   */
  finalizeLegacy(memories: unknown[], revisions: Record<string, number>): Promise<void>
  write(id: string, revision: number, payload: Record<string, unknown> | null): Promise<SyncedMemoryRecord>
}

export async function withMemorySyncSession<T>(_ownerId: string, _work: (session: MemorySyncSession) => Promise<T>, _signal?: AbortSignal): Promise<T> {
  throw new MemorySyncError('account', LU_CLOUD_REMOVED)
}

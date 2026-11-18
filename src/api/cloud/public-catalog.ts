// The removed LU service has no public catalog/status in BionicLLM Studio.
import type { GateCatalog } from '../../lib/cloud-gate'
export async function getPublicCatalog(_timeoutMs?: number): Promise<GateCatalog | null> { return null }

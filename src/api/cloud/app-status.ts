// The removed LU service has no public catalog/status in BionicLLM Studio.
import type { CloudOutage } from '../../lib/cloud-outage'
export async function getAppStatus(_timeoutMs?: number): Promise<CloudOutage | null> { return null }

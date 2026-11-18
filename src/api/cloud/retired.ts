/** Historical LU-only routes never authenticate or send requests in this fork. */
export const LU_CLOUD_REMOVED = 'O serviço pago LU Cloud foi removido do BionicLLM Studio. Use um modelo local ou configure seu próprio provedor.'

export class LuCloudRemovedError extends Error {
  readonly status = 410
  readonly code = 'service_removed'
  constructor() { super(LU_CLOUD_REMOVED); this.name = 'LuCloudRemovedError' }
}

export function rejectLuCloud(): never {
  throw new LuCloudRemovedError()
}

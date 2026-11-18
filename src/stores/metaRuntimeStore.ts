import { createMessageRuntime } from './createMessageRuntime'
import { discardMeta, finishMeta, metaAvailable, metaRuntime, pollMeta, sendMeta, startMeta, stopMeta } from '../api/studio-whatsapp-meta'
export const useMetaRuntimeStore = createMessageRuntime<string>('WhatsApp oficial', {
  available: metaAvailable, runtime: metaRuntime, start: startMeta, stop: stopMeta,
  poll: pollMeta, finish: finishMeta, send: sendMeta, discard: discardMeta,
})

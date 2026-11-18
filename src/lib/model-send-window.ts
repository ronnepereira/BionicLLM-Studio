import { getProviderForModel } from '../api/providers'
import { sendWindowFor as savedSendWindow } from './send-window'

/** The provider-aware boundary stays outside the pure budget arithmetic. */
export function sendWindowFor(settings: Parameters<typeof savedSendWindow>[0], model: string): number | undefined {
  let key: string | undefined
  try {
    const { provider, modelId } = getProviderForModel(model)
    key = provider.contextWindowKey?.(modelId)
  } catch { /* unknown model: keep a user's legacy explicit choice */ }
  return savedSendWindow(settings, model, key)
}

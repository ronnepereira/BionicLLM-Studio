/**
 * Shared input budget for the meter, Chat, Agent, Code and compaction.
 * Auto follows each model's resolved capacity and reserves 20% for output and
 * protocol overhead. A positive user-selected cloud budget is an explicit
 * cost limit; zero means automatic. Local allocation remains provider-owned.
 */
import { isCompatProviderId } from '../api/providers/compat-id'

/**
 * Providers where a token sent is a token billed.
 *
 * `openai` is on this list because that is the slot api.openai.com sits in. It
 * is also the slot a llama.cpp on 127.0.0.1:8080, a vLLM in the LAN, LM Studio
 * and this app's own engine sit in, because `ProviderId` is a fixed set of
 * four and every OpenAI-protocol backend shares one of them. So the id alone
 * cannot answer the cost question for this entry, and `localBackend` is what
 * finishes it: where the send goes to a machine on this network, nobody is
 * billed and there is nothing to cap. The classification itself is NOT
 * repeated here as a second list; it lives in lib/lan-openai-slot.ts, which is
 * the same answer the context window uses (GH #129).
 */
export const PAID_PROVIDER_IDS: ReadonlySet<string> = new Set(['lu-cloud', 'openai', 'anthropic'])

/** Zero means Auto. Economic limits are explicit per-model choices. */
export const DEFAULT_SEND_WINDOW_TOKENS = 0

/** The pre-3.0.4 default. No UI ever wrote this setting, so a stored 64000 is
 *  the old default riding along in a profile, not anyone's choice. */
export const RETIRED_SEND_WINDOW_DEFAULT = 64000

/** The share of the model window a step was already limited to before 2.6.6. */
export const WINDOW_SHARE = 0.8

/** Small-Model Mode keeps its own, much tighter profile (Knob 4). */
export const SMALL_MODEL_SHARE = 0.5
export const SMALL_MODEL_CEILING = 6000

/**
 * The send window setting for one model: the user's per-model pick from the
 * context dropdown, else the global default. Every caller of
 * effectiveSendWindow reads it through here, so the counter, the request
 * builder and /compact always agree on the same number.
 */
export function sendWindowFor(
  settings: { codexSendWindowTokens?: number; cloudSendWindowByModel?: Record<string, number> },
  model: string,
  endpointKey?: string,
): number | undefined {
  const pick = (endpointKey ? settings.cloudSendWindowByModel?.[endpointKey] : undefined) ?? settings.cloudSendWindowByModel?.[model]
  if (typeof pick === 'number' && pick > 0) return Math.floor(pick)
  return settings.codexSendWindowTokens
}

export interface SendWindowInput {
  /** Provider id of the active model ('lu-cloud', 'ollama', …). */
  providerId: string
  /** The context window the loop resolved for this model (num_ctx). */
  modelWindow: number
  /** settings.codexSendWindowTokens. */
  sendWindowTokens?: number
  /** settings.contextDecay. The notaus switches the cap off with the decay. */
  capEnabled?: boolean
  /** settings.smallModelMode. */
  smallModelMode?: boolean
  /**
   * The send goes to a server on this machine or in the LAN
   * (`sendsToALanBackend` in lib/lan-openai-slot). Only the `openai` slot can
   * be either; left out, the provider id decides alone, which is what every
   * caller did before 3.0.0.
   */
  localBackend?: boolean
}

export function isPaidProvider(providerId: string, localBackend?: boolean): boolean {
  // A server in the next room bills nobody, whichever protocol it speaks.
  if (localBackend === true) return false
  // An extra OpenAI-compatible slot (`openai-<slug>`) is a hosted API with
  // the user's own key unless `localBackend` already said otherwise above.
  return PAID_PROVIDER_IDS.has(providerId) || isCompatProviderId(providerId)
}

/**
 * The compaction budget for one step. Identical to the pre-2.6.6 number
 * everywhere the cap does not apply, so a local run cannot change behaviour.
 */
export function effectiveSendWindow(input: SendWindowInput): number {
  const window = Number.isFinite(input.modelWindow) && input.modelWindow > 0 ? input.modelWindow : 0
  const base = input.smallModelMode
    ? Math.floor(Math.min(window * SMALL_MODEL_SHARE, SMALL_MODEL_CEILING))
    : Math.floor(window * WINDOW_SHARE)
  if (input.capEnabled === false) return base
  if (!isPaidProvider(input.providerId, input.localBackend)) return base
  const cap =
    typeof input.sendWindowTokens === 'number' && input.sendWindowTokens > 0
      ? Math.floor(input.sendWindowTokens)
      : base
  return Math.min(base, cap)
}

/** What the messages of a step are left with at the very least, however large the catalogue is. */
export const MIN_MESSAGE_BUDGET = 4096

/**
 * The budget of the messages once the tool catalogue has its place. The
 * catalogue is sent as a field of its own, so the estimate of the messages
 * never sees it; without this a full history plus the catalogue is more than
 * the window. Never below `MIN_MESSAGE_BUDGET`, and never above the budget
 * that came in.
 */
export function budgetBesideTheCatalog(sendWindow: number, catalogTokens: number): number {
  const catalog = Number.isFinite(catalogTokens) && catalogTokens > 0 ? Math.ceil(catalogTokens) : 0
  return Math.min(sendWindow, Math.max(MIN_MESSAGE_BUDGET, sendWindow - catalog))
}

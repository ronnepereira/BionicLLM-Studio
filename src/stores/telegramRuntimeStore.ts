import { discardTelegram, finishTelegram, pollTelegram, sendTelegram, startTelegram, stopTelegram, telegramAvailable, telegramRuntime } from '../api/studio-telegram'
import { createMessageRuntime } from './createMessageRuntime'
export const useTelegramRuntimeStore = createMessageRuntime<number>('Telegram', {
  available: telegramAvailable, runtime: telegramRuntime, start: startTelegram, stop: stopTelegram,
  poll: pollTelegram, finish: finishTelegram, send: sendTelegram, discard: discardTelegram,
})

import { MessageRuntimePanel } from './MessageRuntimePanel'
import { useTelegramRuntimeStore } from '../../stores/telegramRuntimeStore'
import { telegramAvailable } from '../../api/studio-telegram'
import { parseTelegramChats } from '../../lib/telegram'
export function TelegramRuntimePanel({ configured }: { configured: boolean }) {
  return <MessageRuntimePanel channel="Telegram" desktop={telegramAvailable()} configured={configured} useRuntime={useTelegramRuntimeStore} parseChats={parseTelegramChats}
    sourceHelp="Use a bot dedicated to BionicLLM. Only new text messages from the chats listed below are processed while this receiver is active. Other chats, bots, edited messages and attachments are ignored."
    inputHelp="Numeric IDs, separated by commas or lines" />
}

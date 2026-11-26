import { useId, useState } from 'react'
import { useUiText } from '../../lib/ui-text'
import type { ChatQuestion } from '../../lib/chat-question'

export function ChatQuestionCard({ clarification, onAnswer }: {
  clarification: ChatQuestion
  onAnswer: (answer: string) => void
}) {
  const uiText = useUiText()
  const heading = useId()
  const [custom, setCustom] = useState('')

  return (
    <section aria-labelledby={heading} className="mb-2 max-h-[36vh] space-y-2 overflow-y-auto rounded-xl border border-blue-500/30 bg-white p-3 text-sm dark:bg-gray-900">
      <h3 id={heading} className="break-words font-medium">{clarification.question}</h3>
      {clarification.options.map(option => (
        <button key={option} type="button" onClick={() => onAnswer(option)}
          className="block w-full break-words rounded-md border border-gray-200 px-3 py-2 text-start hover:border-blue-500 hover:bg-blue-500/10 dark:border-white/15 dark:hover:border-blue-400">
          {option}
        </button>
      ))}
      <form className="flex flex-wrap gap-2" onSubmit={event => {
        event.preventDefault()
        if (custom.trim()) onAnswer(custom.trim())
      }}>
        <input className="min-w-32 flex-1 rounded-md border border-gray-300 bg-transparent px-3 py-2 dark:border-white/20"
          aria-label={uiText('Type your answer')} placeholder={uiText('Type your answer')}
          value={custom} onChange={event => setCustom(event.target.value)} />
        <button type="submit" disabled={!custom.trim()} className="rounded-md bg-blue-600 px-3 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
          {uiText('Send answer')}
        </button>
      </form>
    </section>
  )
}

import { useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useUiText } from '../../lib/ui-text'
import { VoiceHologram } from './VoiceHologram'
import { VoiceWaves } from './VoiceWaves'
import type { VoiceMood } from './VoiceWaves'

export function VoicePortrait({ mood, compact }: { mood: VoiceMood; compact: boolean }) {
  const text = useUiText()
  const [paused, setPaused] = useState(false)
  return <div data-testid="voice-portrait" className="min-h-0 shrink flex flex-col relative">
    <VoiceHologram mood={mood} paused={paused} compact={compact} />
    <VoiceWaves mood={mood} paused={paused} className="h-12 min-h-0 shrink" />
    <div className="flex justify-center mb-2">
      <button type="button" onClick={() => setPaused(!paused)}
        className="lu-control gap-1.5 text-gray-500 dark:text-gray-400"
        title={text('Pause only the visual animation. Voice continues normally.') }>
        {paused ? <Play size={11} /> : <Pause size={11} />}
        {text(paused ? 'Resume animation' : 'Pause animation')}
      </button>
    </div>
  </div>
}

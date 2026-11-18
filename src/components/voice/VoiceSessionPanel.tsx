import { useUiText } from "../../lib/ui-text"
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Mic, MicOff, Square } from 'lucide-react'
import { ComputerQuestionSlot } from '../computer/ComputerQuestion'
import { ComputerChatPermission } from '../computer/ComputerChatPermission'
import { ComputerNote } from '../computer/ComputerNote'
import { VoicePortrait } from './VoicePortrait'
import type { VoiceMood } from './VoiceWaves'
import { useVoiceSessionStore } from '../../stores/voiceSessionStore'
import { useModelStore } from '../../stores/modelStore'
import { displayModelName } from '../../api/providers/model-name'
import { isLinux, isMacOS, isWindows } from '../../api/backend'
import {
  setVoiceMuted,
  startVoiceSession,
  stopVoiceSession,
} from '../../api/voice-session'
import { latencyLabel, startLabel } from '../../lib/voice/session-state'
import { voiceStatus, voiceStatusText } from './voice-status'
import { voiceTimeline } from '../../lib/voice/tool-view'
import { voiceModelAdvice } from '../../lib/voice/model-advice'
import { useComputerStore } from '../../stores/computerStore'
import type { VoiceError } from '../../lib/voice/session-state'

const focusCls = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:focus-visible:ring-white/40'
const startCls = `inline-flex items-center justify-center gap-2 h-[var(--control-h-lg)] px-6 rounded-full t-control transition-colors ${focusCls} bg-gray-900 !text-white hover:bg-gray-700 dark:bg-white dark:!text-gray-900 dark:hover:bg-gray-200`
const sideCls = `shrink-0 flex items-center justify-center w-10 h-10 rounded-full transition-colors ${focusCls} border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]`

/** What the user can do about an error, when there is something to do. */
function errorHelp(error: VoiceError): string | null {
  switch (error.kind) {
    case 'microphone-denied':
      if (isMacOS()) return 'Open System Settings, Privacy & Security, Microphone, and switch it on for BU. Then start again.'
      if (isWindows()) return 'Open Settings, Privacy & security, Microphone, and let desktop apps use the microphone. Then start again.'
      // GitHub #162: Linux has no microphone switch per app, and pointing at
      // one sent the reporter looking for a setting that does not exist. LU
      // answers the web view's question itself (src-tauri/src/linux_media.rs).
      if (isLinux()) return 'Check that a microphone is connected and chosen as the input in the sound settings of your system. Then start again.'
      return 'Allow this app to use the microphone in the privacy or sound settings of your system. Then start again.'
    case 'no-model':
    case 'unsupported-model':
      return 'Voice talks to the model that is selected in Chat.'
    case 'signed-out':
      return 'Pick a local model in Chat. Voice runs in Local mode.'
    default:
      return null
  }
}

/** A piece of work shows its seconds once it takes this long. */
const WORK_CLOCK_FROM_SECS = 3

/** Whole seconds since `key` took its current value, 0 while it is null. One update per second. */
function useSecondsSince(key: string | null): number {
  const [secs, setSecs] = useState(0)
  const [seen, setSeen] = useState(key)
  if (seen !== key) {
    setSeen(key)
    setSecs(0)
  }
  useEffect(() => {
    if (key === null) return
    const began = Date.now()
    const id = setInterval(() => setSecs(Math.floor((Date.now() - began) / 1000)), 1000)
    return () => clearInterval(id)
  }, [key])
  return secs
}

/** The session itself: start, what is happening, what was said, stop. */
export function VoiceSessionPanel() {
  const uiText = useUiText()

  const phase = useVoiceSessionStore((s) => s.phase)
  const startStep = useVoiceSessionStore((s) => s.startStep)
  const coldStart = useVoiceSessionStore((s) => s.coldStart)
  const startedAt = useVoiceSessionStore((s) => s.startedAt)
  const activity = useVoiceSessionStore((s) => s.activity)
  const muted = useVoiceSessionStore((s) => s.muted)
  const lines = useVoiceSessionStore((s) => s.lines)
  const tools = useVoiceSessionStore((s) => s.tools)
  const approval = useVoiceSessionStore((s) => s.approval)
  const runningTool = useVoiceSessionStore((s) => s.runningTool)
  const latencyMs = useVoiceSessionStore((s) => s.latencyMs)
  const screenTask = useComputerStore((s) => s.task)
  const screenAsking = useComputerStore((s) => s.prompt !== null)
  // The first use of computer control in this session. Only a click allows it; a spoken no declines.
  const chatAsk = useComputerStore((s) => (s.chatAsk?.voice ? s.chatAsk : null))
  const screenPaused = useComputerStore((s) => s.paused)
  const error = useVoiceSessionStore((s) => s.error)
  // What just went wrong comes before the standing note of the session.
  const notice = useVoiceSessionStore((s) => s.hint ?? s.notice)
  const endNote = useVoiceSessionStore((s) => s.endNote)
  const sessionModel = useVoiceSessionStore((s) => s.modelLabel)
  const activeModel = useModelStore((s) => s.activeModel)
  // One calm line when the selected model is a poor fit for Voice. Advice only.
  const modelAdvice = useModelStore((s) => {
    const meta = s.models.find((m) => m.name === s.activeModel)
    return voiceModelAdvice({
      name: s.activeModel,
      supportsTools: meta && 'supportsTools' in meta ? meta.supportsTools : undefined,
      parameterSize: meta && 'details' in meta ? meta.details?.parameter_size : undefined,
    })
  })

  const starting = phase === 'starting'
  const live = phase === 'live'
  const running = starting || live
  // The last session ended by itself: by an error, or with a sentence why.
  const again = phase === 'error' || (phase === 'idle' && endNote !== null)

  // Seconds since the click, while starting only.
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!starting || !startedAt) return
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [starting, startedAt])

  const modelName = sessionModel ?? (activeModel ? displayModelName(activeModel) : null)
  const liveStatus = live ? voiceStatus({ activity, muted, approval, runningTool }, screenTask ? { step: screenTask.steps.at(-1)?.label || screenTask.goal, asking: screenAsking, paused: screenPaused } : null) : null
  const status = starting
    ? startLabel(startStep, coldStart, elapsed)
    : liveStatus ? voiceStatusText(liveStatus)
      : phase === 'error' ? uiText('Voice stopped') : endNote ?? uiText('Ready')
  // Seconds a piece of work has been going, counted from the moment its word appeared.
  const workWord = liveStatus?.kind ? liveStatus.word : null
  const workSecs = useSecondsSince(workWord)
  const mood: VoiceMood = starting ? 'starting'
    : !live ? 'idle'
      : approval || screenAsking || screenPaused ? 'waiting'
        : activity === 'speaking' ? 'speaking'
          : activity === 'thinking' || activity === 'tool' ? 'thinking'
            : muted ? 'muted' : 'listening'
  const latency = latencyLabel(latencyMs)
  const timeline = useMemo(() => voiceTimeline(lines, tools), [lines, tools])
  const empty = timeline.length === 0

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="voice-session" data-phase={phase} data-activity={live ? activity : undefined}>
      <div className={`w-full max-w-2xl mx-auto px-4 pb-4 flex flex-col min-h-0`}>

        {/* A question of computer control stands here too, above the controls
            of the session and never as a line of the transcript. */}
        <ComputerQuestionSlot className="mb-2" />
        {chatAsk && <ComputerChatPermission ask={chatAsk} />}
        <ComputerNote />

        {phase === 'error' && error && (
          <div role="alert" className="mb-2 flex items-start gap-2 p-2.5 rounded-lg border border-red-300 dark:border-red-500/25 bg-red-50 dark:bg-red-500/[0.08] text-red-700 dark:text-red-300">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <div className="min-w-0 t-micro leading-relaxed break-words">
              <div className="font-medium">{error.message}</div>
              {errorHelp(error) && <div>{errorHelp(error)}</div>}
            </div>
          </div>
        )}

        {/* The portrait shrinks once there is a transcript; the original audio
            spectrum stays below it. Visual pause never changes the session. */}
        <VoicePortrait mood={mood} compact={false} />

        {empty && (
          <p className="mx-auto mt-1 mb-4 max-w-sm text-center t-body leading-relaxed text-gray-500 dark:text-gray-400">
            {running
              ? uiText("Just talk. You can speak over the answer at any time.")
              : modelName
                ? <>{uiText("Voice answers with ")}<span className="text-gray-700 dark:text-gray-300">{modelName}</span>{uiText(", the model selected in Chat.")}</>
                : uiText("Pick a chat model first. Voice answers with the model selected in Chat.")}
            {!running && modelAdvice && (
              <span data-testid="voice-model-advice" className="block mt-1 t-micro text-gray-500 dark:text-gray-500">{modelAdvice}</span>
            )}
          </p>
        )}

        <div className="flex items-center justify-center gap-4 mt-1">
          {/* Two keys, so the Start button is not turned into the mute button in place: it kept the
              keyboard focus that way, and a second Enter on Start muted the microphone (seen on Windows, 08.10.2026). */}
          {running ? (
            <button
              key="mute"
              type="button"
              className={`${sideCls} ${muted ? 'bg-gray-100 dark:bg-white/[0.08] text-gray-900 dark:text-white' : ''}`}
              onClick={() => setVoiceMuted(!muted)}
              aria-pressed={muted}
              aria-label={muted ? uiText("Unmute microphone") : uiText("Mute microphone")}
              title={muted ? uiText("Unmute microphone") : uiText("Mute microphone")}
            >
              {muted ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
          ) : (
            // The click is the user gesture the microphone and the audio
            // output need, so the session starts directly in the handler.
            <button key="start" type="button" className={startCls} onClick={() => { void startVoiceSession() }} aria-label={again ? uiText("Start again") : uiText("Start voice")}>
              <Mic size={14} /> {again ? uiText("Start again") : uiText("Start")}
            </button>
          )}

          {running && (
            <div className="min-w-0 w-64 text-center">
              <div role="status" className="t-body text-gray-800 dark:text-gray-200 break-words">
                {/* Word and seconds from the run status of the chat, without its
                    mark: right under the waves a second moving sign in the same
                    violet read as a stray icon and pushed the word off centre
                    (tried and looked at, 07.10.2026). The waves are the sign here. */}
                <span data-testid="voice-status">
                  {status}
                  {starting && elapsed >= 5 && <span className="text-gray-500 dark:text-gray-400"> · {elapsed} s</span>}
                </span>
                {workWord && workSecs >= WORK_CLOCK_FROM_SECS && (
                  <span aria-hidden="true" className="lu-hud-num text-gray-500 dark:text-gray-400"> · {workSecs} s</span>
                )}
              </div>
            </div>
          )}

          {running && (
            <button type="button" className={sideCls} onClick={() => stopVoiceSession()} aria-label={uiText("Stop voice")} title={uiText("Stop")}>
              <Square size={13} className="fill-current" />
            </button>
          )}
        </div>

        <div className="mt-2 text-center min-h-[1rem] t-micro text-gray-500 dark:text-gray-400">
          {!running && <span role="status" data-testid="voice-status">{status}</span>}
          {live && notice ? <span data-testid="voice-notice">{notice}</span> : null}
          {live && notice && latency ? ' · ' : null}
          {live && latency ? <span data-testid="voice-latency" title={uiText("From the end of your sentence to the first sound of the answer")}>{uiText("Answered in ")}{latency}</span> : null}
        </div>
      </div>
    </div>
  )
}

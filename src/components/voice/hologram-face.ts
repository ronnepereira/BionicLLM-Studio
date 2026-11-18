import type { VoiceMood } from './VoiceWaves'

export interface FacePose {
  yaw: number
  pitch: number
  blink: number
  mouth: number
  brow: number
  browLeft?: number
  browRight?: number
}
const clamp = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0

/** Audio amplitude, not inferred emotion or phonemes. No access to transcript or storage. */
export function facePose(mood: VoiceMood, seconds: number, level: number, still = false): FacePose {
  const speaking = mood === 'speaking'
  const attentive = mood === 'listening'
  const t = still ? 0 : seconds
  const blinkPhase = t % 5.7
  const blink = !still && blinkPhase > 5.45 ? Math.sin((blinkPhase - 5.45) / 0.25 * Math.PI) : 0

  // Head micro-movements: slow drift plus small jitter for life
  const yaw = still ? 0 : (Math.sin(t / 6 * Math.PI * 2) * 0.13 + Math.sin(t / 2.3) * 0.04)
  const pitch = still ? 0 : (Math.sin(t * 0.66) * 0.012 + Math.cos(t / 4.1) * 0.006 + (attentive ? 0.008 : 0))

  // Mouth: speaking opens proportionally to audio level, with slight asymmetry for realism
  const mouth = speaking && !still ? clamp(Math.sqrt(clamp(level)) * 2.3) : 0

  // Eyebrows: independent sides for more expression
  let browLeft = 0
  let browRight = 0
  if (mood === 'thinking') { browLeft = 0.035; browRight = 0.025 }
  else if (attentive) { browLeft = 0.055; browRight = 0.065 }
  else if (mood === 'waiting') { browLeft = 0.035; browRight = 0.035 }
  else if (speaking && !still) { browLeft = 0.015; browRight = 0.015 }

  // Slight mouth asymmetry when speaking (one corner higher)

  return {
    yaw,
    pitch,
    blink,
    mouth: clamp(mouth),
    brow: (browLeft + browRight) / 2,
    browLeft: clamp(browLeft),
    browRight: clamp(browRight),
  }
}

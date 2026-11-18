import { describe, expect, it } from 'vitest'
import { facePose } from '../hologram-face'
import type { VoiceMood } from '../VoiceWaves'

describe('hologram audio and state pose', () => {
  it('opens the mouth only for actual output audio; listening does not lip-sync the user', () => {
    expect(facePose('speaking', 2, 0).mouth).toBe(0)
    expect(facePose('speaking', 2, 0.08).mouth).toBeGreaterThan(0.5)
    expect(facePose('listening', 2, 1).mouth).toBe(0)
    expect(facePose('muted', 2, 1).mouth).toBe(0)
  })
  it('bounds invalid amplitude and honors pause/reduced motion for every state', () => {
    const moods: VoiceMood[] = ['idle', 'starting', 'listening', 'thinking', 'speaking', 'waiting', 'muted']
    for (const mood of moods) {
      const pose = facePose(mood, 5.57, 1, true)
      expect(pose.mouth).toBe(0)
      expect(pose.blink).toBe(0)
      expect(pose.yaw).toBe(0)
      expect(pose.pitch).toBe(0)
    }
    for (const value of [NaN, Infinity, -2, 20]) {
      const pose = facePose('speaking', 1, value)
      expect(pose.mouth).toBeGreaterThanOrEqual(0)
      expect(pose.mouth).toBeLessThanOrEqual(1)
    }
  })
  it('changes brows and gaze with session state, and bounds a natural blink', () => {
    expect(facePose('listening', 2, 0).brow).toBeGreaterThan(facePose('idle', 2, 0).brow)
    expect(facePose('thinking', 2, 0).brow).toBeGreaterThan(0)
    expect(facePose('idle', 5.575, 0).blink).toBeCloseTo(1)
    expect(facePose('idle', 5.8, 0).blink).toBe(0)
    for (const t of [0, 1, 5.57, 500]) expect(Object.values(facePose('listening', t, 0)).every(Number.isFinite)).toBe(true)
  })
})

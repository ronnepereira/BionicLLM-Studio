import { describe, expect, it } from 'vitest'
import { articulateFace, EYES, FACE_TRIANGLES, FACE_VERTICES, projectFace } from '../wire-face-geometry'
import { facePose } from '../hologram-face'
const rest = { yaw: 0, pitch: 0, blink: 0, mouth: 0, brow: 0 }

describe('approved wire face articulation', () => {
  it('contains only the fixed facial topology and preserves the approved rest shape', () => {
    expect(FACE_VERTICES).toHaveLength(468)
    expect(FACE_TRIANGLES).toHaveLength(898)
    expect(articulateFace(rest)).toEqual(FACE_VERTICES)
    for (const f of FACE_TRIANGLES) for (const i of f) expect(i >= 0 && i < 468).toBe(true)
  })
  it('opens the lip aperture and articulates the jaw without moving the forehead', () => {
    const spoken = articulateFace({ ...rest, mouth: 1 })
    const gap = (v: typeof spoken) => v[13][1] - v[14][1]
    expect(gap(spoken)).toBeGreaterThan(gap(articulateFace(rest)) + .5)
    expect(spoken[152][1]).toBeLessThan(FACE_VERTICES[152][1])
    expect(spoken[10]).toEqual(FACE_VERTICES[10])
  })
  it('closes the real upper/lower eyelids onto their shared line', () => {
    const closed = articulateFace({ ...rest, blink: 1 })
    for (const eye of EYES) for (let i = 0; i < eye.upper.length; i++) {
      expect(closed[eye.upper[i]][1]).toBeCloseTo(closed[eye.lower[eye.lower.length - 1 - i]][1], 8)
    }
  })
  it('keeps the existing lateral drift bounded and projections finite', () => {
    for (let t = 0; t < 60; t += .25) expect(Math.abs(facePose('idle', t, 0).yaw)).toBeLessThanOrEqual(.17)
    for (const t of [0, 1.5, 4.5, 5.575]) {
      const pose = facePose('speaking', t, .2)
      for (const v of articulateFace(pose)) expect(projectFace(v, pose).every(Number.isFinite)).toBe(true)
    }
  })
})

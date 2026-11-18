// Geometry derived from MediaPipe canonical_face_model.obj (Apache-2.0).
// Source/license and modification notice ship in public/licenses/mediapipe-face-*.
import canonical from './data/canonical-face.json'
import type { FacePose } from './hologram-face'

export type Vec3 = readonly [number, number, number]
export type Triangle = readonly [number, number, number]
export const gaussian = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) =>
  Math.exp(-(((x - cx) / sx) ** 2) - (((y - cy) / sy) ** 2))

/** Same sculpt and proportions as the approved code-rendered preview. */
export const FACE_VERTICES: readonly Vec3[] = canonical.vertices.map(([rawX, rawY, rawZ]) => {
  let x = rawX, y = rawY, z = rawZ
  for (const side of [-1, 1]) {
    const eye = gaussian(x, y, side * 3.15, 2.6, 2.1, 1.3)
    x += (x - side * 3.15) * .22 * eye
    y += (y - 2.6) * .30 * eye
  }
  const jaw = Math.max(0, Math.min(1, (-y - 1.5) / 8))
  x *= .88 - .18 * jaw
  const nose = gaussian(x, y, 0, -.8, 1.4, 2.5)
  x *= 1 - .10 * nose
  z += .18 * nose + .26 * gaussian(x, y, 0, -4.4, 2.7, .9)
  if (y > 4) { y = 4 + (y - 4) * 1.5; z -= Math.max(0, y - 7) * .65 }
  return [x, y, z] as Vec3
})
export const FACE_TRIANGLES = canonical.triangles as unknown as readonly Triangle[]
const edges = new Set<string>()
for (const f of FACE_TRIANGLES) for (let i = 0; i < 3; i++) {
  const a = f[i], b = f[(i + 1) % 3]
  edges.add([Math.min(a, b), Math.max(a, b)].join(','))
}
export const FACE_EDGES = [...edges].map(edge => edge.split(',').map(Number) as [number, number])
export const FACE_OUTLINE = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10]
export const EYES = [
  { upper: [33,246,161,160,159,158,157,173,133], lower: [133,155,154,153,145,144,163,7,33], brow: [70,63,105,66,107] },
  { upper: [362,398,384,385,386,387,388,466,263], lower: [263,249,390,373,374,380,381,382,362], brow: [336,296,334,293,300] },
]
export const LIPS_OUTER = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146,61]
export const LIPS_INNER = [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95,78]

// Eye iris/pupil landmark indices (around the eyeball center)
export const EYE_LEFT_IRIS = [468,469,470,471,472]
export const EYE_RIGHT_IRIS = [473,474,475,476,477]

const eyelidCenters = new Map<number, number>()
for (const eye of EYES) for (let i = 0; i < eye.upper.length; i++) {
  const a = eye.upper[i], b = eye.lower[eye.lower.length - 1 - i]
  const y = (FACE_VERTICES[a][1] + FACE_VERTICES[b][1]) / 2
  eyelidCenters.set(a, y); eyelidCenters.set(b, y)
}
const weights = FACE_VERTICES.map(([x, y]) => ({
  lip: gaussian(x, y, 0, -4.4, 3.1, 1.6),
  jaw: gaussian(x, y, 0, -7, 4, 2.8),
  brow: EYES.reduce((sum, eye) => {
    const center = FACE_VERTICES[eye.brow[2]]
    return sum + gaussian(x, y, center[0], center[1], 1.9, .8)
  }, 0),
}))

/** Articulation changes the actual mesh, including every eye/lip outline. */
export function articulateFace(pose: FacePose): Vec3[] {
  return FACE_VERTICES.map(([baseX, baseY, z], i) => {
    const w = weights[i]
    const x = baseX * (1 - pose.mouth * .07 * w.lip)
    let y = baseY + pose.brow * 7 * w.brow
    y += pose.mouth * w.lip * (baseY < -4.25 ? -1.05 : .22)
    y -= pose.mouth * .30 * w.jaw
    const lid = eyelidCenters.get(i)
    if (lid !== undefined) y += (lid - baseY) * pose.blink
    return [x, y, z] as Vec3
  })
}

export function projectFace([x, y, z]: Vec3, pose: FacePose): Vec3 {
  const rx = x * Math.cos(pose.yaw) + z * Math.sin(pose.yaw)
  const rz = z * Math.cos(pose.yaw) - x * Math.sin(pose.yaw)
  const ry = y * Math.cos(pose.pitch) - rz * Math.sin(pose.pitch)
  const depth = y * Math.sin(pose.pitch) + rz * Math.cos(pose.pitch)
  const perspective = 1 / (1 - depth / 85)
  return [rx * perspective, ry * perspective, depth]
}

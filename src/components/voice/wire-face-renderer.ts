import type { FacePose } from './hologram-face'
import { articulateFace, EYES, FACE_EDGES, FACE_OUTLINE, FACE_TRIANGLES, FACE_VERTICES, LIPS_INNER, LIPS_OUTER, projectFace } from './wire-face-geometry'
import type { Vec3, Triangle } from './wire-face-geometry'

function smooth(points: readonly Vec3[]): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)], b = points[i], c = points[i + 1], d = points[Math.min(points.length - 1, i + 2)]
    for (let n = 0; n < 6; n++) {
      const t = n / 6, t2 = t * t, t3 = t2 * t
      out.push(b.map((v, j) => .5 * (2 * v + (-a[j] + c[j]) * t + (2 * a[j] - 5 * v + 4 * c[j] - d[j]) * t2 + (-a[j] + 3 * v - 3 * c[j] + d[j]) * t3)) as unknown as Vec3)
    }
  }
  out.push(points[points.length - 1])
  return out
}
const scalp = Array.from({ length: 21 }, (_, r) => Array.from({ length: 49 }, (_, j): Vec3 => {
  const latitude = r / 20 * Math.PI, a = j / 48 * 2 * Math.PI
  return [7.1 * Math.sin(latitude) * Math.sin(a), 1.2 + 10.2 * Math.cos(latitude), -1.3 + 7.3 * Math.sin(latitude) * Math.cos(a)]
}))
// Quantized shading keeps the relief while batching the 898 facial triangles.
const shading: Triangle[][] = Array.from({ length: 14 }, () => [])
for (const f of FACE_TRIANGLES) {
  const [a, b, c] = f.map(i => FACE_VERTICES[i])
  const u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i])
  const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const light = Math.abs((normal[0] * -.45 + normal[1] * .35 + normal[2] * .82) / (Math.hypot(...normal) || 1))
  shading[Math.min(13, Math.floor(light * 14))].push(f)
}

/** Canvas rendering of the approved 3D face. No ears, neck, texture or downloads. `ink` overrides the default face colour (RGB string). */
export function drawWireFace(ctx: CanvasRenderingContext2D, width: number, height: number, pose: FacePose, dark: boolean, ink?: string) {
  ctx.clearRect(0, 0, width, height)
  if (width <= 0 || height <= 0) return
  const scale = Math.min(width / 17, height / 24.5)
  const faceInk = ink ?? (dark ? '200,200,200' : '12,108,163')
  const toScreen = (v: Vec3): Vec3 => {
    const p = projectFace(v, pose)
    return [width / 2 + p[0] * scale, height * .51 - p[1] * scale, p[2]]
  }
  const path = (points: readonly Vec3[]) => points.forEach((v, i) => { if (i) ctx.lineTo(v[0], v[1]); else ctx.moveTo(v[0], v[1]) })
  const stroke = (alpha: number, weight: number) => {
    ctx.strokeStyle = `rgba(${faceInk},${alpha})`; ctx.lineWidth = weight; ctx.stroke()
  }
  const line = (points: readonly Vec3[], alpha: number, weight: number) => {
    ctx.beginPath(); path(points.map(toScreen)); stroke(alpha, weight)
  }
  const unit = Math.max(.55, Math.min(1.15, scale / 27))
  // Scalp/hair base
  ctx.beginPath()
  scalp.forEach(row => path(row.map(toScreen)))
  for (let j = 0; j <= 48; j++) path(scalp.map(row => toScreen(row[j])))
  stroke(dark ? .12 : .18, .6 * unit)

  const articulated = articulateFace(pose)
  const points = articulated.map(toScreen)

  // Dark mouth cavity visible through inner-lip boundary
  ctx.beginPath(); path(smooth(LIPS_INNER.map(i => articulated[i])).map(toScreen)); ctx.closePath()
  ctx.fillStyle = dark ? '#080808' : '#164052'; ctx.fill()

  // Shaded facial surface with more levels for rounder relief
  for (let bucket = 0; bucket < shading.length; bucket++) {
    ctx.beginPath()
    for (const f of shading[bucket]) { path(f.map(i => points[i])); ctx.closePath() }
    const light = (bucket + .5) / 14
    // Self-shadow: nose/cheek area gets slightly darker on side areas
    const selfShadow = light > 0.5 ? 0.06 * (light - 0.5) : 0
    ctx.fillStyle = dark
      ? `rgb(${[1, 2, 3].map(() => Math.round(8 + light * 22 - selfShadow * 40)).join(',')})`
      : `rgb(${Math.round(225 + light * 16 - selfShadow * 40)},${Math.round(238 + light * 14 - selfShadow * 30)},${Math.round(244 + light * 10 - selfShadow * 40)})`
    ctx.fill()
  }

  // Specular highlights on forehead/nose/chin (subtle shine)
  const shinePoints = [1, 151, 2, 326, 327, 199]
  ctx.beginPath()
  for (const idx of shinePoints) {
    const p = points[idx]
    ctx.moveTo(p[0] + unit * 0.6, p[1])
    ctx.arc(p[0], p[1], unit * 0.6, 0, Math.PI * 2)
  }
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.18)'
  ctx.fill()

  // Face edges/wireframe
  ctx.beginPath()
  for (const [a, b] of FACE_EDGES) path([points[a], points[b]])
  stroke(dark ? .55 : .58, .75 * unit)
  // Mesh overlay triangles
  ctx.beginPath()
  for (const f of FACE_TRIANGLES) {
    const p = f.map(i => points[i])
    const mid = p.map((a, i) => a.map((v, j) => (v + p[(i + 1) % 3][j]) / 2) as unknown as Vec3)
    path([...mid, mid[0]])
  }
  stroke(dark ? .24 : .30, .5 * unit)

  // Face outline
  line(smooth(FACE_OUTLINE.map(i => articulated[i])), .76, 1.05 * unit)

  // Eyes: iris/pupil + lids + brows
  for (const eye of EYES) {
    const corners = [articulated[eye.upper[0]], articulated[eye.upper[eye.upper.length - 1]]]
    const eyeX = (corners[0][0] + corners[1][0]) / 2, eyeY = (corners[0][1] + corners[1][1]) / 2

    // Pupil (simple dot at eye center, slightly offset with gaze)
    const pPupil = toScreen([eyeX + pose.yaw * 0.6, eyeY + pose.pitch * 0.6, 4.2] as Vec3)
    ctx.beginPath()
    ctx.arc(pPupil[0], pPupil[1], unit * 0.3, 0, Math.PI * 2)
    ctx.fillStyle = '#000000'
    ctx.fill()

    if (pose.blink < .85) {
      ctx.beginPath()
      for (const radius of [.15, .30, .43]) path(Array.from({ length: 41 }, (_, i): Vec3 => {
        const a = i / 40 * Math.PI * 2
        return toScreen([eyeX + Math.cos(a) * radius, eyeY + Math.sin(a) * radius * (1 - pose.blink), 4 + Math.sqrt(Math.max(0, .46 ** 2 - radius ** 2))] as Vec3)
      }))
      stroke(.75, .7 * unit)
      ctx.beginPath()
      for (let j = 0; j < 20; j++) {
        const a = j / 20 * Math.PI * 2
        const spoke: Vec3[] = [[eyeX + Math.cos(a) * .18, eyeY + Math.sin(a) * .18 * (1 - pose.blink), 4.35], [eyeX + Math.cos(a) * .43, eyeY + Math.sin(a) * .43 * (1 - pose.blink), 4.17]]
        path(spoke.map(toScreen))
      }
      stroke(.35, .5 * unit)
    }
    line(smooth(eye.upper.map(i => articulated[i])), .95, 1.15 * unit)
    line(smooth(eye.lower.map(i => articulated[i])), .8, .9 * unit)

    // Independent eyebrows using pose.browLeft / browRight
    const browSide = (eye === EYES[0] ? pose.browLeft : pose.browRight) ?? pose.brow
    const brow = eye.brow.map(i => { const p = articulated[i]; return [p[0], p[1] + browSide * 7, p[2]] as Vec3 })
    line(smooth(brow), .8, 1.2 * unit)
    line(smooth(brow.map(p => [p[0], p[1] + .18, p[2] - .05])), .48, .7 * unit)
  }

  // Lips
  line(smooth(LIPS_OUTER.map(i => articulated[i])), .85, unit)
  line(smooth(LIPS_INNER.map(i => articulated[i])), .72, .8 * unit)
  line(smooth([98,97,2,326,327].map(i => articulated[i])), .73, .85 * unit)

  // Subsurface scatter dots (skin texture hints)
  ctx.beginPath()
  for (let i = 0; i < points.length; i += 5) { const p = points[i]; ctx.moveTo(p[0] + unit * 0.5, p[1]); ctx.arc(p[0], p[1], unit * 0.5, 0, Math.PI * 2) }
  ctx.fillStyle = `rgba(${faceInk},.45)`; ctx.fill()
}

import { useEffect, useRef } from 'react'
import { voiceLevels } from '../../api/voice-session'
import { facePose } from './hologram-face'
import { drawWireFace } from './wire-face-renderer'
import type { VoiceMood } from './VoiceWaves'
import { LIGHT } from './VoiceWaves'

interface Props { mood: VoiceMood; paused: boolean }

/** The approved floating 3D face, drawn from geometry and articulated by audio. */
export function VoiceHologram({ mood, paused }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const controls = useRef({ mood, paused })
  const restartRef = useRef<(() => void) | null>(null)
  useEffect(() => { controls.current = { mood, paused }; restartRef.current?.() }, [mood, paused])

  useEffect(() => {
    const node = canvas.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const ctx = node.getContext('2d')
    if (!ctx) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let alive = true
    let frame = 0
    let last = 0
    let elapsed = 0
    let level = 0
    let inView = true
    let width = 0
    let height = 0
    const still = () => controls.current.paused || media.matches
    const visible = () => !document.hidden && inView && node.clientWidth > 0 && node.clientHeight > 0
    const tick = (ms: number) => {
      frame = 0
      if (!alive || !visible()) { last = 0; return }
      if (last && ms - last < 32) { frame = requestAnimationFrame(tick); return }
      elapsed += last ? Math.min((ms - last) / 1000, 0.1) : 0
      last = ms
      const current = controls.current.mood
      const dark = document.documentElement.classList.contains('dark')
      const ink = (dark ? [210, 210, 210] : LIGHT[current]).join(',')
      const raw = still() || current !== 'speaking' ? 0 : voiceLevels().bot
      level += (raw - level) * (raw > level ? 0.65 : 0.3)
      drawWireFace(ctx, width, height, facePose(current, elapsed, level, still()), dark, ink)
      if (!still()) frame = requestAnimationFrame(tick)
    }
    const restart = () => {
      cancelAnimationFrame(frame); frame = 0; last = 0
      if (alive && visible()) tick(performance.now())
    }
    const resize = () => {
      width = node.clientWidth; height = node.clientHeight
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      node.width = Math.max(1, Math.round(width * ratio)); node.height = Math.max(1, Math.round(height * ratio))
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      restart()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(node)
    const intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting; restart()
    })
    intersection?.observe(node)
    const theme = new MutationObserver(restart)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    restartRef.current = restart
    media.addEventListener('change', restart)
    document.addEventListener('visibilitychange', restart)
    resize()
    return () => {
      alive = false; restartRef.current = null
      cancelAnimationFrame(frame); observer.disconnect(); intersection?.disconnect(); theme.disconnect()
      media.removeEventListener('change', restart)
      document.removeEventListener('visibilitychange', restart)
    }
  }, [])

  return <canvas ref={canvas} aria-hidden="true" data-testid="voice-hologram" data-mood={mood}
    data-renderer="canvas-3d" className="block w-full max-w-lg mx-auto min-h-0 h-[clamp(140px,44vh,420px)]" />
}

import { useEffect, useRef } from 'react'
import { useRadioStore } from '../../stores/radioStore'
import { useUiText } from '../../lib/ui-text'

/** Read real FFT bins without publishing animation frames into React state. */
export function RadioSpectrum({ expanded = false }: { expanded?: boolean }) {
  const text = useUiText()
  const analyser = useRadioStore(state => state.analyser)
  const playing = useRadioStore(state => state.status === 'playing')
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    if (!element || !analyser || !playing) return
    const drawing = element.getContext('2d')
    if (!drawing) return
    const bins = new Uint8Array(analyser.frequencyBinCount)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0, previous = 0
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw)
      if (time - previous < (reduced ? 500 : 40)) return
      previous = time
      const rect = element.getBoundingClientRect()
      const scale = window.devicePixelRatio || 1
      const width = Math.round(rect.width * scale), height = Math.round(rect.height * scale)
      if (element.width !== width || element.height !== height) { element.width = width; element.height = height }
      drawing.clearRect(0, 0, width, height)
      analyser.getByteFrequencyData(bins)
      drawing.fillStyle = getComputedStyle(element).color
      const bars = expanded ? 40 : 18
      const gap = 2 * scale, barWidth = Math.max(scale, width / bars - gap)
      for (let bar = 0; bar < bars; bar++) {
        const from = Math.floor(Math.pow(bar / bars, 1.8) * bins.length)
        const to = Math.max(from + 1, Math.floor(Math.pow((bar + 1) / bars, 1.8) * bins.length))
        let energy = 0
        for (let index = from; index < to; index++) energy += bins[index]
        const amplitude = energy / (to - from) / 255
        const barHeight = Math.max(scale, amplitude * height)
        // Mirror the bands: higher frequencies on the left, bass on the right.
        drawing.fillRect((bars - 1 - bar) * (barWidth + gap), height - barHeight, barWidth, barHeight)
      }
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); drawing.clearRect(0, 0, element.width, element.height) }
  }, [analyser, playing, expanded])
  if (!analyser || !playing) return null
  return <canvas ref={canvas} role="img" aria-label={text('Live audio spectrum')} className={`${expanded ? 'h-8 w-full' : 'h-3 w-16 shrink-0'} text-blue-500`} />
}

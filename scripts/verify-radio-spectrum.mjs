// Real Web Audio/FFT, driven by a deterministic changing tone rather than simulated bars.
import { chromium, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
const rate = 22050, seconds = 16
const wav = Buffer.alloc(44 + rate * seconds * 2)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
for (let i = 0; i < rate * seconds; i++) {
  const time = i / rate
  const frequency = 220 + (Math.floor(time * 4) % 8) * 440
  const amplitude = 0.1 + 0.65 * (0.5 + 0.5 * Math.sin(time * 7))
  wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * time) * amplitude * 32767), 44 + i * 2)
}
const browser = await chromium.launch({ headless: true })
try {
  async function fixture(cors) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    await page.addInitScript(() => localStorage.setItem('chat-settings', JSON.stringify({ version: 0, state: { settings: { onboardingDone: true, language: 'pt-BR' } } })))
    if (!cors) await page.addInitScript(() => {
      const NativeAudio = window.Audio
      window.Audio = function (...args) {
        const player = new NativeAudio(...args)
        const play = player.play.bind(player)
        // Force the same rejected media attempt as a CORS-denied stream; fallback still decodes real audio.
        player.play = () => player.crossOrigin === 'anonymous' ? Promise.reject(new DOMException('CORS test rejection', 'NotSupportedError')) : play()
        return player
      }
    })
    await page.route('https://stream.nightride.fm/**', route => route.fulfill({ status: 200, headers: { 'Content-Type': 'audio/wav', ...(cors ? { 'Access-Control-Allow-Origin': '*' } : {}) }, body: wav }))
    await page.goto('http://127.0.0.1:5274/')
    await page.getByRole('button', { name: 'Webradio', exact: true }).click()
    await page.getByRole('button', { name: 'Reproduzir rádio', exact: true }).click()
    const radio = page.getByRole('region', { name: 'Estações de rádio', exact: true })
    await expect(radio.getByRole('status')).toHaveText('Rádio ao vivo', { timeout: 10000 })
    return { page, radio }
  }
  const { page, radio } = await fixture(true)
  const canvas = radio.getByRole('img', { name: 'Espectro do áudio ao vivo', exact: true })
  await expect(canvas).toBeVisible()
  const sample = () => canvas.evaluate(element => {
    const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data
    let aboveBaseline = 0, hash = 0
    for (let i = 3; i < pixels.length - element.width * 4 * 2; i += 4) { if (pixels[i]) aboveBaseline++; hash = (hash * 31 + pixels[i]) | 0 }
    return { aboveBaseline, hash }
  })
  await expect.poll(async () => (await sample()).aboveBaseline).toBeGreaterThan(0)
  const initial = (await sample()).hash
  await expect.poll(async () => (await sample()).hash, { timeout: 5000 }).not.toBe(initial)
  const compact = page.getByRole('img', { name: 'Espectro do áudio ao vivo', exact: true }).first()
  const spectrumBox = await compact.boundingBox()
  const pauseBox = await page.getByRole('button', { name: 'Pausar rádio', exact: true }).boundingBox()
  expect(spectrumBox.x + spectrumBox.width).toBeLessThanOrEqual(pauseBox.x)
  await page.screenshot({ path: fileURLToPath(new URL('../docs/bionic-preview/47-webradio-barras-antes-pausa.png', import.meta.url)), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Pausar rádio', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Espectro do áudio ao vivo', exact: true })).toHaveCount(0)
  await page.close()
  const fallback = await fixture(false)
  await expect(fallback.radio.getByText('Esta estação não disponibiliza a análise do áudio. A reprodução continua sem o espectro.')).toBeVisible()
  await expect(fallback.page.getByRole('img', { name: 'Espectro do áudio ao vivo', exact: true })).toHaveCount(0)
  await fallback.page.close()
  console.log('FFT real responde ao áudio, barras mudam, pausa remove animação e estação sem CORS continua tocando sem visualização fictícia.')
} finally { await browser.close() }

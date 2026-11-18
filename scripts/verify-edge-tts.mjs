import { chromium, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push(request.url()))
  await page.addInitScript(() => {
    if (localStorage.getItem('edge-test-fixture')) return
    localStorage.setItem('chat-settings', JSON.stringify({ version: 0, state: { settings: { onboardingDone: true, language: 'pt-BR' } } }))
    localStorage.setItem('locally-uncensored-voice', JSON.stringify({ version: 0, state: { ttsMode: 'external', externalTtsUrl: 'http://localhost:9988/v1/audio/speech', externalTtsVoice: 'my-voice' } }))
    localStorage.setItem('edge-test-fixture', 'true')
  })
  const openVoice = async () => {
    await page.locator('header').getByRole('button', { name: 'Configurações', exact: true }).click()
    await page.getByRole('button', { name: 'Voz e acesso remoto', exact: true }).first().click()
  }
  await page.goto('http://127.0.0.1:5274/')
  await openVoice()
  await page.getByRole('button', { name: 'EdgeTTS', exact: true }).click()
  await expect(page.getByText(/O texto selecionado para leitura é enviado à Microsoft/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Instalar EdgeTTS', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Testar voz', exact: true })).toBeDisabled()
  await page.getByLabel('Voz do EdgeTTS', { exact: true }).selectOption('pt-BR-AntonioNeural')
  await page.getByLabel('Velocidade da fala', { exact: true }).selectOption('90')
  await page.getByRole('switch', { name: 'Habilitar leitura em voz alta', exact: true }).click()
  const preferences = await page.evaluate(() => JSON.parse(localStorage.getItem('locally-uncensored-voice')).state)
  expect(preferences).toMatchObject({ ttsMode: 'edge', edgeVoice: 'pt-BR-AntonioNeural', edgeRate: 90, autoReadAloud: false, externalTtsUrl: 'http://localhost:9988/v1/audio/speech', externalTtsVoice: 'my-voice' })
  await page.screenshot({ path: fileURLToPath(new URL('../docs/bionic-preview/19-edgetts-portugues.png', import.meta.url)), fullPage: true })
  await page.reload()
  await openVoice()
  await expect(page.getByRole('button', { name: 'EdgeTTS', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Voz do EdgeTTS', { exact: true })).toHaveValue('pt-BR-AntonioNeural')
  await expect(page.getByLabel('Velocidade da fala', { exact: true })).toHaveValue('90')
  await page.getByRole('button', { name: 'HTTP externo', exact: true }).click()
  await expect(page.getByPlaceholder('http://localhost:8880/v1/audio/speech', { exact: true })).toHaveValue('http://localhost:9988/v1/audio/speech')
  await page.getByRole('button', { name: 'EdgeTTS', exact: true }).click()
  await page.setViewportSize({ width: 600, height: 1000 })
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600)
  const decoded = {}
  for (const voice of ['francisca', 'antonio']) {
    const base64 = readFileSync(new URL(`../docs/bionic-preview/edge-tts-${voice}.mp3`, import.meta.url)).toString('base64')
    decoded[voice] = await page.evaluate(async base64 => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
      const context = new AudioContext()
      try {
        const audio = await context.decodeAudioData(bytes.buffer)
        return { duration: audio.duration, channels: audio.numberOfChannels, audibleSignal: audio.getChannelData(0).some(sample => Math.abs(sample) > 0.01) }
      } finally { await context.close() }
    }, base64)
    expect(decoded[voice].duration).toBeGreaterThan(2)
    expect(decoded[voice].audibleSignal).toBe(true)
  }
  expect(requests.some(url => /speech\.platform\.bing\.com|speech\.microsoft\.com/.test(url))).toBe(false)
  expect(errors).toEqual([])
  console.log(JSON.stringify({ preferencesPersisted: true, externalProviderPreserved: true, noAutomaticSpeechRequests: true, desktopOnlyPreview: true, compact: true, realAudioDecoded: decoded }))
} finally { await browser.close() }

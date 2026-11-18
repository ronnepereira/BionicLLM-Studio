import { chromium, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const errors = [], streams = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('stream.nightride.fm/')) streams.push(request.url()) })
  await page.addInitScript(() => {
    if (!localStorage.getItem('bionic-footer-test')) {
      localStorage.setItem('chat-settings', JSON.stringify({ version: 0, state: { settings: { onboardingDone: true, language: 'pt-BR' } } }))
      localStorage.setItem('bionic-footer-test', 'true')
    }
  })
  await page.goto('http://127.0.0.1:5274/')
  const footer = page.getByLabel('Barra de status do Studio', { exact: true })
  await expect(footer).toBeVisible()
  expect(streams).toEqual([])
  await expect(footer.getByText('CPU —', { exact: true })).toBeVisible()
  await expect(footer.getByText('RAM —', { exact: true })).toBeVisible()
  await footer.getByRole('button', { name: 'Webradio', exact: true }).click()
  const radio = page.getByRole('region', { name: 'Estações de rádio', exact: true })
  await expect(radio).toBeVisible()
  await footer.getByRole('button', { name: 'Reproduzir rádio', exact: true }).click()
  await expect(radio.getByRole('status')).toHaveText('Rádio ao vivo', { timeout: 20000 })
  expect(streams.length).toBeGreaterThan(0)
  await radio.getByRole('slider', { name: 'Volume da rádio' }).fill('0.2')
  await expect(radio.getByText('20%', { exact: true })).toBeVisible()
  await page.screenshot({ path: fileURLToPath(new URL('../docs/bionic-preview/12-webradio-status.png', import.meta.url)), fullPage: true, animations: 'disabled' })
  await footer.getByRole('button', { name: 'Pausar rádio', exact: true }).click()
  await expect(radio.getByRole('status')).toHaveText('Rádio parada')
  await page.reload()
  await expect(footer.getByRole('button', { name: 'Reproduzir rádio', exact: true })).toBeVisible()
  await footer.getByRole('button', { name: 'Webradio', exact: true }).click()
  await expect(page.getByRole('slider', { name: 'Volume da rádio' })).toHaveValue('0.2')
  await page.setViewportSize({ width: 600, height: 1000 })
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600)
  expect(errors).toEqual([])
  console.log('Reprodução MP3 real, volume, pausa, preferências sem autoplay, métricas indisponíveis sem números fictícios e responsividade verificados.')
} finally { await browser.close() }

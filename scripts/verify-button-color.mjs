import { chromium, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    if (localStorage.getItem('button-color-fixture')) return
    // Same-version old profile: the new field must be filled without migration.
    localStorage.setItem('chat-settings', JSON.stringify({ version: 23, state: { settings: { onboardingDone: true, language: 'pt-BR', theme: 'dark', temperature: 0.8, apiEndpoint: 'http://localhost:11434' }, personas: [], activePersonaId: '' } }))
    localStorage.setItem('button-color-fixture', 'true')
  })
  const rootToken = name => page.evaluate(name => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), name)
  const settings = async () => {
    await page.locator('header').getByRole('button', { name: 'Configurações', exact: true }).click()
    const color = page.getByLabel('Cor dos botões', { exact: true })
    if (!(await color.isVisible())) await page.getByRole('button', { name: 'Aparência', exact: true }).last().click()
    await expect(color).toBeVisible()
    return color
  }
  await page.goto('http://127.0.0.1:5274/')
  let color = await settings()
  await expect(color).toHaveValue('#1f6feb')
  expect(await rootToken('--color-lu-accent')).toBe('#1f6feb')
  const scale = page.getByLabel('Escala da interface (zoom)', { exact: true })
  await expect(scale).toHaveValue('115')
  let baseHeight
  for (const value of [100, 110, 115, 120, 125, 130, 135, 140, 145, 150]) {
    await scale.selectOption(String(value))
    await expect.poll(() => rootToken('--ui-scale')).toBe(String(value / 100))
    const box = await color.boundingBox()
    if (value === 100) baseHeight = box.height
    expect(box.height).toBeCloseTo(baseHeight * value / 100, 0)
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 1440)
  }
  await page.reload()
  color = await settings()
  await expect(page.getByLabel('Escala da interface (zoom)', { exact: true })).toHaveValue('150')
  await page.getByLabel('Escala da interface (zoom)', { exact: true }).selectOption('115')
  await page.screenshot({ path: fileURLToPath(new URL('../docs/bionic-preview/15-aparencia-azul.png', import.meta.url)), fullPage: true })
  await color.fill('#ffff00')
  await expect.poll(() => rootToken('--color-lu-accent')).toBe('#ffff00')
  expect(await rootToken('--color-lu-on-accent')).toBe('#000000')
  await page.reload()
  color = await settings()
  await expect(color).toHaveValue('#ffff00')
  await page.getByRole('button', { name: 'Claro', exact: true }).click()
  await expect(page.locator('html')).toHaveClass(/light/)
  expect(await rootToken('--color-lu-accent')).toBe('#ffff00')
  await page.getByRole('button', { name: 'Restaurar azul padrão', exact: true }).click()
  await expect(color).toHaveValue('#1f6feb')
  expect(await rootToken('--color-lu-on-accent')).toBe('#ffffff')
  await page.setViewportSize({ width: 600, height: 1000 })
  await page.getByLabel('Escala da interface (zoom)', { exact: true }).selectOption('150')
  await expect(color).toBeVisible()
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('chat-settings')).state.settings)
  expect(saved.temperature).toBe(0.8)
  expect(saved.apiEndpoint).toBe('http://localhost:11434')
  expect(errors).toEqual([])
  console.log('Cores e escalas de 100 até 150%, perfil antigo, contraste, persistência, restauração e tela compacta verificados.')
} finally { await browser.close() }

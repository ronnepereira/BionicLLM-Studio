// Isolated browser profile; does not read or change the user's app data.
// Run against the production preview: npm run preview -- --port 5274
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const output = new URL('../docs/bionic-preview/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const capture = async (name) => {
    // Allow React's opacity entrance to settle before capturing the actual UI.
    await page.waitForTimeout(500)
    await page.screenshot({ path: fileURLToPath(new URL(name, output)), fullPage: true, animations: 'disabled' })
  }
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    if (localStorage.getItem('bionic-preview-seeded')) return
    localStorage.setItem('chat-settings', JSON.stringify({
      version: 0,
      state: { settings: { onboardingDone: true, language: 'pt-BR' } },
    }))
    localStorage.setItem('lu_release_notes', JSON.stringify({ version: 0, state: { lastNotesVersion: '3.0.8' } }))
    localStorage.setItem('bionic-preview-seeded', 'true')
  })
  await page.goto('http://127.0.0.1:5274/')
  await page.getByRole('button', { name: 'Configurações', exact: true }).waitFor()
  await capture('01-chat.png')
  await page.getByRole('button', { name: 'Configurações', exact: true }).click()
  await page.getByRole('button', { name: 'Aparência', exact: true }).click()
  await page.getByLabel('Idioma', { exact: true }).waitFor({ state: 'visible' })
  await capture('02-idioma.png')
  await page.getByLabel('Idioma', { exact: true }).selectOption('en')
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor()
  if (await page.locator('html').getAttribute('lang') !== 'en') throw new Error('Language was not restored after reload')
  await page.setViewportSize({ width: 600, height: 800 })
  await page.getByRole('button', { name: 'Main navigation', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).waitFor()
  await capture('03-navegacao-compacta.png')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('Verified Portuguese navigation, language selection, persistence after reload, and compact menu. Screenshots: docs/bionic-preview/')
} finally {
  await browser.close()
}

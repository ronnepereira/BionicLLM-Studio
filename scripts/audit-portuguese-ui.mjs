/* global document, NodeFilter */
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const output = new URL('../docs/localization/', import.meta.url)
const catalog = JSON.parse(readFileSync(new URL('../src/lib/locales/pt-BR.json', import.meta.url), 'utf8'))
const english = Object.fromEntries(Object.entries(catalog).filter(([key, value]) => key.trim() !== value.trim()).map(([key, value]) => [key.trim(), value.trim()]))
const browser = await chromium.launch({ headless: true })
const findings = []
const views = []
const visibleCopy = {}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    localStorage.setItem('chat-settings', JSON.stringify({ version: 0, state: { settings: { onboardingDone: true, language: 'pt-BR' } } }))
    localStorage.setItem('lu_release_notes', JSON.stringify({ version: 0, state: { lastNotesVersion: '3.0.8' } }))
  })
  async function scan(view) {
    await page.waitForTimeout(300)
    const misses = await page.evaluate((english) => {
      const found = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        const text = node.textContent.trim()
        if (Object.hasOwn(english, text) && node.parentElement.getClientRects().length) found.push({ text, translation: english[text], kind: 'text', html: node.parentElement.outerHTML.slice(0, 500) })
      }
      for (const element of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
        if (!element.getClientRects().length) continue
        for (const name of ['title', 'aria-label', 'placeholder']) {
          const text = element.getAttribute(name)?.trim()
          if (text && Object.hasOwn(english, text)) found.push({ text, translation: english[text], kind: name })
        }
      }
      return found
    }, english)
    visibleCopy[view] = await page.locator('body').innerText()
    writeFileSync(new URL('visible-copy.json', output), JSON.stringify(visibleCopy, null, 2) + '\n')
    findings.push(...misses.map(item => ({ view, ...item })))
    views.push(view)
    writeFileSync(new URL('browser-audit.json', output), JSON.stringify({ views, findings }, null, 2) + '\n')
  }
  await page.goto('http://127.0.0.1:5274/')
  await page.getByRole('button', { name: 'Configurações', exact: true }).waitFor()
  await scan('chat')
  await page.locator('aside').getByRole('button', { name: 'Acesso remoto', exact: true }).click()
  await scan('Acesso remoto')
  await page.locator('aside').getByRole('button', { name: 'Chat', exact: true }).click()
  for (const name of ['Criar', 'Voz', 'Comparar', 'Benchmark', 'Modelos', 'Habilidades', 'Agentes', 'Agenda', 'Configurações']) {
    const area = ['Habilidades', 'Agentes', 'Agenda'].includes(name) ? 'aside' : 'header'
    await page.locator(area).getByRole('button', { name, exact: true }).click()
    await scan(name)
  }
  for (const tab of ['Geral', 'Mecanismos de IA', 'Agente', 'Voz e acesso remoto', 'Sobre']) {
    await page.getByRole('button', { name: tab, exact: true }).first().click()
    await page.waitForTimeout(100)
    const buttons = page.locator('button[aria-controls^="set-"]')
    for (let index = 0; index < await buttons.count(); index++) {
      const button = buttons.nth(index)
      if (await button.getAttribute('aria-expanded') === 'false') await button.click()
    }
    await scan(`Configurações/${tab}`)
  }
  mkdirSync(output, { recursive: true })
  writeFileSync(new URL('browser-audit.json', output), JSON.stringify({ views, findings }, null, 2) + '\n')
  console.log(JSON.stringify({ views: views.length, untranslatedKnownStrings: findings.length, report: fileURLToPath(new URL('browser-audit.json', output)) }))
  if (findings.length) process.exitCode = 1
} finally {
  await browser.close()
}

// Windows desktop acceptance: actual WebView2 + Rust bridge, no model or account login.
import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdtempSync, openSync, closeSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') throw new Error('Este teste requer Windows e WebView2.')
const root = fileURLToPath(new URL('..', import.meta.url))
const exe = join(root, 'src-tauri/target/debug/BionicLLM Studio.exe')
if (!existsSync(exe)) throw new Error('Compile antes com: npx tauri build --debug --no-bundle -- --locked -j 1')
const peImage = readFileSync(exe)
const peOffset = peImage.readUInt32LE(0x3c)
expect(peImage.readUInt16LE(peOffset + 24 + 68)).toBe(2) // IMAGE_SUBSYSTEM_WINDOWS_GUI
const oldFiles = [
  join(process.env.APPDATA, 'Locally Uncensored/store_backup.json'),
  join(process.env.APPDATA, 'Locally Uncensored/onboarding_done'),
  join(process.env.APPDATA, 'locally-uncensored/config.json'),
  join(process.env.LOCALAPPDATA, 'lu-labs/stores/store_backup.json'),
  join(process.env.LOCALAPPDATA, 'lu-labs/lu_extra_model_paths.yaml'),
]
const snapshot = () => oldFiles.map(path => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null)
const before = snapshot()
const folder = mkdtempSync(join(tmpdir(), 'bionic-desktop-acceptance-'))
const listener = createServer()
await new Promise((ok, fail) => listener.once('error', fail).listen(0, '127.0.0.1', ok))
const port = listener.address().port
await new Promise(ok => listener.close(ok))
const out = openSync(join(folder, 'desktop.stdout.log'), 'a'), err = openSync(join(folder, 'desktop.stderr.log'), 'a')
const child = spawn(exe, [], {
  cwd: join(root, 'src-tauri/target/debug'), windowsHide: true, stdio: ['ignore', out, err],
  env: { ...process.env, BIONICLLM_SKIP_SERVICE_AUTOSTART: '1', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
})
closeSync(out); closeSync(err)
let browser, main, chatProof = null
try {
  let connected = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Desktop encerrou (${child.exitCode}). Consulte ${folder}`)
    try {
      const health = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })
      if (health.ok) { connected = true; break }
    } catch {}
    await new Promise(ok => setTimeout(ok, 1000))
  }
  if (!connected) throw new Error(`WebView2 não ficou disponível. Consulte ${folder}`)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const context = browser.contexts()[0]
  // WebView2 can expose a transient boot/onboarding target before main.
  await expect.poll(async () => {
    for (const page of context.pages()) {
      const label = await page.evaluate(() => window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label).catch(() => '')
      if (label === 'main') { main = page; return true }
    }
    return false
  }, { timeout: 30000 }).toBe(true)
  await main.evaluate(async () => {
    const blob = JSON.parse(localStorage.getItem('chat-settings') || '{"state":{"settings":{}}}')
    blob.version = 0
    blob.state.settings = { ...blob.state.settings, onboardingDone: true, language: 'pt-BR' }
    localStorage.setItem('chat-settings', JSON.stringify(blob))
    const ui = JSON.parse(localStorage.getItem('locally-uncensored-ui') || '{"version":1,"state":{}}')
    ui.state.sidebarOpen = true
    localStorage.setItem('locally-uncensored-ui', JSON.stringify(ui))
    await window.__TAURI_INTERNALS__.invoke('set_onboarding_done', { done: true })
  })
  await main.reload()
  await expect(main.locator('header').getByRole('button', { name: 'Configurações', exact: true })).toBeVisible({ timeout: 30000 })
  if (process.argv.includes('--restore-native')) {
    await main.locator('header').getByRole('button', { name: 'Configurações', exact: true }).click()
    await main.getByRole('button', { name: 'Mecanismos de IA', exact: true }).click()
    const providers = main.locator('#set-providers')
    if (await providers.getByRole('button', { name: 'Provedores', exact: true }).getAttribute('aria-expanded') !== 'true') {
      await providers.getByRole('button', { name: 'Provedores', exact: true }).click()
    }
    await providers.getByRole('button', { name: 'Adicionar provedor', exact: true }).click()
    await providers.getByRole('button', { name: /^LU Engine/ }).last().click()
    await expect(main.getByRole('button', { name: 'Motor LU (especialista)', exact: true })).toBeVisible()
    const slot = await main.evaluate(() => {
      const config = JSON.parse(localStorage.getItem('lu-providers')).state.providers.openai
      return { managed: config.managed, enabled: config.enabled }
    })
    expect(slot.managed).toBe(true)
    expect(slot.enabled).toBe(true)
    await main.screenshot({ path: join(root, 'docs/bionic-preview/52-motor-nativo-recuperado.png'), fullPage: true })
  }
  const native = await main.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke
    const logs = await invoke('log_file_path')
    const engine = await invoke('bundled_engine_status')
    const workspaces = await invoke('list_agent_workspaces')
    const skills = await invoke('studio_skills_scan', { chooseFolder: false })
    return { logs, engine, workspaceCount: workspaces.length, skillCount: skills.skills.length, skillScanLimited: skills.limited }
  })
  expect(resolve(native.logs.dir)).toBe(resolve(process.env.LOCALAPPDATA, 'bionicllm-studio/logs'))
  expect(native.engine.running).toBe(false)
  expect(native.skillCount).toBeGreaterThan(0)
  if (process.argv[2]) {
    const modelPath = resolve(process.argv[2])
    const alias = basename(modelPath, '.gguf')
    if (process.argv[3] !== '--cold') {
      console.log('Testando inicialização nativa do GGUF...')
      const started = await main.evaluate(modelPath => window.__TAURI_INTERNALS__.invoke('start_bundled_engine', {
        modelPath, tuning: { ctx: 4096, ctxChosen: true },
      }), modelPath)
      console.log(JSON.stringify({ phase: 'native_model_start', port: started.port, ctx: started.ctx }))
      const answer = await main.evaluate(async ({ port, alias }) => {
        const raw = await window.__TAURI_INTERNALS__.invoke('proxy_localhost', {
          url: `http://127.0.0.1:${port}/v1/chat/completions`, method: 'POST', timeoutMs: 120000,
          body: JSON.stringify({ model: alias, messages: [{ role: 'user', content: 'Responda apenas Olá, teste concluído.' }], max_tokens: 128, stream: false, chat_template_kwargs: { enable_thinking: false } }),
        })
        return JSON.parse(raw).choices?.[0]?.message?.content
      }, { port: started.port, alias })
      console.log(JSON.stringify({ phase: 'native_chat', answer }))
    }
    await main.getByTestId('sidebar-panel').getByRole('button', { name: 'Chat', exact: true }).click()
    await main.getByRole('button', { name: 'Nova conversa', exact: true }).click()
    await main.evaluate(() => window.__TAURI_INTERNALS__.invoke('stop_bundled_engine'))
    await main.locator('textarea').first().fill('Responda somente com a frase Olá, teste concluído.')
    await main.locator('textarea').first().press('Enter')
    try {
      await expect(main.getByText('Olá, teste concluído.', { exact: true })).toBeVisible({ timeout: 180000 })
      const status = await main.evaluate(() => window.__TAURI_INTERNALS__.invoke('bundled_engine_status'))
      expect(status.healthy).toBe(true)
      expect(basename(status.model_path, '.gguf')).toBe(alias)
      chatProof = { model: alias, coldStart: process.argv[3] === '--cold', port: status.port, context: status.ctx, response: 'Olá, teste concluído.' }
      await main.screenshot({ path: join(root, 'docs/bionic-preview/51-chat-gguf-desktop.png'), fullPage: true })
      console.log(JSON.stringify({ phase: 'native_ui_chat', ...chatProof }))
    } catch (error) {
      await main.screenshot({ path: join(folder, 'chat-failure.png'), fullPage: true })
      throw error
    }
  }
  const sidebar = main.getByTestId('sidebar-panel')
  for (const name of ['Agentes', 'Habilidades', 'Agenda']) {
    await sidebar.getByRole('button', { name, exact: true }).click()
    await expect(sidebar.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
  }
  await sidebar.getByRole('button', { name: 'Chat', exact: true }).click()
  await main.screenshot({ path: join(root, 'docs/bionic-preview/45-desktop-nativo-isolado.png') })
  await sidebar.getByRole('button', { name: 'Acesso remoto', exact: true }).click()
  await expect(sidebar.getByRole('button', { name: 'Conectar', exact: true })).toBeVisible()
  await main.locator('header').getByRole('button', { name: 'Configurações', exact: true }).click()
  // The last-used tab may already be About, whose disclosure has the same label.
  await main.getByRole('button', { name: 'Sobre', exact: true }).first().click()
  const about = main.getByTestId('about-settings')
  await expect(about.getByText('Ronne Pereira', { exact: true })).toBeVisible()
  const support = new URL(await about.getByRole('link', { name: 'Pague um café — US$ 5', exact: true }).getAttribute('href'))
  expect(support.origin).toBe('https://www.paypal.com')
  expect(support.searchParams.get('business')).toBe('ronne.pereira@gmail.com')
  expect(support.searchParams.get('amount')).toBe('5.00')
  await main.waitForTimeout(400)
  await main.screenshot({ path: join(root, 'docs/bionic-preview/49-desktop-sobre.png') })
  expect(snapshot()).toEqual(before)
  const report = { desktop: true, rustBridge: true, modelLoadedDuringTest: Boolean(chatProof), chatProof, native, originalLUFilesUnchanged: true, checkedOriginalFiles: oldFiles.length, workspaceRoot: join(homedir(), 'bionicllm-agent-workspace') }
  writeFileSync(join(folder, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, reportFolder: folder }))
} finally {
  if (main) await main.evaluate(() => window.__TAURI_INTERNALS__.invoke('exit_app')).catch(() => {})
  await new Promise(ok => { if (child.exitCode !== null) return ok(); child.once('exit', ok); setTimeout(ok, 5000) })
  if (child.exitCode === null) child.kill()
  if (browser) await browser.close().catch(() => {})
  expect(snapshot()).toEqual(before)
}

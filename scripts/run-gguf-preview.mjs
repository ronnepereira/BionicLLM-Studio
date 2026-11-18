// Isolated, interactive GGUF smoke test. Closing this browser stops only the engine started here.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdtempSync, openSync, closeSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = fileURLToPath(new URL('..', import.meta.url))
const model = resolve(process.argv[2] || '')
if (!process.argv[2] || !model.toLowerCase().endsWith('.gguf') || !statSync(model).isFile()) throw new Error('Informe o caminho de um arquivo GGUF existente.')
const file = openSync(model, 'r'); closeSync(file)
const folder = mkdtempSync(join(tmpdir(), 'bionic-gguf-preview-'))
const token = randomBytes(32).toString('hex')
const keyFile = join(folder, 'engine.key')
writeFileSync(keyFile, token + '\n', { mode: 0o600 })
const server = createServer()
await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok))
const port = server.address().port
await new Promise(ok => server.close(ok))
const alias = basename(model, '.gguf')
const endpoint = `http://127.0.0.1:${port}/v1`
const output = join(folder, 'engine.stdout.log'), error = join(folder, 'engine.stderr.log')
const descriptors = [openSync(output, 'a'), openSync(error, 'a')]
const engine = spawn(join(workspace, 'src-tauri', 'bin', 'bu-llama-server-x86_64-pc-windows-msvc.exe'), [
  '-m', model, '--host', '127.0.0.1', '--port', String(port), '--ctx-size', '4096',
  '--parallel', '1', '--alias', alias, '--jinja', '--no-webui', '--no-ui-mcp-proxy', '--api-key-file', keyFile,
], { cwd: join(workspace, 'src-tauri', 'bin'), windowsHide: true, stdio: ['ignore', ...descriptors] })
descriptors.forEach(closeSync)
let spawnFailure
engine.on('error', value => { spawnFailure = value })
let context
const cleanup = () => { if (engine.exitCode === null && engine.pid) engine.kill() }
process.on('SIGINT', () => { cleanup(); process.exit(0) })
process.on('SIGTERM', () => { cleanup(); process.exit(0) })
console.log(JSON.stringify({ phase: 'loading', model: alias, enginePid: engine.pid, endpoint, context: 4096, reportFolder: folder }))
try {
  let ready = false
  for (let attempt = 0; attempt < 180; attempt++) {
    if (spawnFailure) throw spawnFailure
    if (engine.exitCode !== null) throw new Error(`O motor encerrou com código ${engine.exitCode}: ${readFileSync(error, 'utf8').slice(-5000)}`)
    try { const health = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) }); if (health.ok) { ready = true; break } } catch {}
    await new Promise(ok => setTimeout(ok, 1000))
  }
  if (!ready) throw new Error('O modelo não ficou pronto dentro de três minutos. Consulte o log do motor.')
  const models = await fetch(endpoint + '/models', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
  console.log(JSON.stringify({ phase: 'model_ready', models: models.data?.map(m => m.id) }))
  context = await chromium.launchPersistentContext(join(folder, 'browser'), { headless: false, viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['data:', 'blob:', 'about:'].includes(url.protocol) || url.hostname === '127.0.0.1' && [String(port), '5274'].includes(url.port)) return route.continue()
    return route.abort()
  })
  await context.addInitScript(({ endpoint, alias, token }) => {
    if (localStorage.getItem('bionic-gguf-preview-initialized')) return
    // Let the store migration fill all defaults for this intentionally partial test profile.
    localStorage.setItem('chat-settings', JSON.stringify({ version: 0, state: { settings: { onboardingDone: true, language: 'pt-BR', appMode: 'local', thinkingEnabled: false, maxTokens: 512, temperature: 0.6 } } }))
    localStorage.setItem('lu-providers', JSON.stringify({ version: 2, state: { providers: { openai: { id: 'openai', name: 'GGUF local · ' + alias, enabled: true, baseUrl: endpoint, apiKey: btoa(token.split('').reverse().join('')), isLocal: true, managed: false } }, engineOptedOut: true, openaiEntries: [], hideBackendSelector: false } }))
    localStorage.setItem('chat-models', JSON.stringify({ version: 0, state: { activeModel: 'openai::' + alias, lastLocalModel: 'openai::' + alias, autoCloudPickCleared: true } }))
    localStorage.setItem('bionic-gguf-preview-initialized', '1')
  }, { endpoint, alias, token })
  const page = context.pages()[0] || await context.newPage()
  await page.goto('http://127.0.0.1:5274/')
  await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 30000 })
  console.log(JSON.stringify({ phase: 'browser_ready', url: page.url(), reportFolder: folder }))
  const prompt = 'Responda em português, com uma frase curta, confirmando que está pronto para conversar.'
  const request = page.waitForResponse(r => r.url() === endpoint + '/chat/completions', { timeout: 120000 })
  await page.locator('textarea').first().fill(prompt)
  await page.locator('textarea').first().press('Enter')
  try {
    const response = await request
    const body = await response.text()
    let content = ''
    for (const line of body.split('\n')) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
      try { const data = JSON.parse(line.slice(6)); content += data.choices?.[0]?.delta?.content || '' } catch {}
    }
    if (!content) { try { content = JSON.parse(body).choices?.[0]?.message?.content || '' } catch {} }
    const report = { phase: 'chat_test', httpStatus: response.status(), model: alias, context: 4096, response: content, modelFileUnmodified: true }
    writeFileSync(join(folder, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    await page.screenshot({ path: join(workspace, 'docs', 'bionic-preview', '41-gguf-qwen-chat-real.png'), fullPage: true })
  } catch (error) { console.log(JSON.stringify({ phase: 'chat_test_needs_attention', message: error.message })); await page.screenshot({ path: join(folder, 'chat-state.png'), fullPage: true }) }
  console.log('A janela de teste está aberta. Ao fechá-la, somente este motor será encerrado.')
  await new Promise(ok => context.once('close', ok))
} finally {
  cleanup()
  if (context) await context.close().catch(() => {})
}

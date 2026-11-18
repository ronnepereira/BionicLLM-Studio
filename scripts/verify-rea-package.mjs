// Isolated compatibility probe: no REA setup, analysis tools, models or user config.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../src-tauri/src/commands/plugin_rea.rs', import.meta.url), 'utf8')
const version = source.match(/REA_VERSION: &str = "([^"]+)"/)[1]
const url = source.match(/REA_TARBALL_URL: &str = "([^"]+)"/)[1]
const integrity = source.match(/REA_INTEGRITY: &str =\s*"([^"]+)"/)[1]
const metadata = await fetch(`https://registry.npmjs.org/rea-agents/${version}`, { signal: AbortSignal.timeout(30000) }).then(r => { assert(r.ok); return r.json() })
assert.equal(metadata.dist.integrity, integrity)
assert.equal(metadata.dist.tarball, url)
const folder = mkdtempSync(join(tmpdir(), 'bionic-rea-probe-'))
const archive = join(folder, `rea-agents-${version}.tgz`)
const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
assert(response.ok)
const bytes = Buffer.from(await response.arrayBuffer())
assert(bytes.length < 64 * 1024 * 1024)
assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), integrity)
writeFileSync(archive, bytes)
const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { maxBuffer: 2 * 1024 * 1024, windowsHide: true }).toString())
assert.equal(manifest.version, version)
assert.equal(manifest.engines.node, metadata.engines.node)
for (const name of ['preinstall', 'install', 'postinstall']) assert(!manifest.scripts?.[name])
const npm = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const child = spawn(process.execPath, [npm, 'exec', '--yes', `--package=${archive}`, '--', 'rea', 'mcp'], {
  cwd: folder, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, npm_config_ignore_scripts: 'true', npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false', npm_config_cache: join(folder, 'npm-cache'), REA_LOG_LEVEL: 'warn' },
})
let sequence = 0, output = '', errors = ''
const requests = new Map()
child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-12000) })
child.stdout.on('data', chunk => {
  output += chunk
  let end
  while ((end = output.indexOf('\n')) >= 0) {
    const line = output.slice(0, end); output = output.slice(end + 1)
    try {
      const reply = JSON.parse(line)
      const request = requests.get(reply.id)
      if (!request) continue
      requests.delete(reply.id)
      if (reply.error) request.reject(new Error(JSON.stringify(reply.error)))
      else request.resolve(reply.result)
    } catch { /* npm can write a non-JSON line before REA starts */ }
  }
})
const rejectPending = error => { for (const pending of requests.values()) pending.reject(error); requests.clear() }
child.on('error', rejectPending)
child.on('exit', code => rejectPending(new Error(`REA exited ${code}: ${errors}`)))
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence
  requests.set(id, { resolve, reject })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})
const timeout = setTimeout(() => rejectPending(new Error(`REA probe timed out: ${errors}`)), 180000)
try {
  const initialized = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bionicllm-probe', version: '1.0.0' } })
  // Match the current BionicLLM client's handshake and tools/list behavior.
  const listing = await call('tools/list')
  assert(listing.tools.length > 0)
  assert(listing.tools.every(tool => typeof tool.name === 'string' && tool.inputSchema?.type === 'object'))
  const report = { ok: true, version, integrityVerified: true, node: process.version, nodeRange: manifest.engines.node, serverInfo: initialized.serverInfo, protocolVersion: initialized.protocolVersion, tools: listing.tools.map(tool => tool.name), analysisToolsCalled: false, setupRun: false }
  writeFileSync(new URL('../docs/bionic-preview/rea-package-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ version, integrityVerified: true, nodeRange: manifest.engines.node, serverInfo: initialized.serverInfo, tools: listing.tools.length, analysisToolsCalled: false }))
} finally {
  clearTimeout(timeout)
  child.stdin.end()
  if (process.platform === 'win32') {
    if (child.exitCode === null) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else child.kill()
}

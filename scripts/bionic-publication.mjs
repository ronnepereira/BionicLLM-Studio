import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const allowedRoots = new Set(['src', 'src-tauri', 'scripts', 'public', 'logos', 'dev-server', 'e2e', 'e2e-stack', 'third-party', 'mobile-client', 'mobile-docs', 'mobile-tests', '.github', 'docs'])
const allowedRootFiles = /^(?:\.(?:env\.example|gitignore|gitattributes|nvmrc)|(?:package(?:-lock)?|bionic-publication|tsconfig(?:\.[\w-]+)?)\.json|(?:vite|vitest|playwright(?:\.stack)?|eslint)\.config\.(?:ts|js)|index\.html|(?:README|LICENSE|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|VOICE|COMPUTER-CONTROL)(?:\.md)?|(?:setup|start|update)\.(?:bat|ps1|sh))$/

export function publishable(path, tracked = true) {
  const parts = path.replaceAll('\\', '/').split('/')
  if (parts.some((part) => /^(?:\.git|node_modules|target|dist|build|\.gradle|\.cxx|\.idea|\.vscode|__pycache__|\.pytest_cache|\.llama-build|coverage|test-results|playwright-report|backup-hologram-original|credentials)$/i.test(part))) return false
  const name = parts.at(-1)
  if (/^\.env(?:\.|$)/i.test(name) && name !== '.env.example') return false
  if (/\.(?:key|pem|p8|p12|pfx|jks|keystore|mobileprovision|exe|dll|so(?:\.\d+)*|dylib|msi|dmg|AppImage|deb|rpm|gguf|safetensors|onnx|pyc|log|tmp|tsbuildinfo)$/i.test(name)) return false
  if (/^(?:credentials.*|service-account.*|config|settings|key\.properties|keystore\.properties|local\.properties)\.json$/i.test(name)) return false
  if (/^(?:key|keystore|local)\.properties$/i.test(name)) return false
  if (path === '.github/FUNDING.yml' || path.startsWith('.signpath/') || path === 'src-tauri/tauri.signing.conf.json') return false
  if (path.startsWith('docs/bionic-preview/')) return false
  if (path.startsWith('src-tauri/bin/') || path.startsWith('src-tauri/resources/llama/')) return name === '.gitignore'
  // Working reports are private by default; maintained upstream documentation stays.
  if (parts[0] === 'docs' && !tracked && path !== 'docs/PUBLICACAO-GITHUB.md') return false
  return parts.length === 1 ? allowedRootFiles.test(name) : allowedRoots.has(parts[0])
}

export function secretFindings(text) {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /\bsk-(?:proj-|ant-)[A-Za-z0-9_-]{40,}\b/,
  ]
  return text.split(/\r?\n/).flatMap((line, index) => patterns.some((pattern) => pattern.test(line)) ? [index + 1] : [])
}

export function assertRepository(value) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_.-]+$/.test(value) || /\/(?:\.|\.\.)$/.test(value)) throw new Error('Use owner/repository, after confirming the GitHub account.')
  if (value.toLowerCase() === 'purpledoubled/locally-uncensored') throw new Error('The BionicLLM release must use its own repository.')
  return value
}

// Keep the upstream automation as reference, but never execute it in the fork.
export function disableUpstreamWorkflow(text) {
  return text.replace(/(^jobs:[ \t]*\r?\n)([\s\S]*)/m, (_, header, jobs) => header + jobs
    .replace(/^ {4}if:[^\r\n]*(?:\r?\n(?: {6}[^\r\n]*))*\r?\n/gm, '')
    .replace(/^( {2}[\w-]+:)\r?\n/gm, '$1\n    if: ${{ false }} # Upstream workflow retained for reference only.\n'))
}

function generateKey(directory) {
  if (!directory) throw new Error('Supply a NEW private directory outside the workspace.')
  if (readJson(join(ROOT, 'src-tauri/tauri.conf.json')).plugins?.updater?.pubkey) throw new Error('An updater public key already exists; refusing to replace it.')
  const target = resolve(directory)
  const rel = relative(ROOT, target)
  if (!rel.startsWith('..') || existsSync(target)) throw new Error('Private directory must be new and outside the workspace.')
  mkdirSync(target, { recursive: true, mode: 0o700 })
  if (process.platform === 'win32') {
    const identity = execFileSync('whoami', { encoding: 'utf8' }).trim()
    execFileSync('icacls', [target, '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)F`], { stdio: 'pipe' })
  }
  const password = randomBytes(32).toString('hex')
  const keyPath = join(target, 'updater.key')
  const result = spawnSync(process.execPath, [join(ROOT, 'node_modules/@tauri-apps/cli/tauri.js'), 'signer', 'generate', '--ci', '-w', keyPath, '-p', password], { stdio: 'pipe' })
  if (result.status !== 0) throw new Error('Updater key generation failed; private tool output withheld.')
  writeFileSync(join(target, 'updater-password.txt'), password, { mode: 0o600 })
  const conf = readJson(join(ROOT, 'src-tauri/tauri.conf.json'))
  conf.plugins.updater = { pubkey: readFileSync(`${keyPath}.pub`, 'utf8').trim(), endpoints: ['https://updates-not-configured.invalid/latest.json'], windows: { installMode: 'passive' } }
  writeJson(join(ROOT, 'src-tauri/tauri.conf.json'), conf)
  console.log(`Updater key generated outside the repository: ${target}. Private values withheld. Back up this directory securely.`)
}

function candidates() {
  const list = (args) => execFileSync('git', ['-C', ROOT, 'ls-files', '-z', ...args], { maxBuffer: 32 * 1024 * 1024 }).toString().split('\0').filter(Boolean)
  const tracked = new Set(list(['--cached']))
  return [...new Set([...tracked, ...list(['--others', '--exclude-standard'])])].sort()
    .filter((path) => existsSync(join(ROOT, path)) && publishable(path, tracked.has(path)))
}

function audit(files, root = ROOT) {
  const issues = []
  for (const path of files) {
    const full = join(root, path)
    if (lstatSync(full).isSymbolicLink()) { issues.push(`${path}: symbolic link requires review`); continue }
    const data = readFileSync(full)
    if (data.length > 100 * 1024 * 1024) issues.push(`${path}: exceeds 100 MiB`)
    if (!data.subarray(0, 8000).includes(0)) {
      for (const line of secretFindings(data.toString('utf8'))) issues.push(`${path}:${line}: possible credential; content withheld`)
    }
  }
  if (issues.length) throw new Error(issues.join('\n'))
}

function configure(repository, publicKeyFile) {
  assertRepository(repository)
  if (!publicKeyFile) throw new Error('Supply the updater PUBLIC key file; never the private key.')
  const pubkey = readFileSync(resolve(publicKeyFile), 'utf8').trim()
  if (!/^[A-Za-z0-9+/=]+$/.test(pubkey) || Buffer.from(pubkey, 'base64').toString().includes('secret key')) throw new Error('Invalid updater public key.')
  const decoded = Buffer.from(pubkey, 'base64').toString().trim().split('\n')
  if (decoded.length !== 2 || !decoded[0].startsWith('untrusted comment:') || Buffer.from(decoded[1], 'base64').length !== 42) throw new Error('Expected a Tauri/minisign public key.')
  writeJson(join(ROOT, 'bionic-publication.json'), { ...readJson(join(ROOT, 'bionic-publication.json')), repository })
  const conf = readJson(join(ROOT, 'src-tauri/tauri.conf.json'))
  conf.plugins.updater = { pubkey, endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`], windows: { installMode: 'passive' } }
  writeJson(join(ROOT, 'src-tauri/tauri.conf.json'), conf)
  const pkg = readJson(join(ROOT, 'package.json'))
  pkg.repository = { type: 'git', url: `https://github.com/${repository}.git` }
  pkg.homepage = `https://github.com/${repository}`
  writeJson(join(ROOT, 'package.json'), pkg)
  console.log(`Release destination configured: ${repository}. No network publication performed.`)
}

function exportSource(destination) {
  if (!destination) throw new Error('Supply a NEW destination directory outside this workspace.')
  const target = resolve(destination)
  const rel = relative(ROOT, target)
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel)) || existsSync(target)) throw new Error('Destination must be new and outside the workspace; nothing overwritten.')
  const parent = realpathSync(dirname(target))
  const parentRel = relative(ROOT, parent)
  if (!parentRel || (!parentRel.startsWith('..') && !isAbsolute(parentRel))) throw new Error('Destination parent resolves inside the workspace.')
  const files = candidates()
  audit(files)
  mkdirSync(target)
  const manifest = []
  for (const path of files) {
    const out = join(target, path)
    mkdirSync(dirname(out), { recursive: true })
    if (path.startsWith('.github/workflows/') && !path.endsWith('/bionic-desktop.yml')) {
      writeFileSync(out, disableUpstreamWorkflow(readFileSync(join(ROOT, path), 'utf8')))
    } else copyFileSync(join(ROOT, path), out)
    manifest.push({ path, sha256: createHash('sha256').update(readFileSync(out)).digest('hex') })
  }
  copyFileSync(join(target, 'README.md'), join(target, 'README.upstream.md'))
  writeFileSync(join(target, 'README.md'), '# BionicLLM Studio\n\nEstúdio desktop de IA baseado no Locally Uncensored, com licença AGPL-3.0.\n\nCódigo-fonte para Windows, Linux e macOS. Linux e macOS são experimentais e ainda não foram validados em uso real.\n\n## Desenvolvimento\n\nRequer Node.js 22+, Rust e os pré-requisitos do Tauri 2.\n\n```sh\nnpm ci\nnpm run dev\n# Compilar a engine antes de empacotar:\nbash scripts/build-llama.sh\nnpm run tauri:build\n```\n\nConsulte [publicação e atualizações](docs/PUBLICACAO-GITHUB.md), [licença](LICENSE), [créditos originais](README.upstream.md) e os avisos em third-party/.\n\nInstaladores são distribuídos em Releases, separados do código. Nenhuma conversa, credencial, configuração pessoal ou modelo baixado deve ser enviado ao repositório.\n')
  audit(files, target)
  for (const entry of manifest) entry.sha256 = createHash('sha256').update(readFileSync(join(target, entry.path))).digest('hex')
  manifest.push({ path: 'README.upstream.md', sha256: createHash('sha256').update(readFileSync(join(target, 'README.upstream.md'))).digest('hex') })
  writeJson(join(target, 'SOURCE-MANIFEST.json'), { generatedAt: new Date().toISOString(), files: manifest })
  console.log(`Clean source exported: ${target} (${files.length} files). No Git history, dependencies, installers or local .env copied.`)
}

function validateRelease(tag, expectedRepository = process.env.GITHUB_REPOSITORY) {
  const publication = readJson(join(ROOT, 'bionic-publication.json'))
  assertRepository(publication.repository)
  if (expectedRepository && publication.repository !== expectedRepository) throw new Error('Configured repository differs from the workflow repository.')
  const pkg = readJson(join(ROOT, 'package.json'))
  const conf = readJson(join(ROOT, 'src-tauri/tauri.conf.json'))
  const cargo = readFileSync(join(ROOT, 'src-tauri/Cargo.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1]
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || conf.version !== pkg.version || cargo !== pkg.version || tag !== `v${pkg.version}`) throw new Error('Tag and package.json, Cargo.toml, tauri.conf.json must have the same stable version.')
  const endpoint = `https://github.com/${publication.repository}/releases/latest/download/latest.json`
  if (conf.plugins?.updater?.endpoints?.[0] !== endpoint || !conf.plugins.updater.pubkey) throw new Error('Updater configuration is incomplete.')
  console.log(`Validated ${tag} for ${publication.repository}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2)
    if (command === 'configure') configure(...args)
    else if (command === 'key') generateKey(...args)
    else if (command === 'export') exportSource(...args)
    else if (command === 'audit') { const files = candidates(); audit(files); console.log(`Source audit passed: ${files.length} candidate files. Pattern scan does not replace review.`) }
    else if (command === 'validate') validateRelease(...args)
    else throw new Error('Commands: audit | export <new-directory> | configure <owner/repo> <public-key-file> | validate <tag>')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}

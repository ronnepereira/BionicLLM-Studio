import { createHash, createPublicKey, verify } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)])
}

export function verifyUpdaterSignature(bytes, encodedSignature, encodedPublicKey) {
  const keyLines = Buffer.from(encodedPublicKey.trim(), 'base64').toString().trim().split(/\r?\n/)
  const lines = Buffer.from(encodedSignature.trim(), 'base64').toString().trim().split(/\r?\n/)
  const key = Buffer.from(keyLines[1] ?? '', 'base64')
  const signature = Buffer.from(lines[1] ?? '', 'base64')
  if (key.length !== 42 || signature.length !== 74 || !key.subarray(2, 10).equals(signature.subarray(2, 10))) throw new Error('Updater signature has a different key or invalid encoding.')
  const algorithm = signature.subarray(0, 2).toString()
  if (!['Ed', 'ED'].includes(algorithm)) throw new Error('Unsupported updater signature algorithm.')
  const payload = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]), format: 'der', type: 'spki' })
  if (!verify(null, payload, publicKey, signature.subarray(10))) throw new Error('Updater signature verification failed.')
  return true
}

export function mergePlatformManifests(parts) {
  if (parts.length !== 3) throw new Error('Windows, Linux and macOS build receipts are all required.')
  const version = parts[0].version
  const platforms = {}
  for (const part of parts) {
    if (part.version !== version) throw new Error('Build versions differ.')
    for (const [key, value] of Object.entries(part.platforms)) {
      if (platforms[key]) throw new Error(`Duplicate updater target: ${key}`)
      platforms[key] = value
    }
  }
  for (const required of ['windows-x86_64', 'linux-x86_64', 'linux-x86_64-appimage', 'darwin-aarch64']) {
    if (!platforms[required]) throw new Error(`Missing updater target: ${required}`)
  }
  return { version, notes: 'BionicLLM Studio. Linux e macOS: versões experimentais, sem validação em uso real. Windows e macOS sem certificado comercial.', pub_date: new Date().toISOString(), platforms }
}

function collect(platform, bundleDir, destination, tag) {
  const publication = readJson(join(ROOT, 'bionic-publication.json'))
  const conf = readJson(join(ROOT, 'src-tauri/tauri.conf.json'))
  const version = conf.version
  if (tag !== `v${version}`) throw new Error('Artifact tag differs from application version.')
  const files = walk(resolve(bundleDir))
  const formats = {
    windows: { required: [/\.msi$/], update: /\.msi$/, targets: ['windows-x86_64'] },
    linux: { required: [/\.AppImage$/, /\.deb$/], update: /\.AppImage$/, targets: ['linux-x86_64', 'linux-x86_64-appimage'] },
    darwin: { required: [/\.dmg$/, /\.app\.tar\.gz$/], update: /\.app\.tar\.gz$/, targets: ['darwin-aarch64'] },
  }
  const format = formats[platform]
  if (!format) throw new Error('Unknown build platform.')
  for (const pattern of format.required) if (!files.some((file) => pattern.test(file))) throw new Error(`Missing installer: ${pattern}`)
  const updates = files.filter((file) => format.update.test(file))
  if (updates.length !== 1) throw new Error('Expected exactly one updater payload.')
  const update = updates[0]
  const sig = readFileSync(`${update}.sig`, 'utf8').trim()
  verifyUpdaterSignature(readFileSync(update), sig, conf.plugins.updater.pubkey)
  mkdirSync(destination, { recursive: true })
  const kept = files.filter((file) => /\.(?:msi|AppImage|deb|dmg|app\.tar\.gz|sig)$/.test(file))
  const names = new Set()
  for (const file of kept) {
    if (names.has(basename(file))) throw new Error(`Duplicate asset name: ${basename(file)}`)
    names.add(basename(file))
    copyFileSync(file, join(destination, basename(file)))
  }
  const platforms = Object.fromEntries(format.targets.map((target) => [target, { signature: sig, url: `https://github.com/${publication.repository}/releases/download/${tag}/${encodeURIComponent(basename(update))}` }]))
  writeFileSync(join(destination, `manifest-${platform}.json`), JSON.stringify({ version, platforms }, null, 2) + '\n')
  console.log(`Collected and verified ${platform}: ${kept.length} files`)
}

async function draft(directory, tag) {
  const publication = readJson(join(ROOT, 'bionic-publication.json'))
  if (publication.repository !== process.env.GITHUB_REPOSITORY) throw new Error('Workflow repository mismatch.')
  const files = walk(directory)
  const manifests = files.filter((file) => /manifest-(windows|linux|darwin)\.json$/.test(file))
  const latest = mergePlatformManifests(manifests.map(readJson))
  if (tag !== `v${latest.version}`) throw new Error('Release tag mismatch.')
  const assets = files.filter((file) => !basename(file).startsWith('manifest-'))
  const latestPath = join(directory, 'latest.json')
  const sumsPath = join(directory, 'SHA256SUMS.txt')
  writeFileSync(latestPath, JSON.stringify(latest, null, 2) + '\n')
  const pubkey = readJson(join(ROOT, 'src-tauri/tauri.conf.json')).plugins.updater.pubkey
  for (const entry of Object.values(latest.platforms)) {
    const name = decodeURIComponent(new URL(entry.url).pathname.split('/').at(-1))
    const matches = assets.filter((path) => basename(path) === name)
    if (matches.length !== 1) throw new Error(`Missing or duplicate asset: ${name}`)
    verifyUpdaterSignature(readFileSync(matches[0]), entry.signature, pubkey)
  }
  assets.push(latestPath)
  const names = assets.map((file) => basename(file))
  if (new Set(names).size !== names.length) throw new Error('Release asset names must be unique.')
  writeFileSync(sumsPath, assets.map((path) => `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${basename(path)}`).join('\n') + '\n')
  assets.push(sumsPath)
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is required for a draft release.')
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } })
    if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`)
    return response.json()
  }
  const base = `https://api.github.com/repos/${publication.repository}`
  const releases = await api(`${base}/releases?per_page=100`)
  if (releases.some((release) => release.tag_name === tag)) throw new Error('A release already exists for this tag; no files were replaced. Review it before retrying.')
  const release = await api(`${base}/releases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: tag, name: `BionicLLM Studio ${latest.version}`, draft: true, prerelease: false, body: `${latest.notes}\n\nWindows: instalador MSI. Linux e macOS são experimentais.\n\nRevise os instaladores antes de publicar. Os pacotes não incluem modelos nem dados pessoais.\n\nBaseado no Locally Uncensored (AGPL-3.0).` }) })
  for (const file of assets) {
    await api(`${release.upload_url.split('{')[0]}?name=${encodeURIComponent(basename(file))}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: readFileSync(file) })
  }
  console.log(`Draft prepared: ${release.html_url}. Nothing was published to the update channel.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2)
    if (command === 'collect') collect(...args)
    else if (command === 'draft') await draft(...args)
    else throw new Error('Commands: collect <windows|linux|darwin> <bundle-directory> <output-directory> <tag> | draft <artifacts-directory> <tag>')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}

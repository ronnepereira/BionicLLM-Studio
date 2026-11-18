import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { assertRepository, disableUpstreamWorkflow, publishable, secretFindings } from './bionic-publication.mjs'
import { mergePlatformManifests, verifyUpdaterSignature } from './bionic-release-assets.mjs'

test('source export includes code and required build configuration, excludes personal data and artifacts', () => {
  for (const path of ['src/main.tsx', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json', '.env.example', 'bionic-publication.json', 'package-lock.json', 'mobile-client/client.js', 'docs/PUBLICACAO-GITHUB.md']) assert.equal(publishable(path, false), true, path)
  for (const path of ['.env', '.env.production', 'src/.env', '.git/config', 'src-tauri/target/release/app.exe', 'src-tauri/resources/llama/a/file.dll', 'src-tauri/bin/server.exe', 'backup-hologram-original/face.ts', 'node_modules/a.js', 'updater.key', 'src/credentials.json', 'docs/release-personal.json', 'pnpm-lock.yaml', 'src-tauri/gen/android/local.properties']) assert.equal(publishable(path, false), false, path)
  assert.equal(publishable('docs/bionic-preview/94-preview.gif'), false)
})

test('credential scanner reports locations without exposing credential contents', () => {
  assert.deepEqual(secretFindings('ordinary source\n' + 'ghp_' + 'a'.repeat(36)), [2])
  assert.deepEqual(secretFindings('-----BEGIN ' + 'PRIVATE KEY-----'), [1])
  assert.deepEqual(secretFindings('https://github.com/example/app\npublic key placeholder'), [])
})

test('upstream workflows cannot run any job in the exported repository', () => {
  const input = 'name: upstream\non: push\njobs:\n  gate:\n    uses: ./.github/workflows/ci.yml\n  build:\n    if: ${{ !cancelled() }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n'
  const output = disableUpstreamWorkflow(input)
  assert.equal(output.match(/ {4}if: \$\{\{ false \}\}/g).length, 2)
  assert.equal(output.includes('!cancelled()'), false)
  assert.equal(disableUpstreamWorkflow(output), output)
})

test('a fork cannot accidentally target upstream updates or accept a malformed repository name', () => {
  assert.equal(assertRepository('ronnepereira/BionicLLM-Studio'), 'ronnepereira/BionicLLM-Studio')
  for (const name of ['', '../other', 'https://github.com/user/repo', 'purpledoubled/locally-uncensored', 'owner/repo/other']) assert.throws(() => assertRepository(name))
})

test('a release requires all three platforms and consistent versions', () => {
  const parts = [
    { version: '4.0.0', platforms: { 'windows-x86_64': {} } },
    { version: '4.0.0', platforms: { 'linux-x86_64': {}, 'linux-x86_64-appimage': {} } },
    { version: '4.0.0', platforms: { 'darwin-aarch64': {} } },
  ]
  assert.equal(Object.keys(mergePlatformManifests(parts).platforms).length, 4)
  assert.throws(() => mergePlatformManifests(parts.slice(0, 2)))
  assert.throws(() => mergePlatformManifests([parts[0], parts[1], { ...parts[2], version: '4.0.1' }]))
})

test('updater signature rejects tampering and another signing key', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const keyId = randomBytes(8)
  const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  const key = Buffer.from('untrusted comment: test key\n' + Buffer.concat([Buffer.from('Ed'), keyId, rawPublic]).toString('base64') + '\n').toString('base64')
  const payload = Buffer.from('installer content')
  const signed = sign(null, createHash('blake2b512').update(payload).digest(), privateKey)
  const signature = Buffer.from('untrusted comment: test signature\n' + Buffer.concat([Buffer.from('ED'), keyId, signed]).toString('base64') + '\ntrusted comment: test\n').toString('base64')
  assert.equal(verifyUpdaterSignature(payload, signature, key), true)
  assert.throws(() => verifyUpdaterSignature(Buffer.from('tampered installer'), signature, key))
  const otherKey = Buffer.from('untrusted comment: other\n' + Buffer.concat([Buffer.from('Ed'), randomBytes(8), rawPublic]).toString('base64') + '\n').toString('base64')
  assert.throws(() => verifyUpdaterSignature(payload, signature, otherKey))
})

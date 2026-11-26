import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const read = (name: string) => JSON.parse(readFileSync(`src-tauri/${name}`, 'utf8'))
const base = read('tauri.conf.json')

for (const platform of ['windows', 'linux', 'macos']) {
  it(`${platform} release metadata preserves setup and network qualifications`, () => {
    const platformConfig = read(`tauri.${platform}.conf.json`)
    const release = read('tauri.bionic-release.conf.json')
    const bundle = { ...base.bundle, ...platformConfig.bundle, ...release.bundle }
    expect(bundle.shortDescription).toContain('BionicLLM Studio')
    expect(bundle.shortDescription).toContain('IA local ou na nuvem')
    for (const phrase of ['hardware compatível e modelos baixados',
      'componentes adicionais', 'solicitações são enviadas aos provedores selecionados',
      'limites, cobrança e políticas de conteúdo', 'permissões das ferramentas e o destino dos dados']) {
      expect(bundle.longDescription).toContain(phrase)
    }
    expect(`${bundle.shortDescription} ${bundle.longDescription}`).not.toMatch(
      /[\u2013\u2014]|zero setup|no external software|no data leaves|entirely on your own machine|\d+ tools|\d+ optional local backends/i,
    )
  })
}

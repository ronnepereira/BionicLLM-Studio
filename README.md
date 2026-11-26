# BionicLLM Studio

Estúdio desktop de IA para conversar com modelos locais ou na nuvem, usar agentes, trabalhar com código e gerar imagens e vídeos.

[Baixar o instalador para Windows x64](https://github.com/ronnepereira/BionicLLM-Studio/releases/latest). O aplicativo verifica novas versões pelo GitHub e pede confirmação antes de instalar.

O repositório também contém o código para Linux e macOS, plataformas experimentais nesta distribuição.

## Desenvolvimento

Requer Node.js 22+, Rust e os pré-requisitos do Tauri 2.

```sh
npm ci
npm run dev
npm run tauri dev
```

Veja [como contribuir](CONTRIBUTING.md), [como preparar uma versão](docs/PUBLICACAO-GITHUB.md) e [como reportar uma vulnerabilidade](SECURITY.md).

## Licença e créditos

[AGPL-3.0-only](LICENSE). Consulte [os créditos de origem](third-party/UPSTREAM-NOTICE.md) e os [avisos de componentes de terceiros](third-party/).

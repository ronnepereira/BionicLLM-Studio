# BionicLLM Studio

Estúdio desktop de IA baseado no Locally Uncensored, com licença AGPL-3.0.

Código-fonte para Windows, Linux e macOS. Linux e macOS são experimentais e ainda não foram validados em uso real.

## Desenvolvimento

Requer Node.js 22+, Rust e os pré-requisitos do Tauri 2.

```sh
npm ci
npm run dev
# Compilar a engine antes de empacotar:
bash scripts/build-llama.sh
npm run tauri:build
```

Consulte [publicação e atualizações](docs/PUBLICACAO-GITHUB.md), [licença](LICENSE), [créditos originais](README.upstream.md) e os avisos em third-party/.

Instaladores são distribuídos em Releases, separados do código. Nenhuma conversa, credencial, configuração pessoal ou modelo baixado deve ser enviado ao repositório.

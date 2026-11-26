# Publicação do BionicLLM Studio

O repositório `ronnepereira/BionicLLM-Studio` é o destino do código e das versões distribuídas pelo GitHub Releases. O Windows distribui MSI com assinatura de atualização Tauri e sem Authenticode. Linux e macOS são experimentais.

## Código limpo

O desenvolvimento continua na pasta original. `node scripts/bionic-publication.mjs export <nova-pasta-fora-do-projeto>` exporta os arquivos atuais, incluindo alterações locais, sem copiar `.git`, histórico, `.env`, credenciais, dependências, caches, relatórios de trabalho não rastreados, modelos ou instaladores. Mantém as configurações de compilação e padrões necessários. Configurações pessoais ficam nos diretórios de dados do usuário, fora do pacote.

O exportador aplica regras de inclusão e faz uma busca de credenciais conhecidas. Essa verificação tem limites e complementa a revisão dos arquivos. `SOURCE-MANIFEST.json` registra os arquivos e seus hashes. Os workflows originais são mantidos como referência com todos os jobs desativados; o único fluxo operacional novo é `bionic-desktop.yml`. O README original e a licença AGPL-3.0 são preservados.

## Chave de atualização

A chave privada NÃO está no repositório. Foi gerada em uma pasta privada externa, com acesso restrito ao usuário do Windows. Guarde cópia de segurança da chave e da senha. Sua perda impede atualizar instalações que confiam na chave atual. Somente a chave pública é incluída no código.

O build local usa a chave e a senha somente no ambiente do processo de assinatura. Para builds assinados no GitHub Actions, os Secrets correspondentes são:

- `TAURI_SIGNING_PRIVATE_KEY`: conteúdo da chave privada.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: senha da chave.

Esses valores são enviados por entrada padrão pelo GitHub CLI; nunca por mensagem, commit ou argumento de comando. O `GITHUB_TOKEN` dos workflows é fornecido pelo próprio GitHub.

`node scripts/bionic-publication.mjs configure owner/repository <arquivo-da-chave-publica>` define o destino. Nunca apontar para o repositório original. Não trocar a chave a cada versão.

## Builds e revisão

Push em `main` verifica fonte, TypeScript, lint do código de publicação/atualização e testes dirigidos. O lint completo (`npm run lint`) tem erros preexistentes em outros módulos; o workflow não declara aprovação global desse lint. O build dos instaladores é manual, pelo workflow **BionicLLM - Verify and prepare installers**. Escolher Windows gera MSI x64; Linux gera AppImage/deb x64; macOS gera DMG/arquivo de atualização Apple Silicon. Escolher `all` compila todos, em sequência. Não há pacote Intel para macOS nesta primeira etapa.

O build de instaladores no Actions é iniciado pelo workflow manual. Em cada release estável, `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json` precisam concordar com a tag. `Cargo.lock` e `package-lock.json` devem acompanhar as mudanças.

Os instaladores ficam como artifacts por três dias. Com `all` e a opção de rascunho, o workflow cria uma **release de rascunho** depois dos três builds, com instaladores, hashes SHA-256 e `latest.json`. Uma release local pode conter somente os sistemas verificados. Em ambos os casos, confira a assinatura contra a chave pública e publique o rascunho após revisar os arquivos. O `latest.json` deve listar somente os pacotes disponíveis.

Os executores são os padrões do GitHub. Em repositório privado, consomem a franquia do plano; não são ilimitados. Manter orçamento pago em zero e verificar a franquia antes dos builds de várias plataformas. O fluxo não altera faturamento. Nenhum serviço de assinatura pago é usado.

## Atualizações pelo app

Com `updatesEnabled` ativo, o app consulta o `latest.json` da última release estável ao iniciar e durante o uso. O aviso aparece na barra superior. O download automático é opcional. A instalação e o reinício exigem confirmação no diálogo. Instale manualmente a primeira versão com o canal habilitado ao migrar de uma versão com o canal desativado.

Publique cada atualização com o código-fonte correspondente disponível para quem baixa o pacote, conforme a AGPLv3. Use a tag do commit utilizado no build e publique o MSI assinado, o arquivo `.sig`, o `latest.json` e o SHA-256. A assinatura Tauri protege a integridade da atualização. A chave privada fica no ambiente de build.

No Windows, o MSI serve tanto para instalação manual quanto para o pacote de atualização. Atualização pode pedir elevação de privilégios. A assinatura do atualizador é gratuita e não remove SmartScreen, editor desconhecido ou verificações do macOS. Não orientar usuários a desativar proteções do sistema.

## Dados e primeira instalação MSI

O identificador `com.bionicllm.studio`, o `upgradeCode` WiX e os nomes de diretórios de dados existentes são preservados. O MSI instala os executáveis e recursos; conversas, chaves de API, modelos e configurações continuam nos diretórios pessoais existentes. Antes de trocar o executável aberto por uma instalação MSI, fechar o app e fazer backup pelas configurações. Não desinstalar nem apagar dados do usuário como etapa de atualização.

Build Windows local, com engine já compilada:

```powershell
npm ci
npm run tauri -- build --ci --bundles msi
```

Saída em `src-tauri/target/release/bundle/msi`. O instalador local não é instalado automaticamente. Testar abertura, histórico, modelos, engine, permissões e atalhos após instalar. O resultado de build não comprova testes funcionais em sistemas onde não houve execução real.

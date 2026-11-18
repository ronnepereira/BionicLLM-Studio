# Integrações nativas — escopo e ordem de execução

Atualizado em 03/11/2026 conforme a lista enviada pelo usuário. EdgeTTS implementado para leitura em voz alta. Telegram, WhatsApp QR/Baileys e WhatsApp oficial/Meta incluem receptor de texto, contatos permitidos, agente vinculado, rascunhos para revisão e respostas automáticas opcionais. Google Gmail/Drive/Agenda têm consultas e ações de criação/envio com revisão explícita. Facebook Páginas inclui leitura e publicação de texto com revisão. Instagram profissional inclui imagem/Reel por URL pública com revisão. LinkedIn inclui perfil pessoal/empresa, identidade básica, leitura opcional e publicação de texto revisada. YouTube inclui canal OAuth, consultas e envio de vídeo local com revisão; Shorts conforme classificação do YouTube. TikTok inclui consulta opcional de vídeos públicos e transferência revisada para finalizar pela caixa de entrada no próprio TikTok. Testes com contas/modelos reais e operações adicionais continuam pendentes.

## Google: autorização, consultas e ações com revisão

Guia: `BIONICLLM-GOOGLE.md`. Cliente OAuth do tipo Aplicativo para computador fornecido pelo usuário; PKCE/state e retorno local temporário, sem servidor público. Cada serviço autorizado separadamente no navegador padrão e habilitado explicitamente para consultas/agentes após conectar. Cliente e refresh tokens no cofre; tokens de acesso somente em memória. Remoção é local, com orientação para gerenciar revogação na conta Google.

Gmail pesquisa até dez mensagens, mostra cabeçalhos/trechos e lê texto simples até 32.000 caracteres. Drive pesquisa até vinte metadados por nome, sem baixar conteúdo. Agenda consulta próximos vinte eventos da agenda principal, separada da agenda de tarefas interna. Ferramentas de leitura para agentes seguem permissões de acesso a arquivos privados e Parar. UI em sanfona, prévia sem credenciais/contas simuladas.

Com autorização adicional opcional por serviço (`gmail.send`, `drive.file`, `calendar.events.owned`), usuário/agente pode preparar rascunho local de e-mail individual, novo arquivo `.txt` ou evento sem convidados/lembretes. O usuário revisa a conta e os dados e confirma no painel antes de executar. Não há ferramenta de execução para o modelo. Journal persistente de até vinte registros, vinculados à autorização; tentativa incerta gravada antes do POST, sem retry automático. Troca de conta/reauthorização invalida execução de propostas antigas. Permanecem pendentes envio/respostas automáticas no Gmail, monitoramento, anexos, download/upload genérico, edição/exclusão de arquivos existentes e alteração de eventos existentes.

O Google pode exigir verificação para permissões sensíveis/restritas; contas Workspace dependem também das políticas do administrador. Projeto, APIs e usuários de teste são preparados pelo proprietário, sem criação automática pelo BionicLLM. Validação local/controlada, sem conta real nem inferência real, não comprova autorização do projeto pelo Google. Detalhes técnicos e provas em `BIONICLLM-CONTINUIDADE.md`.

## Facebook Páginas — primeira etapa

Guia: `BIONICLLM-FACEBOOK.md`. Conector nativo com app/token de Página fornecidos pelo usuário, validação de tipo PAGE, app/Página/escopos/prazo e identidade antes de salvar no cofre. Nova configuração inicia desativada. Leitura de dez publicações recentes e rascunhos locais de texto até 8.000 caracteres, publicados somente após revisão e confirmação no painel. Modelo só lê/prepara, sem ferramenta de publicação remota. Journal separado, até vinte registros, sem retry após resultado incerto. Credenciais e sessões independentes de WhatsApp, Google, LU e Hermes.

A API de Páginas não publica no perfil pessoal. Demais capacidades de perfil pessoal não foram implementadas. Imagens, vídeos/Reels, comentários, agendamento e múltiplas Páginas por configuração permanecem pendentes no Facebook. Instagram tem conector próprio descrito abaixo. Sem contas, projetos, publicações ou modelos reais nesta etapa; requisitos de App Review/tarefas de Página ainda precisam de validação real.

## Instagram profissional — imagens e Reels

Guia: `BIONICLLM-INSTAGRAM.md`. Modalidade oficial com Facebook Login, exigindo conta profissional vinculada a Página. Verifica token PAGE/app/Página/escopos, vínculo e identidade; cofre/autorização separados do Facebook. Leitura de dez mídias e rascunhos de JPEG/Reel por URL HTTPS pública, legenda até 2.200 caracteres e opção feed. Apenas confirmação no painel inicia processamento/publicação. Modelo só consulta/prepara; sem ferramenta de publicar.

Meta busca a mídia; o app não hospeda nem envia arquivo local. Contêiner precisa ficar FINISHED antes de media_publish, com espera limitada e cancelável. Journal grava tentativa/ID de processamento, não reenvia nem retoma após falha/parada. UI distingue contêiner de publicação confirmada. Instagram Login direto, contas pessoais, upload local, Stories, carrosséis, comentários, mensagens e agendamento não incluídos nesta etapa. Conta/modelo reais e exigências Meta ainda precisam ser validados antes do instalador.

## LinkedIn — perfil pessoal e empresa

Guia: `BIONICLLM-LINKEDIN.md`. Token 3L de aplicativo próprio, introspecção e identidade OIDC. Autor pessoal derivado da conta; empresa exige ADMINISTRATOR aprovado e empresa/membro exatos. Cofre separado, conexão começa desativada. Leitura de até dez posts é opcional e exige aprovação social específica; não vem incluída no acesso básico nem na publicação.

Texto público até 3.000 caracteres, rascunho local por usuário/agente e publicação somente após revisão/confirmar no painel. Modelo não publica diretamente. Posts API 202609; HTTP 201 + x-restli-id. Journal vinculado à autorização, persistência antes do envio, sem reenvio incerto. Sem mídia, mensagens, comentários ou agendamento nesta etapa. Sem conta/modelo real. Próximos: YouTube/Shorts e TikTok; instalador por último.

## YouTube e Shorts — consulta e envio revisado

Guia: `BIONICLLM-YOUTUBE.md`. Reutiliza o cliente OAuth Google com conexão `google-youtube` independente, youtube.readonly e youtube.upload opcional. Confirma e-mail e canal único, nova autorização desativada, rascunhos vinculados à concessão. Consulta até dez envios. Arquivo escolhido somente no seletor nativo, cópia local por UUID/digest, até cinco cópias de 512 MiB. O modelo consulta metadados e prepara rascunhos; somente o painel pode confirmar o envio, após revisar canal/arquivo/dados.

Visibilidade privada inicialmente; escolhas explícitas sobre público infantil e conteúdo sintético. Sessão de upload com destino validado, envio em fluxo e cancelamento, sem retry/retomada automática. Confirma ID/canal/visibilidade, mas processamento/publicação efetiva dependem do YouTube. Shorts usam o mesmo envio e são classificados pelo YouTube por formato/duração; não há conversão nem flag artificial. Sem outras operações de canal nesta etapa. Conta/modelo reais pendentes; próximo TikTok. Instalador por último.

## TikTok — consulta e envio para finalizar na caixa de entrada

Guia: `BIONICLLM-TIKTOK.md`. Aplicativo próprio/client key/secret/refresh token emitido por seu fluxo OAuth; login inicial não automatizado nesta etapa. Verificação da autorização por renovação e identidade exata; user.info.basic obrigatório, video.list e video.upload opcionais separados. Credenciais no cofre, rotação de token persistida, conexão nova desativada e rascunhos vinculados à concessão. Não cria projetos nem promete aprovação de escopos pelo TikTok.

Consulta até dez vídeos públicos da própria conta. Seleção nativa de MP4/MOV/WebM, até cinco cópias de 512 MiB; modelo só consulta metadados e prepara proposta local. Usuário revisa conta/arquivo e confirma transferência via Upload Content, com blocos sequenciais, destino validado e sem Bearer no host da mídia. Notas ficam locais. Estado distingue transferência/processamento/notificação/publicação pelo usuário. Sem retry ou retomada automática.

**O usuário precisa abrir a notificação na caixa de entrada do TikTok para editar, definir legenda/visibilidade e publicar. Não é Direct Post nem publicação automática.** API de Direct Post e seus requisitos de auditoria/UX permanecem fora desta etapa. Sem conta/modelo real; próximo trabalho é a validação geral e ponta a ponta, respeitando os limites de cada conector. Instalador por último.

## WhatsApp QR/Baileys implementado

Baileys 7.0.0-rc13 com pino 9.14.0, ambiente privado instalado pelo painel com lockfile/SRI e scripts npm desativados. Usa Node.js 22+ com npm, sem instalar programas globalmente nem reutilizar a ponte/sessão Hermes. O app principal continua Rust/Tauri. Ponte stdio privada, sem porta local ou janela externa. QR transitório em PNG no painel nativo. Sessão criptografada AES-256-GCM e chave separada no cofre do sistema; sem chave na interface, em argumentos ou em variável de ambiente. A prévia web mantém os controles nativos desabilitados.

Conectar, desconectar e remover sessão local separados de ativar/parar o receptor. Suporte inicial a texto de números completos/IDs de grupos permitidos, em modo revisão ou automático. Ignora histórico, mensagens próprias, status, edições e anexos. Não expõe ferramentas do computador a terceiros. Compartilha o executor/painel de mensagens com Telegram, mantendo estados/Stop independentes. Histórico até 20 registros e deduplicação até 500 IDs recentes; tentativas de envio incertas não são repetidas. Falhas pausam, logout exige nova vinculação local, troca de conta impede respostas de outra origem.

36 testes frontend/API, cinco Node e oito Rust passaram, incluindo instalação real/carregamento Baileys e subprocesso Node com transporte controlado. Prévia pt-BR/600 px verificada, capturas 22/23. Não conectou conta, solicitou QR real, enviou mensagem real ou executou modelo real. Falta validação ponta a ponta. Instalação/provisão do Node no pacote final ainda será tratada na preparação do instalador. Detalhes e arquivos em `BIONICLLM-CONTINUIDADE.md`.

## WhatsApp oficial/Meta implementado

Modalidade independente do QR Code, usando Graph API v25.0 e credenciais no cofre do sistema. O painel verifica antes de substituir a credencial salva; nenhum comando devolve segredos à interface. Requer número Business, aplicativo Meta e permissões `whatsapp_business_messaging` e `whatsapp_business_management`. Presença local da credencial não significa conexão online validada.

O receptor escuta somente em 127.0.0.1, porta padrão 18782, caminho `/whatsapp/meta/webhook`. Exige URL HTTPS pública fornecida pelo usuário, encaminhamento para esse receptor e cadastro manual na Meta com assinatura do campo `messages`. O app não cria túnel, hospedagem ou projeto Meta. Confere token do desafio e assinatura HMAC do corpo bruto antes de interpretar eventos, além do número comercial e dos contatos autorizados.

Primeira implementação: texto individual e respostas dentro de 24 horas da mensagem original; sem grupos, anexos, templates, campanhas ou início proativo de conversa. Revisão é o padrão; envio automático exige opção explícita. Reutiliza executor de mensagens sem ferramentas do computador, com parada independente. Persiste antes de confirmar recebimento, não repete envios incertos e permite retry de webhook quando a fila está cheia. Credenciais e histórico ficam separados dos conectores Telegram/QR.

Validação controlada: 44 testes frontend/API e 18 Rust na bateria conjunta, incluindo dez Rust do Meta. TypeScript, ESLint direcionado, build e verificações de navegador dos três conectores passaram. Capturas 24/25 revisadas visualmente. Não houve conta real, envio real, modelo real ou infraestrutura pública configurada. Próximos conectores: Google Gmail, Drive e Agenda; depois as demais redes solicitadas. Instalador permanece por último.

## Implementado nesta etapa: EdgeTTS e credencial do Telegram

EdgeTTS usa `edge-tts==7.3.1` em ambiente Python exclusivo do BionicLLM, com instalação pelo painel, vozes Francisca e Antônio em pt-BR, velocidade de 50–150%, teste e interrupção. O texto selecionado para leitura vai à Microsoft; requer internet, sem chave de API. Piper e HTTP externo permanecem disponíveis, sem troca automática de mecanismo nem ativação automática da leitura. Duas sínteses reais e cancelamento do processo passaram nos testes nativos. A aba de conversa contínua por voz conserva seu mecanismo anterior; não confundir com a leitura de texto via EdgeTTS.

Telegram em Habilidades → Conectores: campo de token do BotFather, verificação e gravação após sucesso, nova verificação com credencial salva e remoção local. Transporte Rust direto para Telegram Bot API, mesmo protocolo de bots usado pelo Hermes; não instala python-telegram-bot porque HTTPS/JSON já são suportados por reqwest no app. Nenhum serviço hospedado Nous é necessário. Verificar credencial usa apenas `getMe`; essa ação não recebe/envia mensagens, altera webhook ou revoga token. Receptor e envio são ações separadas, descritas abaixo. Em prévia web os campos e ações nativas ficam desabilitados.

Cofre independente `com.bionicllm.studio.connectors`, conta fixa `telegram-bot-token`; não estende permissões da API genérica de segredos nem compartilha o cofre do LU original. Não há comando que devolva o token à interface. Falha de verificação preserva a credencial anterior. Operações serializadas, resposta de identidade limitada a 64 KB e demais operações a 256 KB, prazo de 15 segundos, redirecionamentos bloqueados, erros sem URL/token/corpo da API. Apenas janela principal pode invocar comandos. Cofre suportado em Windows/macOS; outros sistemas falham explicitamente, sem armazenamento em texto no navegador.

### Telegram: receptor, revisão e envio

Implementação em `studio_telegram/runtime.rs`, `telegramRuntimeStore.ts`, `telegram-agent.ts`, `TelegramRuntimePanel.tsx` e `useTelegramRuntime.ts`. A ativação exige bot exclusivo, agente com modelo de texto explícito e 1–50 IDs numéricos de chats. Suporta texto de chats privados, grupos e supergrupos autorizados. Em grupos, a lista autoriza todos os membros, mas as regras de privacidade/permissões do Telegram continuam determinando quais mensagens chegam ao bot. Não representa automação da conta pessoal.

Ativar consulta identidade e `getWebhookInfo`; recusa bot com webhook, sem apagá-lo. Long polling `getUpdates` (10 s, lotes de até 20) enquanto o aplicativo permanece aberto. Ignora mensagens anteriores à ativação, bots, chats fora da lista, edições e anexos. A precisão de data do Telegram é de segundos: o primeiro segundo da ativação também fica fora para não responder ao backlog. Não descobre automaticamente contatos nem faz pareamento de conta pessoal.

Modo padrão é revisão: o modelo prepara um rascunho; somente clicar **Enviar resposta** executa `sendMessage`. A opção separada de envio automático autoriza respostas aos chats listados ao ativar o receptor. Saída é texto simples, sem HTML/Markdown interpretado ou prévia de links, como resposta à mensagem original; destino não pode ser escolhido pelo modelo. Limite de 4.000 unidades UTF-16; o adaptador prepara até 3.900 sem cortar pares de emoji. Falhas/cancelamento/stream incompleto ou truncado não são enviados.

Cada mensagem cria conversa local independente, sem mudar a conversa/modelo visíveis. Reutiliza provedores configurados (inclusive endpoints próprios) e fila do modelo local; instruções do agente e habilidades ativas orientam as respostas. Não fornece ferramentas, MCP, arquivos, shell, navegador ou delegação a mensagens recebidas. Alterar/remover o agente vinculado interrompe o receptor; skills são lidas a cada nova resposta. Mensagens podem ir para provedor externo se esse for o modelo escolhido no agente, com aviso na interface.

Parar cancela consulta, geração em andamento e espera na fila local. Respostas tardias não são entregues. O receptor não se reativa sozinho ao reiniciar/recarregar a interface. Mensagens já aceitas pelo Telegram não podem ser recolhidas. Cursor é salvo antes de gerar resposta; tentativa de envio é marcada como não confirmada no disco antes da requisição. Se houver timeout, erro ou queda após envio possível, não há repetição automática: conferir no Telegram e descartar o registro se necessário. Não prometer entrega exatamente uma vez: a API não tem chave de idempotência. Reinício não repete mensagens interrompidas. Cursor muito antigo é reinicializado para tratar a mudança aleatória de update_id após longa inatividade; a fila Telegram expira em até 24 h.

Estado local atômico em `app_data_dir/telegram-runtime.json`, sem tokens. Mantém até 20 mensagens/resultados; rascunhos e envios incertos não são expulsos para abrir espaço. Ao atingir o limite com pendências, receptor pausa para revisão. As mensagens/conversas são armazenadas localmente como o restante do chat. Alterar a credencial interrompe a sessão; ao trocar de bot, respostas antigas não podem ser enviadas ao novo bot. Operações e envio serializados; limites de corpo (256 KB), tempo e cancelamento permanecem no transporte Rust. O cofre não entrou no backup/exportação de conversas.

**Validação e limites:** testes controlados de filtros, cursor persistente, não repetição, envio incerto, revisão/opt-in, parada, fila local e isolamento de ferramentas; verificação visual pt-BR/600 px e preservação do MCP. Não foi conectada conta real nem enviada mensagem real durante desenvolvimento. Falta validar o fluxo completo com conta de teste e modelo real antes de empacotar. Outros conectores ainda pendentes.

## Ordem aprovada

Orientação atualizada: o usuário aceitou manter **somente o instalador Windows por último**, para implementar, testar e corrigir todos os recursos antes de empacotar. Conectores nativos e EdgeTTS pt-BR continuam fundamentais e devem ser implementados/testados antes disso. Depois de gerar o pacote, verificar instalação, abertura, desinstalação e preservação do LU original. Continuar verificações locais apropriadas às mudanças ao longo do desenvolvimento.

A consulta ao Marketplace online foi implementada; instalação automática/adaptação de pacotes próprios do Cline ainda não. A reformulação geral no estilo Cline está **cancelada**, substituindo a suspensão anterior: manter o visual atual. As funcionalidades de Habilidades/Marketplace e barra inferior já autorizadas continuam no escopo.

## Serviços solicitados

| Serviço | Escopo solicitado / referência |
| --- | --- |
| WhatsApp não oficial | Escolha confirmada pelo usuário: vinculação por QR Code com Baileys, conforme o conector padrão do Hermes Desktop. O plugin Go WhatsApp/GOWA fica fora do escopo. |
| WhatsApp oficial | WhatsApp Business Cloud API da Meta, também presente no Hermes. Oferecer modalidade própria, distinguindo requisitos de conta, tokens e recebimento por webhook da modalidade QR Code. |
| Telegram | Mesmo método do Hermes; adaptador público consultado usa Telegram Bot API com python-telegram-bot. Não assumir que isso equivale à automação da conta pessoal do Telegram. |
| Google Gmail | OAuth, pesquisa/leitura e envio individual de texto com revisão. Monitoramento, anexos e respostas automáticas pendentes. |
| Google Drive | OAuth, metadados por nome e novo arquivo .txt com revisão. Download/upload genérico, edição/exclusão de existentes pendentes. |
| Google Agenda | OAuth, próximos eventos e criação de evento sem convidados com revisão; separada da agenda de tarefas. Alteração de eventos existentes pendente. |
| Facebook | Páginas: leitura e texto com revisão implementados. Perfil pessoal: publicação não disponível por essa API; demais capacidades pendentes. Mídias, comentários e agendamento de Página pendentes. |
| Instagram | Imagem JPEG/Reel via URL pública, com revisão, e leitura implementadas para conta profissional vinculada a Página (Facebook Login). Instagram Login direto, upload local, Stories/carrosséis/comentários/agendamento pendentes. |
| LinkedIn | Identidade básica, leitura opcional e texto revisado para perfil pessoal/empresa ADMINISTRATOR; conta real/aprovações e operações adicionais pendentes. |
| YouTube | Canal OAuth, consulta de vídeos e envio local revisado implementados. Shorts conforme classificação do YouTube. Retomada, outras operações e conta real pendentes. |
| TikTok | Consulta pública e transferência revisada para caixa de entrada implementadas; usuário finaliza no TikTok. Login inicial automatizado, Direct Post, outras operações e prova real pendentes. |

Esta lista não autoriza enviar mensagens, publicar conteúdo, vincular contas reais ou criar projetos de desenvolvedor durante a pesquisa. Nenhuma dessas ações foi realizada nesta etapa.

## Hermes: pesquisa confirmada e ponto em aberto

Consulta ao ramo público `main` de `NousResearch/hermes-agent` em 02/11/2026 confirmou **as duas modalidades de WhatsApp**:

- Não oficial: `plugins/platforms/whatsapp/adapter.py` inicia ponte local Node.js; `scripts/whatsapp-bridge/package.json` declara `@whiskeysockets/baileys: 7.0.0-rc13`.
- Oficial: `plugins/platforms/whatsapp_cloud/adapter.py` usa a Meta Graph API para envio e aiohttp para recebimento por webhook. `plugin.yaml` descreve conta Business, URL pública para webhook e autenticação por token. Validar a versão Graph vigente no momento da implementação, em vez de copiar a versão padrão antiga do adaptador.
- `gateway/platforms/whatsapp_common.py` compartilha regras de acesso/menções/formatação entre os dois adaptadores.
- Telegram: `plugins/platforms/telegram/adapter.py` usa python-telegram-bot. O onboarding opcional hospedado por Nous é distinto do transporte Bot API; não tornar esse serviço requisito do BionicLLM.

A troca do modo não oficial padrão para Go **não foi confirmada nessa revisão do ramo main**. A inspeção local posterior, abaixo, esclareceu a presença de Go como plugin opcional de catálogo. Depois dessa explicação, o usuário escolheu explicitamente Baileys por QR Code e Meta Business Cloud API oficial, excluindo o plugin Go. A pesquisa substitui a conclusão anterior incompleta que citava somente Baileys.

### Verificação do Hermes Desktop instalado neste PC

Atalho lido: `C:/Users/RONNE/Desktop/Hermes.lnk`, cujo destino é `C:/Users/RONNE/AppData/Local/hermes/hermes-agent/apps/desktop/release/win-unpacked/Hermes.exe`. Foram examinados arquivos de programa e catálogo dessa árvore; nenhuma conversa, credencial, sessão ou configuração de conta foi lida. O Hermes e o WhatsApp não foram iniciados.

- **Conector padrão não oficial:** `scripts/whatsapp-bridge/package.json` declara `@whiskeysockets/baileys` `7.0.0-rc13`; `bridge.js:22` importa `makeWASocket` dessa biblioteca e o usa para criar a conexão. `plugins/platforms/whatsapp/adapter.py` registra `name="whatsapp"` com `WhatsAppAdapter`, que inicia essa ponte Node.js. Isso comprova o método implementado pelo conector padrão, não uma sessão ativa do usuário.
- **Go opcional:** `plugin-catalog/go-whatsapp.yaml` apresenta Go WhatsApp, versão `0.4.1`, repositório `https://github.com/anpicasso/hermes-go-whatsapp`, com GOWA `9.5.0`. O manifesto o classifica como comunitário e descreve ferramentas de envio/pareamento/dispositivos; explicita que **não recebe mensagens nem configura webhooks**. Presença no catálogo não comprova instalação ou ativação do plugin. Ele não é substituição automática do conector padrão de conversas.
- **Oficial:** `plugins/platforms/whatsapp_cloud/plugin.yaml` confirma WhatsApp Business Cloud, Graph API e webhook.
- Há uma inconsistência documental no registro padrão: `docs_url` aponta para whatsmeow, embora o adaptador e o import efetivamente usem Baileys. Um link de documentação isolado não prova qual biblioteca é executada.

REA foi aplicado ao `resources/app.asar` de modo estático, sem executar o alvo. A análise limitada a `dist/electron-main.mjs` atingiu o limite de 30 segundos e reteve evidência parcial (`ev_2f124129e79ea9ef9082074db1f5f995b6e17c6311d2fc95b6ff18b98af822c9`); sua projeção foi consultada, sem repetir a análise. Não declarar reconstrução completa do Electron. A conclusão sobre WhatsApp vem dos manifestos, import e registro explícitos dos componentes locais, suficientes para distinguir os três caminhos.

Fontes:

- [Ponte não oficial e dependências](https://github.com/NousResearch/hermes-agent/blob/main/scripts/whatsapp-bridge/package.json), blob `9242ecd76f83855b6be34dd18ed7d5337dea3175`.
- [Adaptador não oficial](https://github.com/NousResearch/hermes-agent/blob/main/plugins/platforms/whatsapp/adapter.py), blob `6650da7f8e28c79b67b2084e31f36235ad51306e`.
- [Adaptador Cloud API oficial](https://github.com/NousResearch/hermes-agent/blob/main/plugins/platforms/whatsapp_cloud/adapter.py), blob `0bc2b619635a23cd0a4cd5c5f3e323d1614dc3ca`.
- [Requisitos do WhatsApp Business Cloud](https://github.com/NousResearch/hermes-agent/blob/main/plugins/platforms/whatsapp_cloud/plugin.yaml), blob `38809cb47a2086facfcb74b23749845635fd3673`.
- [Adaptador Telegram](https://github.com/NousResearch/hermes-agent/blob/main/plugins/platforms/telegram/adapter.py), blob `be3cb24e70815bdde04493fe11635def2cd2643c`.

## Critérios para a implementação futura

Usar interface e ciclo de vida próprios do BionicLLM. Não reutilizar sessões, tokens ou configuração de contas do Hermes instalado. Proteger segredos no cofre, permitir conectar/desconectar e configurar permissões por serviço/conta. Preservar as permissões dos agentes, prevenção de reenvios/duplicações e o comando Parar.

Para APIs oficiais, confirmar permissões, tipo de conta, revisão de aplicativo e limites reais por operação antes de disponibilizá-la. O receptor local do WhatsApp oficial foi implementado; nenhuma infraestrutura externa foi criada. Não representar todas as integrações como offline ou todos os perfis como equivalentes.

Testar inicialmente com transportes controlados, sem mensagens/publicações reais. Completar os testes com modelo real antes do empacotamento; somente a preparação do instalador fica por último, conforme a orientação atualizada do usuário.

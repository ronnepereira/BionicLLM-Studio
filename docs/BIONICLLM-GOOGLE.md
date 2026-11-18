# Google: Gmail, Drive e Agenda

Atualizado em 03/11/2026: consultas e ações com revisão, para Windows/macOS desktop. O programa principal permanece Rust/Tauri. Não usa LU Cloud, sessões do Hermes, serviço intermediário ou pacote Google adicional.

O YouTube agora reutiliza este cliente OAuth, mantendo autorização, token, ativação, canal e rascunhos separados. Guia: `BIONICLLM-YOUTUBE.md`. Remova também a conexão YouTube local antes de trocar/remover o cliente compartilhado. As permissões de Gmail/Drive/Agenda não são ampliadas por conectar YouTube.

## O que funciona nesta etapa

| Serviço | Operações implementadas | Permissão solicitada |
| --- | --- | --- |
| Gmail | Pesquisa com sintaxe Gmail, até dez resultados com cabeçalhos/trechos; leitura por ID em texto simples até 32.000 caracteres | `https://www.googleapis.com/auth/gmail.readonly` |
| Drive | Pesquisa literal por trecho do nome, até vinte metadados de arquivos não excluídos, por modificação recente | `https://www.googleapis.com/auth/drive.metadata.readonly` |
| Agenda | Pesquisa dos próximos vinte eventos da agenda principal, incluindo recorrências expandidas | `https://www.googleapis.com/auth/calendar.events.readonly` |

Cada autorização solicita também `https://www.googleapis.com/auth/userinfo.email` para exibir o e-mail verificado da conta. Serviços podem usar contas diferentes. Somente a primeira página é exibida; refine a pesquisa para reduzir resultados. A Agenda Google é independente da agenda interna de tarefas.

As consultas continuam disponíveis com as permissões de leitura. A etapa seguinte acrescentou envio de e-mail individual em texto simples, criação de eventos na agenda principal sem convidados/lembretes e criação de novos arquivos `.txt` no Drive, sempre após revisão e confirmação no painel. Não há monitoramento de entrada, respostas automáticas, anexos, download, edição/exclusão de arquivos existentes ou alteração de eventos existentes. Os rascunhos são locais, não rascunhos criados na conta Gmail. HTML e anexos de e-mails não são carregados. Mensagens sem parte de texto simples mostram aviso em vez de renderizar HTML. Os conectores Telegram/WhatsApp mantêm seu executor sem ferramentas; não passam a acessar Google automaticamente.

## Ações com revisão

| Serviço | Permissão adicional opcional | Ação implementada |
| --- | --- | --- |
| Gmail | `https://www.googleapis.com/auth/gmail.send` | Enviar texto simples para um destinatário, assunto até 160 caracteres e corpo até 32.000 |
| Drive | `https://www.googleapis.com/auth/drive.file` | Criar um novo arquivo `.txt` com nome até 200 caracteres e texto até 32.000; sem editar arquivos arbitrários existentes |
| Agenda | `https://www.googleapis.com/auth/calendar.events.owned` | Criar evento na agenda principal, título até 200 e descrição até 8.000, início/término com fuso explícito, sem convidados nem lembretes |

Marque **Solicitar ações com revisão ao autorizar** no serviço desejado e clique **Autorizar novamente**. Apenas marcar essa opção não muda a autorização existente: o consentimento adicional ocorre no Google. A permissão de eventos possui alcance maior na API do Google; o app oferece somente criação nesta etapa. A conexão volta desativada após autorizar; ative-a explicitamente. Autorizações antigas migram como leitura, sem aumento silencioso de escopo.

Em **Ações do Google para revisar**, selecione o serviço e prepare o rascunho ou peça ao agente para prepará-lo. O rascunho ainda não executa a ação remota. Clique **Revisar ação**, confira conta, destinatário/título, texto e horários, então clique na confirmação específica do envio ou criação. Não existe ferramenta de execução para o modelo: as três ferramentas novas somente preparam propostas locais.

Os rascunhos ficam em `app_data_dir/connectors/google/actions.json`, em texto local como as conversas, sem credenciais, com até vinte registros e arquivo limitado a 4 MB. São imutáveis: para alterar, remova o registro e prepare outro. Remover registro não desfaz ação no Google. A autorização de origem fica vinculada internamente; trocar conta ou autorizar novamente impede executar propostas antigas, mesmo que o e-mail volte a ser igual.

Antes do POST, o app grava resultado potencialmente incerto no disco. Falha, cancelamento ou perda de confirmação depois desse ponto não causa repetição automática. Confira no serviço antes de preparar outra ação. Um ACK válido marca o registro como confirmado; isso não promete entrega do e-mail ao destinatário. Parar depois do aceite remoto não desfaz a operação. Registros incertos/confirmados não têm botão de reenviar.

## Preparação pelo proprietário da conta/projeto

1. No [Google Cloud Console](https://console.cloud.google.com/), selecione ou crie seu projeto. O BionicLLM não cria projetos nem habilita faturamento.
2. Habilite Gmail API, Google Drive API e Google Calendar API para os serviços que pretende usar.
3. Configure a tela de consentimento OAuth. Se o projeto estiver em teste, adicione a conta que vai autorizar como usuário de teste. Permissões sensíveis/restritas podem exigir verificação do aplicativo; administradores Workspace podem restringir esse acesso. Autorizações de projetos externos em teste podem expirar após sete dias.
4. Crie um cliente OAuth do tipo **Aplicativo para computador**. Não use cliente Web, conta de serviço ou senha da conta Google.
5. No aplicativo desktop, abra **Habilidades → Conectores → Google**, informe o ID e a chave do cliente e clique **Salvar cliente OAuth**. Não envie esses valores pelo chat. Na prévia web, os campos e comandos ficam desabilitados.
6. Clique **Conectar com Google** no serviço desejado. O navegador padrão do sistema abre a página oficial de autorização; escolha a conta e confira as permissões. O Google exige navegador do sistema para este fluxo; o painel de navegação interno não é usado para login.
7. Volte ao app para conferir o e-mail da conta. A conexão inicia com consultas desativadas. Marque **Ativar consultas e acesso dos agentes** somente para os serviços que deseja disponibilizar.
8. Use a pesquisa no painel ou peça uma consulta ao agente. O modelo pode ser de provedor externo; os resultados passam a fazer parte dessa conversa conforme o funcionamento normal do chat. O painel de pesquisa por si só não chama um modelo.

O fluxo de desktop usa retorno HTTP em 127.0.0.1 com porta temporária, PKCE S256 e state aleatórios. Não exige callback público, túnel, domínio ou hospedagem. Não reutiliza o antigo login LU/Supabase. O prazo para concluir a autorização é de três minutos.

## Controles e armazenamento

Desativar um serviço bloqueia novas consultas e cancela trabalho pendente desse serviço. Remover conexão exige confirmação e apaga a credencial local; não revoga concessões compartilhadas do cliente no Google. Revise o [acesso de terceiros da conta Google](https://myaccount.google.com/connections) para revogar remotamente quando necessário. Remova as conexões locais antes de trocar/remover o cliente OAuth.

Cliente OAuth e autorizações renováveis ficam no cofre `com.bionicllm.studio.connectors`, nas contas fixas `google-oauth-desktop-client`, `google-gmail`, `google-drive` e `google-calendar`. Tokens de acesso e verificador PKCE são temporários em memória; nenhum segredo é retornado por IPC, gravado no navegador ou incluído no backup de conversas. O status consulta somente presença local e e-mail, sem verificar a conta pela internet. Erros na autorização não substituem a credencial anterior. Credenciais que excedem o tamanho suportado pelo cofre são recusadas explicitamente.

Ferramentas de consulta: `google_gmail_search`, `google_gmail_read`, `google_drive_search`, `google_calendar_search`, na categoria de acesso a arquivos privados (`filesystem`, confirmação por padrão). Ferramentas de proposta: `google_gmail_prepare`, `google_calendar_prepare`, `google_drive_prepare`, na categoria `workflow`, também com confirmação por padrão. São mutações locais, sem retry automático e bloqueadas em turnos somente de leitura. Não existe ferramenta de confirmação/envio remoto para o modelo. Permissões normais e Parar são preservados; desativar o serviço também bloqueia o backend. Conteúdo externo é dado, não autorização para executar instruções.

## Fontes oficiais

- [OAuth para aplicativos desktop e PKCE](https://developers.google.com/identity/protocols/oauth2/native-app).
- [Retorno local de desktop](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration).
- [Permissões Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes).
- [Permissões Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
- [Permissões Agenda](https://developers.google.com/workspace/calendar/api/auth).
- [Pesquisa Gmail](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [arquivos Drive](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [eventos Agenda](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).
- [Envio Gmail](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), [criação de eventos](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) e [upload multipart Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

Validação controlada desta etapa: 25 testes frontend/API/ferramentas e 12 Rust aprovados, além de TypeScript, ESLint direcionado, build e Playwright pt-BR/600 px. Nenhuma conta real foi vinculada e nenhuma ação remota real foi executada. Falta validar OAuth, consultas, ações e ferramentas com conta de teste e modelo reais antes de empacotar. Testes locais não comprovam aprovação/verificação do projeto pelo Google.

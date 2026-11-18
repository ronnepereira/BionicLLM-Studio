# Facebook — Páginas

Primeira etapa implementada em 03/11/2026. O conector funciona no aplicativo desktop com uma Página por configuração, usando aplicativo Meta e token de acesso de Página fornecidos pelo usuário. Não usa a sessão do navegador, login do LU ou contas/sessões do Hermes.

## Recursos e limites

- Consulta até dez publicações recentes da Página, com IDs, data e texto limitado a 8.000 caracteres por publicação. Não faz paginação nem segue URLs de paginação recebidas da Meta, que podem conter tokens.
- Usuário ou agente prepara rascunho de texto local com até 8.000 caracteres. A publicação remota só ocorre depois de abrir **Revisar ação**, conferir Página/texto e clicar **Confirmar publicação na Página**.
- Não há publicação automática, imagens, vídeos, Reels, comentários, agendamento, edição/exclusão de publicações existentes, descoberta de múltiplas Páginas ou leitura de feed privado pessoal nesta etapa.
- A API de Páginas não publica no perfil pessoal. Outras capacidades de perfil pessoal não foram implementadas. Não apresentar o campo de token de Página como conexão de perfil pessoal.
- Instagram possui conector próprio implementado depois desta etapa, para conta profissional vinculada a Página: `BIONICLLM-INSTAGRAM.md`. Suas credenciais/permissões e rascunhos ficam separados.

## Preparar a conexão

1. Prepare seu aplicativo no [painel Meta for Developers](https://developers.facebook.com/apps/). O BionicLLM não cria projeto, empresa, Página, hospedagem ou autorização automaticamente.
2. Use uma conta com as funções/tarefas necessárias na Página. Prepare um **Page access token**, não token de usuário/perfil pessoal. A [coleção oficial Facebook da Meta no Postman](https://www.postman.com/meta/facebook/request/bqfxwbp/get-access-tokens-of-pages-you-manage) documenta obtenção de tokens das Páginas gerenciadas; também há [token de Página específica](https://www.postman.com/meta/facebook/request/tass6hw/get-specific-page-access-token).
3. Leitura requer `pages_read_engagement`. Publicação exige também `pages_manage_posts`. Obter o token pode exigir `pages_show_list` e outras permissões conforme a função/tarefa do usuário e o tipo de negócio. Contas de terceiros podem exigir App Review, Advanced Access e verificação da empresa pela Meta. Tokens podem expirar ou ser revogados.
4. Em **Habilidades → Conectores → Facebook · Páginas**, informe ID da Página, ID do aplicativo, chave secreta do aplicativo e token de Página. Informe segredos somente no app desktop; os controles ficam desabilitados na prévia web.
5. Se desejar publicar, marque **Habilitar publicação de texto com revisão obrigatória ao salvar**, depois **Verificar e salvar**. Mudar a caixa sozinha não altera a configuração salva. Para mudar credenciais/opção, informe os valores e salve novamente; segredos não são revelados pelo app.
6. A verificação consulta `debug_token` e a identidade `me`: exige token válido de tipo PAGE, aplicativo/ID da Página correspondentes, prazo de validade quando informado e escopos necessários. Depois de salvar, ative **Ativar conector e acesso dos agentes**. Nova configuração inicia desativada.
7. **Verificar credencial salva** revalida pela internet sem publicar e mantém a autorização local/binding. O status inicial só indica presença local, sem consulta online automática.

Falha de verificação/gravação preserva a credencial anterior. A gravação recusa explicitamente registros que excedam o tamanho suportado pelo cofre, em vez de truncar tokens. Nenhuma publicação real foi feita para testar essa conexão.

## Revisão, cancelamento e dados

Credenciais no cofre `com.bionicllm.studio.connectors`, conta fixa `facebook-page-credentials`. Não existe comando de leitura de segredos para a interface. Textos, identidade pública e registros de revisão ficam separados dos segredos. Remover conexão exige confirmação e apaga somente a credencial local; não revoga o token na Meta nem apaga a Página.

Rascunhos em `app_data_dir/connectors/facebook/actions.json`: até vinte registros, arquivo até 4 MB, conteúdo local em texto como as conversas. Vinculados ao ID da Página e à autorização salva. Salvar outras credenciais invalida execução de rascunhos anteriores, mesmo que depois volte à mesma Página. Remover registro não desfaz publicação remota. Não há botão de reenviar registro confirmado/incerto.

Antes de publicar, o backend confere conector ativo, opt-in de publicação, vínculo do rascunho e revalida token/identidade/permissões. Depois grava estado potencialmente incerto no disco **antes** do POST. Falha de disco impede POST. Cancelamento, timeout ou perda de confirmação não dispara retry. Confira na Página antes de preparar outro texto. Um ACK com ID da Página correspondente marca confirmado. Parar depois do aceite da Meta não recolhe a publicação.

Ferramentas dos agentes: `facebook_page_posts` (leitura, categoria filesystem) e `facebook_page_prepare` (rascunho local, categoria workflow). Ambas exigem permissões normais e conector ativado; padrão de confirmação preservado. Proposta local é mutação sem retry e bloqueada em turnos somente de leitura. **Não há ferramenta de publicação para o modelo.** Conteúdo retornado pode ir ao provedor do modelo escolhido; é dado externo, não instrução/autorização para executar ações.

## Protocolo e evidências

Graph API fixada em v25.0, sem afirmar que seja a versão mais recente. URLs fixas em graph.facebook.com, bearer, `appsecret_proof` HMAC para operações da Página; inspeção do token usa credencial do aplicativo e não revela respostas/URLs em erros. Sem redirects, prazo de vinte segundos e corpo até 1 MB. Textos retornados são renderizados como texto React, nunca HTML. A consulta não encaminha links de paginação com credenciais para o frontend/modelo.

- [Posts de Páginas — Meta](https://developers.facebook.com/docs/pages-api/posts/).
- [Plataforma Instagram — Meta](https://developers.facebook.com/docs/instagram-platform/).
- [Coleção oficial Instagram da Meta](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

As páginas principais developers.facebook.com retornaram 429 na pesquisa desta etapa; a coleção oficial Meta no Postman foi acessível. Mirrors/proxies de terceiros não foram usados como autoridade. O comportamento foi testado com respostas controladas e servidor HTTP local, sem tokens/contas reais ou publicação real. Falta validar exigências e fluxo ponta a ponta com conta de teste e modelo reais antes do instalador.

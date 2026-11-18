# Instagram profissional — posts e Reels

Primeira etapa implementada em 03/11/2026: consulta de mídias e publicação com revisão de imagem JPEG única ou Reel por URL pública. O app continua Rust/Tauri + React. Sem conta, projeto Meta, hospedagem ou publicação real criados nesta implementação.

## Modalidade implementada

**Instagram API with Facebook Login**: requer conta Instagram profissional (Business/Creator) vinculada a uma Página do Facebook. Usa um token de Página com permissões Instagram. Não é o conector de publicação da Página: credenciais, autorização e rascunhos do Instagram ficam separados dos do Facebook e WhatsApp. Não há importação silenciosa de segredos de outro conector.

Contas pessoais não são suportadas por esta modalidade. **Instagram Login direto**, com permissões `instagram_business_*` e host graph.instagram.com, é outra configuração e não foi implementado nesta etapa. Não misturar seus tokens/escopos com os campos deste conector.

## Configuração

1. Prepare seu aplicativo Meta e vincule a conta profissional à Página que gerencia. Consulte a [coleção oficial Instagram da Meta](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), seção Instagram API with Facebook Login. O BionicLLM não cria projetos ou altera contas automaticamente.
2. Obtenha um **Page access token** apropriado para o app/Página. Leitura exige `instagram_basic` e `pages_read_engagement`; publicação exige também `instagram_content_publish`. Obtenção do token depende das tarefas/funções da Página e permissões como `pages_show_list`. App Review, Advanced Access ou verificação da empresa podem ser necessários conforme o acesso solicitado/tipo de conta.
3. Em **Habilidades → Conectores → Instagram · Conta profissional**, informe ID da conta profissional, ID da Página vinculada, ID do app, chave secreta e token de Página. Informe segredos somente no aplicativo desktop. A prévia web mantém os campos/comandos nativos desabilitados.
4. Para publicar, marque **Habilitar imagens e Reels com revisão obrigatória ao salvar**, depois **Verificar e salvar**. Mudar o checkbox sozinho não muda a configuração salva. O app verifica validade/tipo/escopos/app/Página do token, vínculo instagram_business_account e identidade id/username antes de salvar. Falha preserva a credencial anterior.
5. Nova autorização começa desativada. Ative **Ativar conector e acesso dos agentes** explicitamente. Verificar credencial salva revalida pela internet, sem publicar; conserva o vínculo dos rascunhos. Salvar outras credenciais gera novo vínculo e impede execução de rascunhos antigos, mesmo se voltar depois à mesma conta.

Uma conta por configuração nesta etapa. Tokens podem expirar ou ser revogados. O status inicial só indica presença local, sem verificação online automática. O cofre recusa explicitamente registros maiores que o tamanho suportado, sem truncar tokens. Remover conexão é local, com confirmação; não revoga na Meta nem apaga a conta.

## Preparar e revisar

Escolha **Imagem (JPEG)** ou **Reel (vídeo)**, informe a URL HTTPS pública e legenda opcional de até 2.200 caracteres. Para Reel, escolha também se deve aparecer no feed. Um agente pode preparar os mesmos dados como rascunho local; isso não cria contêiner, busca o arquivo nem publica.

A URL precisa funcionar para os servidores da Meta sem sessão/cookies/login e permanecer acessível durante o processamento. Assinaturas temporárias na própria URL podem funcionar enquanto válidas. Arquivos do PC, data/file URLs e links que dependam de login não são enviados. O BionicLLM não hospeda, converte nem faz upload binário dos arquivos nesta etapa. JPEG e requisitos reais de vídeo/quota/acesso são validados pela Meta; o app não promete que uma URL sintaticamente válida será aceita.

Abra **Revisar ação**, confira conta, URL completa, legenda, formato e opção de feed, então clique **Confirmar publicação no Instagram**. O texto é renderizado como texto React. Não há prévia que faça download automático da URL. Não há ferramenta de publicar para o modelo: `instagram_media` apenas consulta, `instagram_image_prepare` e `instagram_reel_prepare` apenas preparam propostas locais, com permissões normais. Propostas são mutações locais sem retry, bloqueadas em turnos somente leitura; mobile não recebe esses comandos.

## Processamento e interrupção

Depois da confirmação, o backend revalida credencial/conta/escopos e vínculo do rascunho. Grava estado potencialmente incerto antes do POST de criação de contêiner. Cria /{ig-id}/media com image_url ou media_type=REELS/video_url; salva o ID do processamento antes de continuar. Consulta status_code até cinco vezes, com intervalo de sessenta segundos e limite total de cinco minutos nessa espera. Só FINISHED avança para /{ig-id}/media_publish. IN_PROGRESS aguarda; ERROR, EXPIRED, PUBLISHED inesperado, estado desconhecido ou ID divergente interrompem o fluxo. ACK válido devolve o ID da mídia publicada.

Parar cancela chamadas/espera locais e impede próximos passos. O processamento já iniciado na Meta pode continuar mesmo após a parada; não existe chamada automática posterior do app para publicá-lo. Parar após aceite de media_publish não recolhe publicação. Timeout, falha ou encerramento não provocam retry nem retomada automática.

Contêiner salvo sem ACK de publicação aparece como **ID do processamento**, não como publicação confirmada. Somente sucesso de media_publish muda para **Confirmado pelo Instagram** e **ID da mídia publicada**. Ações não confirmadas não têm botão de reenviar. Confira a conta antes de preparar outra ação; remover registro não desfaz uma publicação remota. Se o ACK ocorreu mas a gravação final falhou, o app orienta conferir a conta sem repetir.

## Dados e limites

Credenciais no cofre `com.bionicllm.studio.connectors`, conta fixa `instagram-professional-credentials`; sem comando de leitura de segredos por IPC, sem localStorage e campos de segredo limpos ao salvar. Rascunhos em `app_data_dir/connectors/instagram/actions.json`, arquivo até 4 MB e vinte registros, em texto local como conversas, incluindo a URL fornecida e eventual assinatura de acesso. Sem tokens Meta no journal. Usa journal/cancelamento compartilhados com outros conectores, com arquivo, grupo de operação e lock independentes.

Consulta até dez mídias por vez, com ID, legenda, tipo e data; sem paginação. Não encaminha URLs paging.next que podem conter credenciais. Conteúdo pode ser enviado ao provedor do modelo escolhido, conforme a conversa; é dado externo, não instrução ou autorização. Stories, carrosséis, mensagens, comentários, agendamento, alteração/exclusão de mídia existente, múltiplas contas e publicação automática não estão incluídos nesta etapa.

Graph v25.0 fixada, host graph.facebook.com (não afirmar versão mais recente). Transporte Meta compartilhado com Facebook: bearer/HMAC appsecret_proof, sem redirects, prazo de vinte segundos por chamada, resposta até 1 MB e erros sem corpos/URLs/tokens. A URL de mídia é validada sintaticamente: HTTPS, sem credenciais embutidas/fragmento, até 2.048 bytes; bloqueia nomes locais e IPs privados comuns, inclusive IPv4 mapeado em IPv6. Não faz resolução DNS nem teste de alcance; Meta faz a busca remota após confirmar.

## Validação

Testes controlados cobrem escopos/vínculo/identidade, URL, limites, separação imagem/Reel, formulários enviados, estado FINISHED obrigatório, cancelamento e journal com contêiner persistido sem retry. Interface/API/ferramentas cobrem prévia sem segredos, revisão antes de executar, conteúdo inerte, escolha de feed e conta alterada/incerteza. Capturas 33/34 em `docs/bionic-preview/`, sem conta/mídia fictícia na prévia. Fontes principais developers.facebook.com retornaram 429; coleção oficial Meta no Postman foi acessível.

Nenhuma conta real ou modelo real foi usado. Os testes locais não substituem validação de token, tarefas da Página, formato da mídia, permissões/revisão do aplicativo e publicação ponta a ponta numa conta de teste. Essa validação continua necessária antes do instalador, que fica por último.

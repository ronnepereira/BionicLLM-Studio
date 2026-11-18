# YouTube e Shorts — primeira etapa

Implementado em 03/11/2026, mantendo Rust/Tauri e o visual atual. Painel em **Habilidades → Conectores → YouTube · Shorts**, recolhido por padrão, com ativar/desativar. A prévia web mostra o layout sem conectar contas, abrir seletor local ou enviar arquivos.

Na etapa TikTok, a seleção/cópia/conferência local passou para `src-tauri/src/commands/connector_media.rs`, compartilhado pelos dois conectores. Formatos, IDs, arquivos salvos, diretório YouTube e comportamento anterior foram preservados; regressões passaram. A leitura do registro também fica limitada durante a desserialização.

## Autorizar o canal

Usa o cliente OAuth do tipo **Aplicativo para computador** salvo na seção Google. O proprietário precisa habilitar **YouTube Data API v3** no próprio projeto e preparar consentimento/usuários de teste quando necessário. O BionicLLM não cria projeto, canal ou conta e não reutiliza sessões do LU/Hermes.

A autorização é independente de Gmail/Drive/Agenda: `youtube.readonly` e identificação por e-mail Google verificado; `youtube.upload` adicional somente quando a opção de envio com revisão é marcada. O fluxo Google existente conserva PKCE, state, retorno temporário em 127.0.0.1, consentimento no navegador padrão e refresh token no cofre. Não usa chave de API para acessar o canal privado. A conexão tem entrada própria `google-youtube`, com canal, e-mail, autorização de envio, estado habilitado e binding da concessão. O cliente compartilhado não pode ser trocado enquanto qualquer conexão Google ou YouTube local existir.

Antes de salvar, `channels.list(mine=true)` deve retornar exatamente um canal válido e sua playlist de envios. Não escolhe outro canal por ID informado pelo usuário/modelo. Nova autorização começa desativada e invalida rascunhos anteriores, mesmo no mesmo canal. Falhas preservam a conexão anterior. Remover localmente não revoga a concessão no Google nem apaga vídeos.

Consultas e confirmação de envio renovam o acesso e conferem novamente e-mail/canal. As permissões concedidas são verificadas na autorização e, quando devolvidas, na renovação do token. Restrições do canal, consentimento em modo teste, verificação do aplicativo e cotas dependem do Google/YouTube. Não há promessa de publicação pública nem de aprovação do projeto. Contas de marca e demais modalidades precisam ser verificadas com contas reais; esta etapa exige uma identidade Google verificável e um único canal.

## Consultas e agentes

Consulta até dez envios da playlist do próprio canal, com detalhes por `videos.list`. Retorna ID, título, descrição, data, duração e status, sem buscar vídeos, miniaturas ou páginas externas. Não segue tokens/URLs de paginação.

Ferramentas:

- `youtube_videos`: consulta os vídeos do canal explicitamente habilitado.
- `youtube_files`: retorna identidade local do canal autorizado e metadados/IDs das cópias escolhidas pelo usuário. A autorização é conferida no comando nativo de inventário, sob o mesmo bloqueio de desativação, com cancelamento; não combina status antigo com listagem da interface.
- `youtube_prepare`: prepara rascunho local usando um desses IDs. Exige título, descrição, categoria, visibilidade e classificações explícitas. Não escolhe arquivo, não aceita caminho/URL e não envia vídeo.

Não há ferramenta de upload, exclusão remota ou seletor de arquivos para o modelo. Propostas locais são mutantes e bloqueadas em somente leitura. Ferramentas não são expostas no mobile nem em pedidos de programação sem relação com YouTube. Roteamento para modelos pequenos prefere arquivos + preparar ao solicitar envio. Nomes e textos recebidos são dados sem autoridade; a consulta pode enviar metadados ao provedor escolhido na conversa, nunca os bytes do vídeo por essas ferramentas.

## Seleção e revisão

O usuário seleciona MP4, MOV, WebM ou MKV pelo seletor nativo. Limite inicial do app: **512 MiB por arquivo e cinco cópias locais**. Extensão/assinatura básica conferidas; o app não decodifica nem garante codec, dimensões ou duração. O YouTube faz o processamento final.

O app copia o arquivo para armazenamento próprio, atribui UUID e calcula SHA-256 durante cópia em blocos de 64 KiB. Não expõe o caminho original à interface/modelo. A cópia permanece em `connectors/youtube/files` até remoção explícita no painel. Alterações posteriores no original não alteram a cópia. Antes do envio, tamanho e digest são conferidos novamente no mesmo arquivo aberto; no Windows, o handle impede escrita/exclusão concorrente durante o envio. Cancelamento/falha durante cópia remove a cópia incompleta quando possível. Cópias órfãs após encerramento abrupto podem exigir limpeza do armazenamento local em uma etapa futura; não há coleta automática nesta versão.

O formulário permite título de até 100 caracteres, descrição de até 5.000 bytes UTF-8, categoria, visibilidade **Privado / Não listado / Público**, indicação de conteúdo infantil e de conteúdo realista alterado/sintético. A visibilidade começa privada; ambas as classificações exigem resposta explícita. Os campos não aceitam `<` ou `>` conforme limites do YouTube. O usuário revisa canal, arquivo e todos esses dados antes de confirmar.

Excluir uma cópia local mantém o original e os vídeos remotos, mas impede envios pendentes que a referenciam. Remover rascunho não remove a cópia nem desfaz um envio.

## Shorts

Shorts usam o mesmo `videos.insert`; não existe campo `isShort` neste fluxo. A opção do painel registra apenas a intenção, sem enviar uma flag inventada à API. O YouTube classifica vídeos quadrados/verticais de até três minutos conforme suas regras vigentes. A classificação pode ocorrer mesmo com a intenção desmarcada; o app não recorta, converte, mede nem garante Shorts. Direitos e processamento continuam sujeitos ao YouTube.

## Transferência e confirmação

Journal tipado compartilhado em `connectors/youtube/actions.json`, até vinte registros/4 MB, vinculado ao canal e à concessão OAuth. Metadados e cópia ficam fixos no rascunho. Antes de iniciar qualquer POST, o app verifica canal/concessão/arquivo e grava fase `uncertain`; falha de disco impede envio. Rascunhos de conta/autorização diferentes são recusados.

Usa protocolo de sessão de upload do YouTube: POST com metadados em `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable`, depois um PUT com o arquivo em fluxo. `notifySubscribers=false` nesta etapa. A URL `Location` é validada por origem HTTPS, host, caminho e ID de upload antes de receber token/arquivo. Redirecionamentos não são seguidos. A sessão usa até vinte segundos na criação; a transferência tem limite de vinte minutos e o fluxo inteiro de 21 minutos. Confirmação JSON limitada a 1 MB, exigindo ID de vídeo válido, canal exato e visibilidade reconhecida. Erros não incluem corpos remotos, URLs de sessão ou tokens.

Esta versão usa **uma transferência completa, sem retomada ou repetição automática**, apesar do protocolo escolhido permitir retomada. Se falhar, cancelar ou reiniciar, o usuário deve conferir o canal antes de criar outro rascunho. A sessão não é persistida/reutilizada e um resultado incerto não é reenviado. Cancelar não desfaz um upload aceito. A confirmação informa apenas que o upload foi aceito; processamento, publicação e visibilidade efetiva devem ser conferidos no YouTube. O ID remoto permite localizar o vídeo; o painel não afirma que a visibilidade solicitada foi aplicada.

Sem agendamento, edição/exclusão de vídeos remotos, legendas, comentários, miniaturas, playlists adicionais, notificações aos inscritos ou múltiplos canais simultâneos nesta etapa.

## Provas e continuidade

Testes controlados verificam OAuth/escopos, canal único, metadados/classificações, seleção por ID, cópias/digest/limites, revisão, replay, cancelamento, transmissão HTTP local, recibo, URLs e respostas limitadas. Não houve autorização de conta real, envio real, projeto externo criado ou modelo real executado. Esses testes ponta a ponta precisam ocorrer antes de empacotar.

Capturas: `docs/bionic-preview/37-youtube-canal-videos.png` e `38-youtube-revisao-compacto.png`. Resultados exatos dos checks estão em `BIONICLLM-CONTINUIDADE.md`. Próximo conector: TikTok. Instalador Windows por último.

Referências oficiais consultadas:

- https://developers.google.com/youtube/data/reference/rest/v3/videos/insert
- https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol
- https://developers.google.com/youtube/data/reference/rest/v3/channels/list
- https://developers.google.com/youtube/data/reference/rest/v3/videos
- https://support.google.com/youtube/answer/15424877?hl=pt-BR

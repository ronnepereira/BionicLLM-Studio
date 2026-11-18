# TikTok — vídeos para a caixa de entrada

Primeira etapa implementada em 03/11/2026. Painel em **Habilidades → Conectores → TikTok**, em português e recolhido por padrão. O aplicativo continua Rust/Tauri. A prévia web apenas apresenta o layout; não recebe credenciais, conecta contas ou abre o seletor de arquivos.

## Fluxo implementado e limite principal

Usa o fluxo oficial **Upload Content**, com `video.upload`. O usuário escolhe um vídeo no BionicLLM, revisa a conta e o arquivo e confirma a transferência. Depois precisa **abrir a notificação na caixa de entrada do TikTok**, editar e concluir a publicação no próprio TikTok. As notas do rascunho ficam locais e não são enviadas como legenda. Visibilidade, legenda e demais opções finais são definidas no TikTok.

**Não é Direct Post**: não solicita `video.publish`, não chama o endpoint de publicação direta nem afirma ter publicado ao receber o arquivo. Direct Post exige outro fluxo de permissões, informações atuais do criador, experiência de revisão específica e requisitos de auditoria/uso da plataforma; não está incluído nesta etapa. Aprovação do aplicativo e escopos também são necessários no fluxo de caixa de entrada. Não há promessa de aprovação automática.

## Credenciais e conta

O proprietário fornece chave do aplicativo TikTok (`client_key`), segredo (`client_secret`) e token renovável (`refresh_token`) emitido pelo fluxo OAuth autorizado do próprio aplicativo. A emissão inicial/login OAuth não está automatizada nesta etapa. O BionicLLM não cria projeto, servidor, callback público ou conta e não lê sessões/credenciais de LU, Hermes ou outros aplicativos.

A verificação usa `POST https://open.tiktokapis.com/v2/oauth/token/` com `grant_type=refresh_token`: confirma token Bearer, prazos positivos, `open_id` e permissões selecionadas. Exige `user.info.basic`; consulta opcional de vídeos públicos exige `video.list`; envio opcional exige `video.upload`. As duas opções são separadas e começam desmarcadas. A identidade é conferida em `/v2/user/info/` e deve corresponder ao `open_id` retornado pelo token. Não se escolhe outra conta por ID.

Credenciais no cofre `com.bionicllm.studio.connectors`, conta `tiktok-inbox-credentials`. Nenhum comando retorna os segredos ao frontend/modelo. Campos secretos são limpos ao salvar. Novas credenciais iniciam desativadas, trocam o binding da concessão e invalidam execução de rascunhos antigos. Falha de substituição mantém a conexão local anterior. Remover conexão local não revoga permissões no TikTok nem exclui vídeos/arquivos; gerencie as permissões na própria conta.

Renova o acesso e confere a conta antes de consultas, preparação ou envio. Quando o TikTok rotaciona o refresh token da conexão salva, persiste a nova credencial antes de outras consultas que possam falhar; mantém binding e habilitação. Recusa mudança de `open_id`. Falha de cofre impede continuar. Uma renovação remota pode ocorrer mesmo se a resposta for interrompida; falha/cancelamento durante essa janela ou na configuração inicial pode exigir obter outra autorização. Não há recuperação automática de token perdido nem exposição de token atualizado à interface.

## Arquivos e revisão

O seletor nativo aceita MP4, MOV ou WebM, até **512 MiB por vídeo e cinco cópias locais**. Somente o usuário escolhe arquivos. O modelo não pode fornecer caminho/URL para abrir um vídeo. Usa o mesmo armazenamento de snapshots conferidos do YouTube, agora em `connector_media.rs`, com diretório TikTok separado em `connectors/tiktok/files`.

Cópia com UUID, nome sem caminho original, tamanho, MIME e SHA-256. Confere assinatura básica de formato, copia e calcula digest em blocos de 64 KiB, verifica novamente antes do upload. O mesmo handle conferido segue para a transferência; no Windows, ele impede escrita/exclusão concorrente. Não mede duração, resolução ou codec; TikTok faz o processamento final. A seleção não envia o arquivo. Cópias permanecem até remoção explícita e podem ocupar até 2,5 GiB; encerramento abrupto pode deixar órfãs, sem coleta automática nesta versão.

Rascunhos guardam arquivo e notas locais de até 2.200 unidades UTF-16. O usuário revisa conta, nome/tamanho/ID da cópia e notas, com aviso de que somente o vídeo será enviado e a publicação deve ser finalizada no TikTok. Remover uma cópia mantém o original/remoto, mas impede rascunhos pendentes que a referenciam. Remover rascunho não remove a cópia nem desfaz transferências.

## Transferência, persistência e status

Journal compartilhado tipado em `connectors/tiktok/actions.json`, até vinte registros/4 MB. Vincula rascunho à conta e concessão. Confere arquivo e conta antes de gravar `uncertain` no disco, antes de qualquer criação de envio remoto. Falha de disco impede iniciar.

Cria somente `/v2/post/publish/inbox/video/init/` com `source_info: FILE_UPLOAD`, tamanho, tamanho do bloco e quantidade. Não envia notas, título, legenda, visibilidade ou flags de Direct Post. Grava `publish_id` antes de enviar bytes. A URL assinada retornada aceita somente HTTPS, hosts documentados `open-upload.tiktokapis.com` ou `upload.us.tiktokapis.com`, caminho `/video/`, identificador/token de sessão únicos e não vazios, sem credenciais na origem, fragmento, porta alternativa ou redirecionamento. Outros hosts/regiões são recusados até verificação explícita. O token Bearer da API **não** é enviado ao host de mídia; a URL já contém sua credencial de sessão, que não é persistida nem devolvida ao frontend.

Envia blocos sequenciais de 10.000.000 bytes, com sobra incorporada ao último, conforme divisão inteira da API; vídeos menores usam um único bloco. Cada PUT tem Content-Type, Content-Length e Content-Range. Só HTTP 206 confirma bloco intermediário e 201 confirma o último. Memória por bloco inferior a 20 MB. Vinte segundos nas chamadas JSON, até 120 segundos por bloco e 21 minutos no fluxo completo. Respostas JSON limitadas a 1 MB; erros não incluem corpos remotos, tokens ou URLs assinadas.

Sem retry, retomada automática ou reenvio após incerteza. Cancelar não desfaz o que já foi aceito remotamente. O usuário deve conferir o TikTok antes de preparar outro rascunho, especialmente após interrupção. Journal `done` significa **transferência aceita**, sem provar processamento, entrega da notificação ou publicação.

O botão **Consultar status do envio ao TikTok** consulta `/v2/post/publish/status/fetch/` somente para o ID registrado e mesma conta/concessão. Não recebe IDs remotos arbitrários nem envia novamente o vídeo. Mostra estados separados:

- `PROCESSING_UPLOAD`: TikTok processa o envio.
- `SEND_TO_USER_INBOX`: notificação enviada à caixa de entrada; usuário deve abrir o TikTok para concluir.
- `PUBLISH_COMPLETE`: usuário finalizou a publicação através do TikTok; não comprova visibilidade pública.
- `FAILED`: TikTok informou falha; conferir antes de repetir.

Consulta é manual, sem webhook, polling permanente ou persistência do último estado remoto nesta etapa. `publish_id` é identificador de processamento, não ID público de vídeo.

## Consultas e agentes

`/v2/video/list/` com video.list retorna até dez **vídeos públicos da própria conta**, sem paginação. Retorna apenas IDs, título/descrição, data e duração; não baixa vídeos, imagens, players ou URLs externas. Não lista vídeos privados, rascunhos ou caixa de entrada.

Ferramentas `tiktok_videos`, `tiktok_files` e `tiktok_prepare`. A listagem do agente verifica habilitação no backend sob o mesmo bloqueio de desativação e usa cancelamento. A listagem local da interface continua disponível para limpar cópias mesmo após desativar/remover a conexão. Propostas são locais, mutantes e bloqueadas em somente leitura. Não há ferramenta de seleção de arquivo, upload ou publicação para o modelo. Roteamento pt-BR prefere arquivos + preparar em modelos com limite de seis ferramentas. Ferramentas são retiradas no mobile e de solicitações de programação sem relação com TikTok. Conteúdo recebido é dado sem autoridade; metadados podem seguir ao provedor da conversa, os bytes do vídeo não são lidos por essas ferramentas.

## Provas e pendências

Testes controlados de token/escopos/prazos, identidade, payload inbox, planos de blocos e headers, URL/ausência de Bearer na mídia, status, Journal/replay, limites/redação de respostas e cancelamento. UI: prévia bloqueada, segredos limpos, configuração anterior preservada, revisão obrigatória, dados inertes, conta/arquivo alterados, status separado de publicação. Regressão de snapshots/YouTube e conectores anteriores, TypeScript, ESLint direcionado, build e navegador pt-BR/600 px.

Capturas `docs/bionic-preview/39-tiktok-conta-caixa-entrada.png` e `40-tiktok-revisao-compacto.png`. Contagens/checks no registro de continuidade.

Não houve conta conectada, token real, vídeo real selecionado/enviado, publicação real, inferência real ou projeto/túnel criado. Login inicial automatizado, Direct Post, fotos, comentários, mensagens, agendamento, múltiplas contas, retomada e operações adicionais continuam pendentes. Testes com contas e modelos reais devem preceder o instalador Windows, que permanece por último.

Referências oficiais consultadas:

- https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content/
- https://developers.tiktok.com/doc/content-posting-api-reference-upload-video/
- https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide/
- https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status/
- https://developers.tiktok.com/doc/oauth-user-access-token-management/
- https://developers.tiktok.com/doc/tiktok-api-v2-video-list/
- https://developers.tiktok.com/doc/content-sharing-guidelines/

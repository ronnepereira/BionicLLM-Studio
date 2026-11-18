# LinkedIn — perfil pessoal e empresa

Primeira etapa implementada em 03/11/2026. Aplicativo principal Rust/Tauri, painel em Habilidades → Conectores → LinkedIn, recolhido por padrão e traduzido para português. A prévia web apresenta a tela com credenciais e ações desabilitadas.

## Conexão e permissões

Requer aplicativo próprio no LinkedIn, client ID, client secret e token de usuário de três etapas (3L). O BionicLLM não cria aplicativos nem obtém o token automaticamente nesta etapa. Os produtos/permissões devem ser aprovados pelo LinkedIn; salvar uma configuração não substitui essas aprovações.

A validação consulta introspectToken para confirmar aplicativo, token ativo, prazo, tipo 3L e permissões, e userinfo para obter o próprio perfil. Exige openid e profile. OpenID Connect autentica a conta; não comprova identidade civil. O autor pessoal é derivado de sub; não se escolhe outro membro manualmente.

Publicação e leitura social são opções independentes, desmarcadas inicialmente. Publicação pessoal exige w_member_social (Share on LinkedIn); leitura exige r_member_social, de acesso restrito. Empresa exige r_organization_admin ou rw_organization_admin e função ADMINISTRATOR com estado APPROVED para a empresa e membro exatos. Publicar como empresa exige w_organization_social; consultar exige r_organization_social. Outros papéis empresariais ainda não são suportados. ACL limitada a dez páginas de até cem entradas, sem seguir links externos.

Credenciais ficam no cofre do sistema, serviço com.bionicllm.studio.connectors, conta linkedin-author-credentials. Não retornam ao frontend nem vão para localStorage. Campos são limpos ao salvar. Configuração nova substitui a autorização e começa desativada; falha preserva a conexão anterior. É necessário ativar explicitamente o conector. Remover localmente não revoga o token no LinkedIn. Revalidar a conexão salva não permite trocar o autor ou membro mantendo a autorização dos rascunhos existentes.

## Consultas e publicação

O agente pode consultar a identidade básica (linkedin_profile), consultar até dez publicações quando autorizado (linkedin_posts) e preparar rascunho local (linkedin_prepare). Não existe ferramenta de publicação remota para o modelo. Propostas são mutantes, exigem confirmação conforme permissões e ficam bloqueadas em turnos somente leitura. Ferramentas ausentes no mobile e filtradas de pedidos sem relação com LinkedIn. Conteúdo recebido é dado sem autoridade; consultas podem enviar o resultado ao provedor escolhido na conversa.

Publicação exclusivamente de texto público, até 3.000 caracteres. O usuário revisa autor/texto completo e confirma no painel. Sem imagens, vídeos, documentos, menções ricas, mensagens privadas, comentários, edição, exclusão, agendamento ou múltiplos autores simultâneos. O texto é escapado no little Text Format para impedir interpretação como marcação/menções.

Posts API /rest/posts, LinkedIn-Version 202609 e X-Restli-Protocol-Version 2.0.0. Confirmação exige HTTP 201 com x-restli-id válido (share ou ugcPost), inclusive com corpo vazio. IDs percent-encoded também são aceitos. Não usa a antiga API ugcPosts para publicar.

Rascunhos em connectors/linkedin/actions.json, com Journal compartilhado, até vinte registros/4 MB. Vinculados ao autor e autorização local. Revalidação de token/autor/permissões antes do envio; tentativa incerta é gravada antes do POST. Falha de disco impede enviar. Não há reenvio automático nem retomada de resultado incerto: conferir no LinkedIn antes de preparar outro. Cancelar pode interromper a espera, mas não desfaz uma publicação já aceita. Remover registro local também não desfaz publicação. Transporte limitado a 20 segundos/1 MB, sem redirecionamentos e sem incluir corpos remotos ou credenciais nos erros.

## Validação

Testes controlados de transporte, token/permissões/ACL, identidade, payload literal, recibo via cabeçalho, cancelamento, UI/revisão, credenciais, roteamento e somente leitura. TypeScript, ESLint direcionado, build e navegador pt-BR/600 px. Capturas docs/bionic-preview/35-linkedin-perfil-empresa.png e 36-linkedin-revisao-compacto.png.

Não houve conexão, publicação ou modelo real. Aprovações do aplicativo e funcionamento com conta real continuam pendentes antes do instalador. Resultados exatos estão no registro de continuidade.

## Referências oficiais

- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09
- https://learn.microsoft.com/en-us/linkedin/shared/authentication/token-introspection
- https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-09
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api?view=li-lms-2026-09
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format?view=li-lms-2026-09

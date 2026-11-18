# Português do Brasil

O usuário pediu interface em português do Brasil, mantendo a opção de inglês. A reformulação visual no estilo Cline está suspensa por orientação explícita. O layout atual permanece.

## Implementação

- `src/lib/locales/pt-BR.json`: catálogo local de mensagens; 4.937 entradas nesta etapa, incluindo dados auxiliares. Parte das entradas é reservada para mensagens que aparecem somente em estados específicos.
- `src/lib/ui-copy.ts`: tradução e interpolação puras, sem acesso a conta, rede ou armazenamento. Preserva parâmetros de diagnóstico como texto.
- `src/lib/ui-text.ts`: assinatura reativa da preferência de idioma no store existente.
- `src/lib/i18n.ts`: catálogo pequeno já existente para navegação/idioma. Não traduzir seus valores em português outra vez.
- Chamadas explícitas `uiText(...)` somente em cópia da interface. NÃO passar mensagens do usuário/modelo, código gerado, nomes de arquivos, caminhos, comandos, nomes de modelos ou conteúdo de documentos.
- Nomes de personas e fluxos são traduzidos somente quando `isBuiltIn` é verdadeiro. Conteúdo personalizado não muda.
- Títulos originais das seções de configurações continuam sendo as chaves dos links internos; só o texto apresentado é traduzido.
- Preferências, IDs, enums de ferramentas, parâmetros de geração, nomes de comandos e ações permanecem com os mesmos valores.
- Datas de conversas usam português quando selecionado, com compatibilidade dos chamadores em inglês.
- Recuperação de falha de inicialização continua independente do store. Diagnósticos técnicos originais são preservados.

## Geração e revisão

Os utilitários de desenvolvimento usam a AST do TypeScript para distinguir textos e atributos de interface de valores internos. Originais ficam em `C:\Users\RONNE\BionicLLM-backups\2026-11-02-traducao`.

1. `node scripts/localize-ui.mjs`: inventariar cópia em JSX.
2. `node scripts/localize-ui-data.mjs`: inventariar rótulos de dados estáticos e localizar pontos de exibição comprovadamente autorais.
3. `python scripts/translate-ui.py`: gerar rascunhos para entradas ausentes. Esse comando de DESENVOLVIMENTO usa o endpoint público Google Translate; não enviar dados do usuário. Não é executado pelo aplicativo nem durante seu build.
4. `node scripts/review-pt-catalog.mjs`: aplicar terminologia revisada, preservar marcas/identificadores e excluir chaves de navegação que já são portuguesas. Revisar também o texto longo e qualquer instrução relacionada a segurança antes da distribuição.
5. `node scripts/localize-ui.mjs apply` e `node scripts/localize-ui-data.mjs apply`: aplicar cópia explicitamente, com backup. A segunda passagem evita nomes de modelos/vozes.
6. `npm run build`; servir com `npm run preview -- --host 127.0.0.1 --port 5274`.
7. `node scripts/audit-portuguese-ui.mjs`: conferir as telas conhecidas. O comando falha se encontrar mensagens conhecidas do catálogo ainda em inglês. `visible-copy.json` permite revisar mensagens que não estavam no catálogo. O perfil do navegador é isolado.
8. `node scripts/inventory-visible-copy.mjs`: acrescentar somente mensagens observadas que também correspondem a literais no código. Não acrescentar conteúdo externo do navegador ao catálogo.
9. `node scripts/bionic-preview.mjs`: capturas e prova de troca de idioma/persistência/menu compacto.

## Provas desta etapa

- 11 telas/grupos auditados: Chat, Criar, Voz, Comparar, Benchmark, Modelos, Configurações e quatro grupos de configurações com seções abertas.
- Último relatório em `browser-audit.json`: zero mensagens conhecidas pendentes nas telas auditadas.
- 75 testes aprovados: idioma/persistência, compatibilidade de preferências, parâmetros do catálogo, preservação/envio do rascunho, datas, recuperação de falhas, formatação e atualização do painel durante streaming/compartilhamento.
- Verificador dos backups: 6.920 valores de atributos, rotas, comandos e identificadores preservados em 213 componentes comparados.
- TypeScript, ESLint e build web aprovados.
- O navegador conserva a entrada de mensagem e seu texto quando o idioma muda; o texto enviado ao modelo permanece idêntico ao digitado.

## Limites da verificação

Zero ocorrências no relatório NÃO prova todos os estados do aplicativo. Esta etapa não executou inferência GGUF, instalação de runtimes, geração real de imagens/vídeo, voz real, erros de todas as ferramentas nem todas as janelas nativas. Esses caminhos ainda devem ser exercitados no desktop para concluir a exigência de 100% de português em toda a experiência. Textos de serviços externos, metadados novos de catálogos e diagnósticos técnicos podem permanecer no idioma de origem; não apresentar isso como tradução integral já validada.

A remoção posterior do serviço pago LU, a identidade nativa BionicLLM Studio e a desativação do atualizador original estão documentadas em `../BIONICLLM-CONTINUIDADE.md`. O catálogo atual também inclui navegador, descoberta de habilidades, agenda e barra inferior. Não distribuir antes da revisão final de instalador, armazenamento e testes com modelos reais.

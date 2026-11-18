import { useSettingsStore } from '../stores/settingsStore'
import type { Settings } from '../types/settings'

/** Only app-authored notices enter here, including notices saved by older versions. */
export function localizeAgentNotice(source: string, language: Settings['language'] = useSettingsStore.getState().settings.language): string {
  if (language === 'en') return source
  const applied = source.match(/^Applied staged change: ([\s\S]+)$/)
  if (applied) {
    const detail = applied[1].match(/^([\s\S]+) \(merged with (\d+) changes? made on disk since it was staged, so this file is not byte for byte the diff you approved\)$/)
    return detail
      ? 'Alteração aplicada: ' + detail[1] + ' (mesclada com ' + detail[2] + ' alterações feitas no arquivo desde a preparação; o conteúdo final difere do comparativo aprovado)'
      : 'Alteração aplicada: ' + applied[1]
  }
  const run = source.match(/^Summarised (\d+) earlier step messages? of this run to stay inside the context window, about (.+?) tokens less in every following step\. The run goes on from the summary; every result is still here in the chat\.$/)
  if (run) return `Foram resumidas ${run[1]} mensagens anteriores desta execução para respeitar o limite de contexto, economizando cerca de ${run[2]} tokens por etapa seguinte. A execução continua a partir do resumo. Todos os resultados permanecem no chat.`
  const chat = source.match(/^Summarised (\d+) earlier messages?, about (.+?) tokens less in every following request\. The full conversation is still here; only what gets sent changed\.$/)
  if (chat) return `Foram resumidas ${chat[1]} mensagens anteriores, economizando cerca de ${chat[2]} tokens por solicitação seguinte. A conversa completa permanece no histórico. O resumo é usado no contexto enviado ao modelo.`
  const halt = source.match(/^⛔ Loop guard halted the run: ([\s\S]+)\.$/)
  if (halt) return `⛔ A execução foi interrompida pela proteção contra repetição. ${localizeLoopReason(halt[1])}.`
  const stopped = source.match(/^(\s*)_\(halted: ([\s\S]+)\. The model is looping\. Try a stronger model for multi-step (?:code )?tasks, or rephrase the instruction\.\)_$/)
  if (stopped) return `${stopped[1]}_(Execução interrompida. ${localizeLoopReason(stopped[2])}. O modelo repetiu ações sem avançar. Confira o erro da etapa e reformule a instrução ou experimente outro modelo.)_`
  const suffix = source.match(/^([\s\S]+\n\n)(_\(halted: [\s\S]+\)_$)/)
  if (suffix) return suffix[1] + localizeAgentNotice(suffix[2], language)
  return source
}

function localizeLoopReason(reason: string): string {
  return reason
    .replace(/^same tool sequence repeated (\d+)× in a row$/, 'A mesma sequência de ferramentas foi repetida $1 vezes seguidas')
    .replace(/^same tool sequence repeated (\d+)× within the last (\d+) steps with no workspace change$/, 'A mesma sequência de ferramentas foi repetida $1 vezes nas últimas $2 etapas, sem alterações na pasta de trabalho')
    .replace(/^(.+) repeated (\d+)× with identical arguments and an unchanged workspace$/, '$1 foi repetida $2 vezes com os mesmos argumentos, sem alterações na pasta de trabalho')
    .replace(/^the user declined (\d+) '(.+)' (commands|calls) in a row$/, 'O usuário recusou $1 chamadas de $2 seguidas')
    .replace(/^(\d+) failed '(.+)' commands in a row with nothing changing the workspace in between$/, '$1 comandos de $2 falharam seguidamente, sem alterações na pasta de trabalho')
    .replace(/^(\d+) rounds in a row where every tool call (failed|was declined by the user|failed or was declined by the user) \((.+)\) and nothing changed in between$/, (_, count: string, outcome: string, names: string) => `${count} etapas seguidas em que todas as chamadas de ferramentas ${outcome === 'failed' ? 'falharam' : outcome === 'was declined by the user' ? 'foram recusadas pelo usuário' : 'falharam ou foram recusadas pelo usuário'} (${names}), sem alterações entre elas`)
    .replace(/^the model repeated the same message (\d+)× without making progress$/, 'O modelo repetiu a mesma mensagem $1 vezes sem avançar')
    .replace(/^the model wrote the same plan (\d+) times \("([\s\S]+)"\) and kept starting over instead of carrying it out$/, 'O modelo escreveu o mesmo plano $1 vezes ("$2") e recomeçou repetidamente sem executá-lo')
}

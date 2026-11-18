/**
 * B1 Nachbesserung 1 (Opus-Review, 3.0.1) - der Orchestrator-Entscheid "Stop
 * heisst Stop" galt von Anfang an fuer fuenf Ausloeser: der Stop-Knopf,
 * Abmelden, Fenster schliessen, App beenden, Netzabbruch. Gebaut war nur der
 * erste. Ohne die anderen vier feuert ein Hintergrundagent weiter, nachdem
 * der Nutzer sich abgemeldet hat - mit einem Konto, das er gerade verlassen
 * hat glaubt. Das ist die teuerste der vier Luecken.
 *
 * `stopAllBackgroundWork()` ist die eine Stelle: sie laeuft ueber JEDEN
 * laufenden Lauf, egal welcher der drei Sendewege ihn gestartet hat, und
 * wendet dasselbe Paar an, das der Stop-Knopf selbst benutzt
 * (generationStore.abortConversation + lib/run-stop's stopRun) - kein neuer
 * Mechanismus, nur derselbe an mehr Stellen.
 *
 * ── Runde 2 (Final Verifier, 18.09.): zwei Blocker in dieser Datei ─────────
 *
 * BLOCKER Reichweite: diese Funktion lief bis heute nur ueber
 * `useAgentTaskStore.byConv`, also nur ueber Konversationen, die je eine
 * `delegate_task`-Unteraufgabe gestartet haben. Eine normale Agenten- oder
 * `/loop`-Schleife OHNE Unteraufgabe lief nach Abmelden, Schliessen und
 * Netzabbruch ungebremst weiter. Jetzt: die Vereinigung aus drei Quellen,
 * keine davon eine Kopie einer anderen -
 *   `agentTaskStore.byConv`        delegate_task-Hintergrundlaeufe.
 *   `generationStore.generating`   JEDER Strom, der gerade Token zieht:
 *                                  Chat, Agent, Codex, egal welcher Hook.
 *   `agentLoopStore.loop`          ein `/loop`-Pass, der zwischen zwei
 *                                  Durchgaengen auf seinen Zeitgeber wartet -
 *                                  generiert nichts, `generating` sieht ihn
 *                                  also nicht, aber er feuert die naechste
 *                                  Cloud-Anfrage trotzdem.
 *
 * BLOCKER Netzabbruch: `offline` rief bis heute `stopAllBackgroundWork()`
 * selbst, mit dem KLEBRIGEN `stopRun`-Merker. Ein zwei Sekunden langer
 * WLAN-Wackler, ein VPN-Wechsel, ein Sleep/Wake toetete damit unwiderruflich
 * jede Agentenarbeit in jeder Konversation - genau die Faelle, fuer die
 * `providers/retry.ts` Netzfehler bewusst wie 429/503 wiederholt. `offline`
 * stoppt jetzt nichts mehr: es zeigt nur einen sichtbaren Hinweis
 * (`backgroundShutdownStore`), dass die Verbindung weg ist und laufende
 * Arbeit wartet bzw. beim naechsten Versuch wiederholt. Ein Wackler kostet
 * damit hoechstens eine verzoegerte Antwort, nie den ganzen Lauf.
 *
 * ── Runde 4 (review-lanes.md Blocker 1+6): eine vierte Quelle, `generating`
 * konnte sie nicht sehen ──────────────────────────────────────────────────
 *
 * `lib/run-slot.ts` bucht einen Lauf (`generationStore.runs[id]`) und meldet
 * seinen Abbruchgriff (`aborters[id]`) an, SOBALD er sich bei der lokalen
 * Spur anstellt, nicht erst, wenn er drankommt. `setGenerating(id, true)`
 * ruft dagegen erst der Sendeweg selbst, innerhalb seines eigenen Rumpfs, der
 * beim blossen Warten noch gar nicht angelaufen ist. Ein Lauf, der NUR
 * wartet, also noch kein Token gezogen hat, stand damit in `runs`, aber in
 * keiner der drei Quellen unten. Diese Funktion sah ihn nicht, rief seinen
 * Abbruchgriff nie, und die Zeile blieb in `run-lanes.ts`s Warteschlange
 * stehen: Abmelden, Fenster schliessen oder App beenden liessen einen
 * wartenden Lauf danach einfach lostraben, sobald sein Platz frei wurde,
 * fuer einen Nutzer, der laengst weg war. `runs` ist jetzt die vierte
 * Quelle.
 */
import { useAgentTaskStore } from '../stores/agentTaskStore'
import { useGenerationStore } from '../stores/generationStore'
import { useAgentLoopStore } from '../stores/agentLoopStore'
import { stopRun } from './run-stop'
// Not `api/backend`: that one imports settingsStore, and this module is loaded
// by main.tsx before the onboarding handover (api/in-tauri.ts).
import { isMobile } from './device-kind'
import { useBackgroundShutdownStore } from '../stores/backgroundShutdownStore'

/**
 * Bricht jeden laufenden Lauf in jeder Konversation ab und setzt den
 * Stop-Merker fuer jede von ihnen - unabhaengig davon, welche Konversation
 * gerade sichtbar ist und ueber welchen der drei Sendewege der Lauf lief.
 * Kein Ausloeser hier kennt "die aktive Konversation": das Abmelden, das
 * Schliessen und das App-Beenden treffen die ganze Sitzung, nicht nur den
 * gerade offenen Tab.
 */
export function stopAllBackgroundWork(): void {
  const ids = new Set<string>()
  for (const convId of Object.keys(useAgentTaskStore.getState().byConv)) ids.add(convId)
  for (const convId of Object.keys(useGenerationStore.getState().generating)) ids.add(convId)
  // Per Konversation seit B2 Commit 3 (davor war das ein einziger globaler
  // Platz): jede Konversation mit einem wartenden /loop-Pass zaehlt, nicht
  // nur eine.
  for (const convId of Object.keys(useAgentLoopStore.getState().loops)) ids.add(convId)
  // Runde 4: ein Lauf, der sich erst bei der lokalen Spur angestellt hat und
  // noch kein Token gezogen hat, steht in `runs`, aber in keiner der drei
  // Quellen oben (siehe Kopf der Datei).
  for (const convId of Object.keys(useGenerationStore.getState().runs)) ids.add(convId)

  for (const convId of ids) {
    useAgentTaskStore.getState().cancelAll(convId)
    useGenerationStore.getState().abortConversation(convId)
    stopRun(convId)
    useAgentLoopStore.getState().clear(convId)
  }
}

/** Die von `installBackgroundShutdown` gesetzten Horcher, fuer Idempotenz. */
let installed: (() => void) | null = null

/**
 * Haengt `stopAllBackgroundWork` an die Ausloeser, die kein Knopf im UI
 * sind: App beenden, Fenster schliessen (mit Karenzzeit), Netzabbruch (nur
 * noch als Hinweis, siehe Kopf der Datei; Abmelden ruft die Funktion direkt
 * aus `signOutAccount`, siehe hooks/useCloudAuth.ts).
 *
 * ── App beenden ─────────────────────────────────────────────────────────
 * `pagehide` + `beforeunload`, exakt das Paar aus api/mcp/shutdown.ts und
 * aus denselben Gruenden: `pagehide` feuert zuverlaessig beim Verschwinden
 * der Webview in WebKit/WebView2 (Cmd+Q, Tray-Quit und `exit_app` reissen
 * alle die Webview mit), `beforeunload` ist der frueheste der beiden und
 * kostet nichts extra, weil `stopAllBackgroundWork` mehrfach aufzurufen
 * harmlos ist (cancelAll auf einer bereits leeren/abgebrochenen Liste tut
 * nichts). Im Browser-Dev-Build ist das dasselbe Ereignis wie ein
 * Tab-Schliessen. Beide Ausloeser sind der Prozess, der wirklich verschwindet
 * - keine Karenzzeit, es gibt niemanden mehr, der einen Hinweis noch saehe.
 *
 * ── Fenster schliessen ──────────────────────────────────────────────────
 * `app:hidden` IST `onCloseRequested`: lib.rs sendet das Ereignis an GENAU
 * EINER Stelle, im `CloseRequested`-Arm, unmittelbar bevor es das Fenster in
 * den Tray versteckt (`w.hide()`). Ein eigener `onCloseRequested`-Horcher
 * hier waere also derselbe Klick ein zweites Mal beobachtet, nicht ein
 * anderer Moment. Die App lebt im Tray absichtlich weiter (Tray-Menue,
 * schnelles Show), aber nicht fuer unsichtbare bezahlte Rechenzeit: dieselbe
 * lib.rs-Stelle raeumt seit dem 30.08. aus demselben Grund die lokalen
 * Modelle aus dem VRAM, mit derselben Karenzzeit gegen den Fehlklick. Diese
 * Datei zieht mit `scheduleHiddenStop` nach, statt ohne Frist abzubrechen.
 *
 * ── Netzabbruch ─────────────────────────────────────────────────────────
 * `window.addEventListener('offline'/'online', ...)` - stoppt nichts mehr
 * (siehe Kopf der Datei), zeigt nur den Hinweis und nimmt ihn bei
 * Wiederverbindung zurueck.
 *
 * Idempotent wie installMcpShutdown: mehrfacher Aufruf installiert nur einen
 * Satz Horcher.
 */
export function installBackgroundShutdown(): () => void {
  if (installed) return installed
  if (typeof window === 'undefined') return () => {}

  const onGone = () => stopAllBackgroundWork()
  // Not on a phone. There `pagehide` is not the process ending, it is the
  // user switching to another app for a moment, and stopping every chat,
  // agent and /loop for that would make the app unusable. A phone saves on
  // the way out and resumes on the way back instead (lib/mobile-lifecycle.ts).
  const stopOnDeparture = !isMobile()
  if (stopOnDeparture) {
    window.addEventListener('pagehide', onGone)
    window.addEventListener('beforeunload', onGone)
  }

  const onOffline = () => useBackgroundShutdownStore.getState().setNotice({ kind: 'offline' })
  const onOnline = () => {
    const notice = useBackgroundShutdownStore.getState().notice
    if (notice?.kind === 'offline') useBackgroundShutdownStore.getState().dismiss()
  }
  window.addEventListener('offline', onOffline)
  window.addEventListener('online', onOnline)


  installed = () => {
    if (stopOnDeparture) {
      window.removeEventListener('pagehide', onGone)
      window.removeEventListener('beforeunload', onGone)
    }
    window.removeEventListener('offline', onOffline)
    window.removeEventListener('online', onOnline)
    installed = null
  }
  return installed
}

/** Test-only: die Horcher und die Generation sind Modulzustand fuer die
 *  ganze Sitzung, mit Absicht. */
export function __resetBackgroundShutdownForTests(): void {
  installed?.()
}

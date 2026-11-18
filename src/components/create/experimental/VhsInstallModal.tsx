import { useUiText } from "../../../lib/ui-text"
import { Download } from 'lucide-react'
import { useCreateStore } from '../../../stores/createStore'
import { Modal } from '../../ui/Modal'
import { ModalActions, ModalButton } from '../../ui/ModalActions'

/**
 * Bug A (v2.4.5) + #72 (bob): one-click install of VHS_VideoCombine so video
 * generation produces actual .mp4 files instead of animated .webp fallbacks.
 * Pops when useCreate detects webpOnly capability and sets vhsInstallPrompt
 * in the store; resolves with the user's choice and useCreate continues /
 * cancels.
 */
export function VhsInstallModal() {
  const uiText = useUiText()

  const vhsInstallPrompt = useCreateStore((s) => s.vhsInstallPrompt)
  const open = vhsInstallPrompt !== null

  const choose = (choice: 'install' | 'webp' | 'cancel') => {
    if (vhsInstallPrompt) vhsInstallPrompt(choice)
  }

  return (
    <Modal open={open} onClose={() => choose('cancel')} title={uiText("Install MP4 support?")}>
      <div className="space-y-4 text-sm text-gray-200">
        {/* Der Grund stand frueher in einem gelben Kasten mit Rahmen, Fuellung
            und Warnsymbol, mitten im Dialog, der ihn ohnehin schon stellt. Der
            Rahmen war der Dialog, die Fuellung hat nichts getragen, und das
            Gelb hat aus einer Feststellung eine Stoerung gemacht. Jetzt zwei
            Zeilen Text: die Feststellung und ihre Folge. Die Regel dazu steht
            in lib/hinweis.ts. */}
        <div className="space-y-1.5">
          <p className="font-medium text-[13px]">{uiText("Your ComfyUI doesn't have ")}<code className="px-1 py-0.5 rounded bg-black/40 font-mono text-[11px]">{uiText("VHS_VideoCombine")}</code>
          </p>
          <p className="text-[11px] text-gray-400 leading-relaxed">{uiText("Without it, video generation falls back to ")}<code className="font-mono text-[10px] bg-black/40 px-1 rounded">{uiText("SaveAnimatedWEBP")}</code>{uiText(" and produces an animated ")}<code className="font-mono text-[10px] bg-black/40 px-1 rounded">{uiText(".webp")}</code>{uiText(" file instead of a real ")}<code className="font-mono text-[10px] bg-black/40 px-1 rounded">{uiText(".mp4")}</code>{uiText(" video.")}</p>
        </div>

        <div className="text-[11px] text-gray-400 leading-relaxed">{uiText("The installer runs ")}<code className="font-mono bg-white/5 px-1 rounded">{uiText("git clone")}</code>{uiText(" on")}{' '}
          <a
            href="https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite"
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 hover:text-blue-300 underline"
          >{uiText("Kosinkadink/ComfyUI-VideoHelperSuite")}</a>
          {' '}{uiText("(~5 MB) into your ")}<code className="font-mono bg-white/5 px-1 rounded">{uiText("ComfyUI/custom_nodes/")}</code>{uiText(" folder, runs ")}<code className="font-mono bg-white/5 px-1 rounded">{uiText("pip install")}</code>{uiText(" for its requirements, and restarts ComfyUI. This can take a few minutes.")}</div>

        <ModalActions stack>
          <ModalButton variant="primary" onClick={() => choose('install')}>
            <Download size={14} />{uiText("Install VHS_VideoCombine + continue")}</ModalButton>
          <ModalButton onClick={() => choose('webp')}>{uiText("Continue anyway with animated .webp")}</ModalButton>
          <ModalButton variant="quiet" onClick={() => choose('cancel')}>{uiText("Cancel generation")}</ModalButton>
        </ModalActions>
      </div>
    </Modal>
  )
}

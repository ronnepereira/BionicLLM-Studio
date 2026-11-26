import { Modal } from '../ui/Modal'

interface Props {
  version: string | null
  onClose: () => void
  onInstall: () => void
}

export function ConfirmAppUpdate({ version, onClose, onInstall }: Props) {
  return (
    <Modal open={!!version} onClose={onClose} title="Instalar atualização" maxWidth="max-w-sm">
      <p className="text-sm">O BionicLLM Studio será fechado para instalar a versão {version} e depois será reiniciado.</p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" data-autofocus className="lu-control" onClick={onClose}>Agora não</button>
        <button type="button" className="lu-control lu-primary" onClick={onInstall}>Confirmar instalação</button>
      </div>
    </Modal>
  )
}

//! Registro do BionicLLM Studio como agente para outros programas.
//!
//! Registra o protocolo URL `bionicllm://` no Windows para que aplicações
//! externas possam abrir o app e enviar comandos, mesmo quando ele não está
//! em execução. O registro grava em HKEY_CURRENT_USER\Software\Classes\bionicllm\,
//! permitindo chamadas do tipo:
//!   bionicllm://chat?mensagem=ol%C3%A1
//!   bionicllm://agent?acao=resumir&texto=...

use winreg::enums::*;
use winreg::RegKey;

const PROTOCOL_SCHEME: &str = "bionicllm";

/// Registra o protocolo `bionicllm://` no registro do Windows (HKCU).
/// Isso permite que outros programas chamem o app via `bionicllm://comando?param=valor`.
#[tauri::command]
pub fn register_agent_protocol() -> Result<String, String> {
    if cfg!(target_os = "windows") {
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Não foi possível obter caminho do exe: {}", e))?;
        let exe_str = exe_path.to_string_lossy().replace('/', "\\");

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let classes = hkcu
            .open_subkey_with_flags("Software\\Classes", KEY_READ | KEY_WRITE)
            .map_err(|e| e.to_string())?;

        // Software\Classes\bionicllm\(Default) = URL:bionicllm Protocol
        let (proto_key, _) = classes
            .create_subkey(PROTOCOL_SCHEME)
            .map_err(|e| e.to_string())?;
        proto_key
            .set_value("", &format!("URL:{} Protocol", PROTOCOL_SCHEME))
            .map_err(|e| e.to_string())?;

        // Software\Classes\bionicllm\URL Protocol = ""
        proto_key
            .set_value("URL Protocol", &"")
            .map_err(|e| e.to_string())?;

        // Software\Classes\bionicllm\DefaultIcon\(Default) = exe_path
        let (icon_key, _) = proto_key
            .create_subkey("DefaultIcon")
            .map_err(|e| e.to_string())?;
        icon_key.set_value("", &exe_str).map_err(|e| e.to_string())?;

        // Software\Classes\bionicllm\shell\open\command\(Default) = "exe_path" "%1"
        let (shell_key, _) = proto_key.create_subkey("shell").map_err(|e| e.to_string())?;
        let (open_key, _) = shell_key.create_subkey("open").map_err(|e| e.to_string())?;
        let (cmd_key, _) = open_key
            .create_subkey("command")
            .map_err(|e| e.to_string())?;
        cmd_key
            .set_value("", &format!("\"{}\" \"%1\"", exe_str))
            .map_err(|e| e.to_string())?;

        Ok(format!("Protocolo {}:// registrado com sucesso no Windows", PROTOCOL_SCHEME))
    } else {
        Err("Registro de protocolo só é suportado no Windows".to_string())
    }
}

/// Recebe um comando de agente externo. Outros programas podem chamar via
/// protocolo bionicllm:// ou diretamente por este comando Tauri.
#[tauri::command]
pub fn agent_receive(action: String, payload: Option<String>) -> Result<String, String> {
    tracing::info!("Chamada de agente externa: action={}", action);

    match action.as_str() {
        "chat" | "agent" => {
            let prompt = payload.unwrap_or_default();
            crate::commands::desktop_runtime::receive_url(&format!("bionicllm://{}?prompt={}", action, urlencoding::encode(&prompt)))
        }
        "identify" => {
            Ok("BionicLLM Studio".to_string())
        }
        "status" => {
            Ok("online".to_string())
        }
        _ => Err(format!("Ação de agente não reconhecida: {}", action)),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_protocol_name() {
        assert_eq!(super::PROTOCOL_SCHEME, "bionicllm");
    }
}

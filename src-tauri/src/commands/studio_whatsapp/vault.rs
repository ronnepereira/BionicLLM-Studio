use base64::Engine;
use std::path::Path;

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.bionicllm.studio.connectors", "whatsapp-session-key")
        .map_err(|_| "Cofre do WhatsApp indisponível.".into())
}
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn key(file: &Path) -> Result<String, String> {
    use rand::RngCore;
    let entry = entry()?;
    match entry.get_password() {
        Ok(value) => {
            if base64::engine::general_purpose::STANDARD
                .decode(&value)
                .is_ok_and(|bytes| bytes.len() == 32)
            {
                Ok(value)
            } else {
                Err("A chave da sessão WhatsApp está inválida. Remova a sessão local antes de vincular novamente.".into())
            }
        }
        Err(keyring::Error::NoEntry) if !file.exists() => {
            let mut bytes = [0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut bytes);
            let value = base64::engine::general_purpose::STANDARD.encode(bytes);
            entry
                .set_password(&value)
                .map_err(|_| "Não foi possível proteger a sessão no cofre.".to_string())?;
            Ok(value)
        }
        Err(keyring::Error::NoEntry) => Err(
            "A chave desta sessão não está no cofre. Remova a sessão local e vincule novamente."
                .into(),
        ),
        Err(_) => Err("Não foi possível acessar a chave do WhatsApp no cofre.".into()),
    }
}
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn remove() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Não foi possível remover a chave do WhatsApp.".into()),
    }
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn key(_: &Path) -> Result<String, String> {
    Err("O cofre do WhatsApp requer Windows ou macOS.".into())
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn remove() -> Result<(), String> {
    Err("O cofre do WhatsApp requer Windows ou macOS.".into())
}

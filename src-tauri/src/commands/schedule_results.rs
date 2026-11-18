//! Agenda TXT output is confined to one app-owned Documents folder.
use std::path::{Path, PathBuf};
use std::io::Write;

fn write_result(directory: &Path, filename: &str, content: &str) -> Result<PathBuf, String> {
    if filename.len() > 160 || !filename.ends_with(".txt") || filename.starts_with('.') || filename.contains("..") || !filename.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b)) {
        return Err("O nome do resultado TXT é inválido.".into());
    }
    let stem = filename.split('.').next().unwrap_or("").to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str()) || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit()) {
        return Err("O nome do resultado TXT é reservado pelo sistema.".into());
    }
    if content.len() > 2_000_000 { return Err("O resultado excede o limite de 2 MB para exportação automática. Use Salvar TXT na Agenda.".into()); }
    std::fs::create_dir_all(directory).map_err(|e| format!("Não foi possível criar a pasta de resultados: {e}"))?;
    for index in 0..100 {
        let name = if index == 0 { filename.to_string() } else { format!("{}-{index}.txt", filename.trim_end_matches(".txt")) };
        let path = directory.join(name);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(content.as_bytes()).and_then(|_| file.sync_all()).map_err(|e| format!("Não foi possível gravar o TXT: {e}"))?;
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                // Retrying delivery never overwrites a file edited by the user.
                if std::fs::read(&path).ok().as_deref() == Some(content.as_bytes()) { return Ok(path); }
            }
            Err(error) => return Err(format!("Não foi possível salvar o TXT: {error}")),
        }
    }
    Err("Há muitos arquivos com esse nome. Use Salvar TXT para escolher outro destino.".into())
}

#[tauri::command]
pub async fn save_schedule_result(filename: String, content: String) -> Result<String, String> {
    #[cfg(desktop)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let folder = dirs::document_dir().ok_or("A pasta Documentos não está disponível. Use Salvar TXT na Agenda.")?.join("BionicLLM Studio").join("Agenda");
            write_result(&folder, &filename, &content).map(|path| path.to_string_lossy().into_owned())
        }).await.map_err(|e| format!("Não foi possível concluir a gravação: {e}"))?
    }
    #[cfg(mobile)]
    { let _ = (filename, content); Err("A exportação automática está disponível no aplicativo desktop. Use Salvar TXT para compartilhar.".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn txt_is_utf8_idempotent_and_never_overwrites_user_edits() {
        let root = crate::os_paths::test_dir("schedule-txt");
        let content = "Conclusão: referências verificadas.\nOlá, ação.";
        let first = write_result(&root, "prova.txt", content).unwrap();
        assert_eq!(std::fs::read_to_string(&first).unwrap(), content);
        assert_eq!(write_result(&root, "prova.txt", content).unwrap(), first);
        std::fs::write(&first, "Edição do usuário").unwrap();
        let second = write_result(&root, "prova.txt", content).unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read_to_string(first).unwrap(), "Edição do usuário");
    }
    #[test]
    fn txt_rejects_paths_and_non_text_extensions() {
        let root = crate::os_paths::test_dir("schedule-txt-invalid");
        for name in ["../a.txt", "a/b.txt", "C:a.txt", "test.exe", ".txt", "a..txt", "CON.txt", "NUL.txt"] {
            assert!(write_result(&root, name, "texto").is_err());
        }
        assert!(write_result(&root, "valid.txt", &"x".repeat(2_000_001)).is_err());
    }
}

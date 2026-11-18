//! Read-only discovery of SKILL.md in known skill libraries. Never runs instructions/scripts.
use std::{collections::HashSet, io::Read, path::PathBuf, sync::Mutex};
use serde::Serialize;
use tauri::WebviewWindow;

static DISCOVERED: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
const FILE_LIMIT: u64 = 16_000_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSkill { path: String, name: String, description: String, origin: String, bytes: u64, importable: bool }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillScan { skills: Vec<LocalSkill>, roots: Vec<String>, warnings: Vec<String>, limited: bool }

fn known_roots() -> Vec<(String, PathBuf)> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        for (origin, relative) in [("Agent Skills", ".agents/skills"), ("Codex", ".codex/skills"), ("Plugins do Codex", ".codex/plugins/cache"), ("Claude", ".claude/skills"), ("Cline", ".cline/skills"), ("Cline", "Documents/Cline/Skills"), ("Hermes", ".hermes/skills")] { roots.push((origin.to_string(), home.join(relative))); }
    }
    if let Some(local) = dirs::data_local_dir() { roots.push(("Hermes".into(), local.join("hermes/skills"))); }
    if let Some(config) = dirs::config_dir() { roots.push(("Cline / VS Code".into(), config.join("Code/User/globalStorage/saoudrizwan.claude-dev/skills"))); }
    // Project libraries near the executable are not inferred from arbitrary working directories.
    roots
}
fn header_field(head: &str, key: &str) -> Option<String> {
    let normalized = head.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    if !normalized.starts_with("---\n") { return None; }
    let header = normalized[4..].split("\n---").next()?;
    let prefix = format!("{key}:");
    let lines: Vec<_> = header.lines().collect();
    for (index, line) in lines.iter().enumerate() {
        if let Some(value) = line.strip_prefix(&prefix) {
            let value = value.trim();
            if [">", "|", ">-", "|-"].contains(&value) {
                return Some(lines[index + 1..].iter().take_while(|line| line.starts_with(' ') || line.starts_with('\t')).map(|line| line.trim()).collect::<Vec<_>>().join(" ").chars().take(1200).collect());
            }
            return Some(value.trim_matches(['\'', '"']).chars().take(1200).collect());
        }
    }
    None
}
fn scan(roots: Vec<(String, PathBuf)>) -> Result<SkillScan, String> {
    let mut result = SkillScan { skills: Vec::new(), roots: Vec::new(), warnings: Vec::new(), limited: false };
    let mut paths = HashSet::new();
    let mut visited = 0;
    for (origin, root) in roots {
        if !root.is_dir() { continue; }
        let root = root.canonicalize().map_err(|_| "Não foi possível acessar a pasta de habilidades.")?;
        let shown = root.to_string_lossy().to_string();
        if result.roots.contains(&shown) { continue; }
        result.roots.push(shown);
        let walk = walkdir::WalkDir::new(&root).follow_links(false).max_depth(9).into_iter().filter_entry(|entry| !matches!(entry.file_name().to_str(), Some("node_modules" | ".git" | "target" | ".venv" | "__pycache__")));
        for entry in walk {
            visited += 1;
            if visited > 20_000 || result.skills.len() >= 500 { result.limited = true; break; }
            let entry = match entry { Ok(entry) => entry, Err(_) => { if result.warnings.len() < 20 { result.warnings.push(format!("Alguns arquivos em {origin} não puderam ser lidos.")); } continue; } };
            if !entry.file_type().is_file() || !entry.file_name().to_string_lossy().eq_ignore_ascii_case("SKILL.md") { continue; }
            let path = match entry.path().canonicalize() { Ok(path) if path.starts_with(&root) => path, _ => continue };
            if !paths.insert(path.clone()) { continue; }
            let bytes = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(u64::MAX);
            let mut bytes_head = Vec::new();
            if let Ok(file) = std::fs::File::open(&path) { let _ = file.take(8192).read_to_end(&mut bytes_head); }
            let head = String::from_utf8_lossy(&bytes_head);
            let fallback = path.parent().and_then(|parent| parent.file_name()).map(|name| name.to_string_lossy().to_string()).unwrap_or_else(|| "Habilidade".into());
            let name = header_field(&head, "name").filter(|name| !name.is_empty()).unwrap_or(fallback).chars().take(80).collect();
            result.skills.push(LocalSkill { path: path.to_string_lossy().into(), name, description: header_field(&head, "description").unwrap_or_default(), origin: origin.clone(), bytes, importable: bytes <= FILE_LIMIT });
        }
        if result.limited { break; }
    }
    result.warnings.sort(); result.warnings.dedup();
    result.skills.sort_by_key(|skill| skill.name.to_lowercase());
    *DISCOVERED.lock().map_err(|_| "Não foi possível registrar as habilidades encontradas.")? = Some(paths);
    Ok(result)
}
#[tauri::command]
pub async fn studio_skills_scan(window: WebviewWindow, choose_folder: bool) -> Result<SkillScan, String> {
    if window.label() != "main" { return Err("A descoberta de habilidades pertence à interface principal.".into()); }
    let mut roots = known_roots();
    if choose_folder {
        let selected = rfd::AsyncFileDialog::new().set_title("Selecionar pasta de habilidades").pick_folder().await;
        if let Some(folder) = selected { roots.push(("Pasta selecionada".into(), folder.path().to_path_buf())); }
        else { return Err("Seleção de pasta cancelada.".into()); }
    }
    tauri::async_runtime::spawn_blocking(move || scan(roots)).await.map_err(|_| "A busca de habilidades foi interrompida.")?
}
fn read_discovered(path: &str) -> Result<String, String> {
    let path = PathBuf::from(path).canonicalize().map_err(|_| "Esta habilidade não está mais disponível. Atualize a busca.")?;
    if !DISCOVERED.lock().map_err(|_| "A lista de habilidades não está disponível.")?.as_ref().is_some_and(|paths| paths.contains(&path)) { return Err("Este arquivo não foi encontrado na busca atual. Atualize a busca antes de importar.".into()); }
    let file = std::fs::File::open(&path).map_err(|_| "Não foi possível abrir esta habilidade.")?;
    if file.metadata().map_err(|_| "Não foi possível verificar o arquivo.")?.len() > FILE_LIMIT { return Err("A habilidade excede o limite de importação de 16 MB. O arquivo original foi preservado.".into()); }
    let mut body = String::new();
    file.take(FILE_LIMIT + 1).read_to_string(&mut body).map_err(|_| "A habilidade precisa ser um arquivo Markdown em UTF-8.")?;
    if body.len() as u64 > FILE_LIMIT { return Err("A habilidade excede o limite de importação de 16 MB.".into()); }
    Ok(body)
}
#[tauri::command]
pub async fn studio_skill_read(window: WebviewWindow, path: String) -> Result<String, String> {
    if window.label() != "main" { return Err("A importação de habilidades pertence à interface principal.".into()); }
    tauri::async_runtime::spawn_blocking(move || read_discovered(&path)).await.map_err(|_| "A leitura da habilidade foi interrompida.")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_is_read_only_bounded_and_import_requires_a_discovered_file() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("research"); std::fs::create_dir(&folder).unwrap();
        let path = folder.join("SKILL.md");
        let markdown = "---\nname: research\ndescription: >\n  Pesquisa com fontes.\n  Confira as referências.\n---\n# Instruções\nUse as fontes.";
        std::fs::write(&path, markdown).unwrap();
        std::fs::create_dir_all(root.path().join("node_modules/dependency")).unwrap();
        std::fs::write(root.path().join("node_modules/dependency/SKILL.md"), "Ignore").unwrap();
        let found = scan(vec![("Teste".into(), root.path().to_path_buf())]).unwrap();
        assert_eq!(found.skills.len(), 1);
        assert_eq!(found.skills[0].description, "Pesquisa com fontes. Confira as referências.");
        assert_eq!(read_discovered(&found.skills[0].path).unwrap(), markdown);
        assert!(read_discovered(&root.path().join("unknown/SKILL.md").to_string_lossy()).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), markdown);
        let large = "Habilidade preservada.\n".repeat(10_000);
        std::fs::write(&path, &large).unwrap();
        assert_eq!(read_discovered(&found.skills[0].path).unwrap(), large);
    }
}

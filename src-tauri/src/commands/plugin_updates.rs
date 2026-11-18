//! Versioned official npm distributions for MCP plugins. Activation is separate
//! from staging so the frontend can complete a real MCP handshake first.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub package: String,
    pub version: String,
    pub integrity: String,
    pub tarball: String,
    pub source: String,
    pub node_range: String,
    #[serde(default)]
    pub runner: String,
}
pub fn directory(id: &str) -> Result<PathBuf, String> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("ID de plugin inválido".into());
    }
    Ok(crate::os_paths::data_dir().join("plugins").join(id))
}
pub fn active(id: &str) -> Option<Manifest> {
    serde_json::from_slice(&std::fs::read(directory(id).ok()?.join("active.json")).ok()?).ok()
}
pub fn verified(m: &Manifest) -> bool {
    use sha2::{Digest, Sha256};
    std::fs::read(&m.tarball).is_ok_and(|b| {
        super::plugin_rea::integrity_of(&b) == m.integrity
            || format!("sha256-{:x}", Sha256::digest(&b)) == m.integrity
    })
}
fn store(path: &Path, m: &Manifest) -> Result<(), String> {
    use std::io::Write;
    let tmp = path.with_extension("tmp");
    let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(&serde_json::to_vec_pretty(m).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    drop(f);
    std::fs::rename(tmp, path).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn plugin_source_stage(
    id: String,
    package: String,
    source_kind: Option<String>,
) -> Result<Manifest, String> {
    if source_kind.as_deref() == Some("pypi") {
        return stage_pypi(id, package).await;
    }
    if package.is_empty()
        || package.len() > 214
        || !package
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "@/._-".contains(c))
        || package.contains("..")
    {
        return Err("Informe um pacote npm oficial válido".into());
    }
    if id == "rea" && package != "rea-agents" {
        return Err("A fonte do REA é rea-agents".into());
    }
    let dir = directory(&id)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let metadata = client
        .get(format!(
            "https://registry.npmjs.org/{}/latest",
            urlencoding::encode(&package)
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    if metadata.content_length().is_some_and(|n| n > 2_000_000) {
        return Err("Metadados grandes demais".into());
    }
    let body: serde_json::Value = metadata.json().await.map_err(|e| e.to_string())?;
    let version = body["version"].as_str().ok_or("Versão ausente")?;
    if version.len() > 100
        || !version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c))
    {
        return Err("Versão inválida".into());
    }
    let url = body["dist"]["tarball"]
        .as_str()
        .ok_or("Pacote sem distribuição")?;
    let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("registry.npmjs.org") {
        return Err("A distribuição precisa vir do registro npm oficial".into());
    }
    let integrity = body["dist"]["integrity"]
        .as_str()
        .filter(|v| v.starts_with("sha512-"))
        .ok_or("Distribuição sem SHA-512")?;
    let target = dir.join("versions").join(version);
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    let m = Manifest {
        id: id.clone(),
        package: package.clone(),
        version: version.into(),
        integrity: integrity.into(),
        tarball: target.join("package.tgz").to_string_lossy().into_owned(),
        source: body["repository"]["url"]
            .as_str()
            .unwrap_or("https://registry.npmjs.org")
            .into(),
        node_range: body["engines"]["node"]
            .as_str()
            .unwrap_or("not declared")
            .into(),
        runner: "npx".into(),
    };
    if !verified(&m) {
        let mut response = client
            .get(url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > 64 * 1024 * 1024 {
                return Err("O pacote excede 64 MB".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if super::plugin_rea::integrity_of(&bytes) != m.integrity {
            return Err("Integridade SHA-512 inválida; a versão atual foi preservada".into());
        }
        let tmp = target.join("package.part");
        std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(tmp, &m.tarball).map_err(|e| e.to_string())?;
    }
    store(&dir.join("candidate.json"), &m)?;
    Ok(m)
}

async fn stage_pypi(id: String, package: String) -> Result<Manifest, String> {
    use sha2::{Digest, Sha256};
    if id == "rea"
        || package.is_empty()
        || package.len() > 214
        || !package
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
    {
        return Err("Pacote PyPI inválido".into());
    }
    let dir = directory(&id)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let body: serde_json::Value = client
        .get(format!("https://pypi.org/pypi/{package}/json"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let version = body["info"]["version"].as_str().ok_or("Versão ausente")?;
    if version.len() > 100
        || !version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c))
    {
        return Err("Versão inválida".into());
    }
    let files = body["urls"].as_array().ok_or("Distribuição ausente")?;
    let file = files
        .iter()
        .find(|f| {
            f["filename"]
                .as_str()
                .is_some_and(|n| n.ends_with("none-any.whl"))
        })
        .or_else(|| files.iter().find(|f| f["packagetype"] == "sdist"))
        .ok_or("O pacote não oferece uma distribuição Python compatível")?;
    let name = file["filename"].as_str().ok_or("Nome de arquivo ausente")?;
    if name.contains(['/', '\\']) {
        return Err("Nome de arquivo inválido".into());
    }
    let url =
        url::Url::parse(file["url"].as_str().ok_or("URL ausente")?).map_err(|e| e.to_string())?;
    if url.scheme() != "https" || url.host_str() != Some("files.pythonhosted.org") {
        return Err("Fonte PyPI inválida".into());
    }
    let hash = file["digests"]["sha256"]
        .as_str()
        .ok_or("SHA-256 ausente")?;
    let target = dir.join("versions").join(version);
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    let m = Manifest {
        id: id.clone(),
        package: package.clone(),
        version: version.into(),
        integrity: format!("sha256-{hash}"),
        tarball: target.join(name).to_string_lossy().into_owned(),
        source: format!("https://pypi.org/project/{package}/"),
        node_range: String::new(),
        runner: "uvx".into(),
    };
    if !verified(&m) {
        let mut response = client
            .get(url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > 64 * 1024 * 1024 {
                return Err("Pacote maior que 64 MB".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if format!("{:x}", Sha256::digest(&bytes)) != hash {
            return Err("Integridade SHA-256 inválida".into());
        }
        let tmp = target.join("package.part");
        std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(tmp, &m.tarball).map_err(|e| e.to_string())?;
    }
    store(&dir.join("candidate.json"), &m)?;
    Ok(m)
}
#[tauri::command]
pub fn plugin_source_activate(id: String, rollback: bool) -> Result<(), String> {
    let dir = directory(&id)?;
    if rollback && !dir.join("previous.json").exists() {
        if dir.join("active.json").exists() {
            std::fs::remove_file(dir.join("active.json")).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let file = dir.join(if rollback {
        "previous.json"
    } else {
        "candidate.json"
    });
    let m: Manifest = serde_json::from_slice(&std::fs::read(file).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if m.id != id || !verified(&m) {
        return Err("Pacote inválido".into());
    }
    if !rollback {
        if let Some(old) = active(&id) {
            store(&dir.join("previous.json"), &old)?;
        } else if dir.join("previous.json").exists() {
            std::fs::remove_file(dir.join("previous.json")).map_err(|e| e.to_string())?;
        }
    }
    store(&dir.join("active.json"), &m)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn packages_are_rechecked_before_activation() {
        use sha2::{Digest,Sha256};
        let dir=tempfile::tempdir().unwrap();let file=dir.path().join("package.tgz");
        std::fs::write(&file,b"official package").unwrap();
        let mut m=Manifest{id:"test".into(),package:"test".into(),version:"1.0.0".into(),integrity:super::super::plugin_rea::integrity_of(b"official package"),tarball:file.to_string_lossy().into_owned(),source:"https://registry.npmjs.org".into(),node_range:String::new(),runner:"npx".into()};
        assert!(verified(&m));
        m.integrity=format!("sha256-{:x}",Sha256::digest(b"official package"));assert!(verified(&m));
        std::fs::write(&file,b"changed package").unwrap();assert!(!verified(&m));
    }
    #[test]
    fn plugin_ids_cannot_escape_their_directory() {
        assert!(directory("../other").is_err());assert!(directory("C:\\other").is_err());
        assert!(directory("my-plugin_1").is_ok());
    }
}

//! Official Windows release packages. Keep each runtime separate until validated.
use super::engine_updates::{self, EngineManifest};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    path::Path,
};
const API: &str = "https://api.github.com/repos/ggml-org/llama.cpp";

#[derive(Clone, Deserialize, Serialize)]
pub struct PackageAsset {
    name: String,
    size: u64,
    digest: String,
    browser_download_url: String,
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    assets: Vec<serde_json::Value>,
}
#[derive(Serialize)]
pub struct PackageOption {
    backend: String,
    label: String,
    bytes: u64,
    assets: Vec<PackageAsset>,
}
#[derive(Serialize)]
pub struct PackageCatalog {
    pub tag: String,
    options: Vec<PackageOption>,
}
fn valid_tag(tag: &str) -> bool {
    tag.starts_with('b')
        && (2..=12).contains(&tag.len())
        && tag[1..].bytes().all(|c| c.is_ascii_digit())
}
fn platform() -> Result<&'static str, String> {
    if !cfg!(windows) {
        return Err("Os pacotes prontos estão disponíveis nesta tela para Windows.".into());
    }
    match std::env::consts::ARCH {
        "x86_64" => Ok("x64"),
        "aarch64" => Ok("arm64"),
        _ => Err("Arquitetura sem pacote oficial compatível".into()),
    }
}
fn asset(release: &Release, name: &str) -> Option<PackageAsset> {
    release.assets.iter().find_map(|value| {
        let a: PackageAsset = serde_json::from_value(value.clone()).ok()?;
        let hash = a.digest.strip_prefix("sha256:")?;
        let expected = format!(
            "https://github.com/ggml-org/llama.cpp/releases/download/{}/{name}",
            release.tag_name
        );
        (a.name == name
            && a.browser_download_url == expected
            && hash.len() == 64
            && hash.bytes().all(|b| b.is_ascii_hexdigit()))
        .then_some(a)
    })
}
fn options(release: &Release, arch: &str) -> Vec<PackageOption> {
    if !valid_tag(&release.tag_name) || release.draft {
        return vec![];
    }
    let prefix = format!("llama-{}-bin-win-", release.tag_name);
    let suffix = format!("-{arch}.zip");
    let mut result = Vec::new();
    for value in &release.assets {
        let Some(name) = value["name"].as_str() else {
            continue;
        };
        let Some(backend) = name
            .strip_prefix(&prefix)
            .and_then(|n| n.strip_suffix(&suffix))
        else {
            continue;
        };
        if !["cpu", "vulkan"].contains(&backend)
            && !backend.strip_prefix("cuda-").is_some_and(|v| {
                !v.is_empty() && v.bytes().all(|c| c.is_ascii_digit() || c == b'.')
            })
        {
            continue;
        }
        let Some(main) = asset(release, name) else {
            continue;
        };
        let mut assets = vec![main];
        if backend.starts_with("cuda-") {
            // The CUDA redistributables are a separate asset of the SAME release.
            let Some(runtime) = asset(
                release,
                &format!("cudart-llama-bin-win-{backend}-{arch}.zip"),
            ) else {
                continue;
            };
            assets.push(runtime);
        }
        result.push(PackageOption {
            backend: backend.into(),
            label: backend.to_uppercase().replace('-', " "),
            bytes: assets.iter().map(|a| a.size).sum(),
            assets,
        });
    }
    result.sort_by(|a, b| a.backend.cmp(&b.backend));
    result
}
async fn get<T: serde::de::DeserializeOwned>(path: &str) -> Result<T, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?
        .get(format!("{API}/{path}"))
        .header("User-Agent", "BionicLLM-Studio")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn engine_package_catalog(tag: Option<String>) -> Result<PackageCatalog, String> {
    let arch = platform()?;
    if let Some(tag) = tag {
        if !valid_tag(&tag) {
            return Err("Informe uma tag oficial como b9949".into());
        }
        let release: Release = get(&format!("releases/tags/{tag}")).await?;
        let available = options(&release, arch);
        if available.is_empty() {
            return Err("Esta versão ainda não possui pacotes completos com SHA-256 oficial para este computador.".into());
        }
        return Ok(PackageCatalog {
            tag: release.tag_name,
            options: available,
        });
    }
    // /latest can be a stable announcement containing only nightly-tag.txt.
    // Pick the newest complete binary release, ignoring those announcements.
    let mut releases: Vec<Release> = get("releases?per_page=30").await?;
    releases.sort_by_key(|r| {
        std::cmp::Reverse(
            r.tag_name
                .strip_prefix('b')
                .and_then(|n| n.parse::<u64>().ok())
                .unwrap_or(0),
        )
    });
    for release in releases {
        let available = options(&release, arch);
        if !available.is_empty() {
            return Ok(PackageCatalog {
                tag: release.tag_name,
                options: available,
            });
        }
    }
    Err("Nenhum pacote oficial compatível foi encontrado. Tente novamente após a publicação dos binários.".into())
}
fn download(a: &PackageAsset, path: &Path) -> Result<(), String> {
    if a.size > 2_000_000_000 {
        return Err("Pacote excede o tamanho permitido".into());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(&a.browser_download_url)
        .header("User-Agent", "BionicLLM-Studio")
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 65536];
    loop {
        let n = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > a.size {
            return Err("O pacote excede o tamanho publicado".into());
        }
        hash.update(&buffer[..n]);
        file.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
    }
    file.sync_all().map_err(|e| e.to_string())?;
    if total != a.size || format!("sha256:{:x}", hash.finalize()) != a.digest.to_ascii_lowercase() {
        return Err(
            "SHA-256 do pacote difere da publicação oficial. A versão atual foi preservada.".into(),
        );
    }
    Ok(())
}
fn extract_runtime(archive: &Path, runtime: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(archive).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let safe = entry
            .enclosed_name()
            .ok_or("Caminho inválido dentro do ZIP")?;
        if entry.is_dir() {
            continue;
        }
        if entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err("Links não são permitidos no pacote".into());
        }
        let name = safe
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Nome inválido no ZIP")?
            .to_string();
        // Preserve the complete DLL set and only the server executable. Other tools/UI are not needed.
        if name != "llama-server.exe" && !name.to_ascii_lowercase().ends_with(".dll") {
            continue;
        }
        total += entry.size();
        if total > 4_000_000_000 || entry.size() > 2_000_000_000 {
            return Err("ZIP excede o tamanho permitido".into());
        }
        let dest = runtime.join(if name == "llama-server.exe" {
            "bu-llama-server.exe"
        } else {
            &name
        });
        if dest.exists() {
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            if std::fs::read(&dest).map_err(|e| e.to_string())? != bytes {
                return Err(format!("Bibliotecas conflitantes no pacote: {name}"));
            }
        } else {
            let mut out = std::fs::File::create(dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn engine_package_download(
    tag: String,
    backend: String,
) -> Result<EngineManifest, String> {
    let _guard = engine_updates::UPDATE
        .try_lock()
        .map_err(|_| "Já existe uma atualização do motor em andamento")?;
    let catalog = engine_package_catalog(Some(tag.clone())).await?;
    let selected = catalog
        .options
        .into_iter()
        .find(|o| o.backend == backend)
        .ok_or("Pacote indisponível para esta versão/arquitetura")?;
    let commit: serde_json::Value = get(&format!("commits/{tag}")).await?;
    let commit = commit["sha"]
        .as_str()
        .filter(|s| s.len() == 40 && s.bytes().all(|c| c.is_ascii_hexdigit()))
        .ok_or("Não foi possível confirmar a revisão oficial")?
        .to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let staging = engine_updates::root()
            .join(format!("{tag}-{backend}-{}", uuid::Uuid::new_v4().simple()));
        let runtime = staging.join("runtime");
        std::fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
        for a in &selected.assets {
            let zip = staging.join(&a.name);
            download(a, &zip)?;
            extract_runtime(&zip, &runtime)?;
            std::fs::remove_file(zip).map_err(|e| e.to_string())?;
        }
        if !runtime.join("bu-llama-server.exe").is_file() || !runtime.join("llama.dll").is_file() {
            return Err("O pacote não contém o servidor e suas bibliotecas".into());
        }
        engine_updates::check_runtime(&runtime, &staging.join("validation.log"))?;
        let mut hashes = BTreeMap::new();
        for e in std::fs::read_dir(&runtime).map_err(|e| e.to_string())? {
            let e = e.map_err(|e| e.to_string())?;
            hashes.insert(
                e.file_name().to_string_lossy().into_owned(),
                format!(
                    "{:x}",
                    Sha256::digest(std::fs::read(e.path()).map_err(|e| e.to_string())?)
                ),
            );
        }
        let manifest = EngineManifest {
            tag,
            commit,
            backend,
            directory: runtime.to_string_lossy().into_owned(),
            sha256: hashes,
        };
        engine_updates::save("candidate.json", &manifest)?;
        Ok(manifest)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn release(names: &[&str]) -> Release {
        Release { tag_name: "b123".into(), draft: false, 
            assets: names.iter().map(|name| serde_json::json!({"name":name,"size":10,"digest":format!("sha256:{}", "a".repeat(64)),"browser_download_url":format!("https://github.com/ggml-org/llama.cpp/releases/download/b123/{name}")})).collect() }
    }
    #[test]
    fn cuda_requires_matching_runtime_and_architecture() {
        let r = release(&[
            "llama-b123-bin-win-cuda-12.4-x64.zip",
            "cudart-llama-bin-win-cuda-12.4-x64.zip",
            "llama-b123-bin-win-cpu-arm64.zip",
        ]);
        let o = options(&r, "x64");
        assert_eq!(o.len(), 1);
        assert_eq!(o[0].assets.len(), 2);
        assert_eq!(o[0].bytes, 20);
        assert_eq!(options(&r, "arm64")[0].backend, "cpu");
        assert!(options(&release(&["llama-b123-bin-win-cuda-12.4-x64.zip"]), "x64").is_empty());
    }
    #[test]
    fn rejects_unverified_or_unofficial_assets() {
        let mut r = release(&["llama-b123-bin-win-vulkan-x64.zip"]);
        r.assets[0]["digest"] = serde_json::Value::Null;
        assert!(options(&r, "x64").is_empty());
        r.assets[0]["digest"] = format!("sha256:{}", "a".repeat(64)).into();
        r.assets[0]["browser_download_url"] = "https://example.com/fake.zip".into();
        assert!(options(&r, "x64").is_empty());
    }
    #[test]
    fn ignores_announcements_and_incomplete_builds() {
        // llama.cpp publishes its numbered binary builds as official nightlies.
        let mut r = release(&["llama-b123-bin-win-cpu-x64.zip"]);
        assert!(!options(&r, "x64").is_empty());
        r.tag_name = "v1.0.0".into();
        assert!(options(&r, "x64").is_empty());
        assert!(!valid_tag("b"));
        assert!(!valid_tag("../b123"));
        assert!(!valid_tag("b12/3"));
        assert!(valid_tag("b123"));
    }
    fn archive(name: &str, entries: &[(&str, &[u8])]) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("bionic-engine-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("runtime")).unwrap();
        let path = dir.join(name);
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        for (n, b) in entries {
            zip.start_file(*n, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b).unwrap();
        }
        zip.finish().unwrap();
        (path, dir.join("runtime"))
    }
    #[test]
    fn extracts_all_libraries_without_other_executables() {
        let (zip, runtime) = archive(
            "ok.zip",
            &[
                ("bin/llama-server.exe", b"server"),
                ("bin/llama.dll", b"dll"),
                ("bin/ggml-cuda.dll", b"cuda"),
                ("bin/llama-cli.exe", b"cli"),
            ],
        );
        extract_runtime(&zip, &runtime).unwrap();
        assert!(runtime.join("bu-llama-server.exe").exists());
        assert!(runtime.join("ggml-cuda.dll").exists());
        assert!(!runtime.join("llama-cli.exe").exists());
        std::fs::remove_dir_all(zip.parent().unwrap()).unwrap();
    }
    #[test]
    fn rejects_zip_traversal() {
        let (zip, runtime) = archive("bad.zip", &[("../escaped.dll", b"bad")]);
        assert!(extract_runtime(&zip, &runtime).is_err());
        assert!(!zip.parent().unwrap().join("escaped.dll").exists());
        std::fs::remove_dir_all(zip.parent().unwrap()).unwrap();
    }
    #[test]
    fn rejects_conflicting_dlls() {
        let (zip, runtime) = archive(
            "conflict.zip",
            &[("a/llama.dll", b"one"), ("b/llama.dll", b"two")],
        );
        assert!(extract_runtime(&zip, &runtime).is_err());
        std::fs::remove_dir_all(zip.parent().unwrap()).unwrap();
    }
    #[test]
    #[ignore = "Downloads and validates an official package without activating or changing user settings"]
    fn official_package_smoke() {
        let catalog = tauri::async_runtime::block_on(engine_package_catalog(None)).unwrap();
        let backend = std::env::var("BIONIC_ENGINE_SMOKE_BACKEND").unwrap_or("cpu".into());
        let selected = catalog
            .options
            .iter()
            .find(|o| o.backend == backend)
            .unwrap();
        let dir =
            std::env::temp_dir().join(format!("bionic-official-smoke-{}", uuid::Uuid::new_v4()));
        let runtime = dir.join("runtime");
        std::fs::create_dir_all(&runtime).unwrap();
        for a in &selected.assets {
            let zip = dir.join(&a.name);
            download(a, &zip).unwrap();
            extract_runtime(&zip, &runtime).unwrap();
        }
        engine_updates::check_runtime(&runtime, &dir.join("validation.log")).unwrap();
        println!(
            "Official package {} / {}: SHA-256, extraction, --version and /health passed",
            catalog.tag, backend
        );
        if backend.starts_with("cuda-") {
            let mut cmd = std::process::Command::new(runtime.join("bu-llama-server.exe"));
            cmd.current_dir(&runtime).arg("--list-devices");
            crate::process_util::suppress_window(&mut cmd);
            let output = cmd.output().unwrap();
            assert!(output.status.success());
            let devices = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            println!("{devices}");
            assert!(
                devices.contains("CUDA0"),
                "NVIDIA CUDA device was not detected"
            );
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}

//! Build the inference engine from the official source, stage the complete
//! runtime in a version directory, then activate only after native checks.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Command,
};

pub(super) static UPDATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Serialize, Deserialize)]
pub struct EngineManifest {
    pub tag: String,
    pub commit: String,
    pub backend: String,
    pub directory: String,
    pub sha256: BTreeMap<String, String>,
}
pub(super) fn root() -> PathBuf {
    crate::os_paths::data_dir().join("engine-versions")
}
fn read(name: &str) -> Option<EngineManifest> {
    serde_json::from_slice(&std::fs::read(root().join(name)).ok()?).ok()
}
pub(super) fn save(name: &str, m: &EngineManifest) -> Result<(), String> {
    use std::io::Write;
    let target = root().join(name);
    let tmp = target.with_extension("tmp");
    let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(&serde_json::to_vec_pretty(m).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    drop(f);
    std::fs::rename(tmp, target).map_err(|e| e.to_string())
}
fn valid(m: &EngineManifest) -> bool {
    let dir = PathBuf::from(&m.directory);
    if !dir.starts_with(root()) || m.sha256.is_empty() {
        return false;
    }
    m.sha256.iter().all(|(name, hash)| {
        !name.contains(['/', '\\'])
            && std::fs::read(dir.join(name))
                .is_ok_and(|b| format!("{:x}", Sha256::digest(&b)) == *hash)
    })
}
pub fn active_directory() -> Option<PathBuf> {
    read("active.json")
        .filter(valid)
        .map(|m| PathBuf::from(m.directory))
}
#[tauri::command]
pub fn engine_source_status() -> serde_json::Value {
    serde_json::json!({"source":"https://github.com/ggml-org/llama.cpp","active":read("active.json"),"bundledTag":"b9949","bundledCommit":"049326a00025d00b08cc188ed716b681e984a3f8"})
}
#[tauri::command]
pub async fn engine_source_latest() -> Result<String, String> {
    Ok(super::engine_packages::engine_package_catalog(None)
        .await?
        .tag)
}
pub(super) fn run(cmd: &mut Command, log: &Path) -> Result<(), String> {
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
        .map_err(|e| e.to_string())?;
    cmd.stdout(file.try_clone().map_err(|e| e.to_string())?)
        .stderr(file);
    crate::process_util::suppress_window(cmd);
    if cmd
        .status()
        .map_err(|e| format!("Não foi possível executar a ferramenta de build: {e}"))?
        .success()
    {
        Ok(())
    } else {
        Err(format!(
            "A compilação falhou. Consulte {}. A versão atual foi preservada.",
            log.display()
        ))
    }
}
#[tauri::command]
pub async fn engine_source_build(
    app: tauri::AppHandle,
    tag: String,
    backend: String,
) -> Result<EngineManifest, String> {
    let _guard = UPDATE
        .try_lock()
        .map_err(|_| "Já existe uma compilação do motor em andamento")?;
    if !tag.starts_with('b')
        || tag.len() < 2
        || tag.len() > 12
        || !tag[1..].chars().all(|c| c.is_ascii_digit())
    {
        return Err("Informe uma tag oficial como b9949".into());
    }
    if !["cpu", "vulkan", "cuda"].contains(&backend.as_str()) {
        return Err("Backend inválido".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let staging = root().join(format!(
            "{}-{}-{}",
            tag,
            backend,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        let log = staging.join("build.log");
        let src = staging.join("source");
        let build = staging.join("build");
        let artifacts = staging.join("runtime");
        run(
            Command::new("git")
                .args([
                    "clone",
                    "--depth",
                    "1",
                    "--branch",
                    &tag,
                    "https://github.com/ggml-org/llama.cpp.git",
                ])
                .arg(&src),
            &log,
        )?;
        let mut git = Command::new("git");
        git.arg("-C").arg(&src).args(["rev-parse", "HEAD"]);
        crate::process_util::suppress_window(&mut git);
        let commit = String::from_utf8_lossy(&git.output().map_err(|e| e.to_string())?.stdout)
            .trim()
            .to_string();
        if commit.len() != 40 {
            return Err("Não foi possível confirmar a revisão da fonte".into());
        }
        run(
            Command::new("cmake")
                .arg("-S")
                .arg(&src)
                .arg("-B")
                .arg(&build)
                .args([
                    "-DBUILD_SHARED_LIBS=ON",
                    "-DGGML_BACKEND_DL=ON",
                    "-DGGML_CPU_ALL_VARIANTS=ON",
                    "-DGGML_NATIVE=OFF",
                    "-DLLAMA_OPENSSL=OFF",
                    "-DLLAMA_BUILD_UI=OFF",
                    "-DLLAMA_USE_PREBUILT_UI=OFF",
                ])
                .arg(if backend == "vulkan" {
                    "-DGGML_VULKAN=ON"
                } else {
                    "-DGGML_VULKAN=OFF"
                })
                .arg(if backend == "cuda" {
                    "-DGGML_CUDA=ON"
                } else {
                    "-DGGML_CUDA=OFF"
                }),
            &log,
        )?;
        run(
            Command::new("cmake").arg("--build").arg(&build).args([
                "--config",
                "Release",
                "--target",
                "llama-server",
                "-j",
                "4",
            ]),
            &log,
        )?;
        let exe = walkdir::WalkDir::new(&build)
            .into_iter()
            .filter_map(Result::ok)
            .find(|e| {
                e.file_name()
                    == if cfg!(windows) {
                        "llama-server.exe"
                    } else {
                        "llama-server"
                    }
            })
            .ok_or("O build não produziu llama-server")?
            .into_path();
        std::fs::create_dir_all(&artifacts).map_err(|e| e.to_string())?;
        let name = if cfg!(windows) {
            "bu-llama-server.exe"
        } else {
            "bu-llama-server"
        };
        std::fs::copy(&exe, artifacts.join(name)).map_err(|e| e.to_string())?;
        for entry in std::fs::read_dir(exe.parent().ok_or("Diretório de build inválido")?)
            .map_err(|e| e.to_string())?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|e| e == "dll" || e == "so" || e == "dylib")
            {
                std::fs::copy(&path, artifacts.join(entry.file_name()))
                    .map_err(|e| e.to_string())?;
            }
        }
        check_runtime(&artifacts, &log)?;
        let mut hashes = BTreeMap::new();
        for e in std::fs::read_dir(&artifacts).map_err(|e| e.to_string())? {
            let e = e.map_err(|e| e.to_string())?;
            let b = std::fs::read(e.path()).map_err(|e| e.to_string())?;
            hashes.insert(
                e.file_name().to_string_lossy().into_owned(),
                format!("{:x}", Sha256::digest(b)),
            );
        }
        let m = EngineManifest {
            tag,
            commit,
            backend,
            directory: artifacts.to_string_lossy().into_owned(),
            sha256: hashes,
        };
        let _ = app; // Activation is explicit and separate from a successful build.
        save("candidate.json", &m)?;
        Ok(m)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn engine_source_activate(app: tauri::AppHandle, rollback: bool) -> Result<(), String> {
    let _guard = UPDATE
        .try_lock()
        .map_err(|_| "Aguarde a atualização do motor terminar")?;
    // The frontend also checks all run lanes; the backend refuses a hot swap.
    let m = if rollback {
        read("previous.json")
    } else {
        read("candidate.json")
    };
    if !rollback && !m.as_ref().is_some_and(valid) {
        return Err("O candidato não foi validado".into());
    }
    super::engine::stop_bundled_engine(app).await?;
    if let Some(m) = m {
        if !valid(&m) {
            return Err("Arquivos do motor foram alterados".into());
        }
        if !rollback {
            if let Some(old) = read("active.json") {
                save("previous.json", &old)?;
            } else if root().join("previous.json").exists() {
                std::fs::remove_file(root().join("previous.json")).map_err(|e| e.to_string())?;
            }
        }
        save("active.json", &m)?;
    } else if root().join("active.json").exists() {
        std::fs::remove_file(root().join("active.json")).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Shared by source builds and verified release packages.
pub(super) fn check_runtime(artifacts: &Path, log: &Path) -> Result<(), String> {
    let name = if cfg!(windows) {
        "bu-llama-server.exe"
    } else {
        "bu-llama-server"
    };
    run(
        Command::new(artifacts.join(name))
            .current_dir(&artifacts)
            .arg("--version"),
        log,
    )?;
    // Smoke test the actual staged runtime, without loading user weights.
    let socket = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = socket.local_addr().map_err(|e| e.to_string())?.port();
    drop(socket);
    let mut cmd = Command::new(artifacts.join(name));
    cmd.current_dir(&artifacts)
        .args(["--host", "127.0.0.1", "--port", &port.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    crate::process_util::suppress_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(1))
        .build()
        .map_err(|e| e.to_string())?;
    let mut healthy = false;
    for _ in 0..40 {
        if client
            .get(format!("http://127.0.0.1:{port}/health"))
            .send()
            .is_ok_and(|r| r.status().is_success())
        {
            healthy = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    let _ = child.kill();
    let _ = child.wait();
    if !healthy {
        return Err(
            "O novo motor não passou no teste /health; a versão atual foi preservada".into(),
        );
    }
    Ok(())
}

// llama.cpp v1 replaced --no-mmap / --mlock with --load-mode. Detect the
// selected runtime's capability once per directory, preserving bundled flags.
pub(super) fn adapt_active_args(args: Vec<String>) -> Vec<String> {
    let Some(dir) = active_directory() else {
        return args;
    };
    static CAPS: std::sync::OnceLock<std::sync::Mutex<BTreeMap<PathBuf, bool>>> =
        std::sync::OnceLock::new();
    let Ok(mut cache) = CAPS.get_or_init(Default::default).lock() else {
        return args;
    };
    let modern = *cache.entry(dir.clone()).or_insert_with(|| {
        let exe = dir.join(if cfg!(windows) {
            "bu-llama-server.exe"
        } else {
            "bu-llama-server"
        });
        let mut cmd = Command::new(exe);
        cmd.current_dir(dir).arg("--help");
        crate::process_util::suppress_window(&mut cmd);
        cmd.output().is_ok_and(|o| {
            o.status.success()
                && (String::from_utf8_lossy(&o.stdout).contains("--load-mode")
                    || String::from_utf8_lossy(&o.stderr).contains("--load-mode"))
        })
    });
    adapt_load_args(args, modern)
}
fn adapt_load_args(mut args: Vec<String>, modern: bool) -> Vec<String> {
    if !modern {
        return args;
    }
    let no_mmap = args.iter().any(|a| a == "--no-mmap");
    let mlock = args.iter().any(|a| a == "--mlock");
    args.retain(|a| a != "--no-mmap" && a != "--mlock");
    if no_mmap || mlock {
        args.push("--load-mode".into());
        args.push(
            match (no_mmap, mlock) {
                (true, true) => "mlock",
                (false, true) => "mmap+mlock",
                _ => "none",
            }
            .into(),
        );
    }
    args
}
#[cfg(test)]
mod compatibility_tests {
    use super::*;
    #[test]
    fn preserves_old_engine_flags() {
        let args = vec![
            "--no-mmap".into(),
            "--mlock".into(),
            "-m".into(),
            "model.gguf".into(),
        ];
        assert_eq!(adapt_load_args(args.clone(), false), args);
    }
    #[test]
    fn translates_memory_modes_for_modern_engines_without_losing_model_args() {
        for (flags, mode) in [
            (vec!["--no-mmap"], "none"),
            (vec!["--mlock"], "mmap+mlock"),
            (vec!["--no-mmap", "--mlock"], "mlock"),
        ] {
            let mut args = vec!["-m".into(), "model.gguf".into()];
            args.extend(flags.into_iter().map(str::to_string));
            assert_eq!(
                adapt_load_args(args, true),
                vec!["-m", "model.gguf", "--load-mode", mode]
            );
        }
    }
}

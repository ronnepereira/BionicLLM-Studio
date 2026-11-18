use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::io::AsyncReadExt;

pub const VERSION: &str = "7.0.0-rc13";
const PACKAGE: &str = include_str!("../../../resources/whatsapp/package.json");
const LOCK: &str = include_str!("../../../resources/whatsapp/package-lock.json");
pub const BRIDGE: &str = include_str!("../../../resources/whatsapp/bridge.mjs");
const AUTH: &str = include_str!("../../../resources/whatsapp/auth.mjs");
const PROTOCOL: &str = include_str!("../../../resources/whatsapp/protocol.mjs");

pub fn command(node: &Path) -> tokio::process::Command {
    let mut cmd = crate::process_util::foreign_system_command(node);
    crate::process_util::suppress_window(&mut cmd);
    let mut cmd: tokio::process::Command = cmd.into();
    cmd.env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .kill_on_drop(true);
    cmd
}
async fn output(
    node: &Path,
    args: &[&std::ffi::OsStr],
    dir: Option<&Path>,
    seconds: u64,
) -> Result<Vec<u8>, String> {
    let mut cmd = command(node);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(dir) = dir {
        cmd.current_dir(dir);
    }
    let mut child = cmd
        .spawn()
        .map_err(|_| "Não foi possível iniciar o Node.js do WhatsApp.".to_string())?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or("Saída do componente indisponível.")?;
    let work = async {
        let mut bytes = Vec::new();
        (&mut stdout)
            .take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "Falha na leitura do componente.".to_string())?;
        if bytes.len() > 1024 * 1024 {
            return Err("A saída do componente excedeu o limite permitido.".into());
        }
        let status = child
            .wait()
            .await
            .map_err(|_| "Não foi possível concluir a operação do componente.".to_string())?;
        if !status.success() {
            return Err("A operação do componente WhatsApp não foi concluída. Confira o Node.js e a conexão com a internet.".into());
        }
        Ok(bytes)
    };
    tokio::time::timeout(Duration::from_secs(seconds), work)
        .await
        .map_err(|_| "O componente WhatsApp demorou demais para responder.".to_string())?
}
pub async fn node() -> Result<PathBuf, String> {
    let name = Path::new(if cfg!(windows) { "node.exe" } else { "node" });
    let bytes = output(name, &["-p".as_ref(), "JSON.stringify({path:process.execPath,major:Number(process.versions.node.split('.')[0])})".as_ref()], None, 8).await?;
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Não foi possível identificar o Node.js.".to_string())?;
    if value["major"].as_u64().unwrap_or(0) < 22 {
        return Err("O WhatsApp requer Node.js 22 ou mais recente.".into());
    }
    let path = PathBuf::from(
        value["path"]
            .as_str()
            .ok_or("Caminho do Node.js inválido.")?,
    );
    if !path.is_absolute() || !path.is_file() {
        return Err("Instale o Node.js 22 ou mais recente antes de instalar o WhatsApp.".into());
    }
    Ok(path)
}
fn npm(node: &Path) -> Result<PathBuf, String> {
    let root = node.parent().ok_or("Pasta do Node.js inválida.")?;
    let mut candidates = vec![
        root.join("node_modules/npm/bin/npm-cli.js"),
        root.join("../lib/node_modules/npm/bin/npm-cli.js"),
    ];
    if let Some(appdata) = std::env::var_os("APPDATA") {
        candidates.push(PathBuf::from(appdata).join("npm/node_modules/npm/bin/npm-cli.js"));
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or("O npm não foi encontrado. Instale o Node.js com o npm incluído.".into())
}
pub fn matches(dir: &Path) -> bool {
    [
        ("package.json", PACKAGE),
        ("package-lock.json", LOCK),
        ("bridge.mjs", BRIDGE),
        ("auth.mjs", AUTH),
        ("protocol.mjs", PROTOCOL),
    ]
    .iter()
    .all(|(name, expected)| {
        std::fs::read(dir.join(name)).is_ok_and(|bytes| bytes == expected.as_bytes())
    })
}
pub async fn ready(dir: &Path, node: &Path) -> bool {
    if !matches(dir) {
        return false;
    }
    let script = dir.join("bridge.mjs");
    output(
        node,
        &[script.as_os_str(), "--check".as_ref()],
        Some(dir),
        15,
    )
    .await
    .is_ok_and(|bytes| {
        serde_json::from_slice::<Value>(&bytes)
            .is_ok_and(|v| v["ready"] == true && v["version"] == VERSION)
    })
}
pub async fn install(dir: &Path) -> Result<Value, String> {
    let node = node().await?;
    let npm = npm(&node)?;
    std::fs::create_dir_all(dir)
        .map_err(|_| "Não foi possível criar a pasta do componente WhatsApp.".to_string())?;
    for (name, source) in [
        ("package.json", PACKAGE),
        ("package-lock.json", LOCK),
        ("bridge.mjs", BRIDGE),
        ("auth.mjs", AUTH),
        ("protocol.mjs", PROTOCOL),
    ] {
        crate::commands::filesystem::write_atomic(&dir.join(name), source.as_bytes())?;
    }
    output(
        &node,
        &[
            npm.as_os_str(),
            "ci".as_ref(),
            "--ignore-scripts".as_ref(),
            "--no-audit".as_ref(),
            "--no-fund".as_ref(),
            "--omit=dev".as_ref(),
            "--registry=https://registry.npmjs.org".as_ref(),
        ],
        Some(dir),
        240,
    )
    .await?;
    if !ready(dir, &node).await {
        return Err("A instalação do WhatsApp não foi confirmada.".into());
    }
    Ok(json!({"ready":true,"version":VERSION,"node":true}))
}
pub async fn status(dir: &Path) -> Value {
    match node().await {
        Ok(node) => json!({"ready":ready(dir,&node).await,"version":VERSION,"node":true}),
        Err(_) => json!({"ready":false,"version":VERSION,"node":false}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Installs only the locked private runtime; requires Node/npm and network"]
    async fn private_install_loads_the_real_baileys_package_without_pairing() {
        let target = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target");
        std::fs::create_dir_all(&target).unwrap();
        let dir = target.join(format!("whatsapp-install-probe-{}", uuid::Uuid::new_v4()));
        let outcome = install(&dir).await;
        if dir.exists() {
            let canonical = dir.canonicalize().unwrap();
            assert!(canonical.starts_with(target.canonicalize().unwrap()));
            assert!(dir
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("whatsapp-install-probe-"));
            std::fs::remove_dir_all(canonical).unwrap();
        }
        assert_eq!(outcome.unwrap()["ready"], true);
    }
}

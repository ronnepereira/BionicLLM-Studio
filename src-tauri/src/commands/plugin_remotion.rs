//! Local Remotion bridge. No package installation, eval, or shell command strings.
use serde_json::{json, Value};
use std::{path::PathBuf, process::Stdio};
use tauri::WebviewWindow;
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::{Child, ChildStdin, ChildStdout}, sync::Mutex};

struct Bridge { child: Child, input: ChildStdin, output: BufReader<ChildStdout>, root: PathBuf, sequence: u64 }
static BRIDGE: Mutex<Option<Bridge>> = Mutex::const_new(None);

fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" { return Err("Este comando pertence à janela principal.".into()); }
    Ok(())
}
impl Bridge {
    async fn call(&mut self, name: &str, args: Value) -> Result<Value, String> {
        self.sequence += 1;
        let request = format!("{}\n", json!({"id":self.sequence,"name":name,"args":args}));
        self.input.write_all(request.as_bytes()).await.map_err(|e| format!("Remotion desconectado: {e}"))?;
        self.input.flush().await.map_err(|e| e.to_string())?;
        let mut line = String::new();
        let count = tokio::time::timeout(std::time::Duration::from_secs(20), self.output.read_line(&mut line)).await
            .map_err(|_| "Remotion não respondeu em 20 segundos.".to_string())?.map_err(|e| e.to_string())?;
        if count == 0 { return Err("A conexão com o Remotion foi encerrada. Confira Node.js e a pasta do projeto; desligue e ligue o plugin.".into()); }
        if count > 4 * 1024 * 1024 { return Err("Resposta Remotion excede o limite.".into()); }
        let response: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        if response["id"].as_u64() != Some(self.sequence) { return Err("Resposta Remotion fora de sequência. Reconecte o plugin antes de continuar.".into()); }
        if let Some(error) = response.get("error").and_then(Value::as_str) { return Err(error.to_string()); }
        Ok(response["result"].clone())
    }
    async fn stop(&mut self) {
        let _ = self.call("shutdown", json!({})).await;
        if tokio::time::timeout(std::time::Duration::from_secs(3), self.child.wait()).await.is_err() { let _ = self.child.kill().await; }
    }
}

#[tauri::command]
pub async fn plugin_remotion_start(window: WebviewWindow, root: String) -> Result<Value, String> {
    main_window(&window)?;
    let root = std::fs::canonicalize(root.trim()).map_err(|_| "A pasta do projeto Remotion não existe.".to_string())?;
    if !root.join("package.json").is_file() || !root.join("node_modules/@remotion/cli/remotion-cli.js").is_file() {
        return Err("Selecione um projeto Remotion com package.json e a CLI já instalada em node_modules.".into());
    }
    let mut current = BRIDGE.lock().await;
    if let Some(bridge) = current.as_mut() {
        if bridge.root == root && bridge.child.try_wait().map_err(|e| e.to_string())?.is_none() { return bridge.call("remotion_status", json!({})).await; }
        bridge.stop().await;
    }
    *current = None;
    let dir = crate::os_paths::data_dir().join("plugins/remotion");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("bridge.mjs"), include_bytes!("../../resources/remotion/bridge.mjs")).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("guides.json"), include_bytes!("../../resources/remotion/guides.json")).map_err(|e| e.to_string())?;
    let mut command = tokio::process::Command::new("node");
    command.arg(dir.join("bridge.mjs")).arg(&root).current_dir(&root)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(target_os = "macos")]
    command.env("PATH", crate::finder_path::child_path());
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|e| format!("Não foi possível iniciar Node.js para o Remotion: {e}"))?;
    if let Some(pid) = child.id() { super::process::tie_child_to_app_lifetime(pid); }
    let input = child.stdin.take().ok_or("Remotion sem entrada de controle.")?;
    let output = BufReader::new(child.stdout.take().ok_or("Remotion sem saída de controle.")?);
    let mut bridge = Bridge { child, input, output, root, sequence: 0 };
    let status = bridge.call("remotion_status", json!({})).await?;
    *current = Some(bridge);
    Ok(status)
}

#[tauri::command]
pub async fn plugin_remotion_call(window: WebviewWindow, name: String, args: Value) -> Result<Value, String> {
    main_window(&window)?;
    if !name.starts_with("remotion_") { return Err("Operação Remotion inválida.".into()); }
    let mut current = BRIDGE.lock().await;
    current.as_mut().ok_or("Ative o Remotion no menu Plugins.")?.call(&name, args).await
}

#[tauri::command]
pub async fn plugin_remotion_stop(window: WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    if let Some(mut bridge) = BRIDGE.lock().await.take() { bridge.stop().await; }
    Ok(())
}

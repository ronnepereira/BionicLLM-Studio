//! Microsoft EdgeTTS, through the upstream Python library in a Bionic-owned venv.
//! No shell commands, account credentials, model downloads or changes to Piper.
use base64::Engine;
use serde_json::{json, Value};
use std::{collections::HashMap, path::{Path, PathBuf}, process::Stdio, sync::{LazyLock, Mutex}, time::{Duration, Instant}};
use tauri::Manager;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

pub const EDGE_VERSION: &str = "7.3.1";
const WORKER: &str = include_str!("../../resources/edge-tts.py");
const MAX_AUDIO: usize = 10 * 1024 * 1024;
#[derive(Default)]
struct Jobs { active: HashMap<String, CancellationToken>, canceled: HashMap<String, Instant> }
static JOBS: LazyLock<Mutex<Jobs>> = LazyLock::new(|| Mutex::new(Jobs::default()));
struct JobGuard(String);
impl Drop for JobGuard {
    fn drop(&mut self) { if let Ok(mut jobs) = JOBS.lock() { jobs.active.remove(&self.0); } }
}

fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|p| p.join("edge-tts"))
        .map_err(|_| "Não foi possível localizar a pasta do EdgeTTS.".into())
}
pub fn interpreter(dir: &Path) -> PathBuf {
    dir.join(if cfg!(windows) { "Scripts/python.exe" } else { "bin/python" })
}
fn check_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("A voz precisa ser iniciada na janela principal.".into()) }
}

async fn run(python: &Path, args: &[&str], input: &[u8], timeout: Duration, limit: usize, cancel: CancellationToken) -> Result<Vec<u8>, String> {
    let mut command: tokio::process::Command = crate::python::python_command(python).into();
    command.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    let mut child = command.spawn().map_err(|_| "Não foi possível iniciar o componente de voz. Verifique a instalação do Python.".to_string())?;
    let mut stdin = child.stdin.take().ok_or("Entrada do componente de voz indisponível.")?;
    let stdout = child.stdout.take().ok_or("Saída do componente de voz indisponível.")?;
    let operation = async {
        stdin.write_all(input).await.map_err(|_| "Não foi possível enviar o texto ao componente de voz.".to_string())?;
        drop(stdin);
        let mut output = Vec::new();
        stdout.take(limit as u64 + 1).read_to_end(&mut output).await.map_err(|_| "Não foi possível receber o áudio.".to_string())?;
        if output.len() > limit { return Err("A resposta do componente de voz excedeu o limite permitido.".into()); }
        let status = child.wait().await.map_err(|_| "Não foi possível concluir o componente de voz.".to_string())?;
        if !status.success() { return Err("O componente não concluiu a operação. Verifique a instalação e a conexão com a internet.".into()); }
        Ok(output)
    };
    tokio::select! {
        _ = cancel.cancelled() => Err("Leitura cancelada.".into()),
        result = tokio::time::timeout(timeout, operation) => result.map_err(|_| "O serviço de voz demorou demais para responder. Tente novamente.".to_string())?,
    }
}

async fn status_in(dir: &Path) -> Value {
    let python = interpreter(dir);
    let available = if python.is_file() {
        let script = format!("import edge_tts; import importlib.metadata as m; assert m.version('edge-tts') == '{EDGE_VERSION}'");
        run(&python, &["-I", "-c", &script], &[], Duration::from_secs(8), 1024, CancellationToken::new()).await.is_ok()
    } else { false };
    json!({ "available": available, "version": EDGE_VERSION })
}

#[tauri::command]
pub async fn edge_tts_status(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Value, String> {
    check_main(&window)?;
    Ok(status_in(&directory(&app)?).await)
}

#[tauri::command]
pub async fn edge_tts_install(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Value, String> {
    check_main(&window)?;
    static INSTALL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _lock = INSTALL.lock().await;
    let dir = directory(&app)?;
    let before = status_in(&dir).await;
    if before["available"] == true { return Ok(before); }
    let python = tauri::async_runtime::spawn_blocking(crate::python::get_python_bin).await.map_err(|e| e.to_string())?;
    if python.is_empty() { return Err("Instale o Python nas configurações antes de instalar o EdgeTTS.".into()); }
    if !interpreter(&dir).is_file() {
        let target = dir.to_str().ok_or("O caminho do componente de voz é inválido.")?;
        run(Path::new(&python), &["-m", "venv", target], &[], Duration::from_secs(120), 1024 * 1024, CancellationToken::new()).await?;
    }
    let package = format!("edge-tts=={EDGE_VERSION}");
    run(&interpreter(&dir), &["-I", "-m", "pip", "--disable-pip-version-check", "install", "--no-input", "--only-binary=:all:", "--index-url", "https://pypi.org/simple", &package], &[], Duration::from_secs(240), 1024 * 1024, CancellationToken::new()).await
        .map_err(|_| "Não foi possível instalar o EdgeTTS. Verifique o Python e a conexão com a internet e tente novamente.".to_string())?;
    let after = status_in(&dir).await;
    if after["available"] != true { return Err("A instalação do EdgeTTS não foi confirmada. Tente novamente.".into()); }
    Ok(after)
}

fn validate(text: &str, voice: &str, rate: u32, request_id: &str) -> Result<(), String> {
    if text.trim().is_empty() || text.chars().count() > 6000 || text.contains('\0') { return Err("O texto de voz precisa ter entre 1 e 6.000 caracteres.".into()); }
    if !["pt-BR-FranciscaNeural", "pt-BR-AntonioNeural", "pt-BR-ThalitaMultilingualNeural"].contains(&voice) || !(50..=150).contains(&rate) || uuid::Uuid::parse_str(request_id).is_err() {
        return Err("Os parâmetros de voz são inválidos.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn edge_tts_cancel(request_id: String, window: tauri::WebviewWindow) -> Result<(), String> {
    check_main(&window)?;
    if uuid::Uuid::parse_str(&request_id).is_err() { return Err("Identificador de voz inválido.".into()); }
    let mut jobs = JOBS.lock().map_err(|_| "O controle de voz está indisponível.")?;
    if let Some(token) = jobs.active.get(&request_id) { token.cancel(); }
    else {
        jobs.canceled.retain(|_, time| time.elapsed() < Duration::from_secs(60));
        if jobs.canceled.len() >= 64 {
            if let Some(oldest) = jobs.canceled.iter().min_by_key(|(_, time)| *time).map(|(id, _)| id.clone()) { jobs.canceled.remove(&oldest); }
        }
        jobs.canceled.insert(request_id, Instant::now());
    }
    Ok(())
}

#[tauri::command]
pub async fn edge_tts_synthesize(text: String, voice: String, rate: u32, request_id: String, app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Value, String> {
    check_main(&window)?;
    validate(&text, &voice, rate, &request_id)?;
    let cancel = CancellationToken::new();
    {
        let mut jobs = JOBS.lock().map_err(|_| "O controle de voz está indisponível.")?;
        jobs.canceled.retain(|_, time| time.elapsed() < Duration::from_secs(60));
        if jobs.canceled.remove(&request_id).is_some() { return Err("Leitura cancelada.".into()); }
        if jobs.active.len() >= 4 || jobs.active.contains_key(&request_id) { return Err("Já há uma operação de voz em andamento. Aguarde ou pressione Parar.".into()); }
        jobs.active.insert(request_id.clone(), cancel.clone());
    }
    let _guard = JobGuard(request_id);
    let dir = directory(&app)?;
    if !interpreter(&dir).is_file() { return Err("Instale o EdgeTTS em Configurações → Voz antes de usar.".into()); }
    let input = serde_json::to_vec(&json!({ "text": text, "voice": voice, "rate": rate })).map_err(|e| e.to_string())?;
    let bytes = run(&interpreter(&dir), &["-I", "-c", WORKER], &input, Duration::from_secs(90), MAX_AUDIO, cancel).await?;
    if bytes.len() < 32 { return Err("O EdgeTTS não retornou áudio. Verifique a conexão e tente novamente.".into()); }
    Ok(json!({ "audio_base64": base64::engine::general_purpose::STANDARD.encode(bytes), "mime": "audio/mpeg" }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_untrusted_speech_parameters() {
        let id = uuid::Uuid::new_v4().to_string();
        assert!(validate("Olá, Brasil!", "pt-BR-FranciscaNeural", 100, &id).is_ok());
        for (text, voice, rate) in [("", "pt-BR-FranciscaNeural", 100), ("Olá", "../voice", 100), ("Olá", "pt-BR-AntonioNeural", 151)] {
            assert!(validate(text, voice, rate, &id).is_err());
        }
        assert!(validate(&"á".repeat(6001), "pt-BR-AntonioNeural", 100, &id).is_err());
        assert!(validate("Olá", "pt-BR-AntonioNeural", 100, "bad-id").is_err());
    }

    #[tokio::test]
    #[ignore = "Uses the isolated EdgeTTS venv and real Microsoft speech service"]
    async fn real_speech_and_process_cancellation() {
        let python = std::env::var("BIONIC_EDGE_TEST_PYTHON").expect("explicit isolated Python path");
        for voice in ["pt-BR-FranciscaNeural", "pt-BR-AntonioNeural", "pt-BR-ThalitaMultilingualNeural"] {
            let input = serde_json::to_vec(&json!({ "text": "Olá! Esta é uma demonstração da voz em português do Brasil no BionicLLM Studio.", "voice": voice, "rate": 100 })).unwrap();
            let audio = run(Path::new(&python), &["-I", "-c", WORKER], &input, Duration::from_secs(90), MAX_AUDIO, CancellationToken::new()).await.unwrap();
            assert!(audio.len() > 1024);
            println!("{voice}: {} MP3 bytes", audio.len());
        }
        let cancel = CancellationToken::new();
        let stop = cancel.clone();
        tokio::spawn(async move { tokio::time::sleep(Duration::from_millis(150)).await; stop.cancel(); });
        let started = Instant::now();
        let result = run(Path::new(&python), &["-I", "-c", "import time; time.sleep(60)"], &[], Duration::from_secs(90), 1024, cancel).await;
        assert!(result.unwrap_err().contains("cancelada"));
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}

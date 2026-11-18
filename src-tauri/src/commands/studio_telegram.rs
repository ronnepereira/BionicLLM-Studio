//! Telegram Bot API with a Bionic-owned OS vault and an explicit runtime session.
pub mod runtime;
use serde::{Deserialize, Serialize};
use std::time::Duration;

static OPERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const VAULT_SERVICE: &str = "com.bionicllm.studio.connectors";
const VAULT_ACCOUNT: &str = "telegram-bot-token";

fn check_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) }
    else { Err("Configure o Telegram na janela principal.".into()) }
}

fn validate_token(token: &str) -> Result<(), String> {
    let valid = token.split_once(':').is_some_and(|(id, secret)| {
        (1..=20).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit())
            && (30..=128).contains(&secret.len())
            && secret.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    });
    if valid { Ok(()) } else { Err("O token do bot tem formato inválido. Confira o valor fornecido pelo BotFather.".into()) }
}

// A closed account, separate from LU/provider secrets. Never expose its value to JS.
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new(VAULT_SERVICE, VAULT_ACCOUNT)
        .map_err(|_| "Não foi possível acessar o cofre do sistema.".into())
}
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn read_token() -> Result<Option<String>, String> {
    match credential()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Não foi possível ler a credencial no cofre do sistema.".into()),
    }
}
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn write_token(value: Option<String>) -> Result<(), String> {
    let entry = credential()?;
    match value {
        Some(value) => entry.set_password(&value).map_err(|_| "Não foi possível salvar o token no cofre do sistema.".into()),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Não foi possível remover o token do cofre do sistema.".into()),
        },
    }
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn read_token() -> Result<Option<String>, String> { Err("O cofre deste conector requer Windows ou macOS.".into()) }
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn write_token(_: Option<String>) -> Result<(), String> { Err("O cofre deste conector requer Windows ou macOS.".into()) }

#[derive(Deserialize, Serialize, Debug, PartialEq)]
pub struct BotIdentity { id: u64, first_name: String, username: String }

fn identity_from_response(bytes: &[u8]) -> Result<BotIdentity, String> {
    #[derive(Deserialize)]
    struct User { id: u64, is_bot: bool, first_name: String, username: String }
    #[derive(Deserialize)]
    struct Reply { ok: bool, result: Option<User> }
    let reply: Reply = serde_json::from_slice(bytes).map_err(|_| "O Telegram retornou uma resposta inválida.".to_string())?;
    let user = reply.result.filter(|user| reply.ok && user.is_bot && user.id > 0
        && user.first_name.chars().count() <= 128 && user.username.len() <= 64
        && !user.username.is_empty() && user.username.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
        .ok_or("O Telegram não confirmou a identidade do bot.")?;
    Ok(BotIdentity { id: user.id, first_name: user.first_name, username: user.username })
}

async fn get_me(token: &str) -> Result<BotIdentity, String> {
    validate_token(token)?;
    request_identity(&format!("https://api.telegram.org/bot{token}/getMe")).await
}

async fn request_identity(url: &str) -> Result<BotIdentity, String> {
    let bytes = request_bytes(url, &serde_json::json!({}), 64 * 1024, tokio_util::sync::CancellationToken::new()).await?;
    identity_from_response(&bytes)
}

async fn request_bytes(url: &str, body: &serde_json::Value, limit: usize, cancel: tokio_util::sync::CancellationToken) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none()).build()
        .map_err(|_| "Não foi possível preparar a conexão com o Telegram.".to_string())?;
    // The token is part of Telegram's required URL: never return/log reqwest errors or bodies.
    let work = async {
    let mut response = client.post(url).json(body)
        .send().await.map_err(|_| "Não foi possível consultar o Telegram. Verifique a conexão com a internet.".to_string())?;
    if !response.status().is_success() {
        return Err(if [401, 404].contains(&response.status().as_u16()) {
            "O Telegram recusou o token do bot. Confira o token ou gere outro no BotFather."
        } else if response.status().as_u16() == 409 {
            "O bot já usa webhook ou outro receptor. Use um bot exclusivo para o BionicLLM."
        } else { "O Telegram não concluiu a operação. Tente novamente mais tarde." }.into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "A verificação do Telegram foi interrompida.".to_string())? {
        if bytes.len() + chunk.len() > limit { return Err("A resposta do Telegram excedeu o limite permitido.".into()); }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
    };
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("Operação do Telegram interrompida.".into()),
        result = work => result,
    }
}

async fn bot_call(token: &str, method: &str, body: serde_json::Value, cancel: tokio_util::sync::CancellationToken) -> Result<serde_json::Value, String> {
    validate_token(token)?;
    // Private callers select literal methods; no caller-supplied endpoint is exposed by IPC.
    if !["getUpdates", "sendMessage", "getWebhookInfo"].contains(&method) { return Err("Operação do Telegram não permitida.".into()); }
    let bytes = request_bytes(&format!("https://api.telegram.org/bot{token}/{method}"), &body, 256 * 1024, cancel).await?;
    let reply: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "O Telegram retornou uma resposta inválida.".to_string())?;
    if reply["ok"] != true { return Err("O Telegram não confirmou a operação.".into()); }
    reply.get("result").cloned().ok_or("O Telegram não retornou um resultado válido.".into())
}

#[tauri::command]
pub async fn studio_telegram_status(window: tauri::WebviewWindow) -> Result<bool, String> {
    check_main(&window)?;
    let _lock = OPERATION.lock().await;
    tauri::async_runtime::spawn_blocking(|| read_token().map(|token| token.is_some())).await
        .map_err(|_| "Não foi possível verificar a credencial do Telegram.".to_string())?
}

#[tauri::command]
pub async fn studio_telegram_verify(window: tauri::WebviewWindow, token: Option<String>) -> Result<BotIdentity, String> {
    check_main(&window)?;
    let _lock = OPERATION.lock().await;
    // A new token is verified before replacing a working stored credential.
    let replace = token.is_some();
    let value = match token {
        Some(value) => value,
        None => tauri::async_runtime::spawn_blocking(read_token).await
            .map_err(|_| "Não foi possível acessar o cofre.".to_string())??
            .ok_or("Nenhum token do Telegram foi configurado.")?,
    };
    let bot = get_me(&value).await?;
    if replace {
        runtime::stop_current().await;
        tauri::async_runtime::spawn_blocking(move || write_token(Some(value))).await
            .map_err(|_| "Não foi possível salvar a credencial do Telegram.".to_string())??;
    }
    Ok(bot)
}

#[tauri::command]
pub async fn studio_telegram_disconnect(window: tauri::WebviewWindow) -> Result<(), String> {
    check_main(&window)?;
    let _lock = OPERATION.lock().await;
    runtime::stop_current().await;
    // Local deletion only. Does not log out, revoke the bot or touch its webhook.
    tauri::async_runtime::spawn_blocking(|| write_token(None)).await
        .map_err(|_| "Não foi possível remover a credencial do Telegram.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tokens_cannot_change_the_host_path_or_method() {
        assert!(validate_token("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11").is_ok());
        for token in ["", "123:x", "-1:ABC-DEF1234ghIkl-zyx57W2v1u123ew11", "123:abcdefghijklmnopqrstuvwxyz1234/getUpdates", "123:abcdefghijklmnopqrstuvwxyz1234?x=1", "123:abcdefghijklmnopqrstuvwxyz1234\n"] {
            assert!(validate_token(token).is_err());
        }
    }
    #[test]
    fn only_a_successful_bot_identity_is_returned() {
        let valid = br#"{"ok":true,"result":{"id":42,"is_bot":true,"first_name":"Bionic","username":"bionic_bot","token":"never-return"}}"#;
        let bot = identity_from_response(valid).unwrap();
        assert_eq!(bot.id, 42);
        assert!(!serde_json::to_string(&bot).unwrap().contains("never-return"));
        for bytes in [br#"{"ok":false,"description":"secret"}"#.as_slice(), br#"{"ok":true,"result":{"id":42,"is_bot":false,"first_name":"User","username":"user"}}"#] {
            assert!(identity_from_response(bytes).is_err());
        }
    }
    fn fixture(status: &str, body: &str, extra_headers: &str) -> (String, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/botsecret/getMe", listener.local_addr().unwrap());
        let response = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{extra_headers}\r\n{body}", body.len());
        let worker = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut buffer = [0; 4096];
            let count = socket.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..count]).into_owned();
            // Oversize response test may drop its connection before the write ends.
            let _ = socket.write_all(response.as_bytes());
            request
        });
        (url, worker)
    }
    #[tokio::test]
    async fn transport_only_verifies_and_sanitizes_failures() {
        let (url, worker) = fixture("200 OK", r#"{"ok":true,"result":{"id":42,"is_bot":true,"first_name":"Test","username":"test_bot"}}"#, "");
        assert_eq!(request_identity(&url).await.unwrap().username, "test_bot");
        assert!(worker.join().unwrap().starts_with("POST /botsecret/getMe HTTP/1.1"));
        for (status, body, headers) in [
            ("401 Unauthorized", "secret", ""),
            ("302 Found", "secret", "Location: http://127.0.0.1:1/leak\r\n"),
            ("200 OK", "secret", ""),
        ] {
            let (url, worker) = fixture(status, body, headers);
            let error = request_identity(&url).await.unwrap_err();
            assert!(!error.contains("secret"));
            assert!(!error.contains("127.0.0.1"));
            worker.join().unwrap();
        }
        let (url, worker) = fixture("200 OK", &"x".repeat(64 * 1024 + 1), "");
        assert!(request_identity(&url).await.unwrap_err().contains("limite"));
        worker.join().unwrap();
    }
    #[tokio::test]
    async fn canceled_transport_never_starts_a_request() {
        let cancel = tokio_util::sync::CancellationToken::new();
        cancel.cancel();
        let error = request_bytes("http://127.0.0.1:1/botsecret/sendMessage", &serde_json::json!({}), 1024, cancel).await.unwrap_err();
        assert_eq!(error,"Operação do Telegram interrompida.");
    }
}

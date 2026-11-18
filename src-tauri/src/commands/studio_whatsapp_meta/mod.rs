//! Official Meta transport, with a signed loopback webhook and opt-in text replies.
mod api;
mod webhook;
use super::studio_whatsapp::journal::{now, Config, Delivery, Journal};
use api::{Credentials, Identity};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, LazyLock,
    },
    time::Duration,
};
use tauri::Manager;
use tokio::sync::{Mutex, Notify, Semaphore};
use tokio_util::sync::CancellationToken;

pub const WEBHOOK_PATH: &str = "/whatsapp/meta/webhook";
static LIFE: Mutex<()> = Mutex::const_new(());
static CURRENT: LazyLock<Mutex<Option<Arc<Receiver>>>> = LazyLock::new(|| Mutex::new(None));
static EPOCH: AtomicU64 = AtomicU64::new(0);
static POLL: Mutex<()> = Mutex::const_new(());
static SEND: Mutex<()> = Mutex::const_new(());

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub public_url: String,
    pub port: u16,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            public_url: String::new(),
            port: 18782,
        }
    }
}
impl Settings {
    fn validate(&self) -> Result<(), String> {
        if self.public_url.len() > 2048 {
            return Err("A URL pública do webhook excede o limite permitido.".into());
        }
        let url = reqwest::Url::parse(&self.public_url)
            .map_err(|_| "Informe a URL HTTPS pública do webhook da Meta.".to_string())?;
        if self.port < 1024
            || url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != WEBHOOK_PATH
            || url.host_str().is_none_or(|host| {
                host == "localhost"
                    || host.ends_with(".localhost")
                    || host.ends_with(".local")
                    || host
                        .trim_start_matches('[')
                        .trim_end_matches(']')
                        .parse::<std::net::IpAddr>()
                        .is_ok_and(|ip| match ip {
                            std::net::IpAddr::V4(ip) => {
                                ip.is_private()
                                    || ip.is_loopback()
                                    || ip.is_link_local()
                                    || ip.is_unspecified()
                            }
                            std::net::IpAddr::V6(ip) => {
                                ip.is_loopback()
                                    || ip.is_unspecified()
                                    || ip.is_unique_local()
                                    || ip.is_unicast_link_local()
                            }
                        })
            })
        {
            return Err(format!("Use uma URL HTTPS pública terminada em {WEBHOOK_PATH}, sem senha ou parâmetros, e uma porta local entre 1024 e 65535."));
        }
        Ok(())
    }
}
#[derive(Clone, Default, Deserialize, Serialize)]
pub struct Saved {
    #[serde(flatten)]
    pub journal: Journal,
    #[serde(default)]
    pub settings: Settings,
}
impl Saved {
    fn load(path: &Path) -> Result<Self, String> {
        use std::io::Read;
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default())
            }
            Err(_) => return Err("Não foi possível ler a configuração do WhatsApp oficial.".into()),
        };
        let mut bytes = Vec::new();
        file.take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Não foi possível ler o histórico do WhatsApp oficial.".to_string())?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("O histórico do WhatsApp oficial excedeu o limite permitido.".into());
        }
        let mut saved:Self=serde_json::from_slice(&bytes).map_err(|_|"Configuração do WhatsApp oficial inválida. Preserve o arquivo antes de restaurá-lo.".to_string())?;
        saved.journal.validate()?;
        saved.journal.interrupt();
        Ok(saved)
    }
    fn save(&self, path: &Path) -> Result<(), String> {
        self.journal.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|_| {
            "Não foi possível preparar o histórico do WhatsApp oficial.".to_string()
        })?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("O histórico do WhatsApp oficial excedeu o limite permitido.".into());
        }
        std::fs::create_dir_all(
            path.parent()
                .ok_or("Pasta do WhatsApp oficial indisponível.")?,
        )
        .map_err(|_| "Não foi possível criar a pasta do WhatsApp oficial.".to_string())?;
        crate::commands::filesystem::write_atomic(path,&bytes).map_err(|_|"Não foi possível salvar o histórico do WhatsApp oficial. O processamento foi interrompido.".into())
    }
}
struct State {
    saved: Saved,
    inflight: Option<String>,
    verified_at: Option<i64>,
    last_event_at: Option<i64>,
    error: Option<String>,
}
struct Receiver {
    id: String,
    credentials: Credentials,
    identity: Identity,
    own_phone: String,
    since: i64,
    path: PathBuf,
    cancel: CancellationToken,
    state: Mutex<State>,
    notify: Notify,
    slots: Semaphore,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}
#[derive(Serialize)]
pub struct View {
    active: bool,
    saved: Saved,
    local_address: Option<String>,
    verified_at: Option<i64>,
    last_event_at: Option<i64>,
    error: Option<String>,
    identity: Option<Identity>,
}
impl Receiver {
    async fn view(&self) -> View {
        let state = self.state.lock().await;
        View {
            active: !self.cancel.is_cancelled(),
            saved: state.saved.clone(),
            local_address: Some(format!(
                "http://127.0.0.1:{}{WEBHOOK_PATH}",
                state.saved.settings.port
            )),
            verified_at: state.verified_at,
            last_event_at: state.last_event_at,
            error: state.error.clone(),
            identity: Some(self.identity.clone()),
        }
    }
    async fn close(&self) -> Result<(), String> {
        self.cancel.cancel();
        self.notify.notify_one();
        if let Some(mut task) = self.task.lock().await.take() {
            if tokio::time::timeout(Duration::from_secs(3), &mut task)
                .await
                .is_err()
            {
                task.abort();
                let _ = task.await;
            }
        }
        let mut state = self.state.lock().await;
        state.saved.journal.interrupt();
        state.inflight = None;
        state.saved.save(&self.path)
    }
}
fn check(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Configure o WhatsApp oficial na janela principal.".into())
    }
}
fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("connectors/whatsapp-meta/journal.json"))
        .map_err(|_| "Pasta do WhatsApp oficial indisponível.".into())
}
async fn credentials() -> Result<Credentials, String> {
    tauri::async_runtime::spawn_blocking(api::read)
        .await
        .map_err(|_| "Cofre da Meta indisponível.".to_string())??
        .ok_or("Configure as credenciais do WhatsApp oficial antes de ativar o receptor.".into())
}
async fn current(id: &str) -> Result<Arc<Receiver>, String> {
    CURRENT
        .lock()
        .await
        .clone()
        .filter(|rt| rt.id == id && !rt.cancel.is_cancelled())
        .ok_or("O receptor do WhatsApp oficial foi parado ou substituído.".into())
}
async fn stop_signal() {
    EPOCH.fetch_add(1, Ordering::SeqCst);
    if let Some(rt) = CURRENT.lock().await.as_ref() {
        rt.cancel.cancel();
        rt.notify.notify_one();
    }
}
async fn stop_locked() -> Result<(), String> {
    if let Some(rt) = CURRENT.lock().await.take() {
        rt.close().await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn studio_whatsapp_meta_status(window: tauri::WebviewWindow) -> Result<bool, String> {
    check(&window)?;
    tauri::async_runtime::spawn_blocking(|| api::read().map(|value| value.is_some()))
        .await
        .map_err(|_| "Cofre da Meta indisponível.".to_string())?
}
#[tauri::command]
pub async fn studio_whatsapp_meta_verify(
    window: tauri::WebviewWindow,
    input: Option<Credentials>,
) -> Result<Identity, String> {
    check(&window)?;
    let _lock = LIFE.lock().await;
    let replace = input.is_some();
    let value = match input {
        Some(value) => value,
        None => credentials().await?,
    };
    let identity = api::identity(&value, CancellationToken::new()).await?;
    if replace {
        stop_signal().await;
        stop_locked().await?;
        tauri::async_runtime::spawn_blocking(move || api::write(Some(value)))
            .await
            .map_err(|_| "Cofre da Meta indisponível.".to_string())??;
    }
    Ok(identity)
}
#[tauri::command]
pub async fn studio_whatsapp_meta_remove(window: tauri::WebviewWindow) -> Result<(), String> {
    check(&window)?;
    stop_signal().await;
    let _lock = LIFE.lock().await;
    stop_locked().await?;
    tauri::async_runtime::spawn_blocking(|| api::write(None))
        .await
        .map_err(|_| "Cofre da Meta indisponível.".to_string())?
}
#[tauri::command]
pub async fn studio_whatsapp_meta_settings(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    settings: Settings,
) -> Result<(), String> {
    check(&window)?;
    settings.validate()?;
    let _lock = LIFE.lock().await;
    if CURRENT
        .lock()
        .await
        .as_ref()
        .is_some_and(|rt| !rt.cancel.is_cancelled())
    {
        return Err("Pare o receptor antes de alterar o endereço do webhook.".into());
    }
    stop_locked().await?;
    let path = path(&app)?;
    let mut saved = Saved::load(&path)?;
    saved.settings = settings;
    saved.save(&path)
}
#[tauri::command]
pub async fn studio_whatsapp_meta_runtime(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<View, String> {
    check(&window)?;
    if let Some(rt) = CURRENT.lock().await.clone() {
        return Ok(rt.view().await);
    }
    Ok(View {
        active: false,
        saved: Saved::load(&path(&app)?)?,
        local_address: None,
        verified_at: None,
        last_event_at: None,
        error: None,
        identity: None,
    })
}
#[tauri::command]
pub async fn studio_whatsapp_meta_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    config: Config,
) -> Result<String, String> {
    check(&window)?;
    config.validate()?;
    if config
        .chats
        .iter()
        .any(|chat| !chat.ends_with("@s.whatsapp.net"))
    {
        return Err("O WhatsApp oficial desta integração aceita somente números individuais completos, sem grupos.".into());
    }
    let epoch = EPOCH.load(Ordering::SeqCst);
    let _lock = LIFE.lock().await;
    if CURRENT
        .lock()
        .await
        .as_ref()
        .is_some_and(|rt| !rt.cancel.is_cancelled())
    {
        return Err("O receptor do WhatsApp oficial já está ativo.".into());
    }
    stop_locked().await?;
    let path = path(&app)?;
    let mut saved = Saved::load(&path)?;
    saved.settings.validate()?;
    let credentials = credentials().await?;
    let identity = api::identity(&credentials, CancellationToken::new()).await?;
    let listener =
        tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, saved.settings.port))
            .await
            .map_err(|_| {
                "Não foi possível abrir a porta local do webhook. Escolha uma porta livre."
                    .to_string()
            })?;
    if EPOCH.load(Ordering::SeqCst) != epoch {
        return Err("A ativação do WhatsApp oficial foi interrompida.".into());
    }
    saved
        .journal
        .switch_account(&format!("meta:{}", credentials.phone_id));
    saved.journal.config = config;
    saved.save(&path)?;
    let own_phone = identity
        .display_phone
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    let rt = Arc::new(Receiver {
        id: uuid::Uuid::new_v4().to_string(),
        credentials,
        identity,
        own_phone,
        since: now() + 1,
        path,
        cancel: CancellationToken::new(),
        state: Mutex::new(State {
            saved,
            inflight: None,
            verified_at: None,
            last_event_at: None,
            error: None,
        }),
        notify: Notify::new(),
        slots: Semaphore::new(16),
        task: Mutex::new(None),
    });
    let server = rt.clone();
    let cancel = rt.cancel.clone();
    *rt.task.lock().await = Some(tokio::spawn(async move {
        let outcome = axum::serve(listener, webhook::router(server.clone()))
            .with_graceful_shutdown(cancel.cancelled_owned())
            .await;
        server.cancel.cancel();
        server.notify.notify_one();
        let mut state = server.state.lock().await;
        state.saved.journal.interrupt();
        if outcome.is_err() {
            state.error =
                Some("O receptor local da Meta foi encerrado por um erro de conexão.".into());
        }
        let _ = state.saved.save(&server.path);
    }));
    let mut active = CURRENT.lock().await;
    if EPOCH.load(Ordering::SeqCst) != epoch {
        rt.close().await?;
        return Err("A ativação do WhatsApp oficial foi interrompida.".into());
    }
    let id = rt.id.clone();
    *active = Some(rt);
    Ok(id)
}
#[tauri::command]
pub async fn studio_whatsapp_meta_stop(window: tauri::WebviewWindow) -> Result<(), String> {
    check(&window)?;
    stop_signal().await;
    let _lock = LIFE.lock().await;
    stop_locked().await
}
#[tauri::command]
pub async fn studio_whatsapp_meta_poll(
    window: tauri::WebviewWindow,
    session_id: String,
) -> Result<Option<Delivery>, String> {
    check(&window)?;
    let _poll = POLL
        .try_lock()
        .map_err(|_| "Já existe uma consulta ao WhatsApp oficial em andamento.".to_string())?;
    let rt = current(&session_id).await?;
    for attempt in 0..2 {
        if rt.cancel.is_cancelled() {
            return Err("O receptor do WhatsApp oficial foi parado.".into());
        }
        {
            let mut state = rt.state.lock().await;
            if state.inflight.is_some() {
                return Err("A mensagem anterior ainda está em processamento.".into());
            }
            if let Some(index) = state
                .saved
                .journal
                .history
                .iter()
                .position(|row| row.status == "received")
            {
                state.saved.journal.history[index].status = "processing".into();
                let row = state.saved.journal.history[index].clone();
                state.saved.save(&rt.path)?;
                state.inflight = Some(row.id.clone());
                return Ok(Some(row));
            }
        }
        if attempt == 0 {
            tokio::select! {_=rt.cancel.cancelled()=>return Err("O receptor do WhatsApp oficial foi parado.".into()),_=tokio::time::sleep(Duration::from_secs(10))=>{},_=rt.notify.notified()=>{}}
        }
    }
    Ok(None)
}
#[tauri::command]
pub async fn studio_whatsapp_meta_finish(
    window: tauri::WebviewWindow,
    session_id: String,
    delivery_id: String,
    reply: Option<String>,
    conversation_id: Option<String>,
) -> Result<(), String> {
    check(&window)?;
    if reply
        .as_ref()
        .is_some_and(|r| r.trim().is_empty() || r.encode_utf16().count() > 4000 || r.contains('\0'))
        || conversation_id
            .as_ref()
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_err())
    {
        return Err("Resposta inválida para o WhatsApp oficial.".into());
    }
    let rt = current(&session_id).await?;
    let automatic;
    {
        let mut state = rt.state.lock().await;
        if rt.cancel.is_cancelled() || state.inflight.as_deref() != Some(&delivery_id) {
            return Err("Esta mensagem não pertence à execução atual do WhatsApp oficial.".into());
        }
        let row = state
            .saved
            .journal
            .history
            .iter_mut()
            .find(|row| row.id == delivery_id && row.status == "processing")
            .ok_or("Mensagem indisponível para conclusão.")?;
        let success = reply.is_some();
        row.reply = reply;
        row.conversation_id = conversation_id;
        row.status = if success { "draft" } else { "failed" }.into();
        automatic = state.saved.journal.config.auto_reply && success;
        state.saved.save(&rt.path)?;
        state.inflight = None;
    }
    if automatic {
        send(&rt, &delivery_id).await?;
    }
    Ok(())
}
fn window_open(source: Option<i64>, at: i64) -> bool {
    source.is_some_and(|source| source <= at + 60 && at.saturating_sub(source) < 24 * 3600)
}
async fn send(rt: &Receiver, id: &str) -> Result<(), String> {
    let _send = SEND
        .try_lock()
        .map_err(|_| "Já existe um envio pelo WhatsApp oficial em andamento.".to_string())?;
    let prepared;
    {
        let mut state = rt.state.lock().await;
        if rt.cancel.is_cancelled() {
            return Err("O receptor do WhatsApp oficial foi parado.".into());
        }
        let row = state
            .saved
            .journal
            .history
            .iter()
            .find(|row| row.id == id)
            .ok_or("Resposta indisponível.")?;
        if !window_open(row.source_at, now()) {
            return Err("A janela de atendimento de 24 horas desta mensagem terminou. Descarte o rascunho; esta integração não inicia conversas por modelos de mensagem.".into());
        }
        prepared = state.saved.journal.prepare_send(id)?;
        state.saved.save(&rt.path)?;
    }
    let phone = prepared
        .chat_id
        .strip_suffix("@s.whatsapp.net")
        .ok_or("Destinatário inválido.")?;
    api::send(&rt.credentials, phone, &prepared.text, rt.cancel.clone()).await?;
    let mut state = rt.state.lock().await;
    if rt.cancel.is_cancelled() {
        return Err("A sessão foi interrompida após um possível envio. Confira o WhatsApp; a resposta não será repetida.".into());
    }
    if let Some(row) = state
        .saved
        .journal
        .history
        .iter_mut()
        .find(|row| row.id == id)
    {
        row.status = "sent".into();
    }
    state.error = None;
    state.saved.save(&rt.path)
}
#[tauri::command]
pub async fn studio_whatsapp_meta_send(
    window: tauri::WebviewWindow,
    session_id: String,
    delivery_id: String,
) -> Result<(), String> {
    check(&window)?;
    let rt = current(&session_id).await?;
    send(&rt, &delivery_id).await
}
#[tauri::command]
pub async fn studio_whatsapp_meta_discard(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    delivery_id: String,
) -> Result<(), String> {
    check(&window)?;
    let _send = SEND
        .try_lock()
        .map_err(|_| "Aguarde a conclusão do envio antes de descartar.".to_string())?;
    if let Some(rt) = CURRENT.lock().await.clone() {
        let mut state = rt.state.lock().await;
        discard(&mut state.saved, &delivery_id)?;
        state.error = None;
        state.saved.save(&rt.path)
    } else {
        let _lock = LIFE.lock().await;
        let path = path(&app)?;
        let mut saved = Saved::load(&path)?;
        discard(&mut saved, &delivery_id)?;
        saved.save(&path)
    }
}
fn discard(saved: &mut Saved, id: &str) -> Result<(), String> {
    let row = saved
        .journal
        .history
        .iter_mut()
        .find(|row| row.id == id && ["draft", "uncertain"].contains(&row.status.as_str()))
        .ok_or("Resposta indisponível para descarte.")?;
    row.status = "skipped".into();
    Ok(())
}

#[cfg(test)]
fn test_credentials() -> Credentials {
    Credentials {
        phone_id: "123456789012345".into(),
        access_token: "test_access_token_123456789012345".into(),
        app_secret: "0123456789abcdef0123456789abcdef".into(),
        verify_token: "verification-token-1234567890".into(),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_address_is_https_and_loopback_listener_ports_are_explicit() {
        let mut settings = Settings {
            public_url: format!("https://example.com{WEBHOOK_PATH}"),
            port: 18782,
        };
        settings.validate().unwrap();
        for url in [
            format!("http://example.com{WEBHOOK_PATH}"),
            format!("https://localhost{WEBHOOK_PATH}"),
            format!("https://127.0.0.1{WEBHOOK_PATH}"),
            format!("https://[::1]{WEBHOOK_PATH}"),
            format!("https://user:password@example.com{WEBHOOK_PATH}"),
            format!("https://example.com{WEBHOOK_PATH}?token=private"),
        ] {
            settings.public_url = url;
            assert!(settings.validate().is_err());
        }
    }
    #[test]
    fn replies_require_the_original_message_to_be_inside_the_service_window() {
        let at = 200_000;
        assert!(window_open(Some(at), at));
        assert!(window_open(Some(at - 86399), at));
        assert!(!window_open(Some(at - 86400), at));
        assert!(!window_open(Some(at + 61), at));
        assert!(!window_open(None, at));
    }
}

//! Private Baileys stdio worker. No HTTP bridge, imported Hermes sessions or token-read IPC.
mod install;
pub(super) mod journal;
mod vault;
use journal::{now, Config, Delivery, Journal};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, LazyLock,
    },
    time::Duration,
};
use tauri::Manager;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::{mpsc, oneshot, Mutex, Notify},
};
use tokio_util::sync::CancellationToken;

static LIFECYCLE: Mutex<()> = Mutex::const_new(());
static CURRENT: LazyLock<Mutex<Option<Arc<Bridge>>>> = LazyLock::new(|| Mutex::new(None));
static EPOCH: AtomicU64 = AtomicU64::new(0);
static POLL: Mutex<()> = Mutex::const_new(());
static SEND: Mutex<()> = Mutex::const_new(());
struct Request {
    value: Value,
    reply: oneshot::Sender<Result<(), String>>,
}
struct Session {
    id: String,
    since: i64,
    inflight: Option<String>,
}
struct State {
    phase: String,
    qr: Option<String>,
    error: Option<String>,
    saved: Journal,
    session: Option<Session>,
}
struct Bridge {
    tx: mpsc::Sender<Request>,
    cancel: CancellationToken,
    state: Mutex<State>,
    notify: Notify,
    path: PathBuf,
    generation: AtomicU64,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}
#[derive(Serialize)]
pub struct View {
    active: bool,
    phase: String,
    qr: Option<String>,
    error: Option<String>,
    saved: Journal,
}
impl Bridge {
    async fn rpc(&self, mut value: Value) -> Result<(), String> {
        if self.cancel.is_cancelled() {
            return Err("A conexão WhatsApp foi encerrada.".into());
        }
        value["request_id"] = json!(uuid::Uuid::new_v4().to_string());
        let (tx, rx) = oneshot::channel();
        self.tx
            .try_send(Request { value, reply: tx })
            .map_err(|_| "Componente WhatsApp ocupado ou indisponível.".to_string())?;
        tokio::time::timeout(Duration::from_secs(25),rx).await.map_err(|_|"O WhatsApp não confirmou a operação. Confira a conexão; um possível envio não será repetido.".to_string())?
            .map_err(|_|"Componente WhatsApp interrompido.".to_string())?
    }
    async fn view(&self) -> View {
        let state = self.state.lock().await;
        View {
            active: state.session.is_some(),
            phase: state.phase.clone(),
            qr: state.qr.clone(),
            error: state.error.clone(),
            saved: state.saved.clone(),
        }
    }
    async fn stop(&self) -> Result<(), String> {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        {
            let mut state = self.state.lock().await;
            state.session = None;
            state.saved.interrupt();
            state.saved.save(&self.path)?;
        }
        self.notify.notify_one();
        if !self.cancel.is_cancelled() {
            if let Err(error) = self
                .rpc(json!({"command":"pause","generation":generation}))
                .await
            {
                self.cancel.cancel();
                return Err(error);
            }
        }
        Ok(())
    }
    async fn close(&self) {
        self.cancel.cancel();
        if let Some(mut task) = self.task.lock().await.take() {
            if tokio::time::timeout(Duration::from_secs(5), &mut task)
                .await
                .is_err()
            {
                task.abort();
                let _ = task.await;
            }
        }
        let mut state = self.state.lock().await;
        state.session = None;
        state.qr = None;
        state.phase = "disconnected".into();
        state.saved.interrupt();
        let _ = state.saved.save(&self.path);
    }
}
fn check(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Configure o WhatsApp na janela principal.".into())
    }
}
fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("connectors/whatsapp-qr"))
        .map_err(|_| "Pasta do WhatsApp indisponível.".into())
}
async fn current() -> Result<Arc<Bridge>, String> {
    CURRENT
        .lock()
        .await
        .clone()
        .filter(|b| !b.cancel.is_cancelled())
        .ok_or("Conecte o WhatsApp pelo QR Code antes de ativar o receptor.".into())
}
fn qr_image(text: &str) -> Result<String, String> {
    if text.len() > 4096 {
        return Err("QR Code inválido.".into());
    }
    let qr = qrcode::QrCode::new(text.as_bytes())
        .map_err(|_| "Não foi possível gerar o QR Code.".to_string())?;
    let image = qr
        .render::<image::Luma<u8>>()
        .quiet_zone(true)
        .min_dimensions(320, 320)
        .build();
    let mut bytes = Vec::new();
    image::DynamicImage::ImageLuma8(image)
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .map_err(|_| "Não foi possível gerar a imagem do QR Code.".to_string())?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        bytes,
    ))
}

async fn read_packet(
    reader: &mut BufReader<tokio::process::ChildStdout>,
    bytes: &mut Vec<u8>,
) -> Result<Value, String> {
    loop {
        let buffer = reader
            .fill_buf()
            .await
            .map_err(|_| "Conexão do componente interrompida.".to_string())?;
        if buffer.is_empty() {
            return Err("O componente WhatsApp foi encerrado.".into());
        }
        let end = buffer
            .iter()
            .position(|b| *b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(buffer.len());
        if bytes.len() + end > 64 * 1024 {
            return Err("Resposta do componente WhatsApp excedeu o limite permitido.".into());
        }
        bytes.extend_from_slice(&buffer[..end]);
        reader.consume(end);
        if bytes.last() == Some(&b'\n') {
            let value = serde_json::from_slice(bytes)
                .map_err(|_| "Resposta inválida do componente WhatsApp.".to_string());
            bytes.clear();
            return value;
        }
    }
}
async fn event(bridge: &Bridge, value: Value) -> Result<bool, String> {
    let mut state = bridge.state.lock().await;
    match value["type"].as_str() {
        Some("state") => {
            let phase = value["phase"]
                .as_str()
                .filter(|phase| {
                    [
                        "qr",
                        "connecting",
                        "connected",
                        "disconnected",
                        "logged-out",
                        "error",
                    ]
                    .contains(phase)
                })
                .ok_or("Estado inválido do WhatsApp.")?;
            if phase != "connected" {
                state.session = None;
                state.saved.interrupt();
            }
            state.qr = if phase == "qr" {
                Some(qr_image(value["qr"].as_str().ok_or("QR Code ausente.")?)?)
            } else {
                None
            };
            if phase == "connected" {
                let account = value["account"]
                    .as_str()
                    .filter(|jid| journal::valid_chat(jid) && jid.ends_with("@s.whatsapp.net"))
                    .ok_or("O WhatsApp não confirmou a conta vinculada.")?;
                if state.saved.account != account {
                    state.session = None;
                }
                state.saved.switch_account(account);
            }
            state.phase = phase.into();
            if phase == "logged-out" {
                state.saved.expired = true;
            }
            state.saved.save(&bridge.path)?;
        }
        Some("message") => {
            let Some(since) = state.session.as_ref().map(|session| session.since) else {
                return Ok(false);
            };
            if state.phase != "connected" {
                return Ok(false);
            }
            if state.saved.incoming(&value, since)? {
                state.saved.save(&bridge.path)?;
            }
        }
        _ => return Err("Evento inválido do componente WhatsApp.".into()),
    }
    bridge.notify.notify_one();
    Ok(["disconnected", "logged-out", "error"].contains(&state.phase.as_str()))
}
async fn actor(
    mut child: tokio::process::Child,
    mut rx: mpsc::Receiver<Request>,
    bridge: Arc<Bridge>,
) {
    let mut pending: HashMap<String, oneshot::Sender<Result<(), String>>> = HashMap::new();
    let mut writer = child.stdin.take().expect("piped stdin");
    let mut reader = BufReader::new(child.stdout.take().expect("piped stdout"));
    let mut bytes = Vec::new();
    let outcome:Result<(),String>=async{
        loop{tokio::select!{
            biased;
            _=bridge.cancel.cancelled()=>return Ok(()),
            request=rx.recv()=>{
                let Some(request)=request else{return Ok(())};
                pending.retain(|_,reply|!reply.is_closed());
                if pending.len()>=16{let _=request.reply.send(Err("O componente WhatsApp está ocupado.".into()));continue}
                let id=request.value["request_id"].as_str().ok_or("Comando inválido.")?.to_string();
                let mut line=serde_json::to_vec(&request.value).map_err(|_|"Comando inválido.".to_string())?;line.push(b'\n');
                if line.len()>64*1024{let _=request.reply.send(Err("Comando excedeu o limite permitido.".into()));continue}
                tokio::time::timeout(Duration::from_secs(5),writer.write_all(&line)).await.map_err(|_|"O componente WhatsApp não está recebendo comandos.".to_string())?.map_err(|_|"Não foi possível comunicar com o componente WhatsApp.".to_string())?;
                pending.insert(id,request.reply);
            },
            packet=read_packet(&mut reader,&mut bytes)=>{
                let packet=packet?;
                if packet["type"]=="result"{
                    if let Some(id)=packet["request_id"].as_str(){if let Some(reply)=pending.remove(id){let _=reply.send(if packet["ok"]==true && packet["result"]==true{Ok(())}else{Err("O WhatsApp não confirmou a operação. Confira a conexão e o chat.".into())});}}
                }else {
                    // Terminal connection events also retire the process, so reconnect can start fresh.
                    if event(&bridge,packet).await? { return Ok(()); }
                }
            }
        }}
    }.await;
    bridge.cancel.cancel();
    let _ = child.kill().await;
    let mut state = bridge.state.lock().await;
    state.session = None;
    state.qr = None;
    state.saved.interrupt();
    if outcome.is_err() {
        state.phase = "error".into();
    } else if !["logged-out", "error"].contains(&state.phase.as_str()) {
        state.phase = "disconnected".into();
    }
    state.error = outcome.err();
    let _ = state.saved.save(&bridge.path);
    bridge.notify.notify_one();
    for (_, reply) in pending {
        let _ = reply.send(Err("Componente WhatsApp encerrado.".into()));
    }
}

#[tauri::command]
pub async fn studio_whatsapp_component(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    check(&window)?;
    let _lock = LIFECYCLE.lock().await;
    Ok(install::status(&directory(&app)?.join("runtime")).await)
}
#[tauri::command]
pub async fn studio_whatsapp_install(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    check(&window)?;
    let _lock = LIFECYCLE.lock().await;
    if CURRENT
        .lock()
        .await
        .as_ref()
        .is_some_and(|bridge| !bridge.cancel.is_cancelled())
    {
        return Err("Desconecte o WhatsApp antes de reinstalar o componente.".into());
    }
    if let Some(bridge) = CURRENT.lock().await.take() {
        bridge.close().await;
    }
    install::install(&directory(&app)?.join("runtime")).await
}
#[tauri::command]
pub async fn studio_whatsapp_connect(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<View, String> {
    check(&window)?;
    let epoch = EPOCH.load(Ordering::SeqCst);
    let _lock = LIFECYCLE.lock().await;
    if let Ok(bridge) = current().await {
        return Ok(bridge.view().await);
    }
    if let Some(bridge) = CURRENT.lock().await.take() {
        bridge.close().await;
    }
    let dir = directory(&app)?;
    let runtime = dir.join("runtime");
    let node = install::node().await?;
    if !install::ready(&runtime, &node).await {
        return Err("Instale o componente WhatsApp antes de conectar.".into());
    }
    let path = dir.join("journal.json");
    let saved = Journal::load(&path)?;
    if saved.expired {
        return Err("A vinculação WhatsApp foi revogada. Remova a sessão local e vincule novamente pelo QR Code.".into());
    }
    let session = dir.join("session.enc");
    let key = tauri::async_runtime::spawn_blocking(move || vault::key(&session))
        .await
        .map_err(|_| "Cofre do WhatsApp indisponível.".to_string())??;
    let mut command = install::command(&node);
    command
        .arg(runtime.join("bridge.mjs"))
        .current_dir(&runtime)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let child = command
        .spawn()
        .map_err(|_| "Não foi possível iniciar o componente WhatsApp.".to_string())?;
    let (tx, rx) = mpsc::channel(16);
    let bridge = Arc::new(Bridge {
        tx,
        cancel: CancellationToken::new(),
        state: Mutex::new(State {
            phase: "connecting".into(),
            qr: None,
            error: None,
            saved,
            session: None,
        }),
        notify: Notify::new(),
        path,
        generation: AtomicU64::new(0),
        task: Mutex::new(None),
    });
    *bridge.task.lock().await = Some(tokio::spawn(actor(child, rx, bridge.clone())));
    if EPOCH.load(Ordering::SeqCst) != epoch {
        bridge.cancel.cancel();
        return Err("Conexão WhatsApp cancelada.".into());
    }
    *CURRENT.lock().await = Some(bridge.clone());
    let file = dir.join("session.enc");
    if let Err(error) = bridge
        .rpc(json!({"command":"initialize","key":key,"file":file}))
        .await
    {
        bridge.cancel.cancel();
        return Err(error);
    }
    if EPOCH.load(Ordering::SeqCst) != epoch {
        bridge.cancel.cancel();
        return Err("Conexão WhatsApp cancelada.".into());
    }
    Ok(bridge.view().await)
}
#[tauri::command]
pub async fn studio_whatsapp_disconnect(window: tauri::WebviewWindow) -> Result<(), String> {
    check(&window)?;
    EPOCH.fetch_add(1, Ordering::SeqCst);
    if let Some(bridge) = CURRENT.lock().await.as_ref() {
        bridge.cancel.cancel();
    }
    let _lock = LIFECYCLE.lock().await;
    if let Some(bridge) = CURRENT.lock().await.take() {
        bridge.close().await;
    }
    Ok(())
}
#[tauri::command]
pub async fn studio_whatsapp_forget(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    check(&window)?;
    let _lock = LIFECYCLE.lock().await;
    if CURRENT
        .lock()
        .await
        .as_ref()
        .is_some_and(|bridge| !bridge.cancel.is_cancelled())
    {
        return Err("Desconecte o WhatsApp antes de remover a sessão local.".into());
    }
    if let Some(bridge) = CURRENT.lock().await.take() {
        bridge.close().await;
    }
    let dir = directory(&app)?;
    for name in ["session.enc", "session.enc.tmp"] {
        match std::fs::remove_file(dir.join(name)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Não foi possível remover a sessão local do WhatsApp.".into()),
        }
    }
    tauri::async_runtime::spawn_blocking(vault::remove)
        .await
        .map_err(|_| "Cofre do WhatsApp indisponível.".to_string())??;
    let path = dir.join("journal.json");
    if path.exists() {
        let mut saved = Journal::load(&path)?;
        saved.expired = false;
        saved.save(&path)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn studio_whatsapp_runtime(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<View, String> {
    check(&window)?;
    if let Some(bridge) = CURRENT.lock().await.clone() {
        return Ok(bridge.view().await);
    }
    let dir = directory(&app)?;
    let saved = Journal::load(&dir.join("journal.json"))?;
    Ok(View {
        active: false,
        phase: if saved.expired {
            "logged-out"
        } else {
            "disconnected"
        }
        .into(),
        qr: None,
        error: None,
        saved,
    })
}
#[tauri::command]
pub async fn studio_whatsapp_start(
    window: tauri::WebviewWindow,
    config: Config,
) -> Result<String, String> {
    check(&window)?;
    config.validate()?;
    let bridge = current().await?;
    let id = uuid::Uuid::new_v4().to_string();
    let since = now() + 1;
    let generation = bridge.generation.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut state = bridge.state.lock().await;
        if state.phase != "connected" || state.session.is_some() {
            return Err("Conecte a conta e pare o receptor anterior antes de ativar.".into());
        }
        state.saved.config = config.clone();
        state.saved.save(&bridge.path)?;
        state.session = Some(Session {
            id: id.clone(),
            since,
            inflight: None,
        });
    }
    if let Err(error)=bridge.rpc(json!({"command":"receive","chats":config.chats,"since":since,"generation":generation,"session_id":id})).await{let _=bridge.stop().await;return Err(error)}
    if bridge
        .state
        .lock()
        .await
        .session
        .as_ref()
        .is_none_or(|s| s.id != id)
    {
        return Err("A ativação do receptor foi interrompida.".into());
    }
    Ok(id)
}
#[tauri::command]
pub async fn studio_whatsapp_stop(window: tauri::WebviewWindow) -> Result<(), String> {
    check(&window)?;
    if let Ok(bridge) = current().await {
        bridge.stop().await?;
    }
    Ok(())
}
#[tauri::command]
pub async fn studio_whatsapp_poll(
    window: tauri::WebviewWindow,
    session_id: String,
) -> Result<Option<Delivery>, String> {
    check(&window)?;
    let _poll = POLL
        .try_lock()
        .map_err(|_| "Já existe uma consulta de mensagens WhatsApp em andamento.".to_string())?;
    let bridge = current().await?;
    for attempt in 0..2 {
        {
            let mut state = bridge.state.lock().await;
            let session = state
                .session
                .as_ref()
                .filter(|s| s.id == session_id)
                .ok_or("O receptor WhatsApp foi parado.")?;
            if session.inflight.is_some() {
                return Err("A mensagem anterior ainda está em processamento.".into());
            }
            if let Some(index) = state
                .saved
                .history
                .iter()
                .position(|row| row.status == "received")
            {
                state.saved.history[index].status = "processing".into();
                let row = state.saved.history[index].clone();
                state.saved.save(&bridge.path)?;
                state.session.as_mut().unwrap().inflight = Some(row.id.clone());
                return Ok(Some(row));
            }
        }
        if attempt == 0 {
            let _ = tokio::time::timeout(Duration::from_secs(10), bridge.notify.notified()).await;
        }
    }
    Ok(None)
}
#[tauri::command]
pub async fn studio_whatsapp_finish(
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
        return Err("Resposta WhatsApp inválida.".into());
    }
    let bridge = current().await?;
    let automatic;
    {
        let mut state = bridge.state.lock().await;
        if state
            .session
            .as_ref()
            .is_none_or(|s| s.id != session_id || s.inflight.as_deref() != Some(&delivery_id))
        {
            return Err("Esta mensagem não pertence à sessão WhatsApp ativa.".into());
        }
        let row = state
            .saved
            .history
            .iter_mut()
            .find(|row| row.id == delivery_id && row.status == "processing")
            .ok_or("Mensagem WhatsApp indisponível.")?;
        let success = reply.is_some();
        row.reply = reply;
        row.conversation_id = conversation_id;
        row.status = if success { "draft" } else { "failed" }.into();
        automatic = state.saved.config.auto_reply && success;
        state.saved.save(&bridge.path)?;
        state.session.as_mut().unwrap().inflight = None;
    }
    if automatic {
        send(&bridge, &session_id, &delivery_id).await?;
    }
    Ok(())
}
async fn send(bridge: &Bridge, session_id: &str, id: &str) -> Result<(), String> {
    let _send = SEND
        .try_lock()
        .map_err(|_| "Já existe um envio WhatsApp em andamento.".to_string())?;
    let body;
    {
        let mut state = bridge.state.lock().await;
        if state.phase != "connected" || state.session.as_ref().is_none_or(|s| s.id != session_id) {
            return Err("Receptor WhatsApp parado ou desconectado.".into());
        }
        let value = state.saved.prepare_send(id)?;
        body = json!({"command":"send","chat_id":value.chat_id,"text":value.text,"session_id":session_id});
        state.saved.save(&bridge.path)?;
    }
    bridge.rpc(body).await?;
    let mut state = bridge.state.lock().await;
    if bridge.cancel.is_cancelled() {
        return Err("A sessão foi encerrada após um possível envio. Confira o WhatsApp; a resposta não será repetida.".into());
    }
    if let Some(row) = state.saved.history.iter_mut().find(|row| row.id == id) {
        row.status = "sent".into();
    }
    state.saved.save(&bridge.path)
}
#[tauri::command]
pub async fn studio_whatsapp_send(
    window: tauri::WebviewWindow,
    session_id: String,
    delivery_id: String,
) -> Result<(), String> {
    check(&window)?;
    let bridge = current().await?;
    send(&bridge, &session_id, &delivery_id).await
}
#[tauri::command]
pub async fn studio_whatsapp_discard(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    delivery_id: String,
) -> Result<(), String> {
    check(&window)?;
    let _send = SEND
        .try_lock()
        .map_err(|_| "Aguarde a conclusão do envio WhatsApp antes de descartar.".to_string())?;
    if let Some(bridge) = CURRENT.lock().await.clone() {
        let mut state = bridge.state.lock().await;
        discard(&mut state.saved, &delivery_id)?;
        state.saved.save(&bridge.path)
    } else {
        let _lock = LIFECYCLE.lock().await;
        let path = directory(&app)?.join("journal.json");
        let mut saved = Journal::load(&path)?;
        discard(&mut saved, &delivery_id)?;
        saved.save(&path)
    }
}
fn discard(saved: &mut Journal, id: &str) -> Result<(), String> {
    let row = saved
        .history
        .iter_mut()
        .find(|row| row.id == id && ["draft", "uncertain"].contains(&row.status.as_str()))
        .ok_or("Resposta WhatsApp indisponível para descarte.")?;
    row.status = "skipped".into();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn qr_is_a_bounded_png_without_persisting_the_pairing_payload() {
        use base64::Engine;
        let image = qr_image("bionic-local-test-fixture").unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(image)
            .unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        assert!(qr_image(&"x".repeat(4097)).is_err());
    }
    #[tokio::test]
    async fn terminal_and_account_switch_events_invalidate_the_receiver() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("whatsapp-event-probe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let (tx, _rx) = mpsc::channel(1);
        let bridge = Bridge {
            tx,
            cancel: CancellationToken::new(),
            state: Mutex::new(State {
                phase: "connected".into(),
                qr: None,
                error: None,
                saved: Journal::default(),
                session: Some(Session {
                    id: "old".into(),
                    since: 0,
                    inflight: None,
                }),
            }),
            notify: Notify::new(),
            path: dir.join("journal.json"),
            generation: AtomicU64::new(0),
            task: Mutex::new(None),
        };
        assert!(!event(
            &bridge,
            json!({"type":"state","phase":"connected","account":"5511999999999@s.whatsapp.net"})
        )
        .await
        .unwrap());
        assert!(bridge.state.lock().await.session.is_none());
        assert!(event(&bridge, json!({"type":"state","phase":"logged-out"}))
            .await
            .unwrap());
        assert!(Journal::load(&bridge.path).unwrap().expired);
        assert_eq!(bridge.view().await.phase, "logged-out");
        std::fs::remove_file(&bridge.path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[tokio::test]
    #[ignore = "Uses a real local Node child with a controlled protocol; no WhatsApp account"]
    async fn stdio_worker_observes_durable_send_marker_and_stops_without_replay() {
        let node = install::node().await.unwrap();
        let target = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target");
        let dir = target.join(format!("whatsapp-worker-probe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("worker.mjs");
        std::fs::write(
            &script,
            r#"
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
let count=0, sequence=Promise.resolve();
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{sequence=sequence.then(async()=>{
 const command=JSON.parse(line);let ok=true;
 if(command.command==='send'){
   const journal=JSON.parse(readFileSync('journal.json'));
   ok=journal.history.some(row=>row.status==='uncertain' && row.chat_id===command.chat_id);
   if(ok){count++;writeFileSync('count.txt',String(count));}
 }
 const reply=JSON.stringify({type:'result',request_id:command.request_id,ok,result:ok})+'\n';
 process.stdout.write(reply.slice(0,10));
 await new Promise(resolve=>setTimeout(resolve,5));
 process.stdout.write(reply.slice(10));
});});
lines.on('close',()=>process.exit(0));
"#,
        )
        .unwrap();
        let mut saved = Journal::default();
        saved.account = "5511888888888@s.whatsapp.net".into();
        saved.config = Config {
            chats: vec!["5511999999999@s.whatsapp.net".into()],
            agent_id: "profile".into(),
            auto_reply: false,
        };
        saved.incoming(&json!({"chat_id":"5511999999999@s.whatsapp.net","remote_id":"TESTID","text":"Olá","timestamp":now()}),0).unwrap();
        saved.history[0].status = "draft".into();
        saved.history[0].reply = Some("Olá de volta!".into());
        let delivery_id = saved.history[0].id.clone();
        let path = dir.join("journal.json");
        saved.save(&path).unwrap();
        let mut command = install::command(&node);
        command
            .arg(&script)
            .current_dir(&dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let child = command.spawn().unwrap();
        let (tx, rx) = mpsc::channel(16);
        let bridge = Arc::new(Bridge {
            tx,
            cancel: CancellationToken::new(),
            state: Mutex::new(State {
                phase: "connected".into(),
                qr: None,
                error: None,
                saved,
                session: Some(Session {
                    id: "test-session".into(),
                    since: 0,
                    inflight: None,
                }),
            }),
            notify: Notify::new(),
            path,
            generation: AtomicU64::new(0),
            task: Mutex::new(None),
        });
        struct CancelOnDrop(CancellationToken);
        impl Drop for CancelOnDrop {
            fn drop(&mut self) {
                self.0.cancel();
            }
        }
        let _guard = CancelOnDrop(bridge.cancel.clone());
        *bridge.task.lock().await = Some(tokio::spawn(actor(child, rx, bridge.clone())));
        let (a, b) = tokio::join!(
            bridge.rpc(json!({"command":"ping-a"})),
            bridge.rpc(json!({"command":"ping-b"}))
        );
        a.unwrap();
        b.unwrap();
        send(&bridge, "test-session", &delivery_id).await.unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("count.txt")).unwrap(), "1");
        assert_eq!(bridge.state.lock().await.saved.history[0].status, "sent");
        assert!(send(&bridge, "test-session", &delivery_id).await.is_err());
        bridge.stop().await.unwrap();
        assert!(send(&bridge, "test-session", &delivery_id).await.is_err());
        bridge.close().await;
        assert_eq!(std::fs::read_to_string(dir.join("count.txt")).unwrap(), "1");
        assert_eq!(bridge.view().await.phase, "disconnected");
        for name in ["worker.mjs", "journal.json", "count.txt"] {
            std::fs::remove_file(dir.join(name)).unwrap();
        }
        std::fs::remove_dir(dir).unwrap();
    }
}

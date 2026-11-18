//! One opt-in receiver. Durable cursor before generation, durable send attempt before HTTP.
use super::{bot_call, check_main, get_me, read_token, OPERATION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::{LazyLock, atomic::{AtomicU64, Ordering}}, time::{SystemTime, UNIX_EPOCH}};
use tauri::Manager;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Config { pub chats: Vec<i64>, pub agent_id: String, pub auto_reply: bool }
impl Config {
    fn validate(&self) -> Result<(), String> {
        if self.chats.is_empty() || self.chats.len() > 50 || self.chats.iter().any(|id| *id == 0 || id.unsigned_abs() > 4_503_599_627_370_495)
            || self.agent_id.is_empty() || self.agent_id.len() > 80 || !self.agent_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
            return Err("Selecione um agente e informe de 1 a 50 IDs numéricos de chats permitidos.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Delivery {
    pub id: String, pub bot_id: u64, pub update_id: i64, pub message_id: i64,
    pub chat_id: i64, pub text: String, pub received_at: i64,
    pub status: String, pub reply: Option<String>, pub conversation_id: Option<String>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
pub struct Saved { pub config: Config, pub bot_id: u64, pub offset: i64, #[serde(default)] pub last_update_at: i64, pub history: Vec<Delivery> }
#[derive(Serialize)]
pub struct View { pub active: bool, pub saved: Saved }
struct Session { id: String, cancel: CancellationToken, started_at: i64, inflight: Option<String> }
static SESSION: LazyLock<tokio::sync::Mutex<Option<Session>>> = LazyLock::new(|| tokio::sync::Mutex::new(None));
static POLL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static SEND: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static EPOCH: AtomicU64 = AtomicU64::new(0);

fn now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64 }
fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|dir| dir.join("telegram-runtime.json")).map_err(|_| "Pasta do Telegram indisponível.".into())
}
fn load(app: &tauri::AppHandle) -> Result<Saved, String> {
    load_at(&path(app)?)
}
fn load_at(path: &std::path::Path) -> Result<Saved, String> {
    use std::io::Read;
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Saved::default()),
        Err(_) => return Err("Não foi possível ler o histórico do Telegram.".into()),
    };
    let mut bytes = Vec::new();
    file.take(2 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| "Não foi possível ler o histórico do Telegram.".to_string())?;
    if bytes.len() > 2 * 1024 * 1024 { return Err("O histórico do Telegram excedeu o limite permitido.".into()); }
    let saved: Saved = serde_json::from_slice(&bytes).map_err(|_| "O histórico do Telegram está inválido. Preserve o arquivo antes de restaurá-lo.".to_string())?;
    if saved.history.len() > 20 || saved.offset < 0 || saved.history.iter().any(|row| row.text.len() > 24_000 || row.reply.as_ref().is_some_and(|r| r.len() > 16_000)) {
        return Err("O histórico do Telegram está inválido.".into());
    }
    Ok(saved)
}
fn save(app: &tauri::AppHandle, saved: &Saved) -> Result<(), String> {
    let path = path(app)?;
    save_at(&path, saved)
}
fn save_at(path: &std::path::Path, saved: &Saved) -> Result<(), String> {
    std::fs::create_dir_all(path.parent().ok_or("Pasta do Telegram inválida.")?).map_err(|_| "Não foi possível criar a pasta do Telegram.".to_string())?;
    let bytes = serde_json::to_vec(saved).map_err(|_| "Não foi possível preparar o histórico do Telegram.".to_string())?;
    if bytes.len() > 2 * 1024 * 1024 { return Err("O histórico do Telegram excedeu o limite permitido.".into()); }
    crate::commands::filesystem::write_atomic(&path, &bytes).map_err(|_| "Não foi possível salvar o histórico do Telegram. O processamento foi interrompido.".into())
}
pub async fn stop_current() {
    EPOCH.fetch_add(1, Ordering::SeqCst);
    if let Some(session) = SESSION.lock().await.take() { session.cancel.cancel(); }
}
async fn token() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(read_token).await.map_err(|_| "Cofre do Telegram indisponível.".to_string())??.ok_or("Configure o token do bot antes de ativar o receptor.".into())
}
async fn session(id: &str) -> Result<(CancellationToken, i64), String> {
    let state = SESSION.lock().await;
    let active = state.as_ref().filter(|s| s.id == id && !s.cancel.is_cancelled()).ok_or("O receptor do Telegram foi parado. Ative-o novamente para continuar.")?;
    Ok((active.cancel.clone(), active.started_at))
}
fn interrupt(saved: &mut Saved) {
    for row in &mut saved.history {
        if row.status == "processing" { row.status = "interrupted".into(); }
    }
}

#[tauri::command]
pub async fn studio_telegram_runtime(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<View, String> {
    check_main(&window)?;
    let _lock = OPERATION.lock().await;
    let active = SESSION.lock().await.is_some();
    let mut saved = load(&app)?;
    if !active { interrupt(&mut saved); }
    Ok(View { active, saved })
}

#[tauri::command]
pub async fn studio_telegram_start(app: tauri::AppHandle, window: tauri::WebviewWindow, config: Config) -> Result<String, String> {
    check_main(&window)?;
    config.validate()?;
    let epoch = EPOCH.load(Ordering::SeqCst);
    let _lock = OPERATION.lock().await;
    if SESSION.lock().await.is_some() { return Err("Pare o receptor antes de alterar a configuração.".into()); }
    let value = token().await?;
    let bot = get_me(&value).await?;
    let webhook = bot_call(&value, "getWebhookInfo", json!({}), CancellationToken::new()).await?;
    if webhook["url"].as_str() != Some("") { return Err("Este bot já usa webhook. Configure um bot exclusivo; o BionicLLM não remove webhooks de outros serviços.".into()); }
    if EPOCH.load(Ordering::SeqCst) != epoch { return Err("A ativação do Telegram foi interrompida.".into()); }
    let mut saved = load(&app)?;
    interrupt(&mut saved);
    if saved.bot_id != bot.id {
        saved.offset = 0;
        for row in &mut saved.history { if row.status == "draft" { row.status = "skipped".into(); } }
    }
    saved.bot_id = bot.id;
    saved.config = config;
    save(&app, &saved)?;
    let id = uuid::Uuid::new_v4().to_string();
    let mut state = SESSION.lock().await;
    if EPOCH.load(Ordering::SeqCst) != epoch { return Err("A ativação do Telegram foi interrompida.".into()); }
    *state = Some(Session { id: id.clone(), cancel: CancellationToken::new(), started_at: now() + 1, inflight: None });
    Ok(id)
}

#[tauri::command]
pub async fn studio_telegram_stop(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    check_main(&window)?;
    // Cancel immediately, before waiting for a disk/credential operation.
    stop_current().await;
    let _lock = OPERATION.lock().await;
    stop_current().await;
    let mut saved = load(&app)?;
    interrupt(&mut saved);
    save(&app, &saved)
}

fn claim(saved: &mut Saved, updates: &Value, started_at: i64) -> Result<Option<Delivery>, String> {
    let updates = updates.as_array().filter(|items| items.len() <= 20).ok_or("Lista de mensagens do Telegram inválida.")?;
    for update in updates {
        let Some(id) = update["update_id"].as_i64().filter(|id| *id >= saved.offset && *id < i64::MAX) else { continue };
        let message = &update["message"];
        let chat = message["chat"]["id"].as_i64();
        let text = message["text"].as_str();
        let accepted = chat.is_some_and(|chat| saved.config.chats.contains(&chat))
            && matches!(message["chat"]["type"].as_str(), Some("private" | "group" | "supergroup"))
            && message["from"]["is_bot"] == false
            && message["date"].as_i64().is_some_and(|date| date >= started_at)
            && message["message_id"].as_i64().is_some_and(|id| id > 0)
            && text.is_some_and(|text| !text.trim().is_empty() && text.chars().count() <= 6000 && !text.contains('\0'));
        if accepted && saved.history.len() >= 20 {
            if let Some(index) = saved.history.iter().position(|row| !["draft", "processing", "uncertain"].contains(&row.status.as_str())) {
                saved.history.remove(index);
            } else { return Err("O histórico está cheio de respostas pendentes. Revise ou descarte uma resposta antes de continuar.".into()); }
        }
        // Advance before returning accepted work. A crash never regenerates/re-sends it.
        saved.offset = id + 1;
        saved.last_update_at = now();
        if accepted {
            let row = Delivery { id: uuid::Uuid::new_v4().to_string(), bot_id: saved.bot_id, update_id: id,
                message_id: message["message_id"].as_i64().unwrap(), chat_id: chat.unwrap(), text: text.unwrap().into(),
                received_at: now(), status: "processing".into(), reply: None, conversation_id: None };
            saved.history.push(row.clone());
            return Ok(Some(row));
        }
    }
    Ok(None)
}

fn reset_idle_offset(saved: &mut Saved, at: i64) -> bool {
    // Telegram chooses a random update_id after a week without updates, possibly below
    // the old cursor. Its queue lasts at most 24h, so a cursor idle for six days can
    // be reset without replaying the old acknowledged messages.
    if saved.offset > 0 && at.saturating_sub(saved.last_update_at) > 6 * 24 * 3600 {
        saved.offset = 0;
        saved.last_update_at = at;
        true
    } else { false }
}

#[tauri::command]
pub async fn studio_telegram_poll(app: tauri::AppHandle, window: tauri::WebviewWindow, session_id: String) -> Result<Option<Delivery>, String> {
    check_main(&window)?;
    let _poll = POLL.try_lock().map_err(|_| "Já existe uma consulta de mensagens em andamento.".to_string())?;
    let (cancel, started_at) = session(&session_id).await?;
    let (offset, value) = {
        let _lock = OPERATION.lock().await;
        if SESSION.lock().await.as_ref().is_some_and(|s| s.inflight.is_some()) { return Err("A mensagem anterior ainda está em processamento.".into()); }
        let mut saved = load(&app)?;
        if reset_idle_offset(&mut saved, now()) { save(&app, &saved)?; }
        (saved.offset, token().await?)
    };
    let updates = bot_call(&value, "getUpdates", json!({ "offset": offset, "limit": 20, "timeout": 10, "allowed_updates": ["message"] }), cancel).await?;
    let _lock = OPERATION.lock().await;
    session(&session_id).await?;
    let mut saved = load(&app)?;
    let row = claim(&mut saved, &updates, started_at)?;
    save(&app, &saved)?;
    if let Some(row) = &row {
        let mut state = SESSION.lock().await;
        let active = state.as_mut().filter(|s| s.id == session_id).ok_or("O receptor foi parado.")?;
        active.inflight = Some(row.id.clone());
    }
    Ok(row)
}

#[tauri::command]
pub async fn studio_telegram_finish(app: tauri::AppHandle, window: tauri::WebviewWindow, session_id: String, delivery_id: String, reply: Option<String>, conversation_id: Option<String>) -> Result<(), String> {
    check_main(&window)?;
    if reply.as_ref().is_some_and(|text| text.trim().is_empty() || text.encode_utf16().count() > 4000 || text.contains('\0'))
        || conversation_id.as_ref().is_some_and(|id| uuid::Uuid::parse_str(id).is_err()) { return Err("Resposta do Telegram inválida.".into()); }
    let auto_reply;
    {
        let _lock = OPERATION.lock().await;
        session(&session_id).await?;
        let mut state = SESSION.lock().await;
        let active = state.as_mut().ok_or("O receptor foi parado.")?;
        if active.inflight.as_deref() != Some(&delivery_id) { return Err("Esta mensagem não pertence ao processamento atual.".into()); }
        let mut saved = load(&app)?;
        auto_reply = finish_delivery(&mut saved, &delivery_id, reply, conversation_id)?;
        save(&app, &saved)?;
        active.inflight = None;
    }
    if auto_reply { send(&app, &session_id, &delivery_id).await?; }
    Ok(())
}

fn finish_delivery(saved: &mut Saved, id: &str, reply: Option<String>, conversation_id: Option<String>) -> Result<bool, String> {
    let row = saved.history.iter_mut().find(|row| row.id == id && row.status == "processing").ok_or("Mensagem indisponível para conclusão.")?;
    row.status = if reply.is_some() { "draft" } else { "failed" }.into();
    row.reply = reply;
    row.conversation_id = conversation_id;
    Ok(saved.config.auto_reply && row.reply.is_some())
}

fn prepare_send(saved: &mut Saved, id: &str) -> Result<Value, String> {
    let row = saved.history.iter_mut().find(|row| row.id == id).ok_or("Resposta não encontrada.")?;
    if row.status != "draft" || row.bot_id != saved.bot_id || !saved.config.chats.contains(&row.chat_id) { return Err("Esta resposta não está autorizada para envio.".into()); }
    let reply = row.reply.as_ref().filter(|reply| !reply.trim().is_empty() && reply.encode_utf16().count() <= 4000).ok_or("A resposta está vazia ou excede o limite permitido.")?;
    // Telegram has no idempotency key: uncertainty is durable BEFORE touching the network.
    row.status = "uncertain".into();
    Ok(json!({ "chat_id": row.chat_id, "text": reply, "reply_parameters": { "message_id": row.message_id, "allow_sending_without_reply": false }, "link_preview_options": { "is_disabled": true } }))
}
async fn send(app: &tauri::AppHandle, session_id: &str, id: &str) -> Result<(), String> {
    let _send = SEND.try_lock().map_err(|_| "Já existe um envio em andamento.".to_string())?;
    let (cancel, _) = session(session_id).await?;
    let (body, value) = {
        let _lock = OPERATION.lock().await;
        session(session_id).await?;
        let value = token().await?;
        let mut saved = load(app)?;
        let body = prepare_send(&mut saved, id)?;
        save(app, &saved)?;
        (body, value)
    };
    let result = bot_call(&value, "sendMessage", body.clone(), cancel).await?;
    if result["message_id"].as_i64().is_none() || result["chat"]["id"] != body["chat_id"] { return Err("O Telegram não confirmou o destino da resposta. Confira o chat; o envio não será repetido.".into()); }
    let _lock = OPERATION.lock().await;
    let mut saved = load(app)?;
    if let Some(row) = saved.history.iter_mut().find(|row| row.id == id) { row.status = "sent".into(); }
    save(app, &saved)
}

#[tauri::command]
pub async fn studio_telegram_send(app: tauri::AppHandle, window: tauri::WebviewWindow, session_id: String, delivery_id: String) -> Result<(), String> {
    check_main(&window)?;
    send(&app, &session_id, &delivery_id).await
}
#[tauri::command]
pub async fn studio_telegram_discard(app: tauri::AppHandle, window: tauri::WebviewWindow, delivery_id: String) -> Result<(), String> {
    check_main(&window)?;
    let _send = SEND.try_lock().map_err(|_| "Aguarde a conclusão ou interrupção do envio antes de descartar a resposta.".to_string())?;
    let _lock = OPERATION.lock().await;
    let mut saved = load(&app)?;
    let row = saved.history.iter_mut().find(|row| row.id == delivery_id && ["draft", "uncertain"].contains(&row.status.as_str())).ok_or("Esta resposta não está disponível para descarte.")?;
    row.status = "skipped".into();
    save(&app, &saved)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn saved() -> Saved { Saved { bot_id: 42, config: Config { chats: vec![123, -100456], agent_id: "agent-1".into(), auto_reply: false }, ..Saved::default() } }
    fn update(id: i64, chat: i64, date: i64, bot: bool) -> Value {
        json!({"update_id":id,"message":{"message_id":id+1,"chat":{"id":chat,"type": if chat < 0 { "supergroup" } else { "private" }},"date":date,"from":{"is_bot":bot},"text":"Olá"}})
    }
    #[test]
    fn config_requires_an_explicit_agent_and_closed_chat_list() {
        assert!(saved().config.validate().is_ok());
        for config in [Config::default(), Config { chats: vec![0], agent_id: "agent".into(), auto_reply: true }, Config { chats: vec![123], agent_id: "../agent".into(), auto_reply: false }] {
            assert!(config.validate().is_err());
        }
    }
    #[test]
    fn claims_only_new_allowed_human_text_and_never_replays_claimed_work() {
        let mut saved = saved();
        let updates = json!([update(1, 999, 101, false), update(2,123,99,false), update(3,123,101,true), {"update_id":4,"edited_message":{}}, update(5,-100456,101,false), update(6,123,101,false)]);
        let first = claim(&mut saved, &updates, 100).unwrap().unwrap();
        assert_eq!(first.update_id, 5);
        assert_eq!(first.chat_id, -100456);
        assert_eq!(saved.offset, 6);
        let second = claim(&mut saved, &updates, 100).unwrap().unwrap();
        assert_eq!(second.update_id, 6);
        assert!(claim(&mut saved, &updates, 100).unwrap().is_none());
        assert_eq!(saved.history.len(), 2);
        assert!(saved.history.iter().all(|row| row.chat_id != 999));
    }
    #[test]
    fn claimed_cursor_survives_restart_and_interrupted_work_is_not_replayed() {
        let path = std::env::temp_dir().join(format!("bionic-telegram-test-{}.json", uuid::Uuid::new_v4()));
        let mut saved = saved();
        let updates = json!([update(10,123,101,false)]);
        claim(&mut saved, &updates, 100).unwrap();
        save_at(&path, &saved).unwrap();
        let mut restored = load_at(&path).unwrap();
        interrupt(&mut restored);
        assert_eq!(restored.history[0].status, "interrupted");
        assert!(claim(&mut restored, &updates, 100).unwrap().is_none());
        std::fs::remove_file(&path).unwrap();
    }
    #[test]
    fn sending_marks_uncertainty_before_network_and_rejects_repeat_or_wrong_chat() {
        let mut saved = saved();
        claim(&mut saved, &json!([update(10,123,101,false)]), 100).unwrap();
        let id = saved.history[0].id.clone();
        saved.history[0].status = "draft".into();
        saved.history[0].reply = Some("Olá, tudo bem?".into());
        saved.config.chats.clear();
        assert!(prepare_send(&mut saved, &id).is_err());
        saved.config.chats.push(123);
        let body = prepare_send(&mut saved, &id).unwrap();
        assert_eq!(body["chat_id"], 123);
        assert_eq!(body["reply_parameters"]["message_id"], 11);
        assert!(body.get("parse_mode").is_none());
        assert_eq!(saved.history[0].status, "uncertain");
        assert!(prepare_send(&mut saved, &id).is_err());
    }
    #[test]
    fn review_is_default_and_auto_delivery_requires_a_successful_explicit_opt_in() {
        for automatic in [false, true] {
            for success in [false, true] {
                let mut saved = saved();
                saved.config.auto_reply = automatic;
                let row = claim(&mut saved, &json!([update(10,123,101,false)]),100).unwrap().unwrap();
                let auto_send = finish_delivery(&mut saved, &row.id, success.then(|| "Olá".into()), None).unwrap();
                assert_eq!(auto_send, automatic && success);
                assert_eq!(saved.history[0].status, if success { "draft" } else { "failed" });
                assert!(finish_delivery(&mut saved,&row.id,Some("duplicada".into()),None).is_err());
            }
        }
    }
    #[test]
    fn pending_drafts_are_never_evicted_to_make_room() {
        let mut saved = saved();
        for index in 0..20 {
            claim(&mut saved, &json!([update(index,123,101,false)]),100).unwrap();
            saved.history.last_mut().unwrap().status = "draft".into();
        }
        assert!(claim(&mut saved,&json!([update(20,123,101,false)]),100).is_err());
        assert_eq!(saved.offset,20);
        saved.history[0].status = "sent".into();
        assert!(claim(&mut saved,&json!([update(20,123,101,false)]),100).unwrap().is_some());
        assert_eq!(saved.history.len(),20);
    }
    #[test]
    fn a_week_of_inactivity_cannot_strand_the_receiver_on_a_randomized_update_id() {
        let mut saved = saved();
        saved.offset = 999_999;
        saved.last_update_at = 100;
        assert!(!reset_idle_offset(&mut saved, 100 + 24 * 3600));
        assert!(reset_idle_offset(&mut saved, 100 + 7 * 24 * 3600));
        assert_eq!(saved.offset, 0);
    }
    #[tokio::test]
    async fn stop_invalidates_session_and_cancels_its_transport() {
        let _lock = OPERATION.lock().await;
        let cancel = CancellationToken::new();
        *SESSION.lock().await = Some(Session { id: "test-session".into(), cancel: cancel.clone(), started_at:0, inflight:None });
        assert!(session("test-session").await.is_ok());
        stop_current().await;
        assert!(cancel.is_cancelled());
        assert!(session("test-session").await.is_err());
    }
}

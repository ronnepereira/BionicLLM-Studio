//! Local agent gateway. Never binds a public interface or accepts browser CORS.
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentJob {
    pub id: String,
    pub prompt: String,
    pub model: Option<String>,
    pub kind: String,
    pub status: String,
    pub result: Option<String>,
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub messages: Option<Vec<Value>>,
}

#[derive(Clone)]
struct Gateway {
    token: String,
    jobs: Arc<Mutex<BTreeMap<String, AgentJob>>>,
    models: Arc<Mutex<Vec<String>>>,
    enabled: Arc<std::sync::atomic::AtomicBool>,
    journal: Option<std::path::PathBuf>,
}
static GATEWAY: OnceLock<Gateway> = OnceLock::new();
static START_HIDDEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn background_start() -> bool {
    START_HIDDEN.load(std::sync::atomic::Ordering::Relaxed)
}
pub fn allow_show() {
    START_HIDDEN.store(false, std::sync::atomic::Ordering::Relaxed);
}
pub fn initialize_launch() {
    START_HIDDEN.store(
        std::env::args().any(|a| a == "--agent-service" || a == "--background"),
        std::sync::atomic::Ordering::Relaxed,
    );
    #[cfg(windows)]
    {
        let current = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", format!("{current} --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows"));
    }
}

fn authorized(headers: &HeaderMap, state: &Gateway) -> bool {
    state.enabled.load(std::sync::atomic::Ordering::Relaxed)
        && headers
            .get("authorization")
            .and_then(|h| h.to_str().ok())
            .is_some_and(|s| s == format!("Bearer {}", state.token))
}

#[derive(Deserialize)]
struct Request {
    prompt: String,
    model: Option<String>,
    kind: Option<String>,
}

fn save_jobs(state: &Gateway, jobs: &BTreeMap<String, AgentJob>) -> Result<(), String> {
    use std::io::Write;
    let Some(path) = &state.journal else {
        return Ok(());
    };
    let tmp = path.with_extension("tmp");
    let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(&serde_json::to_vec(jobs).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    drop(f);
    std::fs::rename(tmp, path).map_err(|e| e.to_string())
}

fn enqueue(state: &Gateway, request: Request) -> Result<AgentJob, (StatusCode, String)> {
    if request.prompt.trim().is_empty() || request.prompt.len() > 1_000_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Informe uma mensagem entre 1 e 1.000.000 de bytes.".into(),
        ));
    }
    let mut jobs = state
        .jobs
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if jobs
        .values()
        .filter(|j| j.status == "queued" || j.status == "running")
        .count()
        >= 8
    {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "A fila do agente está cheia.".into(),
        ));
    }
    if jobs.len() >= 128 {
        let expired: Vec<_> = jobs
            .iter()
            .filter(|(_, j)| !["queued", "running"].contains(&j.status.as_str()))
            .map(|(id, _)| id.clone())
            .take(64)
            .collect();
        for id in expired {
            jobs.remove(&id);
        }
    }
    let job = AgentJob {
        id: uuid::Uuid::new_v4().to_string(),
        prompt: request.prompt,
        model: request.model,
        kind: request.kind.unwrap_or_else(|| "agent".into()),
        status: "queued".into(),
        result: None,
        conversation_id: None,
        messages: None,
    };
    jobs.insert(job.id.clone(), job.clone());
    if let Err(error) = save_jobs(state, &jobs) {
        jobs.remove(&job.id);
        return Err((StatusCode::INTERNAL_SERVER_ERROR, error));
    }
    Ok(job)
}

async fn create_job(
    State(state): State<Gateway>,
    headers: HeaderMap,
    Json(request): Json<Request>,
) -> Result<Json<AgentJob>, (StatusCode, String)> {
    if !authorized(&headers, &state) {
        return Err((
            StatusCode::UNAUTHORIZED,
            "Acesso local não autorizado ou serviço desativado.".into(),
        ));
    }
    enqueue(&state, request).map(Json)
}
async fn read_job(
    State(state): State<Gateway>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<AgentJob>, StatusCode> {
    if !authorized(&headers, &state) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    state
        .jobs
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .get(&id)
        .cloned()
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}
async fn cancel_job(
    State(state): State<Gateway>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    if !authorized(&headers, &state) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let mut jobs = state
        .jobs
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let job = jobs.get_mut(&id).ok_or(StatusCode::NOT_FOUND)?;
    if ["queued", "running"].contains(&job.status.as_str()) {
        job.status = "cancelled".into();
    }
    let result = json!({"id":id,"status":job.status});
    save_jobs(&state, &jobs).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(result))
}
async fn models(
    State(state): State<Gateway>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    if !authorized(&headers, &state) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let models = state
        .models
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        json!({"object":"list","data":models.iter().map(|m|json!({"id":m,"object":"model","owned_by":"bionicllm"})).collect::<Vec<_>>()}),
    ))
}
async fn completion(
    State(state): State<Gateway>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    if !authorized(&headers, &state) {
        return Err((StatusCode::UNAUTHORIZED, "Não autorizado".into()));
    }
    let messages = body["messages"]
        .as_array()
        .ok_or((StatusCode::BAD_REQUEST, "messages é obrigatório".into()))?;
    if messages.iter().any(|m| {
        !m["content"].is_string()
            || !["system", "user", "assistant"].contains(&m["role"].as_str().unwrap_or(""))
    }) {
        return Err((StatusCode::BAD_REQUEST,"Esta API aceita mensagens de texto system/user/assistant. Use /tasks para execução de ferramentas.".into()));
    }
    let prompt = messages
        .iter()
        .map(|m| {
            format!(
                "{}: {}",
                m["role"].as_str().unwrap_or("user"),
                m["content"].as_str().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let model = body["model"].as_str().map(str::to_string);
    let job = enqueue(
        &state,
        Request {
            prompt,
            model: model.clone(),
            kind: Some("chat".into()),
        },
    )?;
    {
        let mut jobs = state
            .jobs
            .lock()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if let Some(queued) = jobs.get_mut(&job.id) {
            queued.messages = Some(messages.clone());
        }
        save_jobs(&state, &jobs).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    }
    if body["stream"] == true {
        let (send, recv) =
            tokio::sync::mpsc::channel::<Result<String, std::convert::Infallible>>(8);
        tokio::spawn(async move {
            let mut sent = 0;
            for _ in 0..18000 {
                let current = state
                    .jobs
                    .lock()
                    .ok()
                    .and_then(|jobs| jobs.get(&job.id).cloned());
                if let Some(current) = current {
                    let content = current.result.unwrap_or_default();
                    if !["failed", "cancelled"].contains(&current.status.as_str()) && content.len() > sent && content.is_char_boundary(sent) {
                        let delta = &content[sent..];
                        if send.send(Ok(format!("data: {}\n\n",json!({"id":job.id,"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":delta},"finish_reason":null}]})))).await.is_err(){break;}
                        sent = content.len();
                    }
                    if !["queued", "running"].contains(&current.status.as_str()) {
                        let reason = if current.status == "completed" {
                            "stop"
                        } else {
                            "error"
                        };
                        let _=send.send(Ok(format!("data: {}\n\ndata: [DONE]\n\n",json!({"id":job.id,"object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":reason}]})))).await;
                        return;
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
            if let Ok(mut jobs) = state.jobs.lock() {
                if let Some(job) = jobs.get_mut(&job.id) {
                    if ["queued", "running"].contains(&job.status.as_str()) {
                        job.status = "cancelled".into();
                    }
                }
            }
        });
        let stream = futures_util::stream::unfold(recv, |mut recv| async move {
            recv.recv().await.map(|value| (value, recv))
        });
        return Ok(axum::response::Response::builder()
            .header("Content-Type", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .body(axum::body::Body::from_stream(stream))
            .unwrap());
    }
    for _ in 0..3600 {
        let current = state
            .jobs
            .lock()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .get(&job.id)
            .cloned();
        if let Some(current) = current {
            if current.status == "completed" {
                return Ok(Json(json!({"id":job.id,"object":"chat.completion","created":0,"model":model,"choices":[{"index":0,"message":{"role":"assistant","content":current.result.unwrap_or_default()},"finish_reason":"stop"}]})).into_response());
            }
            if ["failed", "cancelled"].contains(&current.status.as_str()) {
                return Err((
                    StatusCode::BAD_GATEWAY,
                    current.result.unwrap_or(current.status),
                ));
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    Err((
        StatusCode::GATEWAY_TIMEOUT,
        format!(
            "A tarefa {} continua disponível em /tasks/{}",
            job.id, job.id
        ),
    ))
}

pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = super::system::persistent_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let token_path = dir.join("agent-token");
    let token = match std::fs::read_to_string(&token_path) {
        Ok(token) if token.trim().len() >= 32 => token.trim().to_string(),
        _ => {
            let token = format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            );
            std::fs::write(&token_path, &token).map_err(|e| e.to_string())?;
            token
        }
    };
    let journal = dir.join("agent-jobs.json");
    let mut saved: BTreeMap<String, AgentJob> = match std::fs::read(&journal) {
        Ok(b) => serde_json::from_slice(&b).map_err(|e| {
            format!("Registro de tarefas inválido; os dados foram preservados: {e}")
        })?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
        Err(e) => return Err(e.to_string()),
    };
    for job in saved
        .values_mut()
        .filter(|j| ["queued", "running"].contains(&j.status.as_str()))
    {
        job.status = "failed".into();
        job.result=Some("A execução foi interrompida pelo encerramento do aplicativo. Ações anteriores não foram repetidas.".into());
    }
    let state = Gateway {
        token,
        jobs: Arc::new(Mutex::new(saved)),
        models: Default::default(),
        enabled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        journal: Some(journal),
    };
    save_jobs(&state, &*state.jobs.lock().map_err(|e| e.to_string())?)?;
    let _ = GATEWAY.set(state.clone());
    if let Err(error) = super::agent_protocol::register_agent_protocol() {
        tracing::warn!("Registro do protocolo de agente: {error}");
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind("127.0.0.1:17863").await {
            Ok(l) => l,
            Err(e) => {
                tracing::error!("Gateway do agente: {e}");
                return;
            }
        };
        let router = Router::new()
            .route(
                "/health",
                get(|| async { Json(json!({"app":"BionicLLM Studio"})) }),
            )
            .route("/tasks", post(create_job))
            .route("/tasks/{id}", get(read_job).delete(cancel_job))
            .route("/v1/models", get(models))
            .route("/v1/chat/completions", post(completion))
            .layer(axum::extract::DefaultBodyLimit::max(1_100_000))
            .with_state(state);
        let _ = handle.emit("agent:gateway-ready", ());
        if let Err(e) = axum::serve(listener, router).await {
            tracing::error!("Gateway do agente: {e}");
        }
    });
    Ok(())
}

#[tauri::command]
pub fn agent_gateway_sync(enabled: bool, models: Vec<String>) -> Result<Vec<AgentJob>, String> {
    let state = GATEWAY.get().ok_or("Gateway indisponível")?;
    let was_enabled = state
        .enabled
        .swap(enabled, std::sync::atomic::Ordering::Relaxed);
    *state.models.lock().map_err(|e| e.to_string())? = models;
    let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    if !enabled {
        for job in jobs
            .values_mut()
            .filter(|j| ["queued", "running"].contains(&j.status.as_str()))
        {
            job.status = "cancelled".into();
        }
    }
    static INITIAL_URLS: OnceLock<()> = OnceLock::new();
    if enabled && INITIAL_URLS.set(()).is_ok() {
        // Queue startup URLs only once, after the frontend has hydrated settings.
        drop(jobs);
        for url in std::env::args().filter(|a| a.starts_with("bionicllm://")) {
            if let Err(error) = receive_url(&url) {
                tracing::warn!("{error}");
            }
        }
        jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    }
    let out = jobs
        .values()
        .filter(|j| ["queued", "cancelled"].contains(&j.status.as_str()))
        .cloned()
        .collect();
    let claimed = jobs.values().any(|j| j.status == "queued");
    for job in jobs.values_mut().filter(|j| j.status == "queued") {
        job.status = "running".into();
    }
    if claimed || was_enabled != enabled {
        save_jobs(state, &jobs)?;
    }
    Ok(out)
}
#[tauri::command]
pub fn agent_gateway_finish(
    id: String,
    status: String,
    result: String,
    conversation_id: Option<String>,
) -> Result<(), String> {
    if !["completed", "failed", "cancelled"].contains(&status.as_str()) {
        return Err("Estado inválido".into());
    }
    let state = GATEWAY.get().ok_or("Gateway indisponível")?;
    let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    if let Some(job) = jobs.get_mut(&id) {
        if job.status != "cancelled" {
            job.status = status;
            job.result = Some(result);
            job.conversation_id = conversation_id;
        }
    }
    save_jobs(state, &jobs)?;
    Ok(())
}
#[tauri::command]
pub fn agent_gateway_progress(id: String, result: String) -> Result<(), String> {
    let state = GATEWAY.get().ok_or("Gateway indisponível")?;
    if let Some(job) = state.jobs.lock().map_err(|e| e.to_string())?.get_mut(&id) {
        if job.status == "running" {
            job.result = Some(result);
        }
    }
    Ok(())
}
#[tauri::command]
pub fn desktop_notify(
    app: tauri::AppHandle,
    title: String,
    body: String,
    conversation_id: Option<String>,
) -> Result<(), String> {
    // Native visibility/focus is authoritative even if document.hidden is stale.
    let hidden = app.get_webview_window("main").is_some_and(|w| {
        !w.is_visible().unwrap_or(true)
            || w.is_minimized().unwrap_or(false)
            || !w.is_focused().unwrap_or(true)
    });
    if hidden {
        #[cfg(windows)]
        {
            // Register an unpackaged application's identity; no installer is needed.
            let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
            if let Ok((key, _)) =
                hkcu.create_subkey("Software\\Classes\\AppUserModelId\\com.bionicllm.studio")
            {
                let _ = key.set_value("DisplayName", &"BionicLLM Studio");
                let _ = key.set_value("ShowInSettings", &1u32);
            }
            let handle = notify_rust::Notification::new()
                .app_id("com.bionicllm.studio")
                .summary(&title)
                .body(&body)
                .action("open", "Abrir resultado")
                .show()
                .map_err(|e| e.to_string())?;
            std::thread::spawn(move || {
                let _ = handle.wait_for_response(
                    move |response: &notify_rust::NotificationResponse| {
                        if matches!(
                            response,
                            notify_rust::NotificationResponse::Default
                                | notify_rust::NotificationResponse::Action(_)
                        ) {
                            allow_show();
                            let _ = app.emit("notification:open", conversation_id);
                            crate::onboarding_window::bring_to_front(&app);
                        }
                    },
                );
            });
        }
        #[cfg(not(windows))]
        {
            use tauri_plugin_notification::NotificationExt;
            let _ = conversation_id;
            app.notification()
                .builder()
                .title(title)
                .body(body)
                .show()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn receive_url(url: &str) -> Result<String, String> {
    let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "bionicllm" {
        return Err("Protocolo inválido".into());
    }
    let prompt = parsed
        .query_pairs()
        .find(|(k, _)| ["prompt", "mensagem", "texto"].contains(&k.as_ref()))
        .map(|(_, v)| v.into_owned())
        .ok_or("Informe prompt na URL")?;
    let state = GATEWAY.get().ok_or("Gateway ainda inicializando")?;
    if !state.enabled.load(std::sync::atomic::Ordering::Relaxed) {
        return Err("Habilite o agente externo em Configurações".into());
    }
    enqueue(
        state,
        Request {
            prompt,
            model: None,
            kind: Some(parsed.host_str().unwrap_or("agent").to_string()),
        },
    )
    .map(|j| j.id)
    .map_err(|(_, e)| e)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn gateway() -> Gateway {
        Gateway {
            token: "test-secret".into(),
            jobs: Default::default(),
            models: Default::default(),
            enabled: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            journal: None,
        }
    }
    #[test]
    fn local_api_requires_the_token_and_respects_disable() {
        let state = gateway();
        let mut headers = HeaderMap::new();
        assert!(!authorized(&headers, &state));
        headers.insert("authorization", "Bearer test-secret".parse().unwrap());
        assert!(authorized(&headers, &state));
        state
            .enabled
            .store(false, std::sync::atomic::Ordering::Relaxed);
        assert!(!authorized(&headers, &state));
    }
    #[test]
    fn queue_is_bounded_and_empty_requests_do_not_start_work() {
        let state = gateway();
        assert!(enqueue(
            &state,
            Request {
                prompt: " ".into(),
                model: None,
                kind: None
            }
        )
        .is_err());
        for _ in 0..8 {
            assert!(enqueue(
                &state,
                Request {
                    prompt: "task".into(),
                    model: None,
                    kind: None
                }
            )
            .is_ok());
        }
        assert_eq!(
            enqueue(
                &state,
                Request {
                    prompt: "task".into(),
                    model: None,
                    kind: None
                }
            )
            .err()
            .unwrap()
            .0,
            StatusCode::TOO_MANY_REQUESTS
        );
    }
    #[test]
    fn submitted_tasks_are_durable_before_becoming_visible() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = gateway();
        state.journal = Some(dir.path().join("tasks.json"));
        let task = enqueue(
            &state,
            Request {
                prompt: "saved task".into(),
                model: Some("default".into()),
                kind: None,
            },
        )
        .unwrap();
        let saved: BTreeMap<String, AgentJob> =
            serde_json::from_slice(&std::fs::read(state.journal.unwrap()).unwrap()).unwrap();
        assert_eq!(saved[&task.id].prompt, "saved task");
        assert_eq!(saved[&task.id].status, "queued");
    }
    #[tokio::test]
    async fn cancelling_a_job_preserves_its_id_and_exposes_terminal_state() {
        let state = gateway();
        let job = enqueue(
            &state,
            Request {
                prompt: "task".into(),
                model: None,
                kind: None,
            },
        )
        .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Bearer test-secret".parse().unwrap());
        cancel_job(State(state.clone()), headers.clone(), Path(job.id.clone()))
            .await
            .unwrap();
        let current = read_job(State(state), headers, Path(job.id.clone()))
            .await
            .unwrap()
            .0;
        assert_eq!(current.id, job.id);
        assert_eq!(current.status, "cancelled");
    }
}

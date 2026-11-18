mod api;
use crate::commands::{
    connector_requests::{cancel_group, cancel_request, Request},
    review_actions::{Draft, Entry, Journal, Phase},
};
use api::{Credentials, Identity, Post};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;
const GROUP: &str = "facebook-page";
const VAULT_ACCOUNT: &str = "facebook-page-credentials";
static OPERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
#[derive(Deserialize, Serialize)]
struct Saved {
    credentials: Credentials,
    identity: Identity,
    binding: String,
    enabled: bool,
}
#[derive(Serialize)]
pub struct Status {
    configured: bool,
    identity: Option<Identity>,
    enabled: bool,
    publishing: bool,
}
type PostDraft = Draft<Post>;
type PostJournal = Journal<Post>;
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Configure o Facebook na janela principal.".into())
    }
}
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn vault(write: Option<Option<&str>>) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new("com.bionicllm.studio.connectors", VAULT_ACCOUNT)
        .map_err(|_| "Cofre do sistema indisponível.".to_string())?;
    match write {
        None => match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Não foi possível ler a conexão Facebook no cofre.".into()),
        },
        Some(Some(value)) => {
            if value.encode_utf16().count() > 1250 {
                return Err("A credencial Facebook excedeu o tamanho suportado pelo cofre. A conexão anterior foi preservada.".into());
            }
            entry
                .set_password(value)
                .map_err(|_| "Não foi possível salvar a conexão Facebook no cofre.".to_string())?;
            Ok(None)
        }
        Some(None) => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Não foi possível remover a conexão Facebook local.".into()),
        },
    }
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn vault(_: Option<Option<&str>>) -> Result<Option<String>, String> {
    Err("Este conector requer o cofre do Windows ou macOS.".into())
}
async fn load() -> Result<Option<Saved>, String> {
    let text = tokio::task::spawn_blocking(|| vault(None))
        .await
        .map_err(|_| "Leitura do cofre interrompida.".to_string())??;
    let saved: Option<Saved> = text
        .map(|v| {
            serde_json::from_str(&v).map_err(|_| {
                "Conexão Facebook local inválida. Remova-a e verifique novamente.".to_string()
            })
        })
        .transpose()?;
    if let Some(ref s) = saved {
        s.credentials.validate()?;
        if s.identity.id != s.credentials.page_id || uuid::Uuid::parse_str(&s.binding).is_err() {
            return Err("Identidade Facebook local inválida.".into());
        }
    }
    Ok(saved)
}
async fn save(saved: Option<Saved>) -> Result<(), String> {
    let value = saved
        .map(|s| {
            serde_json::to_string(&s)
                .map_err(|_| "Não foi possível preparar a conexão Facebook.".to_string())
        })
        .transpose()?;
    tokio::task::spawn_blocking(move || vault(Some(value.as_deref())).map(|_| ()))
        .await
        .map_err(|_| "Gravação no cofre interrompida.".to_string())?
}
fn status(saved: Option<Saved>) -> Status {
    saved
        .map(|s| Status {
            configured: true,
            enabled: s.enabled,
            publishing: s.credentials.publishing,
            identity: Some(s.identity),
        })
        .unwrap_or(Status {
            configured: false,
            enabled: false,
            publishing: false,
            identity: None,
        })
}
async fn enabled(write: bool) -> Result<Saved, String> {
    load().await?.filter(|s| s.enabled && (!write || s.credentials.publishing)).ok_or_else(|| "Verifique e ative a Página no conector Facebook. Para publicar, habilite também publicações com revisão.".into())
}
fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "Pasta Facebook indisponível.".to_string())?
        .join("connectors/facebook/actions.json"))
}
#[tauri::command]
pub async fn studio_facebook_status(window: tauri::WebviewWindow) -> Result<Status, String> {
    main_only(&window)?;
    Ok(status(load().await?))
}
#[tauri::command]
pub async fn studio_facebook_verify(
    window: tauri::WebviewWindow,
    input: Option<Credentials>,
    request_id: String,
) -> Result<Status, String> {
    main_only(&window)?;
    if let Some(ref input) = input {
        input.validate()?;
    }
    let request = Request::new(request_id, GROUP)?;
    let _lock = tokio::select! { biased; _ = request.cancel.cancelled() => return Err("Operação Facebook cancelada.".into()), lock = OPERATION.lock() => lock };
    request.check()?;
    let previous = load().await?;
    let replacing = input.is_some();
    let credentials = input
        .or_else(|| previous.as_ref().map(|s| s.credentials.clone()))
        .ok_or("Configure a Página primeiro.")?;
    let identity = api::verify(&credentials, &request.cancel).await?;
    let saved = Saved {
        credentials,
        identity,
        binding: if replacing {
            uuid::Uuid::new_v4().to_string()
        } else {
            previous.as_ref().unwrap().binding.clone()
        },
        enabled: !replacing && previous.as_ref().is_some_and(|s| s.enabled),
    };
    request.check()?;
    save(Some(saved)).await?;
    Ok(status(load().await?))
}
#[tauri::command]
pub fn studio_facebook_cancel(
    window: tauri::WebviewWindow,
    request_id: String,
) -> Result<(), String> {
    main_only(&window)?;
    cancel_request(request_id)
}
#[tauri::command]
pub async fn studio_facebook_update(
    window: tauri::WebviewWindow,
    enabled: Option<bool>,
) -> Result<Status, String> {
    main_only(&window)?;
    cancel_group(GROUP);
    let _lock = OPERATION.lock().await;
    if let Some(enabled) = enabled {
        let mut saved = load().await?.ok_or("Configure a Página primeiro.")?;
        saved.enabled = enabled;
        save(Some(saved)).await?;
    } else {
        save(None).await?;
    }
    Ok(status(load().await?))
}
#[tauri::command]
pub async fn studio_facebook_posts(
    window: tauri::WebviewWindow,
    request_id: String,
) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    let request = Request::new(request_id, GROUP)?;
    let _lock = tokio::select! { biased; _ = request.cancel.cancelled() => return Err("Operação Facebook cancelada.".into()), lock = OPERATION.lock() => lock };
    request.check()?;
    let result = api::posts(&enabled(false).await?.credentials, &request.cancel).await?;
    request.check()?;
    Ok(result)
}
#[tauri::command]
pub async fn studio_facebook_drafts(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Vec<PostDraft>, String> {
    main_only(&window)?;
    Ok(PostJournal::load(&path(&app)?)?.views())
}
#[tauri::command]
pub async fn studio_facebook_prepare(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    input: Post,
    request_id: String,
) -> Result<PostDraft, String> {
    main_only(&window)?;
    input.validate()?;
    let request = Request::new(request_id, GROUP)?;
    let _lock = tokio::select! { biased; _ = request.cancel.cancelled() => return Err("Operação Facebook cancelada.".into()), lock = OPERATION.lock() => lock };
    let saved = enabled(true).await?;
    let file = path(&app)?;
    let mut journal = PostJournal::load(&file)?;
    if journal.entries.len() >= 20 {
        return Err("Revise os vinte registros Facebook e remova registros antigos antes de preparar outro.".into());
    }
    let draft = Draft {
        id: uuid::Uuid::new_v4().to_string(),
        account: saved.identity.id,
        input,
        phase: Phase::Pending,
        created_at: chrono::Utc::now().timestamp(),
        remote_id: None,
    };
    journal.entries.push(Entry {
        binding: saved.binding,
        draft: draft.clone(),
    });
    request.check()?;
    journal.save(&file)?;
    Ok(draft)
}
#[tauri::command]
pub async fn studio_facebook_discard(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<Vec<PostDraft>, String> {
    main_only(&window)?;
    let _lock = OPERATION.lock().await;
    let file = path(&app)?;
    let mut journal = PostJournal::load(&file)?;
    journal.entries.retain(|e| e.draft.id != id);
    journal.save(&file)?;
    Ok(journal.views())
}
#[tauri::command]
pub async fn studio_facebook_publish(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
    request_id: String,
) -> Result<Vec<PostDraft>, String> {
    main_only(&window)?;
    let request = Request::new(request_id, GROUP)?;
    let _lock = tokio::select! { biased; _ = request.cancel.cancelled() => return Err("Operação Facebook cancelada.".into()), lock = OPERATION.lock() => lock };
    let saved = enabled(true).await?;
    let file = path(&app)?;
    let mut journal = PostJournal::load(&file)?;
    let (post, _) = journal.begin(&id, &saved.identity.id, &saved.binding)?;
    api::verify(&saved.credentials, &request.cancel).await?;
    let outbound = api::publish_request(&saved.credentials, &post)?;
    request.check()?;
    journal.save(&file)?;
    let result = api::request(outbound, &request.cancel)
        .await
        .and_then(|value| api::receipt(&value, &saved.identity.id));
    match result {
        Ok(remote_id) => { let entry = journal.entries.iter_mut().find(|e| e.draft.id == id).ok_or("Registro Facebook indisponível.")?; entry.draft.phase = Phase::Done; entry.draft.remote_id = Some(remote_id); journal.save(&file).map_err(|_| "O Facebook confirmou a publicação, mas o registro local não pôde ser salvo. Confira na Página e não repita.".to_string())?; Ok(journal.views()) },
        Err(error) => Err(format!("{error} Resultado potencialmente incerto. Confira na Página antes de preparar outra publicação; este registro não será reenviado.")),
    }
}

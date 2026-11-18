//! YouTube shares Google desktop OAuth; media selection and reviewed uploads belong here.
mod api;
use super::{api as google, main_only, Request, Service, OPERATION};
use crate::commands::connector_media as files;
use crate::commands::review_actions::{Draft, Entry, Journal, Phase, ReviewInput};
pub use api::channel;
use files::Media;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;
use tokio_util::sync::CancellationToken;
#[derive(Clone, Deserialize, Serialize)]
pub struct Channel {
    pub id: String,
    pub title: String,
    pub uploads: String,
}
#[derive(Serialize)]
pub struct Status {
    configured: bool,
    email: Option<String>,
    enabled: bool,
    publishing: bool,
    channel: Option<Channel>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Upload {
    pub file_id: String,
    pub title: String,
    pub description: String,
    pub category_id: String,
    pub privacy: String,
    pub made_for_kids: bool,
    pub contains_synthetic_media: bool,
    pub intended_short: bool,
}
impl Upload {
    pub fn validate(&self) -> Result<(), String> {
        if !files::valid_id(&self.file_id)
            || self.title.trim().is_empty()
            || self.title.chars().count() > 100
            || self.title.chars().any(char::is_control)
            || self.title.contains(['<', '>'])
            || self.description.len() > 5000
            || self.description.contains(['\0', '<', '>'])
            || self.category_id.is_empty()
            || self.category_id.len() > 3
            || !self.category_id.bytes().all(|b| b.is_ascii_digit())
            || !["private", "unlisted", "public"].contains(&self.privacy.as_str())
        {
            return Err("Confira o vídeo selecionado, título até 100 caracteres, descrição até 5.000 bytes sem < ou >, categoria numérica e visibilidade.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Proposal {
    pub metadata: Upload,
    pub file: Media,
}
impl ReviewInput for Proposal {
    fn validate(&self) -> Result<(), String> {
        self.metadata.validate()?;
        self.file.validate()?;
        if self.metadata.file_id != self.file.id {
            return Err("O vídeo do rascunho não corresponde ao arquivo selecionado.".into());
        }
        Ok(())
    }
    fn valid_account(&self, account: &str) -> bool {
        api::channel_id(account)
    }
}
type VideoDraft = Draft<Proposal>;
type VideoJournal = Journal<Proposal>;
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "Pasta YouTube indisponível.")?
        .join("connectors/youtube"))
}
async fn authorized(
    write: bool,
    cancel: &CancellationToken,
) -> Result<(String, super::Connection, Channel), String> {
    let saved = super::enabled_connection(Service::Youtube, write).await?;
    let expected = saved
        .youtube_channel
        .as_ref()
        .ok_or("Autorize o canal YouTube novamente.")?;
    let token = super::fresh_access(Service::Youtube, cancel, write).await?;
    let identity = google::identity(&token, cancel).await?;
    let current = channel(&token, cancel).await?;
    same_channel(&saved.email, &expected.id, &identity, &current.id)?;
    Ok((token, saved, current))
}
fn same_channel(
    expected_email: &str,
    expected_channel: &str,
    email: &str,
    channel: &str,
) -> Result<(), String> {
    if expected_email != email || expected_channel != channel {
        return Err(
            "A conta ou canal YouTube mudou. Autorize novamente e prepare outro rascunho.".into(),
        );
    }
    Ok(())
}
#[tauri::command]
pub async fn studio_youtube_status(window: tauri::WebviewWindow) -> Result<Status, String> {
    main_only(&window)?;
    let saved = super::connection(Service::Youtube).await?;
    Ok(Status {
        configured: super::read_vault(super::CLIENT).await?.is_some(),
        email: saved.as_ref().map(|v| v.email.clone()),
        enabled: saved.as_ref().is_some_and(|v| v.enabled),
        publishing: saved.as_ref().is_some_and(|v| v.write_access),
        channel: saved.and_then(|v| v.youtube_channel),
    })
}
#[tauri::command]
pub async fn studio_youtube_videos(
    window: tauri::WebviewWindow,
    request_id: String,
) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    let request = Request::new(request_id, Service::Youtube.key())?;
    let _lock = tokio::select! { biased; _ = request.cancel.cancelled() => return Err("Operação YouTube cancelada.".into()), lock = OPERATION.lock() => lock };
    let (token, _, current) = authorized(false, &request.cancel).await?;
    let result = api::videos(&token, &current, &request.cancel).await?;
    request.check()?;
    Ok(result)
}
#[tauri::command]
pub async fn studio_youtube_files(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Vec<Media>, String> {
    main_only(&window)?;
    Ok(files::list(&root(&app)?.join("files"))?)
}
#[tauri::command]
pub async fn studio_youtube_inventory(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    request_id: String,
) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    let request = Request::new(request_id, Service::Youtube.key())?;
    let _lock = tokio::select! { biased; _ = request.cancel.cancelled() => return Err("Operação YouTube cancelada.".into()), lock = OPERATION.lock() => lock };
    let saved = super::enabled_connection(Service::Youtube, false).await?;
    let channel = saved
        .youtube_channel
        .ok_or("Autorize o canal YouTube novamente.")?;
    let files = files::list(&root(&app)?.join("files"))?;
    request.check()?;
    Ok(serde_json::json!({ "channel": channel, "files": files }))
}
#[tauri::command]
pub async fn studio_youtube_pick(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    request_id: String,
) -> Result<Option<Media>, String> {
    main_only(&window)?;
    let request = Request::new(request_id, Service::Youtube.key())?;
    let _lock = tokio::select! { biased; _ = request.cancel.cancelled() => return Err("Seleção YouTube cancelada.".into()), lock = OPERATION.lock() => lock };
    super::enabled_connection(Service::Youtube, true).await?;
    request.check()?;
    let picked = tokio::select! {
        biased;
        _ = request.cancel.cancelled() => return Err("Seleção YouTube cancelada.".into()),
        value = rfd::AsyncFileDialog::new().set_title("Selecionar vídeo para o YouTube").add_filter("Vídeos", &["mp4", "mov", "webm", "mkv"]).pick_file() => value,
    };
    let Some(picked) = picked else {
        return Ok(None);
    };
    let root = root(&app)?.join("files");
    let source = picked.path().to_path_buf();
    let cancel = request.cancel.clone();
    let selected = tokio::task::spawn_blocking(move || files::snapshot(&root, &source, &cancel))
        .await
        .map_err(|_| "Cópia de vídeo interrompida.")??;
    request.check()?;
    Ok(Some(selected))
}
#[tauri::command]
pub async fn studio_youtube_remove_file(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<Vec<Media>, String> {
    main_only(&window)?;
    let _lock = OPERATION.lock().await;
    let path = root(&app)?.join("files");
    files::remove(&path, &id)?;
    files::list(&path)
}
#[tauri::command]
pub async fn studio_youtube_drafts(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Vec<VideoDraft>, String> {
    main_only(&window)?;
    Ok(VideoJournal::load(&root(&app)?.join("actions.json"))?.views())
}
#[tauri::command]
pub async fn studio_youtube_prepare(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    input: Upload,
    request_id: String,
) -> Result<VideoDraft, String> {
    main_only(&window)?;
    input.validate()?;
    let request = Request::new(request_id, Service::Youtube.key())?;
    let _lock = tokio::select! { biased; _ = request.cancel.cancelled() => return Err("Operação YouTube cancelada.".into()), lock = OPERATION.lock() => lock };
    let (_, saved, current) = authorized(true, &request.cancel).await?;
    let folder = root(&app)?;
    let file = files::get(&folder.join("files"), &input.file_id)?;
    let mut journal = VideoJournal::load(&folder.join("actions.json"))?;
    if journal.entries.len() >= 20 {
        return Err("Revise e remova registros antigos dos vinte rascunhos YouTube antes de preparar outro.".into());
    }
    let draft = Draft {
        id: uuid::Uuid::new_v4().to_string(),
        account: current.id,
        input: Proposal {
            metadata: input,
            file,
        },
        phase: Phase::Pending,
        created_at: chrono::Utc::now().timestamp(),
        remote_id: None,
    };
    journal.entries.push(Entry {
        binding: saved.binding,
        draft: draft.clone(),
    });
    request.check()?;
    journal.save(&folder.join("actions.json"))?;
    Ok(draft)
}
#[tauri::command]
pub async fn studio_youtube_discard(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<Vec<VideoDraft>, String> {
    main_only(&window)?;
    let _lock = OPERATION.lock().await;
    let path = root(&app)?.join("actions.json");
    let mut journal = VideoJournal::load(&path)?;
    journal.entries.retain(|e| e.draft.id != id);
    journal.save(&path)?;
    Ok(journal.views())
}
#[tauri::command]
pub async fn studio_youtube_upload(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
    request_id: String,
) -> Result<Vec<VideoDraft>, String> {
    main_only(&window)?;
    let request = Request::new(request_id, Service::Youtube.key())?;
    let _lock = tokio::select! { biased; _ = request.cancel.cancelled() => return Err("Envio YouTube cancelado.".into()), lock = OPERATION.lock() => lock };
    let (token, saved, current) = authorized(true, &request.cancel).await?;
    let folder = root(&app)?;
    let path = folder.join("actions.json");
    let mut journal = VideoJournal::load(&path)?;
    let (proposal, _) = journal.begin(&id, &current.id, &saved.binding)?;
    let media = proposal.file.clone();
    let cancel = request.cancel.clone();
    let file = tokio::task::spawn_blocking(move || {
        files::checked_file(&folder.join("files"), &media, &cancel)
    })
    .await
    .map_err(|_| "Conferência de vídeo interrompida.")??;
    request.check()?;
    // Disk acknowledgement precedes even session creation; retries are never implicit.
    journal.save(&path)?;
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(1260),
        api::upload(
            &proposal.metadata,
            &proposal.file,
            file,
            &token,
            &current.id,
            &request.cancel,
        ),
    )
    .await
    .map_err(|_| "Tempo limite do envio YouTube atingido.".to_string())
    .and_then(|v| v);
    match result {
        Ok(remote_id) => {
            let entry = journal.entries.iter_mut().find(|e| e.draft.id == id).ok_or("Registro YouTube indisponível.")?;
            entry.draft.phase = Phase::Done; entry.draft.remote_id = Some(remote_id);
            journal.save(&path).map_err(|_| "O YouTube confirmou o envio, mas o registro local não foi salvo. Confira o canal e não repita.".to_string())?;
            Ok(journal.views())
        },
        Err(error) => Err(format!("{error} Resultado potencialmente incerto. Confira o YouTube; este registro não será reenviado automaticamente.")),
    }
}
#[cfg(test)]
mod tests;

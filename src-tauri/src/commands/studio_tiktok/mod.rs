mod api;
use crate::commands::{
    connector_media as files,
    connector_requests::{cancel_group, cancel_request, Request},
    review_actions::{Draft, Entry, Journal, Phase, ReviewInput},
};
use api::{Credentials, Identity};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;
const GROUP: &str = "tiktok-inbox";
const ACCOUNT: &str = "tiktok-inbox-credentials";
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
    enabled: bool,
    uploading: bool,
    read_videos: bool,
    identity: Option<Identity>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub file_id: String,
    pub note: String,
}
impl Input {
    pub fn validate(&self) -> Result<(), String> {
        if !files::valid_id(&self.file_id)
            || self.note.encode_utf16().count() > 2200
            || self.note.contains('\0')
        {
            return Err(
                "Escolha um vídeo no painel TikTok e use até 2.200 caracteres nas notas locais."
                    .into(),
            );
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Proposal {
    pub metadata: Input,
    pub file: files::Media,
}
impl ReviewInput for Proposal {
    fn validate(&self) -> Result<(), String> {
        self.metadata.validate()?;
        api::supported(&self.file)?;
        if self.metadata.file_id != self.file.id {
            return Err("O vídeo do rascunho TikTok mudou.".into());
        }
        Ok(())
    }
    fn valid_account(&self, account: &str) -> bool {
        api::identifier(account)
    }
}
type VideoDraft = Draft<Proposal>;
type VideoJournal = Journal<Proposal>;
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Configure o TikTok na janela principal.".into())
    }
}
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn vault(value: Option<Option<&str>>) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new("com.bionicllm.studio.connectors", ACCOUNT)
        .map_err(|_| "Cofre do sistema indisponível.")?;
    match value {
        None => match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Não foi possível ler a conexão TikTok no cofre.".into()),
        },
        Some(Some(value)) => {
            if value.encode_utf16().count() > 1250 {
                return Err("A autorização TikTok excedeu o tamanho do cofre. A conexão local anterior foi preservada; se o token foi renovado, autorize novamente pelo seu aplicativo.".into());
            }
            entry.set_password(value).map_err(|_|"Não foi possível salvar a autorização TikTok. Se houve rotação de token, obtenha uma nova autorização antes de continuar.")?;
            Ok(None)
        }
        Some(None) => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Não foi possível remover a conexão TikTok local.".into()),
        },
    }
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn vault(_: Option<Option<&str>>) -> Result<Option<String>, String> {
    Err("O conector TikTok requer o cofre do Windows ou macOS.".into())
}
async fn load() -> Result<Option<Saved>, String> {
    let value = tokio::task::spawn_blocking(|| vault(None))
        .await
        .map_err(|_| "Leitura do cofre interrompida.")??;
    let saved: Option<Saved> = value
        .map(|v| {
            serde_json::from_str(&v).map_err(|_| {
                "Conexão TikTok local inválida. Remova e configure novamente.".to_string()
            })
        })
        .transpose()?;
    if let Some(ref s) = saved {
        s.credentials.validate()?;
        if !api::identifier(&s.identity.open_id) || uuid::Uuid::parse_str(&s.binding).is_err() {
            return Err("Identidade TikTok local inválida.".into());
        }
    }
    Ok(saved)
}
async fn save(value: Option<Saved>) -> Result<(), String> {
    let value = value
        .map(|v| {
            serde_json::to_string(&v)
                .map_err(|_| "Não foi possível preparar a autorização TikTok.".to_string())
        })
        .transpose()?;
    tokio::task::spawn_blocking(move || vault(Some(value.as_deref())).map(|_| ()))
        .await
        .map_err(|_| "Gravação no cofre interrompida.")?
}
fn status(value: Option<Saved>) -> Status {
    match value {
        Some(s) => Status {
            configured: true,
            enabled: s.enabled,
            uploading: s.credentials.uploading,
            read_videos: s.credentials.read_videos,
            identity: Some(s.identity),
        },
        None => Status {
            configured: false,
            enabled: false,
            uploading: false,
            read_videos: false,
            identity: None,
        },
    }
}
async fn enabled(write: bool) -> Result<Saved, String> {
    load().await?.filter(|s|s.enabled&&(!write||s.credentials.uploading)).ok_or_else(||"Verifique e ative o conector TikTok. Para enviar vídeos, habilite também os envios para a caixa de entrada.".into())
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "Pasta TikTok indisponível.")?
        .join("connectors/tiktok"))
}
async fn renew(saved: Saved, request: &Request) -> Result<(String, Saved), String> {
    let tokens = api::refresh(&saved.credentials, &request.cancel).await?;
    if tokens.open_id != saved.identity.open_id {
        return Err(
            "A conta TikTok mudou. Verifique e salve novamente antes de preparar outro rascunho."
                .into(),
        );
    }
    let mut saved = saved;
    if saved.credentials.refresh_token != tokens.refresh {
        saved.credentials.refresh_token = tokens.refresh;
        // Preserve a rotated refresh token before any subsequent query can fail or be cancelled.
        save(Some(saved)).await?;
        saved = load().await?.ok_or("Autorização TikTok indisponível.")?;
    }
    request.check()?;
    let identity = api::identity(&tokens.access, &saved.identity.open_id, &request.cancel).await?;
    if identity.display_name != saved.identity.display_name {
        saved.identity = identity;
        save(Some(saved)).await?;
        saved = load().await?.ok_or("Autorização TikTok indisponível.")?;
    }
    request.check()?;
    Ok((tokens.access, saved))
}
#[tauri::command]
pub async fn studio_tiktok_status(window: tauri::WebviewWindow) -> Result<Status, String> {
    main_only(&window)?;
    Ok(status(load().await?))
}
#[tauri::command]
pub fn studio_tiktok_cancel(
    window: tauri::WebviewWindow,
    request_id: String,
) -> Result<(), String> {
    main_only(&window)?;
    cancel_request(request_id)
}
#[tauri::command]
pub async fn studio_tiktok_verify(
    window: tauri::WebviewWindow,
    input: Option<Credentials>,
    request_id: String,
) -> Result<Status, String> {
    main_only(&window)?;
    if let Some(ref input) = input {
        input.validate()?;
    }
    let request = Request::new(request_id, GROUP)?;
    let _lock = tokio::select! {biased;_=request.cancel.cancelled()=>return Err("Operação TikTok cancelada.".into()),lock=OPERATION.lock()=>lock};
    request.check()?;
    if let Some(mut credentials) = input {
        let tokens = api::refresh(&credentials, &request.cancel).await?;
        let identity = api::identity(&tokens.access, &tokens.open_id, &request.cancel).await?;
        credentials.refresh_token = tokens.refresh;
        request.check()?;
        save(Some(Saved {
            credentials,
            identity,
            binding: uuid::Uuid::new_v4().to_string(),
            enabled: false,
        }))
        .await?;
    } else {
        renew(
            load().await?.ok_or("Configure o TikTok primeiro.")?,
            &request,
        )
        .await?;
    }
    Ok(status(load().await?))
}
#[tauri::command]
pub async fn studio_tiktok_update(
    window: tauri::WebviewWindow,
    enabled: Option<bool>,
) -> Result<Status, String> {
    main_only(&window)?;
    cancel_group(GROUP);
    let _lock = OPERATION.lock().await;
    if let Some(enabled) = enabled {
        let mut saved = load().await?.ok_or("Configure o TikTok primeiro.")?;
        saved.enabled = enabled;
        save(Some(saved)).await?;
    } else {
        save(None).await?;
    }
    Ok(status(load().await?))
}
#[tauri::command]
pub async fn studio_tiktok_videos(
    window: tauri::WebviewWindow,
    request_id: String,
) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    let request = Request::new(request_id, GROUP)?;
    let _lock = tokio::select! {biased;_=request.cancel.cancelled()=>return Err("Operação TikTok cancelada.".into()),lock=OPERATION.lock()=>lock};
    let saved = enabled(false).await?;
    if !saved.credentials.read_videos {
        return Err("A consulta de vídeos públicos não está habilitada. Verifique a permissão video.list ao salvar.".into());
    }
    let (access, _) = renew(saved, &request).await?;
    let result = api::videos(&access, &request.cancel).await?;
    request.check()?;
    Ok(result)
}
#[tauri::command]
pub async fn studio_tiktok_inventory(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    request_id: String,
) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    let request = Request::new(request_id, GROUP)?;
    let _lock = tokio::select! {biased;_=request.cancel.cancelled()=>return Err("Operação TikTok cancelada.".into()),lock=OPERATION.lock()=>lock};
    let saved = enabled(false).await?;
    let files = files::list(&root(&app)?.join("files"))?;
    request.check()?;
    Ok(serde_json::json!({"identity":saved.identity,"files":files}))
}
#[tauri::command]
pub async fn studio_tiktok_files(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Vec<files::Media>, String> {
    main_only(&window)?;
    files::list(&root(&app)?.join("files"))
}
#[tauri::command]
pub async fn studio_tiktok_pick(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    request_id: String,
) -> Result<Option<files::Media>, String> {
    main_only(&window)?;
    let request = Request::new(request_id, GROUP)?;
    let _lock = tokio::select! {biased;_=request.cancel.cancelled()=>return Err("Seleção TikTok cancelada.".into()),lock=OPERATION.lock()=>lock};
    enabled(true).await?;
    request.check()?;
    let picked = tokio::select! {biased;_=request.cancel.cancelled()=>return Err("Seleção TikTok cancelada.".into()),value=rfd::AsyncFileDialog::new().set_title("Selecionar vídeo para o TikTok").add_filter("Vídeos",&["mp4","mov","webm"]).pick_file()=>value};
    let Some(picked) = picked else {
        return Ok(None);
    };
    let source = picked.path().to_path_buf();
    if !source
        .extension()
        .and_then(|v| v.to_str())
        .is_some_and(|v| ["mp4", "mov", "webm"].contains(&v.to_ascii_lowercase().as_str()))
    {
        return Err("Escolha MP4, MOV ou WebM para o TikTok.".into());
    }
    let folder = root(&app)?.join("files");
    let cancel = request.cancel.clone();
    let media = tokio::task::spawn_blocking(move || files::snapshot(&folder, &source, &cancel))
        .await
        .map_err(|_| "Cópia do vídeo TikTok interrompida.")??;
    api::supported(&media)?;
    request.check()?;
    Ok(Some(media))
}
#[tauri::command]
pub async fn studio_tiktok_remove_file(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<Vec<files::Media>, String> {
    main_only(&window)?;
    let _lock = OPERATION.lock().await;
    let folder = root(&app)?.join("files");
    files::remove(&folder, &id)?;
    files::list(&folder)
}
#[tauri::command]
pub async fn studio_tiktok_drafts(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Vec<VideoDraft>, String> {
    main_only(&window)?;
    Ok(VideoJournal::load(&root(&app)?.join("actions.json"))?.views())
}
#[tauri::command]
pub async fn studio_tiktok_prepare(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    input: Input,
    request_id: String,
) -> Result<VideoDraft, String> {
    main_only(&window)?;
    input.validate()?;
    let request = Request::new(request_id, GROUP)?;
    let _lock = tokio::select! {biased;_=request.cancel.cancelled()=>return Err("Operação TikTok cancelada.".into()),lock=OPERATION.lock()=>lock};
    let (_, saved) = renew(enabled(true).await?, &request).await?;
    let folder = root(&app)?;
    let file = files::get(&folder.join("files"), &input.file_id)?;
    api::supported(&file)?;
    let mut journal = VideoJournal::load(&folder.join("actions.json"))?;
    if journal.entries.len() >= 20 {
        return Err(
            "Remova registros antigos dos vinte rascunhos TikTok para preparar outro.".into(),
        );
    }
    let draft = Draft {
        id: uuid::Uuid::new_v4().to_string(),
        account: saved.identity.open_id,
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
pub async fn studio_tiktok_discard(
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
pub async fn studio_tiktok_upload(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
    request_id: String,
) -> Result<Vec<VideoDraft>, String> {
    main_only(&window)?;
    let request = Request::new(request_id, GROUP)?;
    let _lock = tokio::select! {biased;_=request.cancel.cancelled()=>return Err("Envio TikTok cancelado.".into()),lock=OPERATION.lock()=>lock};
    let (access, saved) = renew(enabled(true).await?, &request).await?;
    let folder = root(&app)?;
    let path = folder.join("actions.json");
    let mut journal = VideoJournal::load(&path)?;
    let (proposal, _) = journal.begin(&id, &saved.identity.open_id, &saved.binding)?;
    let media = proposal.file.clone();
    let cancel = request.cancel.clone();
    let file = tokio::task::spawn_blocking(move || {
        files::checked_file(&folder.join("files"), &media, &cancel)
    })
    .await
    .map_err(|_| "Conferência do vídeo TikTok interrompida.")??;
    request.check()?;
    journal.save(&path)?;
    let result = async {
        let (publish_id, url) = api::init(&proposal.file, &access, &request.cancel).await?;
        let entry = journal
            .entries
            .iter_mut()
            .find(|e| e.draft.id == id)
            .ok_or("Registro TikTok indisponível.")?;
        entry.draft.remote_id = Some(publish_id);
        journal.save(&path).map_err(|_|"O TikTok iniciou o processamento, mas seu ID não pôde ser salvo. O envio foi interrompido.".to_string())?;
        api::transfer(&proposal.file, file, url, &request.cancel).await
    };
    let result = tokio::time::timeout(std::time::Duration::from_secs(1260), result)
        .await
        .map_err(|_| "Tempo limite do envio TikTok atingido.".to_string())
        .and_then(|v| v);
    match result{Ok(())=>{let entry=journal.entries.iter_mut().find(|e|e.draft.id==id).ok_or("Registro TikTok indisponível.")?;entry.draft.phase=Phase::Done;journal.save(&path).map_err(|_|"O TikTok recebeu o arquivo, mas o registro não pôde ser salvo. Confira no TikTok e não repita.".to_string())?;Ok(journal.views())},Err(error)=>Err(format!("{error} Confira o TikTok e o status do envio antes de preparar outro. Este registro não será reenviado automaticamente."))}
}
#[tauri::command]
pub async fn studio_tiktok_upload_status(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
    request_id: String,
) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    let request = Request::new(request_id, GROUP)?;
    let _lock = tokio::select! {biased;_=request.cancel.cancelled()=>return Err("Consulta TikTok cancelada.".into()),lock=OPERATION.lock()=>lock};
    let (access, saved) = renew(enabled(true).await?, &request).await?;
    let journal = VideoJournal::load(&root(&app)?.join("actions.json"))?;
    let entry = journal
        .entries
        .iter()
        .find(|e| {
            e.draft.id == id
                && e.binding == saved.binding
                && e.draft.account == saved.identity.open_id
        })
        .ok_or("O registro pertence a outra conta/autorização ou não existe.")?;
    let publish_id = entry
        .draft
        .remote_id
        .as_ref()
        .ok_or("Nenhum ID de processamento TikTok foi salvo para este registro.")?;
    let value = api::upload_status(&access, publish_id, &request.cancel).await?;
    request.check()?;
    Ok(value)
}

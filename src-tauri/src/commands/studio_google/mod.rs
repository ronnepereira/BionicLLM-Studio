//! Google desktop OAuth, queries and explicitly reviewed actions.
pub mod actions;
mod api;
mod oauth;
pub mod youtube;
use crate::commands::connector_requests::{cancel_group, cancel_request, Request};
use api::{Client, Service};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

const VAULT: &str = "com.bionicllm.studio.connectors";
const CLIENT: &str = "google-oauth-desktop-client";
static OPERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Configure o Google na janela principal.".into())
    }
}
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn vault(key: &str, write: Option<Option<&str>>) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(VAULT, key)
        .map_err(|_| "Cofre do sistema indisponível.".to_string())?;
    match write {
        None => match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Não foi possível ler a autorização Google no cofre.".into()),
        },
        Some(Some(v)) => {
            if v.encode_utf16().count() > 1250 {
                return Err("A autorização Google excedeu o tamanho suportado pelo cofre. A conexão anterior foi preservada.".into());
            }
            entry.set_password(v).map_err(|_| {
                "Não foi possível salvar a autorização Google no cofre.".to_string()
            })?;
            Ok(None)
        }
        Some(None) => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Não foi possível remover a autorização Google local.".into()),
        },
    }
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn vault(_: &str, _: Option<Option<&str>>) -> Result<Option<String>, String> {
    Err("Este conector requer o cofre do Windows ou macOS.".into())
}
async fn read_vault(key: &'static str) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || vault(key, None))
        .await
        .map_err(|_| "Leitura do cofre interrompida.".to_string())?
}
async fn write_vault(key: &'static str, value: Option<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || vault(key, Some(value.as_deref())).map(|_| ()))
        .await
        .map_err(|_| "Gravação do cofre interrompida.".to_string())?
}
#[derive(Deserialize, Serialize)]
struct Connection {
    refresh_token: String,
    email: String,
    enabled: bool,
    #[serde(default)]
    write_access: bool,
    #[serde(default)]
    binding: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    youtube_channel: Option<youtube::Channel>,
}
#[derive(Serialize)]
pub struct Status {
    service: Service,
    email: Option<String>,
    enabled: bool,
    write_access: bool,
}
#[derive(Serialize)]
pub struct Overview {
    configured: bool,
    services: Vec<Status>,
}
async fn client() -> Result<Client, String> {
    let value: Client = serde_json::from_str(
        &read_vault(CLIENT)
            .await?
            .ok_or("Configure o cliente OAuth do Google primeiro.")?,
    )
    .map_err(|_| "Cliente OAuth salvo inválido.".to_string())?;
    value.validate()?;
    Ok(value)
}
async fn connection(service: Service) -> Result<Option<Connection>, String> {
    read_vault(service.key())
        .await?
        .map(|v| {
            serde_json::from_str(&v).map_err(|_| {
                "Autorização Google local inválida. Remova-a e conecte novamente.".into()
            })
        })
        .transpose()
}
async fn overview() -> Result<Overview, String> {
    let configured = read_vault(CLIENT).await?.is_some();
    let mut services = Vec::new();
    for service in [
        Service::Gmail,
        Service::Drive,
        Service::Calendar,
        Service::Youtube,
    ] {
        let value = connection(service).await?;
        services.push(Status {
            service,
            enabled: value.as_ref().is_some_and(|v| v.enabled),
            write_access: value.as_ref().is_some_and(|v| v.write_access),
            email: value.map(|v| v.email),
        });
    }
    Ok(Overview {
        configured,
        services,
    })
}
fn cancel_service(service: Service) {
    cancel_group(service.key());
}
#[tauri::command]
pub async fn studio_google_status(window: tauri::WebviewWindow) -> Result<Overview, String> {
    main_only(&window)?;
    // Local vault entries are atomic; status must not wait behind browser consent.
    overview().await
}
#[tauri::command]
pub async fn studio_google_client(
    window: tauri::WebviewWindow,
    input: Option<Client>,
) -> Result<(), String> {
    main_only(&window)?;
    if let Some(ref value) = input {
        value.validate()?;
    }
    let _lock = OPERATION.lock().await;
    for service in [
        Service::Gmail,
        Service::Drive,
        Service::Calendar,
        Service::Youtube,
    ] {
        if connection(service).await?.is_some() {
            return Err(
                "Remova as conexões Google e YouTube locais antes de trocar ou remover o cliente OAuth."
                    .into(),
            );
        }
    }
    write_vault(CLIENT, input.map(|v| serde_json::to_string(&v).unwrap())).await
}
#[tauri::command]
pub async fn studio_google_connect(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    service: Service,
    request_id: String,
    write_access: Option<bool>,
) -> Result<Overview, String> {
    main_only(&window)?;
    let request = Request::new(request_id, service.key())?;
    let _lock = tokio::select! { biased; _ = request.cancel.cancelled() => return Err("Operação Google cancelada.".into()), lock = OPERATION.lock() => lock };
    request.check()?;
    let client = client().await?;
    let write_access = write_access.unwrap_or(false);
    let tokens = oauth::connect(&app, &client, service, write_access, &request.cancel).await?;
    if !api::granted(&tokens, service) || write_access && !api::granted_write(&tokens, service) {
        return Err("As permissões de leitura necessárias não foram concedidas. A conexão anterior foi preservada.".into());
    }
    let access = api::access(&tokens)?;
    let email = api::identity(access, &request.cancel).await?;
    let youtube_channel = if service == Service::Youtube {
        Some(youtube::channel(access, &request.cancel).await?)
    } else {
        None
    };
    let connection = Connection {
        refresh_token: api::refresh_token(&tokens)?.into(),
        email,
        enabled: false,
        write_access,
        binding: uuid::Uuid::new_v4().to_string(),
        youtube_channel,
    };
    let saved = serde_json::to_string(&connection)
        .map_err(|_| "Não foi possível preparar a autorização Google.".to_string())?;
    request.check()?;
    write_vault(service.key(), Some(saved)).await?;
    overview().await
}
#[tauri::command]
pub fn studio_google_cancel(
    window: tauri::WebviewWindow,
    request_id: String,
) -> Result<(), String> {
    main_only(&window)?;
    cancel_request(request_id)
}
#[tauri::command]
pub async fn studio_google_update(
    window: tauri::WebviewWindow,
    service: Service,
    enabled: Option<bool>,
) -> Result<Overview, String> {
    main_only(&window)?;
    cancel_service(service);
    let _lock = OPERATION.lock().await;
    if let Some(enabled) = enabled {
        let mut value = connection(service)
            .await?
            .ok_or("Conecte este serviço Google primeiro.")?;
        value.enabled = enabled;
        write_vault(
            service.key(),
            Some(serde_json::to_string(&value).map_err(|_| "Autorização inválida.".to_string())?),
        )
        .await?;
    } else {
        write_vault(service.key(), None).await?;
    }
    overview().await
}
#[tauri::command]
pub async fn studio_google_read(
    window: tauri::WebviewWindow,
    input: api::Read,
    request_id: String,
) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    input.validate()?;
    let request = Request::new(request_id, input.service().key())?;
    let _lock = tokio::select! { biased; _ = request.cancel.cancelled() => return Err("Operação Google cancelada.".into()), lock = OPERATION.lock() => lock };
    request.check()?;
    let token = fresh_access(input.service(), &request.cancel, false).await?;
    let value = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        api::read(input, &token, &request.cancel),
    )
    .await
    .map_err(|_| "Tempo limite da consulta Google atingido. Refine a pesquisa.".to_string())??;
    request.check()?;
    Ok(value)
}
async fn enabled_connection(service: Service, write: bool) -> Result<Connection, String> {
    let saved = connection(service)
        .await?
        .filter(|v| v.enabled)
        .ok_or("Conecte e ative este serviço Google em Habilidades → Conectores.")?;
    if write && !saved.write_access {
        return Err("Autorize ações com revisão neste serviço Google e ative-o antes de preparar ou confirmar uma ação.".into());
    }
    Ok(saved)
}
async fn fresh_access(
    service: Service,
    cancel: &CancellationToken,
    write: bool,
) -> Result<String, String> {
    let saved = enabled_connection(service, write).await?;
    let tokens = api::refresh(&client().await?, &saved.refresh_token, cancel).await?;
    // A refresh may omit scope (unchanged grant); when present, enforce it again.
    if tokens.get("scope").is_some()
        && (!api::granted(&tokens, service) || write && !api::granted_write(&tokens, service))
    {
        return Err("A permissão de leitura do Google foi removida. Autorize novamente.".into());
    }
    if tokens.get("refresh_token").is_some() {
        let renewed = Connection {
            refresh_token: api::refresh_token(&tokens)?.into(),
            ..saved
        };
        if cancel.is_cancelled() {
            return Err("Operação Google cancelada.".into());
        }
        write_vault(
            service.key(),
            Some(
                serde_json::to_string(&renewed)
                    .map_err(|_| "Não foi possível renovar a autorização local.".to_string())?,
            ),
        )
        .await?;
    }
    Ok(api::access(&tokens)?.to_owned())
}

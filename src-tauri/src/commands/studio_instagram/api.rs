use crate::commands::meta_graph::{self, client, proof, request, VERSION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{net::IpAddr, time::Duration};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    pub page_id: String,
    pub instagram_id: String,
    pub app_id: String,
    pub app_secret: String,
    pub access_token: String,
    pub publishing: bool,
}
pub fn id(value: &str) -> bool {
    (1..=32).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_digit())
}
impl Credentials {
    pub fn validate(&self) -> Result<(), String> {
        if !id(&self.page_id)
            || !id(&self.instagram_id)
            || !id(&self.app_id)
            || self.app_secret.len() != 32
            || !self.app_secret.bytes().all(|b| b.is_ascii_hexdigit())
            || !(20..=1024).contains(&self.access_token.len())
            || !self
                .access_token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-._~+/=".contains(&b))
        {
            return Err("Confira os IDs da Página, Instagram profissional e aplicativo Meta, chave secreta e token de Página com permissões Instagram.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Identity {
    pub id: String,
    pub username: String,
    pub page_id: String,
    pub expires_at: Option<i64>,
}
pub fn inspect(value: &Value, credentials: &Credentials, now: i64) -> Result<Option<i64>, String> {
    let mut scopes = vec!["pages_read_engagement", "instagram_basic"];
    if credentials.publishing {
        scopes.push("instagram_content_publish");
    }
    meta_graph::page_token(
        value,
        &credentials.app_id,
        &credentials.page_id,
        &scopes,
        now,
    )
}
fn get(credentials: &Credentials, endpoint: &str) -> Result<reqwest::RequestBuilder, String> {
    Ok(client()?
        .get(format!("https://graph.facebook.com/{VERSION}/{endpoint}"))
        .bearer_auth(&credentials.access_token)
        .query(&[(
            "appsecret_proof",
            proof(&credentials.app_secret, &credentials.access_token),
        )]))
}
pub async fn verify(
    credentials: &Credentials,
    cancel: &CancellationToken,
) -> Result<Identity, String> {
    credentials.validate()?;
    let debug = request(
        client()?
            .get(format!("https://graph.facebook.com/{VERSION}/debug_token"))
            .bearer_auth(format!("{}|{}", credentials.app_id, credentials.app_secret))
            .query(&[("input_token", &credentials.access_token)]),
        cancel,
    )
    .await?;
    let expires_at = inspect(&debug, credentials, chrono::Utc::now().timestamp())?;
    let page = request(
        get(credentials, "me")?.query(&[("fields", "id,instagram_business_account")]),
        cancel,
    )
    .await?;
    linked_page(&page, credentials)?;
    let account = request(
        get(credentials, &credentials.instagram_id)?.query(&[("fields", "id,username")]),
        cancel,
    )
    .await?;
    identity(&account, credentials, expires_at)
}
fn linked_page(page: &Value, credentials: &Credentials) -> Result<(), String> {
    if page["id"] != credentials.page_id
        || page["instagram_business_account"]["id"] != credentials.instagram_id
    {
        return Err("A Meta não confirmou esta conta profissional vinculada à Página informada. A conexão anterior foi preservada.".into());
    }
    Ok(())
}
fn identity(
    value: &Value,
    credentials: &Credentials,
    expires_at: Option<i64>,
) -> Result<Identity, String> {
    let username = value["username"]
        .as_str()
        .filter(|v| {
            !v.trim().is_empty() && v.chars().count() <= 64 && !v.chars().any(char::is_control)
        })
        .ok_or("A Meta não confirmou o nome da conta Instagram.")?;
    if value["id"] != credentials.instagram_id {
        return Err(
            "O Instagram retornou outra identidade. Confira os IDs da conta e da Página.".into(),
        );
    }
    Ok(Identity {
        id: credentials.instagram_id.clone(),
        username: username.into(),
        page_id: credentials.page_id.clone(),
        expires_at,
    })
}
pub async fn media(credentials: &Credentials, cancel: &CancellationToken) -> Result<Value, String> {
    let value = request(
        get(credentials, &format!("{}/media", credentials.instagram_id))?.query(&[
            ("fields", "id,caption,media_type,timestamp"),
            ("limit", "10"),
        ]),
        cancel,
    )
    .await?;
    media_list(&value)
}
fn media_list(value: &Value) -> Result<Value, String> {
    let values = value["data"]
        .as_array()
        .ok_or("O Instagram não retornou uma lista de mídias.")?;
    let clip = |v: &Value, count| {
        v.as_str()
            .unwrap_or("")
            .chars()
            .take(count)
            .collect::<String>()
    };
    let items: Vec<_> = values.iter().take(10).map(|item| json!({ "id": clip(&item["id"], 128), "caption": clip(&item["caption"], 2200), "media_type": clip(&item["media_type"], 32), "timestamp": clip(&item["timestamp"], 64) })).collect();
    Ok(json!({ "items": items, "has_more": value["paging"].get("next").is_some() }))
}
fn public_url(value: &str) -> bool {
    if value.len() > 2048 || value.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return false;
    }
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host
        .trim_matches(['[', ']'])
        .trim_end_matches('.')
        .to_ascii_lowercase();
    let private_v4 = |ip: std::net::Ipv4Addr| {
        let bytes = ip.octets();
        ip.is_private()
            || ip.is_loopback()
            || ip.is_link_local()
            || ip.is_unspecified()
            || ip.is_multicast()
            || ip.is_broadcast()
            || ip.is_documentation()
            || bytes[0] == 0
            || bytes[0] >= 224
            || bytes[0] == 100 && (64..=127).contains(&bytes[1])
    };
    let private_ip = host.parse::<IpAddr>().is_ok_and(|ip| match ip {
        IpAddr::V4(ip) => private_v4(ip),
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip.is_multicast()
                || ip.to_ipv4_mapped().is_some_and(private_v4)
        }
    });
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && !private_ip
        && host != "localhost"
        && (host.contains('.') || host.parse::<IpAddr>().is_ok())
        && !host.ends_with(".localhost")
        && !host.ends_with(".local")
        && !host.ends_with(".internal")
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Post {
    Image {
        url: String,
        caption: String,
    },
    Reel {
        url: String,
        caption: String,
        share_to_feed: bool,
    },
}
impl Post {
    pub fn validate(&self) -> Result<(), String> {
        let (url, caption) = match self {
            Self::Image { url, caption } | Self::Reel { url, caption, .. } => (url, caption),
        };
        if !public_url(url) || caption.chars().count() > 2200 || caption.contains('\0') {
            return Err("Use uma URL HTTPS pública de mídia, sem login embutido, endereço local ou fragmento, com até 2.048 bytes; legenda até 2.200 caracteres. O formato e o acesso real serão validados pela Meta.".into());
        }
        Ok(())
    }
    fn fields(&self) -> Vec<(&str, &str)> {
        match self {
            Self::Image { url, caption } => vec![("image_url", url), ("caption", caption)],
            Self::Reel {
                url,
                caption,
                share_to_feed,
            } => vec![
                ("video_url", url),
                ("caption", caption),
                ("media_type", "REELS"),
                (
                    "share_to_feed",
                    if *share_to_feed { "true" } else { "false" },
                ),
            ],
        }
    }
}
impl crate::commands::review_actions::ReviewInput for Post {
    fn validate(&self) -> Result<(), String> {
        Post::validate(self)
    }
    fn valid_account(&self, account: &str) -> bool {
        id(account)
    }
}
pub fn create_request(
    credentials: &Credentials,
    post: &Post,
) -> Result<reqwest::RequestBuilder, String> {
    credentials.validate()?;
    post.validate()?;
    let mac = proof(&credentials.app_secret, &credentials.access_token);
    let mut fields = post.fields();
    fields.push(("appsecret_proof", &mac));
    Ok(client()?
        .post(format!(
            "https://graph.facebook.com/{VERSION}/{}/media",
            credentials.instagram_id
        ))
        .bearer_auth(&credentials.access_token)
        .form(&fields))
}
pub fn remote_id(value: &Value) -> Result<String, String> {
    value["id"]
        .as_str()
        .filter(|v| id(v))
        .map(str::to_owned)
        .ok_or_else(|| {
            "A Meta não confirmou um identificador válido de mídia/processamento.".into()
        })
}
pub async fn create(
    credentials: &Credentials,
    post: &Post,
    cancel: &CancellationToken,
) -> Result<String, String> {
    remote_id(&request(create_request(credentials, post)?, cancel).await?)
}
#[derive(Debug, PartialEq)]
pub enum Processing {
    Pending,
    Ready,
}
pub fn processing(value: &Value, container: &str) -> Result<Processing, String> {
    if value.get("id").is_some() && value["id"] != container {
        return Err("A Meta retornou outro identificador de processamento.".into());
    }
    match value["status_code"].as_str() {
        Some("FINISHED") => Ok(Processing::Ready), Some("IN_PROGRESS") => Ok(Processing::Pending),
        Some("ERROR" | "EXPIRED") => Err("A Meta recusou a mídia ou o processamento expirou. Esta operação não enviará uma publicação.".into()),
        Some("PUBLISHED") => Err("A Meta informou mídia já publicada. Confira o Instagram antes de preparar outra ação.".into()),
        _ => Err("A Meta não confirmou que a mídia está pronta. A publicação foi interrompida.".into()),
    }
}
pub async fn wait_ready(
    credentials: &Credentials,
    container: &str,
    cancel: &CancellationToken,
) -> Result<(), String> {
    if !id(container) {
        return Err("Identificador de processamento inválido.".into());
    }
    let work = async {
        for attempt in 0..5 {
            if attempt > 0 {
                tokio::select! { biased; _ = cancel.cancelled() => return Err("Processamento Instagram cancelado.".into()), _ = tokio::time::sleep(Duration::from_secs(60)) => {} }
            }
            let value = request(
                get(credentials, container)?.query(&[("fields", "status_code")]),
                cancel,
            )
            .await?;
            if processing(&value, container)? == Processing::Ready {
                return Ok(());
            }
        }
        Err("A mídia não ficou pronta no prazo. Confira o Instagram antes de preparar outra; não haverá publicação automática posterior.".into())
    };
    tokio::select! { biased; _ = cancel.cancelled() => Err("Processamento Instagram cancelado.".into()), result = tokio::time::timeout(Duration::from_secs(300), work) => result.map_err(|_| "Tempo limite de processamento Instagram atingido. A publicação foi interrompida.".to_string())? }
}
pub fn publish_request(
    credentials: &Credentials,
    container: &str,
) -> Result<reqwest::RequestBuilder, String> {
    credentials.validate()?;
    if !id(container) {
        return Err("Identificador de processamento inválido.".into());
    }
    Ok(client()?
        .post(format!(
            "https://graph.facebook.com/{VERSION}/{}/media_publish",
            credentials.instagram_id
        ))
        .bearer_auth(&credentials.access_token)
        .form(&[
            ("creation_id", container),
            (
                "appsecret_proof",
                &proof(&credentials.app_secret, &credentials.access_token),
            ),
        ]))
}
pub async fn publish(
    credentials: &Credentials,
    container: &str,
    cancel: &CancellationToken,
) -> Result<String, String> {
    remote_id(&request(publish_request(credentials, container)?, cancel).await?)
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;

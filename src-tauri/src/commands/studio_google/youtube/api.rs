use super::{files::Media, Channel, Upload};
use crate::commands::studio_google::api as google;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

pub fn channel_id(id: &str) -> bool {
    id.len() == 24
        && id.starts_with("UC")
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
fn video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
pub fn parse_channel(value: &Value) -> Result<Channel, String> {
    let rows = value["items"].as_array().filter(|r| r.len() == 1 && value.get("nextPageToken").is_none()).ok_or("O YouTube precisa confirmar um único canal. Escolha o canal correto ao autorizar; nenhum canal é criado automaticamente.")?;
    let row = &rows[0];
    let id = row["id"]
        .as_str()
        .filter(|id| channel_id(id))
        .ok_or("ID do canal YouTube inválido.")?;
    let title = row["snippet"]["title"]
        .as_str()
        .filter(|v| {
            !v.trim().is_empty() && v.chars().count() <= 200 && !v.chars().any(char::is_control)
        })
        .ok_or("Nome do canal YouTube inválido.")?;
    let uploads = row["contentDetails"]["relatedPlaylists"]["uploads"]
        .as_str()
        .filter(|id| {
            id.len() <= 64
                && !id.is_empty()
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        })
        .ok_or("O YouTube não confirmou a lista de envios do canal.")?;
    Ok(Channel {
        id: id.into(),
        title: title.into(),
        uploads: uploads.into(),
    })
}
pub async fn channel(token: &str, cancel: &CancellationToken) -> Result<Channel, String> {
    parse_channel(
        &google::request(
            google::http_client()?
                .get("https://www.googleapis.com/youtube/v3/channels")
                .bearer_auth(token)
                .query(&[
                    ("part", "snippet,contentDetails"),
                    ("mine", "true"),
                    ("maxResults", "2"),
                ]),
            cancel,
        )
        .await?,
    )
}
pub async fn videos(
    token: &str,
    channel: &Channel,
    cancel: &CancellationToken,
) -> Result<Value, String> {
    let list = google::request(
        google::http_client()?
            .get("https://www.googleapis.com/youtube/v3/playlistItems")
            .bearer_auth(token)
            .query(&[
                ("part", "contentDetails"),
                ("playlistId", &channel.uploads),
                ("maxResults", "10"),
            ]),
        cancel,
    )
    .await?;
    let rows = list["items"]
        .as_array()
        .ok_or("Lista de vídeos YouTube inválida.")?;
    let ids: Vec<_> = rows
        .iter()
        .take(10)
        .filter_map(|v| v["contentDetails"]["videoId"].as_str())
        .filter(|v| video_id(v))
        .collect();
    let has_more = list.get("nextPageToken").is_some();
    if ids.is_empty() {
        return Ok(json!({ "items": [], "has_more": has_more }));
    }
    let response = google::request(
        google::http_client()?
            .get("https://www.googleapis.com/youtube/v3/videos")
            .bearer_auth(token)
            .query(&[
                ("part", "snippet,status,contentDetails"),
                ("id", &ids.join(",")),
            ]),
        cancel,
    )
    .await?;
    video_list(&response, &channel.id, has_more)
}
pub fn video_list(value: &Value, channel: &str, has_more: bool) -> Result<Value, String> {
    let rows = value["items"]
        .as_array()
        .ok_or("Lista de vídeos YouTube inválida.")?;
    let clipped = |v: &Value, max| {
        v.as_str()
            .unwrap_or("")
            .chars()
            .take(max)
            .collect::<String>()
    };
    let items: Vec<_> = rows.iter().take(10).filter(|v| v["snippet"]["channelId"] == channel && v["id"].as_str().is_some_and(video_id)).map(|v| json!({ "id": v["id"], "title": clipped(&v["snippet"]["title"], 100), "description": clipped(&v["snippet"]["description"], 5000), "published_at": clipped(&v["snippet"]["publishedAt"], 40), "privacy": clipped(&v["status"]["privacyStatus"], 20), "upload_status": clipped(&v["status"]["uploadStatus"], 30), "duration": clipped(&v["contentDetails"]["duration"], 40) })).collect();
    Ok(json!({ "items": items, "has_more": has_more }))
}
pub fn metadata(input: &Upload) -> Result<Value, String> {
    input.validate()?;
    Ok(
        json!({ "snippet": { "title": input.title, "description": input.description, "categoryId": input.category_id }, "status": { "privacyStatus": input.privacy, "selfDeclaredMadeForKids": input.made_for_kids, "containsSyntheticMedia": input.contains_synthetic_media } }),
    )
}
pub fn initiate(
    input: &Upload,
    media: &Media,
    token: &str,
) -> Result<reqwest::RequestBuilder, String> {
    media.validate()?;
    Ok(google::http_client()?
        .post("https://www.googleapis.com/upload/youtube/v3/videos")
        .bearer_auth(token)
        .query(&[
            ("uploadType", "resumable"),
            ("part", "snippet,status"),
            ("notifySubscribers", "false"),
        ])
        .header("X-Upload-Content-Length", media.size)
        .header("X-Upload-Content-Type", &media.mime)
        .json(&metadata(input)?))
}
pub fn session_url(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|_| "Sessão de envio YouTube inválida.")?;
    let pairs: Vec<_> = url.query_pairs().collect();
    if value.len() > 4096
        || url.scheme() != "https"
        || url.host_str() != Some("www.googleapis.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.path() != "/upload/youtube/v3/videos"
        || pairs.iter().filter(|(k, _)| k == "upload_id").count() != 1
        || !pairs
            .iter()
            .any(|(k, v)| k == "upload_id" && !v.is_empty() && v.len() <= 2048)
        || pairs
            .iter()
            .any(|(k, v)| k == "uploadType" && v != "resumable")
    {
        return Err("O YouTube retornou um destino de envio não autorizado. Nenhum arquivo foi enviado para esse destino.".into());
    }
    Ok(url)
}
pub(super) async fn response(
    request: reqwest::RequestBuilder,
    cancel: &CancellationToken,
) -> Result<reqwest::Response, String> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("Envio YouTube cancelado.".into()),
        result = request.send() => {
            let response = result.map_err(|_| "O YouTube não confirmou o envio. Confira a conexão e o canal antes de repetir.")?;
            if !response.status().is_success() {
                return Err(match response.status().as_u16() {
                    400 => "O YouTube recusou o arquivo ou os dados do vídeo. Confira o formato e os campos.",
                    401 | 403 => "O YouTube recusou o envio. Confira autorização, API habilitada, limites e permissões do projeto/canal.",
                    429 => "O YouTube limitou os envios. Aguarde e confira o canal antes de tentar outro.",
                    _ => "O YouTube não confirmou o envio. Confira o canal antes de repetir.",
                }.into());
            }
            Ok(response)
        }
    }
}
pub(super) async fn finish(
    mut response: reqwest::Response,
    expected_channel: &str,
    cancel: &CancellationToken,
) -> Result<String, String> {
    let work = async {
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Confirmação YouTube interrompida.")?
        {
            if bytes.len() + chunk.len() > 1024 * 1024 {
                return Err("Confirmação YouTube excedeu 1 MB.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let value = serde_json::from_slice(&bytes).map_err(|_| "Confirmação YouTube inválida.")?;
        receipt(&value, expected_channel)
    };
    tokio::select! { biased; _ = cancel.cancelled() => Err("Envio YouTube cancelado.".into()), result = work => result }
}
pub fn receipt(value: &Value, expected_channel: &str) -> Result<String, String> {
    let id = value["id"]
        .as_str()
        .filter(|id| video_id(id))
        .ok_or("O YouTube não confirmou o ID do vídeo. Confira o canal antes de repetir.")?;
    if value["snippet"]["channelId"] != expected_channel
        || !["private", "unlisted", "public"]
            .contains(&value["status"]["privacyStatus"].as_str().unwrap_or(""))
    {
        return Err("O YouTube não confirmou o canal e a visibilidade do vídeo. Confira no YouTube antes de repetir.".into());
    }
    Ok(id.into())
}
pub async fn upload(
    input: &Upload,
    media: &Media,
    file: std::fs::File,
    token: &str,
    expected_channel: &str,
    cancel: &CancellationToken,
) -> Result<String, String> {
    let started = response(initiate(input, media, token)?, cancel).await?;
    // Never follow a server-provided URL with the bearer token without validating its exact origin/path.
    let location = started
        .headers()
        .get("location")
        .and_then(|h| h.to_str().ok())
        .ok_or("O YouTube não confirmou a sessão de envio.")?;
    let session = session_url(location)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(1200))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Não foi possível preparar o envio do vídeo.")?;
    let result = response(
        client
            .put(session)
            .bearer_auth(token)
            .header("Content-Length", media.size)
            .header("Content-Type", &media.mime)
            .body(video_body(file)),
        cancel,
    )
    .await?;
    finish(result, expected_channel, cancel).await
}

pub(super) fn video_body(file: std::fs::File) -> reqwest::Body {
    let file = tokio::fs::File::from_std(file);
    let stream = futures_util::stream::try_unfold(file, |mut file| async move {
        let mut bytes = vec![0; 64 * 1024];
        let n = file.read(&mut bytes).await?;
        if n == 0 {
            return Ok::<_, std::io::Error>(None);
        }
        bytes.truncate(n);
        Ok(Some((bytes, file)))
    });
    reqwest::Body::wrap_stream(stream)
}

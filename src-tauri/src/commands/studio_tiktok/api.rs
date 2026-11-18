use crate::commands::connector_media::Media;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    pub client_key: String,
    pub client_secret: String,
    pub refresh_token: String,
    pub uploading: bool,
    pub read_videos: bool,
}
pub fn identifier(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 128
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-~.".contains(&b))
}
fn token(v: &str) -> bool {
    (10..=1024).contains(&v.len())
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-~.+/=".contains(&b))
}
impl Credentials {
    pub fn validate(&self) -> Result<(), String> {
        if !identifier(&self.client_key)
            || !token(&self.client_secret)
            || self.client_secret.len() > 256
            || !token(&self.refresh_token)
        {
            return Err("Confira a chave, o segredo do aplicativo TikTok e o token de renovação obtido pelo seu fluxo OAuth autorizado.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Identity {
    pub open_id: String,
    pub display_name: String,
}
pub struct Tokens {
    pub access: String,
    pub refresh: String,
    pub open_id: String,
}
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Não foi possível preparar a conexão TikTok.".into())
}
pub async fn request(
    builder: reqwest::RequestBuilder,
    cancel: &CancellationToken,
) -> Result<Value, String> {
    let work = async {
        let mut response = builder
            .send()
            .await
            .map_err(|_| "Não foi possível consultar o TikTok. Confira sua conexão.")?;
        if !response.status().is_success() {
            return Err("O TikTok recusou a operação. Confira autorização, permissões, limites e aprovação do aplicativo.".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Resposta TikTok interrompida.")?
        {
            if bytes.len() + chunk.len() > 1024 * 1024 {
                return Err("A resposta TikTok excedeu 1 MB.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| "O TikTok retornou uma resposta inválida.".into())
    };
    tokio::select! { biased; _ = cancel.cancelled() => Err("Operação TikTok cancelada.".into()), result = work => result }
}
pub fn data(value: &Value) -> Result<&Value, String> {
    if value["error"]["code"] != "ok" || !value["data"].is_object() {
        return Err("O TikTok não confirmou a operação. Confira as permissões, a conta e os limites antes de tentar novamente.".into());
    }
    Ok(&value["data"])
}
pub fn tokens(value: &Value, credentials: &Credentials) -> Result<Tokens, String> {
    credentials.validate()?;
    let scope: Vec<_> = value["scope"]
        .as_str()
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .collect();
    if value.get("error").is_some()
        || !value["token_type"]
            .as_str()
            .is_some_and(|v| v.eq_ignore_ascii_case("Bearer"))
        || !scope.contains(&"user.info.basic")
        || credentials.uploading && !scope.contains(&"video.upload")
        || credentials.read_videos && !scope.contains(&"video.list")
        || !value["expires_in"]
            .as_u64()
            .is_some_and(|v| v > 0 && v <= 315360000)
        || !value["refresh_expires_in"]
            .as_u64()
            .is_some_and(|v| v > 0 && v <= 315360000)
    {
        return Err("O TikTok não confirmou uma autorização ativa para as permissões selecionadas. A conexão anterior foi preservada.".into());
    }
    Ok(Tokens {
        access: value["access_token"]
            .as_str()
            .filter(|v| token(v))
            .ok_or("Token de acesso TikTok inválido.")?
            .into(),
        refresh: value["refresh_token"]
            .as_str()
            .filter(|v| token(v))
            .ok_or("Token de renovação TikTok inválido.")?
            .into(),
        open_id: value["open_id"]
            .as_str()
            .filter(|v| identifier(v))
            .ok_or("Identificador TikTok inválido.")?
            .into(),
    })
}
pub fn refresh_request(credentials: &Credentials) -> Result<reqwest::RequestBuilder, String> {
    credentials.validate()?;
    Ok(client()?
        .post("https://open.tiktokapis.com/v2/oauth/token/")
        .form(&[
            ("client_key", credentials.client_key.as_str()),
            ("client_secret", credentials.client_secret.as_str()),
            ("refresh_token", credentials.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ]))
}
pub async fn refresh(
    credentials: &Credentials,
    cancel: &CancellationToken,
) -> Result<Tokens, String> {
    tokens(
        &request(refresh_request(credentials)?, cancel).await?,
        credentials,
    )
}
pub async fn identity(
    access: &str,
    expected: &str,
    cancel: &CancellationToken,
) -> Result<Identity, String> {
    profile(
        &request(
            client()?
                .get("https://open.tiktokapis.com/v2/user/info/")
                .bearer_auth(access)
                .query(&[("fields", "open_id,display_name")]),
            cancel,
        )
        .await?,
        expected,
    )
}
pub fn profile(value: &Value, expected: &str) -> Result<Identity, String> {
    let user = &data(value)?["user"];
    if !identifier(expected) || user["open_id"] != expected {
        return Err(
            "A conta TikTok retornada não corresponde à autorização. Salve e verifique novamente."
                .into(),
        );
    }
    let name = user["display_name"]
        .as_str()
        .filter(|v| {
            !v.trim().is_empty() && v.chars().count() <= 200 && !v.chars().any(char::is_control)
        })
        .ok_or("O TikTok não confirmou o nome da conta.")?;
    Ok(Identity {
        open_id: expected.into(),
        display_name: name.into(),
    })
}
pub async fn videos(access: &str, cancel: &CancellationToken) -> Result<Value, String> {
    video_list(
        &request(
            client()?
                .post("https://open.tiktokapis.com/v2/video/list/")
                .bearer_auth(access)
                .query(&[("fields", "id,title,video_description,create_time,duration")])
                .json(&json!({"max_count":10})),
            cancel,
        )
        .await?,
    )
}
pub fn video_list(value: &Value) -> Result<Value, String> {
    let value = data(value)?;
    let rows = value["videos"]
        .as_array()
        .ok_or("O TikTok não retornou uma lista de vídeos.")?;
    let clipped = |v: &Value, max| {
        v.as_str()
            .unwrap_or("")
            .chars()
            .take(max)
            .collect::<String>()
    };
    let items:Vec<_>=rows.iter().take(10).filter(|v|v["id"].as_str().is_some_and(|v| !v.is_empty() && v.len()<=32 && v.bytes().all(|b|b.is_ascii_digit()))).map(|v|json!({"id":v["id"],"title":clipped(&v["title"],2200),"description":clipped(&v["video_description"],2200),"created_at":v["create_time"].as_i64(),"duration":v["duration"].as_u64()})).collect();
    Ok(json!({"items":items,"has_more":value["has_more"]==true}))
}
pub fn supported(media: &Media) -> Result<(), String> {
    media.validate()?;
    if !["video/mp4", "video/quicktime", "video/webm"].contains(&media.mime.as_str()) {
        return Err("Para TikTok, escolha MP4, MOV ou WebM. O TikTok validará o formato, a duração e os codecs.".into());
    }
    Ok(())
}
pub fn chunks(size: u64) -> Result<(u64, u64), String> {
    if !(1..=crate::commands::connector_media::MAX_SIZE).contains(&size) {
        return Err("Vídeo TikTok deve ter até 512 MiB.".into());
    }
    let chunk = size.min(10_000_000);
    Ok((chunk, size / chunk))
}
pub fn init_request(media: &Media, access: &str) -> Result<reqwest::RequestBuilder, String> {
    supported(media)?;
    let (size, count) = chunks(media.size)?;
    Ok(client()?.post("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/").bearer_auth(access).json(&json!({"source_info":{"source":"FILE_UPLOAD","video_size":media.size,"chunk_size":size,"total_chunk_count":count}})))
}
pub fn publish_id(v: &str) -> bool {
    v.starts_with("v_inbox_file~") && v.len() > "v_inbox_file~".len() && identifier(v)
}
pub fn upload_url(v: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(v).map_err(|_| "Destino de envio TikTok inválido.")?;
    let query: Vec<_> = url.query_pairs().collect();
    if v.len() > 4096
        || url.scheme() != "https"
        || ![
            Some("open-upload.tiktokapis.com"),
            Some("upload.us.tiktokapis.com"),
        ]
        .contains(&url.host_str())
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.path() != "/video/"
        || ["upload_id", "upload_token"].iter().any(|key| {
            query.iter().filter(|(k, _)| k == key).count() != 1
                || !query
                    .iter()
                    .any(|(k, v)| k == key && !v.is_empty() && v.len() <= 2048)
        })
    {
        return Err("O TikTok retornou um destino de envio não autorizado. Nenhum arquivo será enviado para esse destino.".into());
    }
    Ok(url)
}
pub async fn init(
    media: &Media,
    access: &str,
    cancel: &CancellationToken,
) -> Result<(String, url::Url), String> {
    let result = request(init_request(media, access)?, cancel).await?;
    let value = data(&result)?;
    let id = value["publish_id"]
        .as_str()
        .filter(|v| publish_id(v))
        .ok_or("O TikTok não confirmou o ID do processamento.")?;
    Ok((
        id.into(),
        upload_url(
            value["upload_url"]
                .as_str()
                .ok_or("O TikTok não confirmou o destino de envio.")?,
        )?,
    ))
}
pub async fn transfer(
    media: &Media,
    file: std::fs::File,
    url: url::Url,
    cancel: &CancellationToken,
) -> Result<(), String> {
    supported(media)?;
    upload_url(url.as_str())?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Não foi possível preparar a transferência TikTok.")?;
    let (chunk, count) = chunks(media.size)?;
    let mut file = tokio::fs::File::from_std(file);
    let mut offset = 0;
    for index in 0..count {
        let size = if index + 1 == count {
            media.size - offset
        } else {
            chunk
        };
        let mut bytes = vec![0; size as usize];
        tokio::select! {biased;_=cancel.cancelled()=>return Err("Envio TikTok cancelado.".into()),result=file.read_exact(&mut bytes)=>{result.map_err(|_|"Leitura da cópia TikTok interrompida.")?;}}
        let builder = chunk_request(&client, url.clone(), media, offset, bytes)?;
        // The upload URL carries its own session credential. Never forward the user's API bearer token.
        send_chunk(builder, index + 1 == count, cancel).await?;
        offset += size;
    }
    Ok(())
}
fn chunk_request(
    client: &reqwest::Client,
    url: url::Url,
    media: &Media,
    offset: u64,
    bytes: Vec<u8>,
) -> Result<reqwest::RequestBuilder, String> {
    let size = bytes.len() as u64;
    if size == 0 || offset.checked_add(size).is_none_or(|v| v > media.size) {
        return Err("Intervalo do bloco TikTok inválido.".into());
    }
    Ok(client
        .put(url)
        .header("Content-Type", &media.mime)
        .header("Content-Length", size)
        .header(
            "Content-Range",
            format!("bytes {}-{}/{}", offset, offset + size - 1, media.size),
        )
        .body(bytes))
}
pub(super) async fn send_chunk(
    builder: reqwest::RequestBuilder,
    last: bool,
    cancel: &CancellationToken,
) -> Result<(), String> {
    let expected = if last { 201 } else { 206 };
    tokio::select! {biased;_=cancel.cancelled()=>Err("Envio TikTok cancelado.".into()),result=builder.send()=>{
        let response=result.map_err(|_|"O TikTok não confirmou a transferência. Confira a conta antes de repetir.")?;
        if response.status().as_u16()!=expected{return Err("O TikTok não confirmou o bloco do vídeo. Confira o status antes de repetir; não há retomada automática.".into());} Ok(())
    }}
}
pub async fn upload_status(
    access: &str,
    id: &str,
    cancel: &CancellationToken,
) -> Result<Value, String> {
    if !publish_id(id) {
        return Err("ID de processamento TikTok inválido.".into());
    }
    let result = request(
        client()?
            .post("https://open.tiktokapis.com/v2/post/publish/status/fetch/")
            .bearer_auth(access)
            .json(&json!({"publish_id":id})),
        cancel,
    )
    .await?;
    status_value(&result)
}
pub fn status_value(value: &Value) -> Result<Value, String> {
    let value = data(value)?;
    let status = value["status"]
        .as_str()
        .filter(|v| {
            [
                "PROCESSING_UPLOAD",
                "SEND_TO_USER_INBOX",
                "PUBLISH_COMPLETE",
                "FAILED",
            ]
            .contains(v)
        })
        .ok_or("O TikTok retornou um estado desconhecido. Confira no TikTok antes de repetir.")?;
    Ok(json!({"status":status,"uploaded_bytes":value["uploaded_bytes"].as_u64()}))
}
#[cfg(test)]
#[path = "tests.rs"]
mod tests;

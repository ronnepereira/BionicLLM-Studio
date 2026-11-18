use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Service {
    Gmail,
    Drive,
    Calendar,
    Youtube,
}
impl Service {
    pub fn write_scope(self) -> &'static str {
        match self {
            Self::Gmail => "https://www.googleapis.com/auth/gmail.send",
            Self::Drive => "https://www.googleapis.com/auth/drive.file",
            Self::Calendar => "https://www.googleapis.com/auth/calendar.events.owned",
            Self::Youtube => "https://www.googleapis.com/auth/youtube.upload",
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::Gmail => "google-gmail",
            Self::Drive => "google-drive",
            Self::Calendar => "google-calendar",
            Self::Youtube => "google-youtube",
        }
    }
    pub fn scope(self) -> &'static str {
        match self {
            Self::Gmail => "https://www.googleapis.com/auth/gmail.readonly",
            Self::Drive => "https://www.googleapis.com/auth/drive.metadata.readonly",
            Self::Calendar => "https://www.googleapis.com/auth/calendar.events.readonly",
            Self::Youtube => "https://www.googleapis.com/auth/youtube.readonly",
        }
    }
}
pub const EMAIL_SCOPE: &str = "https://www.googleapis.com/auth/userinfo.email";
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Client {
    pub client_id: String,
    pub client_secret: String,
}
impl Client {
    pub fn validate(&self) -> Result<(), String> {
        let prefix = self
            .client_id
            .strip_suffix(".apps.googleusercontent.com")
            .unwrap_or("");
        if prefix.is_empty()
            || self.client_id.len() > 256
            || !prefix
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
            || !(10..=256).contains(&self.client_secret.len())
            || !self
                .client_secret
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
        {
            return Err("Confira o ID e a chave do cliente OAuth do tipo Aplicativo para computador do Google.".into());
        }
        Ok(())
    }
}
pub fn nonce() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
pub fn authorize(
    client: &Client,
    service: Service,
    redirect: &str,
    state: &str,
    verifier: &str,
    write_access: bool,
) -> String {
    let mut url = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("client_id", client.client_id.as_str()),
        ("redirect_uri", redirect),
        ("response_type", "code"),
        (
            "scope",
            &format!(
                "{} {EMAIL_SCOPE}{}",
                service.scope(),
                if write_access {
                    format!(" {}", service.write_scope())
                } else {
                    String::new()
                }
            ),
        ),
        ("state", state),
        ("code_challenge", &challenge(verifier)),
        ("code_challenge_method", "S256"),
        ("access_type", "offline"),
        ("prompt", "consent select_account"),
        ("include_granted_scopes", "false"),
    ]);
    url.into()
}
pub fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Não foi possível preparar a conexão com o Google.".into())
}
pub async fn request(
    request: reqwest::RequestBuilder,
    cancel: &CancellationToken,
) -> Result<Value, String> {
    let work = async {
        let mut response = request
            .send()
            .await
            .map_err(|_| "Não foi possível consultar o Google. Confira sua conexão.".to_string())?;
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
            400 | 401 => "A autorização do Google expirou ou foi recusada. Conecte este serviço novamente.",
            403 => "O Google recusou o acesso. Confira APIs habilitadas, permissões e usuários de teste do projeto.",
            429 => "O limite de consultas do Google foi atingido. Aguarde antes de tentar novamente.",
            _ => "O Google não confirmou a consulta. Tente novamente mais tarde.",
        }.into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "A resposta do Google foi interrompida.".to_string())?
        {
            if bytes.len() + chunk.len() > 1024 * 1024 {
                return Err("A resposta do Google excedeu 1 MB. Refine a consulta.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| "O Google retornou uma resposta inválida.".into())
    };
    tokio::select! { biased; _ = cancel.cancelled() => Err("Operação Google cancelada.".into()), result = work => result }
}
fn valid_token(value: &str) -> bool {
    (10..=4096).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-._~+/=".contains(&b))
}
pub fn access(value: &Value) -> Result<&str, String> {
    if value["token_type"]
        .as_str()
        .is_none_or(|v| !v.eq_ignore_ascii_case("Bearer"))
    {
        return Err("O Google não retornou um token Bearer válido.".into());
    }
    value["access_token"]
        .as_str()
        .filter(|v| valid_token(v))
        .ok_or_else(|| "Token de acesso Google inválido.".into())
}
pub fn granted(value: &Value, service: Service) -> bool {
    let scopes: Vec<_> = value["scope"]
        .as_str()
        .unwrap_or("")
        .split_ascii_whitespace()
        .collect();
    scopes.contains(&service.scope())
        && (scopes.contains(&EMAIL_SCOPE) || scopes.contains(&"email"))
}
pub fn granted_write(value: &Value, service: Service) -> bool {
    value["scope"]
        .as_str()
        .unwrap_or("")
        .split_ascii_whitespace()
        .any(|s| s == service.write_scope())
}
pub fn refresh_token(value: &Value) -> Result<&str, String> {
    value["refresh_token"]
        .as_str()
        .filter(|v| valid_token(v))
        .ok_or_else(|| {
            "O Google não forneceu autorização renovável. Autorize novamente este serviço.".into()
        })
}
pub async fn exchange(
    client: &Client,
    code: &str,
    redirect: &str,
    verifier: &str,
    cancel: &CancellationToken,
) -> Result<Value, String> {
    request(
        http_client()?
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", client.client_id.as_str()),
                ("client_secret", client.client_secret.as_str()),
                ("code", code),
                ("code_verifier", verifier),
                ("redirect_uri", redirect),
                ("grant_type", "authorization_code"),
            ]),
        cancel,
    )
    .await
}
pub async fn refresh(
    client: &Client,
    refresh: &str,
    cancel: &CancellationToken,
) -> Result<Value, String> {
    request(
        http_client()?
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", client.client_id.as_str()),
                ("client_secret", client.client_secret.as_str()),
                ("refresh_token", refresh),
                ("grant_type", "refresh_token"),
            ]),
        cancel,
    )
    .await
}
pub async fn identity(token: &str, cancel: &CancellationToken) -> Result<String, String> {
    let value = request(
        http_client()?
            .get("https://www.googleapis.com/oauth2/v2/userinfo")
            .bearer_auth(token),
        cancel,
    )
    .await?;
    value["email"]
        .as_str()
        .filter(|email| {
            email.len() <= 254
                && email.contains('@')
                && !email.chars().any(char::is_control)
                && value["verified_email"] == true
        })
        .map(str::to_owned)
        .ok_or_else(|| "O Google não confirmou o e-mail da conta.".into())
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Read {
    GmailList { query: String },
    GmailMessage { id: String },
    DriveList { query: String },
    CalendarList { query: String, start: Option<String>, end: Option<String>, page_token: Option<String> },
}
impl Read {
    pub fn service(&self) -> Service {
        match self {
            Self::GmailList { .. } | Self::GmailMessage { .. } => Service::Gmail,
            Self::DriveList { .. } => Service::Drive,
            Self::CalendarList { .. } => Service::Calendar,
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if let Self::CalendarList { start, end, page_token, .. } = self {
            if page_token.as_ref().is_some_and(|value| value.len() > 2048 || value.chars().any(char::is_control)) {
                return Err("Página do Google Agenda inválida.".into());
            }
            match (start, end) {
                (Some(start), Some(end)) => {
                    let first = chrono::DateTime::parse_from_rfc3339(start).map_err(|_| "Início do período inválido.")?;
                    let last = chrono::DateTime::parse_from_rfc3339(end).map_err(|_| "Fim do período inválido.")?;
                    if last <= first || last - first > chrono::Duration::days(66) { return Err("Consulte um período de até 66 dias.".into()); }
                },
                (None, None) => {},
                _ => return Err("Informe o início e o fim do período.".into()),
            }
        }
        let valid = match self {
            Self::GmailMessage { id } => {
                !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_hexdigit())
            }
            Self::GmailList { query }
            | Self::DriveList { query }
            | Self::CalendarList { query, .. } => {
                query.len() <= 500 && !query.chars().any(char::is_control)
            }
        };
        if valid {
            Ok(())
        } else {
            Err("Use uma pesquisa de até 500 bytes ou um ID válido de e-mail.".into())
        }
    }
}
pub fn drive_query(query: &str) -> String {
    format!(
        "trashed = false and name contains '{}'",
        query.replace('\\', "\\\\").replace('\'', "\\'")
    )
}
fn plain_parts(payload: &Value, depth: usize, output: &mut String) {
    if depth > 12 || output.len() > 32_000 {
        return;
    }
    if payload["mimeType"] == "text/plain" && payload["filename"].as_str().unwrap_or("").is_empty()
    {
        if let Some(data) = payload["body"]["data"].as_str() {
            if let Ok(bytes) = URL_SAFE_NO_PAD.decode(data.trim_end_matches('=')) {
                let content = String::from_utf8_lossy(&bytes);
                if !output.is_empty() && output.chars().count() < 32_000 {
                    output.push('\n');
                }
                output.extend(
                    content
                        .chars()
                        .take(32_000usize.saturating_sub(output.chars().count())),
                );
            }
        }
    }
    if let Some(parts) = payload["parts"].as_array() {
        for part in parts {
            plain_parts(part, depth + 1, output);
        }
    }
}
fn limited(value: &Value, count: usize) -> String {
    value.as_str().unwrap_or("").chars().take(count).collect()
}
pub fn message(value: &Value, include_body: bool) -> Value {
    let mut headers = serde_json::Map::new();
    if let Some(items) = value["payload"]["headers"].as_array() {
        for item in items {
            let name = item["name"].as_str().unwrap_or("").to_ascii_lowercase();
            if ["from", "to", "subject", "date"].contains(&name.as_str()) {
                headers.insert(name, json!(limited(&item["value"], 1000)));
            }
        }
    }
    let mut result = json!({ "id": limited(&value["id"], 128), "snippet": limited(&value["snippet"], 2000), "headers": headers });
    if include_body {
        let mut body = String::new();
        plain_parts(&value["payload"], 0, &mut body);
        result["text"] = json!(body);
        result["body_note"] = json!("Somente texto simples, limitado a 32.000 caracteres; HTML e anexos não são carregados.");
    }
    result
}
pub async fn read(input: Read, token: &str, cancel: &CancellationToken) -> Result<Value, String> {
    input.validate()?;
    let client = http_client()?;
    match input {
        Read::GmailList { query } => {
            let list = request(
                client
                    .get("https://gmail.googleapis.com/gmail/v1/users/me/messages")
                    .bearer_auth(token)
                    .query(&[("maxResults", "10"), ("q", query.as_str())]),
                cancel,
            )
            .await?;
            let mut items = Vec::new();
            if let Some(messages) = list["messages"].as_array() {
                for item in messages.iter().take(10) {
                    let id = item["id"]
                        .as_str()
                        .ok_or("ID de mensagem Google inválido.")?;
                    Read::GmailMessage { id: id.into() }.validate()?;
                    let value = request(
                        client
                            .get(format!(
                                "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}"
                            ))
                            .bearer_auth(token)
                            .query(&[
                                ("format", "metadata"),
                                ("metadataHeaders", "From"),
                                ("metadataHeaders", "Subject"),
                                ("metadataHeaders", "Date"),
                            ]),
                        cancel,
                    )
                    .await?;
                    items.push(message(&value, false));
                }
            }
            Ok(json!({ "items": items, "has_more": list["nextPageToken"].is_string() }))
        }
        Read::GmailMessage { id } => {
            let value = request(
                client
                    .get(format!(
                        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}"
                    ))
                    .bearer_auth(token)
                    .query(&[("format", "full")]),
                cancel,
            )
            .await?;
            Ok(message(&value, true))
        }
        Read::DriveList { query } => {
            request(
                client
                    .get("https://www.googleapis.com/drive/v3/files")
                    .bearer_auth(token)
                    .query(&[
                        ("q", drive_query(&query).as_str()),
                        ("pageSize", "20"),
                        ("orderBy", "modifiedTime desc"),
                        (
                            "fields",
                            "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
                        ),
                    ]),
                cancel,
            )
            .await
        }
        Read::CalendarList { query, start, end, page_token } => {
            let time_min = start.clone().unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
            let mut call = client.get("https://www.googleapis.com/calendar/v3/calendars/primary/events")
                .bearer_auth(token).query(&[
                    ("q", query.as_str()), ("maxResults", if start.is_some() { "250" } else { "20" }),
                    ("singleEvents", "true"), ("orderBy", "startTime"), ("timeMin", time_min.as_str()),
                    ("fields", "nextPageToken,items(id,summary,description,start,end,location,status,htmlLink)"),
                ]);
            if let Some(end) = end { call = call.query(&[("timeMax", end)]); }
            if let Some(page) = page_token { call = call.query(&[("pageToken", page)]); }
            request(call, cancel).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pkce_vector_and_authorization_boundaries() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let client = Client {
            client_id: "123456-test.apps.googleusercontent.com".into(),
            client_secret: "GOCSPX-testsecret".into(),
        };
        client.validate().unwrap();
        let nonce = nonce();
        assert_eq!(nonce.len(), 43);
        let url = url::Url::parse(&authorize(
            &client,
            Service::Drive,
            "http://127.0.0.1:1234/google/callback",
            &nonce,
            &nonce,
            false,
        ))
        .unwrap();
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(url.host_str(), Some("accounts.google.com"));
        assert_eq!(pairs["code_challenge_method"], "S256");
        assert_eq!(pairs["include_granted_scopes"], "false");
        assert!(!pairs["scope"].contains("gmail"));
        assert!(!pairs["scope"].contains(Service::Drive.write_scope()));
        let write = url::Url::parse(&authorize(
            &client,
            Service::Drive,
            "http://127.0.0.1:1234/google/callback",
            &nonce,
            &nonce,
            true,
        ))
        .unwrap();
        let write_scope = write
            .query_pairs()
            .find(|(key, _)| key == "scope")
            .unwrap()
            .1
            .into_owned();
        assert!(write_scope.contains(Service::Drive.scope()));
        assert!(write_scope.contains(Service::Drive.write_scope()));
        assert!(granted_write(
            &json!({ "scope": write_scope }),
            Service::Drive
        ));
        assert!(!granted_write(
            &json!({ "scope": Service::Drive.scope() }),
            Service::Drive
        ));
        assert!(!url.as_str().contains(&client.client_secret));
        assert!(Client {
            client_id: "attacker.example".into(),
            ..client
        }
        .validate()
        .is_err());
    }
    #[test]
    fn rejects_wrong_permissions_injection_and_unknown_actions() {
        let mut value = json!({ "access_token": "token-valid-1234567890", "token_type": "Bearer", "scope": format!("{} {EMAIL_SCOPE}", Service::Gmail.scope()) });
        assert!(granted(&value, Service::Gmail));
        assert!(!granted(&value, Service::Drive));
        assert!(access(&value).is_ok());
        value["access_token"] = json!("token\r\nHeader: injected");
        assert!(access(&value).is_err());
        assert!(refresh_token(&value).is_err());
        assert!(
            serde_json::from_value::<Read>(json!({ "action": "gmail_send", "to": "someone" }))
                .is_err()
        );
        assert!(serde_json::from_value::<Read>(
            json!({ "action": "drive_list", "query": "", "url": "http://evil" })
        )
        .is_err());
        assert!(Read::GmailMessage {
            id: "../other".into()
        }
        .validate()
        .is_err());
        assert!(Read::DriveList {
            query: "a".repeat(501)
        }
        .validate()
        .is_err());
        assert_eq!(
            drive_query("' or trashed = true \\"),
            "trashed = false and name contains '\\' or trashed = true \\\\'"
        );
    }
    #[test]
    fn extracts_only_bounded_plain_text_and_selected_headers() {
        let value = json!({ "id": "abc123", "snippet": "Preview", "payload": { "headers": [
            { "name": "Subject", "value": "Subject" }, { "name": "X-Private", "value": "omit" }
        ], "parts": [
            { "mimeType": "text/html", "body": { "data": URL_SAFE_NO_PAD.encode("<script>evil</script>") } },
            { "mimeType": "text/plain", "filename": "attachment.txt", "body": { "data": URL_SAFE_NO_PAD.encode("attachment") } },
            { "mimeType": "text/plain", "body": { "data": URL_SAFE_NO_PAD.encode("Olá 😀".repeat(10000)) } }
        ] } });
        let result = message(&value, true);
        let body = result["text"].as_str().unwrap();
        assert!(!body.contains("script"));
        assert!(!body.contains("attachment"));
        assert!(body.chars().count() <= 32000);
        assert!(result["headers"].get("x-private").is_none());
        assert!(message(&value, false).get("text").is_none());
    }
    #[tokio::test]
    async fn transport_limits_redirects_redacts_errors_and_cancels() {
        use axum::http::StatusCode;
        use axum::{routing::get, Router};
        let app = Router::new()
            .route("/ok", get(|| async { axum::Json(json!({ "ok": true })) }))
            .route(
                "/error",
                get(|| async { (StatusCode::UNAUTHORIZED, "token-and-secret-must-not-leak") }),
            )
            .route(
                "/redirect",
                get(|| async { axum::response::Redirect::temporary("/ok") }),
            )
            .route("/large", get(|| async { "x".repeat(1024 * 1024 + 1) }))
            .route(
                "/slow",
                get(|| async {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    "{}"
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = http_client().unwrap();
        let cancel = CancellationToken::new();
        assert_eq!(
            request(client.get(format!("{base}/ok")), &cancel)
                .await
                .unwrap()["ok"],
            true
        );
        let error = request(client.get(format!("{base}/error")), &cancel)
            .await
            .unwrap_err();
        assert!(!error.contains("token-and-secret"));
        assert!(!error.contains(&base));
        assert!(request(client.get(format!("{base}/redirect")), &cancel)
            .await
            .is_err());
        assert!(request(client.get(format!("{base}/large")), &cancel)
            .await
            .unwrap_err()
            .contains("1 MB"));
        let future = request(client.get(format!("{base}/slow")), &cancel);
        let stop = async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            cancel.cancel();
        };
        let (result, ()) = tokio::join!(future, stop);
        assert!(result.unwrap_err().contains("cancelada"));
        server.abort();
    }
}

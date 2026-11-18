pub use crate::commands::meta_graph::{client, request, VERSION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(test)]
use std::time::Duration;
use tokio_util::sync::CancellationToken;
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    pub page_id: String,
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
            || !id(&self.app_id)
            || self.app_secret.len() != 32
            || !self.app_secret.bytes().all(|b| b.is_ascii_hexdigit())
            || !(20..=1024).contains(&self.access_token.len())
            || !self
                .access_token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-._~+/=".contains(&b))
        {
            return Err("Confira o ID da Página, ID/chave do aplicativo Meta e token de acesso de Página. Não use token de perfil pessoal.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Identity {
    pub id: String,
    pub name: String,
    pub expires_at: Option<i64>,
}
fn proof(credentials: &Credentials) -> String {
    crate::commands::meta_graph::proof(&credentials.app_secret, &credentials.access_token)
}
fn get(credentials: &Credentials, endpoint: &str) -> Result<reqwest::RequestBuilder, String> {
    Ok(client()?
        .get(format!("https://graph.facebook.com/{VERSION}/{endpoint}"))
        .bearer_auth(&credentials.access_token)
        .query(&[("appsecret_proof", proof(credentials))]))
}
pub fn inspect(value: &Value, credentials: &Credentials, now: i64) -> Result<Option<i64>, String> {
    let mut scopes = vec!["pages_read_engagement"];
    if credentials.publishing {
        scopes.push("pages_manage_posts");
    }
    crate::commands::meta_graph::page_token(
        value,
        &credentials.app_id,
        &credentials.page_id,
        &scopes,
        now,
    )
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
        get(credentials, "me")?.query(&[("fields", "id,name")]),
        cancel,
    )
    .await?;
    let name = page["name"]
        .as_str()
        .filter(|v| {
            !v.trim().is_empty() && v.chars().count() <= 128 && !v.chars().any(char::is_control)
        })
        .ok_or("A Meta não confirmou o nome da Página.")?;
    if page["id"] != credentials.page_id {
        return Err("O token pertence a outra Página. A conexão anterior foi preservada.".into());
    }
    Ok(Identity {
        id: credentials.page_id.clone(),
        name: name.into(),
        expires_at,
    })
}
pub async fn posts(credentials: &Credentials, cancel: &CancellationToken) -> Result<Value, String> {
    let value = request(
        get(
            credentials,
            &format!("{}/published_posts", credentials.page_id),
        )?
        .query(&[("fields", "id,message,created_time"), ("limit", "10")]),
        cancel,
    )
    .await?;
    post_list(&value)
}
fn post_list(value: &Value) -> Result<Value, String> {
    let data = value["data"]
        .as_array()
        .ok_or("O Facebook não retornou uma lista de publicações.")?;
    let items: Vec<_> = data.iter().take(10).map(|post| json!({ "id": clipped(&post["id"], 128), "message": clipped(&post["message"], 8000), "created_time": clipped(&post["created_time"], 64) })).collect();
    // Never forward Meta paging URLs, which can contain access tokens.
    Ok(json!({ "items": items, "has_more": value["paging"].get("next").is_some() }))
}
fn clipped(value: &Value, max: usize) -> String {
    value.as_str().unwrap_or("").chars().take(max).collect()
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Post {
    pub message: String,
}
impl Post {
    pub fn validate(&self) -> Result<(), String> {
        if self.message.trim().is_empty()
            || self.message.chars().count() > 8000
            || self.message.contains('\0')
        {
            Err("Use uma publicação de texto com 1 a 8.000 caracteres.".into())
        } else {
            Ok(())
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
pub fn publish_request(
    credentials: &Credentials,
    post: &Post,
) -> Result<reqwest::RequestBuilder, String> {
    post.validate()?;
    credentials.validate()?;
    Ok(client()?
        .post(format!(
            "https://graph.facebook.com/{VERSION}/{}/feed",
            credentials.page_id
        ))
        .bearer_auth(&credentials.access_token)
        .form(&[
            ("message", post.message.as_str()),
            ("published", "true"),
            ("appsecret_proof", &proof(credentials)),
        ]))
}
pub fn receipt(value: &Value, page: &str) -> Result<String, String> {
    let value = value["id"]
        .as_str()
        .filter(|v| v.len() <= 128)
        .ok_or("O Facebook não confirmou o ID da publicação.")?;
    let suffix = value
        .strip_prefix(&format!("{page}_"))
        .filter(|v| id(v))
        .ok_or("O Facebook retornou um ID de publicação incompatível com a Página.")?;
    Ok(format!("{page}_{suffix}"))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn credentials() -> Credentials {
        Credentials {
            page_id: "1234567890".into(),
            app_id: "9876543210".into(),
            app_secret: "0123456789abcdef0123456789abcdef".into(),
            access_token: "test_token_123456789012345".into(),
            publishing: true,
        }
    }
    fn debug() -> Value {
        json!({ "data": { "is_valid": true, "type": "PAGE", "app_id": "9876543210", "profile_id": "1234567890", "expires_at": 0, "data_access_expires_at": 0, "scopes": ["pages_read_engagement", "pages_manage_posts"] } })
    }
    #[test]
    fn refuses_personal_tokens_wrong_app_target_expiry_and_missing_scope() {
        let credentials = credentials();
        credentials.validate().unwrap();
        inspect(&debug(), &credentials, 100).unwrap();
        for (field, value) in [
            ("type", json!("USER")),
            ("app_id", json!("other")),
            ("profile_id", json!("other")),
            ("is_valid", json!(false)),
            ("expires_at", json!(99)),
            ("scopes", json!(["pages_read_engagement"])),
        ] {
            let mut invalid = debug();
            invalid["data"][field] = value;
            assert!(inspect(&invalid, &credentials, 100).is_err());
        }
        let mut no_write = debug();
        no_write["data"]["scopes"] = json!(["pages_read_engagement"]);
        let read_only = Credentials {
            publishing: false,
            ..credentials.clone()
        };
        assert!(inspect(&no_write, &read_only, 100).is_ok());
        assert!(Credentials {
            access_token: "token\r\nAuthorization: injected".into(),
            ..credentials
        }
        .validate()
        .is_err());
    }
    #[test]
    fn outbound_is_fixed_page_text_and_ack_is_bound_to_page() {
        let credentials = credentials();
        let post = Post {
            message: "Olá 😀 & teste".into(),
        };
        let request = publish_request(&credentials, &post)
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(request.method(), reqwest::Method::POST);
        assert_eq!(
            request.url().as_str(),
            "https://graph.facebook.com/v25.0/1234567890/feed"
        );
        let body = std::str::from_utf8(request.body().unwrap().as_bytes().unwrap()).unwrap();
        let form: std::collections::HashMap<_, _> = url::form_urlencoded::parse(body.as_bytes())
            .into_owned()
            .collect();
        assert_eq!(form["message"], post.message);
        assert_eq!(form["published"], "true");
        assert!(form.contains_key("appsecret_proof"));
        assert!(!form.contains_key("access_token"));
        assert!(receipt(&json!({ "id": "other_123" }), &credentials.page_id).is_err());
        assert_eq!(
            receipt(&json!({ "id": "1234567890_456" }), &credentials.page_id).unwrap(),
            "1234567890_456"
        );
        assert!(
            serde_json::from_value::<Post>(json!({ "message": "test", "page_id": "other" }))
                .is_err()
        );
        assert!(Post {
            message: "a".repeat(8001)
        }
        .validate()
        .is_err());
    }
    #[test]
    fn posts_never_expose_paging_credentials_or_html_execution() {
        let result = post_list(&json!({ "data": [{ "id": "123_456", "message": "<script>data</script>", "created_time": "2026-11-03", "access_token": "must-not-leak" }], "paging": { "next": "https://graph.facebook.com/?access_token=must-not-leak" } })).unwrap();
        assert!(!result.to_string().contains("must-not-leak"));
        assert_eq!(result["has_more"], true);
        assert_eq!(result["items"][0]["message"], "<script>data</script>");
    }
    #[tokio::test]
    async fn transport_redacts_error_bodies_refuses_redirects_and_cancels() {
        use axum::{http::StatusCode, routing::get, Router};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let router = Router::new()
            .route(
                "/error",
                get(|| async { (StatusCode::BAD_REQUEST, "secret-token-error") }),
            )
            .route(
                "/redirect",
                get(|| async { axum::response::Redirect::temporary("/ok") }),
            )
            .route("/ok", get(|| async { axum::Json(json!({ "ok": true })) }))
            .route("/large", get(|| async { "x".repeat(1024 * 1024 + 1) }))
            .route(
                "/slow",
                get(|| async {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    "{}"
                }),
            );
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let client = client().unwrap();
        let cancel = CancellationToken::new();
        let error = request(client.get(format!("{base}/error")), &cancel)
            .await
            .unwrap_err();
        assert!(!error.contains("secret-token"));
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

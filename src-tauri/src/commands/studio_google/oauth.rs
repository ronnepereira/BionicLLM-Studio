use axum::{
    extract::{Query, State},
    http::{HeaderMap, Method, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::{oneshot, Mutex};
use tokio_util::sync::CancellationToken;

type Callback = Arc<Context>;
struct Context {
    state: String,
    host: String,
    sender: Mutex<Option<oneshot::Sender<Result<String, String>>>>,
}
fn matching(expected: &str, value: &str) -> bool {
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, b"bionic-google-oauth-state");
    ring::hmac::verify(
        &key,
        value.as_bytes(),
        ring::hmac::sign(&key, expected.as_bytes()).as_ref(),
    )
    .is_ok()
}
fn callback_result(
    query: &HashMap<String, String>,
    expected: &str,
) -> Option<Result<String, String>> {
    if !query.get("state").is_some_and(|s| matching(expected, s)) {
        return None;
    }
    if query.contains_key("error") {
        return Some(Err(
            "A autorização foi recusada ou cancelada no Google.".into()
        ));
    }
    query
        .get("code")
        .filter(|v| !v.is_empty() && v.len() <= 2048 && !v.chars().any(char::is_control))
        .map(|v| Ok(v.clone()))
}
async fn callback(
    State(context): State<Callback>,
    method: Method,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let safe = method == Method::GET
        && headers.get("host").and_then(|h| h.to_str().ok()) == Some(context.host.as_str())
        && !headers.contains_key("origin")
        && headers
            .get("sec-fetch-mode")
            .is_none_or(|h| h == "navigate")
        && headers
            .get("sec-fetch-dest")
            .is_none_or(|h| h == "document");
    let result = if safe {
        callback_result(&query, &context.state)
    } else {
        None
    };
    let (status, body) = match result {
        Some(result) => {
            if let Some(sender) = context.sender.lock().await.take() {
                let success = result.is_ok();
                let _ = sender.send(result);
                (
                    StatusCode::OK,
                    if success {
                        "Autorização recebida. Volte ao BionicLLM Studio para conferir a conexão."
                    } else {
                        "Autorização cancelada. Volte ao BionicLLM Studio."
                    },
                )
            } else {
                (StatusCode::GONE, "Esta autorização já foi recebida.")
            }
        }
        None => (StatusCode::BAD_REQUEST, "Retorno de autorização inválido."),
    };
    (
        status,
        [
            ("cache-control", "no-store"),
            ("referrer-policy", "no-referrer"),
            (
                "content-security-policy",
                "default-src 'none'; frame-ancestors 'none'",
            ),
        ],
        body,
    )
}
pub async fn connect(
    app: &tauri::AppHandle,
    client: &super::api::Client,
    service: super::api::Service,
    write_access: bool,
    cancel: &CancellationToken,
) -> Result<serde_json::Value, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "Não foi possível abrir o retorno local do Google.".to_string())?;
    let host = listener
        .local_addr()
        .map_err(|_| "Porta local do Google indisponível.".to_string())?
        .to_string();
    let redirect = format!("http://{host}/google/callback");
    let state = super::api::nonce();
    let verifier = super::api::nonce();
    let auth_url =
        super::api::authorize(client, service, &redirect, &state, &verifier, write_access);
    let (sender, receiver) = oneshot::channel();
    let context = Arc::new(Context {
        state,
        host,
        sender: Mutex::new(Some(sender)),
    });
    let router = Router::new()
        .route("/google/callback", get(callback))
        .with_state(context);
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    struct AbortServer(tokio::task::JoinHandle<()>);
    impl Drop for AbortServer {
        fn drop(&mut self) {
            self.0.abort();
        }
    }
    let _server = AbortServer(server);
    if cancel.is_cancelled() {
        return Err("Operação Google cancelada.".into());
    }
    use tauri_plugin_shell::ShellExt;
    #[allow(deprecated)]
    app.shell().open(auth_url, None).map_err(|_| {
        "Não foi possível abrir o navegador do sistema para autorizar o Google.".to_string()
    })?;
    let code = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err("Operação Google cancelada.".into()),
        result = tokio::time::timeout(Duration::from_secs(180), receiver) => result.map_err(|_| "Tempo esgotado. Tente conectar ao Google novamente.".to_string())?.map_err(|_| "Retorno Google interrompido.".to_string())??,
    };
    super::api::exchange(client, &code, &redirect, &verifier, cancel).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_foreign_state_and_sanitizes_denial() {
        let mut q = HashMap::from([
            ("state".into(), "foreign".into()),
            ("code".into(), "valid-code".into()),
        ]);
        assert!(callback_result(&q, "expected").is_none());
        q.insert("state".into(), "expected".into());
        assert_eq!(
            callback_result(&q, "expected"),
            Some(Ok("valid-code".into()))
        );
        q.insert("error".into(), "secret-or-attacker-content".into());
        let error = callback_result(&q, "expected").unwrap().unwrap_err();
        assert!(!error.contains("secret-or-attacker"));
        q.remove("error");
        q.insert("code".into(), "\r\n".into());
        assert!(callback_result(&q, "expected").is_none());
    }
    #[tokio::test]
    async fn callback_rejects_foreign_origins_host_head_and_replay() {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        let (sender, mut receiver) = oneshot::channel();
        let context = Arc::new(Context {
            state: "known-state".into(),
            host: "127.0.0.1:1234".into(),
            sender: Mutex::new(Some(sender)),
        });
        let router = Router::new()
            .route("/google/callback", get(callback))
            .with_state(context);
        for (method, host, origin, state) in [
            ("GET", "evil.example", false, "known-state"),
            ("GET", "127.0.0.1:1234", true, "known-state"),
            ("HEAD", "127.0.0.1:1234", false, "known-state"),
            ("GET", "127.0.0.1:1234", false, "wrong-state"),
        ] {
            let mut request = Request::builder()
                .method(method)
                .uri(format!("/google/callback?state={state}&code=test-code"))
                .header("host", host);
            if origin {
                request = request.header("origin", "https://evil.example");
            }
            assert_eq!(
                router
                    .clone()
                    .oneshot(request.body(Body::empty()).unwrap())
                    .await
                    .unwrap()
                    .status(),
                StatusCode::BAD_REQUEST
            );
            assert!(receiver.try_recv().is_err());
        }
        let request = || {
            Request::builder()
                .uri("/google/callback?state=known-state&code=test-code")
                .header("host", "127.0.0.1:1234")
                .body(Body::empty())
                .unwrap()
        };
        let response = router.clone().oneshot(request()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(receiver.await.unwrap().unwrap(), "test-code");
        assert_eq!(
            router.oneshot(request()).await.unwrap().status(),
            StatusCode::GONE
        );
    }
}

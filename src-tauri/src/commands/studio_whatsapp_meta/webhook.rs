use super::*;
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Query, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub(super) fn router(rt: Arc<Receiver>) -> Router {
    Router::new()
        .route(WEBHOOK_PATH, get(verify).post(receive))
        .layer(DefaultBodyLimit::max(256 * 1024))
        .layer(middleware::from_fn_with_state(rt.clone(), limit))
        .with_state(rt)
}
async fn limit(State(rt): State<Arc<Receiver>>, request: Request, next: Next) -> Response {
    let Ok(_permit) = rt.slots.try_acquire() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match tokio::time::timeout(Duration::from_secs(15), next.run(request)).await {
        Ok(response) => response,
        Err(_) => StatusCode::REQUEST_TIMEOUT.into_response(),
    }
}
async fn verify(
    State(rt): State<Arc<Receiver>>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if rt.cancel.is_cancelled() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let valid = query
        .get("hub.mode")
        .is_some_and(|mode| mode == "subscribe")
        && query.get("hub.verify_token").is_some_and(|token| {
            token.len() <= 64 && api::token_matches(&rt.credentials.verify_token, token)
        });
    if !valid {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(challenge) = query
        .get("hub.challenge")
        .filter(|value| !value.is_empty() && value.len() <= 256)
    else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    rt.state.lock().await.verified_at = Some(now());
    (
        [("content-type", "text/plain; charset=utf-8")],
        challenge.clone(),
    )
        .into_response()
}
fn events(
    payload: &Value,
    phone_id: &str,
    own_phone: &str,
) -> Result<(bool, Vec<Value>), StatusCode> {
    if payload["object"] != "whatsapp_business_account" {
        return Ok((false, Vec::new()));
    }
    let entries = payload["entry"]
        .as_array()
        .filter(|rows| rows.len() <= 100)
        .ok_or(StatusCode::BAD_REQUEST)?;
    let mut result = Vec::new();
    let mut matched = false;
    for entry in entries {
        let Some(changes) = entry["changes"].as_array().filter(|rows| rows.len() <= 100) else {
            continue;
        };
        for change in changes {
            let value = &change["value"];
            if change["field"] != "messages"
                || value["messaging_product"] != "whatsapp"
                || value["metadata"]["phone_number_id"].as_str() != Some(phone_id)
            {
                continue;
            }
            matched = true;
            let Some(messages) = value["messages"]
                .as_array()
                .filter(|rows| rows.len() <= 100)
            else {
                continue;
            };
            for message in messages {
                if message["type"] != "text" {
                    continue;
                }
                let (Some(from), Some(id), Some(text), Some(date)) = (
                    message["from"].as_str(),
                    message["id"].as_str(),
                    message["text"]["body"].as_str(),
                    message["timestamp"]
                        .as_str()
                        .and_then(|v| v.parse::<i64>().ok()),
                ) else {
                    continue;
                };
                if from == own_phone
                    || !(7..=15).contains(&from.len())
                    || !from.bytes().all(|b| b.is_ascii_digit())
                    || id.is_empty()
                    || id.len() > 512
                    || !window_open(Some(date), now())
                {
                    continue;
                }
                result.push(json!({"chat_id":format!("{from}@s.whatsapp.net"),"remote_id":api::hex(&Sha256::digest(id.as_bytes())),"text":text,"timestamp":date}));
                if result.len() > 100 {
                    return Err(StatusCode::BAD_REQUEST);
                }
            }
        }
    }
    Ok((matched, result))
}
async fn receive(State(rt): State<Arc<Receiver>>, headers: HeaderMap, body: Bytes) -> StatusCode {
    if rt.cancel.is_cancelled() {
        return StatusCode::SERVICE_UNAVAILABLE;
    }
    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !api::signature(&rt.credentials.app_secret, &body, signature) {
        return StatusCode::UNAUTHORIZED;
    }
    let payload: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => return StatusCode::BAD_REQUEST,
    };
    let (matched, events) = match events(&payload, &rt.credentials.phone_id, &rt.own_phone) {
        Ok(value) => value,
        Err(status) => return status,
    };
    let mut state = rt.state.lock().await;
    if rt.cancel.is_cancelled() {
        return StatusCode::SERVICE_UNAVAILABLE;
    }
    if matched {
        state.last_event_at = Some(now());
    }
    for event in events {
        match state.saved.journal.incoming(&event, rt.since) {
            Ok(true) => {
                if let Err(error) = state.saved.save(&rt.path) {
                    state.error = Some(error);
                    rt.cancel.cancel();
                    rt.notify.notify_one();
                    return StatusCode::SERVICE_UNAVAILABLE;
                }
            }
            Ok(false) => {}
            Err(error) => {
                state.error = Some(error);
                rt.notify.notify_one();
                return StatusCode::SERVICE_UNAVAILABLE;
            }
        }
    }
    rt.notify.notify_one();
    StatusCode::OK
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;
    struct Fixture {
        rt: Arc<Receiver>,
        dir: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join(format!("meta-webhook-probe-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let credentials = test_credentials();
            let mut saved = Saved::default();
            saved.settings = Settings {
                public_url: format!("https://example.com{WEBHOOK_PATH}"),
                port: 18782,
            };
            saved.journal.account = format!("meta:{}", credentials.phone_id);
            saved.journal.config = Config {
                chats: vec!["5511999999999@s.whatsapp.net".into()],
                agent_id: "profile".into(),
                auto_reply: false,
            };
            let path = dir.join("journal.json");
            saved.save(&path).unwrap();
            let rt = Arc::new(Receiver {
                id: "test-session".into(),
                credentials,
                identity: Identity {
                    phone_id: "123456789012345".into(),
                    display_phone: "5511888888888".into(),
                    name: "Teste".into(),
                },
                own_phone: "5511888888888".into(),
                since: now() - 1,
                path,
                cancel: CancellationToken::new(),
                state: Mutex::new(super::super::State {
                    saved,
                    inflight: None,
                    verified_at: None,
                    last_event_at: None,
                    error: None,
                }),
                notify: Notify::new(),
                slots: Semaphore::new(16),
                task: Mutex::new(None),
            });
            Self { rt, dir }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.rt.cancel.cancel();
            let _ = std::fs::remove_file(&self.rt.path);
            let _ = std::fs::remove_dir(&self.dir);
        }
    }
    fn payload(phone: &str, messages: Value) -> Value {
        json!({"object":"whatsapp_business_account","entry":[{"id":"WABA-test","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"phone_number_id":phone},"messages":messages}}]}]})
    }
    fn message(id: &str, from: &str) -> Value {
        json!({"id":id,"from":from,"type":"text","text":{"body":"Olá!"},"timestamp":now().to_string()})
    }
    fn post(rt: &Receiver, raw: Vec<u8>) -> Request<Body> {
        let signature = format!("sha256={}", api::mac(&rt.credentials.app_secret, &raw));
        Request::builder()
            .method("POST")
            .uri(WEBHOOK_PATH)
            .header("content-type", "application/json")
            .header("x-hub-signature-256", signature)
            .body(Body::from(raw))
            .unwrap()
    }
    #[tokio::test]
    async fn verification_echoes_only_the_matching_challenge_and_stops_with_the_receiver() {
        let fixture = Fixture::new();
        let rt = fixture.rt.clone();
        let app = router(rt.clone());
        let uri = format!(
            "{WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token={}&hub.challenge=12345",
            rt.credentials.verify_token
        );
        let response = app
            .clone()
            .oneshot(Request::builder().uri(&uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            &to_bytes(response.into_body(), 1024).await.unwrap()[..],
            b"12345"
        );
        assert!(rt.state.lock().await.verified_at.is_some());
        let wrong =
            format!("{WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345");
        assert_eq!(
            app.clone()
                .oneshot(Request::builder().uri(wrong).body(Body::empty()).unwrap())
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        rt.cancel.cancel();
        assert_eq!(
            app.oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap()
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
    #[tokio::test]
    async fn raw_signature_is_required_before_json_and_body_size_is_bounded() {
        let fixture = Fixture::new();
        let app = router(fixture.rt.clone());
        assert_eq!(
            app.clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(WEBHOOK_PATH)
                        .body(Body::from("not-json"))
                        .unwrap()
                )
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let mut tampered = post(&fixture.rt, b"{}".to_vec());
        *tampered.body_mut() = Body::from("{ }");
        assert_eq!(
            app.clone().oneshot(tampered).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            app.clone()
                .oneshot(post(&fixture.rt, b"not-json".to_vec()))
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            app.oneshot(
                Request::builder()
                    .method("POST")
                    .uri(WEBHOOK_PATH)
                    .body(Body::from(vec![b'x'; 256 * 1024 + 1]))
                    .unwrap()
            )
            .await
            .unwrap()
            .status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert!(fixture
            .rt
            .state
            .lock()
            .await
            .saved
            .journal
            .history
            .is_empty());
    }
    #[tokio::test]
    async fn only_this_phone_allowed_senders_and_recent_text_are_queued_once() {
        let fixture = Fixture::new();
        let rt = fixture.rt.clone();
        let app = router(rt.clone());
        let foreign = payload(
            "999999999",
            json!([message("wamid.foreign", "5511999999999")]),
        );
        assert_eq!(
            app.clone()
                .oneshot(post(&rt, serde_json::to_vec(&foreign).unwrap()))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert!(rt.state.lock().await.last_event_at.is_none());
        let mut old = message("wamid.old", "5511999999999");
        old["timestamp"] = json!((now() - 86401).to_string());
        let mut media = message("wamid.media", "5511999999999");
        media["type"] = json!("image");
        let body = payload(
            &rt.credentials.phone_id,
            json!([
                message("wamid.new==", "5511999999999"),
                message("wamid.stranger", "5511777777777"),
                message("wamid.self", "5511888888888"),
                old,
                media
            ]),
        );
        for _ in 0..2 {
            assert_eq!(
                app.clone()
                    .oneshot(post(&rt, serde_json::to_vec(&body).unwrap()))
                    .await
                    .unwrap()
                    .status(),
                StatusCode::OK
            );
        }
        let state = rt.state.lock().await;
        assert_eq!(state.saved.journal.history.len(), 1);
        assert_eq!(state.saved.journal.history[0].status, "received");
        assert!(state.saved.journal.history[0].source_at.is_some());
        assert!(state.last_event_at.is_some());
        assert_eq!(Saved::load(&rt.path).unwrap().journal.history.len(), 1);
    }
    #[tokio::test]
    async fn a_full_queue_preserves_accepted_messages_and_retries_do_not_duplicate_them() {
        let fixture = Fixture::new();
        let rt = fixture.rt.clone();
        let app = router(rt.clone());
        let messages: Vec<_> = (0..21)
            .map(|i| message(&format!("wamid.{i}"), "5511999999999"))
            .collect();
        let body = payload(&rt.credentials.phone_id, json!(messages));
        assert_eq!(
            app.clone()
                .oneshot(post(&rt, serde_json::to_vec(&body).unwrap()))
                .await
                .unwrap()
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(rt.state.lock().await.saved.journal.history.len(), 20);
        assert!(!rt.cancel.is_cancelled());
        {
            let mut state = rt.state.lock().await;
            state.saved.journal.history[0].status = "sent".into();
            state.saved.save(&rt.path).unwrap();
        }
        assert_eq!(
            app.oneshot(post(&rt, serde_json::to_vec(&body).unwrap()))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert_eq!(rt.state.lock().await.saved.journal.history.len(), 20);
        assert_eq!(rt.state.lock().await.saved.journal.seen.len(), 21);
    }
}

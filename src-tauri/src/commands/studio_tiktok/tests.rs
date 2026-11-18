use super::*;
use crate::commands::{
    connector_media as files,
    review_actions::{Draft, Entry, Journal, Phase, ReviewInput},
};
use serde_json::json;
fn credentials() -> Credentials {
    Credentials {
        client_key: "client123".into(),
        client_secret: "secret12345678".into(),
        refresh_token: "rft.test1234567890".into(),
        uploading: true,
        read_videos: true,
    }
}
fn authorization() -> Value {
    json!({"access_token":"act.test1234567890","refresh_token":"rft.rotated1234567890","token_type":"Bearer","open_id":"account123","expires_in":86400,"refresh_expires_in":31536000,"scope":"user.info.basic,video.list,video.upload"})
}
fn media() -> Media {
    Media {
        id: uuid::Uuid::new_v4().to_string(),
        name: "sample.mp4".into(),
        size: 20_000_123,
        mime: "video/mp4".into(),
        sha256: "a".repeat(64),
    }
}
#[test]
fn renewable_authorization_is_app_bound_and_requires_selected_scopes_and_expiry() {
    let input = credentials();
    let valid = tokens(&authorization(), &input).unwrap();
    assert_eq!(valid.refresh, "rft.rotated1234567890");
    for (field, value) in [
        ("scope", json!("user.info.basic,video.list")),
        ("scope", json!("user.info.basic,video.upload")),
        ("scope", json!("video.upload,video.list")),
        ("token_type", json!("Other")),
        ("error", json!({"code":"invalid_grant"})),
        ("error", json!("invalid_grant")),
        ("expires_in", json!(0)),
        ("refresh_expires_in", json!(0)),
        ("open_id", json!("../foreign")),
        ("access_token", json!("token\r\nInjected: header")),
    ] {
        let mut denied = authorization();
        denied[field] = value;
        assert!(tokens(&denied, &input).is_err());
    }
    let read_only = Credentials {
        uploading: false,
        read_videos: false,
        ..input.clone()
    };
    let mut basic = authorization();
    basic["scope"] = json!("user.info.basic");
    assert!(tokens(&basic, &read_only).is_ok());
    let request = refresh_request(&input).unwrap().build().unwrap();
    assert_eq!(
        request.url().as_str(),
        "https://open.tiktokapis.com/v2/oauth/token/"
    );
    assert_eq!(request.method(), reqwest::Method::POST);
    assert!(request.headers()["content-type"]
        .to_str()
        .unwrap()
        .starts_with("application/x-www-form-urlencoded"));
    assert!(request.url().query().is_none());
}
#[test]
fn profile_and_public_video_results_are_bounded_inert_and_identity_bound() {
    let value = json!({"error":{"code":"ok"},"data":{"user":{"open_id":"account123","display_name":"<b>Data</b>"}}});
    assert_eq!(
        profile(&value, "account123").unwrap().display_name,
        "<b>Data</b>"
    );
    assert!(profile(&value, "other").is_err());
    assert!(data(
        &json!({"error":{"code":"spam_risk_too_many_posts","message":"secret"},"data":{}})
    )
    .unwrap_err()
    .find("secret")
    .is_none());
    let result=video_list(&json!({"error":{"code":"ok"},"data":{"videos":[{"id":"12345","title":"<script>data</script>","secret":"private"},{"id":"../invalid"}],"has_more":true,"cursor":"secret","url":"https://evil.example"}})).unwrap();
    assert_eq!(result["items"].as_array().unwrap().len(), 1);
    assert_eq!(result["items"][0]["title"], "<script>data</script>");
    assert!(!result.to_string().contains("secret"));
    assert_eq!(result["has_more"], true);
}
#[test]
fn inbox_initialization_contains_only_file_source_never_local_notes_or_direct_post_metadata() {
    let input = media();
    let request = init_request(&input, "act.test").unwrap().build().unwrap();
    assert_eq!(
        request.url().as_str(),
        "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
    );
    let value: Value = serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
    assert_eq!(
        value,
        json!({"source_info":{"source":"FILE_UPLOAD","video_size":20_000_123,"chunk_size":10_000_000,"total_chunk_count":2}})
    );
    assert!(supported(&Media {
        mime: "video/x-matroska".into(),
        ..input
    })
    .is_err());
}
#[test]
fn chunk_plan_obeys_floor_count_minimum_and_trailing_bytes_protocol() {
    for total in [
        1,
        4_999_999,
        5_000_000,
        9_999_999,
        10_000_000,
        10_000_001,
        19_999_999,
        20_000_123,
        64_000_001,
        files::MAX_SIZE,
    ] {
        let (size, count) = chunks(total).unwrap();
        let mut sum = 0;
        for index in 0..count {
            let length = if index + 1 == count {
                total - sum
            } else {
                size
            };
            assert!(length > 0 && length < 20_000_000);
            if count > 1 {
                assert!(length >= 5_000_000);
            }
            sum += length;
        }
        assert_eq!(sum, total);
        assert_eq!(count, total / size);
    }
    assert!(chunks(0).is_err());
    assert!(chunks(files::MAX_SIZE + 1).is_err());
}
#[test]
fn signed_upload_urls_allow_only_documented_origins_without_api_bearer_forwarding() {
    let valid = "https://open-upload.tiktokapis.com/video/?upload_id=123&upload_token=secret";
    assert!(upload_url(valid).is_ok());
    assert!(
        upload_url(&valid.replace("open-upload.tiktokapis.com", "upload.us.tiktokapis.com"))
            .is_ok()
    );
    for value in [
        valid.replace("https:", "http:"),
        valid.replace("open-upload.tiktokapis.com", "evil.example"),
        valid.replace("/video/", "/other/"),
        format!("{valid}#fragment"),
        format!("{valid}&upload_token=other"),
        valid.replace(
            "open-upload.tiktokapis.com",
            "user@open-upload.tiktokapis.com",
        ),
    ] {
        assert!(upload_url(&value).is_err());
    }
    let request = chunk_request(
        &client().unwrap(),
        upload_url(valid).unwrap(),
        &media(),
        10_000_000,
        vec![0; 10_000_123],
    )
    .unwrap()
    .build()
    .unwrap();
    assert!(request.headers().get("authorization").is_none());
    assert_eq!(
        request.headers()["content-range"],
        "bytes 10000000-20000122/20000123"
    );
    assert_eq!(request.headers()["content-length"], "10000123");
}
#[test]
fn processing_status_never_confuses_initialization_inbox_and_publication() {
    assert!(!publish_id("v_inbox_file~"));
    assert!(publish_id("v_inbox_file~v2.123456789"));
    assert!(!publish_id("v_pub_file~v2.123"));
    for state in [
        "PROCESSING_UPLOAD",
        "SEND_TO_USER_INBOX",
        "PUBLISH_COMPLETE",
        "FAILED",
    ] {
        assert_eq!(
            status_value(
                &json!({"error":{"code":"ok"},"data":{"status":state,"fail_reason":"secret"}})
            )
            .unwrap()["status"],
            state
        );
    }
    assert!(status_value(&json!({"error":{"code":"ok"},"data":{"status":"UNKNOWN"}})).is_err());
}
#[test]
fn local_proposals_preserve_file_and_note_but_reject_different_account_concession_and_replay() {
    use super::super::{Input, Proposal};
    let file = media();
    let proposal = Proposal {
        metadata: Input {
            file_id: file.id.clone(),
            note: "Notas locais 😀".into(),
        },
        file,
    };
    proposal.validate().unwrap();
    let mut invalid = proposal.clone();
    invalid.metadata.note = "😀".repeat(1101);
    assert!(invalid.validate().is_err());
    invalid = proposal.clone();
    invalid.metadata.file_id = "C:/secret".into();
    assert!(invalid.validate().is_err());
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("actions.json");
    let binding = uuid::Uuid::new_v4().to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let mut journal = Journal::<Proposal>::default();
    journal.entries.push(Entry {
        binding: binding.clone(),
        draft: Draft {
            id: id.clone(),
            account: "account123".into(),
            input: proposal,
            phase: Phase::Pending,
            created_at: 1,
            remote_id: None,
        },
    });
    journal.save(&path).unwrap();
    let mut journal = Journal::<Proposal>::load(&path).unwrap();
    assert!(journal.begin(&id, "other", &binding).is_err());
    assert!(journal
        .begin(&id, "account123", &uuid::Uuid::new_v4().to_string())
        .is_err());
    journal.begin(&id, "account123", &binding).unwrap();
    journal.save(&path).unwrap();
    assert!(Journal::<Proposal>::load(&path)
        .unwrap()
        .begin(&id, "account123", &binding)
        .is_err());
}
#[tokio::test]
async fn transport_handles_json_errors_body_limits_sequential_ack_redirect_and_stop() {
    use axum::{
        body::Bytes,
        http::{HeaderMap, StatusCode},
        routing::{get, put},
        Router,
    };
    let router = Router::new()
        .route(
            "/chunk",
            put(|headers: HeaderMap, body: Bytes| async move {
                assert!(headers.get("authorization").is_none());
                assert_eq!(headers["content-range"], "bytes 0-3/4");
                assert_eq!(body.as_ref(), b"test");
                StatusCode::CREATED
            }),
        )
        .route("/partial", put(|| async { StatusCode::PARTIAL_CONTENT }))
        .route(
            "/denied",
            get(|| async { (StatusCode::FORBIDDEN, "secret remote body") }),
        )
        .route(
            "/semantic",
            get(|| async {
                axum::Json(
                    json!({"error":{"code":"scope_not_authorized","message":"secret"},"data":{}}),
                )
            }),
        )
        .route(
            "/redirect",
            get(|| async { (StatusCode::TEMPORARY_REDIRECT, [("location", "/denied")]) }),
        )
        .route("/large", get(|| async { "x".repeat(1024 * 1024 + 1) }))
        .route(
            "/wait",
            get(|| async { std::future::pending::<String>().await }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let http = client().unwrap();
    let cancel = CancellationToken::new();
    let small = Media { size: 4, ..media() };
    send_chunk(
        chunk_request(
            &http,
            url::Url::parse(&format!("{base}/chunk")).unwrap(),
            &small,
            0,
            b"test".to_vec(),
        )
        .unwrap(),
        true,
        &cancel,
    )
    .await
    .unwrap();
    send_chunk(http.put(format!("{base}/partial")), false, &cancel)
        .await
        .unwrap();
    assert!(
        send_chunk(http.put(format!("{base}/partial")), true, &cancel)
            .await
            .is_err()
    );
    for path in ["denied", "redirect", "large"] {
        let error = request(http.get(format!("{base}/{path}")), &cancel)
            .await
            .unwrap_err();
        assert!(!error.contains("secret") && !error.contains(&base));
    }
    let value = request(http.get(format!("{base}/semantic")), &cancel)
        .await
        .unwrap();
    assert!(!data(&value).unwrap_err().contains("secret"));
    let pending = request(http.get(format!("{base}/wait")), &cancel);
    cancel.cancel();
    assert!(pending.await.unwrap_err().contains("cancelada"));
    server.abort();
}

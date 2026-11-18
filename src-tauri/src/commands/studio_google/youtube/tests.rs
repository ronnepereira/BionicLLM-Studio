use super::*;
use serde_json::json;
const CHANNEL: &str = "UCabcdefghijklmnopqrstuv";
fn input() -> Upload {
    Upload {
        file_id: uuid::Uuid::new_v4().to_string(),
        title: "Meu vídeo 😀".into(),
        description: "Descrição\n#Shorts".into(),
        category_id: "22".into(),
        privacy: "private".into(),
        made_for_kids: false,
        contains_synthetic_media: true,
        intended_short: true,
    }
}
fn media(root: &std::path::Path) -> Media {
    let source = root.join("source.mp4");
    std::fs::write(&source, b"\0\0\0\x18ftypisom0000fake-video-fixture").unwrap();
    files::snapshot(&root.join("files"), &source, &CancellationToken::new()).unwrap()
}
#[test]
fn oauth_keeps_youtube_reading_and_upload_grants_separate_from_other_services() {
    let client = google::Client {
        client_id: "test.apps.googleusercontent.com".into(),
        client_secret: "secret123456".into(),
    };
    for write in [false, true] {
        let url = url::Url::parse(&google::authorize(
            &client,
            Service::Youtube,
            "http://127.0.0.1:1/google/callback",
            "state",
            "verifier",
            write,
        ))
        .unwrap();
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        let scope = &pairs["scope"];
        assert!(scope.contains(Service::Youtube.scope()));
        assert_eq!(scope.contains(Service::Youtube.write_scope()), write);
        assert!(
            !scope.contains("gmail") && !scope.contains("drive") && !scope.contains("calendar")
        );
        assert_eq!(pairs["code_challenge_method"], "S256");
        assert_eq!(pairs["include_granted_scopes"], "false");
        assert!(google::granted(&json!({"scope":scope}), Service::Youtube));
        assert_eq!(
            google::granted_write(&json!({"scope":scope}), Service::Youtube),
            write
        );
    }
    assert!(!google::granted(
        &json!({"scope": format!("{} {}", Service::Gmail.scope(), google::EMAIL_SCOPE)}),
        Service::Youtube
    ));
}
#[test]
fn channel_identity_is_exact_single_and_never_follows_paging_or_other_channels() {
    let row = json!({"id":CHANNEL,"snippet":{"title":"Meu canal"},"contentDetails":{"relatedPlaylists":{"uploads":"UUabcdefghijklmnopqrstuv"}}});
    assert_eq!(
        api::parse_channel(&json!({"items":[row.clone()]}))
            .unwrap()
            .id,
        CHANNEL
    );
    assert!(api::parse_channel(&json!({"items":[]})).is_err());
    assert!(api::parse_channel(&json!({"items":[row.clone(),row.clone()]})).is_err());
    assert!(api::parse_channel(&json!({"items":[row],"nextPageToken":"secret"})).is_err());
    assert!(same_channel("a@example.com", CHANNEL, "a@example.com", CHANNEL).is_ok());
    assert!(same_channel("a@example.com", CHANNEL, "b@example.com", CHANNEL).is_err());
    assert!(same_channel("a@example.com", CHANNEL, "a@example.com", "UCother").is_err());
    let list = api::video_list(&json!({"items":[{"id":"abcdefghijk","snippet":{"channelId":CHANNEL,"title":"<script>data</script>"},"status":{"privacyStatus":"private"},"hidden":"secret"},{"id":"lmnopqrstuv","snippet":{"channelId":"other"}}],"nextPageToken":"secret"}), CHANNEL, true).unwrap();
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
    assert_eq!(list["items"][0]["title"], "<script>data</script>");
    assert!(!list.to_string().contains("secret"));
}
#[test]
fn snapshot_is_picker_owned_bounded_validated_and_checked_again_before_upload() {
    let root = tempfile::tempdir().unwrap();
    let media = media(root.path());
    assert_eq!(
        files::list(&root.path().join("files")).unwrap(),
        vec![media.clone()]
    );
    std::fs::write(root.path().join("source.mp4"), b"edited original").unwrap();
    assert!(files::checked_file(
        &root.path().join("files"),
        &media,
        &CancellationToken::new()
    )
    .is_ok());
    let path = root
        .path()
        .join("files")
        .join(format!("{}.media", media.id));
    let mut changed = std::fs::read(&path).unwrap();
    changed[20] ^= 1;
    std::fs::write(&path, changed).unwrap();
    assert!(files::checked_file(
        &root.path().join("files"),
        &media,
        &CancellationToken::new()
    )
    .is_err());
    for id in ["../source", "C:\\file", "", "{123}"] {
        assert!(files::get(&root.path().join("files"), id).is_err());
    }
    let fake = root.path().join("fake.mp4");
    std::fs::write(&fake, b"not a video").unwrap();
    assert!(files::snapshot(&root.path().join("files"), &fake, &CancellationToken::new()).is_err());
    let large = root.path().join("large.mp4");
    std::fs::File::create(&large)
        .unwrap()
        .set_len(files::MAX_SIZE + 1)
        .unwrap();
    assert!(files::snapshot(
        &root.path().join("files"),
        &large,
        &CancellationToken::new()
    )
    .is_err());
    files::remove(&root.path().join("files"), &media.id).unwrap();
    assert!(files::list(&root.path().join("files")).unwrap().is_empty());
}
#[test]
fn cancelled_copy_leaves_no_record_and_five_media_limit_is_enforced() {
    let root = tempfile::tempdir().unwrap();
    let selected = media(root.path());
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(files::snapshot(
        &root.path().join("files"),
        &root.path().join("source.mp4"),
        &cancel
    )
    .is_err());
    assert_eq!(files::list(&root.path().join("files")).unwrap().len(), 1);
    for _ in 0..4 {
        media(root.path());
    }
    assert!(files::snapshot(
        &root.path().join("files"),
        &root.path().join("source.mp4"),
        &CancellationToken::new()
    )
    .is_err());
    assert_eq!(
        files::get(&root.path().join("files"), &selected.id).unwrap(),
        selected
    );
}
#[test]
fn payload_requires_explicit_classifications_and_never_forwards_paths_or_shorts_flag() {
    let mut input = input();
    let value = api::metadata(&input).unwrap();
    assert_eq!(value["status"]["privacyStatus"], "private");
    assert_eq!(value["status"]["selfDeclaredMadeForKids"], false);
    assert_eq!(value["status"]["containsSyntheticMedia"], true);
    assert!(value.get("file_id").is_none());
    assert!(value.get("intended_short").is_none());
    for field in [
        "made_for_kids",
        "contains_synthetic_media",
        "intended_short",
    ] {
        let mut serialized = serde_json::to_value(&input).unwrap();
        serialized.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<Upload>(serialized).is_err());
    }
    input.description = "ç".repeat(2501);
    assert!(input.validate().is_err());
    input.description = "<script>".into();
    assert!(input.validate().is_err());
    input.description = String::new();
    input.title = "\r\n".into();
    assert!(input.validate().is_err());
    input.title = "Título".into();
    input.privacy = "unknown".into();
    assert!(input.validate().is_err());
}
#[test]
fn upload_destination_and_receipt_bind_exact_origin_path_channel_and_video() {
    let valid =
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=opaque";
    assert!(api::session_url(valid).is_ok());
    for url in [
        valid.replace("www.googleapis.com", "evil.example"),
        valid.replace("https:", "http:"),
        valid.replace("/upload/youtube/v3/videos", "/other"),
        format!("{valid}#fragment"),
        format!("{valid}&upload_id=other"),
        valid.replace("resumable", "multipart"),
        valid.replace("www.googleapis.com", "secret@www.googleapis.com"),
    ] {
        assert!(api::session_url(&url).is_err(), "{url}");
    }
    let receipt = json!({"id":"abcdefghijk","snippet":{"channelId":CHANNEL},"status":{"privacyStatus":"private"}});
    assert_eq!(api::receipt(&receipt, CHANNEL).unwrap(), "abcdefghijk");
    assert!(api::receipt(&receipt, "other").is_err());
    assert!(api::receipt(&json!({"id":"abcdefghijk"}), CHANNEL).is_err());
    let root = tempfile::tempdir().unwrap();
    let selected = media(root.path());
    let request = api::initiate(&input(), &selected, "test-token")
        .unwrap()
        .build()
        .unwrap();
    assert_eq!(request.method(), reqwest::Method::POST);
    assert_eq!(request.url().host_str(), Some("www.googleapis.com"));
    assert!(request
        .url()
        .query()
        .unwrap()
        .contains("notifySubscribers=false"));
    assert_eq!(
        request.headers()["x-upload-content-length"],
        selected.size.to_string()
    );
}
#[test]
fn proposal_round_trip_preserves_immutable_file_and_journal_rejects_account_binding_and_replay() {
    let root = tempfile::tempdir().unwrap();
    let file = media(root.path());
    let mut metadata = input();
    metadata.file_id = file.id.clone();
    let proposal = Proposal { metadata, file };
    let binding = uuid::Uuid::new_v4().to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let path = root.path().join("actions.json");
    let mut journal = VideoJournal::default();
    journal.entries.push(Entry {
        binding: binding.clone(),
        draft: Draft {
            id: id.clone(),
            account: CHANNEL.into(),
            input: proposal,
            phase: Phase::Pending,
            created_at: 1,
            remote_id: None,
        },
    });
    journal.save(&path).unwrap();
    let mut journal = VideoJournal::load(&path).unwrap();
    assert!(journal
        .begin(&id, CHANNEL, &uuid::Uuid::new_v4().to_string())
        .is_err());
    assert!(journal.begin(&id, "other", &binding).is_err());
    journal.begin(&id, CHANNEL, &binding).unwrap();
    journal.save(&path).unwrap();
    assert!(VideoJournal::load(&path)
        .unwrap()
        .begin(&id, CHANNEL, &binding)
        .is_err());
}

#[tokio::test]
async fn upload_transport_streams_selected_bytes_bounds_ack_redacts_and_cancels_without_redirects()
{
    use axum::{
        body::Bytes,
        http::{HeaderMap, StatusCode},
        routing::{get, put},
        Router,
    };
    let root = tempfile::tempdir().unwrap();
    let selected = media(root.path());
    let expected = std::fs::read(root.path().join("source.mp4")).unwrap();
    let router=Router::new()
        .route("/upload",put(move |headers:HeaderMap,body:Bytes| { let expected=expected.clone(); async move {
            assert_eq!(headers["authorization"],"Bearer test-token");
            assert_eq!(headers["content-type"],"video/mp4");
            assert_eq!(headers["content-length"],expected.len().to_string());
            assert_eq!(body.as_ref(),expected.as_slice());
            axum::Json(json!({"id":"abcdefghijk","snippet":{"channelId":CHANNEL},"status":{"privacyStatus":"private"}}))
        }}))
        .route("/denied",get(||async{(StatusCode::FORBIDDEN,"secret-token remote body")}))
        .route("/redirect",get(||async{(StatusCode::TEMPORARY_REDIRECT,[("location","/denied")],"secret-body")}))
        .route("/large",get(||async{"x".repeat(1024*1024+1)}))
        .route("/wait",get(||async{std::future::pending::<String>().await}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let cancel = CancellationToken::new();
    let client = google::http_client().unwrap();
    let file = files::checked_file(&root.path().join("files"), &selected, &cancel).unwrap();
    let uploaded = api::response(
        client
            .put(format!("{origin}/upload"))
            .bearer_auth("test-token")
            .header("Content-Type", "video/mp4")
            .header("Content-Length", selected.size)
            .body(api::video_body(file)),
        &cancel,
    )
    .await
    .unwrap();
    assert_eq!(
        api::finish(uploaded, CHANNEL, &cancel).await.unwrap(),
        "abcdefghijk"
    );
    for path in ["denied", "redirect"] {
        let error = api::response(client.get(format!("{origin}/{path}")), &cancel)
            .await
            .unwrap_err();
        assert!(!error.contains("secret") && !error.contains(&origin));
    }
    let large = api::response(client.get(format!("{origin}/large")), &cancel)
        .await
        .unwrap();
    assert!(api::finish(large, CHANNEL, &cancel)
        .await
        .unwrap_err()
        .contains("1 MB"));
    let work = api::response(client.get(format!("{origin}/wait")), &cancel);
    cancel.cancel();
    assert!(work.await.unwrap_err().contains("cancelado"));
    server.abort();
}

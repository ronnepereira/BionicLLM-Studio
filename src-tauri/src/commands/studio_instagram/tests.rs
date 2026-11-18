use super::*;
fn credentials() -> Credentials {
    Credentials {
        page_id: "1234567890".into(),
        instagram_id: "17890000000000".into(),
        app_id: "9876543210".into(),
        app_secret: "0123456789abcdef0123456789abcdef".into(),
        access_token: "test_token_123456789012345".into(),
        publishing: true,
    }
}
fn debug() -> Value {
    json!({ "data": { "is_valid": true, "type": "PAGE", "app_id": "9876543210", "profile_id": "1234567890", "expires_at": 0, "data_access_expires_at": 0, "scopes": ["pages_read_engagement", "instagram_basic", "instagram_content_publish"] } })
}
#[test]
fn verifies_app_page_professional_link_and_explicit_publish_permission() {
    let credentials = credentials();
    credentials.validate().unwrap();
    inspect(&debug(), &credentials, 100).unwrap();
    let mut denied = debug();
    denied["data"]["scopes"] = json!(["pages_read_engagement", "instagram_basic"]);
    assert!(inspect(&denied, &credentials, 100).is_err());
    assert!(inspect(
        &denied,
        &Credentials {
            publishing: false,
            ..credentials.clone()
        },
        100
    )
    .is_ok());
    denied["data"]["type"] = json!("USER");
    assert!(inspect(&denied, &credentials, 100).is_err());
    linked_page(
        &json!({ "id": "1234567890", "instagram_business_account": { "id": "17890000000000" } }),
        &credentials,
    )
    .unwrap();
    assert!(linked_page(
        &json!({ "id": "1234567890", "instagram_business_account": { "id": "other" } }),
        &credentials
    )
    .is_err());
    assert!(identity(
        &json!({ "id": "other", "username": "test" }),
        &credentials,
        None
    )
    .is_err());
}
#[test]
fn refuses_local_credentials_fragments_protocols_and_mapped_private_media_urls() {
    for url in [
        "http://example.com/image.jpg",
        "file:///image.jpg",
        "data:image/jpeg;base64,abc",
        "https://user:secret@example.com/image.jpg",
        "https://localhost/image.jpg",
        "https://localhost./image.jpg",
        "https://127.0.0.1/image.jpg",
        "https://[::1]/image.jpg",
        "https://[::ffff:127.0.0.1]/image.jpg",
        "https://10.0.0.1/image.jpg",
        "https://100.64.0.1/image.jpg",
        "https://site.local/image.jpg",
        "https://example.com/image.jpg#fragment",
    ] {
        assert!(!public_url(url), "{url}");
    }
    assert!(public_url(
        "https://media.example.com/image.jpg?signature=public-resource-signature"
    ));
    assert!(Post::Image {
        url: "https://media.example.com/image.jpg".into(),
        caption: "a".repeat(2201)
    }
    .validate()
    .is_err());
    assert!(serde_json::from_value::<Post>(
        json!({ "kind": "story", "url": "https://example.com/image.jpg", "caption": "test" })
    )
    .is_err());
    assert!(serde_json::from_value::<Post>(json!({ "kind": "image", "url": "https://example.com/image.jpg", "caption": "test", "instagram_id": "other" })).is_err());
}
#[test]
fn request_builders_separate_image_reel_processing_and_publication() {
    let credentials = credentials();
    for post in [
        Post::Image {
            url: "https://example.com/image.jpg".into(),
            caption: "Olá 😀".into(),
        },
        Post::Reel {
            url: "https://example.com/video.mp4".into(),
            caption: "Reel".into(),
            share_to_feed: false,
        },
    ] {
        let request = create_request(&credentials, &post)
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(
            request.url().as_str(),
            "https://graph.facebook.com/v25.0/17890000000000/media"
        );
        let form: std::collections::HashMap<_, _> =
            url::form_urlencoded::parse(request.body().unwrap().as_bytes().unwrap())
                .into_owned()
                .collect();
        assert!(form.contains_key("appsecret_proof"));
        assert!(!form.contains_key("access_token"));
        assert!(!form.contains_key("creation_id"));
        match post {
            Post::Image { .. } => {
                assert!(form.contains_key("image_url"));
                assert!(!form.contains_key("media_type"));
            }
            Post::Reel { .. } => {
                assert_eq!(form["media_type"], "REELS");
                assert_eq!(form["share_to_feed"], "false");
            }
        }
    }
    let publish = publish_request(&credentials, "12345")
        .unwrap()
        .build()
        .unwrap();
    assert!(publish.url().path().ends_with("/media_publish"));
    assert!(publish_request(&credentials, "../other").is_err());
}
#[test]
fn only_finished_processing_can_advance_to_publication() {
    assert_eq!(
        processing(&json!({ "id": "123", "status_code": "FINISHED" }), "123").unwrap(),
        Processing::Ready
    );
    assert_eq!(
        processing(&json!({ "status_code": "IN_PROGRESS" }), "123").unwrap(),
        Processing::Pending
    );
    for state in ["ERROR", "EXPIRED", "PUBLISHED", "UNKNOWN"] {
        assert!(processing(&json!({ "status_code": state }), "123").is_err());
    }
    assert!(processing(&json!({ "id": "456", "status_code": "FINISHED" }), "123").is_err());
    assert!(remote_id(&json!({ "id": "malformed-id" })).is_err());
}
#[tokio::test]
async fn cancelled_processing_never_waits_a_minute_or_contacts_meta() {
    let cancel = CancellationToken::new();
    cancel.cancel();
    let result = tokio::time::timeout(
        Duration::from_millis(200),
        wait_ready(&credentials(), "123", &cancel),
    )
    .await
    .unwrap();
    assert!(result.unwrap_err().contains("cancelad"));
}
#[test]
fn media_listing_drops_paging_secrets_and_keeps_content_as_data() {
    let value = media_list(&json!({ "data": [{ "id": "123", "caption": "<script>data</script>", "media_type": "IMAGE", "timestamp": "2026-11-03", "access_token": "secret" }], "paging": { "next": "https://graph.facebook.com/?access_token=secret" } })).unwrap();
    assert!(!value.to_string().contains("secret"));
    assert_eq!(value["has_more"], true);
    assert_eq!(value["items"][0]["caption"], "<script>data</script>");
}
#[test]
fn container_receipt_survives_restart_without_enabling_retry() {
    use crate::commands::review_actions::{Draft, Entry, Journal, Phase};
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("actions.json");
    let binding = uuid::Uuid::new_v4().to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let mut journal: Journal<Post> = Journal {
        entries: vec![Entry {
            binding: binding.clone(),
            draft: Draft {
                id: id.clone(),
                account: "17890000000000".into(),
                input: Post::Image {
                    url: "https://example.com/image.jpg".into(),
                    caption: "caption".into(),
                },
                phase: Phase::Pending,
                created_at: 1,
                remote_id: None,
            },
        }],
    };
    journal.begin(&id, "17890000000000", &binding).unwrap();
    journal.entries[0].draft.remote_id = Some("12345".into());
    journal.save(&file).unwrap();
    let mut restored = Journal::<Post>::load(&file).unwrap();
    assert_eq!(restored.entries[0].draft.phase, Phase::Uncertain);
    assert_eq!(
        restored.entries[0].draft.remote_id.as_deref(),
        Some("12345")
    );
    assert!(restored.begin(&id, "17890000000000", &binding).is_err());
}

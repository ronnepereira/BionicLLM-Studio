use super::*;
fn credentials() -> Credentials {
    Credentials {
        client_id: "testclient123".into(),
        client_secret: "test_secret_12345".into(),
        access_token: "test_token_123456789012345".into(),
        target: Target::Member,
        publishing: true,
        read_posts: false,
    }
}
fn token() -> Value {
    json!({ "active": true, "client_id": "testclient123", "auth_type": "3L", "expires_at": 9999, "scope": "openid,profile,w_member_social" })
}
#[test]
fn token_and_scope_validation_is_bound_to_app_target_and_explicit_capabilities() {
    let credentials = credentials();
    credentials.validate().unwrap();
    inspect(&token(), &credentials, 100).unwrap();
    for (field, value) in [
        ("active", json!(false)),
        ("client_id", json!("another")),
        ("auth_type", json!("2L")),
        ("expires_at", json!(99)),
        ("scope", json!("openid,profile")),
    ] {
        let mut denied = token();
        denied[field] = value;
        assert!(inspect(&denied, &credentials, 100).is_err());
    }
    assert!(inspect(
        &token(),
        &Credentials {
            read_posts: true,
            ..credentials.clone()
        },
        100
    )
    .is_err());
    assert!(inspect(
        &token(),
        &Credentials {
            target: Target::Organization { id: "123".into() },
            ..credentials.clone()
        },
        100
    )
    .is_err());
    assert!(Credentials {
        access_token: "token\r\nInjected: header".into(),
        ..credentials
    }
    .validate()
    .is_err());
    assert!(member(&json!({ "sub": "../another", "name": "Name" })).is_err());
    assert_eq!(
        member(&json!({ "sub": "member123", "name": "Test Person" }))
            .unwrap()
            .0,
        "urn:li:person:member123"
    );
}
#[test]
fn organization_role_requires_approved_admin_exact_target_and_member() {
    let valid = json!({ "elements": [{ "role": "ADMINISTRATOR", "state": "APPROVED", "organizationTarget": "urn:li:organization:123", "roleAssignee": "urn:li:person:member123" }] });
    assert!(approved_admin(
        &valid,
        "urn:li:organization:123",
        "urn:li:person:member123"
    ));
    assert!(!approved_admin(
        &valid,
        "urn:li:organization:456",
        "urn:li:person:member123"
    ));
    for (field, value) in [
        ("state", json!("REQUESTED")),
        ("role", json!("CONTENT_ADMIN")),
        ("roleAssignee", json!("urn:li:person:other")),
        ("organization", json!("urn:li:organization:456")),
    ] {
        let mut denied = valid.clone();
        denied["elements"][0][field] = value;
        assert!(!approved_admin(
            &denied,
            "urn:li:organization:123",
            "urn:li:person:member123"
        ));
    }
}
#[test]
fn posts_are_literal_text_with_fixed_author_endpoint_headers_and_public_distribution() {
    let identity = Identity {
        author: "urn:li:person:member123".into(),
        name: "Test".into(),
        member: "urn:li:person:member123".into(),
        expires_at: 9999,
    };
    let input = Post {
        message: "Olá 😀 #tag (literal) @[mention] \\".into(),
    };
    let request = publish_request(&credentials(), &identity, &input)
        .unwrap()
        .build()
        .unwrap();
    assert_eq!(
        request.url().as_str(),
        "https://api.linkedin.com/rest/posts"
    );
    assert_eq!(request.headers()["linkedin-version"], VERSION);
    assert_eq!(request.headers()["x-restli-protocol-version"], "2.0.0");
    let value: Value = serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
    assert_eq!(value["author"], identity.author);
    assert_eq!(value["visibility"], "PUBLIC");
    assert_eq!(value["lifecycleState"], "PUBLISHED");
    assert_eq!(value["distribution"]["feedDistribution"], "MAIN_FEED");
    assert!(value["commentary"]
        .as_str()
        .unwrap()
        .contains("\\#tag \\(literal\\)"));
    assert!(serde_json::from_value::<Post>(
        json!({ "message": "test", "author": "urn:li:person:other" })
    )
    .is_err());
    assert!(Post {
        message: "a".repeat(3001)
    }
    .validate()
    .is_err());
}
#[test]
fn acknowledgement_requires_created_status_and_valid_header_urn_not_response_text() {
    let mut reply = Reply {
        status: 201,
        body: Value::Null,
        post_id: Some("urn%3Ali%3Ashare%3A12345".into()),
    };
    assert_eq!(receipt(&reply).unwrap(), "urn:li:share:12345");
    reply.status = 200;
    assert!(receipt(&reply).is_err());
    reply.status = 201;
    reply.post_id = Some("https://evil.example/".into());
    assert!(receipt(&reply).is_err());
    reply.post_id = None;
    reply.body = json!({ "id": "urn:li:share:12345" });
    assert!(receipt(&reply).is_err());
}
#[test]
fn posts_do_not_forward_paging_urls_or_hidden_fields() {
    let list = post_list(&json!({ "elements": [{ "id": "urn:li:share:123", "commentary": "<script>data</script>", "lastModifiedAt": 100, "access_token": "secret" }], "paging": { "links": [{ "rel": "next", "href": "https://api.linkedin.com/?token=secret" }] } })).unwrap();
    assert!(!list.to_string().contains("secret"));
    assert_eq!(list["has_more"], true);
    assert_eq!(list["items"][0]["message"], "<script>data</script>");
}
#[tokio::test]
async fn transport_handles_empty_created_body_redacts_refuses_redirects_and_cancels() {
    use axum::{http::StatusCode, routing::get, Router};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let router = Router::new()
        .route(
            "/created",
            get(|| async {
                (
                    StatusCode::CREATED,
                    [("x-restli-id", "urn:li:share:12345")],
                    "",
                )
            }),
        )
        .route(
            "/error",
            get(|| async { (StatusCode::FORBIDDEN, "secret-client-token-error") }),
        )
        .route(
            "/redirect",
            get(|| async { axum::response::Redirect::temporary("/created") }),
        )
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
    assert_eq!(
        receipt(
            &request(client.get(format!("{base}/created")), &cancel)
                .await
                .unwrap()
        )
        .unwrap(),
        "urn:li:share:12345"
    );
    let error = request(client.get(format!("{base}/error")), &cancel)
        .await
        .err()
        .unwrap();
    assert!(!error.contains("secret-client-token"));
    assert!(!error.contains(&base));
    assert!(request(client.get(format!("{base}/redirect")), &cancel)
        .await
        .is_err());
    assert!(request(client.get(format!("{base}/large")), &cancel)
        .await
        .err()
        .unwrap()
        .contains("1 MB"));
    let future = request(client.get(format!("{base}/slow")), &cancel);
    let stop = async {
        tokio::time::sleep(Duration::from_millis(20)).await;
        cancel.cancel();
    };
    let (result, ()) = tokio::join!(future, stop);
    assert!(result.err().unwrap().contains("cancelada"));
    server.abort();
}

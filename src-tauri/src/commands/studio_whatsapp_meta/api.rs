use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub const API_VERSION: &str = "v25.0";
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    pub phone_id: String,
    pub access_token: String,
    pub app_secret: String,
    pub verify_token: String,
}
impl Credentials {
    pub fn validate(&self) -> Result<(), String> {
        if !(6..=24).contains(&self.phone_id.len())
            || !self.phone_id.bytes().all(|b| b.is_ascii_digit())
            || !(20..=1024).contains(&self.access_token.len())
            || !self
                .access_token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-._~+/=".contains(&b))
            || self.app_secret.len() != 32
            || !self.app_secret.bytes().all(|b| b.is_ascii_hexdigit())
            || !(16..=64).contains(&self.verify_token.len())
            || !self
                .verify_token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err("Confira o ID do número comercial, token de acesso, chave do aplicativo e token de verificação da Meta.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Serialize)]
pub struct Identity {
    pub phone_id: String,
    pub display_phone: String,
    pub name: String,
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
pub fn mac(secret: &str, data: &[u8]) -> String {
    hex(ring::hmac::sign(
        &ring::hmac::Key::new(ring::hmac::HMAC_SHA256, secret.as_bytes()),
        data,
    )
    .as_ref())
}
pub fn signature(secret: &str, raw: &[u8], header: &str) -> bool {
    let Some(value) = header
        .strip_prefix("sha256=")
        .filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
    else {
        return false;
    };
    let bytes: Vec<u8> = value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            fn digit(b: u8) -> u8 {
                if b.is_ascii_digit() {
                    b - b'0'
                } else {
                    b.to_ascii_lowercase() - b'a' + 10
                }
            }
            digit(pair[0]) * 16 + digit(pair[1])
        })
        .collect();
    ring::hmac::verify(
        &ring::hmac::Key::new(ring::hmac::HMAC_SHA256, secret.as_bytes()),
        raw,
        &bytes,
    )
    .is_ok()
}
pub fn token_matches(expected: &str, supplied: &str) -> bool {
    // A fixed-key MAC gives a constant-time comparison without exposing the stored token.
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, b"bionic-meta-webhook-verification");
    ring::hmac::verify(
        &key,
        supplied.as_bytes(),
        ring::hmac::sign(&key, expected.as_bytes()).as_ref(),
    )
    .is_ok()
}

async fn request(
    url: &str,
    credentials: &Credentials,
    body: Option<Value>,
    cancel: CancellationToken,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Não foi possível preparar a conexão com a Meta.".to_string())?;
    let work = async {
        let mut request = if let Some(body) = body {
            client.post(url).json(&body)
        } else {
            client
                .get(url)
                .query(&[("fields", "id,display_phone_number,verified_name")])
        };
        request = request.bearer_auth(&credentials.access_token).query(&[(
            "appsecret_proof",
            mac(&credentials.app_secret, credentials.access_token.as_bytes()),
        )]);
        let mut response = request.send().await.map_err(|_| {
            "Não foi possível consultar a Meta. Verifique a conexão com a internet.".to_string()
        })?;
        if !response.status().is_success() {
            return Err(if [401,403].contains(&response.status().as_u16()) { "A Meta recusou as credenciais ou permissões do número comercial." } else { "A Meta não confirmou a operação. Confira a conta, as permissões e a janela de atendimento." }.into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "A resposta da Meta foi interrompida.".to_string())?
        {
            if bytes.len() + chunk.len() > 64 * 1024 {
                return Err("A resposta da Meta excedeu o limite permitido.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| "A Meta retornou uma resposta inválida.".into())
    };
    tokio::select! { biased; _=cancel.cancelled()=>Err("Operação da Meta interrompida.".into()), result=work=>result }
}
pub async fn identity(
    credentials: &Credentials,
    cancel: CancellationToken,
) -> Result<Identity, String> {
    credentials.validate()?;
    let value = request(
        &format!(
            "https://graph.facebook.com/{API_VERSION}/{}",
            credentials.phone_id
        ),
        credentials,
        None,
        cancel,
    )
    .await?;
    if value["id"].as_str() != Some(&credentials.phone_id) {
        return Err("A Meta não confirmou a identidade do número comercial.".into());
    }
    let phone = value["display_phone_number"]
        .as_str()
        .filter(|v| !v.is_empty() && v.len() <= 80)
        .ok_or("A Meta não informou o número comercial.")?;
    let name = value["verified_name"]
        .as_str()
        .filter(|v| v.len() <= 160)
        .unwrap_or("");
    Ok(Identity {
        phone_id: credentials.phone_id.clone(),
        display_phone: phone.into(),
        name: name.into(),
    })
}
pub async fn send(
    credentials: &Credentials,
    phone: &str,
    text: &str,
    cancel: CancellationToken,
) -> Result<(), String> {
    if !(7..=15).contains(&phone.len())
        || !phone.bytes().all(|b| b.is_ascii_digit())
        || text.trim().is_empty()
        || text.encode_utf16().count() > 4000
    {
        return Err("Resposta ou destinatário inválido para a Meta.".into());
    }
    let value = request(
        &format!(
            "https://graph.facebook.com/{API_VERSION}/{}/messages",
            credentials.phone_id
        ),
        credentials,
        Some(text_payload(phone, text)),
        cancel,
    )
    .await?;
    if !confirmed(&value, phone) {
        return Err(
            "A Meta não confirmou o envio. Confira o WhatsApp antes de qualquer nova ação.".into(),
        );
    }
    Ok(())
}
fn text_payload(phone: &str, text: &str) -> Value {
    json!({"messaging_product":"whatsapp","recipient_type":"individual","to":phone,"type":"text","text":{"preview_url":false,"body":text}})
}
fn confirmed(value: &Value, phone: &str) -> bool {
    value["messages"].as_array().is_some_and(|v| v.len() == 1)
        && value["messages"][0]["id"]
            .as_str()
            .is_some_and(|id| !id.is_empty() && id.len() <= 512)
        && value["contacts"][0]["wa_id"]
            .as_str()
            .is_none_or(|id| id == phone)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        "com.bionicllm.studio.connectors",
        "whatsapp-meta-credentials",
    )
    .map_err(|_| "Cofre da Meta indisponível.".into())
}
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn read() -> Result<Option<Credentials>, String> {
    match entry()?.get_password() {
        Ok(value) => {
            let credentials: Credentials = serde_json::from_str(&value)
                .map_err(|_| "Credenciais da Meta inválidas no cofre.".to_string())?;
            credentials.validate()?;
            Ok(Some(credentials))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Não foi possível acessar as credenciais da Meta.".into()),
    }
}
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn write(credentials: Option<Credentials>) -> Result<(), String> {
    match credentials {
        Some(credentials) => {
            credentials.validate()?;
            let value = serde_json::to_string(&credentials)
                .map_err(|_| "Não foi possível preparar as credenciais da Meta.".to_string())?;
            if value.encode_utf16().count() > 1250 {
                return Err("As credenciais excedem o limite do cofre do sistema.".into());
            }
            entry()?
                .set_password(&value)
                .map_err(|_| "Não foi possível guardar as credenciais da Meta no cofre.".into())
        }
        None => match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Não foi possível remover as credenciais da Meta.".into()),
        },
    }
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn read() -> Result<Option<Credentials>, String> {
    Err("O cofre desta integração requer Windows ou macOS.".into())
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn write(_: Option<Credentials>) -> Result<(), String> {
    Err("O cofre desta integração requer Windows ou macOS.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credentials_fit_the_windows_vault_and_cannot_inject_paths_or_headers() {
        let mut credentials = crate::commands::studio_whatsapp_meta::test_credentials();
        credentials.validate().unwrap();
        credentials.access_token = "x".repeat(1024);
        credentials.verify_token = "x".repeat(64);
        credentials.phone_id = "1".repeat(24);
        assert!(
            serde_json::to_string(&credentials)
                .unwrap()
                .encode_utf16()
                .count()
                <= 1250
        );
        credentials.phone_id = "../other".into();
        assert!(credentials.validate().is_err());
        credentials.phone_id = "123456789".into();
        credentials.access_token = "token\r\nAuthorization:bad".into();
        assert!(credentials.validate().is_err());
    }
    #[test]
    fn raw_body_signature_rejects_tampering_and_verification_tokens_use_exact_matching() {
        let credentials = crate::commands::studio_whatsapp_meta::test_credentials();
        let raw = br#"{"test":1}"#;
        let header = format!("sha256={}", mac(&credentials.app_secret, raw));
        assert!(signature(&credentials.app_secret, raw, &header));
        assert!(!signature(
            &credentials.app_secret,
            br#"{"test":2}"#,
            &header
        ));
        assert!(!signature(&credentials.app_secret, raw, "sha256=wrong"));
        assert!(token_matches(
            &credentials.verify_token,
            &credentials.verify_token
        ));
        assert!(!token_matches(&credentials.verify_token, "wrong"));
    }
    #[test]
    fn text_payload_has_a_fixed_recipient_and_only_a_matching_single_ack_is_accepted() {
        let body = text_payload("5511999999999", "Olá");
        assert_eq!(body["to"], "5511999999999");
        assert_eq!(body["text"]["preview_url"], false);
        assert_eq!(body["type"], "text");
        assert!(confirmed(
            &json!({"messages":[{"id":"wamid.test"}],"contacts":[{"wa_id":"5511999999999"}]}),
            "5511999999999"
        ));
        assert!(!confirmed(
            &json!({"messages":[{"id":"wamid.test"}],"contacts":[{"wa_id":"5511888888888"}]}),
            "5511999999999"
        ));
        assert!(!confirmed(&json!({"messages":[]}), "5511999999999"));
    }
    fn fixture(status: &str, body: &str, extra: &str) -> (String, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/fixture", listener.local_addr().unwrap());
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",
            body.len()
        );
        let worker = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = [0; 8192];
            let count = socket.read(&mut bytes).unwrap();
            let _ = socket.write_all(response.as_bytes());
            String::from_utf8_lossy(&bytes[..count]).into_owned()
        });
        (url, worker)
    }
    #[tokio::test]
    async fn transport_uses_bearer_and_proof_without_redirects_or_secret_errors() {
        let credentials = crate::commands::studio_whatsapp_meta::test_credentials();
        let (url, worker) = fixture("200 OK", r#"{"ok":true}"#, "");
        assert_eq!(
            request(&url, &credentials, None, CancellationToken::new())
                .await
                .unwrap()["ok"],
            true
        );
        let sent = worker.join().unwrap();
        assert!(sent.starts_with("GET /fixture?fields="));
        assert!(sent.contains("appsecret_proof="));
        assert!(sent.to_lowercase().contains("authorization: bearer "));
        for (status, body, extra) in [
            ("401 Unauthorized", "private-token", ""),
            (
                "302 Found",
                "private-token",
                "Location: http://127.0.0.1:1/leak\r\n",
            ),
            ("200 OK", "not-json", ""),
        ] {
            let (url, worker) = fixture(status, body, extra);
            let error = request(&url, &credentials, None, CancellationToken::new())
                .await
                .unwrap_err();
            assert!(!error.contains("private-token"));
            assert!(!error.contains(&credentials.access_token));
            worker.join().unwrap();
        }
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(
            request("http://127.0.0.1:1/none", &credentials, None, cancel)
                .await
                .unwrap_err()
                .contains("interrompida")
        );
        let (url, worker) = fixture("200 OK", &"x".repeat(64 * 1024 + 1), "");
        assert!(request(&url, &credentials, None, CancellationToken::new())
            .await
            .unwrap_err()
            .contains("limite"));
        worker.join().unwrap();
    }
}

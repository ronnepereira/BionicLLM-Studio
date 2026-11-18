//! Shared bounded Meta Graph transport for Pages and Instagram with Facebook Login.
use serde_json::Value;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
pub const VERSION: &str = "v25.0";
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Não foi possível preparar a conexão com a Meta.".into())
}
pub async fn request(
    request: reqwest::RequestBuilder,
    cancel: &CancellationToken,
) -> Result<Value, String> {
    let work = async {
        let mut response = request
            .send()
            .await
            .map_err(|_| "Não foi possível consultar a Meta. Confira sua conexão.".to_string())?;
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
            400 | 401 | 403 => "A Meta recusou o acesso. Confira token, conta, permissões e revisão do aplicativo.",
            429 => "A Meta limitou as consultas. Aguarde antes de tentar novamente.",
            _ => "A Meta não confirmou a operação. Tente novamente mais tarde.",
        }.into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Resposta da Meta interrompida.".to_string())?
        {
            if bytes.len() + chunk.len() > 1024 * 1024 {
                return Err("A resposta da Meta excedeu 1 MB.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| "A Meta retornou uma resposta inválida.".to_string())?;
        if value.get("error").is_some() {
            return Err(
                "A Meta recusou a operação. Verifique permissões e validade do token.".into(),
            );
        }
        Ok(value)
    };
    tokio::select! { biased; _ = cancel.cancelled() => Err("Operação Meta cancelada.".into()), result = work => result }
}
pub fn proof(secret: &str, token: &str) -> String {
    ring::hmac::sign(
        &ring::hmac::Key::new(ring::hmac::HMAC_SHA256, secret.as_bytes()),
        token.as_bytes(),
    )
    .as_ref()
    .iter()
    .map(|b| format!("{b:02x}"))
    .collect()
}
pub fn page_token(
    value: &Value,
    app: &str,
    page: &str,
    scopes: &[&str],
    now: i64,
) -> Result<Option<i64>, String> {
    let data = &value["data"];
    let granted: Vec<_> = data["scopes"]
        .as_array()
        .map(|v| v.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let valid_time = |key: &str| data[key].as_i64().is_some_and(|n| n == 0 || n > now);
    if data["is_valid"] != true
        || data["type"] != "PAGE"
        || data["app_id"] != app
        || data["profile_id"] != page
        || scopes.iter().any(|scope| !granted.contains(scope))
        || !valid_time("expires_at")
        || data.get("data_access_expires_at").is_some() && !valid_time("data_access_expires_at")
    {
        return Err("A Meta não confirmou um token de Página válido para este aplicativo, Página e permissões. Token de perfil pessoal não é aceito.".into());
    }
    Ok(data["expires_at"].as_i64().filter(|v| *v > 0))
}

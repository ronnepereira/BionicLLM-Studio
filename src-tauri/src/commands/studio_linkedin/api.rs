use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tokio_util::sync::CancellationToken;
pub const VERSION: &str = "202609";
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Target {
    Member,
    Organization { id: String },
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    pub client_id: String,
    pub client_secret: String,
    pub access_token: String,
    pub target: Target,
    pub publishing: bool,
    pub read_posts: bool,
}
fn opaque(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
fn number(value: &str) -> bool {
    (1..=32).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_digit())
}
pub fn author(value: &str) -> bool {
    value.strip_prefix("urn:li:person:").is_some_and(opaque)
        || value
            .strip_prefix("urn:li:organization:")
            .is_some_and(number)
}
impl Credentials {
    pub fn validate(&self) -> Result<(), String> {
        if !opaque(&self.client_id)
            || !(8..=256).contains(&self.client_secret.len())
            || !self.client_secret.bytes().all(|b| b.is_ascii_graphic())
            || !(20..=1024).contains(&self.access_token.len())
            || !self
                .access_token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-._~+/=".contains(&b))
            || matches!(&self.target, Target::Organization { id } if !number(id))
        {
            return Err("Confira o ID/chave do aplicativo LinkedIn, token de usuário e ID numérico da empresa quando selecionada.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Identity {
    pub author: String,
    pub name: String,
    pub member: String,
    pub expires_at: i64,
}
pub struct Reply {
    pub status: u16,
    pub body: Value,
    pub post_id: Option<String>,
}
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Não foi possível preparar a conexão com o LinkedIn.".into())
}
pub async fn request(
    request: reqwest::RequestBuilder,
    cancel: &CancellationToken,
) -> Result<Reply, String> {
    let work = async {
        let mut response = request.send().await.map_err(|_| {
            "Não foi possível consultar o LinkedIn. Confira sua conexão.".to_string()
        })?;
        let status = response.status().as_u16();
        if !response.status().is_success() {
            return Err(match status {
            400 | 401 | 403 => "O LinkedIn recusou o acesso. Confira token, produtos/permissões aprovados e função na empresa.",
            426 => "A versão da API LinkedIn não está disponível. Atualize o conector antes de tentar novamente.",
            429 => "O LinkedIn limitou as consultas. Aguarde antes de tentar novamente.",
            _ => "O LinkedIn não confirmou a operação. Tente novamente mais tarde.",
        }.into());
        }
        let post_id = response
            .headers()
            .get("x-restli-id")
            .and_then(|v| v.to_str().ok())
            .filter(|v| v.len() <= 256)
            .map(str::to_owned);
        // Posts API confirms creation in a header, often with an empty body.
        if status == 201 {
            return Ok(Reply {
                status,
                body: Value::Null,
                post_id,
            });
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Resposta LinkedIn interrompida.".to_string())?
        {
            if bytes.len() + chunk.len() > 1024 * 1024 {
                return Err("A resposta LinkedIn excedeu 1 MB.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let body = serde_json::from_slice(&bytes)
            .map_err(|_| "O LinkedIn retornou uma resposta inválida.".to_string())?;
        Ok(Reply {
            status,
            body,
            post_id,
        })
    };
    tokio::select! { biased; _ = cancel.cancelled() => Err("Operação LinkedIn cancelada.".into()), result = work => result }
}
fn rest(
    credentials: &Credentials,
    method: reqwest::Method,
    path: &str,
) -> Result<reqwest::RequestBuilder, String> {
    Ok(client()?
        .request(method, format!("https://api.linkedin.com/rest/{path}"))
        .bearer_auth(&credentials.access_token)
        .header("LinkedIn-Version", VERSION)
        .header("X-Restli-Protocol-Version", "2.0.0"))
}
pub fn inspect(value: &Value, credentials: &Credentials, now: i64) -> Result<i64, String> {
    let scopes: Vec<_> = value["scope"]
        .as_str()
        .unwrap_or("")
        .split([',', ' '])
        .filter(|s| !s.is_empty())
        .collect();
    let expires_at = value["expires_at"].as_i64().unwrap_or(0);
    let (write, read) = match &credentials.target {
        Target::Member => ("w_member_social", "r_member_social"),
        Target::Organization { .. } => ("w_organization_social", "r_organization_social"),
    };
    if value["active"] != true
        || value["client_id"] != credentials.client_id
        || value["auth_type"] != "3L"
        || expires_at <= now
        || !scopes.contains(&"openid")
        || !scopes.contains(&"profile")
        || credentials.publishing && !scopes.contains(&write)
        || credentials.read_posts && !scopes.contains(&read)
        || matches!(&credentials.target, Target::Organization { .. })
            && !scopes.contains(&"r_organization_admin")
            && !scopes.contains(&"rw_organization_admin")
    {
        return Err("O LinkedIn não confirmou um token de usuário ativo para este aplicativo, prazo e permissões selecionadas. Leitura social e acesso empresarial podem exigir aprovação adicional.".into());
    }
    Ok(expires_at)
}
fn member(value: &Value) -> Result<(String, String), String> {
    let sub = value["sub"]
        .as_str()
        .filter(|s| opaque(s))
        .ok_or("O LinkedIn não confirmou o identificador do perfil autenticado.")?;
    let name = value["name"]
        .as_str()
        .filter(|s| {
            !s.trim().is_empty() && s.chars().count() <= 128 && !s.chars().any(char::is_control)
        })
        .ok_or("O LinkedIn não retornou o nome básico do perfil.")?;
    Ok((format!("urn:li:person:{sub}"), name.into()))
}
pub fn approved_admin(value: &Value, target: &str, member: &str) -> bool {
    value["elements"].as_array().is_some_and(|rows| {
        rows.iter().any(|row| {
            let organization = row
                .get("organizationTarget")
                .or_else(|| row.get("organization"));
            let consistent = !(row.get("organizationTarget").is_some()
                && row.get("organization").is_some()
                && row["organizationTarget"] != row["organization"]);
            consistent
                && organization == Some(&json!(target))
                && row["roleAssignee"] == member
                && row["role"] == "ADMINISTRATOR"
                && row["state"] == "APPROVED"
        })
    })
}
pub async fn verify(
    credentials: &Credentials,
    cancel: &CancellationToken,
) -> Result<Identity, String> {
    credentials.validate()?;
    let token = request(
        client()?
            .post("https://www.linkedin.com/oauth/v2/introspectToken")
            .form(&[
                ("client_id", &credentials.client_id),
                ("client_secret", &credentials.client_secret),
                ("token", &credentials.access_token),
            ]),
        cancel,
    )
    .await?;
    let expires_at = inspect(&token.body, credentials, chrono::Utc::now().timestamp())?;
    let profile = request(
        client()?
            .get("https://api.linkedin.com/v2/userinfo")
            .bearer_auth(&credentials.access_token),
        cancel,
    )
    .await?;
    let (member, member_name) = member(&profile.body)?;
    match &credentials.target {
        Target::Member => Ok(Identity {
            author: member.clone(),
            name: member_name,
            member,
            expires_at,
        }),
        Target::Organization { id } => {
            let author = format!("urn:li:organization:{id}");
            let mut authorized = false;
            let mut start = 0;
            for _ in 0..10 {
                let roles = request(
                    rest(credentials, reqwest::Method::GET, "organizationAcls")?.query(&[
                        ("q", "roleAssignee"),
                        ("role", "ADMINISTRATOR"),
                        ("state", "APPROVED"),
                        ("count", "100"),
                        ("start", &start.to_string()),
                    ]),
                    cancel,
                )
                .await?;
                if approved_admin(&roles.body, &author, &member) {
                    authorized = true;
                    break;
                }
                let next = roles.body["paging"]["links"]
                    .as_array()
                    .is_some_and(|v| v.iter().any(|link| link["rel"] == "next"));
                if !next {
                    break;
                }
                let count = roles.body["paging"]["count"]
                    .as_u64()
                    .filter(|n| (1..=100).contains(n))
                    .ok_or("Paginação LinkedIn inválida.")?;
                start += count;
            }
            if !authorized {
                return Err("O LinkedIn não confirmou a função ADMINISTRATOR aprovada para esta empresa e este perfil nas páginas consultadas.".into());
            }
            let company = request(
                rest(
                    credentials,
                    reqwest::Method::GET,
                    &format!("organizations/{id}"),
                )?
                .query(&[("projection", "(id,localizedName)")]),
                cancel,
            )
            .await?;
            let name = company.body["localizedName"]
                .as_str()
                .filter(|s| {
                    !s.trim().is_empty()
                        && s.chars().count() <= 128
                        && !s.chars().any(char::is_control)
                })
                .ok_or("O LinkedIn não confirmou o nome da empresa.")?;
            let returned_id = company.body["id"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| company.body["id"].as_u64().map(|id| id.to_string()));
            if returned_id.as_deref() != Some(id) {
                return Err(
                    "O LinkedIn retornou outra empresa. A conexão anterior foi preservada.".into(),
                );
            }
            Ok(Identity {
                author,
                name: name.into(),
                member,
                expires_at,
            })
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Post {
    pub message: String,
}
impl Post {
    pub fn validate(&self) -> Result<(), String> {
        if self.message.trim().is_empty()
            || self.message.chars().count() > 3000
            || self.message.contains('\0')
        {
            Err("Use um texto com 1 a 3.000 caracteres para a publicação LinkedIn.".into())
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
        author(account)
    }
}
pub fn little_text(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    for ch in value.chars() {
        if "|{}@[]()<>#\\*_~".contains(ch) {
            text.push('\\');
        }
        text.push(ch);
    }
    text
}
pub fn publish_request(
    credentials: &Credentials,
    identity: &Identity,
    post: &Post,
) -> Result<reqwest::RequestBuilder, String> {
    credentials.validate()?;
    post.validate()?;
    if !author(&identity.author) {
        return Err("Autor LinkedIn inválido.".into());
    }
    Ok(rest(credentials, reqwest::Method::POST, "posts")?.json(&json!({ "author": identity.author, "commentary": little_text(&post.message), "visibility": "PUBLIC", "distribution": { "feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": [] }, "lifecycleState": "PUBLISHED", "isReshareDisabledByAuthor": false })))
}
pub fn receipt(reply: &Reply) -> Result<String, String> {
    let value = reply
        .post_id
        .as_deref()
        .and_then(|v| urlencoding::decode(v).ok())
        .filter(|v| v.len() <= 128)
        .ok_or("O LinkedIn não confirmou o ID da publicação no cabeçalho esperado.")?;
    if reply.status != 201
        || !(value.strip_prefix("urn:li:share:").is_some_and(number)
            || value.strip_prefix("urn:li:ugcPost:").is_some_and(number))
    {
        return Err(
            "O LinkedIn não confirmou uma publicação válida. Confira no serviço antes de repetir."
                .into(),
        );
    }
    Ok(value.into_owned())
}
pub async fn posts(
    credentials: &Credentials,
    identity: &Identity,
    cancel: &CancellationToken,
) -> Result<Value, String> {
    let reply = request(
        rest(credentials, reqwest::Method::GET, "posts")?.query(&[
            ("q", "author"),
            ("author", &identity.author),
            ("count", "10"),
            ("sortBy", "LAST_MODIFIED"),
        ]),
        cancel,
    )
    .await?;
    post_list(&reply.body)
}
fn post_list(value: &Value) -> Result<Value, String> {
    let values = value["elements"]
        .as_array()
        .ok_or("O LinkedIn não retornou uma lista de publicações.")?;
    let clipped = |v: &Value, max| {
        v.as_str()
            .unwrap_or("")
            .chars()
            .take(max)
            .collect::<String>()
    };
    let items: Vec<_> = values.iter().take(10).map(|v| json!({ "id": clipped(&v["id"], 128), "message": clipped(&v["commentary"], 6000), "modified_at": v["lastModifiedAt"].as_i64() })).collect();
    let has_more = value["paging"]["links"]
        .as_array()
        .is_some_and(|v| v.iter().any(|link| link["rel"] == "next"));
    Ok(json!({ "items": items, "has_more": has_more }))
}
#[cfg(test)]
#[path = "tests.rs"]
mod tests;

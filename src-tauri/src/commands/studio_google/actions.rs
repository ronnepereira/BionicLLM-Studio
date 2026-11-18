//! Local immutable proposals; only the review panel can invoke execution.
use super::{api, api::Service, main_only, write_vault, Request, OPERATION};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::Manager;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Write {
    GmailSend {
        to: String,
        subject: String,
        text: String,
    },
    CalendarCreate {
        title: String,
        description: String,
        start: String,
        end: String,
    },
    DriveCreate {
        name: String,
        text: String,
    },
}
fn clean(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}
fn body(value: &str, max: usize) -> bool {
    value.chars().count() <= max && !value.contains('\0')
}
fn email(value: &str) -> bool {
    let Some((local, host)) = value.split_once('@') else {
        return false;
    };
    value.len() <= 254
        && !local.is_empty()
        && local.len() <= 64
        && !local.starts_with('.')
        && !local.ends_with('.')
        && !local.contains("..")
        && local
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".!#$%&'*+-/=?^_`{|}~".contains(&b))
        && host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}
impl Write {
    pub fn service(&self) -> Service {
        match self {
            Self::GmailSend { .. } => Service::Gmail,
            Self::CalendarCreate { .. } => Service::Calendar,
            Self::DriveCreate { .. } => Service::Drive,
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        let valid = match self {
            Self::GmailSend { to, subject, text } => {
                email(to) && clean(subject, 160) && !text.trim().is_empty() && body(text, 32000)
            }
            Self::DriveCreate { name, text } => {
                clean(name, 200)
                    && !name.contains(['/', '\\'])
                    && name.to_ascii_lowercase().ends_with(".txt")
                    && body(text, 32000)
            }
            Self::CalendarCreate {
                title,
                description,
                start,
                end,
            } => {
                clean(title, 200)
                    && body(description, 8000)
                    && start.len() <= 40
                    && end.len() <= 40
                    && chrono::DateTime::parse_from_rfc3339(start)
                        .ok()
                        .zip(chrono::DateTime::parse_from_rfc3339(end).ok())
                        .is_some_and(|(a, b)| b > a)
            }
        };
        if valid {
            Ok(())
        } else {
            Err("Confira os campos: destinatário individual válido, assunto até 160 caracteres, texto até 32.000, arquivo .txt ou evento com título até 200, descrição até 8.000 e término posterior ao início com fuso explícito.".into())
        }
    }
    pub fn payload(&self, id: &str) -> Value {
        match self {
            Self::GmailSend { to, subject, text } => {
                let encoded = STANDARD.encode(text.as_bytes());
                let body = encoded
                    .as_bytes()
                    .chunks(76)
                    .map(|v| std::str::from_utf8(v).unwrap())
                    .collect::<Vec<_>>()
                    .join("\r\n");
                let mail = format!("To: {to}\r\nSubject: =?UTF-8?B?{}?=\r\nMessage-ID: <bionic-{id}@bionicllm.local>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{body}\r\n", STANDARD.encode(subject.as_bytes()));
                json!({ "raw": URL_SAFE_NO_PAD.encode(mail.as_bytes()) })
            }
            Self::CalendarCreate {
                title,
                description,
                start,
                end,
            } => {
                json!({ "id": event_id(id), "summary": title, "description": description, "start": { "dateTime": start }, "end": { "dateTime": end }, "reminders": { "useDefault": false } })
            }
            Self::DriveCreate { name, .. } => json!({ "name": name, "mimeType": "text/plain" }),
        }
    }
}
fn event_id(id: &str) -> String {
    format!("bionic{}", id.replace('-', ""))
}
pub fn upload(input: &Write, id: &str, boundary: &str) -> Result<String, String> {
    let Write::DriveCreate { text, .. } = input else {
        return Err("Ação Drive inválida.".into());
    };
    if boundary.is_empty()
        || !boundary.bytes().all(|b| b.is_ascii_alphanumeric())
        || text.contains(boundary)
    {
        return Err("Separador do arquivo inválido. Prepare novamente.".into());
    }
    Ok(format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--{boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{text}\r\n--{boundary}--\r\n", input.payload(id)))
}
fn outbound(input: &Write, id: &str, token: &str) -> Result<reqwest::RequestBuilder, String> {
    input.validate()?;
    let client = api::http_client()?;
    let request = match input {
        Write::GmailSend { .. } => client
            .post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
            .bearer_auth(token)
            .json(&input.payload(id)),
        Write::CalendarCreate { .. } => client
            .post("https://www.googleapis.com/calendar/v3/calendars/primary/events")
            .bearer_auth(token)
            .query(&[("sendUpdates", "none")])
            .json(&input.payload(id)),
        Write::DriveCreate { .. } => {
            let boundary = format!("bionic{}", uuid::Uuid::new_v4().simple());
            client
                .post("https://www.googleapis.com/upload/drive/v3/files")
                .bearer_auth(token)
                .query(&[("uploadType", "multipart"), ("fields", "id,name")])
                .header(
                    "Content-Type",
                    format!("multipart/related; boundary={boundary}"),
                )
                .body(upload(input, id, &boundary)?)
        }
    };
    Ok(request)
}
async fn execute(
    input: &Write,
    id: &str,
    token: &str,
    cancel: &CancellationToken,
) -> Result<String, String> {
    let result = api::request(outbound(input, id, token)?, cancel).await?;
    receipt(input, id, &result)
}
fn receipt(input: &Write, id: &str, result: &Value) -> Result<String, String> {
    let remote = result["id"].as_str().filter(|v| !v.is_empty() && v.len() <= 128 && v.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))).ok_or("O Google não confirmou o identificador da ação. Confira no serviço antes de preparar outra.")?;
    if matches!(input, Write::CalendarCreate { .. }) && remote != event_id(id) {
        return Err(
            "O Google retornou outro identificador de evento. Confira na Agenda antes de repetir."
                .into(),
        );
    }
    Ok(remote.into())
}
pub use crate::commands::review_actions::Phase;
pub type Draft = crate::commands::review_actions::Draft<Write>;
type Entry = crate::commands::review_actions::Entry<Write>;
type Journal = crate::commands::review_actions::Journal<Write>;
impl crate::commands::review_actions::ReviewInput for Write {
    fn validate(&self) -> Result<(), String> {
        Write::validate(self)
    }
    fn valid_account(&self, account: &str) -> bool {
        email(account)
    }
}
fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "Pasta Google indisponível.".to_string())?
        .join("connectors/google/actions.json"))
}
#[tauri::command]
pub async fn studio_google_drafts(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Vec<Draft>, String> {
    main_only(&window)?;
    // Atomic file replacement permits status reads without waiting behind OAuth.
    Ok(Journal::load(&path(&app)?)?.views())
}
#[tauri::command]
pub async fn studio_google_prepare(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    input: Write,
    request_id: String,
) -> Result<Draft, String> {
    main_only(&window)?;
    input.validate()?;
    let request = Request::new(request_id, input.service().key())?;
    let _lock = tokio::select! { biased; _ = request.cancel.cancelled() => return Err("Operação Google cancelada.".into()), lock = OPERATION.lock() => lock };
    let mut saved = super::enabled_connection(input.service(), true).await?;
    if saved.binding.is_empty() {
        saved.binding = uuid::Uuid::new_v4().to_string();
        write_vault(
            input.service().key(),
            Some(serde_json::to_string(&saved).map_err(|_| "Autorização inválida.".to_string())?),
        )
        .await?;
    }
    let file = path(&app)?;
    let mut journal = Journal::load(&file)?;
    if journal.entries.len() >= 20 {
        return Err(
            "Há vinte registros Google. Revise e remova registros antigos para preparar outro."
                .into(),
        );
    }
    let draft = Draft {
        id: uuid::Uuid::new_v4().to_string(),
        account: saved.email,
        input,
        phase: Phase::Pending,
        created_at: chrono::Utc::now().timestamp(),
        remote_id: None,
    };
    journal.entries.push(Entry {
        binding: saved.binding,
        draft: draft.clone(),
    });
    request.check()?;
    journal.save(&file)?;
    Ok(draft)
}
#[tauri::command]
pub async fn studio_google_discard(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<Vec<Draft>, String> {
    main_only(&window)?;
    let _lock = OPERATION.lock().await;
    let file = path(&app)?;
    let mut journal = Journal::load(&file)?;
    journal.entries.retain(|e| e.draft.id != id);
    journal.save(&file)?;
    Ok(journal.views())
}
#[tauri::command]
pub async fn studio_google_execute(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
    request_id: String,
) -> Result<Vec<Draft>, String> {
    main_only(&window)?;
    let file = path(&app)?;
    let service = Journal::load(&file)?
        .entries
        .iter()
        .find(|e| e.draft.id == id)
        .ok_or("Rascunho Google não encontrado.")?
        .draft
        .input
        .service();
    let request = Request::new(request_id, service.key())?;
    let _lock = tokio::select! { biased; _ = request.cancel.cancelled() => return Err("Operação Google cancelada.".into()), lock = OPERATION.lock() => lock };
    let saved = super::enabled_connection(service, true).await?;
    let mut journal = Journal::load(&file)?;
    // Check identity/phase before contacting Google, then persist uncertainty before POST.
    let (input, id) = journal.begin(&id, &saved.email, &saved.binding)?;
    let token = super::fresh_access(service, &request.cancel, true).await?;
    request.check()?;
    journal.save(&file)?;
    match execute(&input, &id, &token, &request.cancel).await {
        Ok(remote_id) => {
            let entry = journal.entries.iter_mut().find(|e| e.draft.id == id).ok_or("Registro Google indisponível.")?;
            entry.draft.phase = Phase::Done; entry.draft.remote_id = Some(remote_id);
            journal.save(&file).map_err(|_| "O Google confirmou a ação, mas o registro local não pôde ser atualizado. Confira no Google e não repita.".to_string())?;
            Ok(journal.views())
        }
        Err(error) => Err(format!("{error} O resultado pode ser incerto. Confira no Google antes de preparar outra ação; este registro não será reenviado.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn mail() -> Write {
        Write::GmailSend {
            to: "test@example.com".into(),
            subject: "Olá 😀".into(),
            text: "Texto\nBcc: isto é corpo".into(),
        }
    }
    #[test]
    fn shared_journal_keeps_previous_google_disk_format() {
        let original = serde_json::json!({ "entries": [{ "binding": "00000000-0000-4000-8000-000000000001", "id": "00000000-0000-4000-8000-000000000002", "account": "test@example.com", "input": { "action": "gmail_send", "to": "recipient@example.com", "subject": "Assunto", "text": "Texto" }, "phase": "pending", "created_at": 1, "remote_id": null }] });
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("actions.json");
        std::fs::write(&file, serde_json::to_vec(&original).unwrap()).unwrap();
        let journal = Journal::load(&file).unwrap();
        assert_eq!(serde_json::to_value(&journal).unwrap(), original);
        assert!(!serde_json::to_string(&journal.views())
            .unwrap()
            .contains("binding"));
    }
    #[test]
    fn outbound_requests_use_fixed_hosts_and_explicit_create_payloads() {
        let mail = outbound(&mail(), "id", "test-token")
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(mail.method(), reqwest::Method::POST);
        assert_eq!(
            mail.url().as_str(),
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
        );
        assert_eq!(mail.headers()["authorization"], "Bearer test-token");
        let event = Write::CalendarCreate {
            title: "Test".into(),
            description: "".into(),
            start: "2026-11-03T10:00:00-03:00".into(),
            end: "2026-11-03T11:00:00-03:00".into(),
        };
        let request = outbound(&event, "id", "test-token")
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(request.url().host_str(), Some("www.googleapis.com"));
        assert_eq!(request.url().query(), Some("sendUpdates=none"));
        let file = outbound(
            &Write::DriveCreate {
                name: "test.txt".into(),
                text: "Olá".into(),
            },
            "id",
            "test-token",
        )
        .unwrap()
        .build()
        .unwrap();
        assert!(file.headers()["content-type"]
            .to_str()
            .unwrap()
            .starts_with("multipart/related; boundary=bionic"));
        assert!(file.url().query().unwrap().contains("uploadType=multipart"));
    }
    fn journal() -> Journal {
        Journal {
            entries: vec![Entry {
                binding: "00000000-0000-4000-8000-000000000001".into(),
                draft: Draft {
                    id: "00000000-0000-4000-8000-000000000002".into(),
                    account: "test@example.com".into(),
                    input: mail(),
                    phase: Phase::Pending,
                    created_at: 1,
                    remote_id: None,
                },
            }],
        }
    }
    #[test]
    fn rejects_header_injection_invalid_times_and_unsupported_writes() {
        mail().validate().unwrap();
        assert!(Write::GmailSend {
            to: "test@example.com\r\nBcc: other@example.com".into(),
            subject: "Test".into(),
            text: "body".into()
        }
        .validate()
        .is_err());
        assert!(Write::GmailSend {
            to: "test@example.com".into(),
            subject: "Test\r\nBcc: injected".into(),
            text: "body".into()
        }
        .validate()
        .is_err());
        assert!(Write::DriveCreate {
            name: "../file.txt".into(),
            text: "".into()
        }
        .validate()
        .is_err());
        assert!(Write::DriveCreate {
            name: "program.exe".into(),
            text: "".into()
        }
        .validate()
        .is_err());
        let valid = json!({ "action": "calendar_create", "title": "Consulta", "description": "", "start": "2026-11-03T10:00:00-03:00", "end": "2026-11-03T14:00:00Z" });
        serde_json::from_value::<Write>(valid.clone())
            .unwrap()
            .validate()
            .unwrap();
        let mut invalid = valid;
        invalid["end"] = json!("2026-11-03T12:00:00Z");
        assert!(serde_json::from_value::<Write>(invalid.clone())
            .unwrap()
            .validate()
            .is_err());
        invalid["attendees"] = json!(["someone@example.com"]);
        assert!(serde_json::from_value::<Write>(invalid).is_err());
        assert!(
            serde_json::from_value::<Write>(json!({ "action": "drive_delete", "id": "file" }))
                .is_err()
        );
    }
    #[test]
    fn mime_and_upload_preserve_unicode_without_extra_headers() {
        let payload = mail().payload("test-id");
        let mime = String::from_utf8(
            URL_SAFE_NO_PAD
                .decode(payload["raw"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        let (head, encoded) = mime.split_once("\r\n\r\n").unwrap();
        assert!(head.contains("To: test@example.com\r\n"));
        assert!(!head.contains("Bcc:"));
        assert!(head.contains(&STANDARD.encode("Olá 😀")));
        let body = STANDARD.decode(encoded.replace("\r\n", "")).unwrap();
        assert_eq!(String::from_utf8(body).unwrap(), "Texto\nBcc: isto é corpo");
        let file = Write::DriveCreate {
            name: "arquivo \"teste\".txt".into(),
            text: "Olá 😀".into(),
        };
        let multipart = upload(&file, "id", "boundary123").unwrap();
        assert!(multipart.contains("application/json"));
        assert!(multipart.contains("Olá 😀"));
        assert!(multipart.ends_with("--boundary123--\r\n"));
        assert!(upload(&file, "id", "Olá").is_err());
    }
    #[test]
    fn refuses_replay_and_account_changes_and_persists_uncertainty() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("actions.json");
        let mut log = journal();
        log.save(&file).unwrap();
        let id = log.entries[0].draft.id.clone();
        let binding = log.entries[0].binding.clone();
        assert!(log.begin(&id, "other@example.com", &binding).is_err());
        assert!(log.begin(&id, "test@example.com", "different").is_err());
        log.begin(&id, "test@example.com", &binding).unwrap();
        log.save(&file).unwrap();
        let mut restored = Journal::load(&file).unwrap();
        assert_eq!(restored.entries[0].draft.phase, Phase::Uncertain);
        assert!(restored.begin(&id, "test@example.com", &binding).is_err());
        let view = serde_json::to_string(&restored.views()).unwrap();
        assert!(!view.contains("binding"));
        std::fs::write(&file, b"invalid-json").unwrap();
        assert!(Journal::load(&file).is_err());
        assert_eq!(std::fs::read(&file).unwrap(), b"invalid-json");
    }
    #[test]
    fn legacy_credentials_are_read_only_and_ack_is_checked() {
        let old: super::super::Connection = serde_json::from_value(
            json!({ "refresh_token": "old", "email": "test@example.com", "enabled": true }),
        )
        .unwrap();
        assert!(!old.write_access);
        assert!(old.binding.is_empty());
        let event = Write::CalendarCreate {
            title: "Test".into(),
            description: "".into(),
            start: "2026-11-03T10:00:00-03:00".into(),
            end: "2026-11-03T11:00:00-03:00".into(),
        };
        let payload = event.payload("00000000-0000-4000-8000-000000000002");
        assert!(payload.get("attendees").is_none());
        assert_eq!(payload["reminders"]["useDefault"], false);
        assert!(receipt(&event, "id", &json!({ "id": "different" })).is_err());
        assert!(receipt(&mail(), "id", &json!({ "error": "not confirmed" })).is_err());
    }
}

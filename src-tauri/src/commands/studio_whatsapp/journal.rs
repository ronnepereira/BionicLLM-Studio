use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
pub fn valid_chat(jid: &str) -> bool {
    if let Some(phone) = jid.strip_suffix("@s.whatsapp.net") {
        (7..=15).contains(&phone.len())
            && !phone.starts_with('0')
            && phone.bytes().all(|b| b.is_ascii_digit())
    } else if let Some(group) = jid.strip_suffix("@g.us") {
        let parts: Vec<_> = group.split('-').collect();
        (1..=2).contains(&parts.len())
            && (5..=22).contains(&parts[0].len())
            && parts.iter().all(|part| {
                !part.is_empty() && part.len() <= 22 && part.bytes().all(|b| b.is_ascii_digit())
            })
    } else {
        false
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub chats: Vec<String>,
    pub agent_id: String,
    pub auto_reply: bool,
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if self.chats.is_empty()
            || self.chats.len() > 50
            || self.chats.iter().any(|chat| !valid_chat(chat))
            || self.agent_id.is_empty()
            || self.agent_id.len() > 80
            || !self
                .agent_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            Err("Selecione um agente e de 1 a 50 chats válidos para o WhatsApp.".into())
        } else {
            Ok(())
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Delivery {
    pub id: String,
    pub remote_id: String,
    pub account: String,
    pub chat_id: String,
    pub text: String,
    pub received_at: i64,
    #[serde(default)]
    pub source_at: Option<i64>,
    pub status: String,
    pub reply: Option<String>,
    pub conversation_id: Option<String>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Journal {
    #[serde(default)]
    pub expired: bool,
    pub account: String,
    pub config: Config,
    pub history: Vec<Delivery>,
    pub seen: Vec<String>,
}
pub struct PreparedReply {
    pub chat_id: String,
    pub text: String,
}
impl Journal {
    pub fn validate(&self) -> Result<(), String> {
        if self.history.len() > 20
            || self.seen.len() > 500
            || self.history.iter().any(|row| {
                row.text.len() > 24_000 || row.reply.as_ref().is_some_and(|r| r.len() > 16_000)
            })
        {
            Err("Histórico do WhatsApp inválido.".into())
        } else {
            Ok(())
        }
    }
    pub fn load(path: &Path) -> Result<Self, String> {
        use std::io::Read;
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(_) => return Err("Não foi possível ler o histórico do WhatsApp.".into()),
        };
        let mut bytes = Vec::new();
        file.take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Falha ao ler o histórico do WhatsApp.".to_string())?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("Histórico do WhatsApp excedeu o limite permitido.".into());
        }
        let mut journal: Self = serde_json::from_slice(&bytes).map_err(|_| {
            "Histórico do WhatsApp inválido. Preserve o arquivo antes de restaurá-lo.".to_string()
        })?;
        journal.validate()?;
        journal.interrupt();
        Ok(journal)
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let bytes = serde_json::to_vec(self)
            .map_err(|_| "Falha ao preparar histórico do WhatsApp.".to_string())?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("Histórico do WhatsApp excedeu o limite permitido.".into());
        }
        crate::commands::filesystem::write_atomic(path, &bytes).map_err(|_| {
            "Não foi possível salvar o histórico. O receptor WhatsApp foi pausado.".into()
        })
    }
    pub fn interrupt(&mut self) {
        for row in &mut self.history {
            if ["received", "processing"].contains(&row.status.as_str()) {
                row.status = "interrupted".into();
            }
        }
    }
    pub fn switch_account(&mut self, account: &str) {
        if self.account != account {
            self.interrupt();
            for row in &mut self.history {
                if row.status == "draft" {
                    row.status = "skipped".into();
                }
            }
            self.seen.clear();
            self.account = account.into();
        }
    }
    pub fn incoming(&mut self, event: &Value, since: i64) -> Result<bool, String> {
        let (Some(chat), Some(id), Some(text), Some(date)) = (
            event["chat_id"].as_str(),
            event["remote_id"].as_str(),
            event["text"].as_str(),
            event["timestamp"].as_i64(),
        ) else {
            return Ok(false);
        };
        if !valid_chat(chat)
            || !self.config.chats.iter().any(|allowed| allowed == chat)
            || date < since
            || date > now() + 60
            || id.is_empty()
            || id.len() > 128
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || text.trim().is_empty()
            || text.chars().count() > 6000
            || text.contains('\0')
        {
            return Ok(false);
        }
        let key = format!("{chat}:{id}");
        if self.seen.contains(&key) {
            return Ok(false);
        }
        if self.history.len() >= 20 {
            if let Some(index) = self.history.iter().position(|row| {
                !["received", "processing", "draft", "uncertain"].contains(&row.status.as_str())
            }) {
                self.history.remove(index);
            } else {
                return Err("Há 20 mensagens ou respostas pendentes. Revise ou descarte uma resposta para continuar.".into());
            }
        }
        self.history.push(Delivery {
            id: uuid::Uuid::new_v4().to_string(),
            remote_id: id.into(),
            account: self.account.clone(),
            chat_id: chat.into(),
            text: text.into(),
            received_at: now(),
            source_at: Some(date),
            status: "received".into(),
            reply: None,
            conversation_id: None,
        });
        self.seen.push(key);
        if self.seen.len() > 500 {
            self.seen.remove(0);
        }
        Ok(true)
    }
    pub fn prepare_send(&mut self, id: &str) -> Result<PreparedReply, String> {
        let row = self
            .history
            .iter_mut()
            .find(|row| row.id == id && row.status == "draft")
            .ok_or("Rascunho do WhatsApp indisponível.")?;
        if row.account != self.account || !self.config.chats.contains(&row.chat_id) {
            return Err("Esta resposta não está autorizada para a conta/chat atual.".into());
        }
        let reply = row
            .reply
            .as_ref()
            .filter(|r| {
                !r.trim().is_empty() && r.encode_utf16().count() <= 4000 && !r.contains('\0')
            })
            .ok_or("Resposta inválida para o WhatsApp.")?;
        row.status = "uncertain".into();
        Ok(PreparedReply {
            chat_id: row.chat_id.clone(),
            text: reply.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn journal() -> Journal {
        Journal {
            account: "5511888888888@s.whatsapp.net".into(),
            config: Config {
                chats: vec!["5511999999999@s.whatsapp.net".into()],
                agent_id: "profile".into(),
                auto_reply: false,
            },
            ..Journal::default()
        }
    }
    fn message(id: &str) -> Value {
        json!({"chat_id":"5511999999999@s.whatsapp.net","remote_id":id,"text":"Olá!","timestamp":now()})
    }
    #[test]
    fn allowed_chats_are_explicit_and_do_not_include_status_or_other_jid_types() {
        assert!(journal().config.validate().is_ok());
        for chat in [
            "*",
            "status@broadcast",
            "123@newsletter",
            "123456@lid",
            "5511999999999@s.whatsapp.net/path",
        ] {
            assert!(!valid_chat(chat));
        }
        assert!(valid_chat("120363123456789012@g.us"));
    }
    #[test]
    fn incoming_is_filtered_deduplicated_and_marked_before_generation() {
        let mut journal = journal();
        let mut event = message("ABC123");
        assert!(!journal.incoming(&event, now() + 1).unwrap());
        event["chat_id"] = json!("5511777777777@s.whatsapp.net");
        assert!(!journal.incoming(&event, 0).unwrap());
        event = message("ABC123");
        assert!(journal.incoming(&event, 0).unwrap());
        assert!(!journal.incoming(&event, 0).unwrap());
        assert_eq!(journal.history[0].status, "received");
    }
    #[test]
    fn send_marks_uncertainty_and_cannot_repeat_or_cross_accounts() {
        let mut journal = journal();
        journal.incoming(&message("ABC123"), 0).unwrap();
        journal.history[0].status = "draft".into();
        journal.history[0].reply = Some("Olá!".into());
        let id = journal.history[0].id.clone();
        let body = journal.prepare_send(&id).unwrap();
        assert_eq!(body.chat_id, "5511999999999@s.whatsapp.net");
        assert_eq!(journal.history[0].status, "uncertain");
        assert!(journal.prepare_send(&id).is_err());
        journal.history[0].status = "draft".into();
        journal.switch_account("5511666666666@s.whatsapp.net");
        assert!(journal.prepare_send(&id).is_err());
    }
    #[test]
    fn pending_entries_are_preserved_and_stop_interrupts_queued_work() {
        let mut journal = journal();
        for index in 0..20 {
            assert!(journal
                .incoming(&message(&format!("ID{index}")), 0)
                .unwrap());
        }
        assert!(journal.incoming(&message("ID21"), 0).is_err());
        assert_eq!(journal.history.len(), 20);
        journal.interrupt();
        assert!(journal
            .history
            .iter()
            .all(|row| row.status == "interrupted"));
        assert!(journal.incoming(&message("ID21"), 0).unwrap());
    }
}

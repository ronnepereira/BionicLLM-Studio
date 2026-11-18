//! Durable, explicit chat deletions. Backups may preserve data, but may never
//! override this ledger. All operations share the store backup writer lock.
use std::{collections::BTreeSet, path::Path, sync::Mutex};

pub(crate) static STORE_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn read(dir: &Path) -> Result<BTreeSet<String>, String> {
    match std::fs::read(dir.join("chat-deletions.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("Registro de exclusões inválido: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeSet::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn write(dir: &Path, ids: &BTreeSet<String>) -> Result<(), String> {
    use std::io::Write;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("chat-deletions.tmp");
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(ids).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    std::fs::rename(tmp, dir.join("chat-deletions.json")).map_err(|e| e.to_string())
}

pub(crate) fn filter(raw: &str, deleted: &BTreeSet<String>) -> Result<String, String> {
    if deleted.is_empty() {
        return Ok(raw.to_string());
    }
    let mut outer: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    if let Some(chat) = outer.get("chat-conversations").and_then(|v| v.as_str()) {
        let mut value: serde_json::Value = serde_json::from_str(chat).map_err(|e| e.to_string())?;
        if let Some(list) = value
            .pointer_mut("/state/conversations")
            .and_then(|v| v.as_array_mut())
        {
            list.retain(|c| {
                !c.get("id")
                    .and_then(|v| v.as_str())
                    .is_some_and(|id| deleted.contains(id))
            });
        }
        outer["chat-conversations"] = serde_json::Value::String(value.to_string());
    }
    Ok(outer.to_string())
}

#[tauri::command]
pub fn chat_deletions_update(ids: Vec<String>, deleted: bool) -> Result<Vec<String>, String> {
    let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
    let dir = super::system::persistent_dir()?;
    let mut ledger = read(&dir)?;
    for id in ids {
        if id.is_empty() || id.len() > 256 {
            return Err("ID de conversa inválido".into());
        }
        if deleted {
            ledger.insert(id);
        } else {
            ledger.remove(&id);
        }
    }
    write(&dir, &ledger)?;
    Ok(ledger.into_iter().collect())
}

#[tauri::command]
pub fn chat_deletions_read() -> Result<Vec<String>, String> {
    let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
    Ok(read(&super::system::persistent_dir()?)?
        .into_iter()
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_stale_snapshot_cannot_resurrect_a_deleted_chat() {
        let raw = serde_json::json!({"chat-conversations": serde_json::json!({"state":{"conversations":[{"id":"deleted"},{"id":"kept"}]}}).to_string(), "settings":"keep"}).to_string();
        let clean: serde_json::Value =
            serde_json::from_str(&filter(&raw, &BTreeSet::from(["deleted".into()])).unwrap())
                .unwrap();
        let chats: serde_json::Value =
            serde_json::from_str(clean["chat-conversations"].as_str().unwrap()).unwrap();
        assert_eq!(
            chats["state"]["conversations"],
            serde_json::json!([{"id":"kept"}])
        );
        assert_eq!(clean["settings"], "keep");
    }
    #[test]
    fn ledger_survives_reopen_and_explicit_undelete() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), &BTreeSet::from(["gone".into()])).unwrap();
        assert!(read(dir.path()).unwrap().contains("gone"));
        write(dir.path(), &BTreeSet::new()).unwrap();
        assert!(read(dir.path()).unwrap().is_empty());
    }
}

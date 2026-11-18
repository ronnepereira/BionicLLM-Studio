//! Bounded, cancellable connector operations; supports Stop before IPC registration.
use once_cell::sync::Lazy;
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;
#[derive(Default)]
struct Requests {
    active: HashMap<String, (&'static str, CancellationToken)>,
    cancelled: VecDeque<String>,
}
static REQUESTS: Lazy<Mutex<Requests>> = Lazy::new(|| Mutex::new(Requests::default()));
pub(crate) struct Request {
    id: String,
    pub cancel: CancellationToken,
}
impl Request {
    pub fn new(id: String, group: &'static str) -> Result<Self, String> {
        if uuid::Uuid::parse_str(&id).is_err() {
            return Err("Identificador de consulta do conector inválido.".into());
        }
        let mut requests = REQUESTS
            .lock()
            .map_err(|_| "Estado do conector indisponível.".to_string())?;
        if requests.cancelled.contains(&id) {
            return Err("Operação do conector cancelada.".into());
        }
        if requests.active.len() >= 16 || requests.active.contains_key(&id) {
            return Err("Já há consultas de conectores pendentes. Aguarde ou cancele.".into());
        }
        let cancel = CancellationToken::new();
        requests.active.insert(id.clone(), (group, cancel.clone()));
        Ok(Self { id, cancel })
    }
    pub fn check(&self) -> Result<(), String> {
        if self.cancel.is_cancelled() {
            Err("Operação do conector cancelada.".into())
        } else {
            Ok(())
        }
    }
}
impl Drop for Request {
    fn drop(&mut self) {
        if let Ok(mut requests) = REQUESTS.lock() {
            requests.active.remove(&self.id);
        }
    }
}
pub(crate) fn cancel_group(group: &'static str) {
    if let Ok(requests) = REQUESTS.lock() {
        for (key, token) in requests.active.values() {
            if *key == group {
                token.cancel();
            }
        }
    }
}
pub(crate) fn cancel_request(id: String) -> Result<(), String> {
    if uuid::Uuid::parse_str(&id).is_err() {
        return Err("Identificador do conector inválido.".into());
    }
    let mut requests = REQUESTS
        .lock()
        .map_err(|_| "Estado do conector indisponível.".to_string())?;
    if let Some((_, token)) = requests.active.get(&id) {
        token.cancel();
    }
    if !requests.cancelled.contains(&id) {
        requests.cancelled.push_back(id);
    }
    while requests.cancelled.len() > 128 {
        requests.cancelled.pop_front();
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_is_grouped_and_handles_early_stop_and_duplicate_ids() {
        let early = uuid::Uuid::new_v4().to_string();
        cancel_request(early.clone()).unwrap();
        assert!(Request::new(early, "early").is_err());
        let first = Request::new(uuid::Uuid::new_v4().to_string(), "first").unwrap();
        let second = Request::new(uuid::Uuid::new_v4().to_string(), "second").unwrap();
        cancel_group("first");
        assert!(first.check().is_err());
        assert!(second.check().is_ok());
        assert!(Request::new(second.id.clone(), "second").is_err());
        let id = second.id.clone();
        drop(second);
        assert!(Request::new(id, "second").is_ok());
    }
}

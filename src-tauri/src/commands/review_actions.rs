//! Durable review proposals shared by connectors. No network or automatic execution.
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{io::Read, path::Path};

pub(crate) trait ReviewInput: Clone + Serialize + DeserializeOwned {
    fn validate(&self) -> Result<(), String>;
    fn valid_account(&self, account: &str) -> bool;
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Pending,
    Uncertain,
    Done,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(bound(deserialize = "T: DeserializeOwned"))]
pub struct Draft<T> {
    pub id: String,
    pub account: String,
    pub input: T,
    pub phase: Phase,
    pub created_at: i64,
    pub remote_id: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(bound(deserialize = "T: DeserializeOwned"))]
pub(crate) struct Entry<T> {
    pub binding: String,
    #[serde(flatten)]
    pub draft: Draft<T>,
}
#[derive(Deserialize, Serialize)]
#[serde(bound(deserialize = "T: DeserializeOwned"))]
pub(crate) struct Journal<T> {
    pub entries: Vec<Entry<T>>,
}
impl<T> Default for Journal<T> {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
        }
    }
}
impl<T: ReviewInput> Journal<T> {
    pub fn load(path: &Path) -> Result<Self, String> {
        let file = match std::fs::File::open(path) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(_) => return Err("Não foi possível ler os rascunhos do conector.".into()),
        };
        let mut bytes = Vec::new();
        file.take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Leitura de rascunhos interrompida.".to_string())?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err(
                "O arquivo de rascunhos excedeu 4 MB. Preserve-o antes de restaurar.".into(),
            );
        }
        let journal: Self = serde_json::from_slice(&bytes).map_err(|_| {
            "Arquivo de rascunhos inválido. Preserve-o antes de restaurar.".to_string()
        })?;
        journal.validate()?;
        Ok(journal)
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.entries.len() > 20 {
            return Err("O limite é de vinte rascunhos/registros por conector.".into());
        }
        let mut ids = std::collections::HashSet::new();
        for entry in &self.entries {
            entry.draft.input.validate()?;
            if uuid::Uuid::parse_str(&entry.draft.id).is_err()
                || !ids.insert(&entry.draft.id)
                || !entry.draft.input.valid_account(&entry.draft.account)
                || uuid::Uuid::parse_str(&entry.binding).is_err()
                || entry
                    .draft
                    .remote_id
                    .as_ref()
                    .is_some_and(|v| v.len() > 128)
            {
                return Err("Registro de rascunho inválido.".into());
            }
        }
        Ok(())
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        self.validate()?;
        let bytes = serde_json::to_vec(self)
            .map_err(|_| "Não foi possível preparar os rascunhos.".to_string())?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("Os rascunhos excederam 4 MB.".into());
        }
        std::fs::create_dir_all(path.parent().ok_or("Pasta de rascunhos indisponível.")?)
            .map_err(|_| "Não foi possível criar a pasta de rascunhos.".to_string())?;
        crate::commands::filesystem::write_atomic(path, &bytes).map_err(|_| "Não foi possível salvar os rascunhos. Nenhuma ação deve ser repetida sem conferência.".into())
    }
    pub fn begin(&mut self, id: &str, account: &str, binding: &str) -> Result<(T, String), String> {
        let entry = self
            .entries
            .iter_mut()
            .find(|e| e.draft.id == id)
            .ok_or("Rascunho não encontrado.")?;
        if entry.draft.phase != Phase::Pending {
            return Err("Esta ação já foi confirmada ou tem envio incerto. Confira no serviço; não há repetição automática.".into());
        }
        if entry.draft.account != account || entry.binding != binding {
            return Err(
                "A conta ou autorização mudou. Prepare um novo rascunho para revisar.".into(),
            );
        }
        entry.draft.phase = Phase::Uncertain;
        Ok((entry.draft.input.clone(), entry.draft.id.clone()))
    }
    pub fn views(&self) -> Vec<Draft<T>> {
        self.entries.iter().map(|e| e.draft.clone()).collect()
    }
}

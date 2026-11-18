//! Only the native picker may introduce media. Drafts reference UUID snapshots, never arbitrary paths.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use tokio_util::sync::CancellationToken;
pub const MAX_SIZE: u64 = 512 * 1024 * 1024;
#[derive(Clone, Deserialize, Serialize, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Media {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub mime: String,
    pub sha256: String,
}
pub fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|v| v.to_string() == id)
}
impl Media {
    pub fn validate(&self) -> Result<(), String> {
        if !valid_id(&self.id)
            || self.name.is_empty()
            || self.name.chars().count() > 200
            || self.name.contains(['/', '\\'])
            || self.name.chars().any(char::is_control)
            || !(1..=MAX_SIZE).contains(&self.size)
            || ![
                "video/mp4",
                "video/quicktime",
                "video/webm",
                "video/x-matroska",
            ]
            .contains(&self.mime.as_str())
            || self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err("Registro de vídeo local inválido. Selecione o arquivo novamente.".into());
        }
        Ok(())
    }
}
fn file_path(root: &Path, id: &str, extension: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("ID de vídeo local inválido.".into());
    }
    Ok(root.join(format!("{id}.{extension}")))
}
pub fn list(root: &Path) -> Result<Vec<Media>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut records = Vec::new();
    for entry in
        std::fs::read_dir(root).map_err(|_| "Não foi possível consultar os vídeos locais.")?
    {
        let path = entry.map_err(|_| "Registro de vídeo indisponível.")?.path();
        if path.extension().is_none_or(|v| v != "json") {
            continue;
        }
        let file = File::open(&path).map_err(|_| "Não foi possível ler o registro de vídeo.")?;
        if file
            .metadata()
            .map_err(|_| "Registro de vídeo indisponível.")?
            .len()
            > 4096
        {
            return Err("Registro de vídeo excedeu o limite.".into());
        }
        let record: Media = serde_json::from_reader(file.take(4097))
            .map_err(|_| "Registro de vídeo local inválido; preservado para conferência.")?;
        record.validate()?;
        if path != file_path(root, &record.id, "json")? {
            return Err("Registro de vídeo com ID divergente.".into());
        }
        records.push(record);
        if records.len() > 5 {
            return Err(
                "Há mais de cinco vídeos locais. Confira o armazenamento do conector.".into(),
            );
        }
    }
    records.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
    Ok(records)
}
pub fn get(root: &Path, id: &str) -> Result<Media, String> {
    if !valid_id(id) {
        return Err("ID de vídeo local inválido.".into());
    }
    list(root)?.into_iter().find(|m| m.id == id).ok_or_else(|| {
        "Selecione o vídeo no painel do conector antes de preparar o rascunho.".into()
    })
}
fn format(path: &Path, head: &[u8]) -> Result<&'static str, String> {
    let extension = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "mp4" if head.get(4..8) == Some(b"ftyp") => Ok("video/mp4"),
        "mov" if matches!(head.get(4..8), Some(b"ftyp" | b"moov" | b"mdat" | b"wide")) => Ok("video/quicktime"),
        "webm" if head.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) => Ok("video/webm"),
        "mkv" if head.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) => Ok("video/x-matroska"),
        _ => Err("Selecione um vídeo MP4, MOV, WebM ou MKV válido. O serviço de destino verificará o codec e o processamento.".into()),
    }
}
pub fn snapshot(root: &Path, source: &Path, cancel: &CancellationToken) -> Result<Media, String> {
    if list(root)?.len() >= 5 {
        return Err("Remova um dos cinco vídeos locais antes de selecionar outro.".into());
    }
    let mut input =
        File::open(source).map_err(|_| "Não foi possível abrir o vídeo selecionado.")?;
    let info = input
        .metadata()
        .map_err(|_| "Não foi possível conferir o vídeo.")?;
    if !info.is_file() || !(1..=MAX_SIZE).contains(&info.len()) {
        return Err("Escolha um arquivo de vídeo com até 512 MiB.".into());
    }
    let name = source
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("Nome do vídeo inválido.")?
        .to_owned();
    let mut head = [0; 16];
    let count = input
        .read(&mut head)
        .map_err(|_| "Não foi possível ler o vídeo.")?;
    let mime = format(source, &head[..count])?.to_string();
    input
        .seek(SeekFrom::Start(0))
        .map_err(|_| "Não foi possível ler o vídeo.")?;
    let id = uuid::Uuid::new_v4().to_string();
    let mut media = Media {
        id,
        name,
        mime,
        size: info.len(),
        sha256: "0".repeat(64),
    };
    media.validate()?;
    std::fs::create_dir_all(root)
        .map_err(|_| "Não foi possível criar a pasta de vídeos locais.")?;
    let target = file_path(root, &media.id, "media")?;
    let metadata = file_path(root, &media.id, "json")?;
    let work = || -> Result<Media, String> {
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&target)
            .map_err(|_| "Não foi possível criar a cópia local do vídeo.")?;
        let mut hash = Sha256::new();
        let mut copied = 0u64;
        let mut buffer = vec![0; 64 * 1024];
        loop {
            if cancel.is_cancelled() {
                return Err("Seleção de vídeo cancelada.".into());
            }
            let n = input
                .read(&mut buffer)
                .map_err(|_| "Leitura do vídeo interrompida.")?;
            if n == 0 {
                break;
            }
            copied += n as u64;
            if copied > MAX_SIZE || copied > media.size {
                return Err("O vídeo mudou durante a cópia. Selecione novamente.".into());
            }
            hash.update(&buffer[..n]);
            output
                .write_all(&buffer[..n])
                .map_err(|_| "Não foi possível copiar o vídeo. Confira o espaço em disco.")?;
        }
        if copied != media.size {
            return Err("O vídeo mudou durante a cópia. Selecione novamente.".into());
        }
        output
            .sync_all()
            .map_err(|_| "Não foi possível salvar a cópia do vídeo.")?;
        media.sha256 = format!("{:x}", hash.finalize());
        if cancel.is_cancelled() {
            return Err("Seleção de vídeo cancelada.".into());
        }
        crate::commands::filesystem::write_atomic(
            &metadata,
            &serde_json::to_vec(&media).map_err(|_| "Registro de vídeo inválido.")?,
        )
        .map_err(|_| "Não foi possível salvar o registro do vídeo.")?;
        Ok(media)
    };
    match work() {
        Ok(v) => Ok(v),
        Err(e) => {
            let _ = std::fs::remove_file(target);
            Err(e)
        }
    }
}
pub fn checked_file(
    root: &Path,
    media: &Media,
    cancel: &CancellationToken,
) -> Result<File, String> {
    media.validate()?;
    if get(root, &media.id)? != *media {
        return Err("O registro do vídeo mudou. Selecione e revise novamente.".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    // Keep the checked snapshot protected against writes/deletion while it is uploaded on Windows.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1);
    }
    let mut file = options
        .open(file_path(root, &media.id, "media")?)
        .map_err(|_| "A cópia local do vídeo não está disponível.")?;
    let info = file
        .metadata()
        .map_err(|_| "Não foi possível conferir a cópia local.")?;
    if !info.is_file() || info.len() != media.size {
        return Err("A cópia local do vídeo mudou. Selecione novamente.".into());
    }
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 64 * 1024];
    loop {
        if cancel.is_cancelled() {
            return Err("Conferência de vídeo cancelada.".into());
        }
        let n = file
            .read(&mut buffer)
            .map_err(|_| "Conferência de vídeo interrompida.")?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    if format!("{:x}", hash.finalize()) != media.sha256 {
        return Err(
            "O conteúdo do vídeo mudou. Selecione novamente e revise outro rascunho.".into(),
        );
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|_| "Não foi possível preparar o vídeo.")?;
    Ok(file)
}
pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    let media = get(root, id)?;
    match std::fs::remove_file(file_path(root, &media.id, "media")?) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(_) => return Err("Não foi possível remover a cópia local do vídeo.".into()),
    }
    std::fs::remove_file(file_path(root, &media.id, "json")?)
        .map_err(|_| "A cópia foi removida, mas seu registro local não pôde ser excluído.".into())
}

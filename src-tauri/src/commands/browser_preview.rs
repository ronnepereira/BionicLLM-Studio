//! Scoped static preview. Each session owns an unpredictable URL and a loopback listener.
use std::{path::{Path, PathBuf}, sync::Arc};
use axum::{extract::{Path as RoutePath, State}, http::{header, HeaderMap, StatusCode}, response::{IntoResponse, Response}, routing::get, Router};
use tokio::sync::{oneshot, Mutex};

static SESSION: Mutex<Option<oneshot::Sender<()>>> = Mutex::const_new(None);
const MAX_BYTES: u64 = 32 * 1024 * 1024;

struct Preview { root: PathBuf, host: String }

fn mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "html" | "htm" => Some("text/html; charset=utf-8"),
        "css" => Some("text/css; charset=utf-8"),
        "js" | "mjs" => Some("text/javascript; charset=utf-8"),
        "json" | "map" => Some("application/json"),
        "svg" => Some("image/svg+xml"), "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"), "gif" => Some("image/gif"),
        "webp" => Some("image/webp"), "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"), "woff" => Some("font/woff"),
        "woff2" => Some("font/woff2"), "ttf" => Some("font/ttf"),
        "wasm" => Some("application/wasm"), "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"), "ogg" => Some("audio/ogg"),
        "mp4" => Some("video/mp4"), "webm" => Some("video/webm"),
        "txt" => Some("text/plain; charset=utf-8"),
        _ => None,
    }
}

fn asset_path(root: &Path, relative: &str) -> Result<PathBuf, StatusCode> {
    // Reject Windows separators, hidden files and alternate data streams before joining.
    if relative.contains(['\\', ':', '\0']) || relative.split('/').any(|part| part.starts_with('.')) {
        return Err(StatusCode::FORBIDDEN);
    }
    let candidate = root.join(relative);
    let path = super::filesystem::contain_within(root, &candidate).map_err(|_| StatusCode::FORBIDDEN)?;
    if mime(&path).is_none() { return Err(StatusCode::FORBIDDEN); }
    Ok(path)
}

async fn asset(State(preview): State<Arc<Preview>>, RoutePath(relative): RoutePath<String>, headers: HeaderMap) -> Response {
    if headers.get(header::HOST).and_then(|host| host.to_str().ok()) != Some(preview.host.as_str()) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let path = match asset_path(&preview.root, &relative) { Ok(path) => path, Err(status) => return status.into_response() };
    let metadata = match tokio::fs::metadata(&path).await { Ok(meta) if meta.is_file() => meta, _ => return StatusCode::NOT_FOUND.into_response() };
    if metadata.len() > MAX_BYTES { return StatusCode::PAYLOAD_TOO_LARGE.into_response(); }
    // Bound reads even if a file grows between metadata and read.
    use tokio::io::AsyncReadExt;
    let file = match tokio::fs::File::open(&path).await { Ok(file) => file, Err(_) => return StatusCode::NOT_FOUND.into_response() };
    let mut bytes = Vec::new();
    if file.take(MAX_BYTES + 1).read_to_end(&mut bytes).await.is_err() { return StatusCode::INTERNAL_SERVER_ERROR.into_response(); }
    if bytes.len() as u64 > MAX_BYTES { return StatusCode::PAYLOAD_TOO_LARGE.into_response(); }
    ([(header::CONTENT_TYPE, mime(&path).unwrap_or("application/octet-stream")),
      (header::CACHE_CONTROL, "no-store"), (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
      (header::REFERRER_POLICY, "no-referrer"),
      (header::CONTENT_SECURITY_POLICY, "frame-ancestors 'none'")], bytes).into_response()
}

pub(super) async fn open(path: &str, chat_id: Option<&str>, working_directory: Option<&str>) -> Result<String, String> {
    let entry = super::filesystem::resolve_path(path, chat_id, working_directory)?;
    if !entry.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("html") || ext.eq_ignore_ascii_case("htm")) {
        return Err("A prévia local requer um arquivo HTML existente. Informe seu caminho em path.".into());
    }
    let entry = std::fs::canonicalize(entry).map_err(|_| "Arquivo HTML não encontrado. Crie o arquivo antes de abrir a prévia.")?;
    if !entry.is_file() { return Err("Informe um arquivo HTML, em vez de uma pasta.".into()); }
    let root = entry.parent().ok_or("Pasta da prévia indisponível.")?.to_path_buf();
    let name = entry.file_name().and_then(|name| name.to_str()).ok_or("Nome de arquivo inválido.")?;
    asset_path(&root, name).map_err(|_| "Este arquivo não pode ser exibido na prévia.")?;
    let mut session = SESSION.lock().await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|error| format!("Não foi possível iniciar a prévia local. {error}"))?;
    let host = listener.local_addr().map_err(|error| error.to_string())?.to_string();
    let token = uuid::Uuid::new_v4().to_string();
    let mut url = tauri::Url::parse(&format!("http://{host}/{token}/")).map_err(|error| error.to_string())?;
    url.path_segments_mut().map_err(|_| "Endereço da prévia inválido.")?.pop_if_empty().push(name);
    let router = Router::new().route(&format!("/{token}/{{*path}}"), get(asset)).with_state(Arc::new(Preview { root, host }));
    let (stop, stopped) = oneshot::channel();
    tokio::spawn(async move { let _ = axum::serve(listener, router).with_graceful_shutdown(async { let _ = stopped.await; }).await; });
    if let Some(previous) = session.replace(stop) { let _ = previous.send(()); }
    Ok(url.to_string())
}

pub(super) async fn close() {
    if let Some(stop) = SESSION.lock().await.take() { let _ = stop.send(()); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn serves_html_and_assets_but_refuses_escapes_and_php() {
        let chat = format!("preview-test-{}", uuid::Uuid::new_v4());
        let root = super::super::filesystem::workspace_root(Some(&chat), None);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("timer espaço.html"), "<button>Iniciar</button>").unwrap();
        std::fs::write(root.join("style.css"), "body{color:blue}").unwrap();
        std::fs::write(root.join(".env"), "secret").unwrap();
        let url = open("timer espaço.html", Some(&chat), None).await.unwrap();
        let client = reqwest::Client::new();
        assert!(client.get(&url).send().await.unwrap().text().await.unwrap().contains("Iniciar"));
        let base = tauri::Url::parse(&url).unwrap();
        assert_eq!(client.get(base.join("style.css").unwrap()).send().await.unwrap().status(), 200);
        assert_eq!(client.get(base.join(".env").unwrap()).send().await.unwrap().status(), 403);
        assert_eq!(client.get(&url).header("Host", "other.example").send().await.unwrap().status(), 403);
        assert!(asset_path(&root, "../outside.html").is_err());
        assert!(asset_path(&root, "C:\\outside.html").is_err());
        assert!(open("missing.html", Some(&chat), None).await.is_err());
        assert!(open("index.php", Some(&chat), None).await.is_err());
        close().await;
        // Remove only the files this test created.
        for name in ["timer espaço.html", "style.css", ".env"] { std::fs::remove_file(root.join(name)).unwrap(); }
        std::fs::remove_dir(root).unwrap();
    }
}

// HTML snippets use a separate origin so the app's CSP can keep inline code
// blocked while the sandboxed preview runs the scripts the user enabled.
static FRAMES: std::sync::LazyLock<Mutex<std::collections::HashMap<String, oneshot::Sender<()>>>> = std::sync::LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

#[tauri::command]
pub async fn html_preview(window: tauri::WebviewWindow, action: String, id: Option<String>, doc: Option<String>) -> Result<serde_json::Value, String> {
    if window.label() != "main" { return Err("Esta prévia pertence à janela principal.".into()); }
    let mut frames = FRAMES.lock().await;
    if action == "close" {
        if let Some(stop) = id.and_then(|id| frames.remove(&id)) { let _ = stop.send(()); }
        return Ok(serde_json::json!({ "ok": true }));
    }
    if action != "open" { return Err("Ação de prévia inválida.".into()); }
    let doc = doc.ok_or("Conteúdo da prévia ausente.")?;
    if doc.len() > 2 * 1024 * 1024 { return Err("O HTML excede o limite de 2 MB da prévia.".into()); }
    if frames.len() >= 16 { return Err("Feche uma prévia antes de abrir outra.".into()); }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let host = listener.local_addr().map_err(|e| e.to_string())?.to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let url = format!("http://{host}/{id}");
    let router = Router::new().route(&format!("/{id}"), get(move |headers: HeaderMap| {
        let doc = doc.clone();
        let host = host.clone();
        async move {
            if headers.get(header::HOST).and_then(|value| value.to_str().ok()) != Some(host.as_str()) {
                return StatusCode::FORBIDDEN.into_response();
            }
            ([(header::CONTENT_TYPE, "text/html; charset=utf-8"),
              (header::CACHE_CONTROL, "no-store"),
              (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
              (header::REFERRER_POLICY, "no-referrer"),
              (header::CONTENT_SECURITY_POLICY, "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src https: data: blob:; media-src https: data: blob:; font-src https: data:; connect-src https:; base-uri 'none'; form-action 'none'; sandbox allow-scripts")], doc).into_response()
        }
    }));
    let (stop, stopped) = oneshot::channel();
    frames.insert(id.clone(), stop);
    tokio::spawn(async move { let _ = axum::serve(listener, router).with_graceful_shutdown(async { let _ = stopped.await; }).await; });
    Ok(serde_json::json!({ "id": id, "url": url }))
}

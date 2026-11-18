//! A user-operated PTY. Not registered as an agent tool and never restored from chat data.
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::{Arc, LazyLock, Mutex};

const OUTPUT_LIMIT: usize = 512 * 1024;
struct Output { bytes: VecDeque<u8>, dropped: bool }
struct Session {
    id: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    output: Arc<Mutex<Output>>,
}
static SESSION: LazyLock<Mutex<Option<Session>>> = LazyLock::new(|| Mutex::new(None));
fn size(cols: u16, rows: u16) -> PtySize { PtySize { cols: cols.clamp(10, 500), rows: rows.clamp(2, 200), pixel_width: 0, pixel_height: 0 } }
fn err(e: impl std::fmt::Display) -> String { format!("Terminal: {e}") }
fn with_session<T>(id: &str, f: impl FnOnce(&mut Session) -> Result<T, String>) -> Result<T, String> {
    let mut guard = SESSION.lock().map_err(err)?;
    let session = guard.as_mut().filter(|s| s.id == id).ok_or("Esta sessão de terminal não está ativa.")?;
    f(session)
}

#[tauri::command]
pub async fn studio_terminal_start(working_directory: Option<String>, cols: u16, rows: u16) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || start(working_directory.as_deref(), cols, rows)).await.map_err(err)?
}
fn start(working_directory: Option<&str>, cols: u16, rows: u16) -> Result<serde_json::Value, String> {
    let mut guard = SESSION.lock().map_err(err)?;
    if guard.is_some() { return Err("Encerre o terminal atual antes de iniciar outro.".into()); }
    let cwd = crate::commands::filesystem::resolve_path(".", Some("terminal"), working_directory)?;
    std::fs::create_dir_all(&cwd).map_err(err)?;
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(err)?;
    #[cfg(windows)]
    let mut command = {
        let system = std::env::var_os("SystemRoot").ok_or("Windows não informou a pasta do sistema.")?;
        let shell = std::path::PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut cmd = CommandBuilder::new(shell);
        cmd.args(["-NoLogo", "-NoProfile", "-NoExit", "-Command", "[Console]::InputEncoding=[System.Text.UTF8Encoding]::new(); [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $OutputEncoding=[Console]::OutputEncoding"]);
        cmd
    };
    #[cfg(not(windows))]
    let mut command = { let mut cmd = CommandBuilder::new("/bin/sh"); cmd.arg("-i"); cmd };
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");
    command.env_remove("NODE_OPTIONS");
    command.env_remove("NODE_PATH");
    let mut reader = pair.master.try_clone_reader().map_err(err)?;
    let writer = pair.master.take_writer().map_err(err)?;
    let child = pair.slave.spawn_command(command).map_err(err)?;
    drop(pair.slave);
    let pid = child.process_id();
    let output = Arc::new(Mutex::new(Output { bytes: VecDeque::new(), dropped: false }));
    let sink = output.clone();
    std::thread::spawn(move || {
        let mut bytes = [0u8; 8192];
        loop {
            let count = match reader.read(&mut bytes) { Ok(0) | Err(_) => break, Ok(n) => n };
            if let Ok(mut out) = sink.lock() {
                out.bytes.extend(&bytes[..count]);
                if out.bytes.len() > OUTPUT_LIMIT {
                    let excess = out.bytes.len() - OUTPUT_LIMIT;
                    out.bytes.drain(..excess);
                    out.dropped = true;
                }
            } else { break; }
        }
    });
    let id = uuid::Uuid::new_v4().to_string();
    *guard = Some(Session { id: id.clone(), master: pair.master, writer, child, output });
    Ok(serde_json::json!({ "id": id, "cwd": cwd.to_string_lossy(), "pid": pid }))
}

#[tauri::command]
pub async fn studio_terminal_write(id: String, data: String) -> Result<(), String> {
    if data.len() > 64 * 1024 { return Err("Envie até 64 KB por vez ao terminal.".into()); }
    tokio::task::spawn_blocking(move || with_session(&id, |s| { s.writer.write_all(data.as_bytes()).map_err(err)?; s.writer.flush().map_err(err) })).await.map_err(err)?
}
#[tauri::command]
pub fn studio_terminal_read(id: String) -> Result<serde_json::Value, String> {
    with_session(&id, |s| {
        let status = s.child.try_wait().map_err(err)?;
        let mut output = s.output.lock().map_err(err)?;
        let count = output.bytes.len().min(64 * 1024);
        let bytes: Vec<u8> = output.bytes.drain(..count).collect();
        let dropped = std::mem::take(&mut output.dropped);
        Ok(serde_json::json!({ "bytes": bytes, "dropped": dropped, "exitCode": status.map(|s| s.exit_code()) }))
    })
}
#[tauri::command]
pub fn studio_terminal_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    with_session(&id, |s| s.master.resize(size(cols, rows)).map_err(err))
}
fn stop(mut session: Session) {
    if matches!(session.child.try_wait(), Ok(None)) {
        if let Some(pid) = session.child.process_id() { crate::process_util::kill_pid_tree(pid); }
        let _ = session.child.kill();
    }
    // ConPTY and its pipes are released when the session is dropped.
}
pub fn shutdown() {
    let taken = SESSION.lock().ok().and_then(|mut slot| slot.take());
    if let Some(session) = taken { stop(session); }
}
#[tauri::command]
pub async fn studio_terminal_close(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let session = {
            let mut slot = SESSION.lock().map_err(err)?;
            if slot.as_ref().is_some_and(|s| s.id == id) { slot.take() } else { None }
        };
        if let Some(session) = session { stop(session); }
        Ok(())
    }).await.map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_size_is_bounded() {
        assert_eq!(size(0, 0).cols, 10);
        assert_eq!(size(u16::MAX, u16::MAX).rows, 200);
    }
    #[tokio::test]
    async fn real_pty_keeps_variables_resizes_and_closes() {
        let started = start(None, 80, 24).expect("start real PTY");
        let id = started["id"].as_str().unwrap().to_string();
        struct Cleanup;
        impl Drop for Cleanup { fn drop(&mut self) { shutdown(); } }
        let _cleanup = Cleanup;
        assert!(start(None, 80, 24).is_err());
        assert!(studio_terminal_write(id.clone(), "x".repeat(65537)).await.is_err());
        // ConPTY asks the terminal emulator for its cursor before accepting input.
        // xterm answers this automatically in the app; this headless test must too.
        #[cfg(windows)]
        {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
            let mut initial = String::new();
            while std::time::Instant::now() < deadline {
                let read = studio_terminal_read(id.clone()).unwrap();
                let bytes: Vec<u8> = read["bytes"].as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8).collect();
                initial.push_str(&String::from_utf8_lossy(&bytes));
                if initial.contains("\u{1b}[6n") {
                    studio_terminal_write(id.clone(), "\u{1b}[1;1R".into()).await.unwrap();
                    initial.clear();
                }
                if initial.contains("PS ") { break; }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        }
        #[cfg(windows)]
        let command = "$global:bionicPtyProof=73; Write-Output ('PTY-' + $global:bionicPtyProof)\r";
        #[cfg(not(windows))]
        let command = "bionicPtyProof=73; echo PTY-$bionicPtyProof\n";
        studio_terminal_write(id.clone(), command.into()).await.unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        let mut output = Vec::new();
        while std::time::Instant::now() < deadline {
            let read = studio_terminal_read(id.clone()).unwrap();
            output.extend(read["bytes"].as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8));
            if String::from_utf8_lossy(&output).contains("PTY-73") { break; }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert!(String::from_utf8_lossy(&output).contains("PTY-73"), "{}", String::from_utf8_lossy(&output));
        studio_terminal_resize(id.clone(), 100, 30).unwrap();
        assert_eq!(with_session(&id, |s| Ok(s.master.get_size().map_err(err)?.cols)).unwrap(), 100);
        studio_terminal_close(id.clone()).await.unwrap();
        assert!(studio_terminal_read(id).is_err());
    }
}

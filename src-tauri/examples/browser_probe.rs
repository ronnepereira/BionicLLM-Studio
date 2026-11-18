//! Isolated native acceptance harness. No AppState, engines, accounts, installer or user data.
#[path = "../src/commands/studio_browser.rs"]
mod studio_browser;
#[path = "../src/commands/studio_skills.rs"]
mod studio_skills;
use tauri::Manager;

#[tauri::command]
fn probe_progress(message: String) {
    if let Ok(path) = std::env::var("BIONIC_BROWSER_PROBE_REPORT") { let _ = std::fs::write(format!("{path}.page.log"), message); }
}
#[tauri::command]
fn probe_finish(app: tauri::AppHandle, report: serde_json::Value) {
    let mut report = report;
    report["mainWindowPreserved"] = serde_json::json!(app.get_webview_window("main").is_some());
    if let Ok(path) = std::env::var("BIONIC_BROWSER_PROBE_REPORT") {
        let _ = std::fs::write(path, serde_json::to_string_pretty(&report).unwrap());
    }
    app.exit(if report["ok"] == true && report["mainWindowPreserved"] == true { 0 } else { 1 });
}
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Ok(path) = std::env::var("BIONIC_BROWSER_PROBE_REPORT") {
                let _ = std::fs::write(format!("{path}.setup.log"), format!("{:?}", app.config().build));
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(40));
                    let _ = std::fs::write(path, "{\"ok\":false,\"error\":\"Tempo limite do teste nativo\"}");
                    handle.exit(1);
                });
            }
            Ok(())
        })
        .on_page_load(|webview, _| {
            if let Ok(path) = std::env::var("BIONIC_BROWSER_PROBE_REPORT") {
                let _ = std::fs::write(format!("{path}.page.log"), "Page load event");
                let _ = webview.eval("window.__TAURI_INTERNALS__.invoke('probe_progress',{message:JSON.stringify({url:location.href,title:document.title,body:document.body?.innerText?.slice(0,300),tauri:typeof window.__TAURI__})})");
            }
        })
        .invoke_handler(tauri::generate_handler![studio_browser::studio_browser, studio_skills::studio_skills_scan, studio_skills::studio_skill_read, probe_finish, probe_progress])
        .run(tauri::generate_context!("examples/browser-probe/tauri.conf.json"))
        .expect("native browser probe");
}

//! Native child controller, NOT a Tauri webview: no IPC scripts or host objects.
//! Separate WebView2 environment/profile preserves the app's single-webview contract.
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, WebviewWindow};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowserRequest {
    action: String,
    tab_id: Option<String>,
    url: Option<String>,
    path: Option<String>,
    chat_id: Option<String>,
    working_directory: Option<String>,
    bounds: Option<BrowserBounds>,
    token: Option<String>,
    target: Option<String>,
    text: Option<String>,
    x: Option<i32>,
    y: Option<i32>,
    zoom: Option<u16>,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserBounds { x: i32, y: i32, width: i32, height: i32 }

fn checked_url(raw: &str) -> Result<String, String> {
    let input = raw.trim();
    if input.is_empty() || input.len() > 8192 || raw.chars().any(|c| c.is_control()) { return Err("Informe um endereço de site válido.".into()); }
    let input = if input.contains("://") { input.to_string() } else { format!("https://{input}") };
    let url = tauri::Url::parse(&input).map_err(|_| "Informe um endereço de site válido.")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || matches!(url.host_str(), Some("tauri.localhost" | "ipc.localhost")) {
        return Err("O navegador aceita apenas sites HTTP ou HTTPS, sem credenciais no endereço.".into());
    }
    Ok(url.to_string())
}

#[tauri::command]
pub async fn studio_browser(window: WebviewWindow, app: AppHandle, mut request: BrowserRequest) -> Result<Value, String> {
    if window.label() != "main" { return Err("Este comando pertence à interface principal do aplicativo.".into()); }
    if request.tab_id.as_ref().is_some_and(|id| uuid::Uuid::parse_str(id).is_err()) {
        return Err("Identificador de aba inválido.".into());
    }
    if request.action == "preview" {
        request.url = Some(super::browser_preview::open(request.path.as_deref().unwrap_or_default(), request.chat_id.as_deref(), request.working_directory.as_deref()).await?);
        request.action = "navigate".into();
    }
    if request.action == "close" { super::browser_preview::close().await; }
    #[cfg(target_os = "windows")]
    { native::command(app, request).await }
    #[cfg(not(target_os = "windows"))]
    { let _ = (app, request); Err("O navegador interno desta versão requer Windows 11 com WebView2.".into()) }
}

#[cfg(target_os = "windows")]
mod native {
    use super::*;
    use std::{cell::{Cell, RefCell}, collections::HashMap, rc::Rc, time::Duration, sync::atomic::{AtomicU64, Ordering}};
    use tauri::{Emitter, Manager};
    use tokio::sync::{oneshot, Mutex};
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, CoTaskMemPWSTR, CreateCoreWebView2EnvironmentCompletedHandler, CreateCoreWebView2ControllerCompletedHandler, NavigationStartingEventHandler, NavigationCompletedEventHandler, SourceChangedEventHandler, DocumentTitleChangedEventHandler, NewWindowRequestedEventHandler, PermissionRequestedEventHandler, ExecuteScriptCompletedHandler, LaunchingExternalUriSchemeEventHandler, CallDevToolsProtocolMethodCompletedHandler, ClearBrowsingDataCompletedHandler};
    use webview2_com::FindStartCompletedHandler;
    use windows::{core::{PCWSTR, PWSTR, Interface}, Win32::Foundation::{HWND, RECT}};
    use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, SetWindowPos, ShowWindow, HWND_TOP, SWP_NOACTIVATE, SW_HIDE, SW_SHOWNOACTIVATE, WS_CHILD, WS_CLIPSIBLINGS, WS_CLIPCHILDREN};

    static SERIAL: Mutex<()> = Mutex::const_new(());
    static STOP_EPOCH: AtomicU64 = AtomicU64::new(0);
    type Reply = oneshot::Sender<Result<Value, String>>;
    struct BrowserHost(windows_sys::Win32::Foundation::HWND);
    impl Drop for BrowserHost {
        fn drop(&mut self) { unsafe { let _ = DestroyWindow(self.0); } }
    }
    struct Browser {
        controller: ICoreWebView2Controller,
        page: ICoreWebView2,
        host: Rc<BrowserHost>,
        token: Option<String>,
        visible: bool,
        loading: bool,
        failure: Option<String>,
    }
    thread_local! {
        static BROWSERS: RefCell<HashMap<String, Browser>> = RefCell::new(HashMap::new());
        static ACTIVE_TAB: RefCell<Option<String>> = const { RefCell::new(None) };
        static REVISION: Cell<u64> = const { Cell::new(0) };
    }
    fn is_active(id: &str) -> bool {
        ACTIVE_TAB.with(|active| active.borrow().as_deref() == Some(id))
    }
    fn changed(id: &str) {
        if is_active(id) {
            REVISION.with(|revision| revision.set(revision.get().wrapping_add(1)));
        }
        BROWSERS.with(|state| {
            if let Some(browser) = state.borrow_mut().get_mut(id) { browser.token = None; }
        });
    }
    fn update_visibility(id: &str, visible: bool) {
        BROWSERS.with(|state| {
            if let Some(browser) = state.borrow_mut().get_mut(id) { browser.visible = visible; }
        });
    }
    fn loading_state(id: &str) -> (bool, Option<String>) {
        BROWSERS.with(|state| state.borrow().get(id).map(|browser| (browser.loading, browser.failure.clone())).unwrap_or_default())
    }
    fn error(error: impl std::fmt::Display) -> String { format!("Falha no navegador interno: {error}") }
    fn string(read: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>) -> String {
        let mut value = PWSTR::null();
        if read(&mut value).is_err() { return String::new(); }
        CoTaskMemPWSTR::from(value).to_string()
    }
    fn emit(app: &AppHandle, id: &str, page: &ICoreWebView2, loading: bool, failure: Option<String>) {
        BROWSERS.with(|state| {
            if let Some(browser) = state.borrow_mut().get_mut(id) {
                browser.loading = loading;
                browser.failure = failure.clone();
            }
        });
        let url = string(|value| unsafe { page.Source(value) });
        let title = string(|value| unsafe { page.DocumentTitle(value) });
        let mut back = windows::core::BOOL::default();
        let mut forward = windows::core::BOOL::default();
        unsafe { let _ = page.CanGoBack(&mut back); let _ = page.CanGoForward(&mut forward); }
        let _ = app.emit_to("main", "studio-browser-state", json!({ "tabId": id, "url": url, "title": title, "loading": loading, "canGoBack": back.as_bool(), "canGoForward": forward.as_bool(), "error": failure }));
    }
    fn rect(bounds: &BrowserBounds, app: &AppHandle) -> Result<RECT, String> {
        let size = app.get_webview_window("main").ok_or("Janela principal indisponível.")?.inner_size().map_err(error)?;
        if bounds.x < 0 || bounds.y < 0 || bounds.width < 1 || bounds.height < 1 || bounds.x as i64 + bounds.width as i64 > size.width as i64 + 2 || bounds.y as i64 + bounds.height as i64 > size.height as i64 + 2 { return Err("A área do navegador precisa ficar dentro da janela do aplicativo.".into()); }
        Ok(RECT { left: bounds.x, top: bounds.y, right: bounds.x + bounds.width, bottom: bounds.y + bounds.height })
    }
    unsafe fn layout(host: &BrowserHost, controller: &ICoreWebView2Controller, bounds: RECT, visible: bool) -> Result<(), String> {
        let width = bounds.right - bounds.left;
        let height = bounds.bottom - bounds.top;
        if SetWindowPos(host.0, HWND_TOP, bounds.left, bounds.top, width, height, SWP_NOACTIVATE) == 0 {
            return Err(error(std::io::Error::last_os_error()));
        }
        controller.SetBounds(RECT { left: 0, top: 0, right: width, bottom: height }).map_err(error)?;
        controller.NotifyParentWindowPositionChanged().map_err(error)?;
        controller.SetIsVisible(visible).map_err(error)?;
        ShowWindow(host.0, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
        Ok(())
    }
    unsafe fn configure(app: AppHandle, id: &str, controller: ICoreWebView2Controller, bounds: RECT, host: Rc<BrowserHost>) -> Result<(), String> {
        let page = controller.CoreWebView2().map_err(error)?;
        let settings = page.Settings().map_err(error)?;
        settings.SetIsWebMessageEnabled(false).map_err(error)?;
        settings.SetAreHostObjectsAllowed(false).map_err(error)?;
        settings.SetAreDevToolsEnabled(false).map_err(error)?;
        settings.SetAreDefaultContextMenusEnabled(false).map_err(error)?;
        layout(&host, &controller, bounds, false)?;
        let mut event_token = 0;
        let external: ICoreWebView2_18 = page.cast().map_err(error)?;
        external.add_LaunchingExternalUriScheme(&LaunchingExternalUriSchemeEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args { args.SetCancel(true)?; } Ok(())
        })), &mut event_token).map_err(error)?;
        let init = CoTaskMemPWSTR::from("for (const type of ['pointerdown','keydown']) addEventListener(type, event => { if(event.isTrusted) delete window.__bionicBrowserSnapshot }, true)");
        page.AddScriptToExecuteOnDocumentCreated(*init.as_ref().as_pcwstr(), None).map_err(error)?;
        let handle = app.clone();
        let tab = id.to_owned();
        page.add_NavigationStarting(&NavigationStartingEventHandler::create(Box::new(move |page, args| {
            changed(&tab);
            if let (Some(page), Some(args)) = (page, args) {
                let url = string(|value| args.Uri(value));
                if url != "about:blank" && checked_url(&url).is_err() { args.SetCancel(true)?; emit(&handle, &tab, &page, false, Some("Este tipo de endereço não pode ser aberto no navegador interno.".into())); }
                else { emit(&handle, &tab, &page, true, None); }
            }
            Ok(())
        })), &mut event_token).map_err(error)?;
        let handle = app.clone();
        let tab = id.to_owned();
        page.add_NavigationCompleted(&NavigationCompletedEventHandler::create(Box::new(move |page, args| {
            if let Some(page) = page {
                let mut success = windows::core::BOOL::default();
                if let Some(args) = args { args.IsSuccess(&mut success)?; }
                emit(&handle, &tab, &page, false, if success.as_bool() { None } else { Some("Não foi possível carregar este site. Confira o endereço e a conexão.".into()) });
            }
            Ok(())
        })), &mut event_token).map_err(error)?;
        let handle = app.clone();
        let tab = id.to_owned();
        page.add_SourceChanged(&SourceChangedEventHandler::create(Box::new(move |page, _| {
            changed(&tab);
            if let Some(page) = page {
                let (loading, failure) = loading_state(&tab);
                emit(&handle, &tab, &page, loading, failure);
            }
            Ok(())
        })), &mut event_token).map_err(error)?;
        let handle = app.clone();
        let tab = id.to_owned();
        page.add_DocumentTitleChanged(&DocumentTitleChangedEventHandler::create(Box::new(move |page, _| {
            if let Some(page) = page {
                let (loading, failure) = loading_state(&tab);
                emit(&handle, &tab, &page, loading, failure);
            }
            Ok(())
        })), &mut event_token).map_err(error)?;
        // target=_blank remains inside this same controller; never launch an external app.
        page.add_NewWindowRequested(&NewWindowRequestedEventHandler::create(Box::new(move |page, args| {
            if let Some(args) = args {
                args.SetHandled(true)?;
                let url = string(|value| args.Uri(value));
                if let (Some(page), Ok(url)) = (page, checked_url(&url)) { page.Navigate(PCWSTR::from_raw(url.encode_utf16().chain(Some(0)).collect::<Vec<_>>().as_ptr()))?; }
            }
            Ok(())
        })), &mut event_token).map_err(error)?;
        // Native site permission prompt, never grant camera/mic/location silently.
        page.add_PermissionRequested(&PermissionRequestedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DEFAULT)?; } Ok(())
        })), &mut event_token).map_err(error)?;
        BROWSERS.with(|state| state.borrow_mut().insert(id.to_owned(), Browser { controller, page, host, token: None, visible: false, loading: false, failure: None }));
        Ok(())
    }

    fn create(app: AppHandle, id: String, request: BrowserRequest, reply: Reply) {
        let epoch = STOP_EPOCH.load(Ordering::SeqCst);
        let pending = Rc::new(RefCell::new(Some(reply)));
        let response = pending.clone();
        let result = (|| -> Result<(), String> {
            let bounds = rect(request.bounds.as_ref().ok_or("Área do navegador ausente.")?, &app)?;
            let parent = app.get_webview_window("main").ok_or("Janela principal indisponível.")?.hwnd().map_err(error)?;
            // A dedicated child HWND lets the browser stay above the main WebView
            // while its bounds remain confined to the panel.
            let child = unsafe { CreateWindowExW(0, windows_sys::w!("STATIC"), windows_sys::w!("Bionic browser"), WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN, bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top, parent.0 as _, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null()) };
            if child.is_null() { return Err(error(std::io::Error::last_os_error())); }
            let host = Rc::new(BrowserHost(child));
            let hwnd = HWND(child as _);
            let profile = match crate::debug_webview_profile("browser") {
                Some(profile) => profile,
                None => app.path().app_data_dir().map_err(error)?.join("bionic-browser-profile"),
            };
            std::fs::create_dir_all(&profile).map_err(error)?;
            let directory: Vec<u16> = profile.to_string_lossy().encode_utf16().chain(Some(0)).collect();
            let handler = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(move |status, environment| {
                let response = response.clone();
                let host = host.clone();
                let id = id.clone();
                let result = (|| -> Result<(), String> {
                    status.map_err(error)?;
                    let environment = environment.ok_or("WebView2 indisponível. Instale o Microsoft Edge WebView2 Runtime.")?;
                    let complete = response.clone();
                    let callback = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(move |status, controller| {
                        let result = (|| -> Result<Value, String> {
                            status.map_err(error)?;
                            let controller = controller.ok_or("Não foi possível criar o navegador interno.")?;
                            if !is_active(&id) || STOP_EPOCH.load(Ordering::SeqCst) != epoch || complete.borrow().as_ref().is_none_or(|reply| reply.is_closed()) { unsafe { let _ = controller.Close(); } return Err("A abertura do navegador foi cancelada.".into()); }
                            let cleanup = controller.clone();
                            if let Err(failure) = unsafe { configure(app.clone(), &id, controller, bounds, host.clone()) } {
                                unsafe { let _ = cleanup.Close(); }
                                return Err(failure);
                            }
                            Ok(json!({ "ok": true }))
                        })();
                        if let Some(reply) = complete.borrow_mut().take() { let _ = reply.send(result); }
                        Ok(())
                    }));
                    unsafe { environment.CreateCoreWebView2Controller(hwnd, &callback).map_err(error)?; }
                    Ok(())
                })();
                if let Err(error) = result { if let Some(reply) = response.borrow_mut().take() { let _ = reply.send(Err(error)); } }
                Ok(())
            }));
            unsafe { CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), PCWSTR(directory.as_ptr()), None, &handler).map_err(error)?; }
            Ok(())
        })();
        if let Err(error) = result { if let Some(reply) = pending.borrow_mut().take() { let _ = reply.send(Err(error)); } }
    }

    fn input_event(page: ICoreWebView2, method: &'static str, events: Rc<Vec<Value>>, index: usize, epoch: u64, response: Rc<RefCell<Option<Reply>>>) {
        if STOP_EPOCH.load(Ordering::SeqCst) != epoch {
            if let Some(reply) = response.borrow_mut().take() { let _ = reply.send(Err("Interação cancelada pelo usuário. Confira a página antes de repetir.".into())); }
            return;
        }
        let Some(params) = events.get(index) else {
            if let Some(reply) = response.borrow_mut().take() { let _ = reply.send(Ok(json!({ "ok": true }))); }
            return;
        };
        let params = CoTaskMemPWSTR::from(params.to_string().as_str());
        let next_page = page.clone();
        let next_response = response.clone();
        let next_events = events.clone();
        let callback = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, _| {
            if let Err(failure) = status {
                if let Some(reply) = next_response.borrow_mut().take() { let _ = reply.send(Err(error(failure))); }
            } else {
                input_event(next_page.clone(), method, next_events.clone(), index + 1, epoch, next_response.clone());
            }
            Ok(())
        }));
        let operation = CoTaskMemPWSTR::from(method);
        if let Err(failure) = unsafe { page.CallDevToolsProtocolMethod(*operation.as_ref().as_pcwstr(), *params.as_ref().as_pcwstr(), &callback) } {
            if let Some(reply) = response.borrow_mut().take() { let _ = reply.send(Err(error(failure))); }
        }
    }
    fn focused_input(page: ICoreWebView2, method: &'static str, events: Vec<Value>, reply: Reply) {
        // CDP keyboard events need an active page even while the app is in the
        // background. Focus emulation keeps input inside this browser target.
        let response = Rc::new(RefCell::new(Some(reply)));
        let next_response = response.clone();
        let next_page = page.clone();
        let events = Rc::new(events);
        let epoch = STOP_EPOCH.load(Ordering::SeqCst);
        let callback = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, _| {
            match status {
                Ok(()) => input_event(next_page.clone(), method, events.clone(), 0, epoch, next_response.clone()),
                Err(failure) => { if let Some(reply) = next_response.borrow_mut().take() { let _ = reply.send(Err(error(failure))); } }
            }
            Ok(())
        }));
        let operation = CoTaskMemPWSTR::from("Emulation.setFocusEmulationEnabled");
        let params = CoTaskMemPWSTR::from("{\"enabled\":true}");
        if let Err(failure) = unsafe { page.CallDevToolsProtocolMethod(*operation.as_ref().as_pcwstr(), *params.as_ref().as_pcwstr(), &callback) } {
            if let Some(reply) = response.borrow_mut().take() { let _ = reply.send(Err(error(failure))); }
        }
    }
    fn press_key(page: ICoreWebView2, key: String, reply: Reply) {
        let code = match key.as_str() { "Enter" => 13, "Tab" => 9, "Escape" => 27, "Backspace" => 8, "ArrowLeft" => 37, "ArrowUp" => 38, "ArrowRight" => 39, "ArrowDown" => 40, "Home" => 36, "End" => 35, "PageUp" => 33, "PageDown" => 34, "Space" => 32, _ => { let _ = reply.send(Err("Tecla não suportada pelo navegador.".into())); return; } };
        let events = vec![
            json!({ "type": "keyDown", "key": if key == "Space" { " " } else { &key }, "code": key, "windowsVirtualKeyCode": code, "text": if code == 13 { "\r" } else if code == 32 { " " } else { "" } }),
            json!({ "type": "keyUp", "key": if key == "Space" { " " } else { &key }, "code": key, "windowsVirtualKeyCode": code }),
        ];
        focused_input(page, "Input.dispatchKeyEvent", events, reply);
    }
    fn click_mouse(page: ICoreWebView2, point: &Value, reply: Reply) {
        let (Some(x), Some(y)) = (point.get("x").and_then(Value::as_f64), point.get("y").and_then(Value::as_f64)) else {
            let _ = reply.send(Err("Posição do controle indisponível. Leia a página novamente.".into())); return;
        };
        let events = vec![
            json!({ "type": "mouseMoved", "x": x, "y": y }),
            json!({ "type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1 }),
            json!({ "type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1 }),
        ];
        focused_input(page, "Input.dispatchMouseEvent", events, reply);
    }
    fn execute_script(page: ICoreWebView2, script: String, revision: u64, reading: bool, key: Option<String>, reply: Reply) {
        let epoch = STOP_EPOCH.load(Ordering::SeqCst);
        let response = Rc::new(RefCell::new(Some(reply)));
        let callback_response = response.clone();
        let key_page = page.clone();
        let callback = ExecuteScriptCompletedHandler::create(Box::new(move |status, output| {
            let result = status.map_err(error).and_then(|_| {
                if STOP_EPOCH.load(Ordering::SeqCst) != epoch { return Err("A operação foi cancelada. Confira a página antes de repetir qualquer ação.".into()); }
                if reading && REVISION.with(Cell::get) != revision { return Err("A página mudou. Leia a página novamente.".into()); }
                let value: Value = serde_json::from_str(&output).map_err(error)?;
                if let Some(message) = value.get("error").and_then(Value::as_str) { return Err(message.to_string()); }
                if value.is_null() { return Err("O site ainda não está pronto para interação. Leia a página novamente.".into()); }
                Ok(value)
            });
            if let Some(reply) = callback_response.borrow_mut().take() {
                if reply.is_closed() { return Ok(()); }
                if let Ok(value) = &result { if let Some(point) = value.get("click") { click_mouse(key_page, point, reply); return Ok(()); } }
                if result.is_ok() { if let Some(key) = key { press_key(key_page, key, reply); return Ok(()); } }
                let _ = reply.send(result);
            }
            Ok(())
        }));
        let script = CoTaskMemPWSTR::from(script.as_str());
        if let Err(failure) = unsafe { page.ExecuteScript(*script.as_ref().as_pcwstr(), &callback) } {
            if let Some(reply) = response.borrow_mut().take() { let _ = reply.send(Err(error(failure))); }
        }
    }
    fn hide_tab(id: &str) -> Result<(), String> {
        changed(id);
        let view = BROWSERS.with(|state| state.borrow().get(id).map(|tab| (tab.controller.clone(), tab.host.clone())));
        if let Some((controller, host)) = view {
            unsafe {
                ShowWindow(host.0, SW_HIDE);
                controller.SetIsVisible(false).map_err(error)?;
            }
            update_visibility(id, false);
        }
        if is_active(id) { ACTIVE_TAB.with(|active| active.borrow_mut().take()); }
        Ok(())
    }

    fn dispatch(app: AppHandle, request: BrowserRequest, reply: Reply) {
        let id = request.tab_id.clone()
            .or_else(|| ACTIVE_TAB.with(|active| active.borrow().clone()))
            .unwrap_or_else(|| "legacy".to_owned());
        if request.action == "hide" {
            let _ = reply.send(hide_tab(&id).map(|()| json!({ "ok": true })));
            return;
        }
        if matches!(request.action.as_str(), "close" | "close_tab") {
            let result = hide_tab(&id).and_then(|()| {
                let tab = BROWSERS.with(|state| state.borrow_mut().remove(&id));
                if let Some(tab) = tab { unsafe { tab.controller.Close().map_err(error)?; } }
                Ok(json!({ "ok": true }))
            });
            let _ = reply.send(result);
            return;
        }
        if request.action == "open" {
            let previous = ACTIVE_TAB.with(|active| active.borrow().clone());
            if let Some(previous) = previous.filter(|previous| previous != &id) {
                if let Err(error) = hide_tab(&previous) { let _ = reply.send(Err(error)); return; }
            }
            ACTIVE_TAB.with(|active| *active.borrow_mut() = Some(id.clone()));
            if !BROWSERS.with(|state| state.borrow().contains_key(&id)) { create(app, id, request, reply); return; }
        }
        if !is_active(&id) {
            let _ = reply.send(Err("A aba do navegador mudou ou foi ocultada.".into()));
            return;
        }
        let result = BROWSERS.with(|state| -> Result<(ICoreWebView2Controller, ICoreWebView2, Rc<BrowserHost>, Option<String>, bool), String> {
            let state = state.borrow();
            let browser = state.get(&id).ok_or("Abra o navegador interno primeiro.")?;
            Ok((browser.controller.clone(), browser.page.clone(), browser.host.clone(), browser.token.clone(), browser.visible))
        });
        let (controller, page, host, token, visible) = match result { Ok(result) => result, Err(error) => { let _ = reply.send(Err(error)); return; } };
        if matches!(request.action.as_str(), "read" | "click" | "type" | "select" | "focus" | "scroll" | "press") {
            let result = (|| -> Result<String, String> {
                if !visible { return Err("O painel está oculto. Abra o navegador para continuar.".into()); }
                if matches!(request.action.as_str(), "click" | "type" | "select" | "focus" | "press") {
                    // A JS-focused field is not enough when the main chat WebView
                    // still owns native focus. Keyboard input must reach this controller.
                    unsafe { controller.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC).map_err(error)?; }
                }
                let current = if request.action == "read" { uuid::Uuid::new_v4().to_string() } else {
                    if request.token != token || token.is_none() { return Err("Referência de página vencida. Leia a página novamente.".into()); }
                    token.unwrap()
                };
                if request.text.as_ref().is_some_and(|text| text.len() > 32_000) { return Err("Texto muito longo para o campo do navegador.".into()); }
                if matches!(request.action.as_str(), "type" | "select") && request.text.is_none() { return Err("Informe o texto ou a opção do campo.".into()); }
                if request.x.unwrap_or(0).abs_diff(0) > 10000 || request.y.unwrap_or(0).abs_diff(0) > 10000 { return Err("Rolagem fora do limite permitido.".into()); }
                BROWSERS.with(|state| { if let Some(browser) = state.borrow_mut().get_mut(&id) { browser.token = if request.action == "read" { Some(current.clone()) } else { None }; } });
                let args = json!({ "action": request.action, "token": current, "target": request.target, "text": request.text, "x": request.x, "y": request.y });
                Ok(format!("({})({args})", include_str!("../../resources/browser-page.js")))
            })();
            match result { Ok(script) => execute_script(page, script, REVISION.with(Cell::get), request.action == "read", if request.action == "press" { request.text } else { None }, reply), Err(error) => { let _ = reply.send(Err(error)); } }
            return;
        }
        if matches!(request.action.as_str(), "clear_cache" | "clear_history") {
            changed(&id);
            let response = Rc::new(RefCell::new(Some(reply)));
            let callback_response = response.clone();
            let callback = ClearBrowsingDataCompletedHandler::create(Box::new(move |status| {
                if let Some(reply) = callback_response.borrow_mut().take() {
                    let _ = reply.send(status.map(|_| json!({ "ok": true })).map_err(error));
                }
                Ok(())
            }));
            let result = (|| -> Result<(), String> {
                unsafe {
                    page.cast::<ICoreWebView2_13>().map_err(error)?
                        .Profile().map_err(error)?
                        .cast::<ICoreWebView2Profile2>().map_err(error)?
                        .ClearBrowsingData(if request.action == "clear_cache" {
                            COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE
                        } else {
                            COREWEBVIEW2_BROWSING_DATA_KINDS_BROWSING_HISTORY
                        }, &callback).map_err(error)
                }
            })();
            if let Err(failure) = result {
                if let Some(reply) = response.borrow_mut().take() { let _ = reply.send(Err(failure)); }
            }
            return;
        }
        if request.action == "reload_uncached" {
            changed(&id);
            input_event(page, "Page.reload", Rc::new(vec![json!({"ignoreCache": true})]), 0,
                STOP_EPOCH.load(Ordering::SeqCst), Rc::new(RefCell::new(Some(reply))));
            return;
        }
        if request.action == "find_start" {
            let response = Rc::new(RefCell::new(Some(reply)));
            let result = (|| -> Result<(), String> {
                let term = request.text.as_deref().unwrap_or_default();
                if term.trim().is_empty() || term.chars().count() > 300 || term.chars().any(char::is_control) {
                    return Err("Informe um termo de busca com até 300 caracteres.".into());
                }
                unsafe {
                    let find = page.cast::<ICoreWebView2_28>().map_err(|_| "Atualize o WebView2 para buscar texto na página.")?.Find().map_err(error)?;
                    let environment = page.cast::<ICoreWebView2_2>().map_err(error)?.Environment().map_err(error)?;
                    let options = environment.cast::<ICoreWebView2Environment15>().map_err(error)?.CreateFindOptions().map_err(error)?;
                    let term = CoTaskMemPWSTR::from(term);
                    options.SetFindTerm(*term.as_ref().as_pcwstr()).map_err(error)?;
                    let callback_response = response.clone();
                    let completed_finder = find.clone();
                    let callback = FindStartCompletedHandler::create(Box::new(move |status| {
                        if let Some(reply) = callback_response.borrow_mut().take() {
                            let result = status.map_err(error).and_then(|()| {
                                let mut count = 0;
                                completed_finder.MatchCount(&mut count).map_err(error)?;
                                Ok(json!({ "count": count }))
                            });
                            let _ = reply.send(result);
                        }
                        Ok(())
                    }));
                    find.Start(&options, &callback).map_err(error)
                }
            })();
            if let Err(failure) = result {
                if let Some(reply) = response.borrow_mut().take() { let _ = reply.send(Err(failure)); }
            }
            return;
        }
        let result = (|| -> Result<Value, String> {
            unsafe {
                match request.action.as_str() {
                    "open" | "layout" => {
                        let bounds = rect(request.bounds.as_ref().ok_or("Área do navegador ausente.")?, &app)?;
                        let source = string(|value| page.Source(value));
                        let has_page = visible || (!source.is_empty() && source != "about:blank");
                        layout(&host, &controller, bounds, has_page)?;
                        update_visibility(&id, has_page);
                        if request.action == "open" {
                            let (loading, failure) = loading_state(&id);
                            emit(&app, &id, &page, loading, failure);
                        }
                    },
                    "navigate" => { let url = checked_url(request.url.as_deref().unwrap_or_default())?; changed(&id); controller.SetIsVisible(true).map_err(error)?; ShowWindow(host.0, SW_SHOWNOACTIVATE); update_visibility(&id, true); let url = CoTaskMemPWSTR::from(url.as_str()); page.Navigate(*url.as_ref().as_pcwstr()).map_err(error)?; },
                    "back" => { changed(&id); page.GoBack().map_err(error)?; },
                    "forward" => { changed(&id); page.GoForward().map_err(error)?; },
                    "reload" => { changed(&id); page.Reload().map_err(error)?; },
                    "zoom" => {
                        let percent = request.zoom.filter(|value| (50..=200).contains(value)).ok_or("Zoom fora do intervalo de 50% a 200%.")?;
                        controller.SetZoomFactor(f64::from(percent) / 100.0).map_err(error)?;
                        changed(&id);
                    },
                    "find_next" | "find_prev" | "find_stop" => {
                        let find = page.cast::<ICoreWebView2_28>().map_err(|_| "Atualize o WebView2 para buscar texto na página.")?.Find().map_err(error)?;
                        match request.action.as_str() {
                            "find_next" => find.FindNext(),
                            "find_prev" => find.FindPrevious(),
                            _ => find.Stop(),
                        }.map_err(error)?;
                    },
                    "stop" => { changed(&id); page.Stop().map_err(error)?; emit(&app, &id, &page, false, None); },
                    _ => return Err("Ação de navegador inválida.".into()),
                }
            }
            Ok(json!({ "ok": true }))
        })();
        let _ = reply.send(result);
    }
    pub async fn command(app: AppHandle, request: BrowserRequest) -> Result<Value, String> {
        let interrupts = matches!(request.action.as_str(), "stop" | "hide" | "close");
        let urgent = interrupts || request.action == "close_tab";
        let epoch = if interrupts { STOP_EPOCH.fetch_add(1, Ordering::SeqCst) + 1 } else { STOP_EPOCH.load(Ordering::SeqCst) };
        let _serial = if urgent { None } else { Some(SERIAL.lock().await) };
        if !urgent && STOP_EPOCH.load(Ordering::SeqCst) != epoch { return Err("A operação foi cancelada antes de iniciar.".into()); }
        let (reply, response) = oneshot::channel();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            if !urgent && STOP_EPOCH.load(Ordering::SeqCst) != epoch {
                let _ = reply.send(Err("A operação foi cancelada antes de iniciar.".into()));
            } else {
                dispatch(handle, request, reply);
            }
        }).map_err(error)?;
        tokio::time::timeout(Duration::from_secs(25), response).await.map_err(|_| "O navegador não respondeu a tempo. Tente novamente.")?.map_err(|_| "O navegador foi encerrado.")?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_web_addresses_without_embedded_credentials_or_app_origins_are_allowed() {
        assert_eq!(checked_url("google.com").unwrap(), "https://google.com/");
        assert!(checked_url("https://example.com/path?q=test").is_ok());
        for url in ["file:///C:/secret", "javascript:alert(1)", "data:text/html,hello", "tauri://localhost", "http://ipc.localhost", "https://tauri.localhost", "https://user:pass@example.com", "", "https://example.com\n"] {
            assert!(checked_url(url).is_err(), "{url}");
        }
    }
}

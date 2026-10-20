mod snap;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Response, Emitter, Manager, State, WebviewWindow};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentInfo {
    id: String,
    name: String,
    path: String,
    size: u64,
    identity: String,
    modified: u64,
    owner: String,
    draft_changed: bool,
}
struct Session {
    info: DocumentInfo,
    file: File,
}
#[derive(Clone, Default, Serialize, Deserialize)]
struct Payload {
    documents: Vec<DocumentInfo>,
    reading: HashMap<String, serde_json::Value>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Recent {
    path: String,
    name: String,
    opened: u64,
    identity: String,
}
#[derive(Default)]
struct Store {
    sessions: Mutex<HashMap<String, Session>>,
    initial: Mutex<HashMap<String, Payload>>,
    ready: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    focused: Mutex<String>,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}
fn valid_identity(identity: &str) -> bool {
    identity.len() == 64 && identity.bytes().all(|b| b.is_ascii_hexdigit())
}
fn record_path(app: &tauri::AppHandle, identity: &str, kind: &str) -> Result<PathBuf, String> {
    if !valid_identity(identity) || !["reading", "draft"].contains(&kind) {
        return Err("Invalid local record".into());
    }
    let dir = data_dir(app)?.join("documents");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join(format!("{identity}.{kind}")))
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        use std::io::Write;
        let mut file = File::create(&temp).map_err(err)?;
        file.write_all(bytes).map_err(err)?;
        file.sync_all().map_err(err)?;
        drop(file);
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            };
            let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            if unsafe {
                MoveFileExW(
                    from.as_ptr(),
                    to.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            } == 0
            {
                return Err(err(std::io::Error::last_os_error()));
            }
        }
        #[cfg(not(windows))]
        fs::rename(&temp, path).map_err(err)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
fn recents(app: &tauri::AppHandle) -> Vec<Recent> {
    data_dir(app)
        .ok()
        .and_then(|p| fs::read(p.join("recent.json")).ok())
        .and_then(|s| serde_json::from_slice(&s).ok())
        .unwrap_or_default()
}
fn open_file(app: &tauri::AppHandle, path: &str, owner: &str) -> Result<DocumentInfo, String> {
    let canonical = fs::canonicalize(path).map_err(|e| format!("Could not open {path}: {e}"))?;
    let store = app.state::<Store>();
    let mut sessions = store.sessions.lock().map_err(err)?;
    if let Some(session) = sessions
        .values()
        .find(|s| Path::new(&s.info.path) == canonical)
    {
        let info = session.info.clone();
        if let Some(window) = app.get_webview_window(&info.owner) {
            let _ = window.unminimize();
            let _ = window.set_focus();
            let _ = window.emit("focus-document", &info.id);
        }
        return Ok(info);
    }
    let mut file = File::open(&canonical).map_err(err)?;
    let meta = file.metadata().map_err(err)?;
    if !meta.is_file() {
        return Err("Choose a PDF file, not a folder.".into());
    }
    let mut header = [0u8; 1024];
    let n = file.read(&mut header).map_err(err)?;
    if !header[..n].windows(5).any(|x| x == b"%PDF-") {
        return Err("This file does not contain a valid PDF header.".into());
    }
    let modified = meta
        .modified()
        .map_err(err)?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let path_string = canonical.to_string_lossy().to_string();
    let mut hash = Sha256::new();
    hash.update(path_string.to_lowercase());
    hash.update(meta.len().to_le_bytes());
    hash.update(modified.to_le_bytes());
    hash.update(&header[..n]);
    let identity = format!("{:x}", hash.finalize());
    let mut history = recents(app);
    let draft_changed = history
        .iter()
        .find(|r| r.path == path_string)
        .is_some_and(|r| {
            r.identity != identity
                && record_path(app, &r.identity, "draft").is_ok_and(|p| p.exists())
        });
    let info = DocumentInfo {
        id: uuid::Uuid::new_v4().to_string(),
        name: canonical
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        path: path_string,
        size: meta.len(),
        identity,
        modified,
        owner: owner.into(),
        draft_changed,
    };
    history.retain(|r| r.path != info.path);
    history.insert(
        0,
        Recent {
            path: info.path.clone(),
            name: info.name.clone(),
            opened: now(),
            identity: info.identity.clone(),
        },
    );
    history.truncate(16);
    atomic_write(
        &data_dir(app)?.join("recent.json"),
        &serde_json::to_vec(&history).map_err(err)?,
    )?;
    sessions.insert(
        info.id.clone(),
        Session {
            info: info.clone(),
            file,
        },
    );
    Ok(info)
}
fn owned<'a>(
    sessions: &'a mut HashMap<String, Session>,
    id: &str,
    window: &WebviewWindow,
) -> Result<&'a mut Session, String> {
    sessions
        .get_mut(id)
        .filter(|s| s.info.owner == window.label())
        .ok_or_else(|| "This document is no longer owned by this window.".into())
}
#[tauri::command]
fn open_document(
    app: tauri::AppHandle,
    window: WebviewWindow,
    path: String,
) -> Result<DocumentInfo, String> {
    open_file(&app, &path, window.label())
}
#[tauri::command]
fn read_document(
    store: State<Store>,
    window: WebviewWindow,
    id: String,
    begin: u64,
    end: u64,
) -> Result<Response, String> {
    let mut sessions = store.sessions.lock().map_err(err)?;
    let session = owned(&mut sessions, &id, &window)?;
    let meta = session.file.metadata().map_err(err)?;
    let modified = meta
        .modified()
        .map_err(err)?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    if meta.len() != session.info.size || modified != session.info.modified {
        return Err("The source PDF changed while reading. Reopen it to read the updated file; your local draft is preserved.".into());
    }
    if begin > end || end > session.info.size || end - begin > 16 * 1024 * 1024 {
        return Err("Invalid PDF byte range.".into());
    }
    let mut bytes = vec![0; (end - begin) as usize];
    session.file.seek(SeekFrom::Start(begin)).map_err(err)?;
    session.file.read_exact(&mut bytes).map_err(err)?;
    Ok(Response::new(bytes))
}
#[tauri::command]
fn read_record(
    app: tauri::AppHandle,
    identity: String,
    kind: String,
) -> Result<Option<String>, String> {
    let path = record_path(&app, &identity, &kind)?;
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}
#[tauri::command]
fn write_record(
    app: tauri::AppHandle,
    identity: String,
    kind: String,
    value: String,
) -> Result<(), String> {
    if kind != "reading" || value.len() > 1024 * 1024 {
        return Err("Invalid reading state.".into());
    }
    let _: serde_json::Value = serde_json::from_str(&value).map_err(err)?;
    atomic_write(&record_path(&app, &identity, &kind)?, value.as_bytes())
}
#[tauri::command]
fn read_draft(
    app: tauri::AppHandle,
    window: WebviewWindow,
    store: State<Store>,
    id: String,
) -> Result<Response, String> {
    let mut sessions = store.sessions.lock().map_err(err)?;
    let info = &owned(&mut sessions, &id, &window)?.info;
    let path = record_path(&app, &info.identity, "draft")?;
    match fs::read(path) {
        Ok(bytes) => Ok(Response::new(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Response::new(Vec::<u8>::new())),
        Err(e) => Err(err(e)),
    }
}
#[tauri::command]
fn write_draft(
    app: tauri::AppHandle,
    window: WebviewWindow,
    store: State<Store>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let id = request
        .headers()
        .get("x-limbo-id")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing document session")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected a binary PDF draft".into());
    };
    let mut sessions = store.sessions.lock().map_err(err)?;
    let info = &owned(&mut sessions, id, &window)?.info;
    if !bytes.starts_with(b"%PDF-") {
        return Err("The annotation draft was not a PDF.".into());
    }
    atomic_write(&record_path(&app, &info.identity, "draft")?, &bytes)
}
#[tauri::command]
fn export_document(
    window: WebviewWindow,
    store: State<Store>,
    id: String,
    path: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let mut sessions = store.sessions.lock().map_err(err)?;
    let session = owned(&mut sessions, &id, &window)?;
    let destination = PathBuf::from(&path);
    if !destination.is_absolute() {
        return Err("Choose an absolute export path.".into());
    }
    let comparable = if destination.exists() {
        fs::canonicalize(&destination).map_err(err)?
    } else {
        fs::canonicalize(destination.parent().ok_or("Invalid folder")?)
            .map_err(err)?
            .join(destination.file_name().ok_or("Invalid filename")?)
    };
    if comparable.to_string_lossy().to_lowercase() == session.info.path.to_lowercase() {
        return Err(
            "Choose a different filename. Limbo exports a copy and preserves your original PDF."
                .into(),
        );
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err("Export did not produce a valid PDF.".into());
    }
    atomic_write(&destination, &bytes)
}
#[tauri::command]
fn recent_files(app: tauri::AppHandle) -> Vec<Recent> {
    recents(&app)
}
#[tauri::command]
fn clear_recents(app: tauri::AppHandle) -> Result<(), String> {
    atomic_write(&data_dir(&app)?.join("recent.json"), b"[]")
}
#[tauri::command]
fn initial_documents(store: State<Store>, window: WebviewWindow) -> Payload {
    store
        .initial
        .lock()
        .unwrap()
        .remove(window.label())
        .unwrap_or_default()
}
#[tauri::command]
fn window_ready(store: State<Store>, window: WebviewWindow) {
    *store.focused.lock().unwrap() = window.label().into();
    if let Some(sender) = store.ready.lock().unwrap().remove(window.label()) {
        let _ = sender.send(());
    }
}
#[tauri::command]
fn window_focused(store: State<Store>, window: WebviewWindow) {
    *store.focused.lock().unwrap() = window.label().into();
}
#[tauri::command]
fn close_document(store: State<Store>, window: WebviewWindow, id: String) -> Result<(), String> {
    let mut sessions = store.sessions.lock().map_err(err)?;
    owned(&mut sessions, &id, &window)?;
    sessions.remove(&id);
    Ok(())
}
#[tauri::command]
fn close_window_documents(store: State<Store>, window: WebviewWindow) {
    store
        .sessions
        .lock()
        .unwrap()
        .retain(|_, s| s.info.owner != window.label());
}
#[tauri::command]
async fn transfer_document(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
    reading: serde_json::Value,
) -> Result<(), String> {
    let store = app.state::<Store>();
    let label = format!("reader-{}", uuid::Uuid::new_v4());
    let info = {
        let mut sessions = store.sessions.lock().map_err(err)?;
        let session = owned(&mut sessions, &id, &window)?;
        session.info.owner = label.clone();
        session.info.clone()
    };
    store.initial.lock().unwrap().insert(
        label.clone(),
        Payload {
            documents: vec![info.clone()],
            reading: HashMap::from([(id.clone(), reading)]),
        },
    );
    let (sender, receiver) = tokio::sync::oneshot::channel();
    store.ready.lock().unwrap().insert(label.clone(), sender);
    let destination =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("Limbo")
            .inner_size(1000.0, 760.0)
            .min_inner_size(360.0, 360.0)
            .decorations(false)
            .shadow(false)
            .background_color(tauri::window::Color(0, 0, 0, 255))
            .on_navigation(|url| {
                url.host_str().is_some_and(|host| {
                    ["tauri.localhost", "localhost", "127.0.0.1"].contains(&host)
                })
            })
            .build();
    let outcome = match destination {
        Ok(target) => {
            snap::install(&target);
            match tokio::time::timeout(std::time::Duration::from_secs(25), receiver).await {
                Ok(Ok(())) => return Ok(()),
                _ => {
                    // Roll ownership back before destroying the failed target.
                    // Its Destroyed event must never invalidate the source tab.
                    if let Some(session) = store.sessions.lock().unwrap().get_mut(&id) {
                        session.info.owner = window.label().into();
                    }
                    let _ = target.destroy();
                    "The new window did not become ready. The tab remains here.".to_string()
                }
            }
        }
        Err(e) => err(e),
    };
    if let Some(session) = store.sessions.lock().unwrap().get_mut(&id) {
        session.info.owner = window.label().into();
    }
    store.initial.lock().unwrap().remove(&label);
    store.ready.lock().unwrap().remove(&label);
    Err(outcome)
}
fn receive_paths(app: &tauri::AppHandle, args: Vec<String>, cwd: &str) {
    let store = app.state::<Store>();
    let focused = store.focused.lock().unwrap().clone();
    let label = if app.get_webview_window(&focused).is_some() {
        focused
    } else {
        app.webview_windows()
            .keys()
            .next()
            .cloned()
            .unwrap_or_else(|| "main".into())
    };
    let mut documents = Vec::new();
    for value in args.into_iter().skip(1).filter(|s| !s.starts_with('-')) {
        let path = Path::new(&value);
        let full = if path.is_absolute() {
            path.to_path_buf()
        } else {
            Path::new(cwd).join(path)
        };
        if let Ok(info) = open_file(app, &full.to_string_lossy(), &label) {
            if info.owner == label {
                documents.push(info);
            }
        }
    }
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.set_focus();
        if !documents.is_empty() {
            let _ = window.emit(
                "open-documents",
                Payload {
                    documents,
                    ..Default::default()
                },
            );
        }
    }
}
fn release_window(store: &Store, label: &str) {
    // Dropping the pending sender wakes transfer_document so it can restore
    // ownership when a destination closes before acknowledging its PDF.
    let pending = store.ready.lock().unwrap().remove(label).is_some();
    if !pending {
        store
            .sessions
            .lock()
            .unwrap()
            .retain(|_, session| session.info.owner != label);
    }
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            receive_paths(app, args, &cwd)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Store::default())
        .invoke_handler(tauri::generate_handler![
            open_document,
            read_document,
            read_record,
            write_record,
            read_draft,
            write_draft,
            export_document,
            recent_files,
            clear_recents,
            initial_documents,
            window_ready,
            window_focused,
            close_document,
            close_window_documents,
            transfer_document,
            snap::set_caption_rect
        ])
        .setup(|app| {
            let handle = app.handle();
            let store = app.state::<Store>();
            *store.focused.lock().unwrap() = "main".into();
            let mut documents = Vec::new();
            for path in std::env::args().skip(1).filter(|s| !s.starts_with('-')) {
                if let Ok(info) = open_file(handle, &path, "main") {
                    documents.push(info);
                }
            }
            store.initial.lock().unwrap().insert(
                "main".into(),
                Payload {
                    documents,
                    ..Default::default()
                },
            );
            if let Some(window) = app.get_webview_window("main") {
                snap::install(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let store = window.state::<Store>();
                release_window(&store, window.label());
            }
        })
        .run(tauri::generate_context!())
        .expect("Could not launch Limbo");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn record_identity_rejects_paths() {
        assert!(!valid_identity("../../escape"));
        assert!(!valid_identity(&"z".repeat(64)));
        assert!(valid_identity(&"ab".repeat(32)));
    }
    #[test]
    fn closing_unready_destination_wakes_transfer_without_deleting_source_session() {
        let store = Store::default();
        store.sessions.lock().unwrap().insert(
            "document".into(),
            Session {
                info: DocumentInfo {
                    id: "document".into(),
                    name: "test".into(),
                    path: String::new(),
                    size: 0,
                    identity: "ab".repeat(32),
                    modified: 0,
                    owner: "destination".into(),
                    draft_changed: false,
                },
                file: File::open(Path::new(env!("CARGO_MANIFEST_DIR")).join("../LICENSE")).unwrap(),
            },
        );
        let (sender, mut receiver) = tokio::sync::oneshot::channel();
        store
            .ready
            .lock()
            .unwrap()
            .insert("destination".into(), sender);
        release_window(&store, "destination");
        assert_eq!(
            receiver.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Closed)
        );
        assert!(!store.ready.lock().unwrap().contains_key("destination"));
        assert!(store.sessions.lock().unwrap().contains_key("document"));
        store
            .sessions
            .lock()
            .unwrap()
            .get_mut("document")
            .unwrap()
            .info
            .owner = "source".into();
        release_window(&store, "destination");
        assert!(store.sessions.lock().unwrap().contains_key("document"));
        release_window(&store, "source");
        assert!(store.sessions.lock().unwrap().is_empty());
    }
    #[test]
    fn atomic_replace_preserves_complete_contents() {
        let dir = std::env::temp_dir().join(format!("limbo-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("state");
        atomic_write(&path, b"first").unwrap();
        atomic_write(&path, b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}

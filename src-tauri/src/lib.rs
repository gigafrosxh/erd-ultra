use base64::Engine;
use std::fs;
use std::sync::Mutex;
use tauri::Manager;

/// Dateien, die das Betriebssystem übergeben hat, bevor die Oberfläche bereit war
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_binary_file(path: String, base64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64)
        .map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| format!("{path}: {e}"))
}

/// Datei, die beim Start übergeben wurde: unter Windows/Linux als Argument,
/// unter macOS per Apple-Event (Doppelklick im Finder, „Öffnen mit“)
#[tauri::command]
fn startup_file(pending: tauri::State<PendingFiles>) -> Option<String> {
    take_opened_file(pending).or_else(|| {
        std::env::args()
            .skip(1)
            .find(|a| a.to_lowercase().ends_with(".erdu") && std::path::Path::new(a).exists())
    })
}

/// Zuletzt vom Betriebssystem übergebene Datei abholen (macOS, App läuft bereits)
#[tauri::command]
fn take_opened_file(pending: tauri::State<PendingFiles>) -> Option<String> {
    pending.0.lock().unwrap().pop()
}

/// Release-Seite im Standard-Browser öffnen (nur Links auf das eigene GitHub-Repository)
#[tauri::command]
fn open_release_page(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/gigafrosxh/erd-ultra/") {
        return Err("Nur Links auf die ERD-Ultra-Releases sind erlaubt".into());
    }
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Updates direkt in der App installieren (Desktop)
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            #[cfg(not(desktop))]
            let _ = app;
            Ok(())
        })
        .manage(PendingFiles::default())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            write_binary_file,
            startup_file,
            take_opened_file,
            open_release_page
        ])
        .build(tauri::generate_context!())
        .expect("Fehler beim Starten von ERD-Ultra")
        .run(|app, event| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                for path in urls.iter().filter_map(|u| u.to_file_path().ok()) {
                    let path = path.to_string_lossy().to_string();
                    if !path.to_lowercase().ends_with(".erdu") {
                        continue;
                    }
                    // Merken und die Oberfläche benachrichtigen. Ist sie noch nicht bereit,
                    // holt sie die Datei beim Start über startup_file ab.
                    app.state::<PendingFiles>().0.lock().unwrap().push(path);
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = tauri::Emitter::emit(&w, "file-opened", ());
                        let _ = w.set_focus();
                    }
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            let _ = (app, event);
        });
}

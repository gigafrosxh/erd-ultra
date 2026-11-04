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

/// Prüft vor einem In-App-Update, ob die laufende App überhaupt ersetzt werden kann.
/// Gibt eine verständliche Beschreibung des Problems zurück, sonst None.
#[tauri::command]
fn update_install_problem() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    #[cfg(target_os = "macos")]
    {
        // .../ERD-Ultra.app/Contents/MacOS/erd-ultra -> .../ERD-Ultra.app
        let app = exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app"))?;
        let shown = app.display().to_string();
        if shown.contains("/AppTranslocation/") {
            return Some(
                "macOS startet ERD-Ultra aus einem schreibgeschützten Zwischenordner (App Translocation), \
                 weil die App noch als heruntergeladen markiert ist. So behebst du das einmalig: \
                 ERD-Ultra beenden, im Finder in den Ordner „Programme“ ziehen, im Terminal \
                 „xattr -dr com.apple.quarantine /Applications/ERD-Ultra.app“ ausführen und die App neu starten."
                    .into(),
            );
        }
        if let Some(dir) = app.parent() {
            if let Some(msg) = not_writable(dir, &shown) {
                return Some(msg);
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        // AppImage: die Datei selbst wird ersetzt
        if let Some(appimage) = std::env::var_os("APPIMAGE") {
            let path = std::path::PathBuf::from(appimage);
            if let Some(dir) = path.parent() {
                if let Some(msg) = not_writable(dir, &path.display().to_string()) {
                    return Some(msg);
                }
            }
        }
    }
    let _ = exe;
    None
}

/// Schreibtest im Ordner der App. Fehlende Rechte sind kein Problem (dann fragt
/// das System nach dem Passwort), ein schreibgeschütztes Laufwerk schon.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn not_writable(dir: &std::path::Path, shown: &str) -> Option<String> {
    let probe = dir.join(format!(".erd-ultra-update-probe-{}", std::process::id()));
    match fs::File::create(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            None
        }
        Err(e) if e.raw_os_error() == Some(30) => Some(format!(
            "ERD-Ultra läuft von einem schreibgeschützten Ort ({shown}), zum Beispiel direkt aus dem \
             geöffneten Installations-Image. Zieh die App zuerst in den Ordner „Programme“ \
             und starte sie von dort, dann klappt das Update."
        )),
        Err(_) => None,
    }
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
            open_release_page,
            update_install_problem
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

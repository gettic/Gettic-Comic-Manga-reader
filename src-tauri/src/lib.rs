mod commands;
pub mod panels;
mod protocol;
pub mod reader;
mod smoke;

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

use commands::AppState;
use reader::session::Session;

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--smoke-test-child") {
        let dir = args.get(i + 1).map(std::path::PathBuf::from).unwrap_or_default();
        smoke::run_as_child(&dir);
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--smoke-test") {
        let dir = args
            .get(i + 1)
            .filter(|a| !a.starts_with("--"))
            .map(std::path::PathBuf::from);
        smoke::run(dir);
        return;
    }
    let startup = commands::startup_path_from_args(args.iter().skip(1), None);

    let app = tauri::Builder::default()
        // Must be the first plugin: a second launch hands its path to this window and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(p) = commands::startup_path_from_args(argv.iter().skip(1), Some(Path::new(&cwd))) {
                let _ = app.emit("open-path", p);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || responder.respond(protocol::respond(&app, &req)));
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_comic,
            commands::open_comic,
            commands::close_comic,
            commands::set_progress,
            commands::set_comic_view,
            commands::recent_comics,
            commands::get_settings,
            commands::set_settings,
            commands::take_startup_path,
        ])
        .setup(move |app| {
            let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
            let data = reader::store::resolve_data_dir(exe_dir.as_deref(), app.path().app_data_dir().ok())
                .ok_or("no writable data folder")?;
            let session = Arc::new(Session::new(&data, protocol::URL_ROOT));
            start_flush_ticker(Arc::downgrade(&session));
            app.manage(AppState { session, startup_path: Mutex::new(startup) });

            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Gettic's Comic-Manga reader")
                .inner_size(1200.0, 850.0)
                .min_inner_size(480.0, 360.0)
                .center()
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the app");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app.try_state::<AppState>() {
                let _ = state.session.store.flush();
            }
        }
    });
}

/// Writes debounced reading progress about once a second while the app runs.
fn start_flush_ticker(session: std::sync::Weak<Session>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        match session.upgrade() {
            Some(s) => {
                let _ = s.store.flush_if_due();
            }
            None => break,
        }
    });
}

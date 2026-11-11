pub mod panels;
mod smoke;

use tauri::{WebviewUrl, WebviewWindowBuilder};

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

    tauri::Builder::default()
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Gettic's Comic-Manga reader")
                .inner_size(1200.0, 850.0)
                .min_inner_size(480.0, 360.0)
                .center()
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the app");
}

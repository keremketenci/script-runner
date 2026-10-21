mod session;

use session::SessionState;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SessionState::default())
        .invoke_handler(tauri::generate_handler![
            session::start_session,
            session::write_to_session,
            session::resize_session
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Do not leave a running script behind when the app closes
            if let RunEvent::Exit = event {
                app.state::<SessionState>().stop();
            }
        });
}

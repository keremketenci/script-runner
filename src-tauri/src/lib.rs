mod browser;
mod config;
mod history;
mod runner;
mod session;

use session::SessionState;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SessionState::default())
        .invoke_handler(tauri::generate_handler![
            browser::list_dir,
            browser::search,
            browser::read_file,
            browser::files_exist,
            browser::reveal_in_file_manager,
            browser::open_in_file_manager,
            config::get_config,
            config::add_folder,
            config::rename_folder,
            config::change_folder_path,
            config::remove_folder,
            config::set_last_location,
            config::set_alias,
            config::set_run_settings,
            config::create_sequence,
            config::rename_sequence,
            config::delete_sequence,
            config::set_sequence_steps,
            config::add_sequence_step,
            history::get_history,
            history::record_run,
            history::clear_history,
            session::start_session,
            session::write_to_session,
            session::resize_session,
            session::stop_session,
            session::quit_app
        ])
        .on_window_event(|window, event| {
            // Closing the window while a script runs would kill it without warning, so ask
            // the frontend to confirm first; it calls quit_app if the user agrees
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.state::<SessionState>().is_running()
            {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Do not leave a running script behind when the app closes
            if let RunEvent::Exit = event {
                app.state::<SessionState>().stop_before_quit();
            }
        });
}

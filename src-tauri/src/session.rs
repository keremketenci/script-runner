use std::io::{Read, Write};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

// Hard-coded test script for milestone 1; the script registry replaces this later
const TEST_SCRIPT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../examples/ask_name.py");

struct Session {
    // Kept alive so the pseudo-terminal stays open while the script runs; also used for resizing
    master: Box<dyn MasterPty + Send>,
    // Keyboard input typed in the terminal goes here
    writer: Box<dyn Write + Send>,
    // Stops the script; the child itself is owned by the thread waiting for it to exit
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// The currently running script, shared between commands. Only one session for now.
#[derive(Default)]
pub struct SessionState(Mutex<Option<Session>>);

impl SessionState {
    /// Kills the running script, if any. Used before starting a new one and when the app exits.
    pub fn stop(&self) {
        // A poisoned lock only means another thread panicked; the session is still usable
        let mut session = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(mut previous) = session.take() {
            let _ = previous.killer.kill();
        }
    }
}

/// Starts the test script inside a pseudo-terminal, streams its raw output bytes
/// through `on_output` and sends its exit code through `on_exit` once it finishes.
#[tauri::command]
pub fn start_session(
    rows: u16,
    cols: u16,
    on_output: Channel<InvokeResponseBody>,
    on_exit: Channel<u32>,
    state: State<'_, SessionState>,
) -> Result<(), String> {
    state.stop();

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;

    let mut command = CommandBuilder::new("python3");
    command.arg(TEST_SCRIPT);
    command.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    // The child holds its own handle to the terminal. Dropping ours lets the
    // reader below see end-of-file once the script exits.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;

    let killer = child.clone_killer();
    let (output_done_sender, output_done_receiver) = mpsc::channel::<()>();

    // Reading blocks until the script prints something, so it runs on its own thread
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                // 0 bytes or an error means the script has exited and the terminal closed
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    let chunk = InvokeResponseBody::Raw(buffer[..count].to_vec());
                    if on_output.send(chunk).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = output_done_sender.send(());
    });

    // Waiting for the exit also blocks, so it gets a second thread
    thread::spawn(move || {
        let exit_code = match child.wait() {
            Ok(status) => status.exit_code(),
            Err(_) => 1,
        };
        // Let the remaining output reach the terminal before the exit message.
        // On Windows the reader may not see end-of-file while the terminal is
        // still open, so do not wait for it forever.
        let _ = output_done_receiver.recv_timeout(Duration::from_millis(500));
        let _ = on_exit.send(exit_code);
    });

    let mut session = state.0.lock().map_err(|error| error.to_string())?;
    *session = Some(Session {
        master: pair.master,
        writer,
        killer,
    });
    Ok(())
}

/// Sends keyboard input from the terminal to the running script.
#[tauri::command]
pub fn write_to_session(data: String, state: State<'_, SessionState>) -> Result<(), String> {
    let mut session = state.0.lock().map_err(|error| error.to_string())?;
    // No running script (not started yet or already replaced): drop the input
    let Some(session) = session.as_mut() else {
        return Ok(());
    };
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|()| session.writer.flush())
        .map_err(|error| error.to_string())
}

/// Tells the running script that the terminal has a new size, so full-screen
/// programs and line wrapping use the right width.
#[tauri::command]
pub fn resize_session(rows: u16, cols: u16, state: State<'_, SessionState>) -> Result<(), String> {
    let session = state.0.lock().map_err(|error| error.to_string())?;
    let Some(session) = session.as_ref() else {
        return Ok(());
    };
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

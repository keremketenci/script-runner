use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};

use crate::{browser, config, runner};

struct Session {
    // Kept alive so the pseudo-terminal stays open while the script runs; also used for resizing
    master: Box<dyn MasterPty + Send>,
    // Keyboard input typed in the terminal goes here
    writer: Box<dyn Write + Send>,
    // Stops the script; the child itself is owned by the thread waiting for it to exit
    killer: Box<dyn ChildKiller + Send + Sync>,
    // Set by the waiting thread once the script has exited. Arc lets both threads share it.
    exited: Arc<AtomicBool>,
    process_id: Option<u32>,
}

/// How long a stopped script gets to exit on its own before it is killed hard
const STOP_GRACE: Duration = Duration::from_secs(3);
/// Shorter grace period when the whole app quits, so closing does not hang
const QUIT_GRACE: Duration = Duration::from_millis(500);

/// The currently running script, shared between commands. Only one session for now.
#[derive(Default)]
pub struct SessionState(Mutex<Option<Session>>);

impl SessionState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Session>> {
        // A poisoned lock only means another thread panicked; the session is still usable
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// True while a script is started and has not exited yet.
    pub fn is_running(&self) -> bool {
        self.lock()
            .as_ref()
            .is_some_and(|session| !session.exited.load(Ordering::SeqCst))
    }

    /// Asks the running script to stop and kills it hard if it is still running after
    /// `grace`. With `wait` the caller blocks until then (used when quitting the app),
    /// otherwise a background thread keeps watch.
    fn stop_with_grace(&self, grace: Duration, wait: bool) {
        let Some(mut previous) = self.lock().take() else {
            return;
        };
        if previous.exited.load(Ordering::SeqCst) {
            return;
        }
        // On Linux and macOS this sends SIGHUP; on Windows it already ends the process
        let _ = previous.killer.kill();
        let exited = Arc::clone(&previous.exited);
        let process_id = previous.process_id;
        // Dropping the session closes the terminal, which also hangs up everything the
        // script started inside it
        drop(previous);

        if wait {
            kill_if_still_running(&exited, process_id, grace);
        } else {
            thread::spawn(move || kill_if_still_running(&exited, process_id, grace));
        }
    }

    /// Stops the running script, if any. Used by the Stop button and before starting a new one.
    pub fn stop(&self) {
        self.stop_with_grace(STOP_GRACE, false);
    }

    /// Stops the running script before the app quits, without leaving it behind.
    pub fn stop_before_quit(&self) {
        self.stop_with_grace(QUIT_GRACE, true);
    }
}

/// Waits up to `grace` for the script to exit, then kills it and its whole process group.
fn kill_if_still_running(exited: &AtomicBool, process_id: Option<u32>, grace: Duration) {
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        if exited.load(Ordering::SeqCst) {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    if !exited.load(Ordering::SeqCst) {
        force_kill(process_id);
    }
}

#[cfg(unix)]
fn force_kill(process_id: Option<u32>) {
    let Some(process_id) = process_id else {
        return;
    };
    // The script leads its own process group inside the terminal, so a negative id
    // reaches it and every program it started. SIGKILL cannot be caught or ignored.
    // `unsafe` because this calls the C library directly; the arguments are plain numbers.
    unsafe {
        libc::kill(-(process_id as i32), libc::SIGKILL);
    }
}

#[cfg(windows)]
fn force_kill(_process_id: Option<u32>) {
    // Nothing to do: the first kill on Windows (TerminateProcess) cannot be ignored
}

/// The command line as one readable string, for showing it in the terminal.
fn describe(launch: &runner::Launch) -> String {
    std::iter::once(launch.program.as_os_str())
        .chain(launch.args.iter().map(|arg| arg.as_os_str()))
        .map(|part| {
            let part = part.to_string_lossy();
            if part.contains(' ') {
                format!("\"{part}\"")
            } else {
                part.into_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Runs the script at `path` inside a pseudo-terminal, streams its raw output bytes
/// through `on_output` and sends its exit code through `on_exit` once it finishes.
#[tauri::command]
pub fn start_session(
    app: AppHandle,
    path: PathBuf,
    rows: u16,
    cols: u16,
    on_output: Channel<InvokeResponseBody>,
    on_exit: Channel<u32>,
    state: State<'_, SessionState>,
) -> Result<(), String> {
    let config = config::load(&app)?;
    browser::root_of(&config, &path)?;
    let metadata = fs::metadata(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    let settings = config.run_settings.get(&path).cloned().unwrap_or_default();
    let mut launch = runner::plan(
        &path,
        browser::is_executable(&path, &metadata),
        settings.interpreter.as_deref(),
    )?;
    launch.args.extend(
        runner::split_args(&settings.args)?
            .into_iter()
            .map(Into::into),
    );
    // The script's own folder unless the run settings pick another one
    let working_folder = settings
        .working_folder
        .or_else(|| path.parent().map(PathBuf::from));
    if let Some(folder) = &working_folder
        && !folder.is_dir()
    {
        return Err(format!(
            "working folder {} does not exist",
            folder.display()
        ));
    }

    state.stop();

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;

    // First line in the terminal: the exact command, dimmed. Sent before the script starts,
    // so it always comes before the script's own output.
    let header = format!("\x1b[2m$ {}\x1b[0m\r\n", describe(&launch));
    let _ = on_output.send(InvokeResponseBody::Raw(header.into_bytes()));

    let mut command = CommandBuilder::new(&launch.program);
    command.args(&launch.args);
    // Relative paths in the script, like open("data.txt"), are relative to this folder
    if let Some(folder) = &working_folder {
        command.cwd(folder);
    }
    command.env("TERM", "xterm-256color");
    command.env("PATH", runner::search_path());

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
    let process_id = child.process_id();
    let exited = Arc::new(AtomicBool::new(false));
    let exited_for_waiter = Arc::clone(&exited);
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
        exited_for_waiter.store(true, Ordering::SeqCst);
        // Let the remaining output reach the terminal before the exit message.
        // On Windows the reader may not see end-of-file while the terminal is
        // still open, so do not wait for it forever.
        let _ = output_done_receiver.recv_timeout(Duration::from_millis(500));
        let _ = on_exit.send(exit_code);
    });

    *state.lock() = Some(Session {
        master: pair.master,
        writer,
        killer,
        exited,
        process_id,
    });
    Ok(())
}

/// Sends keyboard input from the terminal to the running script.
#[tauri::command]
pub fn write_to_session(data: String, state: State<'_, SessionState>) -> Result<(), String> {
    let mut session = state.lock();
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
    let session = state.lock();
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

/// Stops the running script. Its exit is still reported through the `on_exit` channel.
/// A script that ignores the stop signal is killed hard after a few seconds.
#[tauri::command]
pub fn stop_session(state: State<'_, SessionState>) {
    state.stop();
}

/// Closes the app after the user confirmed it, stopping a running script first.
#[tauri::command]
pub fn quit_app(app: AppHandle, state: State<'_, SessionState>) {
    state.stop_before_quit();
    app.exit(0);
}

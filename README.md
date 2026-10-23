# script-runner

A desktop app for browsing your personal script folders and running scripts from one place.
Scripts run unmodified inside an embedded terminal, so interactive prompts (for example
Python's `input()`), colors and Ctrl+C work as they do in a normal terminal.

Built with Tauri 2 (Rust), React, TypeScript and Vite. Desktop only: Linux, Windows and macOS.
Developed and tested on Linux; Windows and macOS are not tested yet.

## Features

### Script folders

- Add one or more script folders. Each gets a display name that only exists in the app;
  renaming, relocating or forgetting a folder never touches it on disk.
- Browse like a file manager: subfolders, breadcrumb, back button, full path of the current folder.
- Shows only scripts by default (known extensions such as `.py`, `.sh`, `.ps1`, `.js`,
  plus executable files), with a "show all files" toggle.
- Search by name in the current folder and everything below it.
- Read-only viewer for file contents (first 512 KB; binary files are detected).
- Give a script an app-only display name; the real file name is shown next to it.
- Open a file's location, or the current folder, in the system file manager.
- On startup, reopen the last folder or ask which folder to open (Settings).

### Running scripts

- Double-click, Enter, the Run button or the right-click menu runs a script.
- The interpreter is picked from the file extension:

  | Extension | Linux / macOS | Windows |
  |---|---|---|
  | `.py` `.pyw` | `python3`, then `python` | `py`, then `python` |
  | `.sh` `.bash` / `.zsh` / `.fish` | `bash` / `zsh` / `fish` | `bash` |
  | `.ps1` | `pwsh` | `pwsh`, then `powershell` |
  | `.bat` `.cmd` | – | `cmd /C` |
  | `.js` `.mjs` / `.rb` / `.pl` / `.php` / `.lua` | `node` / `ruby` / `perl` / `php` / `lua` | same |
  | anything executable (built programs, scripts with a shebang) | run directly | `.exe` run directly |

- Scripts run in their own folder by default, so relative paths work.
- Per-script run settings: arguments, working folder and interpreter
  (for example the `python` of a virtual environment).
- Status bar with the running script, elapsed time, exit code, Stop and Run again.
  Stop asks the script to end and kills it hard after 3 seconds if it does not.
- One run at a time; starting another asks first. Closing the window while a script runs asks too.
- Run history of the last 50 runs (name, time, duration, result), rerun with one click.
  The output itself is never stored.

### Sequences

- An ordered list of scripts that run one after another in the same terminal.
- The next step starts only when the previous one exited with code 0;
  prompts are answered as usual.
- Steps can be reordered and removed; scripts that were moved or deleted are marked.
- Add scripts with right-click → "Add to sequence".

### Interface

- English and Turkish, light / dark / system theme (the terminal follows it too).
- Resizable sidebar with a compact mode (an icon rail that opens on hover),
  resizable terminal, sensible minimum sizes.

## Safety

- The app only runs local files you picked. It never downloads or runs remote code.
- The app never writes to your script folders: no delete, move, copy, edit or rename.
  Display names, run settings and sequences are stored in the app's own data files.
- The Rust side refuses paths outside the script folders, including `..` tricks and
  symbolic links that point elsewhere.
- Tauri permissions are kept minimal: only `core:default` and the folder/file picker
  (`dialog:allow-open`). Everything else goes through the app's own Rust commands.

## Requirements

- Interpreters are not bundled. Install what your scripts need, for example Python 3,
  PowerShell 7 (`pwsh`, also available on Linux and macOS) or Node.js.
- When the app is started from the desktop instead of a terminal, `PATH` can be shorter.
  The app also looks in `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` and
  `~/.cargo/bin`. For anything else, set the interpreter's full path in the run settings.

## Where data is stored

All files live in the app data folder:

| System | Folder |
|---|---|
| Linux | `~/.local/share/com.keremketenci.scriptrunner/` |
| Windows | `%APPDATA%\com.keremketenci.scriptrunner\` |
| macOS | `~/Library/Application Support/com.keremketenci.scriptrunner/` |

- `config.json`: script folders, display names, run settings, sequences, last location
- `history.json`: the last 50 runs

Appearance settings (theme, language, sizes) are stored in the window's local storage.

## Examples

`examples/` holds small scripts for trying the app:

- `ask_name.py`: prompts with `input()` and exits with the code you choose
- `show_args.py`: prints its interpreter, working folder and arguments (for run settings)
- `slow_counter.py`: counts for a minute (Stop, Ctrl+C, elapsed time)
- `stubborn.sh`: ignores the normal stop signal (the hard kill after Stop)
- `minecraft/ban/`: a three-step sequence for a Minecraft server: `merge_logs.py` merges
  the `logs/` folder into `merged-logs.txt`, `find_failed_logins.py` collects the IPs of
  failed logins, `update_ban_list.py` adds new ones to `ban_list.txt`.
  `remove_duplicate_ips.py` removes repeated IPs from `failed_ips.txt`, for example after
  editing it by hand or appending to it from other sources.
  Real logs are not part of the repository; put your server's `logs/` folder next to the scripts.

## Development

### Setup

- Tauri's system dependencies for your OS: https://v2.tauri.app/start/prerequisites/
  (Linux: WebKitGTK and build tools; Windows: Microsoft C++ Build Tools and WebView2;
  macOS: Xcode Command Line Tools)
- Rust via `rustup`, Node.js with npm
- Linux on Wayland: WebKitGTK may crash without this workaround (fish shell):

```fish
set -Ux WEBKIT_DISABLE_DMABUF_RENDERER 1
```

### Commands

```bash
npm install
npm run tauri dev       # run the app
npm run build           # type-check and build the frontend

cd src-tauri
cargo test              # Rust unit tests
cargo clippy --all-targets
```

### Project layout

- `src-tauri/src/` (Rust)
  - `session.rs`: pseudo-terminal sessions (start, input, resize, stop)
  - `runner.rs`: picks the interpreter, splits arguments, searches `PATH`
  - `browser.rs`: folder listing, search, file viewer, the outside-the-folders check
  - `config.rs`: `config.json` (folders, display names, run settings, sequences)
  - `history.rs`: `history.json`
- `src/` (React)
  - `components/`: UI parts such as `FileBrowser`, `TerminalView`, `SequenceEditor`
  - `lib/`: typed wrappers for the Rust commands, settings
  - `i18n/locales/`: translations (keys must be identical in every language)
  - `shadcn/`: components generated by the shadcn CLI (see `components.json`)

### Notes

- Script output streams through a Tauri channel as raw bytes into xterm.js.
- `npm audit` reports high severity warnings from the shadcn CLI dependency chain.
  They affect development tooling only and are not bundled into the app.
- shadcn/ui is based on Base UI here, so component APIs differ from the Radix versions
  (for example `render={...}` instead of `asChild`, menu labels must sit inside a group).
  Check the generated files in `src/shadcn/ui/` before using a new component.
- `src/shadcn/ui/sheet.tsx` is edited by hand: the close button position includes
  `env(safe-area-inset-*)`. Re-adding the component with `--overwrite` removes this change.

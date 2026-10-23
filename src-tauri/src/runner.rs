use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// One way to run a script: a program plus the arguments that go before the script path.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Candidate {
    program: &'static str,
    leading_args: &'static [&'static str],
}

const fn plain(program: &'static str) -> Candidate {
    Candidate {
        program,
        leading_args: &[],
    }
}

// PowerShell: skip the user profile and the execution policy, since the user picked this
// local file on purpose. -File makes the script path the last argument.
const POWERSHELL_ARGS: &[&str] = &["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"];

/// Interpreters to try for a file extension, in order. The first one found on PATH wins.
/// `None` means the extension has no interpreter and the file must be executable itself.
fn candidates(extension: &str) -> Option<Vec<Candidate>> {
    let python = if cfg!(windows) {
        // `py` is the Python launcher that the python.org installer puts on PATH
        vec![plain("py"), plain("python")]
    } else {
        vec![plain("python3"), plain("python")]
    };
    let powershell = Candidate {
        program: "pwsh",
        leading_args: POWERSHELL_ARGS,
    };
    let list = match extension {
        "py" | "pyw" => python,
        "sh" | "bash" => vec![plain("bash")],
        "zsh" => vec![plain("zsh")],
        "fish" => vec![plain("fish")],
        "ps1" if cfg!(windows) => vec![
            powershell,
            Candidate {
                program: "powershell",
                leading_args: POWERSHELL_ARGS,
            },
        ],
        "ps1" => vec![powershell],
        "bat" | "cmd" if cfg!(windows) => vec![Candidate {
            program: "cmd",
            leading_args: &["/C"],
        }],
        "js" | "mjs" => vec![plain("node")],
        "rb" => vec![plain("ruby")],
        "pl" => vec![plain("perl")],
        "php" => vec![plain("php")],
        "lua" => vec![plain("lua")],
        _ => return None,
    };
    Some(list)
}

/// The exact command that runs a script.
#[derive(Debug, PartialEq)]
pub struct Launch {
    pub program: PathBuf,
    /// Everything after the program, including the script path itself
    pub args: Vec<OsString>,
}

/// Decides how to run `script`. `interpreter` is the user's choice from the run settings
/// (a program name or full path) and replaces the automatic choice. `find` looks a program
/// up on PATH; it is a parameter so tests can pretend which interpreters are installed.
fn plan_with(
    script: &Path,
    is_executable: bool,
    interpreter: Option<&str>,
    find: impl Fn(&str) -> Option<PathBuf>,
) -> Result<Launch, String> {
    let extension = script
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();

    if let Some(name) = interpreter {
        let program = find(name).ok_or_else(|| format!("interpreter {name} was not found"))?;
        // Keep the flags the file type needs, for example -File for PowerShell
        let leading_args = candidates(&extension)
            .and_then(|options| options.first().map(|candidate| candidate.leading_args))
            .unwrap_or_default();
        let mut args: Vec<OsString> = leading_args.iter().map(OsString::from).collect();
        args.push(script.as_os_str().to_owned());
        return Ok(Launch { program, args });
    }

    if let Some(options) = candidates(&extension) {
        for candidate in &options {
            if let Some(program) = find(candidate.program) {
                let mut args: Vec<OsString> =
                    candidate.leading_args.iter().map(OsString::from).collect();
                args.push(script.as_os_str().to_owned());
                return Ok(Launch { program, args });
            }
        }
        let names: Vec<&str> = options.iter().map(|candidate| candidate.program).collect();
        return Err(format!(
            "no interpreter for .{extension} files found on PATH (tried: {}). Is it installed?",
            names.join(", ")
        ));
    }

    // Unknown extension: built programs and scripts with a shebang line run directly
    if is_executable {
        return Ok(Launch {
            program: script.to_path_buf(),
            args: Vec::new(),
        });
    }
    Err(format!(
        "{} cannot be run: no interpreter is known for this file type and it is not executable",
        script.display()
    ))
}

/// Common install folders that are often missing from PATH when the app is started from
/// the desktop instead of a terminal (for example Homebrew on macOS or pipx on Linux).
#[cfg(unix)]
fn extra_folders() -> Vec<PathBuf> {
    let mut folders = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        folders.push(home.join(".local/bin"));
        folders.push(home.join(".cargo/bin"));
    }
    folders
}

#[cfg(windows)]
fn extra_folders() -> Vec<PathBuf> {
    // Windows installers add themselves to PATH, and GUI apps get the full PATH
    Vec::new()
}

/// A change to the environment a script inherits from the app.
#[derive(Debug, PartialEq)]
pub enum EnvChange {
    Set(OsString, OsString),
    Remove(OsString),
}

/// Undoes what an AppImage adds to the environment. The AppImage starter points variables
/// such as PYTHONHOME, PYTHONPATH and LD_LIBRARY_PATH into its own mount folder (`APPDIR`),
/// which breaks the system's programs: python3 then looks for its standard library inside
/// the AppImage. Variables that point into `app_folder` are removed; path lists such as
/// PATH or XDG_DATA_DIRS keep only their entries outside it.
fn undo_app_folder(
    variables: impl Iterator<Item = (OsString, OsString)>,
    app_folder: &Path,
) -> Vec<EnvChange> {
    let mut changes = Vec::new();
    for (name, value) in variables {
        // The AppImage's own markers, and two GTK settings its GTK hook forces for the app
        // (GDK_BACKEND=x11 and a GTK_THEME) that should not leak into programs scripts open
        if ["APPDIR", "APPIMAGE", "ARGV0", "GDK_BACKEND", "GTK_THEME"]
            .iter()
            .any(|marker| name == *marker)
        {
            changes.push(EnvChange::Remove(name));
            continue;
        }
        let parts: Vec<PathBuf> = std::env::split_paths(&value).collect();
        if !parts.iter().any(|part| part.starts_with(app_folder)) {
            continue;
        }
        // Empty parts (from a trailing ":") are dropped too; they would mean "current folder"
        let kept: Vec<PathBuf> = parts
            .into_iter()
            .filter(|part| !part.as_os_str().is_empty() && !part.starts_with(app_folder))
            .collect();
        match std::env::join_paths(&kept) {
            Ok(joined) if !kept.is_empty() => changes.push(EnvChange::Set(name, joined)),
            _ => changes.push(EnvChange::Remove(name)),
        }
    }
    changes
}

/// How the app's own environment has to change before it is handed to a script.
/// Empty unless the app runs from an AppImage.
pub fn script_environment() -> Vec<EnvChange> {
    match std::env::var_os("APPDIR") {
        Some(app_folder) if !app_folder.is_empty() => {
            undo_app_folder(std::env::vars_os(), Path::new(&app_folder))
        }
        _ => Vec::new(),
    }
}

/// The app's PATH as scripts should see it, without AppImage entries.
fn inherited_path() -> Option<OsString> {
    let path = std::env::var_os("PATH")?;
    for change in script_environment() {
        match change {
            EnvChange::Set(name, value) if name == "PATH" => return Some(value),
            EnvChange::Remove(name) if name == "PATH" => return None,
            _ => {}
        }
    }
    Some(path)
}

/// PATH plus the extra folders that exist and are not on it yet. Used to find
/// interpreters and handed to scripts, so tools they call are found the same way.
pub fn search_path() -> OsString {
    let mut folders: Vec<PathBuf> = inherited_path()
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    for folder in extra_folders() {
        if folder.is_dir() && !folders.contains(&folder) {
            folders.push(folder);
        }
    }
    std::env::join_paths(folders).unwrap_or_default()
}

/// Looks a program up on the search path, or checks a full path. Never searches the
/// current folder.
pub fn find_program(name: &str) -> Option<PathBuf> {
    which::which_in_global(name, Some(search_path()))
        .ok()?
        .next()
}

/// Decides how to run `script` using the real PATH.
pub fn plan(
    script: &Path,
    is_executable: bool,
    interpreter: Option<&str>,
) -> Result<Launch, String> {
    plan_with(script, is_executable, interpreter, find_program)
}

/// Splits an argument line into separate arguments, like a shell would for simple cases:
/// spaces separate arguments, and "double" or 'single' quotes keep spaces inside one.
/// Backslashes have no special meaning, so Windows paths such as C:\logs stay intact.
pub fn split_args(line: &str) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut current = String::new();
    // True once the current argument has started, so "" still counts as an (empty) argument
    let mut in_argument = false;
    let mut quote: Option<char> = None;

    for character in line.chars() {
        match quote {
            Some(open) if character == open => quote = None,
            Some(_) => current.push(character),
            None if character == '"' || character == '\'' => {
                quote = Some(character);
                in_argument = true;
            }
            None if character.is_whitespace() => {
                if in_argument {
                    args.push(std::mem::take(&mut current));
                    in_argument = false;
                }
            }
            None => {
                current.push(character);
                in_argument = true;
            }
        }
    }
    if let Some(open) = quote {
        return Err(format!("missing closing {open} in the arguments"));
    }
    if in_argument {
        args.push(current);
    }
    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pretends that only the given programs are installed, each under /usr/bin.
    fn installed(programs: &'static [&'static str]) -> impl Fn(&str) -> Option<PathBuf> {
        move |name| {
            programs
                .contains(&name)
                .then(|| PathBuf::from("/usr/bin").join(name))
        }
    }

    fn args(launch: &Launch) -> Vec<&str> {
        launch
            .args
            .iter()
            .map(|arg| arg.to_str().unwrap())
            .collect()
    }

    #[test]
    fn python_scripts_use_the_first_python_found() {
        let script = Path::new("/scripts/filter_ips.py");
        let preferred = if cfg!(windows) { "py" } else { "python3" };
        let launch =
            plan_with(script, false, None, installed(&["py", "python3", "python"])).unwrap();
        assert_eq!(launch.program, PathBuf::from("/usr/bin").join(preferred));
        assert_eq!(args(&launch), ["/scripts/filter_ips.py"]);

        // Falls back to plain `python` when the preferred name is missing
        let launch = plan_with(script, false, None, installed(&["python"])).unwrap();
        assert_eq!(launch.program, PathBuf::from("/usr/bin/python"));
    }

    #[test]
    fn extension_case_does_not_matter() {
        let launch = plan_with(
            Path::new("/scripts/Backup.SH"),
            false,
            None,
            installed(&["bash"]),
        );
        assert_eq!(launch.unwrap().program, PathBuf::from("/usr/bin/bash"));
    }

    #[test]
    fn powershell_gets_its_flags_before_the_script() {
        let launch = plan_with(
            Path::new("/scripts/clean.ps1"),
            false,
            None,
            installed(&["pwsh"]),
        );
        assert_eq!(
            args(&launch.unwrap()),
            [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                "/scripts/clean.ps1"
            ]
        );
    }

    #[test]
    fn missing_interpreter_names_what_was_tried() {
        let error = plan_with(Path::new("/scripts/a.rb"), false, None, installed(&[])).unwrap_err();
        assert!(error.contains("ruby"), "{error}");
    }

    #[test]
    fn executables_without_a_known_extension_run_directly() {
        let binary = Path::new("/scripts/log_tool");
        let launch = plan_with(binary, true, None, installed(&[])).unwrap();
        assert_eq!(launch.program, binary);
        assert!(launch.args.is_empty());

        assert!(plan_with(Path::new("/scripts/notes.txt"), false, None, installed(&[])).is_err());
    }

    #[test]
    fn a_chosen_interpreter_replaces_the_automatic_one() {
        let venv = "/home/someone/venv/bin/python";
        let find = |name: &str| (name == venv).then(|| PathBuf::from(name));
        let launch = plan_with(Path::new("/scripts/a.py"), false, Some(venv), find).unwrap();
        assert_eq!(launch.program, PathBuf::from(venv));
        assert_eq!(args(&launch), ["/scripts/a.py"]);

        // PowerShell keeps its flags with a custom pwsh
        let find = |name: &str| Some(PathBuf::from(name));
        let launch = plan_with(Path::new("/scripts/b.ps1"), false, Some("/opt/pwsh"), find);
        assert_eq!(args(&launch.unwrap())[3], "-File");

        let missing = plan_with(
            Path::new("/scripts/a.py"),
            false,
            Some("nope"),
            installed(&[]),
        );
        assert!(missing.unwrap_err().contains("nope"));
    }

    #[test]
    fn arguments_split_on_spaces_and_respect_quotes() {
        let line = r#"--input logs  "my file.txt" 'a b' C:\logs\new """#;
        assert_eq!(
            split_args(line).unwrap(),
            ["--input", "logs", "my file.txt", "a b", r"C:\logs\new", ""]
        );
        assert!(split_args("   ").unwrap().is_empty());
        assert!(split_args(r#"say "hello"#).is_err());
    }

    #[test]
    fn appimage_variables_are_removed_or_cleaned() {
        let app_folder = Path::new("/tmp/.mount_scriptAbc");
        let variables = [
            ("PYTHONHOME", "/tmp/.mount_scriptAbc/usr/"),
            ("PYTHONPATH", "/tmp/.mount_scriptAbc/usr/share/pyshared/:"),
            (
                "PATH",
                "/tmp/.mount_scriptAbc/usr/bin:/usr/local/bin:/usr/bin",
            ),
            (
                "XDG_DATA_DIRS",
                "/tmp/.mount_scriptAbc/usr/share:/usr/share",
            ),
            ("APPDIR", "/tmp/.mount_scriptAbc"),
            ("GDK_BACKEND", "x11"),
            ("HOME", "/home/someone"),
            ("LANG", "tr_TR.UTF-8"),
        ]
        .map(|(name, value)| (OsString::from(name), OsString::from(value)));

        let changes = undo_app_folder(variables.into_iter(), app_folder);
        let set = |name: &str, value: &str| EnvChange::Set(name.into(), value.into());
        let remove = |name: &str| EnvChange::Remove(name.into());
        assert_eq!(
            changes,
            [
                remove("PYTHONHOME"),
                remove("PYTHONPATH"),
                set("PATH", "/usr/local/bin:/usr/bin"),
                set("XDG_DATA_DIRS", "/usr/share"),
                remove("APPDIR"),
                remove("GDK_BACKEND"),
            ]
        );
    }

    #[test]
    fn a_known_extension_wins_over_the_executable_bit() {
        // A .py file with chmod +x still goes through Python, not its shebang line
        let launch = plan_with(
            Path::new("/scripts/run.py"),
            true,
            None,
            installed(&["python3", "py"]),
        );
        assert_ne!(launch.unwrap().program, PathBuf::from("/scripts/run.py"));
    }
}

use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::config::{self, Config, ScriptFolder};

/// File extensions shown when "show all files" is off. Executables are shown too (see `is_script`).
const SCRIPT_EXTENSIONS: &[&str] = &[
    "py", "pyw", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "js", "mjs", "ts", "rb", "pl",
    "php", "lua",
];

/// Search stops after this many hits so a very broad query stays fast
const SEARCH_LIMIT: usize = 500;

/// The viewer shows at most this much of a file, so huge logs do not hang the window
const VIEW_LIMIT: u64 = 512 * 1024;

/// Folders hidden when "show all files" is off, besides dot folders such as `.git` or `.venv`
const HIDDEN_FOLDERS: &[&str] = &["__pycache__", "node_modules"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// The real file or folder name on disk
    pub name: String,
    /// App-only display name set by the user, if any
    pub alias: Option<String>,
    pub path: PathBuf,
    pub is_folder: bool,
    pub is_script: bool,
}

impl Entry {
    /// What the list shows: the alias if there is one, otherwise the real name
    fn display_name(&self) -> &str {
        self.alias.as_deref().unwrap_or(&self.name)
    }
}

/// App-only display names keyed by real path, from `Config::aliases`
type Aliases = BTreeMap<PathBuf, String>;

/// One clickable piece of the breadcrumb, from the root folder down to the current folder.
#[derive(Debug, Serialize)]
pub struct Crumb {
    pub name: String,
    pub path: PathBuf,
}

#[derive(Debug, Serialize)]
pub struct Listing {
    pub crumbs: Vec<Crumb>,
    pub entries: Vec<Entry>,
}

/// Finds the script folder that `path` belongs to, refusing anything outside all of them.
/// `..` is rejected outright, and the real (symlink-resolved) location is checked too, so a
/// link inside a script folder cannot lead the browser somewhere else.
pub fn root_of<'config>(
    config: &'config Config,
    path: &Path,
) -> Result<&'config ScriptFolder, String> {
    let outside = || format!("{} is outside the script folders", path.display());
    if path
        .components()
        .any(|component| component == Component::ParentDir)
    {
        return Err(outside());
    }
    let folder = config.folder_containing(path).ok_or_else(outside)?;
    let real_path =
        fs::canonicalize(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let real_root = fs::canonicalize(&folder.path)
        .map_err(|error| format!("{}: {error}", folder.path.display()))?;
    if !real_path.starts_with(&real_root) {
        return Err(outside());
    }
    Ok(folder)
}

/// A known script extension, or a file that is executable itself.
pub(crate) fn is_script(path: &Path, metadata: &fs::Metadata) -> bool {
    let known_extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SCRIPT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
        });
    known_extension || is_executable(path, metadata)
}

#[cfg(unix)]
pub(crate) fn is_executable(_path: &Path, metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    // Any of the owner, group or other execute bits
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(windows)]
pub(crate) fn is_executable(path: &Path, _metadata: &fs::Metadata) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
}

fn is_hidden(name: &str, is_folder: bool) -> bool {
    name.starts_with('.') || (is_folder && HIDDEN_FOLDERS.contains(&name))
}

fn breadcrumb(root: &ScriptFolder, path: &Path) -> Vec<Crumb> {
    let mut crumbs = vec![Crumb {
        name: root.name.clone(),
        path: root.path.clone(),
    }];
    let mut current = root.path.clone();
    if let Ok(relative) = path.strip_prefix(&root.path) {
        for component in relative.components() {
            current.push(component);
            crumbs.push(Crumb {
                name: component.as_os_str().to_string_lossy().into_owned(),
                path: current.clone(),
            });
        }
    }
    crumbs
}

fn list(
    root: &ScriptFolder,
    path: &Path,
    show_all: bool,
    aliases: &Aliases,
) -> Result<Listing, String> {
    let read = fs::read_dir(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let mut entries = Vec::new();
    for item in read.flatten() {
        let entry_path = item.path();
        // fs::metadata follows symlinks; broken links fail here and are skipped
        let Ok(metadata) = fs::metadata(&entry_path) else {
            continue;
        };
        let name = item.file_name().to_string_lossy().into_owned();
        let is_folder = metadata.is_dir();
        let is_script = !is_folder && is_script(&entry_path, &metadata);
        if !show_all && (is_hidden(&name, is_folder) || (!is_folder && !is_script)) {
            continue;
        }
        entries.push(Entry {
            alias: aliases.get(&entry_path).cloned(),
            name,
            path: entry_path,
            is_folder,
            is_script,
        });
    }
    // Folders first, then names without caring about upper/lower case
    entries.sort_by(|first, second| {
        second.is_folder.cmp(&first.is_folder).then_with(|| {
            first
                .display_name()
                .to_lowercase()
                .cmp(&second.display_name().to_lowercase())
        })
    });
    Ok(Listing {
        crumbs: breadcrumb(root, path),
        entries,
    })
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    #[serde(flatten)]
    pub entry: Entry,
    /// Folder of the hit relative to where the search started, empty for direct children
    pub folder: String,
    /// Full path of the folder holding the hit, so the browser can open it
    pub parent: PathBuf,
}

#[derive(Debug, Serialize)]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    /// True when there were more than `SEARCH_LIMIT` hits and the rest were dropped
    pub truncated: bool,
}

/// Walks `start` and every folder below it and collects entries whose real name or alias
/// contains `query`, ignoring upper/lower case. Applies the same filters as the folder listing.
fn search_in(start: &Path, query: &str, show_all: bool, aliases: &Aliases) -> SearchResults {
    let needle = query.to_lowercase();
    let mut hits = Vec::new();
    let mut truncated = false;
    // Folders still to visit. A list instead of recursion, so deep trees cannot overflow the stack.
    let mut pending = vec![start.to_path_buf()];

    'walk: while let Some(folder) = pending.pop() {
        let Ok(read) = fs::read_dir(&folder) else {
            continue;
        };
        for item in read.flatten() {
            let entry_path = item.path();
            let Ok(metadata) = fs::metadata(&entry_path) else {
                continue;
            };
            let name = item.file_name().to_string_lossy().into_owned();
            let is_folder = metadata.is_dir();
            let is_script = !is_folder && is_script(&entry_path, &metadata);
            if !show_all && is_hidden(&name, is_folder) {
                continue;
            }
            // Linked folders are not entered: they could loop forever or lead outside
            let is_link = item
                .file_type()
                .is_ok_and(|file_type| file_type.is_symlink());
            if is_folder && !is_link {
                pending.push(entry_path.clone());
            }
            if !show_all && !is_folder && !is_script {
                continue;
            }
            let alias = aliases.get(&entry_path);
            let matches = name.to_lowercase().contains(&needle)
                || alias.is_some_and(|alias| alias.to_lowercase().contains(&needle));
            if !matches {
                continue;
            }
            if hits.len() == SEARCH_LIMIT {
                truncated = true;
                break 'walk;
            }
            let relative_folder = folder
                .strip_prefix(start)
                .map(|relative| relative.display().to_string())
                .unwrap_or_default();
            hits.push(SearchHit {
                entry: Entry {
                    alias: alias.cloned(),
                    name,
                    path: entry_path,
                    is_folder,
                    is_script,
                },
                folder: relative_folder,
                parent: folder.clone(),
            });
        }
    }

    hits.sort_by(|first, second| {
        first
            .entry
            .display_name()
            .to_lowercase()
            .cmp(&second.entry.display_name().to_lowercase())
            .then_with(|| first.folder.cmp(&second.folder))
    });
    SearchResults { hits, truncated }
}

/// Searches `location` and all of its subfolders.
/// Async so a long walk over a big folder does not freeze the window.
#[tauri::command]
pub async fn search(
    app: AppHandle,
    location: PathBuf,
    query: String,
    show_all: bool,
) -> Result<SearchResults, String> {
    let config = config::load(&app)?;
    // Only checks that the location is inside a script folder; the search starts at the location
    root_of(&config, &location)?;
    // The walk runs on another thread, so it gets its own copy of the names
    let aliases = config.aliases.clone();
    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok(SearchResults {
            hits: Vec::new(),
            truncated: false,
        });
    }
    // Reading folders blocks, so it runs on a thread meant for blocking work
    tauri::async_runtime::spawn_blocking(move || search_in(&location, &query, show_all, &aliases))
        .await
        .map_err(|error| error.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    /// Empty when the file is binary
    pub text: String,
    /// Size of the whole file in bytes
    pub size: u64,
    /// True when only the first `VIEW_LIMIT` bytes are included
    pub truncated: bool,
    /// True when the file looks like a binary (a compiled program, an image, ...)
    pub binary: bool,
}

/// Reads the start of a file for the read-only viewer. Never writes anything.
fn read_preview(path: &Path) -> Result<FileContent, String> {
    let failed = |error: std::io::Error| format!("{}: {error}", path.display());
    let file = fs::File::open(path).map_err(failed)?;
    let metadata = file.metadata().map_err(failed)?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    let size = metadata.len();
    let mut bytes = Vec::new();
    file.take(VIEW_LIMIT)
        .read_to_end(&mut bytes)
        .map_err(failed)?;

    // Text files practically never contain zero bytes; binaries almost always do
    let binary = bytes.contains(&0);
    let text = if binary {
        String::new()
    } else {
        // Invalid UTF-8 (for example an old Windows-1254 file) shows up as � instead of failing
        String::from_utf8_lossy(&bytes).into_owned()
    };
    Ok(FileContent {
        text,
        size,
        truncated: size > VIEW_LIMIT,
        binary,
    })
}

/// Returns the contents of a file inside a script folder for the viewer.
#[tauri::command]
pub async fn read_file(app: AppHandle, path: PathBuf) -> Result<FileContent, String> {
    let config = config::load(&app)?;
    root_of(&config, &path)?;
    tauri::async_runtime::spawn_blocking(move || read_preview(&path))
        .await
        .map_err(|error| error.to_string())?
}

/// Opens the system file manager at the folder holding `path`, with `path` selected.
/// Works for files and folders.
#[tauri::command]
pub fn reveal_in_file_manager(app: AppHandle, path: PathBuf) -> Result<(), String> {
    let config = config::load(&app)?;
    root_of(&config, &path)?;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|error| error.to_string())
}

/// Opens a folder in the system file manager.
#[tauri::command]
pub fn open_in_file_manager(app: AppHandle, path: PathBuf) -> Result<(), String> {
    let config = config::load(&app)?;
    root_of(&config, &path)?;
    // Only folders: "opening" a file would launch it with its default program
    if !path.is_dir() {
        return Err(format!("{} is not a folder", path.display()));
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}

/// For each path, whether it is still an existing file inside the script folders.
/// The sequence editor uses this to mark steps whose script was deleted or moved.
#[tauri::command]
pub fn files_exist(app: AppHandle, paths: Vec<PathBuf>) -> Result<Vec<bool>, String> {
    let config = config::load(&app)?;
    Ok(paths
        .iter()
        .map(|path| root_of(&config, path).is_ok() && path.is_file())
        .collect())
}

/// Lists one folder inside a script folder for the browser.
#[tauri::command]
pub fn list_dir(app: AppHandle, path: PathBuf, show_all: bool) -> Result<Listing, String> {
    let config = config::load(&app)?;
    let root = root_of(&config, &path)?;
    list(root, &path, show_all, &config.aliases)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A script folder with a small tree inside, under the system temp dir.
    fn sample_tree(name: &str) -> (Config, PathBuf) {
        let root = std::env::temp_dir().join(format!("script-runner-browser-{name}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("minecraft")).unwrap();
        fs::create_dir_all(root.join("__pycache__")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("zip_logs.py"), "").unwrap();
        fs::write(root.join("Backup.SH"), "").unwrap();
        fs::write(root.join("notes.txt"), "").unwrap();
        fs::write(root.join("minecraft").join("filter_ips.py"), "").unwrap();

        let config = Config {
            folders: vec![ScriptFolder {
                name: "My scripts".into(),
                path: root.clone(),
            }],
            ..Config::default()
        };
        (config, root)
    }

    fn names(listing: &Listing) -> Vec<&str> {
        listing
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect()
    }

    #[test]
    fn scripts_only_hides_other_files_and_junk_folders() {
        let (config, root) = sample_tree("scripts-only");
        let folder = root_of(&config, &root).unwrap();
        let listing = list(folder, &root, false, &Aliases::new()).unwrap();
        assert_eq!(names(&listing), ["minecraft", "Backup.SH", "zip_logs.py"]);
    }

    #[test]
    fn show_all_lists_everything_folders_first() {
        let (config, root) = sample_tree("show-all");
        let folder = root_of(&config, &root).unwrap();
        let listing = list(folder, &root, true, &Aliases::new()).unwrap();
        assert_eq!(
            names(&listing),
            [
                ".git",
                "__pycache__",
                "minecraft",
                "Backup.SH",
                "notes.txt",
                "zip_logs.py"
            ]
        );
        let notes = listing
            .entries
            .iter()
            .find(|entry| entry.name == "notes.txt")
            .unwrap();
        assert!(!notes.is_script);
    }

    #[test]
    fn breadcrumb_goes_from_root_to_subfolder() {
        let (config, root) = sample_tree("crumbs");
        let subfolder = root.join("minecraft");
        let folder = root_of(&config, &subfolder).unwrap();
        let listing = list(folder, &subfolder, false, &Aliases::new()).unwrap();
        let crumbs: Vec<&str> = listing
            .crumbs
            .iter()
            .map(|crumb| crumb.name.as_str())
            .collect();
        assert_eq!(crumbs, ["My scripts", "minecraft"]);
        assert_eq!(listing.crumbs[1].path, subfolder);
    }

    #[test]
    fn paths_outside_the_script_folders_are_refused() {
        let (config, root) = sample_tree("outside");
        assert!(root_of(&config, &std::env::temp_dir()).is_err());
        assert!(root_of(&config, &root.join("minecraft").join("..").join("..")).is_err());
    }

    fn hit_names(results: &SearchResults) -> Vec<(&str, &str)> {
        results
            .hits
            .iter()
            .map(|hit| (hit.entry.name.as_str(), hit.folder.as_str()))
            .collect()
    }

    #[test]
    fn search_finds_nested_scripts_ignoring_case() {
        let (_, root) = sample_tree("search-nested");
        let results = search_in(&root, "IPS", false, &Aliases::new());
        assert_eq!(hit_names(&results), [("filter_ips.py", "minecraft")]);
        assert!(!results.truncated);
    }

    #[test]
    fn aliases_are_shown_sorted_and_searchable() {
        let (config, root) = sample_tree("aliases");
        let script = root.join("zip_logs.py");
        let aliases = Aliases::from([(script.clone(), "A log zipper".to_string())]);

        let folder = root_of(&config, &root).unwrap();
        let listing = list(folder, &root, false, &aliases).unwrap();
        // Sorted by the alias, so it moves to the top of the files
        assert_eq!(names(&listing), ["minecraft", "zip_logs.py", "Backup.SH"]);
        assert_eq!(listing.entries[1].alias.as_deref(), Some("A log zipper"));

        let results = search_in(&root, "zipper", false, &aliases);
        assert_eq!(hit_names(&results), [("zip_logs.py", "")]);
        // The real name still matches too
        assert_eq!(search_in(&root, "zip_", false, &aliases).hits.len(), 1);
    }

    #[test]
    fn search_stays_inside_the_starting_folder() {
        let (_, root) = sample_tree("search-scope");
        let subfolder = root.join("minecraft");
        let results = search_in(&subfolder, ".py", false, &Aliases::new());
        assert_eq!(hit_names(&results), [("filter_ips.py", "")]);
        assert_eq!(results.hits[0].parent, subfolder);
    }

    #[test]
    fn search_matches_folders_and_respects_show_all() {
        let (_, root) = sample_tree("search-filter");
        fs::write(root.join("__pycache__").join("cached_note.py"), "").unwrap();

        assert_eq!(
            hit_names(&search_in(&root, "n", false, &Aliases::new())),
            [("minecraft", "")]
        );
        assert_eq!(
            hit_names(&search_in(&root, "n", true, &Aliases::new())),
            [
                ("cached_note.py", "__pycache__"),
                ("minecraft", ""),
                ("notes.txt", ""),
            ]
        );
    }

    #[test]
    fn search_stops_at_the_limit() {
        let (_, root) = sample_tree("search-limit");
        let many = root.join("many");
        fs::create_dir_all(&many).unwrap();
        for number in 0..SEARCH_LIMIT + 5 {
            fs::write(many.join(format!("job_{number}.py")), "").unwrap();
        }
        let results = search_in(&root, "job_", false, &Aliases::new());
        assert_eq!(results.hits.len(), SEARCH_LIMIT);
        assert!(results.truncated);
    }

    #[test]
    fn preview_reads_text_files() {
        let (_, root) = sample_tree("preview-text");
        let script = root.join("hello.py");
        fs::write(&script, "print('Merhaba, dünya')\n").unwrap();
        let content = read_preview(&script).unwrap();
        assert_eq!(content.text, "print('Merhaba, dünya')\n");
        assert!(!content.binary && !content.truncated);
    }

    #[test]
    fn preview_marks_binaries_and_cuts_big_files() {
        let (_, root) = sample_tree("preview-binary");
        let program = root.join("program");
        fs::write(&program, [0x7f, b'E', b'L', b'F', 0, 0, 1]).unwrap();
        let content = read_preview(&program).unwrap();
        assert!(content.binary);
        assert!(content.text.is_empty());

        let big = root.join("big.log");
        fs::write(&big, "x".repeat(VIEW_LIMIT as usize + 10)).unwrap();
        let content = read_preview(&big).unwrap();
        assert!(content.truncated);
        assert_eq!(content.text.len(), VIEW_LIMIT as usize);
        assert_eq!(content.size, VIEW_LIMIT + 10);
    }

    #[test]
    fn preview_refuses_folders() {
        let (_, root) = sample_tree("preview-folder");
        assert!(read_preview(&root.join("minecraft")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_leading_outside_are_refused() {
        let (config, root) = sample_tree("symlink");
        let link = root.join("escape");
        std::os::unix::fs::symlink(std::env::temp_dir(), &link).unwrap();
        assert!(root_of(&config, &link).is_err());
    }
}

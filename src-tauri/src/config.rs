use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::runner;

const CONFIG_FILE: &str = "config.json";

/// A root folder the user added to the browser.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScriptFolder {
    /// Display name, defaults to the folder's own name
    pub name: String,
    pub path: PathBuf,
}

/// How one script is run, when the defaults are not enough. Every field is optional.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RunSettings {
    /// Extra arguments exactly as typed; split with `runner::split_args` when running
    pub args: String,
    /// Folder to run in instead of the script's own folder
    pub working_folder: Option<PathBuf>,
    /// Program name or full path instead of the automatic choice, for example a venv's python
    pub interpreter: Option<String>,
}

/// An ordered list of scripts that run one after another in the terminal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sequence {
    /// Stable identifier, so renaming does not break anything that points to the sequence
    pub id: String,
    pub name: String,
    /// Script paths in run order. The same script may appear more than once.
    pub steps: Vec<PathBuf>,
}

/// Everything the app remembers between runs. Stored as `config.json` in the app data dir.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
// camelCase in JSON to match the TypeScript side; missing fields fall back to defaults
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub folders: Vec<ScriptFolder>,
    /// The folder the browser showed last, so it can be reopened on the next launch
    pub last_location: Option<PathBuf>,
    /// App-only display names for script files, keyed by the file's real path.
    /// The files themselves are never renamed.
    pub aliases: BTreeMap<PathBuf, String>,
    /// Per-script run settings, keyed by the script's real path
    pub run_settings: BTreeMap<PathBuf, RunSettings>,
    pub sequences: Vec<Sequence>,
}

impl Config {
    fn find_folder(&self, path: &Path) -> Result<usize, String> {
        self.folders
            .iter()
            .position(|folder| folder.path == path)
            .ok_or_else(|| format!("{} is not in the folder list", path.display()))
    }

    /// The root folder that `path` is inside of, if any.
    pub fn folder_containing(&self, path: &Path) -> Option<&ScriptFolder> {
        self.folders
            .iter()
            .find(|folder| path.starts_with(&folder.path))
    }

    fn add_folder(&mut self, path: PathBuf) -> Result<(), String> {
        check_folder(&path)?;
        if self.folders.iter().any(|folder| folder.path == path) {
            return Err(format!("{} is already in the folder list", path.display()));
        }
        let name = default_name(&path);
        self.folders.push(ScriptFolder { name, path });
        Ok(())
    }

    fn rename_folder(&mut self, path: &Path, name: &str) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("the name cannot be empty".into());
        }
        let index = self.find_folder(path)?;
        self.folders[index].name = name.to_string();
        Ok(())
    }

    fn change_folder_path(&mut self, path: &Path, new_path: PathBuf) -> Result<(), String> {
        check_folder(&new_path)?;
        let index = self.find_folder(path)?;
        if self.folders.iter().any(|folder| folder.path == new_path) {
            return Err(format!(
                "{} is already in the folder list",
                new_path.display()
            ));
        }
        self.forget_location_inside(path);
        // A new location may hold something entirely different, so the name starts over too
        let folder = &mut self.folders[index];
        folder.name = default_name(&new_path);
        folder.path = new_path;
        Ok(())
    }

    fn remove_folder(&mut self, path: &Path) -> Result<(), String> {
        let index = self.find_folder(path)?;
        self.forget_location_inside(path);
        self.folders.remove(index);
        Ok(())
    }

    fn set_last_location(&mut self, location: Option<PathBuf>) -> Result<(), String> {
        if let Some(location) = &location
            && self.folder_containing(location).is_none()
        {
            return Err(format!(
                "{} is outside the script folders",
                location.display()
            ));
        }
        self.last_location = location;
        Ok(())
    }

    fn find_sequence(&mut self, id: &str) -> Result<&mut Sequence, String> {
        self.sequences
            .iter_mut()
            .find(|sequence| sequence.id == id)
            .ok_or_else(|| format!("sequence {id} does not exist"))
    }

    /// Adds an empty sequence and returns its id.
    fn create_sequence(&mut self, name: &str) -> Result<String, String> {
        let name = clean_name(name)?;
        // Time-based ids are unique enough here; the loop covers two clicks in the same instant
        let mut id = format!("{:x}", now_nanos());
        while self.sequences.iter().any(|sequence| sequence.id == id) {
            id.push('x');
        }
        self.sequences.push(Sequence {
            id: id.clone(),
            name,
            steps: Vec::new(),
        });
        Ok(id)
    }

    fn rename_sequence(&mut self, id: &str, name: &str) -> Result<(), String> {
        let name = clean_name(name)?;
        self.find_sequence(id)?.name = name;
        Ok(())
    }

    /// Removes the sequence itself; the scripts in it are not touched.
    fn delete_sequence(&mut self, id: &str) -> Result<(), String> {
        let index = self
            .sequences
            .iter()
            .position(|sequence| sequence.id == id)
            .ok_or_else(|| format!("sequence {id} does not exist"))?;
        self.sequences.remove(index);
        Ok(())
    }

    /// Replaces the steps, for reordering and removing. Steps whose file has gone missing
    /// may stay, so the editor can show them with a warning instead of dropping them silently.
    fn set_sequence_steps(&mut self, id: &str, steps: Vec<PathBuf>) -> Result<(), String> {
        for step in &steps {
            let inside = !step.components().any(|part| part == Component::ParentDir)
                && self.folder_containing(step).is_some();
            if !inside {
                return Err(format!("{} is outside the script folders", step.display()));
            }
        }
        self.find_sequence(id)?.steps = steps;
        Ok(())
    }

    /// Appends one script to the end of a sequence.
    fn add_sequence_step(&mut self, id: &str, path: PathBuf) -> Result<(), String> {
        if self.folder_containing(&path).is_none() {
            return Err(format!("{} is outside the script folders", path.display()));
        }
        let metadata =
            fs::metadata(&path).map_err(|error| format!("{}: {error}", path.display()))?;
        if !metadata.is_file() {
            return Err(format!("{} is not a file", path.display()));
        }
        // Same rule as the browser's scripts-only filter: only things that can be run
        if !crate::browser::is_script(&path, &metadata) {
            return Err(format!("{} is not a script", path.display()));
        }
        self.find_sequence(id)?.steps.push(path);
        Ok(())
    }

    /// Stores how a script should be run, or removes the entry when every field is empty.
    /// `find` checks that the interpreter exists; a parameter so tests can fake it.
    fn set_run_settings(
        &mut self,
        path: PathBuf,
        settings: RunSettings,
        find: impl Fn(&str) -> Option<PathBuf>,
    ) -> Result<(), String> {
        if self.folder_containing(&path).is_none() {
            return Err(format!("{} is outside the script folders", path.display()));
        }
        if !path.is_file() {
            return Err(format!("{} is not a file", path.display()));
        }

        let settings = RunSettings {
            args: settings.args.trim().to_string(),
            working_folder: settings.working_folder,
            interpreter: settings
                .interpreter
                .map(|interpreter| interpreter.trim().to_string())
                .filter(|interpreter| !interpreter.is_empty()),
        };
        // Check everything now, so a broken setting shows up here and not only when running
        runner::split_args(&settings.args)?;
        if let Some(folder) = &settings.working_folder {
            check_folder(folder)?;
        }
        if let Some(interpreter) = &settings.interpreter
            && find(interpreter).is_none()
        {
            return Err(format!("interpreter {interpreter} was not found"));
        }

        if settings == RunSettings::default() {
            self.run_settings.remove(&path);
        } else {
            self.run_settings.insert(path, settings);
        }
        // Drop settings of files that were deleted or moved outside the app
        self.run_settings.retain(|script, _| script.is_file());
        Ok(())
    }

    /// Gives a file an app-only display name, or removes it when `alias` is empty or `None`.
    fn set_alias(&mut self, path: PathBuf, alias: Option<&str>) -> Result<(), String> {
        if self.folder_containing(&path).is_none() {
            return Err(format!("{} is outside the script folders", path.display()));
        }
        if !path.is_file() {
            return Err(format!("{} is not a file", path.display()));
        }
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        // An empty name, or the file's own name, means "no alias"
        let alias = alias
            .map(str::trim)
            .filter(|alias| !alias.is_empty() && Some(*alias) != file_name.as_deref());
        match alias {
            Some(alias) => {
                self.aliases.insert(path, alias.to_string());
            }
            None => {
                self.aliases.remove(&path);
            }
        }
        // Drop names of files that were deleted or moved outside the app
        self.aliases.retain(|aliased, _| aliased.is_file());
        Ok(())
    }

    /// Clears the last location if it points into the given root folder.
    fn forget_location_inside(&mut self, path: &Path) {
        if self
            .last_location
            .as_ref()
            .is_some_and(|location| location.starts_with(path))
        {
            self.last_location = None;
        }
    }
}

/// Trims a user-typed name and refuses an empty one.
fn clean_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("the name cannot be empty".into());
    }
    Ok(name.to_string())
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default()
}

/// The folder's own name on disk, used as the display name until the user renames it.
fn default_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn check_folder(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || !path.is_dir() {
        return Err(format!("{} is not a folder", path.display()));
    }
    Ok(())
}

/// Reads the config file. A missing file is not an error: it means first launch.
fn load_from(path: &Path) -> Result<Config, String> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|error| format!("{} is not valid: {error}", path.display())),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Config::default()),
        Err(error) => Err(format!("could not read {}: {error}", path.display())),
    }
}

/// Writes the config file. Writes to a temporary file first and then renames it,
/// so a crash halfway through never leaves a half-written config behind.
fn save_to(path: &Path, config: &Config) -> Result<(), String> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, text).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(folder.join(CONFIG_FILE))
}

pub fn load(app: &AppHandle) -> Result<Config, String> {
    load_from(&config_path(app)?)
}

/// Loads the config, applies `change`, saves it and returns the result to the frontend.
fn update(
    app: &AppHandle,
    change: impl FnOnce(&mut Config) -> Result<(), String>,
) -> Result<Config, String> {
    let path = config_path(app)?;
    let mut config = load_from(&path)?;
    change(&mut config)?;
    save_to(&path, &config)?;
    Ok(config)
}

#[tauri::command]
pub fn get_config(app: AppHandle) -> Result<Config, String> {
    let mut config = load(&app)?;
    // The last folder may have been deleted or renamed outside the app since the last run
    if config
        .last_location
        .as_ref()
        .is_some_and(|location| !location.is_dir())
    {
        config.last_location = None;
    }
    Ok(config)
}

#[tauri::command]
pub fn add_folder(app: AppHandle, path: PathBuf) -> Result<Config, String> {
    update(&app, |config| config.add_folder(path))
}

#[tauri::command]
pub fn rename_folder(app: AppHandle, path: PathBuf, name: String) -> Result<Config, String> {
    update(&app, |config| config.rename_folder(&path, &name))
}

#[tauri::command]
pub fn change_folder_path(
    app: AppHandle,
    path: PathBuf,
    new_path: PathBuf,
) -> Result<Config, String> {
    update(&app, |config| config.change_folder_path(&path, new_path))
}

#[tauri::command]
pub fn remove_folder(app: AppHandle, path: PathBuf) -> Result<Config, String> {
    update(&app, |config| config.remove_folder(&path))
}

/// Sets or removes the app-only display name of a script file. Never touches the file.
#[tauri::command]
pub fn set_alias(app: AppHandle, path: PathBuf, alias: Option<String>) -> Result<Config, String> {
    // Same outside-the-folders check as the browser, including symlinks
    let config = load(&app)?;
    crate::browser::root_of(&config, &path)?;
    update(&app, |config| config.set_alias(path, alias.as_deref()))
}

#[tauri::command]
pub fn create_sequence(app: AppHandle, name: String) -> Result<Config, String> {
    update(&app, |config| config.create_sequence(&name).map(|_| ()))
}

#[tauri::command]
pub fn rename_sequence(app: AppHandle, id: String, name: String) -> Result<Config, String> {
    update(&app, |config| config.rename_sequence(&id, &name))
}

#[tauri::command]
pub fn delete_sequence(app: AppHandle, id: String) -> Result<Config, String> {
    update(&app, |config| config.delete_sequence(&id))
}

#[tauri::command]
pub fn set_sequence_steps(
    app: AppHandle,
    id: String,
    steps: Vec<PathBuf>,
) -> Result<Config, String> {
    update(&app, |config| config.set_sequence_steps(&id, steps))
}

#[tauri::command]
pub fn add_sequence_step(app: AppHandle, id: String, path: PathBuf) -> Result<Config, String> {
    // Same outside-the-folders check as the browser, including symlinks
    let config = load(&app)?;
    crate::browser::root_of(&config, &path)?;
    update(&app, |config| config.add_sequence_step(&id, path))
}

/// Saves how a script is run (arguments, working folder, interpreter).
#[tauri::command]
pub fn set_run_settings(
    app: AppHandle,
    path: PathBuf,
    settings: RunSettings,
) -> Result<Config, String> {
    let config = load(&app)?;
    crate::browser::root_of(&config, &path)?;
    update(&app, |config| {
        config.set_run_settings(path, settings, runner::find_program)
    })
}

#[tauri::command]
pub fn set_last_location(app: AppHandle, location: Option<PathBuf>) -> Result<Config, String> {
    update(&app, |config| config.set_last_location(location))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder under the system temp dir for one test.
    fn test_folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("script-runner-test-{name}"));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    #[test]
    fn missing_file_gives_default_config() {
        let folder = test_folder("missing");
        assert_eq!(load_from(&folder.join(CONFIG_FILE)), Ok(Config::default()));
    }

    #[test]
    fn saved_config_loads_back() {
        let folder = test_folder("roundtrip");
        let mut config = Config::default();
        config.add_folder(folder.clone()).unwrap();
        config.set_last_location(Some(folder.clone())).unwrap();

        let path = folder.join(CONFIG_FILE);
        save_to(&path, &config).unwrap();
        assert_eq!(load_from(&path), Ok(config));
    }

    #[test]
    fn invalid_json_is_an_error() {
        let path = test_folder("invalid").join(CONFIG_FILE);
        fs::write(&path, "{ not json").unwrap();
        assert!(load_from(&path).is_err());
    }

    #[test]
    fn folder_gets_its_own_name_and_no_duplicates() {
        let folder = test_folder("add");
        let mut config = Config::default();
        config.add_folder(folder.clone()).unwrap();
        assert_eq!(config.folders[0].name, "script-runner-test-add");
        assert!(config.add_folder(folder).is_err());
    }

    #[test]
    fn missing_folder_cannot_be_added() {
        let mut config = Config::default();
        let missing = test_folder("gone").join("does-not-exist");
        assert!(config.add_folder(missing).is_err());
    }

    #[test]
    fn empty_name_is_rejected() {
        let folder = test_folder("rename");
        let mut config = Config::default();
        config.add_folder(folder.clone()).unwrap();
        assert!(config.rename_folder(&folder, "   ").is_err());
        config.rename_folder(&folder, " Minecraft ").unwrap();
        assert_eq!(config.folders[0].name, "Minecraft");
    }

    #[test]
    fn changing_the_path_takes_the_new_folder_name() {
        let first = test_folder("path-first");
        let second = test_folder("path-second");

        let mut config = Config::default();
        config.add_folder(first.clone()).unwrap();
        config.rename_folder(&first, "Minecraft").unwrap();
        config.change_folder_path(&first, second).unwrap();
        assert_eq!(config.folders[0].name, "script-runner-test-path-second");
    }

    #[test]
    fn removing_a_folder_forgets_the_last_location_inside_it() {
        let folder = test_folder("remove");
        let subfolder = folder.join("logs");
        fs::create_dir_all(&subfolder).unwrap();

        let mut config = Config::default();
        config.add_folder(folder.clone()).unwrap();
        config.set_last_location(Some(subfolder)).unwrap();
        config.remove_folder(&folder).unwrap();

        assert!(config.folders.is_empty());
        assert_eq!(config.last_location, None);
    }

    #[test]
    fn aliases_are_set_cleared_and_survive_saving() {
        let folder = test_folder("alias");
        let script = folder.join("filter_ips.py");
        fs::write(&script, "").unwrap();

        let mut config = Config::default();
        config.add_folder(folder.clone()).unwrap();
        config
            .set_alias(script.clone(), Some("  IP filter "))
            .unwrap();
        assert_eq!(
            config.aliases.get(&script).map(String::as_str),
            Some("IP filter")
        );

        let path = folder.join(CONFIG_FILE);
        save_to(&path, &config).unwrap();
        assert_eq!(load_from(&path), Ok(config.clone()));

        config.set_alias(script.clone(), Some("   ")).unwrap();
        assert!(config.aliases.is_empty());

        // Typing the real file name back also removes the alias
        config.set_alias(script.clone(), Some("IP filter")).unwrap();
        config
            .set_alias(script.clone(), Some("filter_ips.py"))
            .unwrap();
        assert!(config.aliases.is_empty());
    }

    #[test]
    fn aliases_need_an_existing_file_inside_a_folder() {
        let folder = test_folder("alias-checks");
        let mut config = Config::default();
        config.add_folder(folder.clone()).unwrap();
        assert!(
            config
                .set_alias(folder.join("missing.py"), Some("x"))
                .is_err()
        );
        assert!(config.set_alias(folder.clone(), Some("x")).is_err());
        assert!(
            config
                .set_alias(std::env::temp_dir().join("a.py"), Some("x"))
                .is_err()
        );
    }

    #[test]
    fn aliases_of_deleted_files_are_dropped() {
        let folder = test_folder("alias-prune");
        let kept = folder.join("kept.py");
        let deleted = folder.join("deleted.py");
        fs::write(&kept, "").unwrap();
        fs::write(&deleted, "").unwrap();

        let mut config = Config::default();
        config.add_folder(folder).unwrap();
        config.set_alias(deleted.clone(), Some("Old")).unwrap();
        fs::remove_file(&deleted).unwrap();
        config.set_alias(kept.clone(), Some("New")).unwrap();
        assert_eq!(config.aliases.keys().collect::<Vec<_>>(), [&kept]);
    }

    #[test]
    fn sequences_are_created_renamed_and_deleted() {
        let mut config = Config::default();
        let first = config.create_sequence(" Minecraft cleanup ").unwrap();
        let second = config.create_sequence("Backups").unwrap();
        assert_ne!(first, second);
        assert_eq!(config.sequences[0].name, "Minecraft cleanup");
        assert!(config.create_sequence("   ").is_err());

        config.rename_sequence(&second, "Nightly backups").unwrap();
        assert_eq!(config.sequences[1].name, "Nightly backups");

        config.delete_sequence(&first).unwrap();
        assert_eq!(config.sequences.len(), 1);
        assert!(config.delete_sequence(&first).is_err());
    }

    #[test]
    fn sequence_steps_are_added_reordered_and_checked() {
        let folder = test_folder("sequence-steps");
        let unzip = folder.join("unzip.py");
        let filter = folder.join("filter.py");
        fs::write(&unzip, "").unwrap();
        fs::write(&filter, "").unwrap();

        let mut config = Config::default();
        config.add_folder(folder.clone()).unwrap();
        let id = config.create_sequence("Logs").unwrap();
        config.add_sequence_step(&id, unzip.clone()).unwrap();
        config.add_sequence_step(&id, filter.clone()).unwrap();
        // The same script twice is allowed
        config.add_sequence_step(&id, unzip.clone()).unwrap();
        assert_eq!(
            config.sequences[0].steps,
            [unzip.clone(), filter.clone(), unzip.clone()]
        );

        config
            .set_sequence_steps(&id, vec![filter.clone(), unzip.clone()])
            .unwrap();
        assert_eq!(config.sequences[0].steps, [filter.clone(), unzip.clone()]);

        // Only scripts can be added, not data files such as notes or logs
        let notes = folder.join("notes.txt");
        fs::write(&notes, "").unwrap();
        assert!(config.add_sequence_step(&id, notes).is_err());

        // A missing file may stay in the list, but cannot be newly added
        let gone = folder.join("gone.py");
        config.set_sequence_steps(&id, vec![gone.clone()]).unwrap();
        assert!(config.add_sequence_step(&id, gone).is_err());

        // Nothing outside the script folders, and no ".." tricks
        let outside = std::env::temp_dir().join("elsewhere.py");
        assert!(config.set_sequence_steps(&id, vec![outside]).is_err());
        let sneaky = folder.join("..").join("elsewhere.py");
        assert!(config.set_sequence_steps(&id, vec![sneaky]).is_err());
    }

    #[test]
    fn sequences_survive_saving() {
        let folder = test_folder("sequence-save");
        let mut config = Config::default();
        config.add_folder(folder.clone()).unwrap();
        config.create_sequence("Logs").unwrap();
        let path = folder.join(CONFIG_FILE);
        save_to(&path, &config).unwrap();
        assert_eq!(load_from(&path), Ok(config));
    }

    /// Pretends every program name exists, except "missing"
    fn any_program(name: &str) -> Option<PathBuf> {
        (name != "missing").then(|| PathBuf::from(name))
    }

    #[test]
    fn run_settings_are_cleaned_up_and_saved() {
        let folder = test_folder("run-settings");
        let script = folder.join("filter.py");
        fs::write(&script, "").unwrap();
        let mut config = Config::default();
        config.add_folder(folder.clone()).unwrap();

        let settings = RunSettings {
            args: "  --verbose \"my logs\" ".into(),
            working_folder: Some(folder.clone()),
            interpreter: Some("  /venv/bin/python ".into()),
        };
        config
            .set_run_settings(script.clone(), settings, any_program)
            .unwrap();
        let saved = &config.run_settings[&script];
        assert_eq!(saved.args, "--verbose \"my logs\"");
        assert_eq!(saved.interpreter.as_deref(), Some("/venv/bin/python"));

        // Empty settings remove the entry
        let empty = RunSettings {
            args: "   ".into(),
            working_folder: None,
            interpreter: Some("".into()),
        };
        config.set_run_settings(script, empty, any_program).unwrap();
        assert!(config.run_settings.is_empty());
    }

    #[test]
    fn run_settings_are_checked_before_saving() {
        let folder = test_folder("run-settings-checks");
        let script = folder.join("filter.py");
        fs::write(&script, "").unwrap();
        let mut config = Config::default();
        config.add_folder(folder.clone()).unwrap();

        let bad_quotes = RunSettings {
            args: "\"unclosed".into(),
            ..RunSettings::default()
        };
        assert!(
            config
                .set_run_settings(script.clone(), bad_quotes, any_program)
                .is_err()
        );

        let bad_folder = RunSettings {
            working_folder: Some(folder.join("does-not-exist")),
            ..RunSettings::default()
        };
        assert!(
            config
                .set_run_settings(script.clone(), bad_folder, any_program)
                .is_err()
        );

        let bad_interpreter = RunSettings {
            interpreter: Some("missing".into()),
            ..RunSettings::default()
        };
        assert!(
            config
                .set_run_settings(script, bad_interpreter, any_program)
                .is_err()
        );
        assert!(config.run_settings.is_empty());
    }

    #[test]
    fn last_location_must_be_inside_a_folder() {
        let folder = test_folder("outside");
        let mut config = Config::default();
        config.add_folder(folder).unwrap();
        assert!(
            config
                .set_last_location(Some(std::env::temp_dir()))
                .is_err()
        );
    }
}

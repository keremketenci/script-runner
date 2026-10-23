use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config::{data_file, load_from, save_to};

const HISTORY_FILE: &str = "history.json";
/// Only the latest runs are kept, so the file stays small
const MAX_ENTRIES: usize = 50;

/// One script of a past run, with the name it had then.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HistoryStep {
    pub path: String,
    pub name: String,
}

/// How a past run ended.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    /// The last step exited by itself (see `code`)
    Finished,
    /// The user pressed Stop
    Stopped,
    /// A script could not start, for example a missing interpreter
    Failed,
}

/// A summary of one past run. The output is deliberately not stored: it can be large
/// and may contain things like passwords.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub name: String,
    pub is_sequence: bool,
    pub steps: Vec<HistoryStep>,
    /// Milliseconds since 1970, as JavaScript's Date.now() gives them
    pub started_at: u64,
    pub ended_at: u64,
    pub outcome: Outcome,
    /// Exit code of the last step that ran, if it exited by itself
    pub code: Option<u32>,
    /// The step (from 1) the run ended on
    pub step_number: u32,
}

/// Newest first, at most `MAX_ENTRIES`.
fn add_entry(history: &mut Vec<HistoryEntry>, entry: HistoryEntry) {
    history.insert(0, entry);
    history.truncate(MAX_ENTRIES);
}

#[tauri::command]
pub fn get_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    load_from(&data_file(&app, HISTORY_FILE)?)
}

/// Adds a finished run and returns the updated history.
#[tauri::command]
pub fn record_run(app: AppHandle, entry: HistoryEntry) -> Result<Vec<HistoryEntry>, String> {
    let path = data_file(&app, HISTORY_FILE)?;
    let mut history: Vec<HistoryEntry> = load_from(&path)?;
    add_entry(&mut history, entry);
    save_to(&path, &history)?;
    Ok(history)
}

#[tauri::command]
pub fn clear_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let history = Vec::new();
    save_to(&data_file(&app, HISTORY_FILE)?, &history)?;
    Ok(history)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str) -> HistoryEntry {
        HistoryEntry {
            name: name.into(),
            is_sequence: false,
            steps: vec![HistoryStep {
                path: format!("/scripts/{name}"),
                name: name.into(),
            }],
            started_at: 1,
            ended_at: 2,
            outcome: Outcome::Finished,
            code: Some(0),
            step_number: 1,
        }
    }

    #[test]
    fn newest_entries_come_first_and_old_ones_are_dropped() {
        let mut history = Vec::new();
        for number in 0..MAX_ENTRIES + 3 {
            add_entry(&mut history, entry(&format!("run{number}.py")));
        }
        assert_eq!(history.len(), MAX_ENTRIES);
        assert_eq!(history[0].name, format!("run{}.py", MAX_ENTRIES + 2));
    }

    #[test]
    fn history_survives_saving() {
        let folder = std::env::temp_dir().join("script-runner-test-history");
        let _ = std::fs::remove_dir_all(&folder);
        let path = folder.join(HISTORY_FILE);
        let mut stopped = entry("slow.py");
        stopped.outcome = Outcome::Stopped;
        stopped.code = None;
        let history = vec![stopped, entry("fast.py")];
        save_to(&path, &history).unwrap();
        assert_eq!(load_from::<Vec<HistoryEntry>>(&path), Ok(history));
    }
}

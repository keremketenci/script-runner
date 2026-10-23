import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

// Mirrors `Config` and `ScriptFolder` in src-tauri/src/config.rs
export interface ScriptFolder {
  name: string;
  path: string;
}

// Mirrors `RunSettings` in src-tauri/src/config.rs
export interface RunSettings {
  args: string;
  workingFolder: string | null;
  interpreter: string | null;
}

// Mirrors `Sequence` in src-tauri/src/config.rs
export interface Sequence {
  id: string;
  name: string;
  /** Script paths in run order */
  steps: string[];
}

export interface Config {
  folders: ScriptFolder[];
  lastLocation: string | null;
  /** App-only display names for script files, keyed by real path */
  aliases: Record<string, string>;
  /** Per-script run settings, keyed by real path */
  runSettings: Record<string, RunSettings>;
  sequences: Sequence[];
}

/** The script folder that contains `path`, matching whole path segments only. */
export function findRoot(folders: ScriptFolder[], path: string) {
  return folders.find(
    (folder) =>
      path === folder.path ||
      path.startsWith(folder.path + "/") ||
      path.startsWith(folder.path + "\\"),
  );
}

export const getConfig = () => invoke<Config>("get_config");

export const addFolder = (path: string) => invoke<Config>("add_folder", { path });

export const renameFolder = (path: string, name: string) =>
  invoke<Config>("rename_folder", { path, name });

export const changeFolderPath = (path: string, newPath: string) =>
  invoke<Config>("change_folder_path", { path, newPath });

export const removeFolder = (path: string) => invoke<Config>("remove_folder", { path });

/** Gives a file an app-only display name; `null` restores the original name. */
export const setAlias = (path: string, alias: string | null) =>
  invoke<Config>("set_alias", { path, alias });

/** Saves how a script is run; all-empty settings remove the entry. */
export const setRunSettings = (path: string, settings: RunSettings) =>
  invoke<Config>("set_run_settings", { path, settings });

export const createSequence = (name: string) => invoke<Config>("create_sequence", { name });

export const renameSequence = (id: string, name: string) =>
  invoke<Config>("rename_sequence", { id, name });

export const deleteSequence = (id: string) => invoke<Config>("delete_sequence", { id });

export const setSequenceSteps = (id: string, steps: string[]) =>
  invoke<Config>("set_sequence_steps", { id, steps });

export const addSequenceStep = (id: string, path: string) =>
  invoke<Config>("add_sequence_step", { id, path });

export const setLastLocation = (location: string | null) =>
  invoke<Config>("set_last_location", { location });

/** Opens the system file picker for one file. Resolves to `null` if the user cancels. */
export async function pickFile(title: string) {
  const selected = await open({ directory: false, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}

/** Opens the system folder picker. Resolves to `null` if the user cancels. */
export async function pickFolder(title: string, defaultPath?: string) {
  const selected = await open({ directory: true, multiple: false, title, defaultPath });
  return typeof selected === "string" ? selected : null;
}

import { invoke } from "@tauri-apps/api/core";

// Mirrors `Entry`, `Crumb` and `Listing` in src-tauri/src/browser.rs
export interface Entry {
  /** The real file or folder name on disk */
  name: string;
  /** App-only display name, if the user gave one */
  alias: string | null;
  path: string;
  isFolder: boolean;
  isScript: boolean;
}

export interface Crumb {
  name: string;
  path: string;
}

export interface Listing {
  crumbs: Crumb[];
  entries: Entry[];
}

export const listDir = (path: string, showAll: boolean) =>
  invoke<Listing>("list_dir", { path, showAll });

// Mirrors `SearchHit` and `SearchResults`; a hit is an entry plus its folder
export interface SearchHit extends Entry {
  /** Folder relative to where the search started, empty for direct children */
  folder: string;
  /** Full path of the folder holding the hit */
  parent: string;
}

export interface SearchResults {
  hits: SearchHit[];
  truncated: boolean;
}

/** Searches `location` and all of its subfolders. */
export const searchFolder = (location: string, query: string, showAll: boolean) =>
  invoke<SearchResults>("search", { location, query, showAll });

// Same as VIEW_LIMIT in src-tauri/src/browser.rs
export const VIEW_LIMIT_BYTES = 512 * 1024;

// Mirrors `FileContent` in src-tauri/src/browser.rs
export interface FileContent {
  /** Empty when the file is binary */
  text: string;
  size: number;
  truncated: boolean;
  binary: boolean;
}

/** For each path, whether it is still an existing file inside the script folders. */
export const filesExist = (paths: string[]) => invoke<boolean[]>("files_exist", { paths });

export const readFile = (path: string) => invoke<FileContent>("read_file", { path });

/** Opens the system file manager at the folder holding `path`, with it selected. */
export const revealInFileManager = (path: string) =>
  invoke<void>("reveal_in_file_manager", { path });

/** Opens a folder in the system file manager. */
export const openInFileManager = (path: string) =>
  invoke<void>("open_in_file_manager", { path });

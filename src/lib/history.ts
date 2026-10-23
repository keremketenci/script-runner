import { invoke } from "@tauri-apps/api/core";

// Mirrors `HistoryEntry` and friends in src-tauri/src/history.rs
export type Outcome = "finished" | "stopped" | "failed";

export interface HistoryStep {
  path: string;
  name: string;
}

export interface HistoryEntry {
  name: string;
  isSequence: boolean;
  steps: HistoryStep[];
  /** Milliseconds since 1970, like Date.now() */
  startedAt: number;
  endedAt: number;
  outcome: Outcome;
  /** Exit code of the last step that ran, if it exited by itself */
  code: number | null;
  /** The step (from 1) the run ended on */
  stepNumber: number;
}

export const getHistory = () => invoke<HistoryEntry[]>("get_history");

export const recordRun = (entry: HistoryEntry) =>
  invoke<HistoryEntry[]>("record_run", { entry });

export const clearHistory = () => invoke<HistoryEntry[]>("clear_history");

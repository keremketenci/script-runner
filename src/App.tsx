import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shadcn/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shadcn/ui/dialog";
import { AppSidebar } from "@/components/AppSidebar";
import { FileBrowser } from "@/components/FileBrowser";
import { ResizeHandle } from "@/components/ResizeHandle";
import { FolderSidebar } from "@/components/FolderSidebar";
import { SequenceEditor } from "@/components/SequenceEditor";
import { SequenceSidebar } from "@/components/SequenceSidebar";
import { SettingsPanel } from "@/components/SettingsPanel";
import { HistoryMenu } from "@/components/HistoryMenu";
import {
  TerminalView,
  type RunRequest,
  type RunResult,
  type RunTarget,
} from "@/components/TerminalView";
import { clearHistory, getHistory, recordRun, type HistoryEntry } from "@/lib/history";
import type { Entry } from "@/lib/browser";
import {
  addSequenceStep,
  findRoot,
  getConfig,
  setLastLocation,
  type Config,
  type Sequence,
} from "@/lib/config";
import { clamp, loadSettings, TERMINAL_SHARE } from "@/lib/settings";
import { useSettings } from "@/settings/SettingsContext";

export default function App() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  // The terminal's share of the main column; follows the pointer while dragging
  const [terminalShare, setTerminalShare] = useState(settings.terminalShare);
  const mainRef = useRef<HTMLElement>(null);
  // The script or sequence the terminal should run; a new id runs it again
  const [run, setRun] = useState<RunRequest | null>(null);
  // Bumped when a script exits, since it may have created or changed files
  const [filesChanged, setFilesChanged] = useState(0);
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  // The folder the browser shows: the active script folder or one of its subfolders
  const [location, setLocation] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  // Recent runs, newest first, from history.json
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    getHistory()
      .then(setHistory)
      .catch((error) => console.error(error));
  }, []);

  // Saves how the run ended; the output itself is never stored
  const finishRun = (result: RunResult) => {
    setRunning(false);
    setFilesChanged((previous) => previous + 1);
    if (!run) return;
    const entry: HistoryEntry = {
      name: run.name,
      isSequence: run.isSequence,
      steps: run.steps,
      ...result,
    };
    recordRun(entry)
      .then(setHistory)
      .catch((error) => console.error(error));
  };
  // Something the user wants to start while another run is still going
  const [pendingRun, setPendingRun] = useState<RunTarget | null>(null);

  const startRun = (target: RunTarget) => {
    setRun({ ...target, id: Date.now() });
    setRunning(true);
  };

  // Only one run at a time: ask before replacing a running one
  const requestRun = (target: RunTarget) => {
    if (running) setPendingRun(target);
    else startRun(target);
  };

  const runScript = (entry: Entry) => {
    const name = entry.alias ?? entry.name;
    requestRun({ name, isSequence: false, steps: [{ path: entry.path, name }] });
  };

  const runSequence = (sequence: Sequence) => {
    const steps = sequence.steps.map((path) => ({
      path,
      name: config?.aliases[path] ?? path.split(/[\\/]/).pop() ?? path,
    }));
    requestRun({ name: sequence.name, isSequence: true, steps });
  };

  // The status bar's "Run again"; the script has already finished, so no question is needed
  const runAgain = () => {
    if (!run) return;
    setRun({ ...run, id: Date.now() });
    setRunning(true);
  };

  const confirmPendingRun = () => {
    // start_session stops the running script before starting the new one
    if (pendingRun) startRun(pendingRun);
    setPendingRun(null);
  };

  // Rust asks before the window closes while a script runs (see on_window_event in lib.rs)
  const [confirmQuit, setConfirmQuit] = useState(false);
  useEffect(() => {
    const unlisten = listen("close-requested", () => setConfirmQuit(true));
    return () => {
      unlisten.then((stopListening) => stopListening());
    };
  }, []);

  // The sequence shown in the main area instead of the browser, if any
  const [activeSequenceId, setActiveSequenceId] = useState<string | null>(null);

  // Picking a script folder in the sidebar opens it at its top level
  const selectFolder = (path: string | null) => {
    setActiveSequenceId(null);
    setActivePath(path);
    setLocation(path);
  };

  useEffect(() => {
    getConfig()
      .then((loaded) => {
        setConfig(loaded);
        // "ask" leaves the browser empty so the folder choice below is shown
        if (loadSettings().startup === "ask") return;
        const last = loaded.lastLocation;
        const root = last ? findRoot(loaded.folders, last) : undefined;
        if (last && root) {
          setActivePath(root.path);
          setLocation(last);
        } else {
          selectFolder(loaded.folders[0]?.path ?? null);
        }
      })
      .catch((error) => setLoadError(String(error)));
  }, []);

  // Remember where the browser is, for the next launch. An empty browser is not saved,
  // so choosing "ask" does not erase the last location.
  useEffect(() => {
    if (!location) return;
    setLastLocation(location).catch((error) => console.error(error));
  }, [location]);

  // Dragging the handle between the browser and the terminal
  const resizeTerminal = (clientY: number) => {
    const main = mainRef.current?.getBoundingClientRect();
    if (!main || main.height === 0) return;
    const share = (main.bottom - clientY) / main.height;
    setTerminalShare(clamp(share, TERMINAL_SHARE.min, TERMINAL_SHARE.max));
  };
  const saveTerminalShare = (share: number) => {
    const clamped = clamp(share, TERMINAL_SHARE.min, TERMINAL_SHARE.max);
    setTerminalShare(clamped);
    updateSettings({ terminalShare: clamped });
  };
  const stepTerminal = (pixels: number) => {
    const height = mainRef.current?.getBoundingClientRect().height ?? 0;
    // Moving the handle down makes the terminal smaller
    if (height > 0) saveTerminalShare(terminalShare - pixels / height);
  };

  const activeFolder = config?.folders.find((folder) => folder.path === activePath);
  const activeSequence = config?.sequences.find((sequence) => sequence.id === activeSequenceId);

  return (
    // Padding keeps content clear of notches, status bars and gesture areas
    // Fixed viewport height so the terminal can fill the remaining space
    <div className="flex h-dvh flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <header className="flex h-14 items-center justify-end gap-2 px-4">
        <SettingsPanel />
      </header>

      <div className="flex min-h-0 flex-1 px-4 pb-4">
        {config && (
          <AppSidebar>
            <FolderSidebar
              config={config}
              // While a sequence is open no folder is highlighted
              activePath={activeSequence ? null : activePath}
              onSelect={selectFolder}
              onConfigChange={setConfig}
            />
            <SequenceSidebar
              config={config}
              activeId={activeSequenceId}
              onSelect={setActiveSequenceId}
              onConfigChange={setConfig}
            />
          </AppSidebar>
        )}

        <main ref={mainRef} className="flex min-w-0 flex-1 flex-col">
          {activeSequence && config ? (
            <SequenceEditor
              sequence={activeSequence}
              config={config}
              onConfigChange={setConfig}
              onRun={() => runSequence(activeSequence)}
            />
          ) : activeFolder && location ? (
            <FileBrowser
              location={location}
              rootName={activeFolder.name}
              onNavigate={setLocation}
              onRun={runScript}
              sequences={config?.sequences ?? []}
              onAddToSequence={async (sequenceId, entry) =>
                setConfig(await addSequenceStep(sequenceId, entry.path))
              }
              refreshSignal={filesChanged}
            />
          ) : (
            <section className="min-h-40 flex-1 overflow-auto rounded-lg border p-4 text-sm">
              {loadError ? (
                <p className="text-destructive">{t("folders.loadFailed", { error: loadError })}</p>
              ) : config && config.folders.length > 0 ? (
                <div className="space-y-2">
                  <p className="font-medium">{t("browser.chooseFolder")}</p>
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
                    {config.folders.map((folder) => (
                      <li key={folder.path}>
                        <Button
                          variant="outline"
                          className="h-auto w-full justify-start py-2"
                          title={folder.path}
                          onClick={() => selectFolder(folder.path)}
                        >
                          <Folder />
                          <span className="truncate">{folder.name}</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-muted-foreground">{t("browser.noFolder")}</p>
              )}
            </section>
          )}

          <ResizeHandle
            between="row"
            label={t("layout.resizeTerminal")}
            onResize={(_clientX, clientY) => resizeTerminal(clientY)}
            onResizeEnd={() => saveTerminalShare(terminalShare)}
            onStep={stepTerminal}
            onReset={() => saveTerminalShare(TERMINAL_SHARE.initial)}
          />

          {/* Min and max heights keep both the browser and the terminal usable at any size */}
          <div
            className="flex max-h-[calc(100%-12rem)] min-h-36 shrink-0 flex-col"
            style={{ height: `${terminalShare * 100}%` }}
          >
            <TerminalView
              run={run}
              onRunAgain={runAgain}
              onFinished={finishRun}
              statusExtra={
                <HistoryMenu
                  history={history}
                  onRun={(entry) =>
                    requestRun({ name: entry.name, isSequence: entry.isSequence, steps: entry.steps })
                  }
                  onClear={() =>
                    clearHistory()
                      .then(setHistory)
                      .catch((error) => console.error(error))
                  }
                />
              }
            />
          </div>
        </main>
      </div>

      <Dialog open={confirmQuit} onOpenChange={setConfirmQuit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("quit.title")}</DialogTitle>
            <DialogDescription>{t("quit.text", { name: run?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmQuit(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => invoke("quit_app").catch((error) => console.error(error))}
            >
              {t("quit.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingRun !== null} onOpenChange={(open) => !open && setPendingRun(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("run.replaceTitle")}</DialogTitle>
            <DialogDescription>
              {t("run.replaceText", {
                running: run?.name ?? "",
                next: pendingRun?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRun(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmPendingRun}>
              {t("run.replaceConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

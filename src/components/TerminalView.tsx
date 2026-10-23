import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Play, RotateCcw, Square } from "lucide-react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { cn } from "cn";
import { Button } from "@/shadcn/ui/button";
import i18n from "@/i18n";
import type { Outcome } from "@/lib/history";

// Background colors match the app's own --background in each theme
const DARK_THEME: ITheme = {
  background: "#0a0a0a",
  foreground: "#fafafa",
  cursor: "#fafafa",
  selectionBackground: "#404040",
};

// xterm's default ANSI colors are made for dark backgrounds; yellow and cyan become
// unreadable on white, so the light theme uses darker versions of every color
const LIGHT_THEME: ITheme = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  cursor: "#0a0a0a",
  selectionBackground: "#d4d4d4",
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#7d4e00",
  blue: "#0550ae",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#633c01",
  brightBlue: "#218bff",
  brightMagenta: "#a475f9",
  brightCyan: "#3192aa",
  brightWhite: "#8c959f",
};

// The app theme is the `dark` class on <html>, which also covers "system"
const currentTheme = () =>
  document.documentElement.classList.contains("dark") ? DARK_THEME : LIGHT_THEME;

/** One script to run, with the name shown for it (alias or file name). */
export interface RunStep {
  path: string;
  name: string;
}

/** What to run: a single script, or a sequence of scripts one after another. */
export interface RunTarget {
  /** The script's or the sequence's display name */
  name: string;
  steps: RunStep[];
  isSequence: boolean;
}

/** A request to run a target. A new `id` starts it again, even for the same target. */
export interface RunRequest extends RunTarget {
  id: number;
}

/** How a run ended, reported to the parent so it can be saved in the history. */
export interface RunResult {
  outcome: Outcome;
  /** Exit code of the last step that ran, if it exited by itself */
  code: number | null;
  /** The step (from 1) the run ended on */
  stepNumber: number;
  startedAt: number;
  endedAt: number;
}

/** Which step of a sequence is meant; numbers start at 1. */
interface StepInfo {
  number: number;
  total: number;
  name: string;
}

interface StatusBase {
  name: string;
  isSequence: boolean;
  step: StepInfo;
}

/** What the status bar shows about the latest run. */
type RunStatus =
  | { kind: "idle" }
  | (StatusBase & { kind: "running"; startedAt: number })
  | (StatusBase & { kind: "finished"; startedAt: number; endedAt: number; code: number })
  | (StatusBase & { kind: "stopped"; startedAt: number; endedAt: number })
  | (StatusBase & { kind: "failed" });

/** "0:07", "12:34" or "1:02:03". */
export function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

interface StatusBarProps {
  status: RunStatus;
  onStop: () => void;
  onRunAgain: () => void;
  /** Extra controls on the right, shown in every state (the history menu) */
  extra?: ReactNode;
}

function StatusBar({ status, onStop, onRunAgain, extra }: StatusBarProps) {
  const { t } = useTranslation();
  // Ticks once a second while a script runs, so the elapsed time stays current
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status.kind !== "running") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status.kind]);

  if (status.kind === "idle") {
    return (
      <div className="flex h-10 items-center gap-2 border-b px-3 text-sm">
        <span className="truncate text-muted-foreground">{t("status.idle")}</span>
        <div className="ml-auto flex shrink-0 gap-1">{extra}</div>
      </div>
    );
  }

  const { step } = status;
  const label =
    status.kind === "running"
      ? status.isSequence
        ? t("status.sequenceStep", { ...step })
        : t("status.running")
      : status.kind === "finished"
        ? !status.isSequence
          ? t("status.finished", { code: status.code })
          : status.code === 0
            ? t("status.sequenceDone", { total: step.total })
            : t("status.sequenceFailed", { number: step.number, code: status.code })
        : status.kind === "stopped"
          ? status.isSequence
            ? t("status.sequenceStopped", { number: step.number })
            : t("status.stopped")
          : status.isSequence
            ? t("status.sequenceStartFailed", { number: step.number })
            : t("status.failed");
  const duration =
    status.kind === "running"
      ? formatDuration(now - status.startedAt)
      : status.kind === "finished" || status.kind === "stopped"
        ? formatDuration(status.endedAt - status.startedAt)
        : null;
  const dotColor =
    status.kind === "running"
      ? "bg-blue-500 animate-pulse"
      : status.kind === "finished" && status.code === 0
        ? "bg-green-500"
        : status.kind === "stopped"
          ? "bg-yellow-500"
          : "bg-red-500";

  return (
    <div className="flex h-10 items-center gap-2 border-b px-3 text-sm">
      <span className={cn("size-2 shrink-0 rounded-full", dotColor)} />
      <span className="shrink-0 font-medium">{status.name}</span>
      <span className="truncate text-muted-foreground">{label}</span>
      {duration && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {duration}
        </span>
      )}
      <div className="ml-auto flex shrink-0 gap-1">
        {extra}
        {status.kind === "running" ? (
          <Button size="sm" variant="outline" onClick={onStop}>
            <Square />
            {t("status.stop")}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onRunAgain}>
            {status.kind === "failed" ? <Play /> : <RotateCcw />}
            {t("status.runAgain")}
          </Button>
        )}
      </div>
    </div>
  );
}

interface TerminalViewProps {
  run: RunRequest | null;
  /** Called once when the run ends, however it ended */
  onFinished: (result: RunResult) => void;
  /** Starts the last script or sequence again */
  onRunAgain: () => void;
  /** Shown in the status bar, see StatusBarProps.extra */
  statusExtra?: ReactNode;
}

export function TerminalView({ run, onFinished, onRunAgain, statusExtra }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [status, setStatus] = useState<RunStatus>({ kind: "idle" });
  // Only output from the latest run is shown; older runs may still send a last chunk
  const currentRunRef = useRef<number | null>(null);
  // True after the script exited, until the terminal is cleared again
  const exitedRef = useRef(false);
  // The run the user asked to stop, so its exit is reported as "stopped"
  const stoppingRef = useRef<number | null>(null);
  // Kept in a ref so a new callback from the parent does not restart the script
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  // Creates the terminal once. Uses i18n directly instead of `t` so a language
  // change does not recreate the terminal and kill the running script.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace",
      fontSize: 14,
      theme: currentTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    const showIdle = () => {
      terminal.reset();
      terminal.writeln(`\x1b[2m${i18n.t("terminal.idle")}\x1b[0m`);
      setStatus({ kind: "idle" });
    };
    showIdle();
    terminalRef.current = terminal;

    // Follow light/dark changes, including the OS switching while "system" is selected
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = currentTheme();
    });
    themeObserver.observe(document.documentElement, { attributeFilter: ["class"] });

    const dataListener = terminal.onData((data) => {
      if (exitedRef.current) {
        // The script is gone: Ctrl+C or Enter clears its output instead of going nowhere
        if (data === "\x03" || data === "\r") {
          exitedRef.current = false;
          showIdle();
        }
        return;
      }
      // While a script runs, keys (including Enter, arrows and Ctrl+C) go to it as-is.
      // The pseudo-terminal echoes them back, so they show up through the output channel.
      invoke("write_to_session", { data }).catch((error) => console.error(error));
    });

    // fit() only fires this when the row or column count actually changes
    const resizeListener = terminal.onResize(({ rows, cols }) => {
      invoke("resize_session", { rows, cols }).catch((error) => console.error(error));
    });

    // Refit whenever the container changes size (window resize, layout changes)
    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(container);

    return () => {
      terminalRef.current = null;
      themeObserver.disconnect();
      dataListener.dispose();
      resizeListener.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, []);

  // Starts the requested script or sequence whenever a new run request comes in
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!run || !terminal) return;

    currentRunRef.current = run.id;
    exitedRef.current = false;
    const isCurrent = () => currentRunRef.current === run.id && terminalRef.current === terminal;
    const stopRequested = () => stoppingRef.current === run.id;
    const startedAt = Date.now();
    const total = run.steps.length;
    const base = { name: run.name, isSequence: run.isSequence };
    terminal.reset();
    terminal.focus();

    const finish = (outcome: Outcome, code: number | null, stepNumber: number) => {
      terminal.writeln(`\x1b[2m${i18n.t("terminal.clearHint")}\x1b[0m`);
      exitedRef.current = true;
      onFinishedRef.current({ outcome, code, stepNumber, startedAt, endedAt: Date.now() });
    };

    // Runs one step; when it exits with code 0 the next one starts in the same terminal
    const startStep = (index: number) => {
      const script = run.steps[index];
      const step = { number: index + 1, total, name: script.name };

      // Stop may have been pressed in the moment between two steps
      if (stopRequested()) {
        terminal.writeln(`\r\n\x1b[33m${i18n.t("terminal.stopped")}\x1b[0m`);
        setStatus({ ...base, step, kind: "stopped", startedAt, endedAt: Date.now() });
        finish("stopped", null, step.number);
        return;
      }

      setStatus({ ...base, step, kind: "running", startedAt });
      if (run.isSequence) {
        if (index > 0) terminal.writeln("");
        terminal.writeln(`\x1b[1;36m── ${i18n.t("terminal.stepHeader", step)} ──\x1b[0m`);
      }

      // Raw output bytes from the pseudo-terminal arrive as ArrayBuffer chunks
      const onOutput = new Channel<ArrayBuffer>();
      onOutput.onmessage = (chunk) => {
        if (isCurrent()) terminal.write(new Uint8Array(chunk));
      };

      const exitChannel = new Channel<number>();
      exitChannel.onmessage = (code) => {
        if (!isCurrent()) return;
        const endedAt = Date.now();
        if (stopRequested()) {
          terminal.writeln(`\r\n\x1b[33m${i18n.t("terminal.stopped")}\x1b[0m`);
          setStatus({ ...base, step, kind: "stopped", startedAt, endedAt });
          finish("stopped", null, step.number);
          return;
        }
        // Green for success, red for failure, then reset the color
        const color = code === 0 ? "\x1b[32m" : "\x1b[31m";
        terminal.writeln(`\r\n${color}${i18n.t("terminal.exited", { code })}\x1b[0m`);

        if (code === 0 && index + 1 < total) {
          startStep(index + 1);
          return;
        }
        if (run.isSequence) {
          const summary =
            code === 0
              ? `\x1b[1;32m${i18n.t("status.sequenceDone", { total })}\x1b[0m`
              : `\x1b[1;31m${i18n.t("status.sequenceFailed", { number: step.number, code })}\x1b[0m`;
          terminal.writeln(summary);
        }
        setStatus({ ...base, step, kind: "finished", startedAt, endedAt, code });
        finish("finished", code, step.number);
      };

      invoke("start_session", {
        path: script.path,
        rows: terminal.rows,
        cols: terminal.cols,
        onOutput,
        onExit: exitChannel,
      }).catch((error) => {
        if (!isCurrent()) return;
        terminal.writeln(`\x1b[31m${i18n.t("terminal.startFailed", { error: String(error) })}\x1b[0m`);
        setStatus({ ...base, step, kind: "failed" });
        finish("failed", null, step.number);
      });
    };

    startStep(0);
  }, [run]);

  const stop = () => {
    stoppingRef.current = currentRunRef.current;
    invoke("stop_session").catch((error) => console.error(error));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
      <StatusBar status={status} onStop={stop} onRunAgain={onRunAgain} extra={statusExtra} />
      {/* Same background as the terminal theme, so the padding blends in */}
      <div className="min-h-0 flex-1 bg-white p-2 dark:bg-[#0a0a0a]">
        <div ref={containerRef} className="size-full" />
      </div>
    </div>
  );
}

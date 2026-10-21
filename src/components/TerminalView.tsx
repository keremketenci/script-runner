import { useEffect, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import i18n from "@/i18n";

export function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);

  // Runs once per mount. Uses i18n directly instead of `t` so a language
  // change does not recreate the terminal and kill the running script.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace",
      fontSize: 14,
      // Fixed dark palette so ANSI colors from scripts stay readable in both app themes
      theme: { background: "#0a0a0a", foreground: "#fafafa" },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();

    // React StrictMode mounts twice in development; ignore output after unmount
    let disposed = false;

    // Raw output bytes from the pseudo-terminal arrive as ArrayBuffer chunks
    const onOutput = new Channel<ArrayBuffer>();
    onOutput.onmessage = (chunk) => {
      if (!disposed) terminal.write(new Uint8Array(chunk));
    };

    const onExit = new Channel<number>();
    onExit.onmessage = (code) => {
      if (disposed) return;
      // Green for success, red for failure, then reset the color
      const color = code === 0 ? "\x1b[32m" : "\x1b[31m";
      terminal.writeln(`\r\n${color}${i18n.t("terminal.exited", { code })}\x1b[0m`);
    };

    invoke("start_session", {
      rows: terminal.rows,
      cols: terminal.cols,
      onOutput,
      onExit,
    }).catch((error) => {
      if (!disposed) {
        terminal.writeln(i18n.t("terminal.startFailed", { error: String(error) }));
      }
    });

    // Keys typed in the terminal (including Enter and arrows) go to the script as-is.
    // The pseudo-terminal echoes them back, so they show up through onOutput.
    const dataListener = terminal.onData((data) => {
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
      disposed = true;
      dataListener.dispose();
      resizeListener.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-[#0a0a0a] p-2">
      <div ref={containerRef} className="size-full" />
    </div>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { History, ListOrdered, Trash2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/shadcn/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shadcn/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shadcn/ui/dropdown-menu";
import { formatDuration } from "@/components/TerminalView";
import type { HistoryEntry } from "@/lib/history";

interface HistoryMenuProps {
  history: HistoryEntry[];
  onRun: (entry: HistoryEntry) => void;
  onClear: () => void;
}

/** "5 minutes ago", "yesterday", ... in the UI language. */
function timeAgo(timestamp: number, language: string) {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(seconds, "second");
}

/** The status bar's list of recent runs; picking one runs it again. */
export function HistoryMenu({ history, onRun, onClear }: HistoryMenuProps) {
  const { t, i18n } = useTranslation();
  // Clearing cannot be undone, so it is confirmed first
  const [confirmingClear, setConfirmingClear] = useState(false);

  const outcomeLabel = (entry: HistoryEntry) => {
    if (entry.outcome === "stopped") return t("history.stopped");
    if (entry.outcome === "failed") return t("history.failed");
    return entry.isSequence && entry.code !== 0
      ? t("history.failedAtStep", { number: entry.stepNumber, code: entry.code })
      : t("history.exitCode", { code: entry.code });
  };

  const dotColor = (entry: HistoryEntry) =>
    entry.outcome === "stopped"
      ? "bg-yellow-500"
      : entry.outcome === "finished" && entry.code === 0
        ? "bg-green-500"
        : "bg-red-500";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="sm" variant="ghost" title={t("history.title")} />}
        >
          <History />
          <span className="hidden sm:inline">{t("history.title")}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-96 w-80">
          {/* Base UI requires a label to sit inside a group, otherwise it throws */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("history.title")}</DropdownMenuLabel>
            {history.length === 0 && (
              <DropdownMenuItem disabled>{t("history.empty")}</DropdownMenuItem>
            )}
            {history.map((entry) => (
              <DropdownMenuItem
                key={`${entry.startedAt}-${entry.name}`}
                onClick={() => onRun(entry)}
                title={t("history.runAgain")}
                className="items-start"
              >
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dotColor(entry))} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    {entry.isSequence && <ListOrdered className="size-3.5" />}
                    <span className="truncate font-medium">{entry.name}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {timeAgo(entry.startedAt, i18n.language)} ·{" "}
                    {formatDuration(entry.endedAt - entry.startedAt)} · {outcomeLabel(entry)}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {history.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmingClear(true)}>
                <Trash2 />
                {t("history.clear")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmingClear} onOpenChange={setConfirmingClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("history.clearTitle")}</DialogTitle>
            <DialogDescription>{t("history.clearText", { count: history.length })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingClear(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onClear();
                setConfirmingClear(false);
              }}
            >
              {t("history.clear")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

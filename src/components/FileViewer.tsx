import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Play, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/shadcn/ui/button";
import { readFile, VIEW_LIMIT_BYTES, type FileContent } from "@/lib/browser";

interface FileViewerProps {
  path: string;
  /** Real file name */
  name: string;
  /** App-only display name, shown instead of the real name when set */
  alias: string | null;
  /** Changes when the file may have changed on disk; the content is read again */
  refreshSignal: number;
  /** Shows the Run button; true for scripts */
  runnable: boolean;
  onRun: () => void;
  onRunSettings: () => void;
  onClose: () => void;
}

/** Human readable size, for example "12.4 KB". */
function formatSize(bytes: number, language: string) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
  return `${number} ${units[unitIndex]}`;
}

/** Read-only view of a file. There is deliberately no way to edit or save here. */
export function FileViewer({
  path,
  name,
  alias,
  refreshSignal,
  runnable,
  onRun,
  onRunSettings,
  onClose,
}: FileViewerProps) {
  const { t, i18n } = useTranslation();
  const [content, setContent] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Ignore a slow answer if another file was selected in the meantime
    // The old content stays until the new one arrives, so refreshing does not flicker
    let current = true;
    readFile(path)
      .then((result) => {
        if (!current) return;
        setContent(result);
        setError(null);
      })
      .catch((readError) => current && setError(String(readError)));
    return () => {
      current = false;
    };
  }, [path, refreshSignal]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t @3xl:border-t-0 @3xl:border-l">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={path}>
            {alias ?? name}
            {alias && (
              <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                {name}
              </span>
            )}
          </p>
          {content && (
            <p className="text-xs text-muted-foreground">
              {formatSize(content.size, i18n.language)} · {t("viewer.readOnly")}
            </p>
          )}
        </div>
        {runnable && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("files.runSettings")}
              title={t("files.runSettings")}
              onClick={onRunSettings}
            >
              <SlidersHorizontal />
            </Button>
            <Button size="sm" onClick={onRun}>
              <Play />
              {t("files.run")}
            </Button>
          </>
        )}
        <Button variant="ghost" size="icon-sm" aria-label={t("viewer.close")} onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <p className="p-3 text-sm break-words text-destructive">
            {t("viewer.readFailed", { error })}
          </p>
        )}
        {content?.binary && (
          <p className="p-3 text-sm text-muted-foreground">{t("viewer.binary")}</p>
        )}
        {content && !content.binary && (
          <>
            {content.truncated && (
              <p className="border-b bg-muted px-3 py-1 text-xs text-muted-foreground">
                {t("viewer.truncated", { size: formatSize(VIEW_LIMIT_BYTES, i18n.language) })}
              </p>
            )}
            <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre select-text">
              {content.text}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

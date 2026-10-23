import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import { Button } from "@/shadcn/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shadcn/ui/dialog";
import { Input } from "@/shadcn/ui/input";
import type { Entry } from "@/lib/browser";
import { getConfig, pickFile, pickFolder, setRunSettings } from "@/lib/config";

interface RunSettingsDialogProps {
  /** The script being edited; `null` keeps the dialog closed */
  entry: Entry | null;
  onClose: () => void;
}

/** The folder part of a path, for showing the default working folder. */
const parentOf = (path: string) => path.replace(/[\\/][^\\/]*$/, "");

/** Arguments, working folder and interpreter for one script. */
export function RunSettingsDialog({ entry, onClose }: RunSettingsDialogProps) {
  const { t } = useTranslation();
  const [args, setArgs] = useState("");
  const [workingFolder, setWorkingFolder] = useState("");
  const [interpreter, setInterpreter] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load the saved settings each time the dialog opens for a script
  useEffect(() => {
    if (!entry) return;
    setError(null);
    getConfig()
      .then((config) => {
        const saved = config.runSettings[entry.path];
        setArgs(saved?.args ?? "");
        setWorkingFolder(saved?.workingFolder ?? "");
        setInterpreter(saved?.interpreter ?? "");
      })
      .catch((loadError) => setError(String(loadError)));
  }, [entry]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!entry) return;
    try {
      await setRunSettings(entry.path, {
        args,
        workingFolder: workingFolder.trim() || null,
        interpreter: interpreter.trim() || null,
      });
      onClose();
    } catch (saveError) {
      setError(String(saveError));
    }
  };

  const clearAll = () => {
    setArgs("");
    setWorkingFolder("");
    setInterpreter("");
  };

  const browseFolder = async () => {
    const folder = await pickFolder(
      t("runSettings.workingFolder"),
      workingFolder || (entry ? parentOf(entry.path) : undefined),
    );
    if (folder) setWorkingFolder(folder);
  };

  const browseInterpreter = async () => {
    const file = await pickFile(t("runSettings.interpreter"));
    if (file) setInterpreter(file);
  };

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("runSettings.title")}</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">
              {entry?.path}
            </DialogDescription>
          </DialogHeader>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">{t("runSettings.args")}</span>
            <Input
              autoFocus
              className="font-mono"
              placeholder={t("runSettings.argsPlaceholder")}
              value={args}
              onChange={(event) => setArgs(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">{t("runSettings.argsHint")}</span>
          </label>

          <div className="grid gap-1.5 text-sm">
            <span className="font-medium">{t("runSettings.workingFolder")}</span>
            <div className="flex gap-2">
              <Input
                className="font-mono"
                aria-label={t("runSettings.workingFolder")}
                placeholder={entry ? parentOf(entry.path) : ""}
                value={workingFolder}
                onChange={(event) => setWorkingFolder(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("runSettings.browse")}
                onClick={browseFolder}
              >
                <FolderOpen />
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              {t("runSettings.workingFolderHint")}
            </span>
          </div>

          <div className="grid gap-1.5 text-sm">
            <span className="font-medium">{t("runSettings.interpreter")}</span>
            <div className="flex gap-2">
              <Input
                className="font-mono"
                aria-label={t("runSettings.interpreter")}
                placeholder={t("runSettings.interpreterPlaceholder")}
                value={interpreter}
                onChange={(event) => setInterpreter(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("runSettings.browse")}
                onClick={browseInterpreter}
              >
                <FolderOpen />
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              {t("runSettings.interpreterHint")}
            </span>
          </div>

          {error && <p className="text-sm break-words text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" className="sm:mr-auto" onClick={clearAll}>
              {t("runSettings.reset")}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

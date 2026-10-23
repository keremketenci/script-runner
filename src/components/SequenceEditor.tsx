import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, FileCode, Play, TriangleAlert, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/shadcn/ui/button";
import { filesExist } from "@/lib/browser";
import { findRoot, setSequenceSteps, type Config, type Sequence } from "@/lib/config";

interface SequenceEditorProps {
  sequence: Sequence;
  config: Config;
  onConfigChange: (config: Config) => void;
  onRun: () => void;
}

/** The last part of a path, for both / and \ separators. */
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Shows and edits the ordered steps of one sequence. Steps are added from the browser. */
export function SequenceEditor({ sequence, config, onConfigChange, onRun }: SequenceEditorProps) {
  const { t } = useTranslation();
  const [exists, setExists] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumped when the window regains focus, since scripts may have been moved meanwhile
  const [checkKey, setCheckKey] = useState(0);

  useEffect(() => {
    const recheck = () => setCheckKey((previous) => previous + 1);
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, []);

  useEffect(() => {
    let current = true;
    filesExist(sequence.steps)
      .then((result) => current && setExists(result))
      .catch((checkError) => current && setError(String(checkError)));
    return () => {
      current = false;
    };
  }, [sequence.steps, checkKey]);

  const saveSteps = async (steps: string[]) => {
    try {
      onConfigChange(await setSequenceSteps(sequence.id, steps));
      setError(null);
    } catch (saveError) {
      setError(String(saveError));
    }
  };

  const move = (index: number, offset: number) => {
    const steps = [...sequence.steps];
    const [step] = steps.splice(index, 1);
    steps.splice(index + offset, 0, step);
    saveSteps(steps);
  };

  // Running needs at least one step and no missing scripts
  const anyMissing = exists.some((fileExists) => !fileExists);
  const canRun = sequence.steps.length > 0 && !anyMissing;

  const remove = (index: number) => saveSteps(sequence.steps.filter((_step, other) => other !== index));

  return (
    <section className="flex min-h-40 flex-1 flex-col rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{sequence.name}</h2>
          <p className="text-xs text-muted-foreground">
            {anyMissing
              ? t("sequences.fixMissing")
              : t("sequences.stepCount", { count: sequence.steps.length })}
          </p>
        </div>
        <Button size="sm" disabled={!canRun} onClick={onRun}>
          <Play />
          {t("sequences.run")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {error && <p className="p-2 text-sm break-words text-destructive">{error}</p>}
        {sequence.steps.length === 0 && (
          <p className="p-2 text-sm text-muted-foreground">{t("sequences.noSteps")}</p>
        )}

        <ol>
          {sequence.steps.map((step, index) => {
            const root = findRoot(config.folders, step);
            // Shown as "Folder name/sub/folder/" so same-named scripts can be told apart
            const relative = root ? step.slice(root.path.length + 1) : step;
            const folderLabel = root
              ? [root.name, ...relative.split(/[\\/]/).slice(0, -1)].join("/")
              : "";
            const missing = exists[index] === false;
            return (
              // Steps may repeat, so the index is part of the key
              <li
                key={`${index}-${step}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                title={step}
              >
                <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
                  {index + 1}.
                </span>
                {missing ? (
                  <TriangleAlert className="size-4 shrink-0 text-destructive" />
                ) : (
                  <FileCode className="size-4 shrink-0" />
                )}
                <span className={cn("truncate", missing && "text-destructive line-through")}>
                  {config.aliases[step] ?? fileName(step)}
                </span>
                {config.aliases[step] && (
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {fileName(step)}
                  </span>
                )}
                <span className="ml-auto truncate pl-4 font-mono text-xs text-muted-foreground">
                  {missing ? t("sequences.missing") : folderLabel}
                </span>
                <div className="flex shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("sequences.moveUp")}
                    title={t("sequences.moveUp")}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("sequences.moveDown")}
                    title={t("sequences.moveDown")}
                    disabled={index === sequence.steps.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("sequences.removeStep")}
                    title={t("sequences.removeStep")}
                    onClick={() => remove(index)}
                  >
                    <X />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

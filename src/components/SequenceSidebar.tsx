import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ListOrdered, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shadcn/ui/dropdown-menu";
import { NameDialog } from "@/components/NameDialog";
import {
  createSequence,
  deleteSequence,
  renameSequence,
  type Config,
  type Sequence,
} from "@/lib/config";

interface SequenceSidebarProps {
  config: Config;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onConfigChange: (config: Config) => void;
}

export function SequenceSidebar({
  config,
  activeId,
  onSelect,
  onConfigChange,
}: SequenceSidebarProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Sequence | null>(null);
  const [deleting, setDeleting] = useState<Sequence | null>(null);

  // Runs a config command, shows its error if it fails, and returns the new config
  const runCommand = async (command: () => Promise<Config>) => {
    try {
      const updated = await command();
      setError(null);
      onConfigChange(updated);
      return updated;
    } catch (commandError) {
      setError(String(commandError));
      return null;
    }
  };

  const handleCreate = async (name: string) => {
    const updated = await runCommand(() => createSequence(name));
    if (!updated) return;
    setCreating(false);
    // New sequences are added at the end; open it right away
    onSelect(updated.sequences[updated.sequences.length - 1]?.id ?? null);
  };

  const handleRename = async (name: string) => {
    if (!renaming) return;
    if (await runCommand(() => renameSequence(renaming.id, name))) setRenaming(null);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const updated = await runCommand(() => deleteSequence(deleting.id));
    if (updated && activeId === deleting.id) onSelect(null);
    setDeleting(null);
  };

  return (
    <section className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="truncate text-sm font-medium group-data-[collapsed=true]/sidebar:invisible">{t("sequences.title")}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("sequences.create")}
          title={t("sequences.create")}
          onClick={() => setCreating(true)}
        >
          <Plus />
        </Button>
      </div>

      {config.sequences.length === 0 && (
        <p className="text-sm text-muted-foreground group-data-[collapsed=true]/sidebar:invisible">{t("sequences.empty")}</p>
      )}

      <ul className="flex flex-col gap-1">
        {config.sequences.map((sequence) => (
          <li key={sequence.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onSelect(sequence.id)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                activeId === sequence.id && "bg-accent font-medium",
              )}
            >
              <ListOrdered className="size-4 shrink-0" />
              <span className="truncate">{sequence.name}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {sequence.steps.length}
              </span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={t("sequences.options")} />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto">
                <DropdownMenuItem onClick={() => setRenaming(sequence)}>
                  <Pencil />
                  {t("sequences.rename")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDeleting(sequence)}>
                  <Trash2 />
                  {t("sequences.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>

      {error && (
        <p className="text-sm break-words text-destructive group-data-[collapsed=true]/sidebar:invisible">
          {t("folders.error", { error })}
        </p>
      )}

      <NameDialog
        open={creating}
        title={t("sequences.createTitle")}
        initialValue=""
        onCancel={() => setCreating(false)}
        onSave={handleCreate}
      />

      <NameDialog
        open={renaming !== null}
        title={t("sequences.renameTitle")}
        initialValue={renaming?.name ?? ""}
        onCancel={() => setRenaming(null)}
        onSave={handleRename}
      />

      {/* Deleting loses the step list, so it is confirmed; the scripts themselves stay */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sequences.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("sequences.deleteText", { name: deleting?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("sequences.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

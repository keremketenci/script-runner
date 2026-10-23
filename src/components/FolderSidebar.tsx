import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder, FolderInput, FolderPlus, MoreHorizontal, Pencil, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/shadcn/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shadcn/ui/dropdown-menu";
import { NameDialog } from "@/components/NameDialog";
import {
  addFolder,
  changeFolderPath,
  pickFolder,
  removeFolder,
  renameFolder,
  type Config,
  type ScriptFolder,
} from "@/lib/config";

interface FolderSidebarProps {
  config: Config;
  activePath: string | null;
  onSelect: (path: string | null) => void;
  onConfigChange: (config: Config) => void;
}

export function FolderSidebar({
  config,
  activePath,
  onSelect,
  onConfigChange,
}: FolderSidebarProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ScriptFolder | null>(null);

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

  const handleAdd = async () => {
    const path = await pickFolder(t("folders.pickTitle"));
    if (!path) return;
    if (await runCommand(() => addFolder(path))) onSelect(path);
  };

  const handleChangePath = async (folder: ScriptFolder) => {
    const newPath = await pickFolder(t("folders.pickTitle"), folder.path);
    if (!newPath || newPath === folder.path) return;
    const updated = await runCommand(() => changeFolderPath(folder.path, newPath));
    // Keep the folder selected under its new location
    if (updated && activePath === folder.path) onSelect(newPath);
  };

  const handleForget = async (folder: ScriptFolder) => {
    const updated = await runCommand(() => removeFolder(folder.path));
    if (updated && activePath === folder.path) {
      onSelect(updated.folders[0]?.path ?? null);
    }
  };

  const handleRename = async (name: string) => {
    if (!renaming) return;
    if (await runCommand(() => renameFolder(renaming.path, name))) setRenaming(null);
  };

  return (
    <section className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="truncate text-sm font-medium group-data-[collapsed=true]/sidebar:invisible">{t("folders.title")}</h2>
        <Button variant="ghost" size="icon" aria-label={t("folders.add")} onClick={handleAdd}>
          <FolderPlus />
        </Button>
      </div>

      {config.folders.length === 0 && (
        <p className="text-sm text-muted-foreground group-data-[collapsed=true]/sidebar:invisible">{t("folders.empty")}</p>
      )}

      <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
        {config.folders.map((folder) => (
          <li key={folder.path} className="group flex items-center gap-1">
            <button
              type="button"
              title={folder.path}
              onClick={() => onSelect(folder.path)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                activePath === folder.path && "bg-accent font-medium",
              )}
            >
              <Folder className="size-4 shrink-0" />
              <span className="truncate">{folder.name}</span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={t("folders.options")} />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto">
                <DropdownMenuItem onClick={() => setRenaming(folder)}>
                  <Pencil />
                  {t("folders.rename")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleChangePath(folder)}>
                  <FolderInput />
                  {t("folders.changePath")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => handleForget(folder)}>
                  <X />
                  {t("folders.forget")}
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
        open={renaming !== null}
        title={t("folders.renameTitle")}
        initialValue={renaming?.name ?? ""}
        onCancel={() => setRenaming(null)}
        onSave={handleRename}
      />
    </section>
  );
}

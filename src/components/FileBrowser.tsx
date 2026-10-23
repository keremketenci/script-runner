import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ChevronRight,
  Eye,
  File,
  FileCode,
  Folder,
  FolderOpen,
  ListPlus,
  FolderSearch,
  Pencil,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "@/shadcn/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/shadcn/ui/context-menu";
import { Input } from "@/shadcn/ui/input";
import { Toggle } from "@/shadcn/ui/toggle";
import { FileViewer } from "@/components/FileViewer";
import { NameDialog } from "@/components/NameDialog";
import { RunSettingsDialog } from "@/components/RunSettingsDialog";
import {
  listDir,
  openInFileManager,
  revealInFileManager,
  searchFolder,
  type Entry,
  type Listing,
  type SearchHit,
  type SearchResults,
} from "@/lib/browser";
import { setAlias, type Sequence } from "@/lib/config";
import { useSettings } from "@/settings/SettingsContext";

// Wait this long after the last key press before searching, so typing stays smooth
const SEARCH_DELAY_MS = 200;

interface FileBrowserProps {
  /** The folder currently shown; always inside one of the script folders */
  location: string;
  /** Display name of the script folder, shown as the first breadcrumb */
  rootName: string;
  onNavigate: (location: string) => void;
  /** Runs a script file in the terminal */
  onRun: (entry: Entry) => void;
  /** Sequences offered in the "Add to sequence" menu */
  sequences: Sequence[];
  onAddToSequence: (sequenceId: string, entry: Entry) => Promise<void>;
  /** Changes whenever files may have changed on disk, for example after a script finished */
  refreshSignal: number;
}

interface EntryRowProps {
  entry: Entry;
  /** Shown after the name in search results, to tell same-named files apart */
  folderLabel?: string;
  /** Marks the selected file and scrolls it into view */
  highlighted?: boolean;
  onClick: () => void;
  /** Right-click menu actions; running and renaming are offered for files only */
  onRun: () => void;
  onRunSettings: () => void;
  sequences: Sequence[];
  onAddToSequence: (sequenceId: string) => void;
  onReveal: () => void;
  onRename: () => void;
  onRestoreName: () => void;
}

function EntryRow({
  entry,
  folderLabel,
  highlighted = false,
  onClick,
  onRun,
  onRunSettings,
  sequences,
  onAddToSequence,
  onReveal,
  onRename,
  onRestoreName,
}: EntryRowProps) {
  const { t } = useTranslation();
  const Icon = entry.isFolder ? Folder : entry.isScript ? FileCode : File;
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const rowProps = {
    type: "button" as const,
    title: entry.path,
    onClick,
    // Double-click or Enter runs a script; a single click only selects it
    onDoubleClick: entry.isScript ? onRun : undefined,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Enter" && entry.isScript) {
        event.preventDefault();
        onRun();
      }
    },
    className: cn(
      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
      !entry.isFolder && !entry.isScript && "text-muted-foreground",
      highlighted && "bg-accent font-medium ring-1 ring-ring",
    ),
  };
  const content = (
    <>
      <Icon className="size-4 shrink-0" />
      {entry.alias ? (
        <>
          <span className="truncate font-medium">{entry.alias}</span>
          {/* The real file name stays visible next to the app-only name */}
          <span className="truncate font-mono text-xs text-muted-foreground">{entry.name}</span>
        </>
      ) : (
        <span className="truncate">{entry.name}</span>
      )}
      {folderLabel !== undefined && (
        <span className="ml-auto truncate pl-4 font-mono text-xs text-muted-foreground">
          {folderLabel}
        </span>
      )}
    </>
  );

  return (
    <li ref={rowRef}>
      <ContextMenu>
        {/* render= turns the menu trigger into our row button (Base UI's version of asChild) */}
        <ContextMenuTrigger render={<button {...rowProps} />}>{content}</ContextMenuTrigger>
        <ContextMenuContent>
          {/* Running and sequences only make sense for scripts, not for notes or logs */}
          {entry.isScript && (
            <>
              <ContextMenuItem onClick={onRun}>
                <Play />
                {t("files.run")}
              </ContextMenuItem>
              <ContextMenuItem onClick={onRunSettings}>
                <SlidersHorizontal />
                {t("files.runSettings")}
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <ListPlus />
                  {t("files.addToSequence")}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {sequences.length === 0 && (
                    <ContextMenuItem disabled>{t("files.noSequences")}</ContextMenuItem>
                  )}
                  {sequences.map((sequence) => (
                    <ContextMenuItem key={sequence.id} onClick={() => onAddToSequence(sequence.id)}>
                      {sequence.name}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={onReveal}>
            <FolderSearch />
            {t("files.reveal")}
          </ContextMenuItem>
          {!entry.isFolder && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onRename}>
                <Pencil />
                {t("files.rename")}
              </ContextMenuItem>
            </>
          )}
          {!entry.isFolder && entry.alias && (
            <ContextMenuItem onClick={onRestoreName}>
              <Undo2 />
              {t("files.restoreName")}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

export function FileBrowser({
  location,
  rootName,
  onNavigate,
  onRun,
  sequences,
  onAddToSequence,
  refreshSignal,
}: FileBrowserProps) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const showAll = settings.showAllFiles;
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  // The selected file: highlighted in the list and shown in the viewer
  const [selected, setSelected] = useState<Entry | null>(null);
  // The file whose display name is being edited in the dialog
  const [renaming, setRenaming] = useState<Entry | null>(null);
  // The script whose run settings are open
  const [configuring, setConfiguring] = useState<Entry | null>(null);
  // Bumped to load the folder again: after a rename, the refresh button or returning to the window
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((previous) => previous + 1);

  // Files may have changed in another program while the window was in the background
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const searching = query.trim() !== "";

  useEffect(() => {
    // Ignore a slow answer if the user has already moved on to another folder
    let current = true;
    listDir(location, showAll)
      .then((result) => {
        if (!current) return;
        setListing(result);
        setError(null);
      })
      .catch((listError) => {
        if (current) setError(String(listError));
      });
    return () => {
      current = false;
    };
    // rootName is listed so renaming the script folder refreshes the breadcrumb
  }, [location, showAll, rootName, refreshKey, refreshSignal]);

  useEffect(() => {
    if (!searching) {
      setResults(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      searchFolder(location, query, showAll)
        .then((found) => {
          if (!current) return;
          setResults(found);
          setError(null);
        })
        .catch((searchError) => {
          if (current) setError(String(searchError));
        });
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [location, query, showAll, searching, refreshKey, refreshSignal]);

  const crumbs = listing?.crumbs ?? [];

  const openFolder = (path: string) => {
    setQuery("");
    setSelected(null);
    onNavigate(path);
  };

  // A folder hit opens that folder; a file hit opens the folder holding it and selects the file
  const openHit = (hit: SearchHit) => {
    if (hit.isFolder) {
      openFolder(hit.path);
      return;
    }
    setQuery("");
    setSelected(hit);
    onNavigate(hit.parent);
  };

  // Sets or clears a file's app-only name; the file on disk is never touched
  const saveAlias = async (entry: Entry, alias: string | null) => {
    try {
      const config = await setAlias(entry.path, alias);
      const newAlias = config.aliases[entry.path] ?? null;
      if (selected?.path === entry.path) setSelected({ ...selected, alias: newAlias });
      setRenaming(null);
      setError(null);
      refresh();
    } catch (aliasError) {
      setError(String(aliasError));
    }
  };

  // Hands a path to the system file manager; failures show up like other browser errors
  const runFileManager = (action: () => Promise<void>) => {
    action()
      .then(() => setError(null))
      .catch((managerError) => setError(String(managerError)));
  };

  const addToSequence = (sequenceId: string, entry: Entry) => {
    onAddToSequence(sequenceId, entry)
      .then(() => setError(null))
      .catch((addError) => setError(String(addError)));
  };

  // Folder rows open the folder; file rows select the file and show it in the viewer
  const clickEntry = (entry: Entry) => {
    if (entry.isFolder) openFolder(entry.path);
    else setSelected(entry);
  };

  // The current folder's own name, for the search placeholder
  const currentName = crumbs[crumbs.length - 1]?.name ?? rootName;

  // The crumb before the last one is the parent folder; none at the root
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;

  return (
    <section className="@container flex min-h-40 flex-1 flex-col rounded-lg border">
      <div className="flex items-center gap-2 border-b p-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("browser.back")}
          title={t("browser.back")}
          disabled={!parent}
          onClick={() => parent && openFolder(parent.path)}
        >
          <ArrowLeft />
        </Button>

        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm whitespace-nowrap">
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.path}>
              {index > 0 && <ChevronRight className="size-3.5 text-muted-foreground" />}
              <button
                type="button"
                onClick={() => openFolder(crumb.path)}
                className={cn(
                  "rounded px-1 hover:bg-accent",
                  index === crumbs.length - 1 && "font-medium",
                )}
              >
                {crumb.name}
              </button>
            </Fragment>
          ))}
        </nav>

        <Button
          variant="ghost"
          size="icon"
          aria-label={t("browser.refresh")}
          title={t("browser.refresh")}
          onClick={refresh}
        >
          <RefreshCw />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          aria-label={t("browser.openInFileManager")}
          title={t("browser.openInFileManager")}
          onClick={() => runFileManager(() => openInFileManager(location))}
        >
          <FolderOpen />
        </Button>

        <Toggle
          variant="outline"
          size="sm"
          pressed={showAll}
          onPressedChange={(pressed) => updateSettings({ showAllFiles: pressed })}
          title={t("browser.showAll")}
          aria-label={t("browser.showAll")}
        >
          <Eye />
          {/* The label only fits when the browser is wide enough; the icon stays */}
          <span className="hidden @xl:inline">{t("browser.showAll")}</span>
        </Toggle>
      </div>

      <div className="relative border-b p-2">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="px-8"
          placeholder={t("browser.searchPlaceholder", { folder: currentName })}
          aria-label={t("browser.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && setQuery("")}
        />
        {query && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute top-1/2 right-3 -translate-y-1/2"
            aria-label={t("browser.clearSearch")}
            onClick={() => setQuery("")}
          >
            <X />
          </Button>
        )}
      </div>

      {/* Full path so it is always clear where on disk we are */}
      <p
        className="truncate border-b px-3 py-1 font-mono text-xs text-muted-foreground"
        title={location}
      >
        {location}
      </p>

      {/* Viewer next to the list when there is room, below it when the browser is narrow */}
      <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-1">
          {error && (
            <p className="p-2 text-sm break-words text-destructive">
              {t("browser.listFailed", { error })}
            </p>
          )}

          {searching ? (
            <>
              {!error && results?.hits.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">{t("browser.noResults")}</p>
              )}
              <ul>
                {results?.hits.map((hit) => (
                  <EntryRow
                    key={hit.path}
                    entry={hit}
                    folderLabel={hit.folder || currentName}
                    onClick={() => openHit(hit)}
                    onRun={() => onRun(hit)}
                    onRunSettings={() => setConfiguring(hit)}
                    sequences={sequences}
                    onAddToSequence={(sequenceId) => addToSequence(sequenceId, hit)}
                    onReveal={() => runFileManager(() => revealInFileManager(hit.path))}
                    onRename={() => setRenaming(hit)}
                    onRestoreName={() => saveAlias(hit, null)}
                  />
                ))}
              </ul>
              {results?.truncated && (
                <p className="p-2 text-xs text-muted-foreground">
                  {t("browser.truncated", { count: results.hits.length })}
                </p>
              )}
            </>
          ) : (
            <>
              {!error && listing?.entries.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">
                  {showAll ? t("browser.emptyFolder") : t("browser.noScripts")}
                </p>
              )}
              <ul>
                {listing?.entries.map((entry) => (
                  <EntryRow
                    key={entry.path}
                    entry={entry}
                    highlighted={entry.path === selected?.path}
                    onClick={() => clickEntry(entry)}
                    onRun={() => onRun(entry)}
                    onRunSettings={() => setConfiguring(entry)}
                    sequences={sequences}
                    onAddToSequence={(sequenceId) => addToSequence(sequenceId, entry)}
                    onReveal={() => runFileManager(() => revealInFileManager(entry.path))}
                    onRename={() => setRenaming(entry)}
                    onRestoreName={() => saveAlias(entry, null)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
        {selected && (
          <FileViewer
            path={selected.path}
            name={selected.name}
            alias={selected.alias}
            runnable={selected.isScript}
            onRun={() => onRun(selected)}
            onRunSettings={() => setConfiguring(selected)}
            refreshSignal={refreshKey + refreshSignal}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      <NameDialog
        open={renaming !== null}
        title={t("files.renameTitle")}
        description={renaming && t("files.renameHint", { name: renaming.name })}
        initialValue={renaming?.alias ?? renaming?.name ?? ""}
        onCancel={() => setRenaming(null)}
        onSave={(name) => renaming && saveAlias(renaming, name)}
      />

      <RunSettingsDialog entry={configuring} onClose={() => setConfiguring(null)} />
    </section>
  );
}

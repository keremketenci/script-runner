import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shadcn/ui/button";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TerminalView } from "@/components/TerminalView";

export default function App() {
  const { t } = useTranslation();
  // Changing the key remounts the terminal, which starts the script again
  const [runKey, setRunKey] = useState(0);

  return (
    // Padding keeps content clear of notches, status bars and gesture areas
    // Fixed viewport height so the terminal can fill the remaining space
    <div className="flex h-dvh flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <header className="flex h-14 items-center justify-end gap-2 px-4">
        <Button variant="outline" onClick={() => setRunKey((previous) => previous + 1)}>
          <RotateCcw />
          {t("terminal.restart")}
        </Button>
        <SettingsPanel />
      </header>

      <main className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        <TerminalView key={runKey} />
      </main>
    </div>
  );
}

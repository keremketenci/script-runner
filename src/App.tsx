import { SettingsPanel } from "@/components/SettingsPanel";

export default function App() {
  return (
    // Padding keeps content clear of notches, status bars and gesture areas
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <header className="flex h-14 items-center justify-end px-4">
        <SettingsPanel />
      </header>

      {/* Each app fills this area with its own content */}
      <main className="flex-1" />
    </div>
  );
}

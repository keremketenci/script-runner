import { useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shadcn/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shadcn/ui/sheet";
import { useSettings } from "@/settings/SettingsContext";
import { LANGUAGES, LANGUAGE_NAMES, THEMES } from "@/lib/settings";

export function SettingsPanel() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        // 44px is the recommended minimum touch target size
        className="size-11"
        aria-label={t("settings.title")}
        onClick={() => setOpen(true)}
      >
        <SettingsIcon className="size-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)]"
        >
          <SheetHeader>
            <SheetTitle>{t("settings.title")}</SheetTitle>
            <SheetDescription>{t("settings.description")}</SheetDescription>
          </SheetHeader>

          <div className="space-y-6 p-4">
            <section className="space-y-2">
              <h3 className="text-sm font-medium">{t("settings.language")}</h3>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
                {LANGUAGES.map((language) => (
                  <Button
                    key={language}
                    className="h-11"
                    variant={settings.language === language ? "default" : "outline"}
                    onClick={() => updateSettings({ language })}
                  >
                    {LANGUAGE_NAMES[language]}
                  </Button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">{t("settings.theme")}</h3>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
                {THEMES.map((theme) => (
                  <Button
                    key={theme}
                    className="h-11"
                    variant={settings.theme === theme ? "default" : "outline"}
                    onClick={() => updateSettings({ theme })}
                  >
                    {t(`theme.${theme}`)}
                  </Button>
                ))}
              </div>
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

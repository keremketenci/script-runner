export type Theme = "light" | "dark" | "system";
export type Language = "en" | "tr";
/** What the browser shows on launch: the last opened folder, or a folder choice */
export type StartupMode = "lastLocation" | "ask";

export interface Settings {
  theme: Theme;
  language: Language;
  startup: StartupMode;
  showAllFiles: boolean;
  /** Sidebar width in pixels while it is not compact */
  sidebarWidth: number;
  /** Compact sidebar: a narrow icon rail that opens while the mouse is over it */
  sidebarCompact: boolean;
  /** Part of the main column's height used by the terminal, from 0 to 1 */
  terminalShare: number;
}

/** Allowed sizes. The layout also caps them by the window size, so nothing can be dragged away. */
export const SIDEBAR_WIDTH = { min: 180, max: 420, initial: 240 };
export const TERMINAL_SHARE = { min: 0.15, max: 0.8, initial: 0.4 };

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** A stored number, or the fallback when it is missing or not a finite number. */
function storedNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

export const THEMES: Theme[] = ["light", "dark", "system"];
export const LANGUAGES: Language[] = ["en", "tr"];
export const STARTUP_MODES: StartupMode[] = ["lastLocation", "ask"];

// Each language is displayed in its own language
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  tr: "Türkçe",
};

const STORAGE_KEY = "app-settings";

function detectLanguage(): Language {
  const deviceLanguage = navigator.language.toLowerCase();
  return deviceLanguage.startsWith("tr") ? "tr" : "en";
}

function getDefaultSettings(): Settings {
  return {
    theme: "system",
    language: detectLanguage(),
    startup: "lastLocation",
    showAllFiles: false,
    sidebarWidth: SIDEBAR_WIDTH.initial,
    sidebarCompact: false,
    terminalShare: TERMINAL_SHARE.initial,
  };
}

export function loadSettings(): Settings {
  const defaults = getDefaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Ignore invalid stored values and fall back to defaults
    return {
      theme: THEMES.includes(parsed.theme as Theme)
        ? (parsed.theme as Theme)
        : defaults.theme,
      language: LANGUAGES.includes(parsed.language as Language)
        ? (parsed.language as Language)
        : defaults.language,
      startup: STARTUP_MODES.includes(parsed.startup as StartupMode)
        ? (parsed.startup as StartupMode)
        : defaults.startup,
      showAllFiles:
        typeof parsed.showAllFiles === "boolean" ? parsed.showAllFiles : defaults.showAllFiles,
      sidebarWidth: storedNumber(
        parsed.sidebarWidth,
        defaults.sidebarWidth,
        SIDEBAR_WIDTH.min,
        SIDEBAR_WIDTH.max,
      ),
      sidebarCompact:
        typeof parsed.sidebarCompact === "boolean"
          ? parsed.sidebarCompact
          : defaults.sidebarCompact,
      terminalShare: storedNumber(
        parsed.terminalShare,
        defaults.terminalShare,
        TERMINAL_SHARE.min,
        TERMINAL_SHARE.max,
      ),
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable; fail silently
  }
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(theme: Theme): void {
  const isDark = theme === "dark" || (theme === "system" && systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
}

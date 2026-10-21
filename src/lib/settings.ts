export type Theme = "light" | "dark" | "system";
export type Language = "en" | "tr";

export interface Settings {
  theme: Theme;
  language: Language;
}

export const THEMES: Theme[] = ["light", "dark", "system"];
export const LANGUAGES: Language[] = ["en", "tr"];

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
  return { theme: "system", language: detectLanguage() };
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

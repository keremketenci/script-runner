import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { loadSettings } from "@/lib/settings";
import en from "./locales/en.json";
import tr from "./locales/tr.json";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    tr: { translation: tr },
  },
  // Start with the language saved in settings
  lng: loadSettings().language,
  fallbackLng: "en",
  // React already escapes values, so i18next does not need to
  interpolation: { escapeValue: false },
});

export default i18n;

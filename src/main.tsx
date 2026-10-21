import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./settings/SettingsContext";
import { applyTheme, loadSettings } from "./lib/settings";
import "./index.css";
import "./i18n";

// Apply the saved theme before the first render to avoid a flash
applyTheme(loadSettings().theme);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </React.StrictMode>,
);

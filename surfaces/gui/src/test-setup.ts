// Vitest global setup: initialize i18n synchronously so t() resolves inside
// components under test. Uses the English resources so existing English
// assertions keep working; without this, t("key") renders the key literal.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en, zh } from "./localeOverlay"; // Marlo overlay，见该文件

i18n.use(initReactI18next).init({
  // zh 也装上：no-english 那把尺子要切到中文再扫 DOM（见 src/testLocale.ts）。
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

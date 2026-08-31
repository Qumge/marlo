// Vitest global setup: initialize i18n synchronously so t() resolves inside
// components under test. Uses the English resources so existing English
// assertions keep working; without this, t("key") renders the key literal.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./localeOverlay"; // Marlo overlay，见该文件

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

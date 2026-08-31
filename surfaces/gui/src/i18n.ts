/**
 * i18n initialization (react-i18next).
 *
 * Locale resources live in src/locales/*.json. English is the default and
 * fallback; the language follows the system locale unless the user picks one
 * explicitly in Settings (persisted in localStorage).
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Marlo：目录经 localeOverlay 叠加我们的措辞；locales/*.json 与上游字节相同。
import { en, zh } from "./localeOverlay";

const STORAGE_KEY = "openworker.lang";

export const SUPPORTED_LANGS = ["en", "zh"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

// Marlo 迁移：我们自己那套 i18n 把语言选择存在 "marlo.locale"（见 legacyI18n/index.ts）。
// 换到上游的 runtime 之后键名变成 "openworker.lang" —— 不迁的话，所有【显式选过中文】
// 的老用户升级后会读不到自己的选择，静默回落到系统语言：英文系统的中文用户，一次更新
// 之后整个界面变回英文，而且没有任何提示。读一次旧键、写进新键、删掉旧键，只发生一次。
const LEGACY_STORAGE_KEY = "marlo.locale";

function migrateLegacyLang(): string | null {
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return null;
    if ((SUPPORTED_LANGS as readonly string[]).includes(legacy)) {
      if (!localStorage.getItem(STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, legacy);
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return legacy;
  } catch {
    return null;
  }
}

/** The user's explicit choice wins; otherwise follow the system locale. */
function resolveLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? migrateLegacyLang();
    if (stored && (SUPPORTED_LANGS as readonly string[]).includes(stored)) {
      return stored as Lang;
    }
  } catch {
    /* localStorage unavailable — fall through to system locale */
  }
  const nav = (typeof navigator !== "undefined" && navigator.language) || "";
  return nav.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export async function initI18n() {
  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    lng: resolveLang(),
    fallbackLng: "en",
    interpolation: { escapeValue: false }, // React already escapes
    returnNull: false,
  });
  return i18n;
}

/** Switch language at runtime and persist the choice. Pass null to follow the system locale again. */
export function setLanguage(lang: Lang | null) {
  try {
    if (lang === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* persistence failure shouldn't block the switch */
  }
  return i18n.changeLanguage(lang ?? resolveLang());
}

/** The user's persisted choice, or null when following the system locale. */
export function getStoredLanguage(): Lang | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LANGS as readonly string[]).includes(stored)) {
      return stored as Lang;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function getCurrentLanguage(): Lang {
  const l = i18n.language;
  return (l && l.startsWith("zh") ? "zh" : "en") as Lang;
}

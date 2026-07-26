import { useSyncExternalStore } from "react";
import { en, type Strings } from "./en";
import { zh } from "./zh";

export type Locale = "en" | "zh";

const CATALOGS: Record<Locale, Strings> = { en, zh };
const STORAGE_KEY = "marlo.locale";

/** What the OS asked for, when the user has expressed no preference.
 *
 * Anything under `zh` — zh-CN, zh-Hans, zh-TW — gets Chinese. There is one
 * Chinese catalog, and Simplified is closer for a Traditional reader than
 * English is. */
function detect(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "zh") return stored;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => l?.toLowerCase().startsWith("zh")) ? "zh" : "en";
}

let current: Locale = (() => {
  try {
    return detect();
  } catch {
    return "en"; // no localStorage/navigator (tests, SSR-ish harnesses)
  }
})();

const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode — the choice just won't survive a restart */
  }
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  listeners.forEach((fn) => fn());
}

/** Translate outside React (event handlers, module scope). */
export function t<K extends keyof Strings>(key: K): Strings[K] {
  return CATALOGS[current][key];
}

/** Translate inside a component, re-rendering when the language changes.
 *
 * useSyncExternalStore rather than context: every component in the tree reads
 * strings, and threading a provider through would have meant touching each of
 * them twice — once for the strings, once for the plumbing. */
export function useT(): <K extends keyof Strings>(key: K) => Strings[K] {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
    () => current,
  );
  return t;
}

if (typeof document !== "undefined") {
  document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
}

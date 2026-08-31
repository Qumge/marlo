import i18next from "i18next";
import { useSyncExternalStore } from "react";
import { en, type Strings } from "./en";
import { zh } from "./zh";

export type Locale = "en" | "zh";

const CATALOGS: Record<Locale, Strings> = { en, zh };
// 【迁移期：语言只有一个来源】i18n.ts（上游那套）把选择存在 "openworker.lang"，
// 并且会把旧的 "marlo.locale" 迁过去然后删掉。这边如果还只读旧键，就会在迁移之后
// 读不到任何东西、回落到系统语言 —— 结果是【半个界面中文半个英文】：迁过去的组件
// 跟着 i18next 走，还没迁的 29 个文件跟着这里走。2026-08-31 真机走查时账号菜单
// 整块是英文，就是这个。
//
// 所以这里读新键、写新键，旧键只作为兜底（还没被 i18n.ts 迁过的第一次启动）。
const STORAGE_KEY = "openworker.lang";
const LEGACY_STORAGE_KEY = "marlo.locale";

/** What the OS asked for, when the user has expressed no preference.
 *
 * Anything under `zh` — zh-CN, zh-Hans, zh-TW — gets Chinese. There is one
 * Chinese catalog, and Simplified is closer for a Traditional reader than
 * English is. */
function detect(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
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
  apply(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* private mode — the choice just won't survive a restart */
  }
  // 迁移期两套 i18n 并存，切语言必须两边都动。这一处是上手引导里的开关（还在这套
  // 里），所以由它去推 i18next；反方向（设置页里上游那个三档开关）走下面的订阅。
  if (i18next.isInitialized) void i18next.changeLanguage(next);
}

/** 只改这套的状态，不回推 i18next —— 两个方向都要经过它，否则会来回弹。 */
function apply(next: Locale): void {
  if (next === current) return;
  current = next;
  if (typeof document !== "undefined") {
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  }
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

// 【设置页那个开关走的是上游那条路】合并之后，设置页用的是上游自己的语言开关
// （settings.language，三档，含"跟随系统"），它只调 i18n.ts 的 setLanguage ——
// 那边写 storage、切 i18next，但完全不知道这套的存在。于是走查时出现过反向的
// 半英半中：storage 已经是 en、大部分界面变了英文，而账号菜单这些还没迁的组件
// 纹丝不动。
//
// 修法不是让两个开关各自去推对方（那是两个事实来源，迟早对不上），而是让这套
// 单向跟随 i18next。Phase C 退役这套之后，这一段和整个文件一起消失。
i18next.on("languageChanged", (lng) => {
  apply(typeof lng === "string" && lng.toLowerCase().startsWith("zh") ? "zh" : "en");
});

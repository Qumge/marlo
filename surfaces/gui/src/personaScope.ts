// A persona is "project-scoped" when it declares requires_folder: an explicit directory the
// user picks, sessions grouped by project in the sidebar. Everything else runs on a transparent
// per-conversation scratch dir, with real folders added as roots when needed — no folder gate.
// (The old family/workspace-enum pair collapsed into this trait; workspace-scratch-design.md.)
export function isProjectScoped(p?: { requires_folder?: boolean }): boolean {
  return p?.requires_folder === true;
}

// Persona naming: the product is "Marlo". The default persona IS Marlo (the registry already
// names it so) — Marlo 的用户看到的是在跟 Marlo 说话，不是跟一个叫 "Coworker" 的东西
// （owner 2026-09-23）。Other personas keep the "Coworker" family: Code Coworker, Ops Coworker.
// In lists/chrome we use the SHORT label (Marlo / Code / Ops); the persona detail page uses the
// FULL family name. Backend names are left untouched; this is purely the display layer.

export const DEFAULT_PERSONA_LABEL = "Marlo";

// Short label for the sidebar + top bar: "Marlo" / "Code" / "Ops" / "Chat".
export function shortPersonaName(name?: string, id?: string): string {
  if (id === "cowork") return DEFAULT_PERSONA_LABEL;
  const n = (name || id || "").trim();
  return n.replace(/\s*coworker$/i, "").trim() || n;
}

// Full family name for the persona detail page: "Marlo" / "Code Coworker" / "Ops Coworker".
// Chat isn't a coworker — left as-is.
export function fullPersonaName(name?: string, id?: string): string {
  if (id === "cowork") return DEFAULT_PERSONA_LABEL;
  const n = (name || id || "").trim();
  if (id === "chat" || !n) return n;
  return /coworker$/i.test(n) ? n : `${n} Coworker`;
}

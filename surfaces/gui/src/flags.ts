// Launch feature flags.
//
// A flag is read at render time (not import time) so tests and a running build can flip
// it via localStorage without a reload race: `localStorage.setItem(key, "1")` shows the
// feature, `"0"` force-hides it, anything else falls back to the shipped default.

function flag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    // No storage (jsdom teardown, privacy mode) — ship the default.
  }
  return fallback;
}

/** Coworkers shipped with UX-029 (the composer's setup-row picker): the Settings ▸
 * Coworkers tab and management flows are ON by default. `ocw.flag.personas` = "0" is the
 * escape hatch to hide them again. (Hidden for launch 2026-07-19 → enabled 2026-08-10.) */
export const showPersonas = () => flag("ocw.flag.personas", true);

/** Remote machines (upstream "remote homes": `openworker join`, the machine picker, the
 * Machines inventory, the upstream cloud union view). OFF in Marlo: its users are not
 * running headless boxes, and every one of those screens is a question they can't answer
 * ("which machine?"). The engine keeps the feature; `marlo.flag.machines` = "1" shows it. */
export const showMachines = () => flag("marlo.flag.machines", false);

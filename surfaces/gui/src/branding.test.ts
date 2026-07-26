import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";

// 0.2.1 installed as Marlo, showed a Marlo icon in the Dock, and then greeted the
// user with "Welcome to OpenWorker". The rename had covered packaging — productName,
// bundle identifier, installer names — and nothing in the UI. Every test passed, the
// build succeeded, and the app ran fine; it just called itself by the wrong name.
//
// Four kinds of OpenWorker legitimately stay, and the point of the allowlist is that
// adding to it has to be a decision someone makes on purpose:
//
//   "OpenWorker Cloud" / openworker.com — a service this project does not operate.
//       Renaming it would tell users their connector tokens are brokered by us.
//   X-OpenWorker-Token / openworker-server — wire protocol and binary name.
//   publisher === "OpenWorker" / "openworker" — matched against upstream gallery data.
//   "@OpenWorker" — the upstream Slack bot's actual handle.

// vitest's root is surfaces/gui. import.meta.url resolves to a bare "/src" here,
// which scandir cannot open — the `scanned` assertion below is what surfaced that.
const SRC = resolve(process.cwd(), "src");

const ALLOWED = [
  /OpenWorker Cloud/,
  /openworker\.com/,
  /X-OpenWorker-Token/,
  /openworker-server/,
  /publisher === "OpenWorker"/,
  /"openworker"/,
  /@OpenWorker/,
  /OpenWorker sidecar token/, // the server's own error string, stubbed in tests
];

const EXEMPT_FILES = new Set(["Sidebar.test.tsx", "branding.test.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".tsx", ".css"].includes(extname(entry))) out.push(full);
  }
  return out;
}

describe("branding", () => {
  it("no user-facing string still calls the product OpenWorker", () => {
    const offenders: string[] = [];
    let scanned = 0;

    for (const file of walk(SRC)) {
      const name = file.split("/").pop()!;
      if (EXEMPT_FILES.has(name)) continue;
      scanned++;

      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (!line.includes("OpenWorker")) return;
        if (ALLOWED.some((re) => re.test(line))) return;
        offenders.push(`${name}:${i + 1}  ${line.trim()}`);
      });
    }

    // Guards against the check silently scanning nothing after a path change.
    expect(scanned).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});

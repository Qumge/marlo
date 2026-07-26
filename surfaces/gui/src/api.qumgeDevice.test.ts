// Fix 3: startQumgeDevice()/pollQumgeDevice() used to resolve `res.json()` unconditionally,
// so a non-2xx JSON body (e.g. the sidecar auth middleware's 401 `{"error": "..."}`) looked
// exactly like success to the caller — `data.interval` came back `undefined`, which fed a
// `setTimeout(poll, NaN)` in QumgeConnect and an unbounded fetch loop behind a "waiting"
// panel showing an empty code. Both helpers must now THROW on a non-OK response, and on a
// 200 that itself carries a typed `{status: "error", ...}` body (qumge.com rate-limited /
// unreachable — see device_flow.py), so the component's existing try/catch is the single
// place that turns a failure into a message.
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollQumgeDevice, startQumgeDevice } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({
          ok: status >= 200 && status < 300,
          status,
          json: async () => body,
        }) as Response,
    ),
  );
}

describe("startQumgeDevice", () => {
  it("resolves with the payload on a real success body", async () => {
    stubFetch(200, {
      user_code: "ABCD-1234",
      verification_uri: "https://qumge.com/device",
      verification_uri_complete: "https://qumge.com/device?user_code=ABCD-1234",
      interval: 5,
      expires_in: 900,
    });
    await expect(startQumgeDevice()).resolves.toMatchObject({ user_code: "ABCD-1234" });
  });

  it("throws (does not silently resolve) on a non-OK sidecar error body", async () => {
    stubFetch(401, { error: "missing or invalid OpenWorker sidecar token" });
    await expect(startQumgeDevice()).rejects.toThrow(/missing or invalid/i);
  });

  it("throws on a 200 that itself carries a typed qumge error (rate-limited/unreachable)", async () => {
    stubFetch(200, {
      status: "error",
      kind: "rate_limited",
      error: "Too many sign-in attempts — wait a bit and try again.",
    });
    await expect(startQumgeDevice()).rejects.toThrow(/too many sign-in attempts/i);
  });
});

describe("pollQumgeDevice", () => {
  it("resolves with the payload on a pending status", async () => {
    stubFetch(200, { status: "pending" });
    await expect(pollQumgeDevice()).resolves.toEqual({ status: "pending" });
  });

  it("throws (does not silently resolve) on a non-OK sidecar error body", async () => {
    stubFetch(401, { error: "missing or invalid OpenWorker sidecar token" });
    await expect(pollQumgeDevice()).rejects.toThrow(/missing or invalid/i);
  });
});

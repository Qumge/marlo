import { test, expect } from "./fixtures";

// Inbox ▸ Configure, two layout defects owner reported on 2026-08-01 (both inherited
// verbatim from upstream — the classes are byte-identical there):
//
//   1. 私信下拉选择超出外围 — the DM <select> pushes past its card.
//   2. 无人值守时的审批的设置按钮需要和对应的 input 一样高 — the Set button sits
//      shorter than the channel input beside it.
//
// Neither is visible at a wide viewport with short seed data, which is why they
// shipped. Both are measured here rather than eyeballed: a class name can be
// "correct" and still lay out wrong.

async function openConfigure(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("inbox-chip").click();
  await page.getByTestId("inbox-tab-configure").click();
  await expect(page.getByTestId("inbox-configure")).toBeVisible();
}

// A <select> takes its intrinsic width from the WIDEST <option>, and a flex item
// defaults to min-width:auto — which refuses to shrink below that. Session titles
// are model-generated, so the widest option is unbounded: the dropdown grows until
// it hangs outside the card. Narrowing the window is the cheap way to reproduce
// what a long title does at any width.
test("the DM dropdown stays inside its card when the window is narrow", async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 900 });
  await openConfigure(page);

  const select = page.getByTestId("inbox-configure").locator("select").first();
  const card = select.locator("xpath=ancestor::div[contains(@class,'bg-panel')][1]");

  const s = await select.boundingBox();
  const c = await card.boundingBox();
  expect(s, "DM select should be laid out").not.toBeNull();
  expect(c, "its card should be laid out").not.toBeNull();

  // Right edge inside the card's, left edge too — 0.5px for subpixel rounding.
  expect(s!.x + s!.width).toBeLessThanOrEqual(c!.x + c!.width + 0.5);
  expect(s!.x).toBeGreaterThanOrEqual(c!.x - 0.5);
});

// The button and the input are separate elements with separately hand-tuned padding
// (py-1 + 12px text vs 6px + 13px text + 1px border), so they drifted apart. The fix
// is self-stretch — the button takes the flex line's height — which is why this
// asserts equality rather than "within a few px of 30".
test("the Set button is exactly as tall as the channel input next to it", async ({ page }) => {
  await openConfigure(page);

  const mirror = page.getByTestId("inbox-mirror-card");
  const input = mirror.getByPlaceholder("slack:C0123 or channel link");
  const button = mirror.getByRole("button", { name: "Set", exact: true });

  const i = await input.boundingBox();
  const b = await button.boundingBox();
  expect(i, "channel input should be laid out").not.toBeNull();
  expect(b, "Set button should be laid out").not.toBeNull();

  expect(b!.height).toBeCloseTo(i!.height, 0);
  // Same line, not merely the same number: a wrapped button could match by accident.
  expect(b!.y).toBeCloseTo(i!.y, 0);
});

// The same input-vs-button mismatch, second occurrence: the right rail's Access ▸
// Channels panel pairs the same .chan-input with its own accent button (AccessSection's
// BTN_ACCENT, py-1.5 → 30px vs the input's 33.5px). Different file, separately
// hand-tuned padding, identical cause. Grepping for the pair is how it was found —
// so the second one is pinned here rather than left to be re-reported later.
test("Access ▸ Channels: the Add button matches its input's height too", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Draft the launch note").first().click();
  await page.getByTestId("access-toggle").click();
  await page.getByRole("button", { name: /Channels · 0/ }).click();

  const input = page.getByPlaceholder("slack:C0123 or channel link");
  const button = page.getByRole("button", { name: "Add", exact: true });
  await expect(input).toBeVisible();

  const i = await input.boundingBox();
  const b = await button.boundingBox();
  expect(i).not.toBeNull();
  expect(b).not.toBeNull();

  expect(b!.height).toBeCloseTo(i!.height, 0);
  expect(b!.y).toBeCloseTo(i!.y, 0);
});

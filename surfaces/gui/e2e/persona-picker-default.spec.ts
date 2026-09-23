import { test, expect } from "./fixtures";

// Marlo（owner 2026-09-23）：新装的 Marlo 选择器里只有 Marlo 一个同事 —— 工程 / 安全类
// 同事默认关（后端 MARLO_ENGINEERING_PERSONAS）。只有一个可选时，同事按钮根本不出现。
// 共用夹具模拟的是「用户开过安全 / Ops 同事」的状态，这里改回出厂默认。

const MARLO = {
  id: "cowork", name: "Marlo", icon: "cowork", tagline: "Produce a deliverable",
  requires_folder: false, builtin: true, tools: ["files"], enabled: true, surfaced: true,
  default: true, ships: true, group: "general",
};
const SECURITY_OFF = {
  id: "security", name: "Security Coworker", icon: "shield", tagline: "Find and fix security issues",
  requires_folder: true, builtin: true, tools: ["code_files"], enabled: false, surfaced: false,
  default: false, ships: true, group: "security",
};

test("a fresh install shows no coworker picker — Marlo is the only one", async ({ page }) => {
  await page.route("**/v1/personas", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { personas: [MARLO, SECURITY_OFF] } })
      : route.fallback(),
  );
  await page.goto("/");
  await expect(page.getByTestId("setup-row")).toBeVisible();
  await expect(page.getByTestId("coworker-chip")).toHaveCount(0);
});

test("with a second coworker turned on, the picker is back and the default reads Marlo", async ({ page }) => {
  await page.goto("/"); // the shared fixture: Security + Ops enabled
  const chip = page.getByTestId("coworker-chip");
  await expect(chip).toHaveText(/Marlo/);
  await chip.click();
  await expect(page.getByText("Security Coworker")).toBeVisible();
});

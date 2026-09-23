import { test, expect, seedMachines } from "./fixtures";

// Marlo 默认藏起远程机器（flags.showMachines，owner 2026-09-23 合上游时定的）：
// 用户不跑无界面的机器，「哪台机器？」是一个他答不上来的问题。
// 就算注册表里真有一台，设置里也不出现机器选择器和「机器」清单页。
// fixtures 为上游的机器 spec 把开关打开了，这里用 ocw-e2e-machines-default 退出那个默认。

const BOX = {
  id: "m1",
  name: "hetzner-box",
  fingerprint: "8aaaac6fdc97e081",
  app_version: "0.2.0",
  created_at: 1_755_000_000,
  last_seen: 1_755_000_000,
  connected: true,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ocw-e2e-machines-default", "1");
    localStorage.removeItem("marlo.flag.machines");
  });
});

test("by default Settings has no machine picker and no Machines page", async ({ page }) => {
  await seedMachines(page, [BOX]);
  await page.goto("/#/settings/models");
  await expect(page.getByRole("heading", { name: "Models & Keys" })).toBeVisible();
  await expect(page.getByTestId("machine-scope-picker")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Machines", exact: true })).toHaveCount(0);
});

test("a #/settings/machines link lands on General instead of the hidden page", async ({ page }) => {
  await page.goto("/#/settings/machines");
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
});

// 对话里就地授权 —— 这份计划的主路径。
//
// 连接器页不是主路径：一般用户在聊天里一步步推进，推到需要他的邮箱时，
// Marlo 该【就地】要。这条用例验的就是那一下。
import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("要授权时卡片就地出现，并写明中转方", async ({ page }) => {
  await page.goto("/");
  const box = page.getByPlaceholder(/Ask the coworker/);
  await box.fill("帮我看看上周的邮件");
  await page.getByRole("button", { name: "Send" }).click();

  const card = page.getByTestId("connector-request");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("Outlook");
  await expect(card).toContainText("读你上周的邮件");

  // 中转方必须在用户点头【之前】就写出来。
  await expect(page.getByTestId("connector-broker")).toContainText("OpenWorker Cloud");

  // 拒绝和同意一样容易找到。
  await expect(page.getByTestId("connector-decline")).toBeVisible();
});

test("点连接后按钮变成等待态，防止开出第二个授权流程", async ({ page }) => {
  await page.goto("/");
  const box = page.getByPlaceholder(/Ask the coworker/);
  await box.fill("看看邮件");
  await page.getByRole("button", { name: "Send" }).click();

  const connect = page.getByTestId("connector-connect");
  await expect(connect).toBeVisible({ timeout: 10_000 });
  await connect.click();
  await expect(connect).toBeDisabled();
});

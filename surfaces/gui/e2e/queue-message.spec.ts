// owner-hit 2026-09-16：一轮还在跑的时候输入框照样能打字，打完按回车 —— 什么都
// 没发生。submit() 开头 `props.running && !props.gateOpen` 直接 return，发送键那会儿
// 还被「停止」占着。没提示、没排队、没报错，一整句话就这么没了。
//
// 现在：排队。这条 e2e 走真实的应用外壳（慢速的 "stream the epic" 回合 + 脚本化的
// 假 agent），因为组件测试证明不了的恰恰是最要紧的那一环 —— 回合真的结束时，排队
// 的那句【真的】作为一条普通用户消息发了出去。
import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("mid-turn Enter queues the message and it goes out when the turn ends", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Draft the launch note").first().click();

  const box = page.getByPlaceholder(/Ask the coworker/);
  await box.fill("stream the epic");
  await box.press("Enter");

  // 回合真的在跑：停止键在，流在往外吐。
  await expect(page.getByRole("button", { name: /Stop/ })).toBeVisible();
  await expect(page.getByText("The epic scrolls ever onward").first()).toBeVisible({
    timeout: 10_000,
  });

  // 中途打一整句话并按回车 —— 这正是 owner 做的那一下。
  await box.fill("and then summarise it in three bullets");
  await box.press("Enter");

  // 立刻看得见它去哪了：草稿被收进一张排队卡片，卡片上有原话、有取消，
  // 「停止」还在（这一轮仍然停得下来）。
  const chip = page.getByTestId("queued-message");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("and then summarise it in three bullets");
  await expect(chip).toContainText("Sends when this reply finishes");
  await expect(box).toHaveValue("");
  await expect(page.getByRole("button", { name: /Stop/ })).toBeVisible();
  // 排队 ≠ 发出去：这一轮还没结束，服务端不该收到它。
  await expect(page.getByText("Echo: and then summarise it")).toHaveCount(0);

  // 这一轮结束…
  await expect(page.getByText("The epic concludes.").first()).toBeVisible({ timeout: 15_000 });

  // …排队的那句作为一条普通的用户消息发了出去，卡片随之消失。
  await expect(page.getByText("Echo: and then summarise it in three bullets", { exact: false }).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("queued-message")).toHaveCount(0);
});

import { test, expect } from "./fixtures";

// 用话回答卡片（owner 2026-09-23）：用户平时是说话，只有授权才点一下。卡片等着时，
// 「好」= 同意、「不用」= 拒绝、别的话 = 拒绝并把原话交给 Marlo。
// 例外：删了 / 付了就收不回来的操作（tap_only）只认按钮。

async function say(page: import("@playwright/test").Page, text: string) {
  // 对话输入框（文件夹卡片自己也有一个路径输入框，别选错）。
  const box = page.getByRole("textbox", { name: /说说你要什么/ });
  await box.fill(text);
  await box.press("Enter");
  return box;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("marlo.locale", "zh"));
  await page.goto("/");
});

test("approval: saying 「发吧」 approves it", async ({ page }) => {
  const box = await say(page, "把汇报发给张总");
  await expect(box).toHaveAttribute("placeholder", /说「好」或「不用」/);
  await say(page, "发吧");
  await expect(page.getByText("Done via send_message [decision=once]")).toBeVisible();
});

test("approval: anything else declines and Marlo gets the words", async ({ page }) => {
  await say(page, "把汇报发给张总");
  await say(page, "把第二段改一下再发");
  await expect(page.getByText("Understood — skipped it. 你说：把第二段改一下再发")).toBeVisible();
});

test("approval that can't be undone: talking doesn't count, the button does", async ({ page }) => {
  const box = await say(page, "删掉旧报销");
  await expect(box).toHaveAttribute("placeholder", /点上面的按钮/);
  // 收不回来的操作没有长期授权：只有「只允许这一次」和「拒绝」。
  await expect(page.getByTestId("approval-tap-only")).toBeVisible();
  await expect(page.getByRole("button", { name: /始终允许|本次会话/ })).toHaveCount(0);
  await say(page, "删吧");
  await expect(page.getByText("这一步删了 / 付了就收不回来，请点上面卡片的按钮确认。")).toBeVisible();
  // Nothing was sent to the server: the command did not run and the card is still there.
  await expect(page.getByText("The command ran; 1 file found.")).toHaveCount(0);
  await page.getByRole("button", { name: /允许|Allow/ }).first().click();
  await expect(page.getByText("The command ran; 1 file found.")).toBeVisible();
});

test("folder access: saying 「可以」 grants the folder the card asked for", async ({ page }) => {
  await say(page, "看看报销文件夹");
  await say(page, "可以");
  await expect(page.getByText("可以读了：/Users/me/Desktop/报销")).toBeVisible();
});

test("connect an account: saying 「先不用」 declines", async ({ page }) => {
  await say(page, "帮我看看上周的邮件");
  await expect(page.getByTestId("connector-request")).toBeVisible();
  await say(page, "先不用");
  await expect(page.getByText("好，先不连。")).toBeVisible();
});

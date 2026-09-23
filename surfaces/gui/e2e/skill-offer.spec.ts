import { test, expect } from "./fixtures";

// Marlo 缺一个技能时先问「要不要装」（owner 2026-09-23）。用户平时是说话，只有授权
// 才点一下 —— 所以卡片等待时，直接打「好，装吧」「先不用」也算回答；别的话原样交给
// Marlo。卡片上是模型写的人话（「PPT 制作」），目录 id（pptx）不上屏。

async function ask(page: import("@playwright/test").Page) {
  await page.addInitScript(() => localStorage.setItem("marlo.locale", "zh"));
  await page.goto("/");
  const box = page.getByRole("textbox").first();
  await box.fill("帮我做一个季度汇报");
  await box.press("Enter");
  const card = page.getByTestId("skilloffer-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("skilloffer-title")).toHaveText("PPT 制作");
  await expect(card).toContainText("把你的内容排成一份像样的季度汇报 PPT");
  await expect(card).not.toContainText("pptx");
  // 输入框告诉用户：直接说就行。
  await expect(box).toHaveAttribute("placeholder", /装吧/);
  return { box, card };
}

test("tapping Install installs and the work carries on", async ({ page }) => {
  const { card } = await ask(page);
  await card.getByTestId("skilloffer-install").click();
  await expect(page.getByText("技能装好了，开始做 PPT。")).toBeVisible();
  await expect(page.getByTestId("skilloffer-card")).toHaveCount(0);
});

test("saying 「好，装吧」 is the same as tapping Install", async ({ page }) => {
  const { box } = await ask(page);
  await box.fill("好，装吧");
  await box.press("Enter");
  await expect(page.getByText("技能装好了，开始做 PPT。")).toBeVisible();
  await expect(page.getByTestId("skilloffer-card")).toHaveCount(0);
});

test("saying 「先不用」 declines", async ({ page }) => {
  const { box } = await ask(page);
  await box.fill("先不用");
  await box.press("Enter");
  await expect(page.getByText("好，先不装，我用现有的办法做。")).toBeVisible();
});

test("anything else is not a yes — the card closes and Marlo gets the words", async ({ page }) => {
  const { box } = await ask(page);
  await box.fill("好是好，但我想先看看它能干嘛");
  await box.press("Enter");
  await expect(page.getByText("没装。你说：好是好，但我想先看看它能干嘛")).toBeVisible();
  await expect(page.getByTestId("skilloffer-card")).toHaveCount(0);
});

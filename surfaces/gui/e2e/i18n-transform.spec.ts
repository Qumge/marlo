import { test, expect } from "./fixtures";

// 构建期 i18n transform 的端到端证明。
//
// 这条测试要回答的问题只有一个：源码里写着裸英文（和上游一模一样），中文界面上
// 显示的是不是中文？如果不是，整个方案就是空的 —— 它减少的冲突再多也没用。
//
// 被测的字符串故意挑【源码里现在是裸英文字面量】的：
//   Composer.tsx 里 title="Attach"、aria-label="Send"、<span>No model</span>
// 它们不经过 t("key")，只经过 vite.config.ts 的 i18nText + i18n/zh-text.ts。

async function inChinese(page: import("@playwright/test").Page) {
  // tx() 在渲染时读 getLocale()，而 getLocale 在模块加载时定一次 —— 所以语言要在
  // 首次导航【之前】就位。addInitScript 在页面脚本之前跑。
  await page.addInitScript(() => localStorage.setItem("marlo.locale", "zh"));
}

test("裸英文的属性，在中文界面上渲染成中文", async ({ page }) => {
  await inChinese(page);
  await page.goto("/");
  await page.getByText("Draft the launch note").first().click();

  // 源码：title="Attach" / aria-label="Attach"（Composer.tsx，无 t()）
  await expect(page.getByRole("button", { name: "附件" })).toBeVisible();
  // 源码：aria-label="Send"
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
});

// 用量弹窗：它的标题全是 JSX 文本节点，而且源码里现在是裸英文。
async function openUsagePopover(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByText("Draft the launch note").first().click();
  // 这一条走的是 t("composerPlaceholder")（不在 JSX 文本位置，transform 够不到），
  // 所以中英文两套都要认 —— 正好说明两条路是并存的，不是互相替代。
  const box = page.getByPlaceholder(/Ask the coworker|说说你要什么/);
  await box.fill("hello");
  await box.press("Enter");
  const chip = page.getByTestId("usage-chip");
  await expect(chip).toBeVisible({ timeout: 10_000 });
  await chip.click();
  return page.getByTestId("usage-popover");
}

test("裸英文的 JSX 文本节点，同样", async ({ page }) => {
  await inChinese(page);
  const pop = await openUsagePopover(page);
  // 源码：<div …>Context window</div>、<div …>Session totals</div>（均无 t()）
  await expect(pop).toContainText("上下文窗口");
  await expect(pop).toContainText("本次会话合计");
  await expect(pop).not.toContainText("Session totals");
});

test("英文界面拿到的仍然是原文 —— tx 查不到就回退，不是空白", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("marlo.locale", "en"));
  const pop = await openUsagePopover(page);
  await expect(pop).toContainText("Context window");
  await expect(pop).toContainText("Session totals");
  await expect(page.getByRole("button", { name: "Attach" })).toBeVisible();
});

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

// JSX 文本节点：模型清单里默认模型那枚徽章。源码 ModelChecklist.tsx 里是裸英文
// <span className="mlist-default">default</span>（无 t()）。
// Marlo：原来用的是用量弹窗，上游 2026-09 把用量 chip 改成默认不显示，换一个一定渲染的节点。
async function defaultBadge(page: import("@playwright/test").Page) {
  await page.goto("/#/settings/models");
  const badge = page.locator(".mlist-default").first();
  await expect(badge).toBeVisible({ timeout: 10_000 });
  return badge;
}

test("裸英文的 JSX 文本节点，同样", async ({ page }) => {
  await inChinese(page);
  const badge = await defaultBadge(page);
  await expect(badge).toHaveText("默认");
});

test("英文界面拿到的仍然是原文 —— tx 查不到就回退，不是空白", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("marlo.locale", "en"));
  const badge = await defaultBadge(page);
  await expect(badge).toHaveText("default");
  await page.goto("/");
  await page.getByText("Draft the launch note").first().click();
  await expect(page.getByRole("button", { name: "Attach" })).toBeVisible();
});

// 回填之后的抽查：这些原文分布在不同文件、不同形状（整句、碎片、带符号前缀），
// 而且【源码里全是裸英文】。抽查而不是全查：全查 252 条等于把 zh-text.ts 抄一遍，
// 那只证明表等于表自己。这里证的是"表里的东西真的走到了屏幕上"。
test("回填的译文真的渲染出来（抽查几个不同形状）", async ({ page }) => {
  await inChinese(page);
  await page.goto("/");
  await page.getByText("Draft the launch note").first().click();

  await page.getByTestId("access-toggle").click();
  const rail = page.getByTestId("access-section");
  // 上游把这一段重排了：「关闭仅静音本次会话」那句现在是每个连接器行上的 tooltip，
  // 不在摘要里。抽查改成摘要里【一定渲染】的三种形状：
  //   整句（"Access"）、带符号前缀（"+ Add a source…"）、和拼接出来的路径行。
  await expect(rail).toContainText("访问权限");
  await expect(rail).toContainText("添加来源");
  await expect(rail).toContainText("临时文件夹");
  await expect(rail).not.toContainText("Add a source");
});

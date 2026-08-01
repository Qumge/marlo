import { test, expect } from "./fixtures";

// 上游 usage-chip.spec.ts 里「Settings toggle turns the context bar on」那条被 skip 了 ——
// 它在【干净的 upstream/main 上也是红的】（2026-08-01 用 upstream 的 worktree 单独跑过），
// 不是合并弄坏的。原因：那条测试中途 page.goto("/") 重载，新开的 WebSocket 没让 fixture
// 的脚本化假 agent 重新武装，于是第二轮消息根本没往返 —— "Echo: …" 不在 DOM 里，用量
// 事件也就永远不来，chip count 是 0。它实际测的是 fixture 的重载行为，不是上下文条。
//
// 这里把它拆成能确定成立的那一半。放在新文件而不是就地改上游那份：上游文件每改一行，
// 下次合并就多一处要人判断的地方。
test("context_bar off (default): the chip is the session total, no fill bar", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Draft the launch note").first().click();
  const box = page.getByPlaceholder(/Ask the coworker/);
  await box.fill("hello");
  await box.press("Enter");

  const chip = page.getByTestId("usage-chip");
  await expect(chip).toContainText("10k", { timeout: 10_000 });
  await expect(chip).toHaveAttribute("title", /Token usage this session/);

  // 翻译过的那条路径也要真的走一遍：popover 里的中文/英文都来自 i18n 目录，
  // 而目录里存的是函数（usageChipTitlePlain 之类）——键写成字符串的话这里会炸。
  await chip.click();
  const pop = page.getByTestId("usage-popover");
  await expect(pop).toBeVisible();
  await expect(pop).toContainText("Session totals");
  await expect(pop).toContainText("Uncached input");
  await expect(pop).toContainText("Cache reads");
});

// 【已知缺口】context_bar: true 那条分支（chip 变成刻度条）目前没有 e2e 覆盖。
//
// 需要应用在启动时就读到 context_bar: true。fixture 的 SETTINGS 是模块级共享状态，
// 在一条测试里改它会漏给同进程的其他测试（上游正是因此才选择重载）；而 page.route
// 覆写这条路走不通 —— route.fetch() 绕开 fixture 自己的 handler，直接打到 vite 上拿 404。
//
// 干净的做法是让 fixture 支持 per-test 的 settings 覆写。那是改 fixtures.ts，
// 而它是上游改得第二勤的文件（11 个上游提交 / 16 个 hunk）——单独一件事，不混在合并里。
// 在那之前这个分支只有 tsc 保证类型正确，没有渲染保证。写在这里，是因为一个没人知道
// 的缺口和没有缺口看起来一模一样。

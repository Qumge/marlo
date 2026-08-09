import { expect } from "@playwright/test";
import { test } from "./fixtures"; // 【必须】从这里拿 test —— 它带 mockApi，裸 Playwright 的 test 没有任何路由
import { qumgeAccountRoute } from "./fixtures.qumge";

test("零余额 → 拦住 → 充值 → 解锁 → 可发，全程草稿不丢", async ({ page }) => {
  // 【顺序要紧】：mockApi 在 test fixture 里注册了 `**/v1/**` catch-all。
  // Playwright 是后注册的路由先匹配，所以这个覆盖必须在【测试体内】装（那时
  // fixture 已经跑完），且必须在 goto 之前。装在 fixture 之前会被 catch-all
  // 吃掉，于是拿到默认的 $19.12 余额，症状是「topup-card 不出现」——一个和
  // 真正原因毫无关系的报错。
  const account = qumgeAccountRoute(page);
  await account.install();

  await page.goto("/");
  await page.getByText("Draft the launch note").first().click(); // 先进一个会话，composer 才可用

  const box = page.getByPlaceholder(/Ask the coworker/);

  // 【守住 App.tsx:1638-1640 那一行】canSpend={isQumgeModel(model) ? balance.can_spend
  // : undefined} —— 只在 isQumgeModel(model) 为真时才把 canSpend 接到账号余额上。这是
  // 保护自带 key 用户的唯一一行：没有它，一个用自己 OpenAI/Anthropic key 的人只要恰好
  // 也挂着一个余额 $0 的 Qumge 账号，发消息就会被一个跟他这次请求毫无关系的余额拦住。
  //
  // 种子会话此刻还停在 anthropic:claude-opus-4-8（非 qumge:），零余额路由也已经装好
  // （见上面的 account.install()）——这正是验证「非 Qumge 模型不看 Qumge 余额」的唯一
  // 窗口：往下几行一旦切成 qumge:openai/gpt-5.6-sol，这个窗口就永久关闭了。
  const nonQumgeDraft = "非 qumge 模型不该被这个余额拦住";
  await box.fill(nonQumgeDraft);
  await box.press("Enter");
  await expect(page.getByTestId("topup-card")).toHaveCount(0);
  await expect(box).toHaveValue(""); // 清空 = 真的发出去了，不是被闸门吞掉

  // 【选择器落差】：种子会话的模型是 anthropic:claude-opus-4-8（非 qumge:）。
  // App.tsx 只在 isQumgeModel(model) 为真时才把 canSpend 接到账号余额上——
  // 这是故意的（自带 key 的用户不该被 Qumge 的余额拦住），但也意味着不切模型
  // 这条 spec 就摸不到闸门，跟余额多少无关。切到 fixtures 里已经种好的
  // qumge:openai/gpt-5.6-sol，闸门才会读到下面这个账号路由。
  const picker = page.locator(".dd").filter({ hasText: "Claude Opus 4.8" });
  await picker.locator(".pill").click();
  await page.locator(".dd-item").filter({ hasText: "openai/gpt-5.6-sol" }).click();

  const draft = "帮我把这个文件夹里的发票按月分组";
  await box.fill(draft);
  await box.press("Enter");

  // 拦住了，而且草稿还在
  await expect(page.getByTestId("topup-card")).toBeVisible();
  await expect(box).toHaveValue(draft);

  // 用户去浏览器充了 $0.50 —— 【这个数字是这条 spec 的全部价值所在】。
  //
  // 0.5 美元让 low 仍然是 true（阈值是 $1）而 can_spend 翻成 true。两个标志
  // 在这里【分叉】。如果充成 $5，两个标志一起翻，那么一个读 `low` 而不是
  // `can_spend` 的闸门照样全绿 —— 这条 spec 就退化成装饰。
  //
  // Task 1 的 review 已经在单测层面抓过一模一样的缺陷（见 progress.md）。
  // 这里是它在 e2e 层面的同一个坑，而这条 spec 恰恰是给其余八个 task 背书的。
  account.topUp(500_000);

  // 卡片自己消失（focus / 5 秒快轮询），不需要用户再点什么
  await expect(page.getByTestId("topup-card")).toBeHidden({ timeout: 15_000 });
  await expect(box).toHaveValue(draft);

  // 【不自动发送】—— 由用户自己按回车
  await box.press("Enter");
  await expect(box).toHaveValue("");
});

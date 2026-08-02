import { test, expect } from "./fixtures";

// 技能页 —— 账号菜单 ▸ 技能，唯一的一页。
//
// 2026-08-02 之前这里是两页：账号菜单的「能力」和设置里的「技能」，打的是同一个
// GET /v1/skills。这条测试盯着合并之后的两件事：目录不用点菜单就在页面上，以及
// 「移除」真的能移除（那个按钮以前打的是后端不存在的路由，点了等于没点）。

const openSkills = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.getByTestId("account-row").click();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
};

test("skills: 已装列表和目录在同一页上，不用先点菜单", async ({ page }) => {
  await openSkills(page);

  // 上半页：装了的（fixtures 种了两条）。
  await expect(page.getByTestId("skill-weekly-report")).toBeVisible();
  await expect(page.getByTestId("skill-html-to-markdown")).toBeVisible();

  // 下半页：目录常驻 —— 0e1b2a0 定过，没搜索时也要有列表。
  await expect(page.getByTestId("skills-search")).toBeVisible();
  // 【要断言到条目，不能只断言输入框】只看输入框的话，一个搜索坏掉、目录永远渲染
  // 「没搜到」的界面照样能让这条绿 —— 而规格的招牌主张是"目录就在这一页上"，讲的
  // 是里面有东西，不是有个框。（这一段以前是虚的：fixtures 缺 /v1/skills/search
  // 分支，目录一直落到兜底的 json({})。最终评审 Minor #8。）
  await expect(page.getByTestId("skills-results")).toBeVisible();
  await expect(page.getByTestId("catalog-invoice-chaser")).toBeVisible();
  await expect(page.getByTestId("catalog-meeting-notes")).toBeVisible();
  await expect(page.getByText("Draft a polite follow-up for every unpaid invoice.")).toBeVisible();
  // 我们审过的单独一组排最前 —— 那是它们相对于四千条第三方技能的唯一区别。
  // exact: true 是必须的：getByText 默认是【大小写不敏感的子串】匹配，而条目自己的
  // meta 里写着 "vetted by qumge · first-party"，不加就是两个命中直接 strict 报错。
  await expect(page.getByText("Vetted by Qumge", { exact: true })).toBeVisible();
  // 没输入任何东西就有结果：空 q 是【浏览】，不是"不搜"。
  await expect(page.getByTestId("skills-search")).toHaveValue("");
  // 目录里的没装过，所以给的是「添加」；已装的那两条不在目录结果里。
  await expect(page.getByTestId("install-invoice-chaser")).toBeVisible();

  // 「添加」菜单剩三个门，第四个（浏览目录）没了 —— 目录就在下面。
  await page.getByRole("button", { name: /Add skill/ }).click();
  await expect(page.getByText("Write it myself")).toBeVisible();
  await expect(page.getByText("Import a file")).toBeVisible();
  await expect(page.getByText("Create with Marlo")).toBeVisible();
  await expect(page.getByTestId("skills-browse-catalog")).toHaveCount(0);
});

test("skills: 点移除，技能真的没了", async ({ page }) => {
  // 【这条以前是不可能过的】移除打的是 POST /v1/skills/uninstall，后端没有
  // 这个路由，错误被吞掉，列表一刷新技能又回来。
  await openSkills(page);
  await expect(page.getByTestId("skill-weekly-report")).toBeVisible();

  // 两步删除：第一下上膛，第二下才真删。
  await page.getByTestId("remove-weekly-report").click();
  await expect(page.getByTestId("skill-weekly-report")).toBeVisible();
  await page.getByText("Confirm delete").click();

  await expect(page.getByTestId("skill-weekly-report")).toHaveCount(0);
});

test("skills: 设置里没有技能这一栏了", async ({ page }) => {
  // 一个词一个地方。设置里再出现「技能」就等于合并没做完。
  await page.goto("/");
  await page.getByTestId("account-row").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  // 先证明设置页【真的开了】—— 只断言 count(0) 的话，设置压根没打开这条也会绿，
  // 那就成了一条永远通过的测试（brief 给的原稿少这一句，自查时补的）。
  await expect(page.getByRole("button", { name: "General", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Voice input", exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: "Skills", exact: true })).toHaveCount(0);
});

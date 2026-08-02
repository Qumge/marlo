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

  // 下半页：目录搜索框常驻 —— 0e1b2a0 定过，没搜索时也要有列表。
  await expect(page.getByTestId("skills-search")).toBeVisible();

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

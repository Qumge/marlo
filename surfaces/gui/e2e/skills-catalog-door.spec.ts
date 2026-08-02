import { test, expect } from "./fixtures";

// 设置 ▸ 技能 ▸「添加技能」里的第四个门：浏览 Qumge 目录。
//
// 【为什么要有这个门】2026-08-02 合上游 Skills 子系统时定的分层：上游管【仓库】
// （增删改、作用域、上传、启用禁用），我们管【货源】（qumge.com 上 4500+ 条公开
// 技能）。两件事不重叠 —— 但用户不该因此看见两个"技能"入口。所以货源挂进仓库的
// 添加菜单里，而不是并列两个 tab。
//
// 这条测试量的是【那条路真的通】：菜单里有这一项，点了到得了目录搜索页。一个点了
// 没反应的菜单项，比没有这一项更糟 —— 它承诺了一件做不到的事。

test("Add skill 菜单里有第四个门，点了落到能力页的目录搜索", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("account-row").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /Skills/ }).first().click();

  await page.getByRole("button", { name: /Add skill/ }).click();
  // 上游的三个门仍在 —— 我们是【加】一个，不是替换。
  await expect(page.getByText("Write it myself")).toBeVisible();
  await expect(page.getByText("Import a file")).toBeVisible();
  await expect(page.getByText("Create with Marlo")).toBeVisible();

  const door = page.getByTestId("skills-browse-catalog");
  await expect(door).toBeVisible();
  await expect(door).toBeEnabled(); // 没接上回调的话它是 disabled 的
  await door.click();

  // 落到能力页（qumge 目录的搜索/安装界面），不是又造一个。
  await expect(page.getByTestId("abilities-search")).toBeVisible();
});

// Left-nav polish (§20): collapse (⌘B / brand button → reveal button docks it back) and the
// RECENT-header group/filter popover (Group by Persona↔Chronological, Filter by coworker).
import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("collapse hides the sidebar and reclaims the width; reveal button docks it back", async ({
  page,
}) => {
  await page.goto("/");
  const app = page.locator(".app");
  await expect(page.locator(".sidebar")).toBeVisible();

  // Collapse via the brand button.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(app).toHaveClass(/nav-collapsed/);
  // The floating reveal affordance appears; clicking it docks the nav back.
  const reveal = page.getByRole("button", { name: "Show sidebar" });
  await expect(reveal).toBeVisible();
  await reveal.click();
  await expect(app).not.toHaveClass(/nav-collapsed/);
});

test("⌘B toggles the sidebar collapse", async ({ page }) => {
  await page.goto("/");
  const app = page.locator(".app");
  // 等 app 真的挂上来再按键。上游这一行也没有，而 ⌘B 的监听器是 App 的 useEffect
  // 注册的：goto 之后立刻按键有可能落在注册之前。i18n 初始化把首屏渲染推后一拍
  // （main.tsx 的 initI18n().finally），这个本来就存在的竞态才稳定复现。
  // 上面那个用例等的也是它。
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.keyboard.press("Meta+b");
  await expect(app).toHaveClass(/nav-collapsed/);
  await page.keyboard.press("Meta+b");
  await expect(app).not.toHaveClass(/nav-collapsed/);
});

test("RECENT header group/filter popover: switch grouping + see coworker filters", async ({
  page,
}) => {
  await page.goto("/");
  const header = page.getByTestId("recent-header");
  await expect(header).toContainText("Recent");

  await header.getByRole("button", { name: "Group and filter conversations" }).click();
  const menu = page.getByTestId("group-filter-menu");
  await expect(menu).toContainText("Group by");
  await expect(menu).toContainText("Filter by coworker");

  // Switch to Chronological → the persona accordion collapses into a flat list (the "Marlo"
  // persona group header is no longer a row; sessions list directly).
  await menu.getByText("Chronological").click();
  await expect(menu.getByText("Chronological").locator("xpath=..")).toContainText("✓");

  // Filter-by-coworker checkboxes are present (none checked by default → all shown).
  await expect(menu).toContainText("None checked shows all.");
});

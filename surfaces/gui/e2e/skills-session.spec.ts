import { test, expect } from "./fixtures";

// SKILLS-SPEC §9 journey 2 — liveness from the session's seat: the composer's "/" popup is
// the live "what can my worker use right now" view. A skill created on the Skills page is
// offered; a disabled one vanishes. Hermetic: the popup reads /v1/sessions/{id}/skills from
// fixtures.
//
// 入口 2026-08-02 从「设置 ▸ 技能」换成「账号菜单 ▸ 技能」—— 那个 tab 没了。断言没动。

test("skills-session: new skill offered in '/', disabled one absent", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Draft the launch note").first().click();

  // The seeded menu: both enabled skills offered on "/".
  const box = page.getByPlaceholder(/Ask the coworker/);
  await box.fill("/");
  await expect(page.getByTestId("skill-popup")).toBeVisible();
  await expect(page.getByText("/weekly-report")).toBeVisible();
  await expect(page.getByText("/html-to-markdown")).toBeVisible();
  await box.fill(""); // close the popup

  // Skills-page round-trip: create one skill, disable another.
  await page.getByTestId("account-row").click();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.getByRole("button", { name: /Add skill/ }).click();
  await page.getByText("Write it myself").click();
  await page.getByLabel("Name").fill("fresh-skill");
  await page.getByLabel("Instructions").fill("Do the fresh thing.");
  await page.getByRole("button", { name: "Save skill" }).click();
  await expect(page.getByRole("status")).toContainText("fresh-skill");
  await page.getByLabel("weekly-report enabled").click();
  await expect(page.getByRole("status")).toContainText("turned off everywhere");

  // Back in the session: the popup reflects the new state — created offered, disabled gone.
  await page.getByText("Draft the launch note").first().click();
  await box.fill("/");
  await expect(page.getByTestId("skill-popup")).toBeVisible();
  await expect(page.getByText("/fresh-skill")).toBeVisible();
  await expect(page.getByText("/weekly-report")).toHaveCount(0);
  await expect(page.getByText("/html-to-markdown")).toBeVisible(); // untouched one persists
});

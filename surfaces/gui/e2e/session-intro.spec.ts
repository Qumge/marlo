// Start-screen template tasks (§27): three concrete rows, no icon tiles, no "Set me up" list.
// Sub-lines are outcome-voiced.
//
// Two of these rows used to be HubSpot and GitHub→Slack, gated on connectors whose
// "Configure ›" opened the connector sign-in. That sign-in is brokered by OpenWorker
// Cloud, a service this project does not run, so the step is hidden and the rows went
// with it — they invited people into a door that no longer opens. Every row now works
// with nothing but a folder, which means no row is ever gated and "Configure ›" is gone
// from this screen entirely.
import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("three rows, none of them gated behind a connector", async ({ page }) => {
  await page.goto("/");
  // 断言【行为】而不是字面文案：开场是一个可见的问句。原来这里写死了
  // "What should we produce?"，换一次文案就红一次——而文案是会换的。
  const greeting = page.locator("h1.greeting");
  await expect(greeting).toBeVisible();
  await expect(greeting).toContainText("?");

  await expect(page.locator(".task-card")).toHaveCount(3);
  await expect(page.getByText("Set me up (optional)")).toHaveCount(0);
  await expect(page.getByText("Give me access to a folder")).toHaveCount(0);

  // The connector rows are gone, not merely renamed.
  await expect(page.getByTestId("intro-task-hubspot")).toHaveCount(0);
  await expect(page.getByTestId("intro-task-github-slack")).toHaveCount(0);
  // And with them the only thing on this screen that led to the hidden step.
  await expect(page.getByText("Configure ›")).toHaveCount(0);

  await expect(page.getByTestId("intro-task-write")).toContainText("Start →");
  await expect(page.getByTestId("intro-task-tidy")).toContainText("Start →");
});

test("a folder task prefills the composer with its own prompt", async ({ page }) => {
  await page.goto("/");

  const write = page.getByTestId("intro-task-write");
  await expect(write).toContainText("Write one document from a folder of files");
  await write.click();
  await expect(page.getByPlaceholder(/Ask the coworker/)).toHaveValue(/write me one document/);

  const tidy = page.getByTestId("intro-task-tidy");
  await tidy.click();
  await expect(page.getByPlaceholder(/Ask the coworker/)).toHaveValue(/rename and organise/);
});

test("folder task opens the inline add-folder form; adding a folder prefills the composer", async ({
  page,
}) => {
  await page.goto("/");

  // No shared folder yet (the fixture root is the primary scratch) → the row expands the form.
  await page.getByTestId("intro-task-folder").click();
  const path = page.getByPlaceholder("Choose or paste a folder path…");
  await expect(path).toBeVisible();
  await path.fill("/Users/me/Reports");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByPlaceholder(/Ask the coworker/)).toHaveValue(
    /Analyze the files in this folder/,
  );
});

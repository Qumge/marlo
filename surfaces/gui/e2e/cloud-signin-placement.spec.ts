// Regression guard (shipped once, 2026-07-09): sign-in must be reachable by a
// FRESH user — never below a fold, never a hint pointing at another page.
//
// The guard's subject changed on 2026-07-27, because what a fresh user needs to
// sign in to changed. The sidebar account row was the permanent home for
// OpenWorker CLOUD sign-in; it now belongs to the QUMGE account, which is the
// one that pays for the models and the one the user is actually signed in to.
// Cloud sign-in moved onto the panes that need it, where naming a third party
// says something true about who will hold the token.
//
// So the guard is now two claims, one per account:
//   - Qumge sign-in is reachable from the account row, in the running app —
//     not only from onboarding, which is where it used to live and nowhere else.
//   - Cloud sign-in is reachable from any signed-out one-click pane, inline.
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { QUMGE_STATE } from "./fixtures.qumge";

async function openConnectors(page) {
  await page.goto("/");
  await page.getByTestId("account-row").click();
  await page.getByTestId("account-menu").getByRole("button", { name: "Connectors", exact: true }).click();
}

test("a signed-out user can sign in to Qumge from the account row", async ({ page }) => {
  // Without this the sign-out in that same menu would be a one-way door: the
  // device flow lived in onboarding and nowhere else.
  Object.assign(QUMGE_STATE, { signed_in: false, email: null, balance: null });

  await page.goto("/");
  const row = page.getByTestId("account-row");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Not signed in");

  await row.click();
  await page.getByTestId("account-sign-in").click();
  await expect(page.getByTestId("qumge-signin-modal")).toBeVisible();
  await expect(page.getByTestId("qumge-connect-start")).toBeVisible();
});

test("the account row is always visible, and carries sign-out once signed in", async ({ page }) => {
  await page.goto("/");
  const row = page.getByTestId("account-row");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Someone");

  await row.click();
  await expect(
    page.getByTestId("account-menu").getByRole("button", { name: "Sign out" }),
  ).toBeVisible();
});

test("signed-out one-click pane signs in inline, then connects", async ({ page }) => {
  await openConnectors(page);
  // Fresh user path: Available → Connect → the pane must offer sign-in itself.
  await page
    .getByTestId("connector-gmail")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await page.getByTestId("inline-cloud-sign-in").click();
  // The mock signs in instantly; the section's poll re-renders the pane armed.
  await expect(
    page.getByRole("button", { name: /Connect Gmail with one click/i }),
  ).toBeVisible({ timeout: 10_000 });
});

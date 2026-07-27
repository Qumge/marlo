// Managed one-click connectors, and where their sign-in lives.
//
// Product invariant under test: manual token setup is always present; managed
// one-click is an ADDITION that appears only when signed in to OpenWorker Cloud.
//
// What moved (2026-07-27): the sidebar account row used to be the cloud's
// sign-in home. It is the QUMGE account's now — the account that pays for the
// models, and the one the user is actually signed in to. Cloud sign-in lives on
// the connector panes that need it, where naming a third party is a true
// statement about who will hold the token rather than a service a user has never
// heard of standing between them and their own balance.
import { expect } from "@playwright/test";
import { test } from "./fixtures";

async function openConnectors(page) {
  await page.goto("/");
  await page.getByTestId("account-row").click();
  await page.getByTestId("account-menu").getByRole("button", { name: "Connectors", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
}

/** Sign in to the cloud the way a user now does: from the pane that needs it. */
async function signInFromGmailPane(page) {
  await page.getByTestId("connector-gmail").getByRole("button", { name: "Connect", exact: true }).click();
  const modal = page.getByTestId("add-connection-modal");
  await modal.getByTestId("inline-cloud-sign-in").click();
  await expect(modal.getByTestId("inline-cloud-sign-in")).toHaveCount(0, { timeout: 10_000 });
  return modal;
}

test("signed out of the cloud: the connector pane offers its own sign-in, and manual still works", async ({
  page,
}) => {
  await openConnectors(page);

  // The managed-capable connector's add-modal shows the hint + manual fields, no
  // one-click button while signed out.
  await page.getByTestId("connector-gmail").getByRole("button", { name: "Connect" }).click();
  const modal = page.getByTestId("add-connection-modal");
  await expect(modal.getByTestId("managed-connect")).toContainText("Sign in to OpenWorker Cloud");
  await expect(modal.getByTestId("inline-cloud-sign-in")).toBeVisible();
  await expect(modal.locator("input[type=password]")).toBeVisible(); // manual field rendered
  await expect(modal.getByRole("button", { name: /one click/i })).toHaveCount(0);
});

test("signed in to the cloud: one-click appears alongside the manual path", async ({ page }) => {
  await openConnectors(page);
  const modal = await signInFromGmailPane(page);

  await expect(modal.getByRole("button", { name: /Connect Gmail with one click/i })).toBeVisible();
  // the manual path must still be offered alongside
  await expect(modal.getByTestId("managed-connect")).toContainText("or connect manually");
});

test("the account row and its menu are about Qumge, not the cloud", async ({ page }) => {
  // The reported bug: signed in to Qumge, balance rendering in this very row,
  // and the row said "Not signed in" because it was reporting a different
  // service. Assert on the absence of that word — a blanket rename is what put
  // three false statements into this app the last time it was touched.
  await page.goto("/");
  const row = page.getByTestId("account-row");
  await expect(row).toContainText("Someone");
  await expect(row).not.toContainText("Not signed in");
  await expect(row).toContainText("$19.12");

  await row.click();
  const menu = page.getByTestId("account-menu");
  await expect(menu.getByTestId("account-header")).toContainText("someone@example.com · Qumge");
  await expect(menu).not.toContainText("OpenWorker");
  await expect(menu.getByRole("button", { name: "Inbox" })).toBeVisible();
});

test("signing out ends the Qumge session the menu names", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("account-row").click();
  await page.getByTestId("account-menu").getByRole("button", { name: "Sign out" }).click();

  await expect(page.getByTestId("account-row")).toContainText("Not signed in", { timeout: 10_000 });
  // The credit went with the key — showing a stale figure for an account that is
  // no longer signed in is worse than showing none.
  await expect(page.getByTestId("balance-chip")).toHaveCount(0);
});

test("telemetry/Privacy card is gone from Settings (owner ask 2026-07-22), signed in or out", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("account-row").click();
  await page.getByTestId("account-menu").getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  await expect(page.getByTestId("telemetry-toggle")).toHaveCount(0);
  await expect(page.getByText("Privacy", { exact: true })).toHaveCount(0);
});

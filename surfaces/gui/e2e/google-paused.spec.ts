// Google one-click paused pending CASA verification (owner ask 2026-07-22): the managed
// button parks with a "Coming soon" badge — pre-connect modal AND the connected page's
// add-account — while the manual token path stays fully live. The shared fixture keeps
// gmail unpaused (the cloud-machinery specs use it as their one-click subject), so this
// spec overrides the connectors payload per test, like automations-quickstart does.
import { expect } from "@playwright/test";
import { test } from "./fixtures";

const GMAIL_BASE = {
  name: "gmail",
  title: "Gmail",
  icon: "✉",
  blurb: "Search, summarize, draft, and send email.",
  about: "Search, summarize, and send over your Gmail.",
  access: ["Reads and searches your mail."],
  auth: "oauth",
  two_way: false,
  channels: false,
  available: true,
  brand_color: "#ea4335",
  logo: "gmail",
  group: "mail",
  fields: [
    { key: "access_token", label: "OAuth access token", secret: true, required: true, help: "", placeholder: "" },
  ],
  instructions: [],
  account: null,
  allowed_users: [],
  tools: [],
  managed: true,
  managed_paused: true,
  managed_profile: false,
};

// Email (IMAP) 必须一起端上来：Gmail 那条"改用邮箱"的出路要打开它的连接框，
// 而列表里没有 email 的话，那个出路点了没反应 —— 假数据缺一个连接器，测的就
// 是一个不存在的后端。
const EMAIL_BASE = {
  name: "email",
  group: "mail",
  title: "Email (IMAP)",
  icon: "✉",
  blurb: "Read, search, and send mail from any IMAP account.",
  about: "",
  access: [],
  auth: "app_password",
  two_way: false,
  channels: false,
  available: true,
  brand_color: "",
  logo: "email",
  fields: [{ key: "address", label: "Email address", secret: false, required: true, help: "", placeholder: "you@gmail.com" }],
  instructions: ["Enter your email address first — the setup steps for your provider will appear."],
  connected: false,
  account: null,
  enabled: false,
  allowed_users: [],
  tools: [],
  managed: false,
  managed_profile: false,
};

async function serveGmail(page, extra: Record<string, unknown>) {
  await page.route("**/v1/connectors", (route) =>
    route.fulfill({
      json: {
        connectors: [
          { ...GMAIL_BASE, connected: false, enabled: false, ...extra },
          EMAIL_BASE,
        ],
      },
    }),
  );
}

async function openConnectors(page) {
  await page.goto("/");
  await page.getByTestId("account-row").click();
  await page.getByRole("button", { name: "Connectors", exact: true }).click();
}

test("paused one-click: the row points at IMAP instead of a dead Connect button", async ({
  page,
}) => {
  await serveGmail(page, {});
  await openConnectors(page);

  // 【行为已改，规格 D/E】：Gmail 只有 OAuth 一条路而那条正卡在上游审核里。
  // 之前它照常显示 Connect，点进去是一个 disabled 的「Coming soon」——正是规格
  // 说要避免的"灰按钮让人以为坏了"。现在列表里直接指向走得通的那条路。
  const row = page.getByTestId("connector-gmail");
  await expect(row.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);
  const hint = page.getByTestId("blocked-gmail");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("IMAP");

  // 点它直接开 Email(IMAP) 的连接框 —— 不是把人留在原地。
  await hint.click();
  await expect(page.getByText("Enter your email address first")).toBeVisible();
});

test("paused one-click: the manual token path is still reachable from the row", async ({
  page,
}) => {
  // 上面那条改的是【入口】，不是把手填那条路砍掉。高级用户点行进详情页仍然能
  // 粘 token —— 这正是原来那条测试真正在守的东西，保住它。
  await serveGmail(page, {});
  await openConnectors(page);
  // 行 → 详情页 → 详情页上的 Connect → 表单。列表里去掉的只是那个快捷小按钮，
  // 整条路没有被切断。
  await page.getByTestId("connector-gmail").click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("OAuth access token")).toBeVisible();
});

test("paused one-click: connected page's add-account is parked too", async ({ page }) => {
  await serveGmail(page, {
    connected: true,
    enabled: true,
    account: "rohit@gmail.com",
    accounts: [
      { email: "rohit@gmail.com", default: true, managed: true, scopes: "gmail", needs_reauth: false },
    ],
    filters: { senders: [], labels: [] },
  });
  await openConnectors(page);
  await page.getByTestId("connector-gmail").click();
  await expect(page.getByTestId("gmail-detail")).toBeVisible();

  const add = page.getByTestId("add-account-btn");
  await expect(add).toBeDisabled();
  await expect(add).toContainText("Coming soon");
  // Existing accounts keep working and stay manageable.
  await expect(page.getByTestId("gmail-account-rohit@gmail.com")).toContainText("Default");
});

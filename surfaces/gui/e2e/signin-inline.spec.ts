import { test, expect } from "./fixtures";
import { QUMGE_STATE, SETTINGS_OVERRIDE } from "./fixtures.qumge";

// 没登录就发送（owner 2026-09-23）：不再被带去一整页服务商设置（22 家 + API key），
// 而是在输入框上方就地一键登录 Qumge；那句话留着，登录好自动发出去。

test.beforeEach(async ({ page }) => {
  Object.assign(QUMGE_STATE, { signed_in: false, email: null, balance: null });
  SETTINGS_OVERRIDE.model_ready = false;
  let polls = 0;
  await page.route("**/v1/qumge/device/start", (r) =>
    r.fulfill({
      json: {
        user_code: "ABCD-1234",
        verification_uri: "https://qumge.com/device",
        verification_uri_complete: "https://qumge.com/device?user_code=ABCD-1234",
        interval: 1,
        expires_in: 600,
      },
    }),
  );
  await page.route("**/v1/qumge/device/poll", (r) => {
    polls += 1;
    if (polls < 2) return r.fulfill({ json: { status: "pending", interval: 1 } });
    // 用户在浏览器里点了同意：账号登上、模型就绪。
    Object.assign(QUMGE_STATE, { signed_in: true, email: "new@user.test" });
    SETTINGS_OVERRIDE.model_ready = true;
    return r.fulfill({ json: { status: "connected" } });
  });
  await page.addInitScript(() => localStorage.setItem("marlo.locale", "zh"));
});

test("sending before signing in opens an inline Qumge sign-in, then sends the message", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("textbox", { name: /说说你要什么/ });
  await box.fill("帮我写一份下周部门周会的通知");
  await box.press("Enter");

  const prompt = page.getByTestId("signin-prompt");
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("先登录 Qumge 就能开始");
  // Not the provider wall.
  await expect(page).not.toHaveURL(/#\/settings/);
  // The draft is kept while signing in.
  await expect(box).toHaveValue("帮我写一份下周部门周会的通知");

  await prompt.getByTestId("qumge-connect-start").click();
  await expect(prompt.getByTestId("qumge-user-code")).toHaveText("ABCD-1234");

  // Approved in the browser → the prompt goes away and the message goes out on its own.
  await expect(page.getByTestId("signin-prompt")).toHaveCount(0, { timeout: 10_000 });
  // 模拟服务端把收到的消息原样回显 —— 看到这句就说明它真的发出去了。
  await expect(page.getByText("Echo: 帮我写一份下周部门周会的通知", { exact: false })).toBeVisible();
  await expect(box).toHaveValue("");
});

test("bringing your own key is still one small link away", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("textbox", { name: /说说你要什么/ });
  await box.fill("你好");
  await box.press("Enter");
  await page.getByTestId("signin-own-key").click();
  await expect(page).toHaveURL(/#\/settings\/models/);
});

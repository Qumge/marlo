// 下载失败时，「连不上」和「你的代理没被用上」是两回事 —— 后者用户自己能解决。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tauri", () => ({ systemProxy: vi.fn() }));

import { systemProxy } from "./tauri";
import { setLocale } from "./i18n";
import { downloadHint } from "./voiceProxyHint";

// 默认 locale 是英文（ModelChecklist.test.tsx 的断言就是英文串）。这里断言中文，
// 所以显式设一下。
beforeEach(() => setLocale("zh"));
afterEach(() => vi.clearAllMocks());

describe("语音模型下载失败时的提示", () => {
  it("没探到代理时，多说一句怎么办", async () => {
    // 用户开着 VPN 却下载失败，看到的是一句 ureq 的英文原话。他没法从那句话知道
    // 问题出在"客户端是系统代理模式还是 TUN 模式"上。
    (systemProxy as any).mockResolvedValue(null);
    expect(await downloadHint()).toContain("系统代理");
  });

  it("探到了代理就不多嘴 —— 那时失败是别的原因", async () => {
    // 【否定对照】代理明明在用还说"没检测到代理"，会把人支到完全错误的方向去。
    (systemProxy as any).mockResolvedValue("http://127.0.0.1:7897");
    expect(await downloadHint()).toBe("");
  });

  it("问不出来时不瞎说", async () => {
    // 命令本身失败（浏览器构建里根本没有 Tauri、老版本的壳没注册这个命令）时，
    // 不能断言"没有代理"—— 那和"探到了"一样是在编造一个我们不知道的事实。
    (systemProxy as any).mockRejectedValue(new Error("unknown command"));
    expect(await downloadHint()).toBe("");
  });
});

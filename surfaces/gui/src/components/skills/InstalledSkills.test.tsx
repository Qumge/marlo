import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InstalledSkills } from "./InstalledSkills";
import { setLocale } from "../../i18n";

const ROWS = [
  { name: "weekly-report", description: "周一进度汇报", instructions: "x",
    scope: "global" as const, source: "local", enabled: true, path: "/s/weekly-report", files: 0 },
  { name: "html-to-markdown", description: "HTML 转 markdown", instructions: "y",
    scope: "global" as const, source: "uploaded", enabled: false, path: "/s/html-to-markdown", files: 2 },
];

beforeEach(() => setLocale("zh"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noop = () => {};

describe("已装技能列表", () => {
  it("关掉的那条要看得出是关的", () => {
    render(<InstalledSkills rows={ROWS} onEdit={noop} onChanged={noop} onNotice={noop} onError={noop} />);
    expect((screen.getByLabelText("html-to-markdown enabled") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("weekly-report enabled") as HTMLInputElement).checked).toBe(true);
  });

  it("带附件的技能要看得出来 —— 和单文件的长一样就等于藏了", () => {
    // §6：live drive 里纯文字藏掉了这个可点击的入口，所以做成带文件夹图标的 chip。
    render(<InstalledSkills rows={ROWS} onEdit={noop} onChanged={noop} onNotice={noop} onError={noop} />);
    // 断言改动（Task 6）：title 从写死的英文 "Show folder" 改成 t("skShowFolder")，
    // 这条测试跑在 zh 下（beforeEach setLocale("zh")），所以现在要按中文找。中文取
    // zh-text.ts 里线上一直在用的译文「打开所在文件夹」（评审 fix-up，见 task-6 报告）。
    expect(screen.getByTitle("打开所在文件夹").textContent).toContain("2 file");
  });

  it("删除要两步 —— 第一下只是上膛", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      calls.push(`${init?.method || "GET"} ${String(url).replace(/^https?:\/\/[^/]+/, "")}`);
      return { json: async () => ({ ok: true }) };
    }));
    const onChanged = vi.fn();
    render(<InstalledSkills rows={ROWS} onEdit={noop} onChanged={onChanged} onNotice={noop} onError={noop} />);

    fireEvent.click(screen.getByTestId("remove-weekly-report"));
    expect(calls).toEqual([]);            // 上膛不发请求

    fireEvent.click(screen.getByTestId("remove-weekly-report"));
    await waitFor(() => expect(calls).toContain("DELETE /v1/skills/weekly-report"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("开关改的是 enabled，且提示条点名是哪一条", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: any) => {
      if (init?.body) bodies.push(JSON.parse(init.body));
      return { json: async () => ({ ok: true }) };
    }));
    const onNotice = vi.fn();
    render(<InstalledSkills rows={ROWS} onEdit={noop} onChanged={noop} onNotice={onNotice} onError={noop} />);

    fireEvent.click(screen.getByLabelText("weekly-report enabled"));
    await waitFor(() => expect(bodies).toEqual([{ enabled: false }]));
    await waitFor(() =>
      expect(onNotice).toHaveBeenCalledWith(
        expect.objectContaining({ name: "weekly-report", tone: "warn" }),
      ),
    );
  });

  it("操作失败时先清掉旧提示 —— 不然上一条成功的横幅会跟这条错误并排挂着", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ ok: false, error: "boom" }) })));
    const onNotice = vi.fn();
    const onError = vi.fn();
    render(<InstalledSkills rows={ROWS} onEdit={noop} onChanged={noop} onNotice={onNotice} onError={onError} />);

    fireEvent.click(screen.getByTestId("remove-weekly-report")); // 上膛
    fireEvent.click(screen.getByTestId("remove-weekly-report")); // 发 DELETE，失败
    await waitFor(() => expect(onError).toHaveBeenCalledWith("boom"));
    expect(onNotice).toHaveBeenCalledWith(null);
  });
});

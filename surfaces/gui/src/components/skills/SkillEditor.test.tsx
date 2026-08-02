// 编辑「已有技能」保存成功不该弹提示 —— SKILLS-SPEC §4.1 #2 只在【新建】时承诺
// "之后每次对话它都能用了"；编辑是静默的，原版 SkillsTab.tsx 的 save() 就是
// `if (editor.mode === "new") setNotice(...)`。这条测试防的是回归：Task 4 拆分
// 时父层 SkillsTab 的 onSaved 一度无条件 setNotice，把这条区分吞掉了。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SkillEditor } from "./SkillEditor";
import { setLocale } from "../../i18n";

beforeEach(() => setLocale("zh"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noop = () => {};

describe("技能编辑表单", () => {
  it("编辑已有技能保存成功，onNotice 不该被调用", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ ok: true }) })));
    const onNotice = vi.fn();
    const onSaved = vi.fn();
    render(
      <SkillEditor
        draft={{ mode: "edit", name: "weekly-report", description: "d", instructions: "x" }}
        upload={null}
        onSaved={onSaved}
        onCancel={noop}
        onNotice={onNotice}
        onError={noop}
      />,
    );
    fireEvent.click(screen.getByText("Save skill"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onNotice).not.toHaveBeenCalledWith(expect.objectContaining({ tone: "ok" }));
  });

  it("对照组：新建技能保存成功，onNotice 该被调用", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ ok: true }) })));
    const onNotice = vi.fn();
    const onSaved = vi.fn();
    render(
      <SkillEditor
        draft={{ mode: "new", name: "greet", description: "d", instructions: "x" }}
        upload={null}
        onSaved={onSaved}
        onCancel={noop}
        onNotice={onNotice}
        onError={noop}
      />,
    );
    fireEvent.click(screen.getByText("Save skill"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onNotice).toHaveBeenCalledWith(
      expect.objectContaining({ name: "greet", tone: "ok" }),
    );
  });
});

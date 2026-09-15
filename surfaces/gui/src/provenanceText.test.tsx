// 审批卡片上那条「这个文件是 agent 自己刚做出来的」警告，在中文界面上要是中文。
//
// 服务端（coworker/provenance.py 的 Match.render）吐的是一句固定词汇的英文，同一句
// 还进审计和 reviewer 的文本，所以不改服务端 —— GUI 这边认出这套词汇再翻译。认不出的
// 原样显示：这是一条安全警告，宁可显示英文，也不能因为解析不了而把它吞掉。
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "./components/ApprovalCard";
import { provenanceText } from "./provenanceText";
import { setTestLocale } from "./testLocale";
import type { Item } from "./types";

type ApprovalItem = Extract<Item, { kind: "approval" }>;

afterEach(async () => {
  cleanup();
  await act(async () => {
    await setTestLocale("en");
  });
});

describe("provenanceText · en 与服务端原句逐字相同", () => {
  it.each([
    "make_rows.py was created by the agent just now",
    "scripts/setup.py was created by the agent 1 step ago",
    "scripts/setup.py was created by the agent 3 steps ago",
    "install.sh was downloaded by the agent just now",
    "install.sh was downloaded by the agent 1 step ago",
    "install.sh was downloaded by the agent 12 steps ago",
  ])("%s", async (raw) => {
    await setTestLocale("en");
    expect(provenanceText(raw)).toBe(raw);
  });
});

describe("provenanceText · zh", () => {
  it.each([
    ["make_rows.py was created by the agent just now", "make_rows.py 是助手刚才自己创建的"],
    ["scripts/setup.py was created by the agent 1 step ago", "scripts/setup.py 是助手 1 步之前自己创建的"],
    ["scripts/setup.py was created by the agent 3 steps ago", "scripts/setup.py 是助手 3 步之前自己创建的"],
    ["install.sh was downloaded by the agent just now", "install.sh 是助手刚才自己下载的"],
    ["install.sh was downloaded by the agent 12 steps ago", "install.sh 是助手 12 步之前自己下载的"],
    // 路径里带 " was " 也不能切错：锚定在句尾
    ["my was here.sh was created by the agent 2 steps ago", "my was here.sh 是助手 2 步之前自己创建的"],
  ])("%s", async (raw, want) => {
    await setTestLocale("zh");
    expect(provenanceText(raw)).toBe(want);
  });

  it("路径里的 {{…}} 和 $t(…) 原样保留 —— 文件名是 agent 定的，不能被当成模板", async () => {
    await setTestLocale("zh");
    const raw = "{{when}}$t(approval.allow).py was created by the agent just now";
    expect(provenanceText(raw)).toBe("{{when}}$t(approval.allow).py 是助手刚才自己创建的");
  });

  it.each([
    "",
    "install.sh was modified by the agent just now", // 词汇外的动词
    "install.sh was created by the agent 1 steps ago", // 单复数对不上
    "install.sh was created by the agent yesterday",
    "install.sh was created by the agent just now.", // 句尾多了东西
    " was created by the agent just now", // 没有路径
    "note: install.sh was created by the agent just now\nextra",
  ])("认不出的原样显示：%j", async (raw) => {
    await setTestLocale("zh");
    expect(provenanceText(raw)).toBe(raw);
  });
});

describe("ApprovalCard 接上了 provenanceText", () => {
  it("中文界面上审批卡片的来源警告是中文", async () => {
    await act(async () => {
      await setTestLocale("zh");
    });
    const item: ApprovalItem = {
      kind: "approval",
      name: "run_shell",
      args: { command: "python scripts/setup.py" },
      reason: "requires approval",
      category: "shell",
      provenance: "scripts/setup.py was created by the agent 3 steps ago",
    };
    render(<ApprovalCard item={item} onApprove={vi.fn()} />);
    expect(screen.getByText("scripts/setup.py 是助手 3 步之前自己创建的")).toBeTruthy();
    expect(screen.queryByText(/by the agent/)).toBeNull();
  });
});

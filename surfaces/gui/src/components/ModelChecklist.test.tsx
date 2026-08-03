// Add-model family dropdown for the cloud-account providers: the family choice folds
// into the model id (`bedrock:claude/…`, `vertex:openweight/…`); plain providers keep
// the bare add-model row.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModelChecklist } from "./ModelChecklist";

// 后端把 label 拆好了再给界面（qumge_catalog.models）—— 名字、厂商、价格要排成
// 不同的列，拆法散在前端的话每个用到的地方都得自己拆一遍。
const { GW } = vi.hoisted(() => ({
  GW: [
    {
      id: "qumge:anthropic/claude-opus-5",
      name: "Claude Opus 5",
      vendor: "Anthropic",
      price: "$5.00/$25.00 per Mtok",
      vision: true,
      label: "Claude Opus 5 · $5.00/$25.00 per Mtok · vision",
    },
    {
      id: "qumge:openai/gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      vendor: "OpenAI",
      price: "$5.00/$30.00 per Mtok",
      vision: true,
      label: "OpenAI: GPT-5.6 Sol · $5.00/$30.00 per Mtok · vision",
    },
  ],
}));

vi.mock("../api", () => ({
  addModel: vi.fn(async (id: string) => ({ ok: true, models: [id], model: id })),
  removeModel: vi.fn(async () => ({ ok: true, models: [], model: "" })),
  setDefaultModel: vi.fn(async () => ({ ok: true })),
  getSettings: vi.fn(async () => ({ models: [], model: "" })),
  // qumge 的清单在挂载时就取一次（一次取全量，在本地筛）。
  gatewayModels: vi.fn(async () => ({ models: GW })),
}));

import { addModel, gatewayModels } from "../api";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// qumge 必须在里面：provOf 靠它认出 "qumge:…" 的前缀，不认的话 curated 里那些
// 会被算成 openai 的，整个已选段就空了。
const KNOWN = ["openai", "anthropic", "bedrock", "vertex", "openrouter", "qumge"];

function renderList(
  provider: string,
  opts: {
    curated?: string[];
    suggested?: string[];
    labels?: Record<string, string>;
    defaultModel?: string;
  } = {},
) {
  return render(
    <ModelChecklist
      provider={provider}
      knownProviders={KNOWN}
      suggested={opts.suggested ?? []}
      curated={opts.curated ?? []}
      defaultModel={opts.defaultModel ?? ""}
      labels={opts.labels}
      onChanged={() => {}}
    />,
  );
}

function addTyped(id: string) {
  fireEvent.change(screen.getByPlaceholderText("Add another model…"), {
    target: { value: id },
  });
  fireEvent.click(screen.getByText("Add"));
}

describe("ModelChecklist add-model family dropdown", () => {
  it("folds the selected vertex family into the id", async () => {
    renderList("vertex");
    fireEvent.change(screen.getByTestId("mlist-family"), {
      target: { value: "openweight" },
    });
    addTyped("meta/llama-4-maverick-17b-128e-instruct-maas");
    expect(addModel).toHaveBeenCalledWith(
      "vertex:openweight/meta/llama-4-maverick-17b-128e-instruct-maas",
    );
  });

  it("defaults bedrock to the Claude family and keeps a typed family verbatim", async () => {
    renderList("bedrock");
    addTyped("anthropic.claude-sonnet-4-6-v1:0");
    expect(addModel).toHaveBeenCalledWith(
      "bedrock:claude/anthropic.claude-sonnet-4-6-v1:0",
    );
    addTyped("other/amazon.nova-2-pro-v1:0");
    expect(addModel).toHaveBeenLastCalledWith("bedrock:other/amazon.nova-2-pro-v1:0");
  });

  it("shows no family dropdown for plain providers", async () => {
    renderList("openrouter");
    expect(screen.queryByTestId("mlist-family")).toBeNull();
    addTyped("z-ai/glm-5.2");
    expect(addModel).toHaveBeenCalledWith("openrouter:z-ai/glm-5.2");
  });

  it("qumge has no type-it-yourself row — the one list is the way in", async () => {
    // 【否定对照】手打框什么都收：随手敲两个字符也会变成清单里的一行，而那一行
    // 既跑不起来，也没有任何东西告诉用户它跑不起来。qumge 是唯一一个我们能把
    // 模型清单【问出来】的 provider，所以它不需要那条退路。
    renderList("qumge");
    expect(screen.queryByPlaceholderText("Add another model…")).toBeNull();
    expect(await screen.findByTestId("gateway-search")).toBeTruthy();

    // 别的 provider 仍然要手打这一行：我们问不到它们的清单，它是唯一的路，也是
    // 新模型发布当天不用等我们发版的那条路。它们也没有清单可筛。
    cleanup();
    renderList("openrouter");
    expect(screen.getByPlaceholderText("Add another model…")).toBeTruthy();
    expect(screen.queryByTestId("gateway-search")).toBeNull();
  });
});

describe("ModelChecklist — qumge 合成一个列表", () => {
  const SOL = "qumge:openai/gpt-5.6-sol";
  const OPUS = "qumge:anthropic/claude-opus-5";

  it("已选和可选是同一个列表的两段，用同一种控件", async () => {
    // 原来是两份列表：上面勾选框、下面「加入」链接。语义还不对称 —— 勾选能撤，
    // 「已加入」不能，要撤得滚回上面那份里去找。
    renderList("qumge", { curated: [SOL] });
    expect(await screen.findByTestId(`mrow-${OPUS}`)).toBeTruthy();

    const picked = screen.getByTestId(`mcheck-${SOL}`) as HTMLInputElement;
    const notPicked = screen.getByTestId(`mcheck-${OPUS}`) as HTMLInputElement;
    expect(picked.checked).toBe(true);
    expect(notPicked.checked).toBe(false);

    // 勾一下就是加入 —— 和取消勾选是同一个动作的正反面，在原地就能看到结果。
    fireEvent.click(notPicked);
    expect(addModel).toHaveBeenCalledWith(OPUS);
  });

  it("价格对【已选】的行也显示", async () => {
    // 原来价格只在"还没选"的那一半可见：选进来之后就看不到自己在花多少钱，而那
    // 恰恰是事后想复查时唯一想看的数字。
    renderList("qumge", { curated: [SOL] });
    const row = await screen.findByTestId(`mrow-${SOL}`);
    expect(row.textContent).toContain("$5.00/$30.00 per Mtok");
    expect(row.textContent).toContain("OpenAI");
    // 厂商前缀不能同时出现在名字里 —— 后端已经把它摘出去单独成列了。
    expect(row.textContent).not.toContain("OpenAI: GPT-5.6 Sol");
  });

  it("网关连不上时，已选那一段仍然在，并说清楚坏的是哪一半", async () => {
    // 【已选来自本地设置，不依赖网络】否则网关一挂，用户连取消勾选、换默认都做
    // 不了。而半屏空白不解释的话，会被读成"整页坏了"。
    (gatewayModels as any).mockResolvedValueOnce({ models: [], error: "connection refused" });
    renderList("qumge", {
      curated: [SOL],
      labels: { [SOL]: "GPT-5.6 Sol · via Qumge" },
    });

    expect(await screen.findByTestId("gateway-offline")).toBeTruthy();
    // 名字退回本地的 labels —— 网关问不到就用我们自己存的那份。
    expect(screen.getByTestId(`mrow-${SOL}`).textContent).toContain("GPT-5.6 Sol");
    expect((screen.getByTestId(`mcheck-${SOL}`) as HTMLInputElement).checked).toBe(true);
  });

  it("筛选同时作用于两段", async () => {
    renderList("qumge", { curated: [SOL] });
    await screen.findByTestId(`mrow-${OPUS}`);

    fireEvent.change(screen.getByTestId("gateway-search"), { target: { value: "anthropic" } });
    expect(screen.getByTestId(`mrow-${OPUS}`)).toBeTruthy();
    // 已选那一段也跟着筛 —— 只筛下半截的话，筛完还是两份列表各管各的。
    expect(screen.queryByTestId(`mrow-${SOL}`)).toBeNull();
  });

  it("被筛空的段【整段】不渲染，没筛选时空段要留着", async () => {
    renderList("qumge", { curated: [SOL] });
    await screen.findByTestId(`mrow-${OPUS}`);

    // 筛掉之后不能留下一个"已加进选择器 · 1"底下一条都没有的孤儿标题：那个 1
    // 说的是总数，读起来却像"这里本该有一条，但它不见了"。
    fireEvent.change(screen.getByTestId("gateway-search"), { target: { value: "anthropic" } });
    expect(screen.queryByTestId("mlist-selected")).toBeNull();
    // 留下的那一段，数字要跟着筛后的结果走。
    expect(screen.getByTestId("mlist-others").textContent).toContain("1");

    // 什么都筛不到时才说"没有匹配的模型"。
    fireEvent.change(screen.getByTestId("gateway-search"), { target: { value: "zzzz" } });
    expect(screen.getByTestId("gateway-nomatch")).toBeTruthy();

    // 【否定对照】没筛选时，空的已选段【要】留着 —— 那时的 0 是有用的信息
    // （"你的选择器是空的"），不是一个 bug。
    cleanup();
    renderList("qumge", { curated: [] });
    expect(await screen.findByTestId("mlist-selected")).toBeTruthy();
  });

  it("筛选不会把「连不上网关」那句话一起藏掉", async () => {
    // 它原来挂在"其余"那一段里。网关挂了那段就是空的，用户一筛选整段被隐藏，
    // 最该看到的那句话就跟着没了 —— 剩下一屏空白，读起来像整页坏了。
    (gatewayModels as any).mockResolvedValueOnce({ models: [], error: "connection refused" });
    renderList("qumge", { curated: [SOL], labels: { [SOL]: "GPT-5.6 Sol" } });
    expect(await screen.findByTestId("gateway-offline")).toBeTruthy();

    fireEvent.change(screen.getByTestId("gateway-search"), { target: { value: "zzzz" } });
    expect(screen.getByTestId("gateway-offline")).toBeTruthy();
  });
});

// 用途包的三条界面守卫：有内容才出现、空态整块消失、残缺安装必须说出来。
// mock 停在 api 层；MCP 文本的解析已经由 Python 测试负责。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as bundleApi from "../../api.qumge";
import { setLocale } from "../../i18n";
import { SkillCatalog } from "./SkillCatalog";

const BUNDLES = [{
  slug: "bundle:competitor-research",
  title: "See what your competitors are posting",
  outcome: "One summary across platforms.",
  count: 3,
}];

const renderCatalog = () =>
  render(<SkillCatalog installedNames={new Set()} onInstalled={vi.fn()} onError={vi.fn()} />);

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("fetch", vi.fn(async () => ({
    json: async () => ({ results: [], has_more: false, searched_as: "" }),
  })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SkillCatalog bundles", () => {
  it("renders title, outcome, and skill count when bundles exist", async () => {
    vi.spyOn(bundleApi, "bundles").mockResolvedValue(BUNDLES);
    renderCatalog();

    expect(await screen.findByTestId("skill-bundles")).toBeTruthy();
    expect(screen.getByText("See what your competitors are posting")).toBeTruthy();
    expect(screen.getByText("One summary across platforms.")).toBeTruthy();
    expect(screen.getByText("3 skills")).toBeTruthy();
  });

  it("does not render the section when there are no bundles", async () => {
    vi.spyOn(bundleApi, "bundles").mockResolvedValue([]);
    renderCatalog();

    await waitFor(() => expect(bundleApi.bundles).toHaveBeenCalled());
    expect(screen.queryByTestId("skill-bundles")).toBeNull();
  });

  it("shows the missing note after installing a partial bundle", async () => {
    vi.spyOn(bundleApi, "bundles").mockResolvedValue(BUNDLES);
    vi.spyOn(bundleApi, "installBundle").mockResolvedValue({
      ok: true,
      installed: [{ name: "one", path: "/x/one/SKILL.md" }],
      missing_note:
        "NOTE: only 1 of 3 skills in this bundle are still in the catalog. " +
        "Tell the user that 2 skill(s) could not be installed because they are no longer " +
        "in the catalog, and name them: gone/from/catalog, also/gone/here. " +
        "Do not silently install a partial bundle.",
    });
    renderCatalog();

    fireEvent.click(await screen.findByTestId("install-bundle:competitor-research"));
    expect(await screen.findByText(/gone\/from\/catalog/)).toBeTruthy();
  });
});

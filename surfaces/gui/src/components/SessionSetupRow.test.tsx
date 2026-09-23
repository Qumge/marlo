import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Persona } from "../api";
import { fullPersonaName, shortPersonaName } from "../personaScope";
import { SessionSetupRow } from "./SessionSetupRow";

// Marlo（owner 2026-09-23）：选择器里默认只有 Marlo 一个同事 —— 那就不出同事按钮。
// 工程 / 安全类同事默认关（后端 MARLO_ENGINEERING_PERSONAS）；用户在设置里开了之后
// 按钮回来。默认同事叫 Marlo，不叫 "Coworker"。

const P = (id: string, name: string, extra: Partial<Persona> = {}): Persona => ({
  id,
  name,
  icon: "",
  tagline: "",
  requires_folder: false,
  builtin: true,
  tools: [],
  enabled: true,
  surfaced: true,
  default: id === "cowork",
  ...extra,
});

const MARLO = P("cowork", "Marlo");
const SECURITY = P("security", "Security Coworker");

function row(personas: Persona[], agent = "cowork") {
  return render(
    <SessionSetupRow
      personas={personas}
      agent={agent}
      showFolder={false}
      folderName={null}
      onPickCoworker={() => {}}
      onPickFolder={() => {}}
      onManage={() => {}}
      onImport={() => {}}
    />,
  );
}

afterEach(cleanup);

describe("the default persona reads as Marlo", () => {
  it("short and full names", () => {
    expect(shortPersonaName("Marlo", "cowork")).toBe("Marlo");
    expect(fullPersonaName("Marlo", "cowork")).toBe("Marlo");
    expect(fullPersonaName("Ops Coworker", "ops")).toBe("Ops Coworker");
  });
});

describe("SessionSetupRow coworker chip", () => {
  it("is absent when Marlo is the only choice", () => {
    row([MARLO, P("security", "Security Coworker", { enabled: false, surfaced: false })]);
    expect(screen.queryByTestId("coworker-chip")).toBeNull();
  });

  it("counts only personas that are enabled AND in the picker", () => {
    row([MARLO, P("ops", "Ops Coworker", { surfaced: false })]);
    expect(screen.queryByTestId("coworker-chip")).toBeNull();
  });

  it("comes back once the user turns another coworker on", () => {
    row([MARLO, SECURITY]);
    const chip = screen.getByTestId("coworker-chip");
    expect(chip.textContent).toContain("Marlo");
    fireEvent.click(chip);
    expect(screen.getByText("Security Coworker")).toBeTruthy();
  });

  it("still shows which coworker a session is on, even if it is not in the picker", () => {
    row([MARLO], "security");
    expect(screen.getByTestId("coworker-chip")).toBeTruthy();
  });
});

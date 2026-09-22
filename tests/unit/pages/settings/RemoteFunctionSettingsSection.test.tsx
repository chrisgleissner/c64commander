/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/appSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/appSettings")>();
  return {
    ...actual,
    saveRemoteFunctionActions: vi.fn(actual.saveRemoteFunctionActions),
  };
});

import { RemoteFunctionSettingsSection } from "@/pages/settings/RemoteFunctionSettingsSection";
import { saveRemoteFunctionActions } from "@/lib/config/appSettings";

const F1_KEY = "c64u_remote_function_1_action";
const F3_KEY = "c64u_remote_function_3_action";

const announce = (key: string) =>
  act(() => {
    window.dispatchEvent(new CustomEvent("c64u-app-settings-updated", { detail: { key } }));
  });

const openSelect = (functionKey: 1 | 3) =>
  fireEvent.click(screen.getByTestId(`settings-remote-function-${functionKey}`));

const choose = async (functionKey: 1 | 3, label: string) => {
  openSelect(functionKey);
  fireEvent.click(await screen.findByRole("option", { name: label }));
};

describe("RemoteFunctionSettingsSection", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(saveRemoteFunctionActions).mockClear();
  });

  it("shows the default assignments when nothing is stored", () => {
    render(<RemoteFunctionSettingsSection />);

    expect(screen.getByTestId("settings-remote-function-1")).toHaveTextContent("Play/Pause");
    expect(screen.getByTestId("settings-remote-function-3")).toHaveTextContent("Next tune");
  });

  it("shows the stored assignments", () => {
    localStorage.setItem(F1_KEY, "search");
    localStorage.setItem(F3_KEY, "gameMode");

    render(<RemoteFunctionSettingsSection />);

    expect(screen.getByTestId("settings-remote-function-1")).toHaveTextContent("Search");
    expect(screen.getByTestId("settings-remote-function-3")).toHaveTextContent("Game Mode");
  });

  it("stores a chosen F1 action and keeps the F3 assignment", async () => {
    render(<RemoteFunctionSettingsSection />);

    await choose(1, "Quick menu");

    expect(localStorage.getItem(F1_KEY)).toBe("quickMenu");
    expect(localStorage.getItem(F3_KEY)).toBe("nextTune");
    expect(screen.getByTestId("settings-remote-function-1")).toHaveTextContent("Quick menu");
  });

  it("stores a chosen F3 action and keeps the F1 assignment", async () => {
    render(<RemoteFunctionSettingsSection />);

    await choose(3, "Search");

    expect(localStorage.getItem(F1_KEY)).toBe("playPause");
    expect(localStorage.getItem(F3_KEY)).toBe("search");
  });

  it("disables the action the other key already uses", async () => {
    render(<RemoteFunctionSettingsSection />);

    openSelect(1);

    expect(await screen.findByRole("option", { name: "Next tune" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: "Search" })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("keeps Unassigned selectable when the other key is also unassigned", async () => {
    localStorage.setItem(F1_KEY, "unassigned");
    localStorage.setItem(F3_KEY, "unassigned");
    render(<RemoteFunctionSettingsSection />);

    openSelect(1);

    expect(await screen.findByRole("option", { name: "Unassigned" })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("re-reads both assignments when either function-key setting changes elsewhere", () => {
    render(<RemoteFunctionSettingsSection />);

    localStorage.setItem(F1_KEY, "gameMode");
    localStorage.setItem(F3_KEY, "search");
    announce(F3_KEY);

    expect(screen.getByTestId("settings-remote-function-1")).toHaveTextContent("Game Mode");
    expect(screen.getByTestId("settings-remote-function-3")).toHaveTextContent("Search");
  });

  it("ignores changes to unrelated settings", () => {
    render(<RemoteFunctionSettingsSection />);

    localStorage.setItem(F1_KEY, "gameMode");
    announce("c64u_debug_logging_enabled");

    expect(screen.getByTestId("settings-remote-function-1")).toHaveTextContent("Play/Pause");
  });

  it("restores the default assignments", () => {
    localStorage.setItem(F1_KEY, "search");
    localStorage.setItem(F3_KEY, "unassigned");
    render(<RemoteFunctionSettingsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));

    expect(localStorage.getItem(F1_KEY)).toBe("playPause");
    expect(localStorage.getItem(F3_KEY)).toBe("nextTune");
    expect(screen.getByTestId("settings-remote-function-1")).toHaveTextContent("Play/Pause");
    expect(screen.getByTestId("settings-remote-function-3")).toHaveTextContent("Next tune");
  });

  it("explains a rejected save and clears the message once the defaults are restored", async () => {
    vi.mocked(saveRemoteFunctionActions).mockReturnValueOnce(false);
    render(<RemoteFunctionSettingsSection />);

    await choose(1, "Search");

    expect(screen.getByText("F1 and F3 cannot use the same assigned action.")).toBeInTheDocument();
    expect(localStorage.getItem(F1_KEY)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));

    expect(screen.queryByText("F1 and F3 cannot use the same assigned action.")).toBeNull();
  });

  it("clears a rejection message after a later save succeeds", async () => {
    vi.mocked(saveRemoteFunctionActions).mockReturnValueOnce(false);
    render(<RemoteFunctionSettingsSection />);

    await choose(1, "Search");
    expect(screen.getByText("F1 and F3 cannot use the same assigned action.")).toBeInTheDocument();

    await choose(3, "Game Mode");

    expect(screen.queryByText("F1 and F3 cannot use the same assigned action.")).toBeNull();
  });
});

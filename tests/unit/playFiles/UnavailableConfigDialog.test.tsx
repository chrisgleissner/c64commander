/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  UnavailableConfigDialog,
  useUnavailableConfigPrompt,
  type UnavailableConfigPrompt,
} from "@/pages/playFiles/components/UnavailableConfigDialog";
import type { PlaylistItem } from "@/pages/playFiles/types";

const item = (label: string) => ({ id: label, label }) as PlaylistItem;
const prompt = (configFileName: string | null): UnavailableConfigPrompt => ({
  item: item("Comic Bakery"),
  configFileName,
  reason: "The file is no longer on the device.",
  resolve: vi.fn(),
});

describe("UnavailableConfigDialog", () => {
  it("is closed without a prompt", () => {
    render(<UnavailableConfigDialog prompt={null} onChoose={vi.fn()} />);
    expect(screen.queryByText("Config unavailable")).toBeNull();
  });

  it("names the config and the song, shows the reason, and offers both choices", () => {
    const onChoose = vi.fn();
    render(<UnavailableConfigDialog prompt={prompt("bakery.cfg")} onChoose={onChoose} />);
    expect(screen.getByText("Config unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("bakery.cfg is unavailable for Comic Bakery. Play without config, or cancel?"),
    ).toBeInTheDocument();
    expect(screen.getByText("The file is no longer on the device.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Play without config"));
    expect(onChoose).toHaveBeenNthCalledWith(1, "play-without-config");
    onChoose.mockClear();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onChoose).toHaveBeenNthCalledWith(1, "cancel");
  });

  it("falls back to a generic config name", () => {
    render(<UnavailableConfigDialog prompt={prompt(null)} onChoose={vi.fn()} />);
    expect(screen.getByText(/^The selected config is unavailable for Comic Bakery/)).toBeInTheDocument();
  });
});

describe("useUnavailableConfigPrompt", () => {
  it("resolves with the listener's choice and closes", async () => {
    const { result } = renderHook(() => useUnavailableConfigPrompt());
    let answer: Promise<string> | undefined;
    act(() => {
      answer = result.current.ask(item("Comic Bakery"), { configFileName: "bakery.cfg", reason: "gone" });
    });
    expect(result.current.prompt).toMatchObject({ configFileName: "bakery.cfg", reason: "gone" });
    act(() => result.current.choose("play-without-config"));
    await expect(answer).resolves.toBe("play-without-config");
    expect(result.current.prompt).toBeNull();
  });

  it("ignores a choice while nothing is asked", () => {
    const { result } = renderHook(() => useUnavailableConfigPrompt());
    act(() => result.current.choose("cancel"));
    expect(result.current.prompt).toBeNull();
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSectionState } from "@/lib/ui/collapsibleSectionStore";
import { SLIDER_KEY_COMMIT_DEBOUNCE_MS } from "@/components/ui/slider";

const { interactiveWriteSpy, mockSidData } = vi.hoisted(() => ({
  interactiveWriteSpy: vi.fn(),
  mockSidData: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), fetchQuery: vi.fn() }),
}));
vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ setConfigValue: vi.fn(), writeMemory: vi.fn() }),
}));
vi.mock("@/hooks/useActionTrace", () => ({
  useActionTrace: () => Object.assign((fn: (...args: unknown[]) => unknown) => fn, { scope: vi.fn() }),
}));
vi.mock("@/hooks/useC64Connection", () => ({
  VISIBLE_C64_QUERY_OPTIONS: { intent: "user", refetchOnMount: "always" },
  useC64ConfigItems: () => ({ data: undefined }),
  useC64Drives: () => ({ data: { drives: [] }, refetch: vi.fn() }),
}));
vi.mock("@/pages/home/hooks/ConfigActionsContext", () => ({
  useSharedConfigActions: () => ({
    configOverrides: {},
    configWritePending: {},
    updateConfigValue: vi.fn(),
    resolveConfigValue: (_payload: unknown, _category: string, itemName: string, fallback: string | number) =>
      itemName === "Vol Master" ? "0 dB" : fallback,
    setConfigOverride: vi.fn(),
  }),
}));
vi.mock("@/pages/home/hooks/useSidData", () => ({
  useSidData: () => mockSidData(),
}));
vi.mock("@/lib/sid/sidSilence", () => ({
  silenceSidTargets: vi.fn(),
  buildSidSilenceTargets: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/config/sidVolumeControl", () => ({
  buildSidEnablement: () => ({ socket1: true, socket2: true, ultiSid1: true, ultiSid2: true }),
}));
vi.mock("@/hooks/useInteractiveConfigWrite", () => ({
  useInteractiveConfigWrite: () => ({ write: interactiveWriteSpy, isPending: false }),
}));

import { AudioMixer } from "@/pages/home/components/AudioMixer";

const socketEntry = {
  key: "socket1",
  label: "SID Socket 1",
  volume: "0 dB",
  pan: "Center",
  address: "$D400",
  addressRaw: "$D400",
  volumeItem: "Vol Socket 1",
  panItem: "Pan Socket 1",
  addressItem: "SID Socket 1 Address",
  volumeOptions: ["-12 dB", "-6 dB", "0 dB", "+6 dB", "+12 dB"],
  panOptions: ["Left 2", "Left 1", "Center", "Right 1", "Right 2"],
  addressOptions: ["$D400", "$D420"],
};

const pressAndSettle = (thumb: HTMLElement, key: string) => {
  fireEvent.keyDown(thumb, { key, code: key });
  act(() => {
    vi.advanceTimersByTime(SLIDER_KEY_COMMIT_DEBOUNCE_MS + 1);
  });
};

describe("AudioMixer sliders — one arrow key press moves one option", () => {
  beforeEach(() => {
    localStorage.clear();
    writeSectionState("home", "audio", true);
    interactiveWriteSpy.mockReset();
    mockSidData.mockReturnValue({
      sidControlEntries: [socketEntry],
      sidSilenceTargets: [],
      sidAddressingCategory: undefined,
      ultiSidCategory: undefined,
      sidSocketsCategory: undefined,
      audioMixerCategory: {
        "Audio Mixer": {
          items: { "Vol Master": { selected: "0 dB", options: ["OFF", "-42 dB", "0 dB", "+6 dB"] } },
        },
      },
    });
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const renderMixer = () => render(<AudioMixer isConnected machineTaskBusy={false} runMachineTask={vi.fn()} />);

  it("ArrowLeft on Master volume writes the option below the current one", () => {
    renderMixer();

    pressAndSettle(screen.getByRole("slider", { name: "Master volume" }), "ArrowLeft");

    expect(interactiveWriteSpy).toHaveBeenCalledWith({ "Vol Master": "-42 dB" });
  });

  it("ArrowRight on a SID socket volume writes the option above the current one", () => {
    renderMixer();

    pressAndSettle(screen.getByRole("slider", { name: "SID Socket 1 volume" }), "ArrowRight");

    expect(interactiveWriteSpy).toHaveBeenCalledWith({ "Vol Socket 1": "+6 dB" });
  });

  it("ArrowLeft on a SID socket pan writes the option to the left of the current one", () => {
    renderMixer();

    pressAndSettle(screen.getByRole("slider", { name: "SID Socket 1 pan" }), "ArrowLeft");

    expect(interactiveWriteSpy).toHaveBeenCalledWith({ "Pan Socket 1": "Left 1" });
  });
});

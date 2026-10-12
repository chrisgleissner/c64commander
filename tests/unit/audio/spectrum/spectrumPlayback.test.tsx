/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackSpectrumCard } from "@/components/playback/SpectrumCard";

const state = vi.hoisted(() => ({ local: false, audioLive: false, onScreen: true }));
const view = vi.hoisted(() => ({
  currentTier: { index: 1 },
  setState: vi.fn(),
  resize: vi.fn(),
  refreshTheme: vi.fn(),
  setDocumentShowing: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("@/hooks/useActivePlayback", () => ({ useActivePlayback: () => ({ local: state.local }) }));
vi.mock("@/hooks/useAvMirror", () => ({ useAvMirror: () => ({ audioLive: state.audioLive }) }));
vi.mock("@/hooks/useDisplayProfile", () => ({ useDisplayProfile: () => ({ profile: "compact" }) }));
vi.mock("@/lib/audio/useAudioFxAvailable", () => ({ useAudioFxAvailable: () => true }));
vi.mock("@/lib/audio/spectrum/spectrumView", () => ({
  SpectrumView: vi.fn(function () {
    return view;
  }),
}));
// A remembered-open card keeps its body mounted even when its source stops.
vi.mock("@/components/CollapsibleSection", () => ({
  CollapsibleSection: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ScreenActivityWatch", () => ({
  ScreenActivityWatch: ({ onChange }: { onChange: (active: boolean) => void }) => {
    useEffect(() => onChange(state.onScreen), [onChange, state.onScreen]);
    return null;
  },
}));

describe("the spectrum follows actual phone playback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(state, { local: false, audioLive: false, onScreen: true });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps Live View analysis running when the unrelated local playlist is paused", () => {
    state.audioLive = true;
    const component = render(<PlaybackSpectrumCard paused />);
    expect(view.setState).toHaveBeenLastCalledWith({ visible: true, paused: false });
    expect(screen.getByTestId("spectrum-message")).toHaveTextContent("Waiting for sound");
    state.local = true;
    component.rerender(<PlaybackSpectrumCard paused />);
    expect(view.setState).toHaveBeenLastCalledWith({ visible: true, paused: false });
  });

  it("disables a remembered-open analyser when playback stops or switches to remote-only audio", () => {
    state.local = true;
    const component = render(<PlaybackSpectrumCard paused={false} />);
    expect(view.setState).toHaveBeenLastCalledWith({ visible: true, paused: false });
    state.local = false;
    component.rerender(<PlaybackSpectrumCard paused={false} />);
    expect(view.setState).toHaveBeenLastCalledWith({ visible: false, paused: false });
    expect(screen.getByTestId("spectrum-message")).toHaveTextContent(
      "Spectrum is available for sound played on this phone",
    );
    state.audioLive = true;
    component.rerender(<PlaybackSpectrumCard paused={false} />);
    expect(view.setState).toHaveBeenLastCalledWith({ visible: true, paused: false });
    state.audioLive = false;
    component.rerender(<PlaybackSpectrumCard paused={false} />);
    expect(view.setState).toHaveBeenLastCalledWith({ visible: false, paused: false });
  });

  it("pauses a local tune and disables a kept-alive hidden Play page even with mirror audio", () => {
    state.local = true;
    const component = render(<PlaybackSpectrumCard paused />);
    expect(view.setState).toHaveBeenLastCalledWith({ visible: true, paused: true });
    expect(screen.getByTestId("spectrum-message")).toHaveTextContent("Paused");
    state.audioLive = true;
    state.onScreen = false;
    component.rerender(<PlaybackSpectrumCard paused />);
    expect(view.setState).toHaveBeenLastCalledWith({ visible: false, paused: false });
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPECTRUM_UNAVAILABLE_MESSAGE, SpectrumCard } from "@/components/playback/SpectrumCard";
import type { SpectrumReadout } from "@/lib/audio/spectrum/spectrumView";

interface ViewOptions {
  canvas: HTMLCanvasElement;
  profile: string;
  onReadout: (readout: SpectrumReadout) => void;
  onActiveChange: (active: boolean) => void;
  onTierChange: (tier: { index: number }) => void;
}

const state = vi.hoisted(() => ({
  available: true,
  profile: "medium",
  sectionProps: null as Record<string, unknown> | null,
}));
const created = vi.hoisted(() => ({
  options: [] as unknown[],
  views: [] as Record<string, ReturnType<typeof vi.fn>>[],
}));

vi.mock("@/hooks/useDisplayProfile", () => ({ useDisplayProfile: () => ({ profile: state.profile }) }));
vi.mock("@/lib/audio/useAudioFxAvailable", () => ({ useAudioFxAvailable: () => state.available }));
vi.mock("@/lib/audio/spectrum/spectrumView", () => ({
  SpectrumView: vi.fn(function (options: unknown) {
    const instance = {
      currentTier: { index: 2 },
      setState: vi.fn(),
      resize: vi.fn(),
      refreshTheme: vi.fn(),
      setDocumentShowing: vi.fn(),
      dispose: vi.fn(),
    };
    created.options.push(options);
    created.views.push(instance);
    return instance;
  }),
}));
vi.mock("@/components/CollapsibleSection", () => ({
  CollapsibleSection: (props: Record<string, unknown> & { children: ReactNode }) => {
    state.sectionProps = props;
    return <div data-testid={String(props.testId)}>{props.children}</div>;
  },
}));
vi.mock("@/components/ScreenActivityWatch", () => ({ ScreenActivityWatch: () => null }));

const lastOptions = () => created.options[created.options.length - 1] as ViewOptions;
const lastView = () => created.views[created.views.length - 1];

describe("SpectrumCard", () => {
  let resizeCallback: () => void;
  let resizeDisconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.assign(state, { available: true, profile: "medium", sectionProps: null });
    created.options.length = 0;
    created.views.length = 0;
    resizeDisconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resizeCallback = callback;
        }
        observe() {}
        disconnect() {
          resizeDisconnect();
        }
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders nothing and creates no view when the plugin cannot analyse sound", () => {
    state.available = false;
    const { container } = render(<SpectrumCard soundOnPhone paused={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(created.views).toHaveLength(0);
  });

  it("opens by default only when sound is already coming from the phone, and keeps that choice", () => {
    const component = render(<SpectrumCard soundOnPhone paused={false} />);
    expect(state.sectionProps?.defaultOpen).toBe(true);
    component.unmount();
    const closed = render(<SpectrumCard soundOnPhone={false} paused={false} />);
    expect(state.sectionProps?.defaultOpen).toBe(false);
    closed.rerender(<SpectrumCard soundOnPhone paused={false} />);
    expect(state.sectionProps?.defaultOpen).toBe(false);
  });

  it("names why there is nothing to show: unavailable, then paused, then waiting", () => {
    const component = render(<SpectrumCard soundOnPhone={false} paused={false} />);
    expect(screen.getByTestId("spectrum-message")).toHaveTextContent(SPECTRUM_UNAVAILABLE_MESSAGE);
    component.rerender(<SpectrumCard soundOnPhone paused />);
    expect(screen.getByTestId("spectrum-message")).toHaveTextContent("Paused");
    component.rerender(<SpectrumCard soundOnPhone paused={false} />);
    expect(screen.getByTestId("spectrum-message")).toHaveTextContent("Waiting for sound");
  });

  it("hides the message once the view reports it is drawing and shows it again when it stops", () => {
    render(<SpectrumCard soundOnPhone paused={false} />);
    act(() => lastOptions().onActiveChange(true));
    expect(screen.queryByTestId("spectrum-message")).toBeNull();
    act(() => lastOptions().onActiveChange(false));
    expect(screen.getByTestId("spectrum-message")).toHaveTextContent("Waiting for sound");
  });

  it("writes levels, a dash for silence, the clipping flag and the tier from the view", () => {
    render(<SpectrumCard soundOnPhone paused={false} />);
    const canvas = screen.getByTestId("spectrum-canvas");
    expect(canvas.dataset.spectrumTier).toBe("2");
    act(() => lastOptions().onReadout({ rmsDb: -20, peakDb: -3, clipped: true }));
    expect(screen.getByTestId("spectrum-rms")).toHaveTextContent("-20");
    expect(screen.getByTestId("spectrum-peak")).toHaveTextContent("-3");
    expect(screen.getByTestId("spectrum-clip")).toHaveAttribute("data-clipping", "true");
    act(() => lastOptions().onReadout({ rmsDb: null, peakDb: null, clipped: false }));
    expect(screen.getByTestId("spectrum-rms")).toHaveTextContent("—");
    expect(screen.getByTestId("spectrum-peak")).toHaveTextContent("—");
    expect(screen.getByTestId("spectrum-clip")).toHaveAttribute("data-clipping", "false");
    act(() => lastOptions().onTierChange({ index: 0 }));
    expect(canvas.dataset.spectrumTier).toBe("0");
  });

  it("sizes the view from the canvas box and on every resize", () => {
    const rect = vi
      .spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 300, height: 190 } as DOMRect);
    render(<SpectrumCard soundOnPhone paused={false} />);
    expect(lastView().resize).toHaveBeenCalledWith(300, 190, window.devicePixelRatio);
    rect.mockReturnValue({ width: 200, height: 150 } as DOMRect);
    resizeCallback();
    expect(lastView().resize).toHaveBeenLastCalledWith(200, 150, window.devicePixelRatio);
    rect.mockRestore();
  });

  it("refreshes the theme on a theme attribute change and ignores unrelated ones", async () => {
    render(<SpectrumCard soundOnPhone paused={false} />);
    document.documentElement.setAttribute("data-unrelated", "x");
    document.documentElement.setAttribute("data-theme", "dark");
    await waitFor(() => expect(lastView().refreshTheme).toHaveBeenCalled());
    document.documentElement.removeAttribute("data-unrelated");
    document.documentElement.removeAttribute("data-theme");
  });

  it("tells the view when the document is hidden or shown again", () => {
    render(<SpectrumCard soundOnPhone paused={false} />);
    expect(lastView().setDocumentShowing).toHaveBeenLastCalledWith(true);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(lastView().setDocumentShowing).toHaveBeenLastCalledWith(false);
    hidden.mockRestore();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(lastView().setDocumentShowing).toHaveBeenLastCalledWith(true);
  });

  it("recreates the view for a new display profile and disposes the old one, with profile sizing", () => {
    state.profile = "compact";
    const component = render(<SpectrumCard soundOnPhone paused={false} />);
    expect(created.views).toHaveLength(1);
    expect(lastOptions().profile).toBe("compact");
    expect(screen.getByTestId("spectrum-canvas")).toHaveStyle({ height: "194px" });
    expect(screen.getByText("Clip")).toHaveClass("sr-only");
    const compactView = lastView();
    state.profile = "expanded";
    component.rerender(<SpectrumCard soundOnPhone paused={false} />);
    expect(compactView.dispose).toHaveBeenCalled();
    expect(created.views).toHaveLength(2);
    expect(lastOptions().profile).toBe("expanded");
    expect(lastView().setState).toHaveBeenLastCalledWith({ visible: true, paused: false });
    expect(screen.getByTestId("spectrum-canvas")).toHaveStyle({ height: "324px" });
    expect(screen.getByText("Clip")).not.toHaveClass("sr-only");
    state.profile = "unheard-of";
    component.rerender(<SpectrumCard soundOnPhone paused={false} />);
    expect(screen.getByTestId("spectrum-canvas")).toHaveStyle({ height: "274px" });
  });

  it("releases the view and its observers on unmount", () => {
    const removeListener = vi.spyOn(document, "removeEventListener");
    const component = render(<SpectrumCard soundOnPhone paused={false} />);
    const view = lastView();
    component.unmount();
    expect(view.dispose).toHaveBeenCalled();
    expect(resizeDisconnect).toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    removeListener.mockRestore();
    fireEvent(document, new Event("visibilitychange"));
    expect(view.setDocumentShowing).toHaveBeenCalledTimes(1);
  });
});

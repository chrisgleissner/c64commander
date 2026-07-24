/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvMirrorPreview } from "@/components/streams/AvMirrorPreview";

const mirror = vi.hoisted(() => ({
  canvasHook: vi.fn(),
  state: { videoLive: false, video: { state: "off", fps: 0 } },
}));

vi.mock("@/hooks/useAvMirror", () => ({
  useAvMirror: () => ({ videoLive: mirror.state.videoLive, video: mirror.state.video }),
  useAvMirrorCanvas: (...args: unknown[]) => mirror.canvasHook(...args),
}));

describe("AvMirrorPreview", () => {
  beforeEach(() => {
    mirror.canvasHook.mockReset();
    mirror.state = { videoLive: false, video: { state: "off", fps: 0 } };
  });

  it("shows a 'Not watching' overlay and binds the canvas when off", () => {
    render(<AvMirrorPreview />);
    expect(screen.getByTestId("av-mirror-preview")).toHaveAttribute("data-size", "check");
    expect(screen.getByText("Not watching")).toBeInTheDocument();
    expect(mirror.canvasHook).toHaveBeenCalled();
  });

  it("maps connecting/error states to their overlays", () => {
    mirror.state.video = { state: "connecting", fps: 0 };
    const { rerender } = render(<AvMirrorPreview />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    mirror.state.video = { state: "error", fps: 0 };
    rerender(<AvMirrorPreview />);
    expect(screen.getByText("Video unavailable")).toBeInTheDocument();
  });

  it("hides the overlay and shows a standard + fps badge while live", () => {
    mirror.state = { videoLive: true, video: { state: "live", fps: 45, standard: "PAL" } };
    render(<AvMirrorPreview size="immersive" />);
    expect(screen.queryByText("Not watching")).toBeNull();
    expect(screen.getByTestId("av-mirror-preview")).toHaveAttribute("data-size", "immersive");
    expect(screen.getByTestId("av-mirror-fps")).toHaveTextContent("PAL 45 fps");
  });

  it("shows the detected NTSC standard in the badge", () => {
    mirror.state = { videoLive: true, video: { state: "live", fps: 56, standard: "NTSC" } };
    render(<AvMirrorPreview />);
    expect(screen.getByTestId("av-mirror-fps")).toHaveTextContent("NTSC 56 fps");
  });

  it("omits the fps badge when live but fps is still 0", () => {
    mirror.state = { videoLive: true, video: { state: "live", fps: 0 } };
    render(<AvMirrorPreview />);
    expect(screen.queryByTestId("av-mirror-fps")).toBeNull();
  });
});

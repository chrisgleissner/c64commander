/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvMirrorLivePip } from "@/components/streams/AvMirrorLivePip";

const mirror = vi.hoisted(() => ({
  stopAll: vi.fn(),
  state: { anyLive: false, videoLive: false },
}));

vi.mock("@/hooks/useAvMirror", () => ({
  useAvMirror: () => ({ anyLive: mirror.state.anyLive, videoLive: mirror.state.videoLive, stopAll: mirror.stopAll }),
}));

describe("AvMirrorLivePip", () => {
  beforeEach(() => {
    mirror.stopAll.mockReset();
    mirror.state = { anyLive: false, videoLive: false };
  });

  it("renders nothing when no stream is live", () => {
    const { container } = render(<AvMirrorLivePip />);
    expect(container.firstChild).toBeNull();
  });

  it("appears while a stream is live and stops all mirroring on tap", () => {
    mirror.state = { anyLive: true, videoLive: false };
    render(<AvMirrorLivePip />);
    const pip = screen.getByTestId("av-mirror-live-pip");
    expect(pip).toHaveAttribute("aria-label", expect.stringContaining("Live mirror active"));
    fireEvent.click(pip);
    expect(mirror.stopAll).toHaveBeenCalledTimes(1);
  });

  it("renders while video is live (eye glyph branch)", () => {
    mirror.state = { anyLive: true, videoLive: true };
    render(<AvMirrorLivePip />);
    expect(screen.getByTestId("av-mirror-live-pip")).toBeInTheDocument();
  });
});

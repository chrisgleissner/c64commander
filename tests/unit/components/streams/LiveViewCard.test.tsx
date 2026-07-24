/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LiveViewCard } from "@/components/streams/LiveViewCard";

const mirror = vi.hoisted(() => ({ state: { video: { state: "off" } } }));

vi.mock("@/hooks/useAvMirror", () => ({
  useAvMirror: () => ({ video: mirror.state.video }),
}));

vi.mock("@/components/streams/AvMirrorControls", () => ({
  AvMirrorControls: ({ showAudio, showVideo }: { showAudio?: boolean; showVideo?: boolean }) => (
    <div data-testid="controls" data-audio={String(showAudio)} data-video={String(showVideo)} />
  ),
}));

vi.mock("@/components/streams/AvMirrorPreview", () => ({
  AvMirrorPreview: ({ size }: { size?: string }) => <div data-testid="preview" data-size={size} />,
}));

vi.mock("@/components/streams/AvSyncPanel", () => ({
  AvSyncPanel: () => <div data-testid="av-sync-panel" />,
}));

describe("LiveViewCard", () => {
  beforeEach(() => {
    mirror.state = { video: { state: "off" } };
  });

  it("renders controls and a hint, with no preview while video is off", () => {
    render(<LiveViewCard />);
    expect(screen.getByTestId("live-view-card")).toBeInTheDocument();
    expect(screen.getByTestId("controls")).toBeInTheDocument();
    expect(screen.queryByTestId("preview")).toBeNull();
    expect(screen.queryByTestId("live-view-expand")).toBeNull();
    expect(screen.getByText(/Hear and see the running machine/)).toBeInTheDocument();
  });

  it("passes audio/video enablement to the controls and drops 'see' from the hint", () => {
    render(<LiveViewCard audioEnabled videoEnabled={false} />);
    const controls = screen.getByTestId("controls");
    expect(controls).toHaveAttribute("data-audio", "true");
    expect(controls).toHaveAttribute("data-video", "false");
    expect(screen.getByText(/^Hear the running machine\./)).toBeInTheDocument();
  });

  it("shows a collapsible check preview once video is active and expands to immersive", () => {
    mirror.state = { video: { state: "live" } };
    render(<LiveViewCard />);
    expect(screen.getByTestId("preview")).toHaveAttribute("data-size", "check");

    const expand = screen.getByTestId("live-view-expand");
    expect(expand).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(expand);
    expect(screen.getByTestId("preview")).toHaveAttribute("data-size", "immersive");
    expect(screen.getByTestId("live-view-expand")).toHaveAttribute("aria-pressed", "true");
  });

  it("does not offer the preview/expand when video is disabled even if a stream reports state", () => {
    mirror.state = { video: { state: "live" } };
    render(<LiveViewCard videoEnabled={false} />);
    expect(screen.queryByTestId("preview")).toBeNull();
    expect(screen.queryByTestId("live-view-expand")).toBeNull();
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvMirrorControls, LiveDot } from "@/components/streams/AvMirrorControls";

const mirror = vi.hoisted(() => ({
  toggleAudio: vi.fn(),
  toggleVideo: vi.fn(),
  state: {
    audioLive: false,
    videoLive: false,
    audio: { state: "off", error: null as string | null },
    video: { state: "off", error: null as string | null },
  },
}));

vi.mock("@/hooks/useAvMirror", () => ({
  useAvMirror: () => ({
    audioLive: mirror.state.audioLive,
    videoLive: mirror.state.videoLive,
    audio: mirror.state.audio,
    video: mirror.state.video,
    toggleAudio: mirror.toggleAudio,
    toggleVideo: mirror.toggleVideo,
  }),
}));

describe("AvMirrorControls", () => {
  beforeEach(() => {
    mirror.toggleAudio.mockReset();
    mirror.toggleVideo.mockReset();
    mirror.state = {
      audioLive: false,
      videoLive: false,
      audio: { state: "off", error: null },
      video: { state: "off", error: null },
    };
  });

  it("shows idle Listen/Watch labels and toggles on click", () => {
    render(<AvMirrorControls />);
    const audio = screen.getByTestId("av-audio-toggle");
    const video = screen.getByTestId("av-video-toggle");
    expect(audio).toHaveTextContent("Listen");
    expect(video).toHaveTextContent("Watch");
    expect(audio).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(audio);
    fireEvent.click(video);
    expect(mirror.toggleAudio).toHaveBeenCalledTimes(1);
    expect(mirror.toggleVideo).toHaveBeenCalledTimes(1);
  });

  it("reflects live and connecting states", () => {
    mirror.state.audioLive = true;
    mirror.state.audio = { state: "live", error: null };
    mirror.state.video = { state: "connecting", error: null };
    render(<AvMirrorControls />);
    expect(screen.getByTestId("av-audio-toggle")).toHaveTextContent("Listening");
    expect(screen.getByTestId("av-audio-toggle")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("av-video-toggle")).toHaveTextContent("Connecting…");
    expect(screen.getByTestId("av-audio-toggle")).toHaveAttribute("data-state", "live");
  });

  it("shows the Watching label and a live dot while video streams", () => {
    mirror.state.videoLive = true;
    mirror.state.video = { state: "live", error: null };
    render(<AvMirrorControls />);
    const video = screen.getByTestId("av-video-toggle");
    expect(video).toHaveTextContent("Watching");
    expect(video).toHaveAttribute("aria-pressed", "true");
  });

  it("surfaces a stream error", () => {
    mirror.state.audio = { state: "error", error: "Lost the audio stream connection." };
    render(<AvMirrorControls />);
    const alert = screen.getByTestId("av-mirror-error");
    expect(alert).toHaveTextContent("Lost the audio stream connection.");
    expect(alert).toHaveAttribute("role", "alert");
  });

  it("can hide either toggle", () => {
    const { rerender } = render(<AvMirrorControls showVideo={false} />);
    expect(screen.queryByTestId("av-video-toggle")).toBeNull();
    expect(screen.getByTestId("av-audio-toggle")).toBeInTheDocument();
    rerender(<AvMirrorControls showAudio={false} />);
    expect(screen.queryByTestId("av-audio-toggle")).toBeNull();
    expect(screen.getByTestId("av-video-toggle")).toBeInTheDocument();
  });

  it("LiveDot renders an aria-hidden marker", () => {
    const { container } = render(<LiveDot />);
    expect(container.firstChild).toHaveAttribute("aria-hidden");
  });
});

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
import { loadMirrorC64Audio, loadMirrorC64Video } from "@/lib/config/appSettings";

interface SenderMismatchState {
  source: string;
  expected: string | null;
  rejectedPackets: number;
}

const mirror = vi.hoisted(() => ({
  toggleAudio: vi.fn(),
  toggleVideo: vi.fn(),
  adoptSender: vi.fn(async () => {}),
  state: {
    audioLive: false,
    videoLive: false,
    audio: {
      state: "off",
      error: null as string | null,
      foreignSenderNotice: null as string | null,
      senderMismatch: null as SenderMismatchState | null,
    },
    video: { state: "off", error: null as string | null, senderMismatch: null as SenderMismatchState | null },
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
    session: { adoptSender: mirror.adoptSender },
  }),
}));

describe("AvMirrorControls", () => {
  beforeEach(() => {
    mirror.toggleAudio.mockReset();
    mirror.toggleVideo.mockReset();
    mirror.adoptSender.mockReset();
    mirror.state = {
      audioLive: false,
      videoLive: false,
      audio: { state: "off", error: null, foreignSenderNotice: null, senderMismatch: null },
      video: { state: "off", error: null, senderMismatch: null },
    };
  });

  // HARD27-005: the stream IS arriving, from the Ultimate's other interface. The plugin knows that
  // address, so the card offers it instead of reporting that the stream stopped.
  it("offers the address the packets are actually arriving from as a one-tap recovery", () => {
    mirror.state.videoLive = true;
    mirror.state.video = {
      state: "error",
      error:
        "Video packets are arriving from 192.168.1.148 and being dropped — the app is only accepting packets from 192.168.1.9.",
      senderMismatch: { source: "192.168.1.148", expected: "192.168.1.9", rejectedPackets: 27400 },
    };
    render(<AvMirrorControls />);
    const adopt = screen.getByTestId("av-mirror-adopt-sender");
    expect(adopt).toHaveTextContent("Use 192.168.1.148");

    fireEvent.click(adopt);
    expect(mirror.adoptSender).toHaveBeenCalledWith("192.168.1.148");
  });

  it("offers no recovery when no sender mismatch was diagnosed", () => {
    mirror.state.video = { state: "error", error: "The video stream stopped arriving.", senderMismatch: null };
    render(<AvMirrorControls />);
    expect(screen.queryByTestId("av-mirror-adopt-sender")).toBeNull();
  });

  // HARD27-019: the second Ultimate that would not stop is reported here rather than through the
  // app-wide password dialog, which would name a machine the user never selected.
  it("names an uninvited second Ultimate as a status hint, not as an error", () => {
    mirror.state.audioLive = true;
    mirror.state.audio = {
      state: "live",
      error: null,
      foreignSenderNotice:
        "Another Ultimate at 192.168.1.15 is also streaming into this group; stop it on that machine.",
      senderMismatch: null,
    };
    render(<AvMirrorControls />);
    const notice = screen.getByTestId("av-mirror-foreign-sender-notice");
    expect(notice).toHaveTextContent("192.168.1.15");
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("av-mirror-error")).toBeNull();
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
    mirror.state.audio = { state: "live", error: null, foreignSenderNotice: null, senderMismatch: null };
    mirror.state.video = { state: "connecting", error: null, senderMismatch: null };
    render(<AvMirrorControls />);
    expect(screen.getByTestId("av-audio-toggle")).toHaveTextContent("Listening");
    expect(screen.getByTestId("av-audio-toggle")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("av-video-toggle")).toHaveTextContent("Connecting…");
    expect(screen.getByTestId("av-audio-toggle")).toHaveAttribute("data-state", "live");
  });

  it("shows the Watching label and a live dot while video streams", () => {
    mirror.state.videoLive = true;
    mirror.state.video = { state: "live", error: null, senderMismatch: null };
    render(<AvMirrorControls />);
    const video = screen.getByTestId("av-video-toggle");
    expect(video).toHaveTextContent("Watching");
    expect(video).toHaveAttribute("aria-pressed", "true");
  });

  it("surfaces a stream error", () => {
    mirror.state.audio = {
      state: "error",
      foreignSenderNotice: null,
      senderMismatch: null,
      error: "Lost the audio stream connection.",
    };
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

  it("records the answer each toggle gives, so Game Mode can open the way it was left", () => {
    localStorage.clear();
    render(<AvMirrorControls />);

    fireEvent.click(screen.getByTestId("av-video-toggle"));
    fireEvent.click(screen.getByTestId("av-audio-toggle"));
    expect(loadMirrorC64Video()).toBe(true);
    expect(loadMirrorC64Audio()).toBe(true);
  });

  it("remembers Watch being turned off for a television session", () => {
    localStorage.clear();
    mirror.state.videoLive = true;
    mirror.state.video = { state: "live", error: null, senderMismatch: null };
    render(<AvMirrorControls />);

    fireEvent.click(screen.getByTestId("av-video-toggle"));
    expect(loadMirrorC64Video()).toBe(false);
  });

  it("LiveDot renders an aria-hidden marker", () => {
    const { container } = render(<LiveDot />);
    expect(container.firstChild).toHaveAttribute("aria-hidden");
  });
});

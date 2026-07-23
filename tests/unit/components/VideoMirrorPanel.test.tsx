/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { StreamReceiver, StreamConnectionState } from "@/lib/streams/streamReceiver";
import { VIC_HEADER_BYTES, VIC_BYTES_PER_LINE, VIC_LAST_LINE_FLAG } from "@/lib/streams/vicStream";
import { VIC_FRAME_WIDTH } from "@/lib/streams/vicDecode";

const startStream = vi.fn(async () => ({ errors: [] }));
const stopStream = vi.fn(async () => ({ errors: [] }));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ startStream, stopStream }),
}));

import { VideoMirrorPanel } from "@/components/streams/VideoMirrorPanel";

class FakeReceiver implements StreamReceiver {
  datagram: ((data: Uint8Array) => void) | null = null;
  stateCb: ((s: StreamConnectionState) => void) | null = null;
  readonly destination = "10.0.0.5:11000";
  closed = false;
  onDatagram(handler: (data: Uint8Array) => void) {
    this.datagram = handler;
  }
  onStateChange(handler: (s: StreamConnectionState) => void) {
    this.stateCb = handler;
  }
  close() {
    this.closed = true;
  }
  emitState(s: StreamConnectionState) {
    this.stateCb?.(s);
  }
  emit(bytes: Uint8Array) {
    this.datagram?.(bytes);
  }
}

const completeFramePacket = () => {
  const packet = new Uint8Array(VIC_HEADER_BYTES + VIC_BYTES_PER_LINE);
  const view = new DataView(packet.buffer);
  view.setUint16(0, 0, true); // seq
  view.setUint16(2, 0, true); // frame
  view.setUint16(4, VIC_LAST_LINE_FLAG, true); // line 0 + last-line flag
  view.setUint16(6, VIC_FRAME_WIDTH, true); // width
  packet[8] = 1; // linesPerPacket
  packet[9] = 4; // bpp
  return packet;
};

describe("VideoMirrorPanel", () => {
  beforeEach(() => {
    startStream.mockClear();
    stopStream.mockClear();
  });

  it("renders its structure and testids with a not-connected overlay", () => {
    render(<VideoMirrorPanel mirrorOptions={{ createReceiver: () => new FakeReceiver() }} />);
    expect(screen.getByTestId("video-mirror-panel")).toBeInTheDocument();
    expect(screen.getByTestId("video-mirror-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("video-mirror-state")).toHaveTextContent("Off");
    expect(screen.getByTestId("video-mirror-overlay")).toHaveTextContent("Not connected");
    expect(screen.getByTestId("video-mirror-toggle")).toHaveTextContent("Watch");
  });

  it("starts the stream and flips the toggle label + state badge on live", async () => {
    const receiver = new FakeReceiver();
    render(<VideoMirrorPanel mirrorOptions={{ createReceiver: () => receiver }} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("video-mirror-toggle"));
    });
    expect(startStream).toHaveBeenCalledWith("video", "10.0.0.5:11000");

    await act(async () => {
      receiver.emitState("open");
    });
    expect(screen.getByTestId("video-mirror-state")).toHaveTextContent("Live");
    expect(screen.getByTestId("video-mirror-toggle")).toHaveTextContent("Stop");
    // Overlay disappears once live.
    expect(screen.queryByTestId("video-mirror-overlay")).toBeNull();
  });

  it("stops the stream and restores the Watch label", async () => {
    const receiver = new FakeReceiver();
    render(<VideoMirrorPanel mirrorOptions={{ createReceiver: () => receiver }} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("video-mirror-toggle"));
    });
    await act(async () => {
      receiver.emitState("open");
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("video-mirror-toggle"));
    });
    expect(stopStream).toHaveBeenCalledWith("video");
    expect(screen.getByTestId("video-mirror-toggle")).toHaveTextContent("Watch");
    expect(screen.getByTestId("video-mirror-state")).toHaveTextContent("Off");
  });

  it("no-ops safely when the canvas 2d context is unavailable (jsdom)", async () => {
    const receiver = new FakeReceiver();
    render(<VideoMirrorPanel mirrorOptions={{ createReceiver: () => receiver }} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("video-mirror-toggle"));
    });
    await act(async () => {
      receiver.emitState("open");
    });
    // Delivering a complete frame must not throw even though getContext("2d") is null.
    expect(() => {
      act(() => {
        receiver.emit(completeFramePacket());
      });
    }).not.toThrow();
    expect(screen.getByTestId("video-mirror-state")).toHaveTextContent("Live");
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

const getTraceContextSnapshotMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tracing/traceContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tracing/traceContext")>()),
  getTraceContextSnapshot: getTraceContextSnapshotMock,
}));

import { resolveNativeTraceContext } from "@/lib/native/nativeTraceContext";

describe("resolveNativeTraceContext", () => {
  it("returns nulls when action and playback context are unavailable", () => {
    getTraceContextSnapshotMock.mockReturnValue({ playback: null });

    expect(resolveNativeTraceContext()).toEqual({
      correlationId: null,
      trackInstanceId: null,
      playlistItemId: null,
    });
  });

  it("returns action and playback identifiers when present", () => {
    getTraceContextSnapshotMock.mockReturnValue({
      playback: {
        isPlaying: true,
        trackInstanceId: 42,
        playlistItemId: "item-42",
      },
    });

    expect(resolveNativeTraceContext({ correlationId: "corr-42" } as never)).toEqual({
      correlationId: "corr-42",
      trackInstanceId: 42,
      playlistItemId: "item-42",
    });
  });

  it("leaves out the playlist's current tune while nothing is playing", () => {
    getTraceContextSnapshotMock.mockReturnValue({
      playback: { isPlaying: false, trackInstanceId: 0, playlistItemId: "radio:/MUSICIANS/B/Bizet/Hyper_Speed.sid#1" },
    });

    expect(resolveNativeTraceContext({ correlationId: "browse-1" } as never)).toEqual({
      correlationId: "browse-1",
      trackInstanceId: null,
      playlistItemId: null,
    });
  });
});

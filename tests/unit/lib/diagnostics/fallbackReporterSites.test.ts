import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFallbackReporterForTests, setFallbackReporter } from "@/lib/diagnostics/fallbackReporter";
import { normalizeSavedDeviceHostInput } from "@/lib/savedDevices/host";
import { buildNetworkSnapshot } from "@/lib/diagnostics/networkSnapshot";

vi.mock("@/lib/tracing/traceSession", () => ({
  getTraceEvents: vi.fn(() => []),
}));

import { getTraceEvents } from "@/lib/tracing/traceSession";

const ctx = {
  lifecycleState: "foreground",
  sourceKind: null,
  localAccessMode: null,
  trackInstanceId: null,
  playlistItemId: null,
} as const;

describe("recover-and-continue sites report their fallback", () => {
  let sink: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetFallbackReporterForTests();
    sink = vi.fn();
    setFallbackReporter(sink);
  });

  afterEach(() => {
    resetFallbackReporterForTests();
  });

  it("reports a saved-device host that carries a scheme but is not a URL", () => {
    // `[` opens an IPv6 literal that is never closed, so `new URL` throws.
    expect(normalizeSavedDeviceHostInput("http://[c64u")).toBe("c64u");

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toBe("savedDevices.normalizeSavedDeviceHostInput");
    expect(sink.mock.calls[0][2]).toEqual({ fallbackHost: "c64u" });
  });

  it("stays quiet for the ordinary bare host, which is not a failure", () => {
    expect(normalizeSavedDeviceHostInput("c64u")).toBe("c64u");
    expect(normalizeSavedDeviceHostInput("192.168.1.64:8080")).toBe("192.168.1.64:8080");

    expect(sink).not.toHaveBeenCalled();
  });

  it("does not log from the network snapshot, which is itself a diagnostics export", () => {
    vi.mocked(getTraceEvents).mockReturnValue([
      {
        id: "1",
        timestamp: "2026-03-02T10:00:00.000Z",
        relativeMs: 1,
        type: "rest-request",
        origin: "user",
        correlationId: "a",
        data: { ...ctx, url: "not-a-url", method: "GET" },
      },
    ] as never);

    const snapshot = buildNetworkSnapshot();

    // The snapshot carries the failure itself: the raw URL next to a null hostname. Reporting it
    // through the sink would write into the log the export is collecting.
    expect(snapshot.requests[0].url).toBe("not-a-url");
    expect(snapshot.requests[0].hostname).toBeNull();
    expect(sink).not.toHaveBeenCalled();
  });
});

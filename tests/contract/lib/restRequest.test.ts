import { afterEach, describe, expect, it, vi } from "vitest";
import { createRestRequest } from "./restRequest.js";
import type { RestClient } from "./restClient.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createRestRequest breakpoint tracing", () => {
  it("logs deterministic shared-path rest-trace entries with breakpoint metadata", async () => {
    const log = vi.fn();
    const onTrace = vi.fn();
    const client = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        data: { ok: true },
        headers: { "content-type": "application/json" },
        requestHeaders: { "x-test": "1" },
        latencyMs: 12,
        correlationId: "corr-1",
      }),
    };

    const request = createRestRequest(client as unknown as RestClient, {
      mode: "STRESS",
      breakpointTrace: {
        runId: "run-123",
        log,
        getDefaults: () => ({
          stageId: "stage-01-r2000-c1",
          concurrencyLevel: 1,
          rateDelayMs: 2000,
        }),
        onTrace,
      },
    });

    const response = await request({
      method: "PUT",
      url: "/v1/configs/Audio%20Mixer/Vol%20Socket%201",
      params: { value: "+1 dB" },
      trace: {
        clientId: "client-1",
        target: {
          category: "Audio Mixer",
          item: "Vol Socket 1",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(onTrace).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(onTrace.mock.calls[0][0]).toMatchObject({
      runId: "run-123",
      stageId: "stage-01-r2000-c1",
      requestSequence: 1,
      attempt: 1,
      clientId: "client-1",
      method: "PUT",
      url: "/v1/configs/Audio%20Mixer/Vol%20Socket%201",
      params: { value: "+1 dB" },
      responseStatus: 200,
      concurrencyLevel: 1,
      rateDelayMs: 2000,
      target: {
        category: "Audio Mixer",
        item: "Vol Socket 1",
      },
      willRetry: false,
    });
  });

  it("defaults breakpoint runs to zero retries for failed responses", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        status: 503,
        data: { errors: ["fail"] },
        headers: {},
        requestHeaders: {},
        latencyMs: 9,
        correlationId: "corr-2",
      }),
    };

    const request = createRestRequest(client as unknown as RestClient, {
      mode: "STRESS",
      breakpointTrace: {
        runId: "run-123",
        log: vi.fn(),
        getDefaults: () => ({ stageId: "stage-01-r2000-c1", concurrencyLevel: 1, rateDelayMs: 2000 }),
        onTrace: vi.fn(),
      },
    });

    const response = await request({ method: "PUT", url: "/v1/configs/test", trace: { clientId: "client-1" } });
    expect(response.status).toBe(503);
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("preserves jittered STRESS retries when breakpoint tracing is disabled", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.37);
    const client = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          status: 503,
          data: { errors: ["retry"] },
          headers: {},
          requestHeaders: {},
          latencyMs: 4,
          correlationId: "corr-retry-1",
        })
        .mockResolvedValueOnce({
          status: 200,
          data: { ok: true },
          headers: {},
          requestHeaders: {},
          latencyMs: 5,
          correlationId: "corr-retry-2",
        }),
    };

    const request = createRestRequest(client as unknown as RestClient, {
      mode: "STRESS",
    });

    const responsePromise = request({ method: "GET", url: "/v1/configs/test" });
    await vi.runAllTimersAsync();
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("REST retryable response", {
      status: 503,
      attempt: 0,
      waitMs: 237,
    });
  });
});

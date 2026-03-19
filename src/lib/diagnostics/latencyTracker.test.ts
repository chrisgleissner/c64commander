/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyEndpoint,
  clearLatencySamples,
  computeLatencyPercentiles,
  getAllLatencySamples,
  getLatencySamples,
  recordLatencySample,
} from "@/lib/diagnostics/latencyTracker";

beforeEach(() => {
  clearLatencySamples();
  vi.useFakeTimers();
});

afterEach(() => {
  clearLatencySamples();
  vi.useRealTimers();
});

// ─── classifyEndpoint ─────────────────────────────────────────────────────────

describe("classifyEndpoint", () => {
  it("classifies /v1/info as Info", () => {
    expect(classifyEndpoint("REST", "/v1/info")).toBe("Info");
  });

  it("classifies /v1/info/extra as Info", () => {
    expect(classifyEndpoint("REST", "/v1/info/extra")).toBe("Info");
  });

  it("classifies /v1/configs exactly as Configs (full tree)", () => {
    expect(classifyEndpoint("REST", "/v1/configs")).toBe("Configs (full tree)");
  });

  it("classifies /v1/configs/Audio as Config items", () => {
    expect(classifyEndpoint("REST", "/v1/configs/Audio")).toBe("Config items");
  });

  it("classifies /v1/drives as Drives", () => {
    expect(classifyEndpoint("REST", "/v1/drives")).toBe("Drives");
  });

  it("classifies /v1/machine as Machine control", () => {
    expect(classifyEndpoint("REST", "/v1/machine")).toBe("Machine control");
  });

  it("classifies /v1/runners as Machine control", () => {
    expect(classifyEndpoint("REST", "/v1/runners")).toBe("Machine control");
  });

  it("classifies /v1/streams as Machine control", () => {
    expect(classifyEndpoint("REST", "/v1/streams")).toBe("Machine control");
  });

  it("classifies unknown REST path as Other", () => {
    expect(classifyEndpoint("REST", "/v1/unknown")).toBe("Other");
  });

  it("classifies FTP /v1/ftp/list as FTP list", () => {
    expect(classifyEndpoint("FTP", "/v1/ftp/list")).toBe("FTP list");
  });

  it("classifies FTP root path as FTP list", () => {
    expect(classifyEndpoint("FTP", "/")).toBe("FTP list");
  });

  it("classifies empty FTP path as FTP list", () => {
    expect(classifyEndpoint("FTP", "")).toBe("FTP list");
  });

  it("classifies FTP /v1/ftp/read as FTP read", () => {
    expect(classifyEndpoint("FTP", "/v1/ftp/read")).toBe("FTP read");
  });

  it("classifies unknown FTP path as FTP list (default)", () => {
    expect(classifyEndpoint("FTP", "/v1/ftp/upload")).toBe("FTP list");
  });
});

// ─── recordLatencySample + clearLatencySamples ────────────────────────────────

describe("recordLatencySample", () => {
  it("records a sample retrievable via getLatencySamples", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    recordLatencySample("REST", "/v1/info", 42);
    const samples = getLatencySamples();
    expect(samples).toHaveLength(1);
    expect(samples[0].durationMs).toBe(42);
    expect(samples[0].transport).toBe("REST");
    expect(samples[0].endpoint).toBe("Info");
  });

  it("records multiple samples in order", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    recordLatencySample("REST", "/v1/info", 10);
    recordLatencySample("FTP", "/", 20);
    const samples = getLatencySamples();
    expect(samples).toHaveLength(2);
    expect(samples[0].durationMs).toBe(10);
    expect(samples[1].durationMs).toBe(20);
  });

  it("prunes samples older than 5 minutes", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    recordLatencySample("REST", "/v1/info", 10);

    // Advance 6 minutes — first sample is now outside the window
    vi.advanceTimersByTime(6 * 60 * 1000);
    recordLatencySample("REST", "/v1/info", 20);

    const samples = getLatencySamples();
    expect(samples).toHaveLength(1);
    expect(samples[0].durationMs).toBe(20);
  });

  it("clearLatencySamples removes all samples", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    recordLatencySample("REST", "/v1/info", 10);
    clearLatencySamples();
    expect(getLatencySamples()).toHaveLength(0);
  });
});

// ─── getLatencySamples filtering ─────────────────────────────────────────────

describe("getLatencySamples filtering", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    recordLatencySample("REST", "/v1/info", 10);
    recordLatencySample("FTP", "/", 20);
    recordLatencySample("REST", "/v1/configs", 30);
  });

  it("returns all samples with no filter", () => {
    expect(getLatencySamples()).toHaveLength(3);
  });

  it("filters by transport", () => {
    const samples = getLatencySamples({ transports: new Set(["FTP"]) });
    expect(samples).toHaveLength(1);
    expect(samples[0].transport).toBe("FTP");
  });

  it("filters by endpoint class", () => {
    const samples = getLatencySamples({
      endpoints: new Set(["Configs (full tree)"]),
    });
    expect(samples).toHaveLength(1);
    expect(samples[0].durationMs).toBe(30);
  });

  it("combines transport and endpoint filters", () => {
    const samples = getLatencySamples({
      transports: new Set(["REST"]),
      endpoints: new Set(["Info"]),
    });
    expect(samples).toHaveLength(1);
    expect(samples[0].durationMs).toBe(10);
  });

  it("returns empty when filter matches nothing", () => {
    const samples = getLatencySamples({ transports: new Set(["FTP"]), endpoints: new Set(["Info"]) });
    expect(samples).toHaveLength(0);
  });
});

// ─── getAllLatencySamples ─────────────────────────────────────────────────────

describe("getAllLatencySamples", () => {
  it("returns a snapshot copy of all samples", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    recordLatencySample("REST", "/v1/info", 5);
    recordLatencySample("FTP", "/", 15);
    const all = getAllLatencySamples();
    expect(all).toHaveLength(2);
  });
});

// ─── computeLatencyPercentiles ────────────────────────────────────────────────

describe("computeLatencyPercentiles", () => {
  it("returns zeros with no samples", () => {
    const result = computeLatencyPercentiles();
    expect(result).toEqual({ p50: 0, p90: 0, p99: 0, sampleCount: 0 });
  });

  it("returns correct percentiles for a single sample", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    recordLatencySample("REST", "/v1/info", 100);
    const result = computeLatencyPercentiles();
    expect(result.p50).toBe(100);
    expect(result.p90).toBe(100);
    expect(result.p99).toBe(100);
    expect(result.sampleCount).toBe(1);
  });

  it("uses nearest-rank method (deterministic) for 10 samples", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    // Insert in reverse order to verify sorting
    for (let i = 10; i >= 1; i--) {
      recordLatencySample("REST", "/v1/info", i * 10);
    }
    const result = computeLatencyPercentiles();
    // p50 of [10,20,...,100]: ceil(0.5 * 10) = 5 → index 4 → value 50
    expect(result.p50).toBe(50);
    // p90: ceil(0.9 * 10) = 9 → index 8 → value 90
    expect(result.p90).toBe(90);
    // p99: ceil(0.99 * 10) = 10 → index 9 → value 100
    expect(result.p99).toBe(100);
    expect(result.sampleCount).toBe(10);
  });

  it("filters samples by transport when computing percentiles", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    recordLatencySample("REST", "/v1/info", 50);
    recordLatencySample("FTP", "/", 200);
    const result = computeLatencyPercentiles({ transports: new Set(["REST"]) });
    expect(result.sampleCount).toBe(1);
    expect(result.p50).toBe(50);
  });

  it("returns zeros when filter excludes all samples", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    recordLatencySample("REST", "/v1/info", 50);
    const result = computeLatencyPercentiles({ transports: new Set(["FTP"]) });
    expect(result).toEqual({ p50: 0, p90: 0, p99: 0, sampleCount: 0 });
  });

  it("prunes expired samples before computing", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    recordLatencySample("REST", "/v1/info", 1000);
    vi.advanceTimersByTime(6 * 60 * 1000);
    const result = computeLatencyPercentiles();
    expect(result.sampleCount).toBe(0);
  });

  it("filters samples by endpoint class when computing percentiles", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    recordLatencySample("REST", "/v1/info", 30);
    recordLatencySample("REST", "/v1/configs/Audio/Vol", 120);
    const result = computeLatencyPercentiles({ endpoints: new Set(["Info"]) });
    expect(result.sampleCount).toBe(1);
    expect(result.p50).toBe(30);
  });
});

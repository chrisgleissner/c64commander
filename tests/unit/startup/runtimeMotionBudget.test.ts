import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLog } from "@/lib/logging";

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

describe("runtimeMotionBudget", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(addLog).mockReset();
    document.documentElement.classList.remove("c64-motion-reduced");
    delete document.documentElement.dataset.c64MotionMode;
  });

  it("uses user override when set to reduced", async () => {
    const { resolveRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    const resolution = resolveRuntimeMotionMode({
      localStorage: { getItem: () => "reduced" },
      navigator: {
        hardwareConcurrency: 8,
        userAgent: "android",
        deviceMemory: 8,
      },
      matchMedia: () => ({ matches: false }),
    });
    expect(resolution.mode).toBe("reduced");
    expect(resolution.reason).toBe("user-override");
  });

  it("uses system preference when prefers reduced motion is enabled", async () => {
    const { resolveRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    const resolution = resolveRuntimeMotionMode({
      localStorage: { getItem: () => null },
      navigator: {
        hardwareConcurrency: 8,
        userAgent: "android",
        deviceMemory: 8,
      },
      matchMedia: () => ({ matches: true }),
    });
    expect(resolution.mode).toBe("reduced");
    expect(resolution.reason).toBe("system-preference");
  });

  it("reduces motion on low-end hardware profile", async () => {
    const { resolveRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    const resolution = resolveRuntimeMotionMode({
      localStorage: { getItem: () => null },
      navigator: {
        hardwareConcurrency: 4,
        userAgent: "android",
        deviceMemory: 8,
      },
      matchMedia: () => ({ matches: false }),
    });
    expect(resolution.mode).toBe("reduced");
    expect(resolution.reason).toBe("low-end-device");
  });

  it("keeps standard mode on capable hardware with no preference", async () => {
    const { resolveRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    const resolution = resolveRuntimeMotionMode({
      localStorage: { getItem: () => null },
      navigator: {
        hardwareConcurrency: 8,
        userAgent: "android",
        deviceMemory: 8,
      },
      matchMedia: () => ({ matches: false }),
    });
    expect(resolution.mode).toBe("standard");
    expect(resolution.reason).toBe("default");
  });

  it("applies reduced mode marker on document root at initialization", async () => {
    const { initializeRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    const resolution = initializeRuntimeMotionMode({
      localStorage: { getItem: () => null },
      navigator: {
        hardwareConcurrency: 2,
        userAgent: "android",
        deviceMemory: 2,
      },
      matchMedia: () => ({ matches: false }),
      document,
    });
    expect(resolution.mode).toBe("reduced");
    expect(document.documentElement.dataset.c64MotionMode).toBe("reduced");
    expect(
      document.documentElement.classList.contains("c64-motion-reduced"),
    ).toBe(true);
    expect(addLog).toHaveBeenCalledWith(
      "info",
      "Runtime motion mode selected",
      expect.objectContaining({
        mode: "reduced",
        reason: "low-end-device",
      }),
    );
  });

  it("falls back to default mode for unknown override values", async () => {
    const { resolveRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    const resolution = resolveRuntimeMotionMode({
      localStorage: { getItem: () => "turbo" },
      navigator: {
        hardwareConcurrency: 8,
        userAgent: "android",
        deviceMemory: 8,
      },
      matchMedia: () => ({ matches: false }),
    });
    expect(resolution.mode).toBe("standard");
    expect(resolution.reason).toBe("default");
  });

  it("logs warning when matchMedia throws and keeps fallback mode", async () => {
    const { resolveRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    const resolution = resolveRuntimeMotionMode({
      localStorage: { getItem: () => null },
      navigator: {
        hardwareConcurrency: 8,
        userAgent: "android",
        deviceMemory: 8,
      },
      matchMedia: () => {
        throw new Error("matchMedia unavailable");
      },
    });
    expect(resolution.mode).toBe("standard");
    expect(resolution.reason).toBe("default");
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Failed to evaluate prefers-reduced-motion media query",
      expect.objectContaining({ error: "matchMedia unavailable" }),
    );
  });

  it("can resolve and apply runtime mode using default window environment", async () => {
    const { resolveRuntimeMotionMode, applyRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    const resolution = resolveRuntimeMotionMode();
    applyRuntimeMotionMode(resolution);
    expect(document.documentElement.dataset.c64MotionMode).toBe(
      resolution.mode,
    );
  });

  it("removes reduced motion class when mode is standard", async () => {
    const { applyRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    document.documentElement.classList.add("c64-motion-reduced");
    applyRuntimeMotionMode(
      {
        mode: "standard",
        reason: "default",
        hardwareConcurrency: 8,
        deviceMemoryGb: 8,
      },
      { document },
    );
    expect(
      document.documentElement.classList.contains("c64-motion-reduced"),
    ).toBe(false);
  });

  it("no-ops apply when document is unavailable", async () => {
    const { applyRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    expect(() =>
      applyRuntimeMotionMode(
        {
          mode: "reduced",
          reason: "low-end-device",
          hardwareConcurrency: 2,
          deviceMemoryGb: 2,
        },
        {},
      ),
    ).not.toThrow();
  });

  it("logs warning when storage access fails and falls back safely", async () => {
    const { resolveRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    const resolution = resolveRuntimeMotionMode({
      localStorage: {
        getItem: () => {
          throw new Error("storage unavailable");
        },
      },
      navigator: {
        hardwareConcurrency: 8,
        userAgent: "android",
        deviceMemory: 8,
      },
      matchMedia: () => ({ matches: false }),
    });
    expect(resolution.mode).toBe("standard");
    expect(resolution.reason).toBe("default");
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Failed to read runtime motion mode override",
      expect.objectContaining({ error: "storage unavailable" }),
    );
  });

  it("uses standard mode when override is set to a high-performance alias", async () => {
    // Covers the normalized === 'standard' || 'full' || 'high' branch in parseOverride
    const { resolveRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    const resolution = resolveRuntimeMotionMode({
      localStorage: { getItem: () => "high" },
      navigator: { hardwareConcurrency: 8, userAgent: "", deviceMemory: 8 },
      matchMedia: () => ({ matches: false }),
    });
    expect(resolution.mode).toBe("standard");
    expect(resolution.reason).toBe("user-override");
  });

  it("returns null override when environment has no localStorage", async () => {
    // Covers the if (!storage) return null branch in readMotionOverride
    // and navigator?.hardwareConcurrency optional chain when navigator is also absent
    const { resolveRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    const resolution = resolveRuntimeMotionMode({
      matchMedia: () => ({ matches: false }),
    });
    expect(resolution.mode).toBe("standard");
    expect(resolution.reason).toBe("default");
  });

  it("returns false for prefersReducedMotion when matchMedia is absent from environment", async () => {
    // Covers the if (!environment.matchMedia) return false branch
    const { resolveRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    const resolution = resolveRuntimeMotionMode({
      localStorage: { getItem: () => null },
      navigator: { hardwareConcurrency: 8, userAgent: "", deviceMemory: 8 },
      // matchMedia intentionally omitted
    });
    expect(resolution.mode).toBe("standard");
    expect(resolution.reason).toBe("default");
  });

  it("returns empty environment when window is not defined", async () => {
    // Covers the if (typeof window === 'undefined') return {} branch in defaultEnvironment
    const savedWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const { resolveRuntimeMotionMode } =
      await import("@/lib/startup/runtimeMotionBudget");
    // Calls resolveRuntimeMotionMode() with no args -> defaultEnvironment() -> returns {}
    const resolution = resolveRuntimeMotionMode();
    expect(resolution).toBeDefined();
    expect(resolution.mode).toBe("standard");

    Object.defineProperty(globalThis, "window", {
      value: savedWindow,
      configurable: true,
      writable: true,
    });
  });
});

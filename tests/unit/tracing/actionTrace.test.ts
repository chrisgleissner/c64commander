/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

const recordActionStart = vi.fn();
const recordActionEnd = vi.fn();
const recordActionScopeStart = vi.fn();
const recordActionScopeEnd = vi.fn();
const recordTraceError = vi.fn();

vi.mock("@/lib/tracing/traceSession", () => ({
  recordActionStart: (...args: unknown[]) => recordActionStart(...args),
  recordActionEnd: (...args: unknown[]) => recordActionEnd(...args),
  recordActionScopeStart: (...args: unknown[]) => recordActionScopeStart(...args),
  recordActionScopeEnd: (...args: unknown[]) => recordActionScopeEnd(...args),
  recordTraceError: (...args: unknown[]) => recordTraceError(...args),
}));

vi.mock("@/lib/tracing/traceIds", () => ({
  nextCorrelationId: () => "COR-0001",
}));

import {
  createActionContext,
  getActiveAction,
  resetActionTrace,
  runActionScope,
  runWithActionTrace,
  runWithImplicitAction,
} from "@/lib/tracing/actionTrace";

describe("actionTrace", () => {
  it("records action start/end and restores active action", async () => {
    const context = createActionContext("Test", "user", "Component");

    const result = await runWithActionTrace(context, async () => "ok");

    expect(result).toBe("ok");
    expect(recordActionStart).toHaveBeenCalledWith(context);
    expect(recordActionEnd).toHaveBeenCalledWith(context, null);
    expect(getActiveAction()).toBeNull();
  });

  it("records errors and rethrows", async () => {
    const context = createActionContext("Fail", "user");

    await expect(
      runWithActionTrace(context, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(recordTraceError).toHaveBeenCalled();
    expect(recordActionEnd).toHaveBeenCalledWith(context, expect.any(Error));
  });

  it("runs implicit actions with system origin", async () => {
    const result = await runWithImplicitAction("implicit", async (context) => {
      return context.origin;
    });

    expect(result).toBe("system");
    expect(recordActionStart).toHaveBeenCalled();
  });

  it("records scoped actions when active action exists", async () => {
    const context = createActionContext("Scoped", "user");
    await runWithActionTrace(context, async () => {
      await runActionScope("scope", async () => "ok");
    });

    expect(recordActionScopeStart).toHaveBeenCalledWith(context, "scope");
    expect(recordActionScopeEnd).toHaveBeenCalledWith(context, "scope", null);
  });

  it("executes scopes without active action", async () => {
    resetActionTrace();
    const result = await runActionScope("scope", async () => "plain");
    expect(result).toBe("plain");
  });

  it("propagates trigger into implicit action context", async () => {
    const trigger = {
      kind: "timer" as const,
      name: "connectivity.probe",
      intervalMs: 5000,
      details: null,
    };
    let capturedContext: Parameters<typeof recordActionStart>[0] | null = null;
    recordActionStart.mockImplementation((ctx: Parameters<typeof recordActionStart>[0]) => {
      capturedContext = ctx;
    });

    await runWithImplicitAction("probe", async () => "ok", trigger);

    expect(capturedContext).not.toBeNull();
    expect(capturedContext?.trigger).toEqual(trigger);
  });

  it("implicit action has null trigger when none provided", async () => {
    let capturedContext: Parameters<typeof recordActionStart>[0] | null = null;
    recordActionStart.mockImplementation((ctx: Parameters<typeof recordActionStart>[0]) => {
      capturedContext = ctx;
    });

    await runWithImplicitAction("no-trigger", async () => "ok");

    expect(capturedContext?.trigger).toBeNull();
  });
});

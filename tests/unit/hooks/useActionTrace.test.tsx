/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const createActionContext = vi.fn();
const runWithActionTrace = vi.fn();
const runActionScope = vi.fn();

vi.mock("@/lib/tracing/actionTrace", () => ({
  createActionContext: (...args: unknown[]) => createActionContext(...args),
  runWithActionTrace: (...args: unknown[]) => runWithActionTrace(...args),
  runActionScope: (...args: unknown[]) => runActionScope(...args),
}));

import { useActionTrace } from "@/hooks/useActionTrace";

/*
 * Replaces the global Error so that the hook's own `new Error()` carries `stack`. React 19 also calls
 * `Error(message)` without `new` for its owner stacks, so the replacement must stay callable and leave
 * those errors untouched.
 */
const stubHookErrorStack = (stack: string | undefined) => {
  const RealError = Error;
  function StackError(message?: string) {
    const error = new RealError(message);
    if (message === undefined) error.stack = stack as string;
    return error;
  }
  StackError.prototype = RealError.prototype;
  vi.stubGlobal("Error", StackError as unknown as typeof Error);
};

describe("useActionTrace", () => {
  it("wraps actions with inferred names", async () => {
    createActionContext.mockReset();
    runWithActionTrace.mockReset();
    createActionContext.mockReturnValue({ correlationId: "COR-1" });
    runWithActionTrace.mockImplementation((_ctx: unknown, fn: () => unknown) => fn());

    const { result } = renderHook(() => useActionTrace("Widget"));
    const doThing = (value: number) => value + 1;
    const handler = result.current(doThing);

    let output = 0;
    act(() => {
      output = handler(2);
    });

    expect(output).toBe(3);
    expect(createActionContext).toHaveBeenCalledWith("Widget.doThing", "user", "Widget");
    expect(runWithActionTrace).toHaveBeenCalled();
  });

  it("exposes action scope helper", async () => {
    const { result } = renderHook(() => useActionTrace("Widget"));

    await result.current.scope("scope", async () => undefined);

    expect(runActionScope).toHaveBeenCalledWith("scope", expect.any(Function));
  });

  it("infers component name from stack when not provided", () => {
    createActionContext.mockReset();
    runWithActionTrace.mockReset();
    createActionContext.mockReturnValue({ correlationId: "COR-2" });
    runWithActionTrace.mockImplementation((_ctx: unknown, fn: () => unknown) => fn());

    stubHookErrorStack("Error\n  at FakeComponent (fake.tsx:1:1)\n  at useActionTrace (hook.ts:1:1)");

    const { result } = renderHook(() => useActionTrace());
    const handler = result.current(function doThing() {
      return 42;
    });

    let output = 0;
    act(() => {
      output = handler();
    });

    expect(output).toBe(42);
    expect(createActionContext).toHaveBeenCalledWith("Error.doThing", "user", "Error");

    vi.unstubAllGlobals();
  });

  it("falls back to anonymous action naming", () => {
    createActionContext.mockReset();
    runWithActionTrace.mockReset();
    createActionContext.mockReturnValue({ correlationId: "COR-3" });
    runWithActionTrace.mockImplementation((_ctx: unknown, fn: () => unknown) => fn());

    const { result } = renderHook(() => useActionTrace("Widget"));
    const fn = () => 7;
    Object.defineProperty(fn, "name", { value: "" });
    const handler = result.current(fn);

    let output = 0;
    act(() => {
      output = handler();
    });

    expect(output).toBe(7);
    expect(createActionContext).toHaveBeenCalledWith("Widget.anonymousAction", "user", "Widget");
  });

  it("resolvedComponent is null when all stack frames are filtered (line 52 null fallback + line 17 true)", () => {
    createActionContext.mockReset();
    runWithActionTrace.mockReset();
    createActionContext.mockReturnValue({ correlationId: "COR-4" });
    runWithActionTrace.mockImplementation((_ctx: unknown, fn: () => unknown) => fn());

    // Stack only contains filtered frame names → candidates = []
    stubHookErrorStack(
      "\n  at useActionTrace (hook.ts:1:1)\n  at renderWithHooks (react.js:1:1)\n  at beginWork (react.js:2:1)",
    );

    const { result } = renderHook(() => useActionTrace());
    const fn = function myFunc() {
      return 99;
    };
    act(() => {
      result.current(fn)();
    });

    expect(createActionContext).toHaveBeenCalledWith("myFunc", "user", null);
    vi.unstubAllGlobals();
  });

  it("resolvedComponent is null when stack is undefined (line 25 true + line 17 false)", () => {
    createActionContext.mockReset();
    runWithActionTrace.mockReset();
    createActionContext.mockReturnValue({ correlationId: "COR-5" });
    runWithActionTrace.mockImplementation((_ctx: unknown, fn: () => unknown) => fn());

    stubHookErrorStack(undefined);

    const { result } = renderHook(() => useActionTrace());
    // Anonymous function (no name) covers inferActionName line 17 FALSE → "anonymousAction"
    const fn = () => 42;
    Object.defineProperty(fn, "name", { value: "" });
    act(() => {
      result.current(fn)();
    });

    expect(createActionContext).toHaveBeenCalledWith("anonymousAction", "user", null);
    vi.unstubAllGlobals();
  });
});

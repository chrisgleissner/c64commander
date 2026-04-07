import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "@/pages/playFiles/hooks/useDebouncedValue";

describe("useDebouncedValue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces rapid value changes into one committed update per 200ms interval", async () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: "" },
    });

    rerender({ value: "h" });
    rerender({ value: "hv" });
    rerender({ value: "hvs" });
    rerender({ value: "hvsc" });

    expect(result.current).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });

    expect(result.current).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(result.current).toBe("hvsc");
  });

  it("allows committed state to be restored immediately without waiting for a new debounce window", async () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: "demo" },
    });

    expect(result.current).toBe("demo");

    rerender({ value: "demo query" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(result.current).toBe("demo query");
  });
});

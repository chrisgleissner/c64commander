import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidateForVisibilityResume,
  resetVisibilityResumeInvalidationLedgerForTest,
} from "@/lib/query/c64QueryInvalidation";

describe("c64QueryInvalidation visibility resume", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetVisibilityResumeInvalidationLedgerForTest();
  });

  it("skips non-info invalidations when the route was resumed recently", () => {
    let nowMs = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    const queryClient = {
      invalidateQueries: vi.fn(),
      refetchQueries: vi.fn(),
    };

    invalidateForVisibilityResume(queryClient as never, "/");
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["c64-info"] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["c64-drives"] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["c64-config-items"] });

    queryClient.invalidateQueries.mockClear();
    nowMs += 1_000;

    invalidateForVisibilityResume(queryClient as never, "/");

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["c64-info"] });
    expect(queryClient.refetchQueries).not.toHaveBeenCalled();
  });

  it("re-invalidates non-info prefixes after the throttle window expires", () => {
    let nowMs = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    const queryClient = {
      invalidateQueries: vi.fn(),
      refetchQueries: vi.fn(),
    };

    invalidateForVisibilityResume(queryClient as never, "/");
    queryClient.invalidateQueries.mockClear();

    nowMs += 31_000;
    invalidateForVisibilityResume(queryClient as never, "/");

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["c64-info"] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["c64-drives"] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["c64-config-items"] });
    expect(queryClient.refetchQueries).not.toHaveBeenCalled();
  });
});

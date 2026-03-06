import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHvscLibrary } from "@/pages/playFiles/hooks/useHvscLibrary";

const addHvscProgressListenerMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: vi.fn(),
}));

vi.mock("@/lib/tracing/actionTrace", () => ({
  createActionContext: vi.fn(() => ({})),
  runWithActionTrace: vi.fn((_context, fn) => fn()),
}));

vi.mock("@/lib/hvsc", () => ({
  addHvscProgressListener: (...args: unknown[]) => addHvscProgressListenerMock(...args),
  cancelHvscInstall: vi.fn().mockResolvedValue(undefined),
  checkForHvscUpdates: vi.fn().mockResolvedValue({ latestVersion: 0, installedVersion: 0, requiredUpdates: [] }),
  clearHvscStatusSummary: vi.fn(),
  getDefaultHvscStatusSummary: vi.fn(() => ({
    download: { status: "idle" },
    extraction: { status: "idle" },
    lastUpdatedAt: null,
  })),
  getHvscCacheStatus: vi.fn().mockResolvedValue({ baselineVersion: null, updateVersions: [] }),
  getHvscFolderListing: vi.fn().mockResolvedValue({ path: "/", folders: [], songs: [] }),
  getHvscSong: vi.fn(),
  getHvscStatus: vi.fn().mockResolvedValue({
    installedVersion: 0,
    ingestionState: "idle",
    ingestionError: null,
    ingestionSummary: null,
  }),
  loadHvscRoot: vi.fn(() => ({ ready: false })),
  loadHvscStatusSummary: vi.fn(() => ({
    download: { status: "idle" },
    extraction: { status: "idle" },
    lastUpdatedAt: null,
  })),
  saveHvscStatusSummary: vi.fn(),
  ingestCachedHvsc: vi.fn().mockResolvedValue(undefined),
  installOrUpdateHvsc: vi.fn().mockResolvedValue(undefined),
  isHvscBridgeAvailable: vi.fn(() => true),
  recoverStaleIngestionState: vi.fn(),
}));

describe("useHvscLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a pending progress listener after unmount when registration resolves late", async () => {
    let resolveListener: ((value: { remove: () => Promise<void> }) => void) | null = null;
    const remove = vi.fn().mockResolvedValue(undefined);
    addHvscProgressListenerMock.mockImplementation(
      () =>
        new Promise<{ remove: () => Promise<void> }>((resolve) => {
          resolveListener = resolve;
        }),
    );

    const { unmount } = renderHook(() => useHvscLibrary());

    unmount();
    resolveListener?.({ remove });
    await Promise.resolve();
    await Promise.resolve();

    expect(remove).toHaveBeenCalledTimes(1);
  });
});
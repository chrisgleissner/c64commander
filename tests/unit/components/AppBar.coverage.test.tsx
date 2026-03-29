import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer from "react-test-renderer";

const renderWithImmediateLayoutEffect = async ({
  hasWindow = true,
  refCurrent = null as HTMLElement | null,
}: {
  hasWindow?: boolean;
  refCurrent?: HTMLElement | null;
}) => {
  vi.resetModules();

  vi.doMock("react", async () => {
    const actual = await vi.importActual<typeof import("react")>("react");
    return {
      ...actual,
      useLayoutEffect: (callback: () => void | (() => void)) => {
        callback();
      },
      useRef: () => ({ current: refCurrent }),
    };
  });

  vi.doMock("@/components/UnifiedHealthBadge", () => ({
    UnifiedHealthBadge: () => null,
  }));
  vi.doMock("@/hooks/useDisplayProfile", () => ({
    useDisplayProfile: () => ({ profile: "medium" }),
  }));
  vi.doMock("@/hooks/useScreenActivity", () => ({
    useScreenActivity: () => true,
  }));
  vi.doMock("@/components/layout/AppChromeContext", () => ({
    useAppChromeMode: () => "fixed",
  }));

  const originalWindow = global.window;
  if (!hasWindow) {
    // @ts-expect-error branch coverage: simulate non-browser runtime
    delete global.window;
  }

  try {
    const React = await import("react");
    const { AppBar } = await import("@/components/AppBar");
    expect(() => TestRenderer.create(React.createElement(AppBar, { title: "Diagnostics" }))).not.toThrow();
  } finally {
    Object.defineProperty(global, "window", {
      configurable: true,
      value: originalWindow,
      writable: true,
    });
  }
};

describe("AppBar coverage guards", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("react");
    vi.doUnmock("@/components/UnifiedHealthBadge");
    vi.doUnmock("@/hooks/useDisplayProfile");
    vi.doUnmock("@/hooks/useScreenActivity");
    vi.doUnmock("@/components/layout/AppChromeContext");
  });

  it("bails out cleanly when no browser window is available", async () => {
    await renderWithImmediateLayoutEffect({ hasWindow: false });
  });

  it("bails out cleanly when the header ref is not attached yet", async () => {
    await renderWithImmediateLayoutEffect({ refCurrent: null });
  });
});

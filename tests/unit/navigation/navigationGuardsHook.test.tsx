import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

const { mockUseLocation } = vi.hoisted(() => ({
  mockUseLocation: vi.fn(() => ({ key: "initial" })),
}));

vi.mock("react-router-dom", async () => {
  const ReactModule = await import("react");
  return {
    UNSAFE_NavigationContext: ReactModule.createContext({
      navigator: {},
    }),
    useLocation: mockUseLocation,
  };
});

import { UNSAFE_NavigationContext } from "react-router-dom";
import { useNavigationGuardBlocker } from "@/lib/navigation/navigationGuards";

describe("useNavigationGuardBlocker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLocation.mockReturnValue({ key: "initial" });
  });

  it("installs and cleans up a navigator blocker", () => {
    const unblock = vi.fn();
    const block = vi.fn(() => unblock);

    const Probe = () => {
      useNavigationGuardBlocker();
      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <UNSAFE_NavigationContext.Provider value={{ navigator: { block } }}>
          <Probe />
        </UNSAFE_NavigationContext.Provider>,
      );
    });

    expect(block).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.unmount();
    });

    expect(unblock).toHaveBeenCalledTimes(1);
  });

  it("reinstalls the blocker when the location key changes", () => {
    const firstUnblock = vi.fn();
    const secondUnblock = vi.fn();
    const block = vi.fn().mockReturnValueOnce(firstUnblock).mockReturnValueOnce(secondUnblock);

    const Probe = () => {
      useNavigationGuardBlocker();
      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <UNSAFE_NavigationContext.Provider value={{ navigator: { block } }}>
          <Probe />
        </UNSAFE_NavigationContext.Provider>,
      );
    });

    mockUseLocation.mockReturnValue({ key: "next" });

    act(() => {
      renderer.update(
        <UNSAFE_NavigationContext.Provider value={{ navigator: { block } }}>
          <Probe />
        </UNSAFE_NavigationContext.Provider>,
      );
    });

    expect(firstUnblock).toHaveBeenCalledTimes(1);
    expect(block).toHaveBeenCalledTimes(2);

    act(() => {
      renderer.unmount();
    });

    expect(secondUnblock).toHaveBeenCalledTimes(1);
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, renderHook, act, screen } from "@testing-library/react";
import type { FeatureFlagSnapshot, FeatureFlagKey } from "@/lib/config/featureFlags";

const mockSnapshot: FeatureFlagSnapshot = {
  flags: {
    hvsc_enabled: true,
    commoserve_enabled: true,
    lighting_studio_enabled: false,
    reu_snapshot_enabled: false,
  },
  resolved: {
    hvsc_enabled: {
      id: "hvsc_enabled",
      definition: {
        id: "hvsc_enabled",
        enabled: true,
        visible_to_user: true,
        developer_only: false,
        group: "stable",
        title: "HVSC downloads",
        description: "Show HVSC download and ingest controls on the Play page.",
      },
      value: true,
      hasOverride: false,
      overrideValue: null,
      visible: true,
      editable: true,
    },
    commoserve_enabled: {
      id: "commoserve_enabled",
      definition: {
        id: "commoserve_enabled",
        enabled: true,
        visible_to_user: true,
        developer_only: false,
        group: "stable",
        title: "CommoServe",
        description: "Show the CommoServe source in Add Items and Online Archive flows.",
      },
      value: true,
      hasOverride: false,
      overrideValue: null,
      visible: true,
      editable: true,
    },
    lighting_studio_enabled: {
      id: "lighting_studio_enabled",
      definition: {
        id: "lighting_studio_enabled",
        enabled: false,
        visible_to_user: false,
        developer_only: true,
        group: "experimental",
        title: "Lighting Studio",
        description: "Enable Lighting Studio entry points and dialog access.",
      },
      value: false,
      hasOverride: false,
      overrideValue: null,
      visible: false,
      editable: false,
    },
    reu_snapshot_enabled: {
      id: "reu_snapshot_enabled",
      definition: {
        id: "reu_snapshot_enabled",
        enabled: false,
        visible_to_user: false,
        developer_only: true,
        group: "experimental",
        title: "REU Snapshots",
        description: "Enable Save REU and Restore REU Snapshot functionality.",
      },
      value: false,
      hasOverride: false,
      overrideValue: null,
      visible: false,
      editable: false,
    },
  },
  developerMode: false,
  isLoaded: false,
};

const mockSubscribe = vi.fn((listener: (s: FeatureFlagSnapshot) => void) => {
  listener(mockSnapshot);
  return () => { };
});

const mockLoad = vi.fn(async () => { });
const mockSetFlag = vi.fn(async (_key: FeatureFlagKey, _value: boolean) => { });
const mockClearOverride = vi.fn(async (_key: FeatureFlagKey) => { });
const mockSubscribeToDeveloperMode = vi.fn(() => () => { });
const mockGetSnapshot = vi.fn(() => mockSnapshot);

vi.mock("@/lib/config/featureFlags", () => ({
  featureFlagManager: {
    getSnapshot: () => mockGetSnapshot(),
    subscribe: (...args: Parameters<typeof mockSubscribe>) => mockSubscribe(...args),
    load: () => mockLoad(),
    setFlag: (...args: Parameters<typeof mockSetFlag>) => mockSetFlag(...args),
    clearOverride: (...args: Parameters<typeof mockClearOverride>) => mockClearOverride(...args),
    subscribeToDeveloperMode: (...args: Parameters<typeof mockSubscribeToDeveloperMode>) =>
      mockSubscribeToDeveloperMode(...args),
  },
}));

describe("useFeatureFlags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSnapshot.mockReturnValue(mockSnapshot);
    mockSubscribe.mockImplementation((listener: (s: FeatureFlagSnapshot) => void) => {
      listener(mockSnapshot);
      return () => { };
    });
    mockSubscribeToDeveloperMode.mockReturnValue(() => { });
  });

  describe("FeatureFlagsProvider + useFeatureFlags", () => {
    it("provides snapshot flags through context", async () => {
      const { FeatureFlagsProvider, useFeatureFlags } = await import("@/hooks/useFeatureFlags");

      const Consumer = () => {
        const { flags } = useFeatureFlags();
        return <div data-testid="flag">{flags.hvsc_enabled ? "enabled" : "disabled"}</div>;
      };

      render(
        <FeatureFlagsProvider>
          <Consumer />
        </FeatureFlagsProvider>,
      );

      expect(screen.getByTestId("flag").textContent).toBe("enabled");
    });

    it("calls featureFlagManager.load on mount", async () => {
      const { FeatureFlagsProvider } = await import("@/hooks/useFeatureFlags");
      render(<FeatureFlagsProvider>{null}</FeatureFlagsProvider>);
      await act(async () => { });
      expect(mockLoad).toHaveBeenCalledTimes(1);
    });

    it("subscribes to featureFlagManager on mount", async () => {
      const { FeatureFlagsProvider } = await import("@/hooks/useFeatureFlags");
      render(<FeatureFlagsProvider>{null}</FeatureFlagsProvider>);
      expect(mockSubscribe).toHaveBeenCalledTimes(1);
    });

    it("exposes setFlag from context", async () => {
      const { FeatureFlagsProvider, useFeatureFlags } = await import("@/hooks/useFeatureFlags");

      const Consumer = () => {
        const { setFlag } = useFeatureFlags();
        return (
          <button
            onClick={() => {
              void setFlag("hvsc_enabled", false);
            }}
          >
            Toggle
          </button>
        );
      };

      render(
        <FeatureFlagsProvider>
          <Consumer />
        </FeatureFlagsProvider>,
      );

      screen.getByText("Toggle").click();
      await act(async () => { });
      expect(mockSetFlag).toHaveBeenCalledWith("hvsc_enabled", false);
    });
  });

  describe("useFeatureFlags outside provider", () => {
    it("throws when used outside FeatureFlagsProvider", async () => {
      const { useFeatureFlags } = await import("@/hooks/useFeatureFlags");
      expect(() => renderHook(() => useFeatureFlags())).toThrow(
        "useFeatureFlags must be used within FeatureFlagsProvider",
      );
    });
  });

  describe("useFeatureFlag", () => {
    it("returns value and isLoaded for the requested flag key", async () => {
      const loadedSnapshot: FeatureFlagSnapshot = {
        ...mockSnapshot,
        isLoaded: true,
      };
      mockGetSnapshot.mockReturnValue(loadedSnapshot);
      mockSubscribe.mockImplementation((listener: (s: FeatureFlagSnapshot) => void) => {
        listener(loadedSnapshot);
        return () => { };
      });

      const { FeatureFlagsProvider, useFeatureFlag } = await import("@/hooks/useFeatureFlags");

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <FeatureFlagsProvider>{children}</FeatureFlagsProvider>
      );
      const { result } = renderHook(() => useFeatureFlag("hvsc_enabled"), { wrapper });

      expect(result.current.value).toBe(true);
      expect(result.current.isLoaded).toBe(true);
    });

    it("setValue delegates to setFlag with correct key and value", async () => {
      const { FeatureFlagsProvider, useFeatureFlag } = await import("@/hooks/useFeatureFlags");

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <FeatureFlagsProvider>{children}</FeatureFlagsProvider>
      );
      const { result } = renderHook(() => useFeatureFlag("hvsc_enabled"), { wrapper });

      await act(async () => {
        await result.current.setValue(false);
      });
      expect(mockSetFlag).toHaveBeenCalledWith("hvsc_enabled", false);
    });
  });

  describe("getFeatureFlagValue", () => {
    it("returns the flag value for a given key", async () => {
      const { getFeatureFlagValue } = await import("@/hooks/useFeatureFlags");
      expect(getFeatureFlagValue({ hvsc_enabled: true }, "hvsc_enabled")).toBe(true);
    });

    it("returns false when flag is false", async () => {
      const { getFeatureFlagValue } = await import("@/hooks/useFeatureFlags");
      expect(getFeatureFlagValue({ hvsc_enabled: false }, "hvsc_enabled")).toBe(false);
    });
  });
});

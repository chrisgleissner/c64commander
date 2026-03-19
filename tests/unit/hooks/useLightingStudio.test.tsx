import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LightingStudioProvider, useLightingStudio } from "@/hooks/useLightingStudio";

const mocks = vi.hoisted(() => ({
  useC64Connection: vi.fn(),
  useC64ConfigItems: vi.fn(),
  useConnectionState: vi.fn(),
  updateConfigBatch: vi.fn().mockResolvedValue({ errors: [] }),
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: mocks.useC64Connection,
  useC64ConfigItems: mocks.useC64ConfigItems,
  VISIBLE_C64_QUERY_OPTIONS: { intent: "user" },
}));

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: mocks.useConnectionState,
}));

vi.mock("@/lib/c64api", async () => {
  const actual = await vi.importActual<object>("@/lib/c64api");
  return {
    ...actual,
    getC64API: () => ({
      updateConfigBatch: mocks.updateConfigBatch,
    }),
  };
});

const modernLightingResponse = {
  "LED Strip Settings": {
    items: {
      "LedStrip Mode": { selected: "Fixed Color", options: ["Off", "Fixed Color"] },
      "LedStrip Pattern": { selected: "SingleColor", options: ["SingleColor"] },
      "Fixed Color": { selected: "Green", options: ["Green", "Blue"] },
      "Strip Intensity": { selected: 12, min: 0, max: 31 },
      "LedStrip SID Select": { selected: "SID 1", options: ["SID 1", "SID 2"] },
      "Color tint": { selected: "Pure", options: ["Pure", "Warm", "Whisper", "Pastel", "Bright"] },
    },
  },
};

const keyboardLightingResponse = {
  "Keyboard Lighting": {
    items: {
      "LedStrip Mode": { selected: "Fixed Color", options: ["Off", "Fixed Color"] },
      "LedStrip Pattern": { selected: "SingleColor", options: ["SingleColor"] },
      "Fixed Color": { selected: "Blue", options: ["Green", "Blue"] },
      "Strip Intensity": { selected: 8, min: 0, max: 31 },
      "LedStrip SID Select": { selected: "SID 1", options: ["SID 1", "SID 2"] },
      "Color tint": { selected: "Pure", options: ["Pure", "Warm", "Whisper", "Pastel", "Bright"] },
    },
  },
};

const Consumer = () => {
  const lighting = useLightingStudio();
  return (
    <div>
      <div data-testid="source-cue">{lighting.resolved.sourceCue?.label ?? "none"}</div>
      <div data-testid="automation-chip">{lighting.resolved.activeAutomationChip ?? "none"}</div>
      <div data-testid="location-status">{lighting.deviceLocationStatus}</div>
      <div data-testid="location-error">{lighting.deviceLocationError ?? "none"}</div>
      <div data-testid="circadian-source">{lighting.circadianState?.resolvedLocation.source ?? "none"}</div>
      <div data-testid="circadian-label">{lighting.circadianState?.resolvedLocation.label ?? "none"}</div>
      <div data-testid="connection-sentinel">{lighting.connectionSentinelState ?? "none"}</div>
      <div data-testid="profile-count">{lighting.studioState.profiles.length}</div>
      <div data-testid="active-profile-id">{lighting.studioState.activeProfileId ?? "none"}</div>
      <div data-testid="active-profile-name">{lighting.resolved.activeProfile?.name ?? "none"}</div>
      <div data-testid="profile-1-name">
        {lighting.studioState.profiles.find((profile) => profile.id === "profile-1")?.name ?? "none"}
      </div>
      <div data-testid="case-pinned">
        {String(lighting.studioState.profiles.find((profile) => profile.id === "profile-1")?.pinned ?? false)}
      </div>
      <button type="button" onClick={lighting.lockCurrentLook}>
        lock
      </button>
      <button type="button" onClick={lighting.unlockCurrentLook}>
        unlock
      </button>
      <button type="button" onClick={lighting.requestDeviceLocation}>
        locate
      </button>
      <button
        type="button"
        onClick={() => lighting.setPlaybackContext({ sourceBucket: "hvsc", activeItemLabel: "Track" })}
      >
        hvsc
      </button>
      <button
        type="button"
        onClick={() =>
          lighting.setPreviewState({
            case: { mode: "Fixed Color", color: { kind: "named", value: "Blue" }, intensity: 15, tint: "Warm" },
          })
        }
      >
        preview
      </button>
      <button type="button" onClick={() => lighting.applyPreviewAsProfileBase()}>
        apply-preview
      </button>
      <button
        type="button"
        onClick={() =>
          lighting.updateCircadianLocationPreference({
            useDeviceLocation: false,
            manualCoordinates: { lat: 35.6, lon: 139.6 },
            city: null,
          })
        }
      >
        manual-location
      </button>
      <button type="button" onClick={() => lighting.togglePinProfile("profile-1")}>
        pin
      </button>
      <button type="button" onClick={() => lighting.duplicateProfile("profile-1")}>
        duplicate
      </button>
      <button type="button" onClick={() => lighting.renameProfile("profile-1", "Renamed")}>
        rename
      </button>
      <button type="button" onClick={() => lighting.deleteProfile("profile-1")}>
        delete
      </button>
      <div data-testid="manual-lock">{String(lighting.manualLockEnabled)}</div>
      <div data-testid="profile-modified">{String(lighting.isActiveProfileModified)}</div>
    </div>
  );
};

const renderProvider = (route = "/") => {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <LightingStudioProvider>
          <Consumer />
        </LightingStudioProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("LightingStudioProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.updateConfigBatch.mockClear();
    mocks.useC64Connection.mockReturnValue({
      status: {
        state: "REAL_CONNECTED",
        isConnected: true,
        isConnecting: false,
        isDemo: false,
        deviceType: "real",
        connectionState: "connected",
        error: null,
        deviceInfo: null,
      },
    });
    mocks.useConnectionState.mockReturnValue({ state: "REAL_CONNECTED" });
    mocks.useC64ConfigItems.mockImplementation((category: string) => ({
      data: category === "LED Strip Settings" ? modernLightingResponse : keyboardLightingResponse,
    }));
    Object.defineProperty(global.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((_success: PositionCallback, error: PositionErrorCallback) =>
          error({ code: 1, message: "Permission denied" } as GeolocationPositionError),
        ),
      },
    });
  });

  it("derives disks source cues from the route and writes resolved lighting state", async () => {
    localStorage.setItem(
      "c64u_lighting_studio_state:v1",
      JSON.stringify({
        activeProfileId: "bundled-connected",
        profiles: [],
        automation: {
          sourceIdentityMap: {
            enabled: true,
            mappings: {
              disks: "bundled-source-disks",
            },
          },
        },
      }),
    );

    renderProvider("/disks");

    expect(screen.getByTestId("source-cue")).toHaveTextContent("Disk look");
    await waitFor(() => expect(mocks.updateConfigBatch).toHaveBeenCalled());
  });

  it("falls back to idle and play source ownership on the play route", async () => {
    localStorage.setItem(
      "c64u_lighting_studio_state:v1",
      JSON.stringify({
        activeProfileId: "bundled-connected",
        profiles: [],
        automation: {
          sourceIdentityMap: {
            enabled: true,
            mappings: {
              idle: "bundled-source-local",
              hvsc: "bundled-source-hvsc",
            },
          },
        },
      }),
    );

    renderProvider("/play");

    expect(screen.getByTestId("source-cue")).toHaveTextContent("Idle look");
    fireEvent.click(screen.getByRole("button", { name: "hvsc" }));
    await waitFor(() => expect(screen.getByTestId("source-cue")).toHaveTextContent("HVSC look"));
  });

  it("requests device location and records denied status", async () => {
    renderProvider("/play");

    fireEvent.click(screen.getByRole("button", { name: "locate" }));
    await waitFor(() => expect(screen.getByTestId("location-status")).toHaveTextContent("denied"));
  });

  it("locks and unlocks the current resolved look", async () => {
    renderProvider("/play");

    fireEvent.click(screen.getByRole("button", { name: "lock" }));
    await waitFor(() => expect(screen.getByTestId("manual-lock")).toHaveTextContent("true"));

    fireEvent.click(screen.getByRole("button", { name: "unlock" }));
    await waitFor(() => expect(screen.getByTestId("manual-lock")).toHaveTextContent("false"));
  });

  it("auto-resolves device location when circadian automation asks for it", async () => {
    localStorage.setItem(
      "c64u_lighting_studio_state:v1",
      JSON.stringify({
        activeProfileId: "profile-1",
        profiles: [
          {
            id: "profile-1",
            name: "Base",
            savedAt: new Date(0).toISOString(),
            surfaces: {
              case: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 12, tint: "Pure" },
            },
          },
        ],
        automation: {
          connectionSentinel: { enabled: true, mappings: {} },
          quietLaunch: { enabled: false, profileId: null, windowMs: 45000 },
          sourceIdentityMap: { enabled: false, mappings: {} },
          circadian: {
            enabled: true,
            locationPreference: {
              useDeviceLocation: true,
              manualCoordinates: null,
              city: null,
            },
          },
        },
      }),
    );
    Object.defineProperty(global.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success: PositionCallback) =>
          success({
            coords: {
              latitude: 35.6895,
              longitude: 139.6917,
              accuracy: 1,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
              toJSON: () => ({}),
            },
            timestamp: Date.now(),
            toJSON: () => ({}),
          } as GeolocationPosition),
        ),
      },
    });

    renderProvider("/play");

    await waitFor(() => expect(screen.getByTestId("location-status")).toHaveTextContent("granted"));
    expect(screen.getByTestId("circadian-source")).toHaveTextContent("device");
    expect(screen.getByTestId("circadian-label")).toHaveTextContent("Device 35.690, 139.692");
  });

  it("reports unavailable geolocation and keeps the circadian fallback unresolved until updated", async () => {
    localStorage.setItem(
      "c64u_lighting_studio_state:v1",
      JSON.stringify({
        activeProfileId: "profile-1",
        profiles: [
          {
            id: "profile-1",
            name: "Base",
            savedAt: new Date(0).toISOString(),
            surfaces: {},
          },
        ],
        automation: {
          connectionSentinel: { enabled: true, mappings: {} },
          quietLaunch: { enabled: false, profileId: null, windowMs: 45000 },
          sourceIdentityMap: { enabled: false, mappings: {} },
          circadian: {
            enabled: true,
            locationPreference: {
              useDeviceLocation: false,
              manualCoordinates: null,
              city: null,
            },
          },
        },
      }),
    );
    Object.defineProperty(global.navigator, "geolocation", {
      configurable: true,
      value: undefined,
    });

    renderProvider("/play");

    expect(screen.getByTestId("circadian-source")).toHaveTextContent("unresolved");
    expect(screen.getByTestId("circadian-label")).toHaveTextContent("Location needed");

    fireEvent.click(screen.getByRole("button", { name: "locate" }));
    await waitFor(() => expect(screen.getByTestId("location-status")).toHaveTextContent("error"));
    expect(screen.getByTestId("location-error")).toHaveTextContent("Device location is unavailable on this platform.");

    fireEvent.click(screen.getByRole("button", { name: "manual-location" }));
    await waitFor(() => expect(screen.getByTestId("circadian-source")).toHaveTextContent("manual"));
    expect(screen.getByTestId("circadian-label")).toHaveTextContent("Manual 35.600, 139.600");
  });

  it("manages preview adoption and profile lifecycle operations", async () => {
    localStorage.setItem(
      "c64u_lighting_studio_state:v1",
      JSON.stringify({
        activeProfileId: "profile-1",
        profiles: [
          {
            id: "profile-1",
            name: "Editable",
            savedAt: new Date(0).toISOString(),
            pinned: false,
            surfaces: {
              case: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 12, tint: "Pure" },
            },
          },
        ],
        automation: {
          connectionSentinel: { enabled: true, mappings: {} },
          quietLaunch: { enabled: false, profileId: null, windowMs: 45000 },
          sourceIdentityMap: { enabled: false, mappings: {} },
          circadian: {
            enabled: false,
            locationPreference: {
              useDeviceLocation: false,
              manualCoordinates: null,
              city: null,
            },
          },
        },
      }),
    );

    renderProvider("/play");

    const initialCount = Number(screen.getByTestId("profile-count").textContent);
    fireEvent.click(screen.getByRole("button", { name: "preview" }));
    fireEvent.click(screen.getByRole("button", { name: "apply-preview" }));
    await waitFor(() => expect(Number(screen.getByTestId("profile-count").textContent)).toBe(initialCount + 1));

    fireEvent.click(screen.getByRole("button", { name: "pin" }));
    expect(screen.getByTestId("case-pinned")).toHaveTextContent("true");

    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    expect(screen.getByTestId("profile-1-name")).toHaveTextContent("Renamed");

    fireEvent.click(screen.getByRole("button", { name: "duplicate" }));
    await waitFor(() => expect(Number(screen.getByTestId("profile-count").textContent)).toBe(initialCount + 2));

    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await waitFor(() => expect(Number(screen.getByTestId("profile-count").textContent)).toBe(initialCount + 1));
  });

  it("surfaces connection sentinel states and profile drift from the live device state", () => {
    localStorage.setItem(
      "c64u_lighting_studio_state:v1",
      JSON.stringify({
        activeProfileId: "profile-1",
        profiles: [
          {
            id: "profile-1",
            name: "Expected Green",
            savedAt: new Date(0).toISOString(),
            surfaces: {
              case: { mode: "Fixed Color", color: { kind: "named", value: "Blue" }, intensity: 12, tint: "Pure" },
            },
          },
        ],
        automation: {
          connectionSentinel: { enabled: true, mappings: {} },
          quietLaunch: { enabled: false, profileId: null, windowMs: 45000 },
          sourceIdentityMap: { enabled: false, mappings: {} },
          circadian: {
            enabled: false,
            locationPreference: {
              useDeviceLocation: false,
              manualCoordinates: null,
              city: null,
            },
          },
        },
      }),
    );
    mocks.useC64Connection.mockReturnValue({
      status: {
        state: "DISCOVERING",
        isConnected: false,
        isConnecting: true,
        isDemo: false,
        deviceType: null,
        connectionState: "disconnected",
        error: null,
        deviceInfo: null,
      },
    });
    mocks.useConnectionState.mockReturnValue({ state: "DISCOVERING" });

    renderProvider("/play");

    expect(screen.getByTestId("connection-sentinel")).toHaveTextContent("connecting");
    expect(screen.getByTestId("profile-modified")).toHaveTextContent("true");
  });
});

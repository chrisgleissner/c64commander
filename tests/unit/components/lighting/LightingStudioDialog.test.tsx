import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LightingStudioDialog } from "@/components/lighting/LightingStudioDialog";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import { getBadgeSafeZoneBottomPx, assertOverlayRespectsBadgeSafeZone } from "@/components/ui/interstitialStyles";

const mocks = vi.hoisted(() => ({
  useLightingStudio: vi.fn(),
}));

vi.mock("@/hooks/useLightingStudio", () => ({
  useLightingStudio: mocks.useLightingStudio,
}));

const buildHookValue = (overrides: Record<string, unknown> = {}) => ({
  studioOpen: true,
  closeStudio: vi.fn(),
  contextLensOpen: false,
  closeContextLens: vi.fn(),
  studioState: {
    activeProfileId: "profile-1",
    profiles: [
      {
        id: "profile-1",
        name: "Arcade",
        savedAt: new Date(0).toISOString(),
        pinned: true,
        surfaces: {
          case: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 10, tint: "Pure" },
        },
      },
    ],
    automation: {
      connectionSentinel: { enabled: true, mappings: {} },
      quietLaunch: { enabled: true, profileId: "profile-1", windowMs: 45_000 },
      sourceIdentityMap: { enabled: true, mappings: {} },
      circadian: {
        enabled: true,
        locationPreference: {
          useDeviceLocation: false,
          manualCoordinates: { lat: 51.5, lon: -0.12 },
          city: "London",
        },
      },
    },
  },
  resolved: {
    activeProfile: { id: "profile-1", name: "Arcade" },
    activeAutomationChip: "Auto: Connected",
    resolvedState: {
      case: { color: { kind: "named", value: "Green" }, intensity: 10, tint: "Pure", mode: "Fixed Color" },
      keyboard: { color: { kind: "named", value: "Blue" }, intensity: 8, tint: "Warm", mode: "Fixed Color" },
    },
    contextLens: [{ surface: "case", owner: "profile", label: "Arcade", detail: "Active base profile" }],
  },
  rawDeviceState: {
    case: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 10, tint: "Pure" },
    keyboard: { color: { kind: "named", value: "Blue" }, intensity: 8, tint: "Warm", mode: "Fixed Color" },
  },
  previewState: null,
  setPreviewState: vi.fn(),
  clearPreviewState: vi.fn(),
  applyPreviewAsProfileBase: vi.fn(),
  setActiveProfileId: vi.fn(),
  saveProfile: vi.fn(),
  duplicateProfile: vi.fn(),
  renameProfile: vi.fn(),
  deleteProfile: vi.fn(),
  togglePinProfile: vi.fn(),
  updateAutomation: vi.fn(),
  updateCircadianLocationPreference: vi.fn(),
  requestDeviceLocation: vi.fn(),
  deviceLocationError: "Permission denied",
  deviceLocationStatus: "denied",
  circadianState: {
    period: "night",
    nextBoundaryLabel: "06:00",
    fallbackActive: true,
    resolvedLocation: { source: "city", lat: 51.5, lon: -0.12, label: "London" },
  },
  manualLockEnabled: false,
  lockCurrentLook: vi.fn(),
  unlockCurrentLook: vi.fn(),
  markManualLightingChange: vi.fn(),
  isActiveProfileModified: false,
  capabilities: {
    case: {
      supported: true,
      colorEncoding: "named",
      supportedModes: ["Fixed Color"],
      supportedPatterns: ["SingleColor"],
      supportedNamedColors: ["Green", "Blue"],
      supportsTint: true,
      supportedTints: ["Pure", "Warm"],
      supportsSidSelect: true,
      supportedSidSelects: ["SID 1", "SID 2"],
      intensityRange: { min: 0, max: 31 },
    },
    keyboard: {
      supported: false,
      colorEncoding: null,
      supportedModes: [],
      supportedPatterns: [],
      supportedNamedColors: [],
      supportsTint: false,
      supportedTints: [],
      supportsSidSelect: false,
      supportedSidSelects: [],
      intensityRange: { min: 0, max: 31 },
    },
  },
  ...overrides,
});

describe("LightingStudioDialog", () => {
  beforeEach(() => {
    mocks.useLightingStudio.mockReturnValue(buildHookValue());
  });

  const renderDialog = () =>
    render(
      <DisplayProfileProvider>
        <LightingStudioDialog />
      </DisplayProfileProvider>,
    );

  it("renders the profile, compose, automation sections and case-only fallback", () => {
    renderDialog();

    expect(screen.getByText("Lighting Studio")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-profiles-section")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-compose-section")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-automation-section")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-keyboard-unsupported")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-active-profile-chip")).toHaveTextContent("Arcade");
    expect(screen.getByTestId("lighting-circadian-fallback")).toHaveTextContent("Fallback schedule");
    expect(screen.getByTestId("lighting-open-context-lens")).toHaveTextContent("Why");
    expect(screen.getByTestId("lighting-device-mockup")).toBeInTheDocument();
    expect(document.querySelector("#c64-root")).not.toBeNull();
    expect(document.querySelector("#case-shell")).not.toBeNull();
    expect(document.querySelector("#keyboard-area")).not.toBeNull();
    expect(document.querySelector("#main-keys")).not.toBeNull();
    expect(document.querySelector("#function-keys")).not.toBeNull();
    expect(document.querySelector("#led-layer")).not.toBeNull();
    expect(screen.getByTestId("lighting-mockup-led-strip")).toHaveAttribute("fill", "#F5F5F5");
  });

  it("saves a new profile from the draft and surfaces location-denied fallback state", () => {
    const hookValue = buildHookValue();
    mocks.useLightingStudio.mockReturnValue(hookValue);
    renderDialog();

    fireEvent.change(screen.getByTestId("lighting-profile-save-name"), { target: { value: "Night Ride" } });
    fireEvent.click(screen.getByTestId("lighting-profile-save"));

    expect(hookValue.saveProfile).toHaveBeenCalledWith(
      "Night Ride",
      expect.objectContaining({
        case: expect.objectContaining({ mode: "Fixed Color" }),
      }),
    );
    expect(screen.getByTestId("lighting-device-location-status")).toHaveTextContent("denied");
    expect(screen.getByTestId("lighting-device-location-status")).toHaveTextContent("Permission denied");
  });

  it("validates manual coordinates and only applies them when they are in range", () => {
    const hookValue = buildHookValue();
    mocks.useLightingStudio.mockReturnValue(hookValue);
    renderDialog();

    fireEvent.change(screen.getByTestId("lighting-manual-latitude"), { target: { value: "200" } });
    fireEvent.change(screen.getByTestId("lighting-manual-longitude"), { target: { value: "-0.12" } });

    expect(screen.getByTestId("lighting-manual-latitude-error")).toHaveTextContent("between -90 and 90");
    expect(screen.getByTestId("lighting-apply-manual-coordinates")).toBeDisabled();

    fireEvent.change(screen.getByTestId("lighting-manual-latitude"), { target: { value: "35.6" } });
    fireEvent.change(screen.getByTestId("lighting-manual-longitude"), { target: { value: "139.6" } });
    fireEvent.click(screen.getByTestId("lighting-apply-manual-coordinates"));

    expect(hookValue.updateCircadianLocationPreference).toHaveBeenCalledWith({
      manualCoordinates: {
        lat: 35.6,
        lon: 139.6,
      },
    });
  });

  it("wires preview, city fallback, and location refresh controls through the hook callbacks", () => {
    const hookValue = buildHookValue();
    mocks.useLightingStudio.mockReturnValue(hookValue);
    renderDialog();

    fireEvent.click(screen.getByTestId("lighting-clear-preview"));
    fireEvent.click(screen.getByTestId("lighting-preview"));
    fireEvent.click(screen.getByTestId("lighting-apply-draft"));
    fireEvent.click(screen.getByTestId("lighting-request-device-location"));
    fireEvent.change(screen.getByTestId("lighting-city-search"), { target: { value: "tok" } });
    fireEvent.click(screen.getByTestId("lighting-city-option-tokyo"));
    fireEvent.click(screen.getByTestId("lighting-apply-city"));

    expect(hookValue.clearPreviewState).toHaveBeenCalled();
    expect(hookValue.setPreviewState).toHaveBeenCalled();
    expect(hookValue.applyPreviewAsProfileBase).toHaveBeenCalled();
    expect(hookValue.requestDeviceLocation).toHaveBeenCalled();
    expect(hookValue.updateCircadianLocationPreference).toHaveBeenCalledWith({ city: "Tokyo" });
  });

  it("lets the device mockup switch editing focus between shell and keys", () => {
    const hookValue = buildHookValue({
      capabilities: {
        case: {
          supported: true,
          colorEncoding: "named",
          supportedModes: ["Fixed Color"],
          supportedPatterns: ["SingleColor"],
          supportedNamedColors: ["Green", "Blue"],
          supportsTint: true,
          supportedTints: ["Pure", "Warm"],
          supportsSidSelect: true,
          supportedSidSelects: ["SID 1", "SID 2"],
          intensityRange: { min: 0, max: 31 },
        },
        keyboard: {
          supported: true,
          colorEncoding: "named",
          supportedModes: ["Fixed Color"],
          supportedPatterns: ["SingleColor"],
          supportedNamedColors: ["Green", "Blue"],
          supportsTint: true,
          supportedTints: ["Pure", "Warm"],
          supportsSidSelect: false,
          supportedSidSelects: [],
          intensityRange: { min: 0, max: 31 },
        },
      },
    });
    mocks.useLightingStudio.mockReturnValue(hookValue);
    renderDialog();

    fireEvent.click(screen.getByTestId("lighting-mockup-case-shell"));
    fireEvent.click(screen.getByTestId("lighting-select-surface-keyboard"));

    expect(screen.getByTestId("lighting-device-summary-keyboard").className).toContain("border-primary");
    expect(screen.getByTestId("lighting-editor-keyboard")).toBeInTheDocument();
  });

  it("renders compact fallback copy plus bundled, partial, and unsupported profile states", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });

    const hookValue = buildHookValue({
      contextLensOpen: true,
      manualLockEnabled: true,
      previewState: {
        case: { mode: "Fixed Color", color: { kind: "named", value: "Blue" }, intensity: 12, tint: "Warm" },
        keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 7, tint: "Pure" },
      },
      resolved: {
        activeProfile: null,
        activeAutomationChip: null,
        resolvedState: {
          case: { color: { kind: "named", value: "Green" }, intensity: 10, tint: "Pure", mode: "Fixed Color" },
          keyboard: { color: { kind: "named", value: "Blue" }, intensity: 8, tint: "Warm", mode: "Fixed Color" },
        },
        contextLens: [{ surface: "keyboard", owner: "preview", label: "Preview", detail: "Preview owns keys." }],
      },
      circadianState: null,
      deviceLocationError: null,
      studioState: {
        activeProfileId: "bundled-profile",
        profiles: [
          {
            id: "bundled-profile",
            name: "Bundled Calm",
            bundled: true,
            pinned: true,
            savedAt: new Date(0).toISOString(),
            surfaces: {
              case: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 9, tint: "Pure" },
              keyboard: {
                mode: "Fixed Color",
                color: { kind: "named", value: "Blue" },
                intensity: 8,
                tint: "Warm",
              },
            },
          },
          {
            id: "partial-profile",
            name: "Case Only",
            savedAt: new Date(0).toISOString(),
            pinned: false,
            surfaces: {
              case: { mode: "Fixed Color", color: { kind: "named", value: "Blue" }, intensity: 11, tint: "Warm" },
              keyboard: {
                mode: "Fixed Color",
                color: { kind: "named", value: "Green" },
                intensity: 6,
                tint: "Pure",
              },
            },
          },
          {
            id: "unsupported-profile",
            name: "Keys Only",
            savedAt: new Date(0).toISOString(),
            pinned: false,
            surfaces: {
              keyboard: {
                mode: "Fixed Color",
                color: { kind: "named", value: "Blue" },
                intensity: 10,
                tint: "Warm",
              },
            },
          },
        ],
        automation: {
          connectionSentinel: { enabled: true, mappings: {} },
          quietLaunch: { enabled: false, profileId: null, windowMs: 45_000 },
          sourceIdentityMap: { enabled: false, mappings: {} },
          circadian: {
            enabled: true,
            locationPreference: {
              useDeviceLocation: false,
              manualCoordinates: { lat: 51.5, lon: -0.12 },
              city: null,
            },
          },
        },
      },
    });
    mocks.useLightingStudio.mockReturnValue(hookValue);

    renderDialog();

    expect(screen.getByText("Shape looks and automate them.")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-active-profile-chip")).toHaveTextContent("Device look");
    expect(screen.getByTestId("lighting-unlock")).toHaveTextContent("Unlock look");
    expect(screen.getByText("Which resolver layer currently owns each lighting surface.")).toBeInTheDocument();
    expect(screen.getAllByText("Partial").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unsupported").length).toBeGreaterThan(0);
    expect(screen.getByTestId("lighting-circadian-location")).toHaveTextContent("Not resolved");
    expect(screen.getByTestId("lighting-circadian-next-boundary")).toHaveTextContent("Unavailable");

    fireEvent.click(screen.getByTestId("lighting-profile-bundled-profile"));
    expect(screen.getByTestId("lighting-profile-rename")).toBeDisabled();
    expect(screen.getByTestId("lighting-profile-delete")).toBeDisabled();
  });

  it("renders the empty profile state and unavailable schedule details", () => {
    mocks.useLightingStudio.mockReturnValue(
      buildHookValue({
        studioState: {
          activeProfileId: null,
          profiles: [],
          automation: {
            connectionSentinel: { enabled: false, mappings: {} },
            quietLaunch: { enabled: false, profileId: null, windowMs: 15_000 },
            sourceIdentityMap: { enabled: false, mappings: {} },
            circadian: {
              enabled: false,
              locationPreference: { useDeviceLocation: true, manualCoordinates: null, city: null },
            },
          },
        },
        resolved: {
          activeProfile: null,
          activeAutomationChip: null,
          resolvedState: {
            case: { color: { kind: "named", value: "Green" }, intensity: 10, tint: "Pure", mode: "Fixed Color" },
            keyboard: { color: { kind: "named", value: "Blue" }, intensity: 8, tint: "Warm", mode: "Fixed Color" },
          },
          contextLens: [],
        },
        circadianState: null,
      }),
    );

    renderDialog();

    expect(screen.getByText("Pick a look to manage it.")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-circadian-period")).toHaveTextContent("Unavailable");
    expect(screen.getByTestId("lighting-circadian-fallback")).toHaveTextContent("Solar schedule");
  });

  it("renders RGB-only surface editors when the device does not support named colors", () => {
    mocks.useLightingStudio.mockReturnValue(
      buildHookValue({
        resolved: {
          activeProfile: { id: "profile-1", name: "Arcade" },
          activeAutomationChip: "Auto: Connected",
          resolvedState: {
            case: { color: { kind: "rgb", r: 12, g: 34, b: 56 }, intensity: 10, mode: "Static" },
            keyboard: { color: { kind: "rgb", r: 90, g: 80, b: 70 }, intensity: 8, mode: "Static" },
          },
          contextLens: [{ surface: "case", owner: "profile", label: "Arcade", detail: "Active base profile" }],
        },
        capabilities: {
          case: {
            supported: true,
            colorEncoding: "rgb",
            supportedModes: [],
            supportedPatterns: [],
            supportedNamedColors: [],
            supportsTint: false,
            supportedTints: [],
            supportsSidSelect: false,
            supportedSidSelects: [],
            intensityRange: { min: 0, max: 31 },
          },
          keyboard: {
            supported: true,
            colorEncoding: "rgb",
            supportedModes: [],
            supportedPatterns: [],
            supportedNamedColors: [],
            supportsTint: false,
            supportedTints: [],
            supportsSidSelect: false,
            supportedSidSelects: [],
            intensityRange: { min: 0, max: 31 },
          },
        },
      }),
    );

    renderDialog();

    expect(screen.getByTestId("lighting-case-rgb-r")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-case-rgb-g")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-case-rgb-b")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-keyboard-rgb-r")).toBeInTheDocument();
    expect(screen.queryByTestId("lighting-case-mode")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lighting-case-pattern")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lighting-case-color")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lighting-case-tint")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lighting-case-sid-select")).not.toBeInTheDocument();
  });
});

describe("LightingStudioDialog — badge safe zone invariant", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the measured header fallback when no badge geometry is present", () => {
    document.documentElement.style.setProperty("--app-bar-height", "80px");
    const safeZoneBottom = getBadgeSafeZoneBottomPx();
    expect(safeZoneBottom).toBe(80);
  });

  it("assertOverlayRespectsBadgeSafeZone does not log when top stays within the allowed overlap band", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    document.documentElement.style.setProperty("--app-bar-height", "80px");
    assertOverlayRespectsBadgeSafeZone(68, "LightingStudio[expanded]");
    assertOverlayRespectsBadgeSafeZone(200, "LightingStudio[collapsed]");
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

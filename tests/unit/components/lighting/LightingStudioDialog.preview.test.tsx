import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LightingStudioDialog } from "@/components/lighting/LightingStudioDialog";

const mockUseDisplayProfile = vi.fn();
const mockUseLightingStudio = vi.fn();

vi.mock("@/hooks/useDisplayProfile", () => ({
  useDisplayProfile: () => mockUseDisplayProfile(),
}));

vi.mock("@/hooks/useLightingStudio", () => ({
  useLightingStudio: () => mockUseLightingStudio(),
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlag: () => ({ value: true }),
}));

const buildCapability = () => ({
  supported: true,
  colorEncoding: "named" as const,
  supportedModes: ["Off", "Fixed Color"],
  supportedPatterns: ["SingleColor"],
  intensityRange: { min: 0, max: 31 },
  supportsTint: true,
  supportedTints: ["Pure", "Warm"],
  supportsSidSelect: false,
  supportedSidSelects: [] as string[],
  supportedNamedColors: ["Blue", "Green", "Orange"],
});

const buildStudioMock = () => ({
  studioOpen: true,
  closeStudio: vi.fn(),
  studioState: {
    activeProfileId: "studio-neon",
    profiles: [
      {
        id: "studio-neon",
        name: "Neon Orbit",
        savedAt: "2026-01-10T08:30:00.000Z",
        pinned: true,
        bundled: false,
        surfaces: {
          case: {
            mode: "Fixed Color",
            pattern: "SingleColor",
            color: { kind: "named" as const, value: "Blue" },
            intensity: 22,
            tint: "Pure",
          },
          keyboard: {
            mode: "Fixed Color",
            pattern: "SingleColor",
            color: { kind: "named" as const, value: "Green" },
            intensity: 18,
            tint: "Warm",
          },
        },
      },
    ],
    automation: {
      connectionSentinel: {
        enabled: true,
        mappings: {
          connected: "studio-neon",
          connecting: null,
          retrying: null,
          disconnected: null,
          demo: null,
          error: null,
        },
      },
      quietLaunch: {
        enabled: true,
        profileId: "studio-neon",
        windowMs: 15000,
      },
      sourceIdentityMap: {
        enabled: true,
        mappings: {
          idle: null,
          local: null,
          c64u: null,
          hvsc: null,
          disks: "studio-neon",
        },
      },
      circadian: {
        enabled: true,
        locationPreference: {
          useDeviceLocation: false,
          manualCoordinates: null,
          city: "Tokyo",
        },
      },
    },
  },
  resolved: {
    resolvedState: {
      case: {
        mode: "Fixed Color",
        pattern: "SingleColor",
        color: { kind: "named" as const, value: "Blue" },
        intensity: 22,
        tint: "Pure",
      },
      keyboard: {
        mode: "Fixed Color",
        pattern: "SingleColor",
        color: { kind: "named" as const, value: "Green" },
        intensity: 18,
        tint: "Warm",
      },
    },
    activeProfile: { id: "studio-neon", name: "Neon Orbit" },
    activeAutomationChip: "Connected",
    contextLens: [],
  },
  rawDeviceState: {
    case: {
      mode: "Fixed Color",
      pattern: "SingleColor",
      color: { kind: "named" as const, value: "Blue" },
      intensity: 22,
      tint: "Pure",
    },
    keyboard: {
      mode: "Fixed Color",
      pattern: "SingleColor",
      color: { kind: "named" as const, value: "Green" },
      intensity: 18,
      tint: "Warm",
    },
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
  deviceLocationError: null,
  deviceLocationStatus: "idle",
  circadianState: {
    period: "night",
    nextBoundaryLabel: "Sunrise 06:45",
    fallbackActive: false,
    resolvedLocation: { label: "Tokyo" },
  },
  manualLockEnabled: false,
  lockCurrentLook: vi.fn(),
  unlockCurrentLook: vi.fn(),
  markManualLightingChange: vi.fn(),
  isActiveProfileModified: false,
  capabilities: {
    case: buildCapability(),
    keyboard: buildCapability(),
  },
  openContextLens: vi.fn(),
  contextLensOpen: false,
  closeContextLens: vi.fn(),
});

describe("LightingStudioDialog", () => {
  it("renders a simplified C64-style preview with distinct key blocks and isolated close control", () => {
    mockUseDisplayProfile.mockReturnValue({ profile: "medium" });
    mockUseLightingStudio.mockReturnValue(buildStudioMock());

    render(<LightingStudioDialog />);

    const keyboardLayout = screen.getByTestId("lighting-mockup-keyboard-layout");
    expect(within(keyboardLayout).getByTestId("lighting-mockup-main-block")).toBeInTheDocument();
    expect(within(keyboardLayout).getByTestId("lighting-mockup-function-block")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-mockup-led-region")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-mockup-led-strip")).toHaveAttribute("fill", "#F5F5F5");
    expect(screen.getByTestId("lighting-mockup-main-graphic")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-mockup-function-graphic")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-studio-close")).toBeInTheDocument();
    expect(within(screen.getByTestId("lighting-header-actions")).queryByTestId("lighting-studio-close")).toBeNull();
    expect(screen.getByTestId("lighting-profile-detail-card")).toBeVisible();
  });

  it("keeps the LED strip white while case and keyboard overlays change independently", () => {
    mockUseDisplayProfile.mockReturnValue({ profile: "medium" });
    mockUseLightingStudio.mockReturnValue(buildStudioMock());

    const { rerender } = render(<LightingStudioDialog />);

    const ledStrip = screen.getByTestId("lighting-mockup-led-strip");
    const caseOverlayRect = screen.getByTestId("lighting-mockup-case-overlay").querySelector("rect");
    const keyboardOverlayRect = screen.getByTestId("lighting-mockup-keyboard-overlay").querySelector("rect");

    expect(caseOverlayRect).not.toBeNull();
    expect(keyboardOverlayRect).not.toBeNull();

    const initialLedFill = ledStrip.getAttribute("fill");
    const initialLedOpacity = ledStrip.getAttribute("fill-opacity");
    const initialCaseFill = caseOverlayRect?.getAttribute("fill");
    const initialKeyboardFill = keyboardOverlayRect?.getAttribute("fill");

    const updatedStudio = buildStudioMock();
    updatedStudio.studioState.profiles[0].surfaces.case = {
      ...updatedStudio.studioState.profiles[0].surfaces.case,
      color: { kind: "named" as const, value: "Orange" },
      intensity: 31,
    };
    updatedStudio.studioState.profiles[0].surfaces.keyboard = {
      ...updatedStudio.studioState.profiles[0].surfaces.keyboard,
      color: { kind: "named" as const, value: "Blue" },
      intensity: 4,
    };
    updatedStudio.resolved.resolvedState.case = {
      ...updatedStudio.resolved.resolvedState.case,
      color: { kind: "named" as const, value: "Orange" },
      intensity: 31,
    };
    updatedStudio.resolved.resolvedState.keyboard = {
      ...updatedStudio.resolved.resolvedState.keyboard,
      color: { kind: "named" as const, value: "Blue" },
      intensity: 4,
    };
    updatedStudio.rawDeviceState.case = {
      ...updatedStudio.rawDeviceState.case,
      color: { kind: "named" as const, value: "Orange" },
      intensity: 31,
    };
    updatedStudio.rawDeviceState.keyboard = {
      ...updatedStudio.rawDeviceState.keyboard,
      color: { kind: "named" as const, value: "Blue" },
      intensity: 4,
    };
    mockUseLightingStudio.mockReturnValue(updatedStudio);

    rerender(<LightingStudioDialog />);

    const updatedLedStrip = screen.getByTestId("lighting-mockup-led-strip");
    const updatedCaseOverlayRect = screen.getByTestId("lighting-mockup-case-overlay").querySelector("rect");
    const updatedKeyboardOverlayRect = screen.getByTestId("lighting-mockup-keyboard-overlay").querySelector("rect");

    expect(updatedCaseOverlayRect).not.toBeNull();
    expect(updatedKeyboardOverlayRect).not.toBeNull();

    expect(updatedLedStrip).toHaveAttribute("fill", initialLedFill ?? "#F5F5F5");
    expect(updatedLedStrip).toHaveAttribute("fill-opacity", initialLedOpacity ?? "0.94");
    expect(updatedLedStrip).toHaveAttribute("fill", "#F5F5F5");
    expect(updatedCaseOverlayRect?.getAttribute("fill")).not.toEqual(initialCaseFill);
    expect(updatedKeyboardOverlayRect?.getAttribute("fill")).not.toEqual(initialKeyboardFill);
  });

  // HARD18-020: the preview's whole purpose is to predict the physical
  // outcome before writing to the device - these three scenarios were the
  // ones it got wrong (case/keyboard light mixing in the key areas, and
  // "Off" never actually rendering dark).
  const readOverlayAlpha = (rect: Element | null | undefined) => {
    const fill = rect?.getAttribute("fill") ?? "";
    const match = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(fill);
    return match ? Number(match[1]) : NaN;
  };

  it("HARD18-020: keyboard-off key areas still show the case-light bleed and no keyboard color", () => {
    mockUseDisplayProfile.mockReturnValue({ profile: "medium" });
    const studio = buildStudioMock();
    // The device mockup's draft state initializes from rawDeviceState (via
    // buildStudioDraftBase), not resolved.resolvedState.
    studio.rawDeviceState.keyboard = { ...studio.rawDeviceState.keyboard, mode: "Off" };
    mockUseLightingStudio.mockReturnValue(studio);

    render(<LightingStudioDialog />);

    const bleedRect = screen.getByTestId("lighting-mockup-keyboard-case-bleed").querySelector("rect");
    const keyboardOverlayRect = screen.getByTestId("lighting-mockup-keyboard-overlay").querySelector("rect");

    // Case bleed carries the case's own color into the key area...
    expect(bleedRect?.getAttribute("fill")).toMatch(/^rgba\(/);
    expect(readOverlayAlpha(bleedRect)).toBeGreaterThan(0);
    // ...while the keyboard's own overlay contributes nothing when it's off.
    expect(readOverlayAlpha(keyboardOverlayRect)).toBe(0);
  });

  it("HARD18-020: a surface set to mode Off renders with zero overlay/glow alpha instead of the alpha floor", () => {
    mockUseDisplayProfile.mockReturnValue({ profile: "medium" });
    const studio = buildStudioMock();
    studio.rawDeviceState.case = { ...studio.rawDeviceState.case, mode: "Off" };
    mockUseLightingStudio.mockReturnValue(studio);

    render(<LightingStudioDialog />);

    const caseOverlayRect = screen.getByTestId("lighting-mockup-case-overlay").querySelector("rect");
    const caseGlow = screen.getByTestId("lighting-mockup-case-glow");
    const bleedRect = screen.getByTestId("lighting-mockup-keyboard-case-bleed").querySelector("rect");

    expect(readOverlayAlpha(caseOverlayRect)).toBe(0);
    expect(readOverlayAlpha(caseGlow)).toBe(0);
    // The bleed into the keyboard region is derived from the case's own
    // (now-zero) overlay alpha, so it must also go fully dark.
    expect(readOverlayAlpha(bleedRect)).toBe(0);
  });

  it("HARD18-020: with both surfaces on, the case bleed and keyboard overlay both contribute distinct colors to the key area", () => {
    mockUseDisplayProfile.mockReturnValue({ profile: "medium" });
    mockUseLightingStudio.mockReturnValue(buildStudioMock());

    render(<LightingStudioDialog />);

    const bleedRect = screen.getByTestId("lighting-mockup-keyboard-case-bleed").querySelector("rect");
    const keyboardOverlayRect = screen.getByTestId("lighting-mockup-keyboard-overlay").querySelector("rect");

    const bleedFill = bleedRect?.getAttribute("fill") ?? "";
    const keyboardFill = keyboardOverlayRect?.getAttribute("fill") ?? "";

    // Two independently-colored, non-transparent layers stack in the key
    // area (case bleed underneath, keyboard color screened on top) instead
    // of a single layer overwriting the other.
    expect(readOverlayAlpha(bleedRect)).toBeGreaterThan(0);
    expect(readOverlayAlpha(keyboardOverlayRect)).toBeGreaterThan(0);
    expect(bleedFill).not.toEqual(keyboardFill);
    expect(keyboardOverlayRect).toHaveStyle({ mixBlendMode: "screen" });
  });
});

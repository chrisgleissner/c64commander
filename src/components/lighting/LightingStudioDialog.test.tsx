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

const buildCapability = () => ({
  supported: true,
  colorEncoding: "named" as const,
  supportedModes: ["Fixed Color"],
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
    expect(screen.getByTestId("lighting-mockup-main-graphic")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-mockup-function-graphic")).toBeInTheDocument();
    expect(screen.getByTestId("lighting-studio-close")).toBeInTheDocument();
    expect(within(screen.getByTestId("lighting-header-actions")).queryByTestId("lighting-studio-close")).toBeNull();
    expect(screen.getByTestId("lighting-profile-detail-card")).toBeVisible();
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import HomePage from "../../../src/pages/HomePage";

const {
  toastSpy,
  reportUserErrorSpy,
  c64ApiMockRef,
  queryClientMockRef,
  sidSocketsPayloadRef,
  sidAddressingPayloadRef,
  audioMixerPayloadRef,
  streamPayloadRef,
  driveASettingsPayloadRef,
  driveBSettingsPayloadRef,
  u64SettingsPayloadRef,
  c64CartridgePayloadRef,
  ledStripPayloadRef,
  userInterfacePayloadRef,
  keyboardLightingPayloadRef,
  statusPayloadRef,
  drivesPayloadRef,
  machineControlPayloadRef,
  appConfigStatePayloadRef,
} = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  reportUserErrorSpy: vi.fn(),
  c64ApiMockRef: {
    current: {
      setConfigValue: vi.fn().mockResolvedValue({}),
      resetDrive: vi.fn().mockResolvedValue({}),
      writeMemory: vi.fn().mockResolvedValue({}),
    },
  },
  queryClientMockRef: {
    current: {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      fetchQuery: vi.fn().mockResolvedValue(undefined),
    },
  },
  sidSocketsPayloadRef: {
    current: undefined as Record<string, unknown> | undefined,
  },
  sidAddressingPayloadRef: {
    current: undefined as Record<string, unknown> | undefined,
  },
  audioMixerPayloadRef: {
    current: undefined as Record<string, unknown> | undefined,
  },
  streamPayloadRef: {
    current: undefined as Record<string, unknown> | undefined,
  },
  driveASettingsPayloadRef: {
    current: undefined as Record<string, unknown> | undefined,
  },
  driveBSettingsPayloadRef: {
    current: undefined as Record<string, unknown> | undefined,
  },
  u64SettingsPayloadRef: {
    current: undefined as Record<string, unknown> | undefined,
  },
  c64CartridgePayloadRef: {
    current: undefined as Record<string, unknown> | undefined,
  },
  ledStripPayloadRef: {
    current: undefined as Record<string, unknown> | undefined,
  },
  userInterfacePayloadRef: {
    current: undefined as Record<string, unknown> | undefined,
  },
  keyboardLightingPayloadRef: {
    current: undefined as Record<string, unknown> | undefined,
  },
  statusPayloadRef: {
    current: {
      isConnected: true,
      isConnecting: false,
      deviceInfo: null as null | {
        product: string;
        hostname: string;
        firmware_version: string;
        fpga_version: string;
        core_version: string;
        unique_id: string;
      },
    },
  },
  drivesPayloadRef: {
    current: {
      drives: [] as Array<
        Record<
          string,
          {
            enabled?: boolean;
            image_file?: string;
            bus_id?: number;
            type?: string;
          }
        >
      >,
    },
  },
  machineControlPayloadRef: {
    current: {
      reset: { mutateAsync: vi.fn(), isPending: false },
      reboot: { mutateAsync: vi.fn(), isPending: false },
      pause: { mutateAsync: vi.fn(), isPending: false },
      resume: { mutateAsync: vi.fn(), isPending: false },
      powerOff: { mutateAsync: vi.fn(), isPending: false },
      menuButton: { mutateAsync: vi.fn(), isPending: false },
      saveConfig: { mutateAsync: vi.fn(), isPending: false },
      loadConfig: { mutateAsync: vi.fn(), isPending: false },
      resetConfig: { mutateAsync: vi.fn(), isPending: false },
    },
  },
  appConfigStatePayloadRef: {
    current: {
      appConfigs: [] as Array<{ id: string; name: string; savedAt: string }>,
      hasChanges: false,
      isApplying: false,
      isSaving: false,
      revertToInitial: vi.fn(),
      saveCurrentConfig: vi.fn(),
      loadAppConfig: vi.fn(),
      renameAppConfig: vi.fn(),
      deleteAppConfig: vi.fn(),
    },
  },
}));

vi.mock("@/components/ThemeProvider", () => ({
  useThemeContext: () => ({
    theme: "light",
    setTheme: vi.fn(),
  }),
}));

vi.mock("@/components/DiagnosticsActivityIndicator", () => ({
  DiagnosticsActivityIndicator: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick} data-testid="diagnostics-activity-indicator" />
  ),
}));

const buildRouter = (ui: JSX.Element) =>
  createMemoryRouter([{ path: "*", element: ui }], {
    initialEntries: ["/"],
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  });

const renderWithRouter = (ui: JSX.Element) =>
  render(
    <RouterProvider
      router={buildRouter(ui)}
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    />,
  );

const renderHomePage = () => renderWithRouter(<HomePage />);

const HDMI_RESOLUTION_OPTIONS = [
  "SD (480p/576p)",
  "HD (720p)",
  "FullHD (1080p)",
  "PC 800 x 600",
  "PC 1024 x 768",
  "PC 1280 x 1024",
];

const JOYSTICK_SWAPPER_OPTIONS = ["Normal", "Swapped", "WASD Port 2", "WASD Port 1"];
const SERIAL_BUS_MODE_OPTIONS = ["All Connected", "C64U <-> Internal", "Ext. <-> Int.", "C64U <-> External"];
const CARTRIDGE_PREFERENCE_OPTIONS = ["Auto", "Internal", "External", "Manual"];
const RAM_EXPANSION_OPTIONS = ["Disabled", "Enabled", "GeoRAM Mode"];
const REU_SIZE_OPTIONS = ["128 KB", "256 KB", "512 KB", "1 MB", "2 MB", "4 MB", "8 MB", "16 MB"];

const CPU_SPEED_OPTIONS = ["1", "2", "3", "4", "6", "8", "10", "12", "14", "16", "20", "24", "32", "40", "48", "64"];

const COLOR_SCHEME_OPTIONS = ["Commodore Blue", "Ultimate Black", "Commodore 1", "Commodore 2", "Commodore 3"];

const buildLightingPayload = ({
  mode = "Fixed Color",
  modeOptions = ["Off", "Fixed Color", "Rainbow"],
  pattern = "SingleColor",
  patternOptions = ["SingleColor", "Outward"],
  fixedColor = "Red",
  fixedColorOptions = ["Red", "Green", "Blue"],
  intensity = "15",
  sidSelect = "SID 1",
  sidSelectOptions = ["SID 1", "SID 2"],
  tint = "Pure",
  tintOptions = ["Pure", "Warm"],
}: {
  fixedColor?: string;
  fixedColorOptions?: string[];
  intensity?: string;
  mode?: string;
  modeOptions?: string[];
  pattern?: string;
  patternOptions?: string[];
  sidSelect?: string;
  sidSelectOptions?: string[];
  tint?: string;
  tintOptions?: string[];
} = {}) => ({
  items: {
    "LedStrip Mode": {
      selected: mode,
      options: modeOptions,
    },
    "LedStrip Pattern": {
      selected: pattern,
      options: patternOptions,
    },
    "Fixed Color": {
      selected: fixedColor,
      options: fixedColorOptions,
    },
    "Strip Intensity": {
      selected: intensity,
      min: 0,
      max: 31,
    },
    "LedStrip SID Select": {
      selected: sidSelect,
      options: sidSelectOptions,
    },
    "Color tint": {
      selected: tint,
      options: tintOptions,
    },
  },
});

const buildU64SettingsPayload = ({
  analogVideoMode = "CVBS + SVideo",
  analogVideoModeOptions = ["CVBS + SVideo", "RGB"],
  badlineTiming = "Enabled",
  badlineTimingOptions = ["Disabled", "Enabled"],
  cpuSpeed = "1",
  cpuSpeedOptions = CPU_SPEED_OPTIONS,
  digitalVideoMode = "Auto",
  digitalVideoModeOptions = ["Auto", "HDMI", "DVI"],
  hdmiResolution = "SD (480p/576p)",
  hdmiResolutionOptions = HDMI_RESOLUTION_OPTIONS,
  hdmiScanLines = "Disabled",
  hdmiScanLinesOptions = ["Disabled", "Enabled"],
  joystickSwapper = "Normal",
  joystickSwapperOptions = JOYSTICK_SWAPPER_OPTIONS,
  serialBusMode = "All Connected",
  serialBusModeOptions = SERIAL_BUS_MODE_OPTIONS,
  superCpuDetect = "Disabled",
  superCpuDetectOptions = ["Disabled", "Enabled"],
  systemMode = "PAL",
  systemModeOptions = ["PAL", "NTSC"],
  turboControl = "Off",
  turboControlOptions = ["Off", "Manual", "C64U Turbo Registers", "TurboEnable Bit"],
  userPortPower = "Enabled",
  userPortPowerOptions = ["Disabled", "Enabled"],
}: {
  analogVideoMode?: string;
  analogVideoModeOptions?: string[];
  badlineTiming?: string;
  badlineTimingOptions?: string[];
  cpuSpeed?: string;
  cpuSpeedOptions?: string[];
  digitalVideoMode?: string;
  digitalVideoModeOptions?: string[];
  hdmiResolution?: string;
  hdmiResolutionOptions?: string[];
  hdmiScanLines?: string;
  hdmiScanLinesOptions?: string[];
  joystickSwapper?: string;
  joystickSwapperOptions?: string[];
  serialBusMode?: string;
  serialBusModeOptions?: string[];
  superCpuDetect?: string;
  superCpuDetectOptions?: string[];
  systemMode?: string;
  systemModeOptions?: string[];
  turboControl?: string;
  turboControlOptions?: string[];
  userPortPower?: string;
  userPortPowerOptions?: string[];
} = {}) => ({
  "U64 Specific Settings": {
    items: {
      "CPU Speed": { selected: cpuSpeed, options: cpuSpeedOptions },
      "System Mode": { selected: systemMode, options: systemModeOptions },
      "HDMI Scan Resolution": { selected: hdmiResolution, options: hdmiResolutionOptions },
      "Turbo Control": { selected: turboControl, options: turboControlOptions },
      "Badline Timing": { selected: badlineTiming, options: badlineTimingOptions },
      "SuperCPU Detect (D0BC)": { selected: superCpuDetect, options: superCpuDetectOptions },
      "Analog Video Mode": { selected: analogVideoMode, options: analogVideoModeOptions },
      "Digital Video Mode": { selected: digitalVideoMode, options: digitalVideoModeOptions },
      "Serial Bus Mode": { selected: serialBusMode, options: serialBusModeOptions },
      "HDMI Scan lines": {
        selected: hdmiScanLines,
        options: hdmiScanLinesOptions,
      },
      "Joystick Swapper": {
        selected: joystickSwapper,
        options: joystickSwapperOptions,
      },
      "UserPort Power Enable": {
        selected: userPortPower,
        options: userPortPowerOptions,
      },
    },
  },
});

const buildCartridgeSettingsPayload = ({
  cartridgePreference = "Auto",
  cartridgePreferenceOptions = CARTRIDGE_PREFERENCE_OPTIONS,
  ramExpansionUnit = "Disabled",
  ramExpansionUnitOptions = RAM_EXPANSION_OPTIONS,
  reuSize = "512 KB",
  reuSizeOptions = REU_SIZE_OPTIONS,
}: {
  cartridgePreference?: string;
  cartridgePreferenceOptions?: string[];
  ramExpansionUnit?: string;
  ramExpansionUnitOptions?: string[];
  reuSize?: string;
  reuSizeOptions?: string[];
} = {}) => ({
  "C64 and Cartridge Settings": {
    items: {
      "Cartridge Preference": {
        selected: cartridgePreference,
        options: cartridgePreferenceOptions,
      },
      "RAM Expansion Unit": {
        selected: ramExpansionUnit,
        options: ramExpansionUnitOptions,
      },
      "REU Size": {
        selected: reuSize,
        options: reuSizeOptions,
      },
    },
  },
});

const buildUserInterfacePayload = ({
  colorScheme = "Commodore Blue",
  colorSchemeOptions = COLOR_SCHEME_OPTIONS,
  interfaceType = "Overlay on HDMI",
  interfaceTypeOptions = ["Freeze", "Overlay on HDMI"],
  navigationStyle = "WASD Cursors",
  navigationStyleOptions = ["Quick Search", "WASD Cursors"],
}: {
  colorScheme?: string;
  colorSchemeOptions?: string[];
  interfaceType?: string;
  interfaceTypeOptions?: string[];
  navigationStyle?: string;
  navigationStyleOptions?: string[];
} = {}) => ({
  "User Interface Settings": {
    items: {
      "Interface Type": {
        selected: interfaceType,
        options: interfaceTypeOptions,
      },
      "Navigation Style": {
        selected: navigationStyle,
        options: navigationStyleOptions,
      },
      "Color Scheme": {
        selected: colorScheme,
        options: colorSchemeOptions,
      },
    },
  },
});

const expectLightingControls = (prefix: string, title: string) => {
  const section = screen.getByTestId(`${prefix}-summary`);
  expect(within(section).getByText(title)).toBeTruthy();
  expect(screen.getByTestId(`${prefix}-mode`)).toBeTruthy();
  expect(screen.getByTestId(`${prefix}-pattern`)).toBeTruthy();
  expect(screen.getByTestId(`${prefix}-color`)).toBeTruthy();
  expect(screen.getByTestId(`${prefix}-color-slider`)).toBeTruthy();
  expect(screen.getByTestId(`${prefix}-intensity-slider`)).toBeTruthy();
  expect(screen.getByTestId(`${prefix}-intensity-value`)).toBeTruthy();
  expect(screen.getByTestId(`${prefix}-sid-select`)).toBeTruthy();
  expect(screen.getByTestId(`${prefix}-tint`)).toBeTruthy();

  const labels = Array.from(section.querySelectorAll(".text-muted-foreground")).map((node) => node.textContent);
  expect(labels).toEqual(["Mode", "Pattern", "Color", "Brightness", "Tint", "SID Select"]);
};

const expectUserInterfaceControls = (prefix: string) => {
  const section = screen.getByTestId(`${prefix}-summary`);
  expect(within(section).getByText("User Interface")).toBeTruthy();
  expect(screen.getByTestId(`${prefix}-overlay`)).toBeTruthy();
  expect(screen.getByTestId(`${prefix}-wasd-cursors`)).toBeTruthy();
  expect(screen.getByTestId(`${prefix}-color-scheme`)).toBeTruthy();
};

const expectCpuControls = () => {
  const section = screen.getByTestId("home-cpu-summary");
  expect(within(section).getByText("CPU & RAM")).toBeTruthy();
  expect(screen.getByTestId("home-cpu-turbo-control")).toBeTruthy();
  expect(screen.getByTestId("home-cpu-speed-slider")).toBeTruthy();
  expect(screen.getByTestId("home-cpu-speed-value")).toBeTruthy();
  expect(within(section).getByText("CPU Speed").className).toContain("text-muted-foreground");
  expect(screen.getByTestId("home-cpu-speed-value").className).toContain("text-foreground");
  expect(screen.getByTestId("home-cpu-badline-timing")).toBeTruthy();
  expect(screen.getByTestId("home-cpu-supercpu-detect")).toBeTruthy();
  expect(screen.getByTestId("quickconfig-ram-expansion")).toBeTruthy();
  expect(screen.getByTestId("quickconfig-ram-size")).toBeTruthy();

  const labels = Array.from(section.querySelectorAll(".text-muted-foreground")).map((node) => node.textContent);
  expect(labels).toEqual([
    "Turbo Control",
    "CPU Speed",
    "Badline Timing",
    "SuperCPU Detect",
    "RAM Expansion",
    "RAM Size (REU)",
  ]);
};

const expectVideoControls = () => {
  const section = screen.getByTestId("home-video-summary");
  expect(within(section).getByText("Video")).toBeTruthy();
  expect(screen.getByTestId("home-video-mode")).toBeTruthy();
  expect(screen.getByTestId("home-video-hdmi-resolution")).toBeTruthy();
  expect(screen.getByTestId("home-video-scanlines")).toBeTruthy();
  expect(screen.getByTestId("home-video-analog")).toBeTruthy();
  expect(screen.getByTestId("home-video-digital")).toBeTruthy();
};

const expectPortsControls = () => {
  const section = screen.getByTestId("home-ports-summary");
  expect(within(section).getByText("Ports")).toBeTruthy();
  expect(within(section).getByText("Joystick Input")).toBeTruthy();
  expect(screen.getByTestId("home-joystick-swapper")).toBeTruthy();
  expect(screen.getByTestId("home-serial-bus-mode")).toBeTruthy();
  expect(screen.getByTestId("home-cartridge-preference")).toBeTruthy();
  expect(screen.getByTestId("home-user-port-power")).toBeTruthy();
};

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => queryClientMockRef.current,
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({
    status: statusPayloadRef.current,
  }),
  useC64Drives: () => ({
    data: drivesPayloadRef.current,
    refetch: vi.fn().mockImplementation(() => queryClientMockRef.current.fetchQuery()),
  }),
  useC64ConfigItem: () => ({ data: undefined, isLoading: false }),
  useC64ConfigItems: (category: string) => {
    if (category === "SID Sockets Configuration") {
      return { data: sidSocketsPayloadRef.current };
    }
    if (category === "SID Addressing") {
      return { data: sidAddressingPayloadRef.current };
    }
    if (category === "Audio Mixer") {
      return { data: audioMixerPayloadRef.current };
    }
    if (category === "Data Streams") {
      return { data: streamPayloadRef.current };
    }
    if (category === "Drive A Settings") {
      return { data: driveASettingsPayloadRef.current };
    }
    if (category === "Drive B Settings") {
      return { data: driveBSettingsPayloadRef.current };
    }
    if (category === "U64 Specific Settings") {
      return { data: u64SettingsPayloadRef.current };
    }
    if (category === "C64 and Cartridge Settings") {
      return { data: c64CartridgePayloadRef.current };
    }
    if (category === "LED Strip Settings") {
      return { data: ledStripPayloadRef.current };
    }
    if (category === "User Interface Settings") {
      return { data: userInterfacePayloadRef.current };
    }
    if (category === "Keyboard Lighting") {
      return { data: keyboardLightingPayloadRef.current };
    }
    return { data: null };
  },
  useC64MachineControl: () => machineControlPayloadRef.current,
}));

vi.mock("@/hooks/useAppConfigState", () => ({
  useAppConfigState: () => appConfigStatePayloadRef.current,
}));

vi.mock("@/hooks/useActionTrace", () => ({
  useActionTrace: () => Object.assign((fn: (...args: any[]) => any) => fn, { scope: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: toastSpy,
  useToast: () => ({ toasts: [], dismiss: vi.fn() }),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      // Filter out framer-motion props to avoid React warnings in tests and ensure clean DOM
      const { initial, animate, exit, transition, variants, ...validProps } = props;
      return <div {...validProps}>{children}</div>;
    },
    button: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, variants, ...validProps } = props;
      return <button {...validProps}>{children}</button>;
    },
    span: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, variants, ...validProps } = props;
      return <span {...validProps}>{children}</span>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/hooks/useDiagnosticsActivity", () => ({
  useDiagnosticsActivity: () => ({ restInFlight: 0, setRestInFlight: vi.fn() }),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlayState", () => ({
  isDiagnosticsOverlayActive: () => false,
  subscribeDiagnosticsOverlay: () => () => {},
  shouldSuppressDiagnosticsSideEffects: () => false,
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: reportUserErrorSpy,
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => c64ApiMockRef.current,
}));

beforeEach(() => {
  toastSpy.mockReset();
  reportUserErrorSpy.mockReset();
  queryClientMockRef.current = {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    fetchQuery: vi.fn().mockResolvedValue(undefined),
  };
  sidSocketsPayloadRef.current = undefined;
  sidAddressingPayloadRef.current = undefined;
  audioMixerPayloadRef.current = undefined;
  streamPayloadRef.current = undefined;
  driveASettingsPayloadRef.current = undefined;
  driveBSettingsPayloadRef.current = undefined;
  u64SettingsPayloadRef.current = undefined;
  c64CartridgePayloadRef.current = undefined;
  ledStripPayloadRef.current = undefined;
  userInterfacePayloadRef.current = undefined;
  keyboardLightingPayloadRef.current = undefined;
  c64ApiMockRef.current = {
    setConfigValue: vi.fn().mockResolvedValue({}),
    resetDrive: vi.fn().mockResolvedValue({}),
    writeMemory: vi.fn().mockResolvedValue({}),
    startStream: vi.fn().mockResolvedValue({}),
    stopStream: vi.fn().mockResolvedValue({}),
  };
  statusPayloadRef.current = {
    isConnected: true,
    isConnecting: false,
    deviceInfo: null,
  };
  drivesPayloadRef.current = { drives: [] };
  machineControlPayloadRef.current = {
    reset: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    reboot: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    pause: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    resume: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    powerOff: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    menuButton: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    saveConfig: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    loadConfig: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
    resetConfig: {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    },
  };
  appConfigStatePayloadRef.current = {
    appConfigs: [],
    hasChanges: false,
    isApplying: false,
    isSaving: false,
    revertToInitial: vi.fn().mockResolvedValue(undefined),
    saveCurrentConfig: vi.fn().mockResolvedValue(undefined),
    loadAppConfig: vi.fn().mockResolvedValue(undefined),
    renameAppConfig: vi.fn(),
    deleteAppConfig: vi.fn(),
  };
  (globalThis as any).__APP_VERSION__ = "test";
  (globalThis as any).__GIT_SHA__ = "deadbeef";
  (globalThis as any).__BUILD_TIME__ = "";
});

describe("HomePage SID status", () => {
  vi.setConfig({ testTimeout: 30000 });

  it("renders the Home subtitle as C64 Commander", () => {
    renderHomePage();
    expect(screen.getByTestId("home-header-subtitle").textContent).toBe("C64 Commander");
  });

  it("renders SID layout and updates on config changes", () => {
    (globalThis as any).__BUILD_TIME__ = new Date().toISOString();
    sidSocketsPayloadRef.current = {
      "SID Sockets Configuration": {
        items: {
          "SID Socket 1": { selected: "Enabled" },
          "SID Socket 2": { selected: "Disabled" },
        },
      },
    };
    sidAddressingPayloadRef.current = {
      "SID Addressing": {
        items: {
          "UltiSID 1 Address": { selected: "Unmapped" },
          "UltiSID 2 Address": { selected: "$D400" },
        },
      },
    };

    const { rerender } = renderHomePage();

    expect(within(screen.getByTestId("home-sid-status")).getAllByText("SID").length).toBeGreaterThan(0);
    const sidSocket1 = screen.getByText("SID Socket 1");
    const sidSocket2 = screen.getByText("SID Socket 2");
    const ultiSid1 = screen.getByText("UltiSID 1");
    const ultiSid2 = screen.getByText("UltiSID 2");
    expect(sidSocket1).toBeTruthy();
    expect(sidSocket2).toBeTruthy();
    expect(ultiSid1).toBeTruthy();
    expect(ultiSid2).toBeTruthy();

    expect(screen.getByTestId("home-sid-toggle-socket1").textContent).toBe("ON");
    expect(screen.getByTestId("home-sid-toggle-socket2").textContent).toBe("OFF");

    sidSocketsPayloadRef.current = {
      "SID Sockets Configuration": {
        items: {
          "SID Socket 1": { selected: "Disabled" },
          "SID Socket 2": { selected: "Enabled" },
        },
      },
    };
    sidAddressingPayloadRef.current = {
      "SID Addressing": {
        items: {
          "UltiSID 1 Address": { selected: "$D400" },
          "UltiSID 2 Address": { selected: "Unmapped" },
        },
      },
    };

    rerender(
      <RouterProvider
        router={buildRouter(<HomePage />)}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      />,
    );

    expect(screen.getByTestId("home-sid-toggle-socket1").textContent).toBe("OFF");
    expect(screen.getByTestId("home-sid-toggle-socket2").textContent).toBe("ON");
    expect(screen.getByTestId("home-sid-toggle-ultiSid1").textContent).toBe("ON");
    expect(screen.getByTestId("home-sid-toggle-ultiSid2").textContent).toBe("OFF");
  });

  it("renders stream rows with full IP:PORT endpoint values from Data Streams config", () => {
    streamPayloadRef.current = {
      "Data Streams": {
        items: {
          "Stream VIC to": { selected: "239.0.1.64:11000" },
          "Stream Audio to": { selected: "off" },
          "Stream Debug to": { selected: "239.0.1.66" },
        },
      },
    };

    renderHomePage();

    const streamSection = screen.getByTestId("home-stream-status");
    expect(within(streamSection).getByText("Streams")).toBeTruthy();
    expect(within(streamSection).getAllByTestId(/^home-stream-row-/)).toHaveLength(3);
    expect(within(streamSection).getByText("VIC")).toBeTruthy();
    expect(within(streamSection).getByText("AUDIO")).toBeTruthy();
    expect(within(streamSection).getByText("DEBUG")).toBeTruthy();
    expect(within(streamSection).getAllByText("Start").length).toBe(3);
    expect(within(streamSection).getAllByText("Stop").length).toBe(3);
    expect(within(streamSection).queryByTestId("home-stream-endpoint-vic")).toBeNull();
    expect(within(streamSection).getByTestId("home-stream-endpoint-display-vic").textContent).toBe("239.0.1.64:11000");
    expect(within(streamSection).getByTestId("home-stream-endpoint-display-debug").textContent).toBe(
      "239.0.1.66:11002",
    );
  });

  it("resets all connected drives from Home drives section", async () => {
    drivesPayloadRef.current = {
      drives: [
        { a: { enabled: true, image_file: "disk-a.d64" } },
        { b: { enabled: true } },
        { "IEC Drive": { enabled: true, bus_id: 11, type: "DOS emulation" } },
      ],
    };

    renderHomePage();

    fireEvent.click(screen.getByTestId("home-drives-reset"));

    await waitFor(() => expect(c64ApiMockRef.current.resetDrive).toHaveBeenCalledTimes(3));
    expect(c64ApiMockRef.current.resetDrive).toHaveBeenCalledWith("a");
    expect(c64ApiMockRef.current.resetDrive).toHaveBeenCalledWith("b");
    expect(c64ApiMockRef.current.resetDrive).toHaveBeenCalledWith("softiec");
    expect(queryClientMockRef.current.fetchQuery).toHaveBeenCalled();
  });

  it("resets printer only from Home printer section", async () => {
    drivesPayloadRef.current = {
      drives: [
        { a: { enabled: true, image_file: "disk-a.d64" } },
        { b: { enabled: true } },
        { "IEC Drive": { enabled: true, bus_id: 11, type: "DOS emulation" } },
        { "Printer Emulation": { enabled: true, bus_id: 4 } },
      ],
    };

    renderHomePage();

    fireEvent.click(screen.getByTestId("home-printer-reset"));

    await waitFor(() => expect(c64ApiMockRef.current.resetDrive).toHaveBeenCalledTimes(1));
    expect(c64ApiMockRef.current.resetDrive).toHaveBeenCalledWith("printer");
    expect(queryClientMockRef.current.fetchQuery).toHaveBeenCalled();
  });

  it("writes SID silence registers when SID reset is pressed", async () => {
    sidAddressingPayloadRef.current = {
      "SID Addressing": {
        items: {
          "SID Socket 1 Address": { selected: "$D400" },
          "SID Socket 2 Address": { selected: "Unmapped" },
          "UltiSID 1 Address": { selected: "$D420" },
          "UltiSID 2 Address": { selected: "Unmapped" },
        },
      },
    };

    renderHomePage();

    const sidSection = screen.getByTestId("home-sid-status");
    fireEvent.click(screen.getByTestId("home-sid-reset"));

    await waitFor(() => expect(c64ApiMockRef.current.writeMemory).toHaveBeenCalledTimes(20));
    expect(c64ApiMockRef.current.writeMemory).toHaveBeenCalledWith("D404", new Uint8Array([0]));
    expect(c64ApiMockRef.current.writeMemory).toHaveBeenCalledWith("D424", new Uint8Array([0]));
  });

  it("rejects invalid stream host input safely", async () => {
    streamPayloadRef.current = {
      "Data Streams": {
        items: {
          "Stream VIC to": { selected: "239.0.1.64:11000" },
          "Stream Audio to": { selected: "off" },
          "Stream Debug to": { selected: "239.0.1.66:11002" },
        },
      },
    };

    renderHomePage();

    fireEvent.click(screen.getByTestId("home-stream-edit-toggle-vic"));
    const endpointInput = screen.getByTestId("home-stream-endpoint-vic");
    fireEvent.change(endpointInput, { target: { value: "bad host!:11000" } });
    fireEvent.click(screen.getByTestId("home-stream-confirm-vic"));

    await waitFor(() =>
      expect(reportUserErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "STREAM_VALIDATE",
        }),
      ),
    );
    expect(screen.getByTestId("home-stream-error-vic").textContent).toContain("Enter a valid IPv4 address");
    expect(c64ApiMockRef.current.setConfigValue).not.toHaveBeenCalled();
  });

  it("supports inline stream edit with explicit confirm", async () => {
    streamPayloadRef.current = {
      "Data Streams": {
        items: {
          "Stream VIC to": { selected: "239.0.1.64:11000" },
          "Stream Audio to": { selected: "239.0.1.65:11001" },
          "Stream Debug to": { selected: "off" },
        },
      },
    };

    renderHomePage();

    fireEvent.click(screen.getByTestId("home-stream-edit-toggle-vic"));
    fireEvent.change(screen.getByTestId("home-stream-endpoint-vic"), {
      target: { value: "239.0.1.90:12000" },
    });
    fireEvent.click(screen.getByTestId("home-stream-confirm-vic"));

    await waitFor(() =>
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "Data Streams",
        "Stream VIC to",
        "239.0.1.90:12000",
      ),
    );
    expect(screen.queryByTestId("home-stream-endpoint-vic")).toBeNull();
  });

  it("renders two-line drives rows with explicit labels and supports dropdown interaction", async () => {
    drivesPayloadRef.current = {
      drives: [
        { a: { enabled: true, bus_id: 8, type: "1541" } },
        { b: { enabled: true, bus_id: 9, type: "1571" } },
        { "IEC Drive": { enabled: false, bus_id: 11, type: "DOS emulation" } },
      ],
    };
    driveASettingsPayloadRef.current = {
      "Drive A Settings": {
        items: {
          Drive: { selected: "Enabled" },
          "Drive Bus ID": { selected: "8", options: ["8", "9", "10", "11"] },
          "Drive Type": { selected: "1541", options: ["1541", "1571", "1581"] },
        },
      },
    };
    driveBSettingsPayloadRef.current = {
      "Drive B Settings": {
        items: {
          Drive: { selected: "Enabled" },
          "Drive Bus ID": { selected: "9", options: ["8", "9", "10", "11"] },
          "Drive Type": { selected: "1571", options: ["1541", "1571", "1581"] },
        },
      },
    };

    renderHomePage();

    const drivesGroup = screen.getByTestId("home-drives-group");
    expect(within(drivesGroup).getByTestId("home-drive-row-a")).toBeTruthy();
    expect(within(drivesGroup).getByTestId("home-drive-row-b")).toBeTruthy();
    expect(within(drivesGroup).getByTestId("home-drive-row-soft-iec")).toBeTruthy();
    expect(within(drivesGroup).getByText("Drive A")).toBeTruthy();
    expect(within(drivesGroup).getByText("Drive B")).toBeTruthy();
    expect(within(drivesGroup).getByText("Soft IEC Drive")).toBeTruthy();
    expect(within(drivesGroup).getAllByText("Bus ID").length).toBeGreaterThanOrEqual(3);
    expect(within(drivesGroup).getAllByText("Type").length).toBeGreaterThanOrEqual(2);
    expect(within(drivesGroup).getByText("Path")).toBeTruthy();

    const driveBusSelect = screen.getByTestId("home-drive-bus-a");
    fireEvent.click(driveBusSelect);
    await waitFor(() => expect(document.body.getAttribute("data-scroll-locked")).toBe("1"));
    fireEvent.keyDown(document.activeElement ?? driveBusSelect, {
      key: "Escape",
    });

    const driveTypeSelect = screen.getByTestId("home-drive-type-a");
    fireEvent.click(driveTypeSelect);
    await waitFor(() => expect(document.body.getAttribute("data-scroll-locked")).toBe("1"));
    fireEvent.keyDown(document.activeElement ?? driveTypeSelect, {
      key: "Escape",
    });
  });

  it("shows concise drive DOS status on Home for Drive A and Soft IEC", () => {
    drivesPayloadRef.current = {
      drives: [
        {
          a: {
            enabled: true,
            bus_id: 8,
            type: "1541",
            last_error: "74,DRIVE NOT READY,00,00",
          },
        },
        { b: { enabled: true, bus_id: 9, type: "1541" } },
        {
          "IEC Drive": {
            enabled: true,
            bus_id: 11,
            type: "DOS emulation",
            last_error: "73,U64IEC ULTIMATE DOS V1.1,00,00",
          },
        },
      ],
    };

    renderHomePage();

    expect(screen.getByTestId("home-drive-status-a")).toHaveTextContent("DRIVE NOT READY");
    expect(screen.getByTestId("home-drive-status-soft-iec").textContent).toMatch(/^(OK|DOS MISMATCH)$/);
  });

  it("shows explicit disconnected build info values and offline message", () => {
    (globalThis as any).__APP_VERSION__ = "";
    (globalThis as any).__GIT_SHA__ = "";
    (globalThis as any).__BUILD_TIME__ = "";
    statusPayloadRef.current = {
      isConnected: false,
      isConnecting: false,
      deviceInfo: null,
    };

    renderHomePage();

    const systemInfo = screen.getByTestId("home-system-info");
    fireEvent.click(systemInfo);

    expect(screen.getByTestId("home-system-version").textContent).toContain("—");
    expect(screen.getByTestId("home-system-device").textContent).toContain("Not connected");
    expect(screen.getByTestId("home-system-firmware").textContent).toContain("Not connected");
    expect(screen.getByTestId("home-system-git").textContent).toContain("Not available");
    expect(screen.getByTestId("home-system-build-time").textContent).toContain("2026-01-01 12:00:00 UTC");
    expect(screen.getByText(/unable to connect to c64u/i)).toBeTruthy();
  });

  it("renders device info and the inline RAM folder picker", () => {
    statusPayloadRef.current = {
      isConnected: true,
      isConnecting: false,
      deviceInfo: {
        product: "C64U",
        hostname: "c64u.local",
        firmware_version: "1.0.0",
        fpga_version: "2.0.0",
        core_version: "3.0.0",
        unique_id: "abc123",
      },
    };
    drivesPayloadRef.current = {
      drives: [{ a: { enabled: true, image_file: "disk.d64" }, b: { enabled: false } }],
    };
    (globalThis as any).__APP_VERSION__ = "1.2.3";
    (globalThis as any).__GIT_SHA__ = "deadbeefcafefeed";
    (globalThis as any).__BUILD_TIME__ = "2024-03-20T12:34:00.000Z";

    renderHomePage();

    const systemInfo = screen.getByTestId("home-system-info");
    fireEvent.click(systemInfo);

    expect(screen.getByTestId("home-system-version").textContent).toContain("1.2.3");
    expect(screen.getByTestId("home-system-device").textContent).toContain("c64u.local");
    expect(screen.getByTestId("home-system-firmware").textContent).toContain("1.0.0");
    expect(screen.getByTestId("home-system-git").textContent).toContain("deadbeef");
    expect(screen.getByTestId("home-system-build-time").textContent).toContain("2024-03-20 12:34:00 UTC");
    expect(screen.getByText("Quick Actions")).toBeTruthy();
    expect(screen.queryByTestId("home-drive-summary")).toBeNull();
    expect(screen.getByTestId("home-ram-folder-row").textContent).toContain("RAM Folder:");
    expect(screen.getByTestId("ram-dump-folder-trigger").textContent).toContain("...");
  });

  it('shows "No disk" on Home when drive A has no mounted image', () => {
    statusPayloadRef.current = {
      isConnected: true,
      isConnecting: false,
      deviceInfo: null,
    };
    drivesPayloadRef.current = {
      drives: [{ a: { enabled: true }, b: { enabled: true } }],
    };

    renderHomePage();

    expect(screen.getAllByText("No disk mounted").length).toBeGreaterThan(0);
  });

  it("handles machine actions and reports errors", async () => {
    const menuError = new Error("menu failed");
    machineControlPayloadRef.current.menuButton.mutateAsync = vi.fn().mockRejectedValue(menuError);

    renderHomePage();

    fireEvent.click(screen.getAllByRole("button", { name: /^Reset$/ })[0]);
    await waitFor(() => expect(machineControlPayloadRef.current.reset.mutateAsync).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith({ title: "Machine reset" });

    fireEvent.click(screen.getByRole("button", { name: /^Menu$/ }));
    await waitFor(() => expect(reportUserErrorSpy).toHaveBeenCalled());
    expect(reportUserErrorSpy.mock.calls[0][0]).toMatchObject({
      operation: "HOME_ACTION",
      title: "Error",
      context: { action: "Menu toggled" },
    });
  });

  it("requires explicit confirmation before power off", async () => {
    renderHomePage();

    fireEvent.click(screen.getByRole("button", { name: /^power off$/i }));
    expect(machineControlPayloadRef.current.powerOff.mutateAsync).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/cannot be powered on again via software/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(machineControlPayloadRef.current.powerOff.mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^power off$/i }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^power off$/i,
      }),
    );
    await waitFor(() => expect(machineControlPayloadRef.current.powerOff.mutateAsync).toHaveBeenCalled());
  });

  it("renders exactly eight machine controls with one pause-resume control", async () => {
    renderHomePage();

    const machineControls = screen.getByTestId("home-machine-controls");
    expect(within(machineControls).getAllByRole("button")).toHaveLength(8);
    expect(within(machineControls).getAllByRole("button", { name: /^pause$/i })).toHaveLength(1);
    expect(within(machineControls).queryByRole("button", { name: /^resume$/i })).toBeNull();

    fireEvent.click(within(machineControls).getByRole("button", { name: /^pause$/i }));

    await waitFor(() => expect(machineControlPayloadRef.current.pause.mutateAsync).toHaveBeenCalledTimes(1));
    expect(within(machineControls).queryByRole("button", { name: /^pause$/i })).toBeNull();
    expect(within(machineControls).getAllByRole("button", { name: /^resume$/i })).toHaveLength(1);

    fireEvent.click(within(machineControls).getByRole("button", { name: /^resume$/i }));
    await waitFor(() => expect(machineControlPayloadRef.current.resume.mutateAsync).toHaveBeenCalledTimes(1));
    expect(within(machineControls).getAllByRole("button", { name: /^pause$/i })).toHaveLength(1);
  }, 20000);

  it("manages app configs via dialogs", async () => {
    const savedAt = new Date("2024-01-01T00:00:00.000Z").toISOString();
    appConfigStatePayloadRef.current = {
      ...appConfigStatePayloadRef.current,
      appConfigs: [
        { id: "config-a", name: "Config A", savedAt },
        { id: "config-b", name: "Config B", savedAt },
      ],
      hasChanges: true,
    };

    renderHomePage();

    fireEvent.click(screen.getByTestId("home-config-revert-changes"));
    await waitFor(() => expect(appConfigStatePayloadRef.current.revertToInitial).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith({ title: "Config reverted" });

    fireEvent.click(screen.getByTestId("home-config-save-app"));
    const saveDialog = screen.getByRole("dialog");
    fireEvent.click(within(saveDialog).getByRole("button", { name: /^save$/i }));
    expect(toastSpy).toHaveBeenCalledWith({
      title: "Name required",
      description: "Enter a config name first.",
    });

    fireEvent.change(within(saveDialog).getByPlaceholderText(/config name/i), {
      target: { value: "Config A" },
    });
    fireEvent.click(within(saveDialog).getByRole("button", { name: /^save$/i }));
    expect(toastSpy).toHaveBeenCalledWith({
      title: "Name already used",
      description: "Choose a unique config name.",
    });

    fireEvent.change(within(saveDialog).getByPlaceholderText(/config name/i), {
      target: { value: "Config C" },
    });
    fireEvent.click(within(saveDialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(appConfigStatePayloadRef.current.saveCurrentConfig).toHaveBeenCalledWith("Config C"));
    expect(toastSpy).toHaveBeenCalledWith({
      title: "Saved to app",
      description: "Config C",
    });

    fireEvent.click(screen.getByTestId("home-config-load-app"));
    const loadDialog = screen.getByRole("dialog");
    fireEvent.click(within(loadDialog).getByRole("button", { name: /config a/i }));
    await waitFor(() => expect(appConfigStatePayloadRef.current.loadAppConfig).toHaveBeenCalled());
    expect(appConfigStatePayloadRef.current.loadAppConfig).toHaveBeenCalledWith({
      id: "config-a",
      name: "Config A",
      savedAt,
    });

    fireEvent.click(screen.getByTestId("home-config-manage-app"));
    const manageDialog = screen.getByRole("dialog");
    fireEvent.change(within(manageDialog).getByDisplayValue("Config A"), {
      target: { value: "  New Name  " },
    });
    const [renameButton] = within(manageDialog).getAllByRole("button", {
      name: /rename/i,
    });
    fireEvent.click(renameButton);
    expect(appConfigStatePayloadRef.current.renameAppConfig).toHaveBeenCalledWith("config-a", "New Name");
    const [deleteButton] = within(manageDialog).getAllByRole("button", {
      name: /delete/i,
    });
    fireEvent.click(deleteButton);
    expect(appConfigStatePayloadRef.current.deleteAppConfig).toHaveBeenCalledWith("config-a");
  }, 30000);

  it("renders CPU, Ports, and Video cards with the expected controls in page order", async () => {
    u64SettingsPayloadRef.current = buildU64SettingsPayload();
    c64CartridgePayloadRef.current = buildCartridgeSettingsPayload({
      ramExpansionUnit: "Enabled",
      reuSize: "512 KB",
    });
    userInterfacePayloadRef.current = buildUserInterfacePayload();

    renderHomePage();

    const quickConfig = screen.getByTestId("home-quick-config");
    expect(within(quickConfig).getByTestId("home-cpu-speed-value").textContent).toBe("1");
    expectCpuControls();
    expectVideoControls();
    expectPortsControls();

    const cpuCard = within(quickConfig).getByTestId("home-cpu-summary");
    const portsCard = within(quickConfig).getByTestId("home-ports-summary");
    const videoCard = within(quickConfig).getByTestId("home-video-summary");
    expect(cpuCard.getAttribute("data-section-label")).toBe("CPU & RAM");
    expect(portsCard.getAttribute("data-section-label")).toBe("Ports");
    expect(videoCard.getAttribute("data-section-label")).toBe("Video");
    expect(cpuCard.compareDocumentPosition(portsCard) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(portsCard.compareDocumentPosition(videoCard) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    const slider = screen.getByTestId("home-cpu-speed-slider");
    const thumb = slider.querySelector('[role="slider"]');
    expect(thumb).toBeTruthy();
    fireEvent.keyDown(thumb!, { key: "ArrowRight" });

    await waitFor(() =>
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith("U64 Specific Settings", "CPU Speed", "2"),
    );
  });

  it("hides RAM Size (REU) when RAM Expansion is disabled and shows it for enabled modes", () => {
    c64CartridgePayloadRef.current = buildCartridgeSettingsPayload({
      ramExpansionUnit: "Disabled",
      reuSize: "512 KB",
    });

    const { rerender } = renderHomePage();

    expect(screen.getByTestId("quickconfig-ram-expansion")).toBeTruthy();
    expect(screen.queryByTestId("quickconfig-ram-size")).toBeNull();

    c64CartridgePayloadRef.current = buildCartridgeSettingsPayload({
      ramExpansionUnit: "GeoRAM Mode",
      reuSize: "2 MB",
    });

    rerender(
      <RouterProvider
        router={buildRouter(<HomePage />)}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      />,
    );

    expect(screen.getByTestId("quickconfig-ram-size")).toBeTruthy();
    expect(screen.getByTestId("quickconfig-ram-size")).toHaveTextContent("2 MB");
  });

  it("renders the quick actions RAM folder row and LED lighting cards in order", async () => {
    userInterfacePayloadRef.current = buildUserInterfacePayload();
    ledStripPayloadRef.current = {
      "LED Strip Settings": buildLightingPayload(),
    };
    keyboardLightingPayloadRef.current = {
      "Keyboard Lighting": buildLightingPayload({
        fixedColor: "Magenta",
        fixedColorOptions: ["Magenta", "Fuchsia", "White"],
        intensity: "8",
        pattern: "Single Color",
        patternOptions: ["Single Color", "Circular"],
      }),
    };

    renderHomePage();

    expectUserInterfaceControls("home-user-interface");
    expect(within(screen.getByTestId("home-lighting-group")).getByText("LED LIGHTING")).toBeTruthy();
    expectLightingControls("home-led", "Case Light");
    expectLightingControls("home-keyboard-lighting", "Keyboard Light");
    expect(screen.getByTestId("home-led-pattern")).toHaveTextContent("Single Color");
    expect(screen.getByTestId("home-keyboard-lighting-pattern")).toHaveTextContent("Single Color");

    const machineSection = screen.getByTestId("home-machine-controls").closest('[data-section-label="Quick Actions"]');
    const ramFolderRow = screen.getByTestId("home-ram-folder-row");
    expect(machineSection).toBeTruthy();
    expect(machineSection?.contains(ramFolderRow)).toBe(true);
    expect(
      screen.getByTestId("home-machine-controls").compareDocumentPosition(screen.getByTestId("home-machine-footer")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    const cardColumn = screen.getByTestId("home-secondary-cards");
    const userInterfaceCard = within(cardColumn).getByTestId("home-user-interface-summary");
    const lightingGroup = within(cardColumn).getByTestId("home-lighting-group");
    const caseLightingCard = within(cardColumn).getByTestId("home-led-summary");
    const keyboardLightingCard = within(cardColumn).getByTestId("home-keyboard-lighting-summary");
    expect(userInterfaceCard.getAttribute("data-section-label")).toBe("User Interface");
    expect(caseLightingCard.getAttribute("data-section-label")).toBe("Case Light");
    expect(keyboardLightingCard.getAttribute("data-section-label")).toBe("Keyboard Light");
    expect(screen.queryByTestId("home-ram-dump-folder")).toBeNull();
    expect(userInterfaceCard.compareDocumentPosition(lightingGroup) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(lightingGroup.compareDocumentPosition(caseLightingCard) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(caseLightingCard.compareDocumentPosition(keyboardLightingCard) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );

    const ledModeSelect = screen.getByTestId("home-led-mode");
    fireEvent.click(ledModeSelect);
    await waitFor(() => expect(document.body.getAttribute("data-scroll-locked")).toBe("1"));
    fireEvent.keyDown(document.activeElement ?? ledModeSelect, {
      key: "Escape",
    });
  });

  it("shows Single Color for lighting patterns while sending the raw API value", async () => {
    ledStripPayloadRef.current = {
      "LED Strip Settings": buildLightingPayload({
        pattern: "Outward",
        patternOptions: ["SingleColor", "Outward"],
      }),
    };
    keyboardLightingPayloadRef.current = {
      "Keyboard Lighting": buildLightingPayload({
        pattern: "Single Color",
        patternOptions: ["Single Color", "Circular"],
      }),
    };

    renderHomePage();

    fireEvent.click(screen.getByTestId("home-led-pattern"));
    fireEvent.click(await screen.findByRole("option", { name: /^Single Color$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("home-led-pattern")).toHaveTextContent("Single Color");
      expect(screen.getByTestId("home-keyboard-lighting-pattern")).toHaveTextContent("Single Color");
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "LED Strip Settings",
        "LedStrip Pattern",
        "SingleColor",
      );
    });
  });

  it("updates CPU, Video, Ports, user interface, and lighting controls from the Home page", async () => {
    u64SettingsPayloadRef.current = buildU64SettingsPayload({
      analogVideoMode: "CVBS + SVideo",
      analogVideoModeOptions: ["CVBS + SVideo", "RGB"],
      badlineTiming: "Enabled",
      cpuSpeed: "1",
      digitalVideoMode: "Auto",
      digitalVideoModeOptions: ["Auto", "HDMI", "DVI"],
      hdmiResolution: "SD (480p/576p)",
      joystickSwapper: "Normal",
      serialBusMode: "All Connected",
      superCpuDetect: "Disabled",
      systemMode: "PAL",
      turboControl: "Off",
      userPortPower: "Enabled",
    });
    c64CartridgePayloadRef.current = buildCartridgeSettingsPayload({
      cartridgePreference: "Auto",
      ramExpansionUnit: "Enabled",
      reuSize: "512 KB",
    });
    userInterfacePayloadRef.current = buildUserInterfacePayload({
      colorScheme: "Commodore Blue",
      interfaceType: "Overlay on HDMI",
      navigationStyle: "WASD Cursors",
    });

    ledStripPayloadRef.current = {
      "LED Strip Settings": buildLightingPayload({
        intensity: "10",
      }),
    };
    keyboardLightingPayloadRef.current = {
      "Keyboard Lighting": buildLightingPayload({
        fixedColor: "Magenta",
        fixedColorOptions: ["Magenta", "Fuchsia", "White"],
        intensity: "8",
        pattern: "Single Color",
        patternOptions: ["Single Color", "Circular"],
      }),
    };

    renderHomePage();

    fireEvent.click(screen.getByTestId("home-cpu-turbo-control"));
    fireEvent.click(await screen.findByRole("option", { name: /C64U Turbo Registers/i }));

    const cpuSliderThumb = screen.getByTestId("home-cpu-speed-slider").querySelector('[role="slider"]');
    expect(cpuSliderThumb).toBeTruthy();
    fireEvent.keyDown(cpuSliderThumb!, { key: "ArrowRight" });

    fireEvent.click(screen.getByTestId("home-cpu-badline-timing"));
    fireEvent.click(screen.getByTestId("home-cpu-supercpu-detect"));

    fireEvent.click(screen.getByTestId("home-video-mode"));
    fireEvent.click(await screen.findByRole("option", { name: /NTSC/i }));

    fireEvent.click(screen.getByTestId("home-video-analog"));
    fireEvent.click(await screen.findByRole("option", { name: /^RGB$/i }));

    fireEvent.click(screen.getByTestId("home-video-hdmi-resolution"));
    fireEvent.click(await screen.findByRole("option", { name: /FullHD \(1080p\)/i }));

    fireEvent.click(screen.getByTestId("home-video-digital"));
    fireEvent.click(await screen.findByRole("option", { name: /^DVI$/i }));

    fireEvent.click(screen.getByTestId("home-video-scanlines"));

    fireEvent.click(screen.getByTestId("home-joystick-swapper"));
    fireEvent.click(await screen.findByRole("option", { name: /WASD Port 2/i }));

    fireEvent.click(screen.getByTestId("home-serial-bus-mode"));
    fireEvent.click(await screen.findByRole("option", { name: /C64U <-> External/i }));

    fireEvent.click(screen.getByTestId("home-cartridge-preference"));
    fireEvent.click(await screen.findByRole("option", { name: /^Manual$/i }));

    fireEvent.click(screen.getByTestId("quickconfig-ram-expansion"));
    fireEvent.click(await screen.findByRole("option", { name: /^GeoRAM Mode$/i }));

    fireEvent.click(screen.getByTestId("quickconfig-ram-size"));
    fireEvent.click(await screen.findByRole("option", { name: /^2 MB$/i }));

    fireEvent.click(screen.getByTestId("home-user-port-power"));

    fireEvent.click(screen.getByTestId("home-user-interface-overlay"));
    fireEvent.click(screen.getByTestId("home-user-interface-wasd-cursors"));

    fireEvent.click(screen.getByTestId("home-user-interface-color-scheme"));
    fireEvent.click(await screen.findByRole("option", { name: /Ultimate Black/i }));

    fireEvent.click(screen.getByTestId("home-led-mode"));
    fireEvent.click(await screen.findByRole("option", { name: /Rainbow/i }));

    fireEvent.click(screen.getByTestId("home-led-pattern"));
    fireEvent.click(await screen.findByRole("option", { name: /Outward/i }));

    fireEvent.click(screen.getByTestId("home-led-color"));
    fireEvent.click(await screen.findByRole("option", { name: /Green/i }));

    fireEvent.click(screen.getByTestId("home-led-sid-select"));
    fireEvent.click(await screen.findByRole("option", { name: /SID 2/i }));

    fireEvent.click(screen.getByTestId("home-led-tint"));
    fireEvent.click(await screen.findByRole("option", { name: /Warm/i }));

    const colorSliderThumb = screen.getByTestId("home-led-color-slider").querySelector('[role="slider"]');
    const intensitySliderThumb = screen.getByTestId("home-led-intensity-slider").querySelector('[role="slider"]');
    const keyboardColorSliderThumb = screen
      .getByTestId("home-keyboard-lighting-color-slider")
      .querySelector('[role="slider"]');
    const keyboardIntensitySliderThumb = screen
      .getByTestId("home-keyboard-lighting-intensity-slider")
      .querySelector('[role="slider"]');
    expect(colorSliderThumb).toBeTruthy();
    expect(intensitySliderThumb).toBeTruthy();
    expect(keyboardColorSliderThumb).toBeTruthy();
    expect(keyboardIntensitySliderThumb).toBeTruthy();
    fireEvent.keyDown(colorSliderThumb!, { key: "ArrowRight" });
    fireEvent.keyDown(intensitySliderThumb!, { key: "ArrowRight" });

    fireEvent.click(screen.getByTestId("home-keyboard-lighting-mode"));
    fireEvent.click(await screen.findByRole("option", { name: /Rainbow/i }));

    fireEvent.click(screen.getByTestId("home-keyboard-lighting-pattern"));
    fireEvent.click(await screen.findByRole("option", { name: /Circular/i }));

    fireEvent.click(screen.getByTestId("home-keyboard-lighting-color"));
    fireEvent.click(await screen.findByRole("option", { name: /Fuchsia/i }));

    fireEvent.click(screen.getByTestId("home-keyboard-lighting-sid-select"));
    fireEvent.click(await screen.findByRole("option", { name: /SID 2/i }));

    fireEvent.click(screen.getByTestId("home-keyboard-lighting-tint"));
    fireEvent.click(await screen.findByRole("option", { name: /Warm/i }));

    fireEvent.keyDown(keyboardColorSliderThumb!, { key: "ArrowRight" });
    fireEvent.keyDown(keyboardIntensitySliderThumb!, { key: "ArrowRight" });

    await waitFor(() => {
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "U64 Specific Settings",
        "Turbo Control",
        "C64U Turbo Registers",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith("U64 Specific Settings", "CPU Speed", "2");
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "U64 Specific Settings",
        "Turbo Control",
        "Manual",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "U64 Specific Settings",
        "Badline Timing",
        "Disabled",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "U64 Specific Settings",
        "SuperCPU Detect (D0BC)",
        "Enabled",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith("U64 Specific Settings", "System Mode", "NTSC");
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "U64 Specific Settings",
        "Analog Video Mode",
        "RGB",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "U64 Specific Settings",
        "HDMI Scan Resolution",
        "FullHD (1080p)",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "U64 Specific Settings",
        "Digital Video Mode",
        "DVI",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "U64 Specific Settings",
        "HDMI Scan lines",
        "Enabled",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "U64 Specific Settings",
        "Joystick Swapper",
        "WASD Port 2",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "U64 Specific Settings",
        "Serial Bus Mode",
        "C64U <-> External",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "C64 and Cartridge Settings",
        "Cartridge Preference",
        "Manual",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "C64 and Cartridge Settings",
        "RAM Expansion Unit",
        "GeoRAM Mode",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "C64 and Cartridge Settings",
        "REU Size",
        "2 MB",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "U64 Specific Settings",
        "UserPort Power Enable",
        "Disabled",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "User Interface Settings",
        "Interface Type",
        "Freeze",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "User Interface Settings",
        "Navigation Style",
        "Quick Search",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "User Interface Settings",
        "Color Scheme",
        "Ultimate Black",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "LED Strip Settings",
        "LedStrip Mode",
        "Rainbow",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "LED Strip Settings",
        "LedStrip Pattern",
        "Outward",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith("LED Strip Settings", "Fixed Color", "Green");
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "LED Strip Settings",
        "LedStrip SID Select",
        "SID 2",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith("LED Strip Settings", "Color tint", "Warm");
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "Keyboard Lighting",
        "LedStrip Mode",
        "Rainbow",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "Keyboard Lighting",
        "LedStrip Pattern",
        "Circular",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith("Keyboard Lighting", "Fixed Color", "Fuchsia");
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
        "Keyboard Lighting",
        "LedStrip SID Select",
        "SID 2",
      );
      expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith("Keyboard Lighting", "Color tint", "Warm");
    });
  }, 90000);

  it("handles save-to-app error path", async () => {
    const savedAt = new Date("2024-01-01T00:00:00.000Z").toISOString();
    appConfigStatePayloadRef.current = {
      ...appConfigStatePayloadRef.current,
      appConfigs: [{ id: "config-a", name: "Config A", savedAt }],
      hasChanges: true,
      saveCurrentConfig: vi.fn().mockRejectedValue(new Error("save boom")),
    };

    renderHomePage();

    fireEvent.click(screen.getByTestId("home-config-save-app"));
    const saveDialog = screen.getByRole("dialog");
    fireEvent.change(within(saveDialog).getByPlaceholderText(/config name/i), {
      target: { value: "New Config" },
    });
    fireEvent.click(within(saveDialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(reportUserErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "APP_CONFIG_SAVE",
        }),
      ),
    );
  }, 30000);

  it("handles load-from-app error path", async () => {
    const savedAt = new Date("2024-01-01T00:00:00.000Z").toISOString();
    appConfigStatePayloadRef.current = {
      ...appConfigStatePayloadRef.current,
      appConfigs: [
        { id: "config-a", name: "Config A", savedAt },
        { id: "config-b", name: "Config B", savedAt },
      ],
      loadAppConfig: vi.fn().mockRejectedValue(new Error("load boom")),
    };

    renderHomePage();

    fireEvent.click(screen.getByTestId("home-config-load-app"));
    const loadDialog = screen.getByRole("dialog");
    fireEvent.click(within(loadDialog).getByRole("button", { name: /config a/i }));

    await waitFor(() =>
      expect(reportUserErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "APP_CONFIG_LOAD",
        }),
      ),
    );
  }, 30000);
});

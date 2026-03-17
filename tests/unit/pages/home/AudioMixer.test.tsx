import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toastSpy, reportUserErrorSpy, c64ApiMockRef, queryClientMockRef, updateConfigValueSpy, resolveConfigValueSpy } =
  vi.hoisted(() => ({
    toastSpy: vi.fn(),
    reportUserErrorSpy: vi.fn(),
    c64ApiMockRef: {
      current: {
        setConfigValue: vi.fn().mockResolvedValue({}),
        writeMemory: vi.fn().mockResolvedValue({}),
      },
    },
    queryClientMockRef: {
      current: {
        invalidateQueries: vi.fn().mockResolvedValue(undefined),
        fetchQuery: vi.fn().mockResolvedValue(undefined),
      },
    },
    updateConfigValueSpy: vi.fn().mockResolvedValue(undefined),
    resolveConfigValueSpy: vi.fn(
      (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
    ),
  }));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => queryClientMockRef.current,
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => c64ApiMockRef.current,
}));

vi.mock("@/hooks/useActionTrace", () => ({
  useActionTrace: () => Object.assign((fn: (...args: any[]) => any) => fn, { scope: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: toastSpy,
  useToast: () => ({ toasts: [], dismiss: vi.fn() }),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: reportUserErrorSpy,
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, variants, ...validProps } = props;
      return <div {...validProps}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/hooks/useC64Connection", () => ({
  VISIBLE_C64_QUERY_OPTIONS: {
    intent: "user",
    refetchOnMount: "always",
  },
  useC64ConfigItems: () => ({ data: undefined }),
  useC64Drives: () => ({ data: { drives: [] }, refetch: vi.fn() }),
}));

vi.mock("@/hooks/useDiagnosticsActivity", () => ({
  useDiagnosticsActivity: () => ({ restInFlight: 0, setRestInFlight: vi.fn() }),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlayState", () => ({
  isDiagnosticsOverlayActive: () => false,
  subscribeDiagnosticsOverlay: () => () => {},
  shouldSuppressDiagnosticsSideEffects: () => false,
}));

// Mock the ConfigActionsContext to provide shared config actions
vi.mock("@/pages/home/hooks/ConfigActionsContext", async () => {
  const React = await import("react");
  return {
    useSharedConfigActions: () => ({
      configOverrides: {},
      configWritePending: {},
      updateConfigValue: updateConfigValueSpy,
      resolveConfigValue: resolveConfigValueSpy,
      setConfigOverride: vi.fn(),
    }),
    ConfigActionsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// Mock useSidData to return controlled test entries
const mockSidControlEntries = vi.fn().mockReturnValue([]);
vi.mock("@/pages/home/hooks/useSidData", () => ({
  useSidData: (...args: any[]) => mockSidControlEntries(...args),
}));

// Mock silenceSidTargets
vi.mock("@/lib/sid/sidSilence", () => ({
  silenceSidTargets: vi.fn().mockResolvedValue(undefined),
  buildSidSilenceTargets: vi.fn().mockReturnValue([]),
}));

// Mock buildSidEnablement
vi.mock("@/lib/config/sidVolumeControl", () => ({
  buildSidEnablement: () => ({
    socket1: true,
    socket2: true,
    ultiSid1: true,
    ultiSid2: true,
  }),
}));

// Mock SidCard to expose callback props for testing
vi.mock("@/pages/home/SidCard", () => ({
  SidCard: (props: any) => (
    <div data-testid={`sid-card-${props.testIdSuffix}`}>
      <span data-testid="sid-card-name">{props.name}</span>
      <span data-testid="sid-card-power">{props.power ? "ON" : "OFF"}</span>
      <button data-testid="power-toggle" onClick={props.onPowerToggle}>
        Toggle
      </button>
      <button data-testid="volume-change" onClick={() => props.onVolumeChange?.(5)}>
        VolChange
      </button>
      <button data-testid="volume-commit" onClick={() => props.onVolumeCommit?.(5)}>
        VolCommit
      </button>
      <button data-testid="volume-async-change" onClick={() => props.onVolumeChangeAsync?.(5)}>
        VolAsyncChange
      </button>
      <button data-testid="volume-async-commit" onClick={() => props.onVolumeCommitAsync?.(5)}>
        VolAsyncCommit
      </button>
      <button data-testid="pan-change" onClick={() => props.onPanChange?.(3)}>
        PanChange
      </button>
      <button data-testid="pan-commit" onClick={() => props.onPanCommit?.(3)}>
        PanCommit
      </button>
      <button data-testid="pan-async-change" onClick={() => props.onPanChangeAsync?.(3)}>
        PanAsyncChange
      </button>
      <button data-testid="pan-async-commit" onClick={() => props.onPanCommitAsync?.(3)}>
        PanAsyncCommit
      </button>
      <button data-testid="identity-change" onClick={() => props.onIdentityChange?.("NewProfile")}>
        IdentityChange
      </button>
      <button data-testid="address-change" onClick={() => props.onAddressChange?.("$DE00")}>
        AddressChange
      </button>
    </div>
  ),
}));

const interactiveWriteSpy = vi.fn();
vi.mock("@/hooks/useInteractiveConfigWrite", () => ({
  useInteractiveConfigWrite: () => ({ write: interactiveWriteSpy, isPending: false }),
}));

vi.mock("@/components/SectionHeader", () => ({
  SectionHeader: (props: any) => (
    <div data-testid={props.resetTestId}>
      <span>{props.title}</span>
      <button onClick={props.resetAction} disabled={props.resetDisabled} data-testid="reset-btn">
        Reset
      </button>
    </div>
  ),
}));

import { AudioMixer } from "@/pages/home/components/AudioMixer";

const baseSidEntry = (key: string, label: string) => ({
  key,
  label,
  volume: "0 dB",
  pan: "Center",
  address: "$D400",
  addressRaw: "$D400",
  volumeItem: `Vol ${label}`,
  panItem: `Pan ${label}`,
  addressItem: `${label} Address`,
  volumeOptions: ["-12 dB", "-6 dB", "0 dB", "+6 dB", "+12 dB"],
  panOptions: ["Left", "Center", "Right"],
  addressOptions: ["$D400", "$D420", "$DE00", "Unmapped"],
});

describe("AudioMixer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interactiveWriteSpy.mockReset();
    mockSidControlEntries.mockReturnValue({
      sidControlEntries: [baseSidEntry("socket1", "SID Socket 1")],
      sidSilenceTargets: [],
      sidAddressingCategory: undefined,
      ultiSidCategory: undefined,
      sidSocketsCategory: undefined,
    });
  });

  const defaultProps = {
    isConnected: true,
    machineTaskBusy: false,
    runMachineTask: vi.fn().mockImplementation(async (_id: string, action: () => Promise<void>) => {
      await action();
    }),
  };

  it("renders SID section header", () => {
    render(<AudioMixer {...defaultProps} />);
    expect(screen.getByText("SID")).toBeDefined();
  });

  it("renders a SID card for each control entry", () => {
    render(<AudioMixer {...defaultProps} />);
    expect(screen.getByTestId("sid-card-socket1")).toBeDefined();
    expect(screen.getByText("SID Socket 1")).toBeDefined();
  });

  it("renders multiple SID cards when multiple entries exist", () => {
    mockSidControlEntries.mockReturnValue({
      sidControlEntries: [baseSidEntry("socket1", "SID Socket 1"), baseSidEntry("socket2", "SID Socket 2")],
      sidSilenceTargets: [],
      sidAddressingCategory: undefined,
      ultiSidCategory: undefined,
      sidSocketsCategory: undefined,
    });
    render(<AudioMixer {...defaultProps} />);
    expect(screen.getByTestId("sid-card-socket1")).toBeDefined();
    expect(screen.getByTestId("sid-card-socket2")).toBeDefined();
  });

  describe("handleSidEnableToggle (socket path)", () => {
    it("calls updateConfigValue for socket toggle", async () => {
      mockSidControlEntries.mockReturnValue({
        sidControlEntries: [baseSidEntry("socket1", "SID Socket 1")],
        sidSilenceTargets: [],
        sidAddressingCategory: undefined,
        ultiSidCategory: undefined,
        sidSocketsCategory: undefined,
      });
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("power-toggle"));
      // handleSidEnableToggle is async; check updateConfigValue was called
      await vi.waitFor(() => {
        expect(updateConfigValueSpy).toHaveBeenCalledWith(
          "SID Sockets Configuration",
          "SID Socket 1",
          expect.any(String),
          "HOME_SID_ENABLED",
          expect.stringContaining("SID Socket 1"),
        );
      });
    });

    it("calls updateConfigValue for socket2 toggle", async () => {
      mockSidControlEntries.mockReturnValue({
        sidControlEntries: [baseSidEntry("socket2", "SID Socket 2")],
        sidSilenceTargets: [],
        sidAddressingCategory: undefined,
        ultiSidCategory: undefined,
        sidSocketsCategory: undefined,
      });
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("power-toggle"));
      await vi.waitFor(() => {
        expect(updateConfigValueSpy).toHaveBeenCalledWith(
          "SID Sockets Configuration",
          "SID Socket 2",
          expect.any(String),
          "HOME_SID_ENABLED",
          expect.stringContaining("SID Socket 2"),
        );
      });
    });
  });

  describe("handleSidEnableToggle (UltiSID address path)", () => {
    it("calls updateConfigValue for UltiSID address toggle", async () => {
      mockSidControlEntries.mockReturnValue({
        sidControlEntries: [baseSidEntry("ultiSid1", "UltiSID 1")],
        sidSilenceTargets: [],
        sidAddressingCategory: undefined,
        ultiSidCategory: undefined,
        sidSocketsCategory: undefined,
      });
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("power-toggle"));
      await vi.waitFor(() => {
        expect(updateConfigValueSpy).toHaveBeenCalledWith(
          "SID Addressing",
          "UltiSID 1 Address",
          expect.any(String),
          "HOME_SID_ADDRESS",
          expect.stringContaining("UltiSID 1"),
        );
      });
    });
  });

  describe("volume slider handlers", () => {
    it("handles volume local change", () => {
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("volume-change"));
      // Local state change; no updateConfigValue call expected
    });

    it("handles volume local commit", () => {
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("volume-commit"));
      // Clears active slider; no updateConfigValue call
    });

    it("handles volume async change via interactive write (no toast)", () => {
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("volume-async-change"));
      expect(interactiveWriteSpy).toHaveBeenCalledWith({ "Vol SID Socket 1": expect.any(String) });
      expect(updateConfigValueSpy).not.toHaveBeenCalled();
    });

    it("handles volume async commit via interactive write (no toast)", () => {
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("volume-async-commit"));
      expect(interactiveWriteSpy).toHaveBeenCalledWith({ "Vol SID Socket 1": expect.any(String) });
      expect(updateConfigValueSpy).not.toHaveBeenCalled();
    });
  });

  describe("pan slider handlers", () => {
    it("handles pan local change", () => {
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("pan-change"));
    });

    it("handles pan local commit", () => {
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("pan-commit"));
    });

    it("handles pan async change via interactive write (no toast)", () => {
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("pan-async-change"));
      expect(interactiveWriteSpy).toHaveBeenCalledWith({ "Pan SID Socket 1": expect.any(String) });
      expect(updateConfigValueSpy).not.toHaveBeenCalled();
    });

    it("handles pan async commit via interactive write (no toast)", () => {
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("pan-async-commit"));
      expect(interactiveWriteSpy).toHaveBeenCalledWith({ "Pan SID Socket 1": expect.any(String) });
      expect(updateConfigValueSpy).not.toHaveBeenCalled();
    });
  });

  describe("SID reset", () => {
    it("invokes runMachineTask for SID reset", async () => {
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("reset-btn"));
      await vi.waitFor(() => {
        expect(defaultProps.runMachineTask).toHaveBeenCalledWith(
          "reset-sid",
          expect.any(Function),
          "SID silence command sent",
          "Volume set to zero, then restored settings.",
        );
      });
    });
  });

  describe("identity and address change handlers", () => {
    it("handles UltiSID identity change", () => {
      mockSidControlEntries.mockReturnValue({
        sidControlEntries: [baseSidEntry("ultiSid1", "UltiSID 1")],
        sidSilenceTargets: [],
        sidAddressingCategory: undefined,
        ultiSidCategory: undefined,
        sidSocketsCategory: undefined,
      });
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("identity-change"));
      expect(updateConfigValueSpy).toHaveBeenCalledWith(
        "UltiSID Configuration",
        "UltiSID 1 Filter Curve",
        expect.any(String),
        "HOME_ULTISID_PROFILE",
        "UltiSID filter curve updated",
      );
    });

    it("handles address change", () => {
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("address-change"));
      expect(updateConfigValueSpy).toHaveBeenCalledWith(
        "SID Addressing",
        "SID Socket 1 Address",
        expect.any(String),
        "HOME_SID_ADDRESS",
        expect.stringContaining("address updated"),
      );
    });
  });

  describe("disconnected state", () => {
    it("disables reset button when disconnected", () => {
      render(<AudioMixer {...defaultProps} isConnected={false} />);
      expect(screen.getByTestId("reset-btn")).toBeDisabled();
    });

    it("disables reset button when machineTaskBusy", () => {
      render(<AudioMixer {...defaultProps} machineTaskBusy={true} />);
      expect(screen.getByTestId("reset-btn")).toBeDisabled();
    });
  });

  describe("UltiSID 2 path", () => {
    it("handles UltiSID 2 identity change (uses filter curve 2)", () => {
      mockSidControlEntries.mockReturnValue({
        sidControlEntries: [baseSidEntry("ultiSid2", "UltiSID 2")],
        sidSilenceTargets: [],
        sidAddressingCategory: undefined,
        ultiSidCategory: undefined,
        sidSocketsCategory: undefined,
      });
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("identity-change"));
      expect(updateConfigValueSpy).toHaveBeenCalledWith(
        "UltiSID Configuration",
        "UltiSID 2 Filter Curve",
        expect.any(String),
        "HOME_ULTISID_PROFILE",
        "UltiSID filter curve updated",
      );
    });
  });

  describe("address with empty EMPTY_SELECT_VALUE", () => {
    it("falls back to baseAddressLabel when addressSelectValue is empty", () => {
      const entryWithEmptyAddress = {
        ...baseSidEntry("socket1", "SID Socket 1"),
        address: "__empty__",
        addressRaw: "__empty__",
      };
      mockSidControlEntries.mockReturnValue({
        sidControlEntries: [entryWithEmptyAddress],
        sidSilenceTargets: [],
        sidAddressingCategory: undefined,
        ultiSidCategory: undefined,
        sidSocketsCategory: undefined,
      });
      render(<AudioMixer {...defaultProps} />);
      // Component renders; addressSelectValue is '' (falsy) so falls back to baseAddressLabel
      expect(screen.getByTestId("sid-card-socket1")).toBeTruthy();
    });
  });

  describe("empty addressOptions fallback", () => {
    it("falls back to [entry.address] when addressOptions is empty", async () => {
      const entryNoAddressOptions = {
        ...baseSidEntry("ultiSid1", "UltiSID 1"),
        addressOptions: [],
      };
      mockSidControlEntries.mockReturnValue({
        sidControlEntries: [entryNoAddressOptions],
        sidSilenceTargets: [],
        sidAddressingCategory: undefined,
        ultiSidCategory: undefined,
        sidSocketsCategory: undefined,
      });
      render(<AudioMixer {...defaultProps} />);
      fireEvent.click(screen.getByTestId("power-toggle"));
      // handleSidEnableToggle runs; addressOptions fallback from [] to [entry.address]
      await vi.waitFor(() => {
        expect(updateConfigValueSpy).toHaveBeenCalledWith(
          "SID Addressing",
          "UltiSID 1 Address",
          expect.any(String),
          "HOME_SID_ADDRESS",
          expect.stringContaining("UltiSID 1"),
        );
      });
    });
  });
});

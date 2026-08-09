/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configItem: vi.fn(),
  connectionEpoch: vi.fn(),
  appVisible: vi.fn(),
  readFtpFile: vi.fn(),
  resolveFtpConnectionOptions: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useC64ConfigItem: mocks.configItem,
  useConnectionRoutingEpoch: mocks.connectionEpoch,
}));

vi.mock("@/hooks/useScreenActivity", () => ({
  useAppVisibilityState: mocks.appVisible,
}));

vi.mock("@/lib/ftp/ftpClient", () => ({
  readFtpFile: mocks.readFtpFile,
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  resolveFtpConnectionOptions: mocks.resolveFtpConnectionOptions,
}));

vi.mock("@/lib/logging", () => ({
  addLog: mocks.addLog,
}));

import { useDeviceVicPalette } from "@/hooks/useDeviceVicPalette";
import {
  DEVICE_VIC_PALETTE_ID,
  __resetVicPalette,
  activeVicPalette,
  setActiveVicPalette,
} from "@/lib/streams/vicPalette";

const PALETTE_CATEGORY = "U64 Specific Settings";
const PALETTE_ITEM = "Palette Definition";

const deviceConfig = (path: string) => ({
  [PALETTE_CATEGORY]: {
    items: {
      [PALETTE_ITEM]: { value: path },
    },
  },
});

const deviceVpl = (description: string, red = "12 34 56") => `# NAME: Device palette
# DESC: ${description}
00 00 00
f7 f7 f7
${red}
6a d4 cd
98 35 a4
4c b4 42
2c 29 b1
ef ef 5d
98 4e 20
5b 38 00
d1 67 6d
4a 4a 4a
7b 7b 7b
9f ef 93
6d 6a ef
b2 b2 b2`;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("useDeviceVicPalette", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetVicPalette();
    mocks.connectionEpoch.mockReturnValue(0);
    mocks.appVisible.mockReturnValue(true);
    mocks.configItem.mockReturnValue({ data: deviceConfig("/Usb0/device.vpl") });
    mocks.resolveFtpConnectionOptions.mockResolvedValue({ host: "u64" });
    mocks.readFtpFile.mockResolvedValue({ data: btoa(deviceVpl("From the configured device VPL")) });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads the configured VPL while automatic mode is selected", async () => {
    renderHook(() => useDeviceVicPalette(), { wrapper: createWrapper() });

    await waitFor(() => expect(activeVicPalette().description).toBe("From the configured device VPL"));
    expect(mocks.readFtpFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/Usb0/device.vpl", timeoutMs: 3_000, __c64uIntent: "background" }),
    );
  });

  it("refreshes the same configured VPL after returning from a manual palette", async () => {
    mocks.readFtpFile.mockResolvedValueOnce({ data: btoa(deviceVpl("Original device VPL")) });
    mocks.readFtpFile.mockResolvedValueOnce({ data: btoa(deviceVpl("Refreshed device VPL", "ab cd ef")) });
    renderHook(() => useDeviceVicPalette(), { wrapper: createWrapper() });

    await waitFor(() => expect(activeVicPalette().description).toBe("Original device VPL"));
    act(() => setActiveVicPalette("monochrome"));
    expect(activeVicPalette().id).toBe("monochrome");
    act(() => setActiveVicPalette(DEVICE_VIC_PALETTE_ID));

    await waitFor(() => expect(activeVicPalette().description).toBe("Refreshed device VPL"));
    expect(mocks.readFtpFile).toHaveBeenCalledTimes(2);
  });

  it("waits until the app is visible before refreshing the device palette", async () => {
    mocks.appVisible.mockReturnValue(false);
    const hook = renderHook(() => useDeviceVicPalette(), { wrapper: createWrapper() });

    await waitFor(() => expect(activeVicPalette().description).toBe("From the configured device VPL"));
    expect(mocks.readFtpFile).toHaveBeenCalledTimes(1);
    mocks.appVisible.mockReturnValue(true);
    hook.rerender();

    await waitFor(() => expect(mocks.readFtpFile).toHaveBeenCalledTimes(2));
  });

  it("uses the firmware fallback and records why the device configuration is unavailable", async () => {
    mocks.configItem.mockReturnValue({ error: new Error("configuration request failed") });
    renderHook(() => useDeviceVicPalette(), { wrapper: createWrapper() });

    await waitFor(() =>
      expect(mocks.addLog).toHaveBeenCalledWith("warn", "Device palette configuration unavailable; using Default", {
        message: "configuration request failed",
      }),
    );
    expect(activeVicPalette().description).toBe("C64 Ultimate Default Palette");
    expect(mocks.readFtpFile).not.toHaveBeenCalled();
  });

  it("uses the firmware fallback and records an unreadable configured VPL", async () => {
    mocks.readFtpFile.mockRejectedValue(new Error("FTP request failed"));
    renderHook(() => useDeviceVicPalette(), { wrapper: createWrapper() });

    await waitFor(() =>
      expect(mocks.addLog).toHaveBeenCalledWith("warn", "Device palette unavailable; using Default", {
        path: "/Usb0/device.vpl",
        message: "FTP request failed",
      }),
    );
    expect(activeVicPalette().description).toBe("C64 Ultimate Default Palette");
  });
});

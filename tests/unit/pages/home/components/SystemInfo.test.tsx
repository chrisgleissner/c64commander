/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SystemInfo } from "@/pages/home/components/SystemInfo";

const mockUseC64Connection = vi.fn();

vi.mock("@/hooks/useC64Connection", () => ({
  VISIBLE_C64_QUERY_OPTIONS: {
    intent: "user",
    refetchOnMount: "always",
  },
  useC64Connection: () => mockUseC64Connection(),
}));

vi.mock("@/lib/buildInfo", () => ({
  getBuildInfo: () => ({
    versionLabel: "1.2.3",
    gitShaShort: "abc123",
    buildTimeUtc: "2026-01-01T00:00:00Z",
  }),
}));

// framer-motion: render children directly
vi.mock("framer-motion", () => ({
  motion: {
    button: ({ children, onClick, ...rest }: any) => (
      <button onClick={onClick} {...rest}>
        {children}
      </button>
    ),
  },
}));

describe("SystemInfo", () => {
  it("shows Not connected when disconnected", () => {
    mockUseC64Connection.mockReturnValue({
      status: { isConnected: false, deviceInfo: null },
    });
    render(<SystemInfo />);
    expect(screen.getAllByText("Not connected").length).toBeGreaterThan(0);
    expect(screen.getByTestId("home-system-version")).toHaveTextContent("1.2.3");
  });

  it("shows device hostname and firmware when connected", () => {
    mockUseC64Connection.mockReturnValue({
      status: {
        isConnected: true,
        deviceInfo: {
          hostname: "my-c64",
          firmware_version: "3.11",
          product: "Ultimate 64",
          fpga_version: "0.9",
          core_version: "1.0",
          unique_id: "AABBCC",
        },
      },
    });
    render(<SystemInfo />);
    expect(screen.getByTestId("home-system-device")).toHaveTextContent("my-c64");
    expect(screen.getByTestId("home-system-firmware")).toHaveTextContent("3.11");
  });

  it("falls back to product when hostname is absent", () => {
    mockUseC64Connection.mockReturnValue({
      status: {
        isConnected: true,
        deviceInfo: { hostname: null, product: "Ultimate 64", firmware_version: null },
      },
    });
    render(<SystemInfo />);
    expect(screen.getByTestId("home-system-device")).toHaveTextContent("Ultimate 64");
    expect(screen.getByTestId("home-system-firmware")).toHaveTextContent("Not available");
  });

  it("shows expanded details with device info on click", () => {
    mockUseC64Connection.mockReturnValue({
      status: {
        isConnected: true,
        deviceInfo: {
          hostname: "c64",
          firmware_version: "3.0",
          fpga_version: "fpga1",
          core_version: "core1",
          unique_id: "id1",
        },
      },
    });
    render(<SystemInfo />);
    expect(screen.queryByTestId("home-system-git")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("home-system-info"));

    expect(screen.getByTestId("home-system-git")).toHaveTextContent("abc123");
    expect(screen.getByTestId("home-system-fpga")).toHaveTextContent("fpga1");
    expect(screen.getByTestId("home-system-core")).toHaveTextContent("core1");
    expect(screen.getByTestId("home-system-core-id")).toHaveTextContent("id1");
  });

  it("shows Not available in expanded view when disconnected", () => {
    mockUseC64Connection.mockReturnValue({
      status: { isConnected: false, deviceInfo: null },
    });
    render(<SystemInfo />);
    fireEvent.click(screen.getByTestId("home-system-info"));
    const fpga = screen.getByTestId("home-system-fpga");
    expect(fpga).toHaveTextContent("Not available");
  });
});

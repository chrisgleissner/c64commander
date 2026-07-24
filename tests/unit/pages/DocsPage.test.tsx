import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DocsPage from "@/pages/DocsPage";
import type { FeatureFlags } from "@/lib/config/featureFlags";

const defaultFlags: FeatureFlags = {
  background_execution_enabled: true,
  commoserve_enabled: true,
  demo_mode_enabled: false,
  home_telnet_clear_ram_reboot_enabled: false,
  home_telnet_config_actions_enabled: false,
  home_telnet_drive_actions_enabled: false,
  home_telnet_power_cycle_enabled: false,
  home_telnet_printer_actions_enabled: false,
  home_telnet_reu_snapshot_enabled: false,
  hvsc_enabled: true,
  keypad_input_enabled: true,
  lighting_studio_enabled: false,
  ram_snapshots_enabled: true,
};

const featureFlagsRef = vi.hoisted(() => ({
  flags: {} as FeatureFlags,
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}));

vi.mock("@/components/AppBar", () => ({
  AppBar: ({ title }: { title: React.ReactNode }) => <div data-testid="docs-app-bar">{title}</div>,
}));

vi.mock("@/components/layout/AppChromeContext", () => ({
  usePrimaryPageShellClassName: () => "docs-shell",
}));

vi.mock("@/components/layout/PageContainer", () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlagValue: () => false,
  useFeatureFlags: () => ({ flags: featureFlagsRef.flags }),
}));

vi.mock("@/lib/tracing/userTrace", () => ({
  wrapUserEvent: (handler: () => void) => handler,
}));

describe("DocsPage", () => {
  beforeEach(() => {
    featureFlagsRef.flags = { ...defaultFlags };
  });

  it("renders the docs shell and expands help sections on demand", () => {
    render(<DocsPage />);

    expect(screen.getByTestId("docs-app-bar")).toHaveTextContent("Docs");
    expect(screen.queryByText("Connect in 4 steps:")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("docs-toggle-getting-started"));

    expect(screen.getByText("Connect in 4 steps:")).toBeInTheDocument();
    expect(screen.getByText(/Save & Connect/)).toBeInTheDocument();
  });

  it("renders diagnostics guidance and upstream resource links", () => {
    render(<DocsPage />);

    fireEvent.click(screen.getByTestId("docs-toggle-diagnostics"));

    expect(screen.getByText(/Closing a deep-linked diagnostics view returns to Settings/)).toBeInTheDocument();
    expect(screen.getByTestId("docs-external-resource-docs")).toHaveAttribute(
      "href",
      "https://1541u-documentation.readthedocs.io/",
    );
    expect(screen.getByTestId("docs-external-resource-api")).toHaveAttribute(
      "href",
      "https://1541u-documentation.readthedocs.io/en/latest/api/api_calls.html",
    );
    expect(screen.getByTestId("docs-external-resource-site")).toHaveAttribute("href", "https://ultimate64.com/");
  });

  it("describes enabled feature-flagged surfaces", () => {
    render(<DocsPage />);

    fireEvent.click(screen.getByTestId("docs-toggle-play"));
    fireEvent.click(screen.getByTestId("docs-toggle-home"));
    fireEvent.click(screen.getByTestId("docs-toggle-settings"));

    expect(screen.getByText(/Choose a source:/)).toHaveTextContent("Local, C64U, HVSC or CommoServe");
    expect(screen.getByText(/Save RAM/)).toBeInTheDocument();
    expect(screen.getByTestId("docs-card-settings")).toHaveTextContent("HVSC sets the mirror URL");
    expect(screen.getByTestId("docs-card-settings")).toHaveTextContent("Online Archive");
    expect(screen.queryByText(/Power Cycle/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lighting Studio/)).not.toBeInTheDocument();
  });

  it("documents every feature-flagged surface when all flags are enabled", () => {
    featureFlagsRef.flags = {
      background_execution_enabled: true,
      commoserve_enabled: true,
      demo_mode_enabled: true,
      home_telnet_clear_ram_reboot_enabled: true,
      home_telnet_config_actions_enabled: true,
      home_telnet_drive_actions_enabled: true,
      home_telnet_power_cycle_enabled: true,
      home_telnet_printer_actions_enabled: true,
      home_telnet_reu_snapshot_enabled: true,
      hvsc_enabled: true,
      keypad_input_enabled: true,
      lighting_studio_enabled: true,
      ram_snapshots_enabled: true,
    };

    render(<DocsPage />);

    fireEvent.click(screen.getByTestId("docs-toggle-getting-started"));
    fireEvent.click(screen.getByTestId("docs-toggle-home"));

    expect(screen.getByText(/Automatic Demo Mode/)).toBeInTheDocument();
    expect(screen.getByText(/Save RAM/)).toBeInTheDocument();
    expect(screen.getByText(/Power Cycle/)).toBeInTheDocument();
    expect(screen.getByText(/Reboot \(Clr Mem\)/)).toBeInTheDocument();
    expect(screen.getByText(/Save REU/)).toBeInTheDocument();
    expect(screen.getByText(/Telnet shortcuts add device-menu actions/)).toBeInTheDocument();
    expect(screen.getByText(/Advanced config actions add Save to File/)).toBeInTheDocument();
    expect(screen.getByText(/Lighting Studio adds Studio/)).toBeInTheDocument();
  });

  it("omits documentation for disabled feature-flagged surfaces", () => {
    featureFlagsRef.flags = {
      ...defaultFlags,
      commoserve_enabled: false,
      hvsc_enabled: false,
      ram_snapshots_enabled: false,
    };

    render(<DocsPage />);

    fireEvent.click(screen.getByTestId("docs-toggle-play"));
    fireEvent.click(screen.getByTestId("docs-toggle-home"));
    fireEvent.click(screen.getByTestId("docs-toggle-disks"));
    fireEvent.click(screen.getByTestId("docs-toggle-settings"));

    expect(screen.getByText(/Choose a source:/)).toHaveTextContent("Local or C64U");
    expect(screen.getByTestId("docs-card-disks")).toHaveTextContent("Local or C64U");
    expect(screen.queryByText(/Save RAM/)).not.toBeInTheDocument();
    expect(screen.queryByText(/HVSC/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CommoServe/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Online Archive/)).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { resetCardMemory } from "../helpers/cards";
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

const variantRef = vi.hoisted(() => ({
  id: "c64commander" as string,
  displayName: "C64 Commander" as string,
}));

vi.mock("@/generated/variant", () => ({
  get variant() {
    // `runtime` is part of the real module and is read at import time by app settings, which the
    // display-profile hook pulls in; a mock without it fails the whole suite on import.
    return { id: variantRef.id, displayName: variantRef.displayName, runtime: {} };
  },
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    section: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => <section {...props}>{children}</section>,
    span: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
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
    resetCardMemory();
    featureFlagsRef.flags = { ...defaultFlags };
    variantRef.id = "c64commander";
    variantRef.displayName = "C64 Commander";
    // Card open/closed state now persists to localStorage (CollapsibleSection), where
    // it previously reset on every mount - clear it so one test's clicks cannot leak
    // into the next test's expectations.
    localStorage.clear();
  });

  it("renders the docs shell and expands help sections on demand", () => {
    render(<DocsPage />);

    expect(screen.getByTestId("docs-app-bar")).toHaveTextContent("Docs");
    expect(screen.queryByText(/Save & Connect/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("docs-toggle-getting-started"));

    expect(screen.getByText(/Save & Connect/)).toBeInTheDocument();
  });

  it("renders diagnostics guidance and upstream resource links", () => {
    render(<DocsPage />);

    fireEvent.click(screen.getByTestId("docs-toggle-diagnostics"));

    expect(screen.getByText(/Device health, app activity and support data/)).toBeInTheDocument();

    // External resources is closed on a first visit: it points at other people's documentation,
    // read once if at all, and the page's own chapters are what a reader came for.
    fireEvent.click(screen.getByTestId("docs-section-toggle-external-resources"));
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

  it("hides the External resources card on c64u-remote, whose only link is already on Settings -> About", () => {
    variantRef.id = "c64u-remote";
    variantRef.displayName = "C64U Remote";

    render(<DocsPage />);

    expect(screen.queryByTestId("docs-external-resources")).not.toBeInTheDocument();
    expect(screen.queryByTestId("docs-external-resource-c64u-user-guide")).not.toBeInTheDocument();
  });

  /*
   * The three tests that used to live here asserted that the Docs page grew a bullet for each
   * enabled feature flag — a list of Home's actions, of Settings' chapters, of Play's steps. That
   * documentation was removed deliberately: it restated control labels the reader can already see,
   * and the app ships a full generated manual that says all of it properly. What is left is an
   * orientation index, so that is what is tested.
   */
  it("gives every chapter a short description rather than a procedure", () => {
    render(<DocsPage />);

    for (const id of ["getting-started", "home", "play", "disks", "config", "settings", "diagnostics"]) {
      fireEvent.click(screen.getByTestId(`docs-toggle-${id}`));
      const card = screen.getByTestId(`docs-card-${id}`);
      // Something is said...
      expect(card.textContent?.trim().length ?? 0).toBeGreaterThan(20);
      // ...and it is not a numbered or bulleted procedure, which belongs in the manual.
      expect(card.querySelectorAll("li")).toHaveLength(0);
    }
  });

  it("mentions Demo Mode only while the flag that offers it is on", () => {
    featureFlagsRef.flags = { demo_mode_enabled: true };
    const { unmount } = render(<DocsPage />);
    fireEvent.click(screen.getByTestId("docs-toggle-getting-started"));
    expect(screen.getByText(/Automatic Demo Mode/)).toBeInTheDocument();
    unmount();

    featureFlagsRef.flags = { demo_mode_enabled: false };
    render(<DocsPage />);
    fireEvent.click(screen.getByTestId("docs-toggle-getting-started"));
    expect(screen.queryByText(/Automatic Demo Mode/)).not.toBeInTheDocument();
  });
});

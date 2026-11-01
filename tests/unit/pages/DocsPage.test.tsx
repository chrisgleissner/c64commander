import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { openAllCards, resetCardMemory } from "../helpers/cards";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DocsPage from "@/pages/DocsPage";
import type { FeatureFlags } from "@/lib/config/featureFlags";
import { buildGuideChapters } from "@/lib/docs/guide/chapters";
import type { GuideBlock, GuideChapter } from "@/lib/docs/guide/types";
import { appDeviceName, targetDeviceDescription } from "@/lib/docs/deviceNames";
import { jumpToChapter } from "@/pages/docs/DocsContents";
import { ANCHOR_WAIT_CEILING_MS } from "@/lib/search/navigate";

const addLogMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logging", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging")>()),
  addLog: addLogMock,
}));

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
  remote_input_enabled: true,
  live_view_enabled: true,
  disk_explorer_enabled: true,
} as FeatureFlags;

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
  PageStack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlagValue: () => false,
  useFeatureFlags: () => ({ flags: featureFlagsRef.flags }),
}));

vi.mock("@/lib/tracing/userTrace", () => ({
  wrapUserEvent: (handler: () => void) => handler,
}));

const VARIANTS = ["c64commander", "c64u-remote"] as const;

const setVariant = (id: string) => {
  variantRef.id = id;
  variantRef.displayName = id === "c64u-remote" ? "C64U Remote" : "C64 Commander";
};

const blockText = (block: GuideBlock): string[] => {
  switch (block.kind) {
    case "text":
    case "tip":
      return [block.text];
    case "steps":
      return [block.heading ?? "", ...block.items];
    case "keys":
      return [block.heading ?? "", ...block.items.flatMap((item) => [item.key, item.action])];
  }
};

const chapterText = (chapters: readonly GuideChapter[]) =>
  chapters.flatMap((chapter) => [chapter.title, chapter.navLabel, ...chapter.blocks.flatMap(blockText)]).join(" ");

/** Words that keep their capitals in sentence case: product feature names, acronyms and page names. */
const PROPER_WORDS = new Set([
  ...["HVSC", "SID", "C64", "T9"],
  ...["Radio", "Remote", "Input", "Game", "Mode", "Live", "View", "Player", "Full", "App"],
  ...["Home", "Play", "Disks", "Config", "Settings", "Docs"],
]);

const sentenceCaseViolations = (text: string): string[] => {
  const [first, ...rest] = text.split(/\s+/);
  const violations = /^[A-Z0-9]/.test(first ?? "") ? [] : [first ?? ""];
  return violations.concat(rest.filter((word) => /^[A-Z]/.test(word) && !PROPER_WORDS.has(word.replace(/'s$/, ""))));
};

const BRITISH_SPELLINGS =
  /\b(colour|favourite|behaviour|organis|recognis|centre|licence|analogue|catalogue|grey|whilst|towards|cancelled|travelled)\w*/i;

/** The shape of a handset model, a capitalized word and a four-digit number, as the manual test guards it. */
const PHONE_MODELS = /\b[A-Z][a-z]+ \d{4}\b/;

describe("DocsPage", () => {
  beforeEach(() => {
    resetCardMemory();
    featureFlagsRef.flags = { ...defaultFlags };
    setVariant("c64commander");
    // Card open/closed state now persists to localStorage (CollapsibleSection), where
    // it previously reset on every mount - clear it so one test's clicks cannot leak
    // into the next test's expectations.
    localStorage.clear();
  });

  it("puts the contents before the tour card and names no chapter ambiguously", () => {
    render(<DocsPage />);

    const contents = screen.getByTestId("docs-card-contents");
    const tour = screen.getByTestId("docs-tour-card");
    expect(contents.compareDocumentPosition(tour) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("docs-contents-link-audio-output")).toHaveTextContent("Listen here or on C64");
    expect(screen.queryByText("Here or C64")).toBeNull();
  });

  it("renders the docs shell, a contents list, and every chapter closed until asked for", () => {
    render(<DocsPage />);

    expect(screen.getByTestId("docs-app-bar")).toHaveTextContent("Docs");
    expect(screen.getByTestId("docs-card-contents")).toHaveAttribute("data-open", "true");
    const chapters = buildGuideChapters({ variantId: "c64commander", flags: defaultFlags });
    for (const chapter of chapters) {
      expect(screen.getByTestId(`docs-contents-link-${chapter.id}`)).toHaveTextContent(chapter.navLabel);
      expect(screen.getByTestId(`docs-card-${chapter.id}`)).toHaveAttribute("data-open", "false");
    }
    expect(screen.queryByText(/Save & Connect/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("docs-toggle-devices"));
    expect(screen.getAllByText(/Save & Connect/).length).toBeGreaterThan(0);
  });

  it.each(VARIANTS)("renders every %s chapter with numbered steps a keypad ring can stop on", (variantId) => {
    setVariant(variantId);
    render(<DocsPage />);
    openAllCards();

    const chapters = buildGuideChapters({ variantId, flags: defaultFlags });
    expect(chapters.length).toBeGreaterThanOrEqual(16);
    for (const chapter of chapters) {
      const body = screen.getByTestId(`docs-chapter-body-${chapter.id}`);
      const steps = body.querySelectorAll("ol > li[data-guide-step]");
      expect(steps.length, `${chapter.id} has no numbered steps`).toBeGreaterThanOrEqual(2);
      const stops = body.querySelectorAll("[data-key-nav-reading]");
      expect(stops.length).toBeGreaterThanOrEqual(steps.length);
      for (const stop of stops) expect(stop).toHaveAttribute("tabindex", "0");
      // Markup is rendered, never shown as asterisks or backticks.
      expect(body.textContent).not.toMatch(/\*\*|`/);
    }
  });

  it("says at least ten times what the previous orientation page said", () => {
    // The page this replaced held about 190 words across eight one-line chapters.
    for (const variantId of VARIANTS) {
      const words = chapterText(buildGuideChapters({ variantId, flags: defaultFlags }))
        .split(/\s+/)
        .filter(Boolean).length;
      expect(words, `${variantId} guide is ${words} words`).toBeGreaterThanOrEqual(1900);
    }
  });

  it.each(VARIANTS)("writes %s chapter titles, headings and contents labels in sentence case", (variantId) => {
    for (const chapter of buildGuideChapters({ variantId, flags: defaultFlags })) {
      const headings = chapter.blocks.flatMap((block) =>
        (block.kind === "steps" || block.kind === "keys") && block.heading ? [block.heading] : [],
      );
      for (const text of [chapter.title, chapter.navLabel, ...headings]) {
        expect(sentenceCaseViolations(text), `"${text}" is not sentence case`).toEqual([]);
      }
    }
  });

  it("SPM-DOC-01 the Docs page in SID Player shows the SID Player chapter and no machine chapter", () => {
    saveStartupModeByUser("sid-player");
    try {
      render(<DocsPage />);
      expect(screen.getByTestId("docs-card-sid-player")).toBeInTheDocument();
      expect(screen.getByTestId("docs-card-play")).toBeInTheDocument();
      for (const id of ["disks", "config", "devices", "status-badge", "connection-problems"]) {
        expect(screen.queryByTestId(`docs-card-${id}`), id).toBeNull();
      }
    } finally {
      saveStartupModeByUser("default");
    }
  });

  it.each(VARIANTS)("uses American English and names no phone model in the %s guide", (variantId) => {
    const text = chapterText(buildGuideChapters({ variantId, flags: defaultFlags }));
    expect(text).not.toMatch(BRITISH_SPELLINGS);
    expect(text).not.toMatch(PHONE_MODELS);
  });

  it("names both machines through the manual's variant helpers", () => {
    const keypad = chapterText(buildGuideChapters({ variantId: "c64u-remote", flags: defaultFlags }));
    const broad = chapterText(buildGuideChapters({ variantId: "c64commander", flags: defaultFlags }));

    expect(keypad).toContain(targetDeviceDescription("c64u-remote"));
    expect(keypad).toContain(`your ${appDeviceName("c64u-remote")}`);
    expect(keypad).not.toMatch(/tablet|Ultimate 64 Elite|Ultimate-II/);

    expect(broad).toContain(targetDeviceDescription("c64commander"));
    expect(broad).toContain(`your ${appDeviceName("c64commander")}`);
  });

  it("describes the soft keys and T9 only in the keypad edition", () => {
    const keypad = chapterText(buildGuideChapters({ variantId: "c64u-remote", flags: defaultFlags }));
    const broad = chapterText(buildGuideChapters({ variantId: "c64commander", flags: defaultFlags }));
    expect(keypad).toMatch(/Right Soft Key/);
    expect(keypad).toMatch(/In a text field/);
    expect(broad).not.toMatch(/Soft Key|In a text field/);
  });

  it("jumps from the contents list to a chapter, opens it, and focuses its header", async () => {
    render(<DocsPage />);
    const card = screen.getByTestId("docs-card-diagnostics");
    card.scrollIntoView = vi.fn();

    fireEvent.click(screen.getByTestId("docs-contents-link-diagnostics"));

    await waitFor(() => expect(card).toHaveAttribute("data-open", "true"));
    await waitFor(() => expect(screen.getByTestId("docs-toggle-diagnostics")).toHaveFocus());
    expect(card.scrollIntoView).toHaveBeenCalledWith({ block: "start", inline: "nearest" });
  });

  it("leaves out chapters for features that are switched off", () => {
    const ids = (flags: Partial<FeatureFlags>) =>
      buildGuideChapters({ variantId: "c64commander", flags: { ...defaultFlags, ...flags } }).map(
        (chapter) => chapter.id,
      );
    expect(ids({})).toEqual(expect.arrayContaining(["play", "find-tune", "sid-radio", "live-view", "game-mode"]));
    expect(ids({ hvsc_enabled: false })).not.toEqual(expect.arrayContaining(["play"]));
    expect(ids({ hvsc_enabled: false })).not.toContain("sid-radio");
    expect(ids({ remote_input_enabled: false })).not.toContain("game-mode");
    expect(ids({ live_view_enabled: false })).not.toContain("live-view");
    expect(ids({ keypad_input_enabled: false })).not.toContain("keypad");

    const text = (flags: Partial<FeatureFlags>) =>
      chapterText(buildGuideChapters({ variantId: "c64commander", flags: { ...defaultFlags, ...flags } }));
    expect(text({})).toMatch(/Disk Explorer/);
    expect(text({ disk_explorer_enabled: false })).not.toMatch(/Disk Explorer/);
    expect(text({})).toMatch(/Save the C64's memory/);
    expect(text({ ram_snapshots_enabled: false })).not.toMatch(/Save the C64's memory/);
  });

  it("logs and gives up when the contents list names a chapter that is not on the page", async () => {
    vi.useFakeTimers();
    try {
      const result = jumpToChapter("no-such-chapter");
      await vi.advanceTimersByTimeAsync(ANCHOR_WAIT_CEILING_MS + 1);
      await expect(result).resolves.toBe(false);
      expect(addLogMock).toHaveBeenCalledWith("warn", "Docs contents could not find the chapter it links to", {
        chapterId: "no-such-chapter",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders upstream resource links in the broad edition", () => {
    render(<DocsPage />);

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

  it("hides the External resources card on c64u-remote, whose phone cannot open links", () => {
    variantRef.id = "c64u-remote";
    variantRef.displayName = "C64U Remote";

    render(<DocsPage />);

    expect(screen.queryByTestId("docs-external-resources")).not.toBeInTheDocument();
    expect(screen.queryByTestId("docs-external-resource-c64u-user-guide")).not.toBeInTheDocument();
  });

  it("mentions Demo Mode only while its flag is on", () => {
    featureFlagsRef.flags = { ...defaultFlags, demo_mode_enabled: true };
    const { unmount } = render(<DocsPage />);
    fireEvent.click(screen.getByTestId("docs-toggle-getting-started"));
    expect(screen.getByText(/With no network at all/)).toBeInTheDocument();
    unmount();

    // CollapsibleSection persists open/closed state, so without this the second click
    // would close the card the first one opened and the negative assertion below would
    // pass against an unrendered section rather than an absent sentence.
    localStorage.clear();
    featureFlagsRef.flags = { ...defaultFlags, demo_mode_enabled: false };
    render(<DocsPage />);
    fireEvent.click(screen.getByTestId("docs-toggle-getting-started"));
    expect(screen.getByText(/Web Remote Control Service/)).toBeInTheDocument();
    expect(screen.queryByText(/With no network at all/)).not.toBeInTheDocument();
  });
});

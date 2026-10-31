/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import { APP_SETTINGS_KEYS } from "@/lib/config/appSettings";
import { SwipeNavigationLayer } from "@/components/SwipeNavigationLayer";
import { registerNavigationGuard } from "@/lib/navigation/navigationGuards";
import { requestPageReset } from "@/lib/navigation/pageReset";
import { resetPagePositionsForTests } from "@/lib/navigation/pagePositions";
import { tabIndexForPath } from "@/lib/navigation/tabRoutes";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import { useStableNavigate } from "@/hooks/useStableNavigate";
import { InterstitialStateProvider, useRegisterInterstitial } from "@/components/ui/interstitial-state";

type GestureCallbacks = {
  onProgress: (dx: number, velocityX: number) => void;
  onCommit: (direction: 1 | -1, metadata: { dx: number; dy: number; velocityX: number }) => void;
  onCancel: (metadata: { dx: number; dy: number; velocityX: number }) => void;
  onActiveChange?: (active: boolean) => void;
};

const mocks = vi.hoisted(() => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
  mountCounts: {
    home: 0,
    play: 0,
    disks: 0,
    config: 0,
    settings: 0,
    docs: 0,
  },
  playInstances: { count: 0 },
  settingsInstances: { count: 0 },
  homeRenders: { count: 0 },
  docsLastPath: { value: "" },
  unmountCounts: {
    home: 0,
    play: 0,
    disks: 0,
    config: 0,
    settings: 0,
    docs: 0,
  },
}));

let currentProfile: "compact" | "medium" = "medium";
let capturedCallbacks: GestureCallbacks | null = null;
let shouldThrowDocsPage = false;

vi.mock("@/hooks/useDisplayProfile", () => ({
  useDisplayProfile: () => ({
    viewportWidth: 390,
    autoProfile: currentProfile,
    profile: currentProfile,
    override: "auto",
    overrideLabel: "Auto",
    tokens: {},
    setOverride: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSwipeGesture", () => ({
  useSwipeGesture: vi.fn((_ref, callbacks: GestureCallbacks) => {
    capturedCallbacks = callbacks;
  }),
}));

vi.mock("@/lib/logging", () => ({
  addLog: mocks.addLog,
  addErrorLog: mocks.addErrorLog,
}));

vi.mock("@/lib/i18n", () => ({
  t: (_key: string, fallback: string) => fallback,
}));

vi.mock("@/pages/HomePage", () => ({
  default: function HomePageMock() {
    mocks.homeRenders.count += 1;
    useStableNavigate();
    React.useEffect(() => {
      mocks.mountCounts.home += 1;
    }, []);
    return <div>Home Page</div>;
  },
}));
vi.mock("@/pages/PlayFilesPage", () => ({
  default: function PlayFilesPageMock() {
    React.useEffect(() => {
      mocks.mountCounts.play += 1;
      return () => {
        mocks.unmountCounts.play += 1;
      };
    }, []);
    const [instance] = React.useState(() => ++mocks.playInstances.count);
    return (
      <div data-page-scroll-container="true" data-testid="play-scroller" data-instance={instance}>
        Play Page
      </div>
    );
  },
}));
vi.mock("@/pages/DisksPage", () => ({
  default: function DisksPageMock() {
    React.useEffect(() => {
      mocks.mountCounts.disks += 1;
      return () => {
        mocks.unmountCounts.disks += 1;
      };
    }, []);
    return <div>Disks Page</div>;
  },
}));
vi.mock("@/pages/ConfigBrowserPage", () => ({
  default: function ConfigBrowserPageMock() {
    React.useEffect(() => {
      mocks.mountCounts.config += 1;
    }, []);
    return <div>Config Page</div>;
  },
}));
vi.mock("@/pages/SettingsPage", () => ({
  default: function SettingsPageMock() {
    React.useEffect(() => {
      mocks.mountCounts.settings += 1;
    }, []);
    React.useState(() => ++mocks.settingsInstances.count);
    return <div>Settings Page</div>;
  },
}));
vi.mock("@/pages/OpenSourceLicensesPage", () => ({ default: () => <div>Open Source Licenses Page</div> }));
vi.mock("@/pages/DocsPage", () => ({
  default: function DocsPageMock() {
    React.useEffect(() => {
      mocks.mountCounts.docs += 1;
    }, []);
    mocks.docsLastPath.value = useLocation().pathname;
    if (shouldThrowDocsPage) {
      throw new Error("docs render failed");
    }
    return <div>Docs Page</div>;
  },
}));

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
};

const NavigationProbe = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/config")}>
      Go Config
    </button>
  );
};

const PathNavigationProbe = () => {
  const navigate = useNavigate();
  return (
    <>
      {["/", "/play", "/disks", "/settings", "/docs"].map((path) => (
        <button key={path} type="button" onClick={() => navigate(path)}>
          {`Go ${path}`}
        </button>
      ))}
    </>
  );
};

const SettingsOverlayNavigationProbe = () => {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate("/settings/open-source-licenses")}>
        Open Licenses Route
      </button>
      <button type="button" onClick={() => navigate("/settings")}>
        Close Licenses Route
      </button>
    </>
  );
};

const InterstitialRegistrar = ({ active }: { active: boolean }) => {
  useRegisterInterstitial("sheet", active);
  return null;
};

const renderLayer = (
  pathname: string,
  extra?: React.ReactNode,
  interstitialActive = false,
  swipeNavigationEnabled = false,
) => {
  localStorage.setItem(APP_SETTINGS_KEYS.ENABLE_SWIPE_NAVIGATION_KEY, swipeNavigationEnabled ? "1" : "0");
  window.history.pushState({}, "", pathname);
  return render(
    <BrowserRouter>
      <InterstitialStateProvider>
        <InterstitialRegistrar active={interstitialActive} />
        <SwipeNavigationLayer />
        <LocationProbe />
        {extra}
      </InterstitialStateProvider>
    </BrowserRouter>,
  );
};

describe("SwipeNavigationLayer", () => {
  beforeEach(() => {
    currentProfile = "medium";
    capturedCallbacks = null;
    shouldThrowDocsPage = false;
    localStorage.clear();
    Object.keys(mocks.mountCounts).forEach((key) => {
      mocks.mountCounts[key as keyof typeof mocks.mountCounts] = 0;
    });
    Object.keys(mocks.unmountCounts).forEach((key) => {
      mocks.unmountCounts[key as keyof typeof mocks.unmountCounts] = 0;
    });
    mocks.playInstances.count = 0;
    mocks.settingsInstances.count = 0;
    mocks.homeRenders.count = 0;
    mocks.docsLastPath.value = "";
    resetPagePositionsForTests();
    mocks.addLog.mockReset();
    mocks.addErrorLog.mockReset();
    document.documentElement.dataset.c64MotionMode = "standard";
    delete (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled;
  });

  afterEach(() => {
    document.documentElement.dataset.c64MotionMode = "standard";
  });

  it("returns null for unknown routes", () => {
    renderLayer("/unknown");
    expect(screen.queryByTestId("swipe-navigation-runway")).not.toBeInTheDocument();
  });

  it("disables swipe gestures by default", async () => {
    renderLayer("/");

    expect(await screen.findByTestId("swipe-navigation-container")).toHaveAttribute("data-swipe-enabled", "false");

    act(() => {
      capturedCallbacks?.onCommit(1, { dx: -120, dy: 0, velocityX: -1 });
    });

    expect(screen.getByTestId("location-probe")).toHaveTextContent("/");
  });

  /*
   * The tour disables swiping outright: a swipe that changed the page under a spotlight would leave
   * the spotlight pointing at nothing (spec.md section 8.1).
   */
  it("disables swipe gestures while the tour is running, even with the setting on", async () => {
    document.documentElement.setAttribute("data-tour-active", "true");
    try {
      renderLayer("/", undefined, false, true);
      expect(await screen.findByTestId("swipe-navigation-container")).toHaveAttribute("data-swipe-enabled", "false");

      act(() => {
        capturedCallbacks?.onCommit(1, { dx: -120, dy: 0, velocityX: -1 });
      });

      expect(screen.getByTestId("location-probe")).toHaveTextContent("/");
    } finally {
      document.documentElement.removeAttribute("data-tour-active");
    }
  });

  it("swipes again as soon as the tour ends", async () => {
    renderLayer("/", undefined, false, true);
    expect(await screen.findByTestId("swipe-navigation-container")).toHaveAttribute("data-swipe-enabled", "true");
  });

  it("clips page slots so a scrollIntoView cannot slide the page header under the status bar", async () => {
    // An overflow-hidden slot is still scrollable by script; on the Pixel 4 it moved the header 40px up.
    renderLayer("/play");
    expect(await screen.findByText("Play Page")).toBeInTheDocument();
    for (const slot of ["home", "play", "disks"]) {
      expect(screen.getByTestId(`swipe-slot-${slot}`).className, slot).toContain("overflow-clip");
    }
  });

  it("renders the requested slot and settings sub-routes", async () => {
    renderLayer("/settings/open-source-licenses");
    expect(await screen.findByText("Settings Page")).toBeInTheDocument();
    expect(await screen.findByText("Open Source Licenses Page")).toBeInTheDocument();
    expect(screen.getByTestId("swipe-slot-settings")).toHaveAttribute("data-slot-active", "true");
    expect(screen.getByTestId("swipe-slot-config")).toHaveAttribute("inert", "");
  });

  it("keeps Settings mounted when opening and closing the licenses overlay", async () => {
    renderLayer("/settings", <SettingsOverlayNavigationProbe />);

    expect(await screen.findByText("Settings Page")).toBeInTheDocument();
    expect(mocks.mountCounts.settings).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Open Licenses Route" }));

    expect(await screen.findByText("Open Source Licenses Page")).toBeInTheDocument();
    expect(mocks.mountCounts.settings).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Close Licenses Route" }));

    expect(screen.queryByText("Open Source Licenses Page")).not.toBeInTheDocument();
    expect(screen.getByText("Settings Page")).toBeInTheDocument();
    expect(mocks.mountCounts.settings).toBe(1);
  });

  it("maps diagnostics deep links into the settings slot", async () => {
    renderLayer("/diagnostics/history");

    expect(await screen.findByText("Settings Page")).toBeInTheDocument();
    expect(screen.getByTestId("swipe-slot-settings")).toHaveAttribute("data-slot-active", "true");
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/diagnostics/history");
  });

  it("tracks drag progress and cancels back to the same page", async () => {
    renderLayer("/play", undefined, false, true);
    const runway = await screen.findByTestId("swipe-navigation-runway");

    act(() => {
      capturedCallbacks?.onProgress(-24, -0.3);
    });
    expect(runway).toHaveAttribute("data-runway-phase", "dragging");

    act(() => {
      capturedCallbacks?.onCancel({ dx: -24, dy: 4, velocityX: -0.3 });
    });
    expect(runway).toHaveAttribute("data-runway-phase", "transitioning");

    fireEvent.transitionEnd(runway, { target: runway });
    expect(runway).toHaveAttribute("data-runway-phase", "idle");
    expect(screen.getByTestId("swipe-slot-play")).toHaveAttribute("data-slot-active", "true");
    expect(mocks.addLog).toHaveBeenCalledWith(
      "debug",
      "[SwipeNav] transition-start",
      expect.objectContaining({ reason: "cancel", from: "Play", to: "Play" }),
    );
  });

  it("keeps idle inactive slots empty so page selectors stay unique", async () => {
    renderLayer("/play");

    expect(await screen.findByText("Play Page")).toBeInTheDocument();
    expect(screen.getByTestId("swipe-slot-play")).toHaveAttribute("data-slot-active", "true");
    expect(screen.getByTestId("swipe-slot-home").textContent).toBe("");
    expect(screen.getByTestId("swipe-slot-disks").textContent).toBe("");
    expect(screen.queryByText("Home Page")).not.toBeInTheDocument();
    expect(screen.queryByText("Disks Page")).not.toBeInTheDocument();
  });

  it("names the active slot with a page id so a Maestro navigation assertion can fail", async () => {
    renderLayer("/settings");

    expect(await screen.findByText("Settings Page")).toBeInTheDocument();
    // Maestro `id:` matches the HTML id attribute, so this is the only anchor a flow can
    // use to tell one tab from another: the tab-bar labels render outside the page and are
    // present whichever tab is selected.
    expect(screen.getByTestId("swipe-slot-settings")).toHaveAttribute("id", "page-settings");
    expect(screen.getByTestId("swipe-slot-config")).not.toHaveAttribute("id");
    expect(screen.getByTestId("swipe-slot-docs")).not.toHaveAttribute("id");
    expect(document.querySelectorAll("[id^='page-']")).toHaveLength(1);
  });

  it("moves the page id to the tab the swipe is committing to", async () => {
    renderLayer("/play", undefined, false, true);
    const runway = await screen.findByTestId("swipe-navigation-runway");

    act(() => {
      capturedCallbacks?.onCommit(1, { dx: -180, dy: 2, velocityX: -1.4 });
    });
    expect(screen.getByTestId("swipe-slot-disks")).toHaveAttribute("id", "page-disks");
    expect(screen.getByTestId("swipe-slot-play")).not.toHaveAttribute("id");

    fireEvent.transitionEnd(runway, { target: runway });
    expect(screen.getByTestId("swipe-slot-disks")).toHaveAttribute("id", "page-disks");
    expect(document.querySelectorAll("[id^='page-']")).toHaveLength(1);
  });

  it("commits swipe navigation with wrap-around and settles on transition end", async () => {
    renderLayer("/docs", undefined, false, true);
    const runway = await screen.findByTestId("swipe-navigation-runway");

    act(() => {
      capturedCallbacks?.onCommit(1, { dx: -120, dy: 0, velocityX: -1 });
    });

    expect(screen.getByTestId("location-probe")).toHaveTextContent("/");
    expect(runway).toHaveAttribute("data-runway-phase", "transitioning");
    expect(runway).toHaveAttribute("data-runway-index", "0");
    expect(mocks.addLog).toHaveBeenCalledWith(
      "debug",
      "[SwipeNav] transition-start",
      expect.objectContaining({ reason: "swipe", from: "Docs", to: "Home", wrapAround: true }),
    );

    fireEvent.transitionEnd(screen.getByTestId("swipe-slot-home"), { target: screen.getByTestId("swipe-slot-home") });
    expect(runway).toHaveAttribute("data-runway-phase", "transitioning");

    fireEvent.transitionEnd(runway, { target: runway });
    expect(runway).toHaveAttribute("data-runway-phase", "idle");
    expect(screen.getByTestId("swipe-slot-home")).toHaveAttribute("data-slot-active", "true");
  });

  it("SPM-NAV-02 swiping left from Play in SID Player opens Settings, and right opens Docs", async () => {
    saveStartupModeByUser("sid-player");
    try {
      renderLayer("/play", undefined, false, true);
      await screen.findByTestId("swipe-navigation-runway");

      act(() => {
        capturedCallbacks?.onCommit(1, { dx: -120, dy: 0, velocityX: -1 });
      });
      expect(screen.getByTestId("location-probe")).toHaveTextContent("/settings");

      const runway = screen.getByTestId("swipe-navigation-runway");
      fireEvent.transitionEnd(runway, { target: runway });
      act(() => {
        capturedCallbacks?.onCommit(-1, { dx: 120, dy: 0, velocityX: 1 });
      });
      fireEvent.transitionEnd(runway, { target: runway });
      act(() => {
        capturedCallbacks?.onCommit(-1, { dx: 120, dy: 0, velocityX: 1 });
      });
      expect(screen.getByTestId("location-probe")).toHaveTextContent("/docs");
    } finally {
      saveStartupModeByUser("default");
    }
  });

  it("SPM-NAV-02 SID Player mounts neither Disks nor Config as a neighbour of Play", async () => {
    saveStartupModeByUser("sid-player");
    try {
      renderLayer("/play", undefined, false, true);
      await screen.findByTestId("swipe-navigation-runway");
      expect(mocks.mountCounts.disks).toBe(0);
      expect(mocks.mountCounts.config).toBe(0);
      expect(mocks.mountCounts.home).toBe(0);
    } finally {
      saveStartupModeByUser("default");
    }
  });

  it("leaves the page and the runway untouched when a guard refuses the swipe commit (HARD27-022)", async () => {
    renderLayer("/docs", undefined, false, true);
    const runway = await screen.findByTestId("swipe-navigation-runway");
    const guard = vi.fn(() => false);
    const release = registerNavigationGuard(guard);

    try {
      act(() => {
        capturedCallbacks?.onCommit(1, { dx: -120, dy: 0, velocityX: -1 });
      });

      expect(guard).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("location-probe")).toHaveTextContent("/docs");
      expect(runway).toHaveAttribute("data-runway-phase", "idle");
      expect(mocks.addLog).not.toHaveBeenCalledWith(
        "debug",
        "[SwipeNav] transition-start",
        expect.objectContaining({ reason: "swipe" }),
      );
    } finally {
      release();
    }
  });

  it("animates route-driven navigation with reduced-motion settings still enabled", async () => {
    currentProfile = "compact";
    document.documentElement.dataset.c64MotionMode = "reduced";
    renderLayer("/", <NavigationProbe />);

    await screen.findByText("Home Page");
    fireEvent.click(screen.getByRole("button", { name: "Go Config" }));

    const container = screen.getByTestId("swipe-navigation-container");
    const runway = screen.getByTestId("swipe-navigation-runway");
    expect(container).toHaveAttribute("data-swipe-motion-mode", "reduced");
    expect(container).toHaveAttribute("data-swipe-effects", "reduced");
    expect(runway.getAttribute("style")).toContain("180ms linear");
    expect(mocks.addLog).toHaveBeenCalledWith(
      "debug",
      "[SwipeNav] route-transition-start",
      expect.objectContaining({ from: "Home", to: "Config", wrapAround: false }),
    );
  });

  it("reserves the bottom navigation band and the toast strip from the swipe viewport height", async () => {
    renderLayer("/");

    const container = await screen.findByTestId("swipe-navigation-container");
    expect(container.getAttribute("style")).toContain(
      "height: calc(100dvh - var(--app-tab-bar-reserved-height) - var(--app-toast-reserved-height, 0px))",
    );
  });

  it("resets accidental horizontal runway scroll drift", async () => {
    renderLayer("/play");

    const container = await screen.findByTestId("swipe-navigation-container");
    act(() => {
      container.scrollLeft = 120;
      fireEvent.scroll(container);
    });

    expect(container.scrollLeft).toBe(0);
    expect(mocks.addLog).toHaveBeenCalledWith(
      "debug",
      "[SwipeNav] reset-scroll-left",
      expect.objectContaining({ reason: "native-scroll", offset: 120 }),
    );
  });

  it("does not read the runway scroll offset while committing a route change", async () => {
    renderLayer("/play", <NavigationProbe />);
    const container = await screen.findByTestId("swipe-navigation-container");
    let reads = 0;
    Object.defineProperty(container, "scrollLeft", {
      configurable: true,
      get: () => {
        reads += 1;
        return 0;
      },
    });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    act(() => {
      fireEvent.click(screen.getByText("Go Config"));
    });

    expect(reads).toBe(0);
    act(() => {
      frames.forEach((frame) => frame(16));
    });
    expect(reads).toBeGreaterThan(0);
  });

  it("re-clears late horizontal drift on the next animation frame", async () => {
    let frameCallback: FrameRequestCallback | null = null;
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        frameCallback = callback;
        return 1;
      });
    const cancelAnimationFrameSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    renderLayer("/play");

    const container = await screen.findByTestId("swipe-navigation-container");
    act(() => {
      container.scrollLeft = 120;
      fireEvent.scroll(container);
      container.scrollLeft = 96;
      frameCallback?.(16);
    });

    expect(container.scrollLeft).toBe(0);
    expect(mocks.addLog).toHaveBeenCalledWith(
      "debug",
      "[SwipeNav] reset-scroll-left",
      expect.objectContaining({ reason: "native-scroll-frame", offset: 96 }),
    );

    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it("uses the slow-motion test probe duration for deterministic evidence", async () => {
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
    renderLayer("/", undefined, false, true);
    const runway = await screen.findByTestId("swipe-navigation-runway");

    act(() => {
      capturedCallbacks?.onCancel({ dx: 0, dy: 0, velocityX: 0 });
    });

    expect(runway.getAttribute("style")).toContain("1200ms linear");
  });

  it("ignores further gesture updates while a transition is already in progress", async () => {
    renderLayer("/play", undefined, false, true);
    const runway = await screen.findByTestId("swipe-navigation-runway");

    act(() => {
      capturedCallbacks?.onCancel({ dx: -12, dy: 0, velocityX: -0.1 });
    });
    expect(runway).toHaveAttribute("data-runway-phase", "transitioning");

    act(() => {
      capturedCallbacks?.onProgress(-80, -1);
      capturedCallbacks?.onCommit(1, { dx: -120, dy: 0, velocityX: -1 });
    });

    expect(runway).toHaveAttribute("data-runway-phase", "transitioning");
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/play");

    fireEvent.transitionEnd(runway, { target: runway });
    expect(runway).toHaveAttribute("data-runway-phase", "idle");
    expect(screen.getByTestId("swipe-slot-play")).toHaveAttribute("data-slot-active", "true");
  });

  it("keeps the target page mounted across route transition completion", async () => {
    renderLayer("/", <NavigationProbe />);

    await screen.findByText("Home Page");
    expect(mocks.mountCounts.config).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Go Config" }));

    const runway = screen.getByTestId("swipe-navigation-runway");
    expect(await screen.findByText("Config Page")).toBeInTheDocument();
    expect(mocks.mountCounts.config).toBe(1);

    fireEvent.transitionEnd(runway, { target: runway });
    expect(mocks.mountCounts.config).toBe(1);
    expect(screen.getByTestId("swipe-slot-config")).toHaveAttribute("data-slot-active", "true");
  });

  describe("page positions", () => {
    const cssSupports = CSS.supports;
    beforeEach(() => {
      CSS.supports = ((property: string, value?: string) =>
        property === "content-visibility" && value === "hidden") as typeof CSS.supports;
    });
    afterEach(() => {
      CSS.supports = cssSupports;
    });

    const visit = (path: string) => {
      fireEvent.click(screen.getByRole("button", { name: `Go ${path}` }));
      const runway = screen.getByTestId("swipe-navigation-runway");
      fireEvent.transitionEnd(runway, { target: runway });
    };

    it("keeps a visited page built and hidden, and shows the same page again at its scroll offset", async () => {
      renderLayer("/play", <PathNavigationProbe />);
      const first = await screen.findByTestId("play-scroller");
      first.scrollTop = 480;

      visit("/settings");
      expect(first).toBeInTheDocument();
      const hidden = screen.getByTestId("swipe-slot-play");
      expect(hidden).toHaveAttribute("data-slot-cached", "true");
      expect(hidden).toHaveAttribute("aria-hidden", "true");
      expect(hidden.style.contentVisibility).toBe("hidden");
      expect(hidden.style.left).toBe(`${-100 / 3}%`);
      expect(hidden).not.toHaveAttribute("inert");
      visit("/play");

      const scroller = await screen.findByTestId("play-scroller");
      expect(scroller).toBe(first);
      expect(scroller.scrollTop).toBe(480);
      const shown = screen.getByTestId("swipe-slot-play");
      expect(shown).not.toHaveAttribute("data-slot-cached");
      expect(shown.style.contentVisibility).toBe("");
      expect(mocks.unmountCounts.play).toBe(0);
    });

    it("hides and disables a kept page some other way where content-visibility is not supported", async () => {
      CSS.supports = (() => false) as typeof CSS.supports;
      renderLayer("/play", <PathNavigationProbe />);
      await screen.findByTestId("play-scroller");
      visit("/settings");
      const hidden = screen.getByTestId("swipe-slot-play");
      expect(hidden.style.contentVisibility).toBe("");
      expect(hidden.style.visibility).toBe("hidden");
      expect(hidden).toHaveAttribute("inert");
      visit("/play");
      const shown = screen.getByTestId("swipe-slot-play");
      expect(shown.style.visibility).toBe("");
      expect(shown).not.toHaveAttribute("inert");
      expect(mocks.unmountCounts.play).toBe(0);
    });

    it("does not re-render a kept page that navigates while other pages are navigated", async () => {
      renderLayer("/", <PathNavigationProbe />);
      await screen.findByText("Home Page");
      visit("/play");
      const rendersWhenHidden = mocks.homeRenders.count;
      visit("/disks");
      visit("/settings");
      expect(mocks.homeRenders.count).toBe(rendersWhenHidden);
    });

    it("shows a kept page the location it last had while other pages are navigated", async () => {
      renderLayer("/docs", <PathNavigationProbe />);
      await screen.findByText("Docs Page");
      visit("/play");
      visit("/disks");
      expect(mocks.docsLastPath.value).toBe("/docs");
      fireEvent.click(screen.getByRole("button", { name: "Go /docs" }));
      const runway = screen.getByTestId("swipe-navigation-runway");
      fireEvent.transitionEnd(runway, { target: runway });
      expect(mocks.docsLastPath.value).toBe("/docs");
    });

    it("rebuilds a kept Settings page that a setting changed behind, at the position it was left", async () => {
      renderLayer("/settings", <PathNavigationProbe />);
      await screen.findByText("Settings Page");
      const before = mocks.settingsInstances.count;
      visit("/play");
      act(() => {
        window.dispatchEvent(new CustomEvent("c64u-app-settings-updated", { detail: { key: "x", value: 1 } }));
      });
      fireEvent.click(screen.getByRole("button", { name: "Go /settings" }));
      await screen.findByText("Settings Page");
      expect(mocks.settingsInstances.count).toBe(before + 1);
    });

    it("keeps a kept Settings page when playback writes a setting it does not show or follows itself", async () => {
      renderLayer("/settings", <PathNavigationProbe />);
      await screen.findByText("Settings Page");
      const before = mocks.settingsInstances.count;
      visit("/play");
      act(() => {
        window.dispatchEvent(
          new CustomEvent("c64u-app-settings-updated", {
            detail: { key: APP_SETTINGS_KEYS.LEARNED_DEVICE_SID_MODEL_KEY, value: "8580" },
          }),
        );
      });
      fireEvent.click(screen.getByRole("button", { name: "Go /settings" }));
      await screen.findByText("Settings Page");
      expect(mocks.settingsInstances.count).toBe(before);
    });

    it("does not draw a kept Settings page's licenses overlay over another tab", async () => {
      renderLayer("/settings/open-source-licenses", <PathNavigationProbe />);
      expect(await screen.findByText("Open Source Licenses Page")).toBeInTheDocument();
      visit("/play");
      expect(screen.queryByText("Open Source Licenses Page")).not.toBeInTheDocument();
      expect(mocks.unmountCounts.settings).toBe(0);
    });

    it("keeps a kept Settings page when nothing changed behind it", async () => {
      renderLayer("/settings", <PathNavigationProbe />);
      await screen.findByText("Settings Page");
      const before = mocks.settingsInstances.count;
      visit("/play");
      fireEvent.click(screen.getByRole("button", { name: "Go /settings" }));
      await screen.findByText("Settings Page");
      expect(mocks.settingsInstances.count).toBe(before);
    });

    it("covers the departing page for the length of the slide, and only then", async () => {
      renderLayer("/play", <PathNavigationProbe />);
      await screen.findByTestId("play-scroller");
      fireEvent.click(screen.getByRole("button", { name: "Go /disks" }));
      const cover = screen.getByTestId("swipe-departing-page-cover");
      expect(cover.style.left).toBe(`${100 / 3}%`);
      const runway = screen.getByTestId("swipe-navigation-runway");
      fireEvent.transitionEnd(runway, { target: runway });
      expect(screen.queryByTestId("swipe-departing-page-cover")).not.toBeInTheDocument();
    });

    it("keeps every visited page in tab order, so showing one never moves another in the document", async () => {
      renderLayer("/disks", <PathNavigationProbe />);
      await screen.findByText("Disks Page");
      visit("/play");
      visit("/");
      const order = () =>
        Array.from(screen.getByTestId("swipe-navigation-runway").children).map((slot) =>
          slot.getAttribute("data-route-index"),
        );
      const cached = () =>
        Array.from(screen.getByTestId("swipe-navigation-runway").querySelectorAll("[data-slot-cached]")).map((slot) =>
          slot.getAttribute("data-route-index"),
        );
      expect(order()).toEqual([...order()].sort());
      expect(cached()).toEqual(["1", "2"]);
    });

    describe("with test probes, which rebuild every page", () => {
      beforeEach(() => {
        (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
      });
      afterEach(() => {
        delete (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled;
      });

      it("opens a page again at the scroll offset it was left at", async () => {
        renderLayer("/play", <PathNavigationProbe />);
        (await screen.findByTestId("play-scroller")).scrollTop = 480;

        visit("/disks");
        expect(screen.queryByTestId("play-scroller")).not.toBeInTheDocument();
        visit("/play");

        const scroller = await screen.findByTestId("play-scroller");
        expect(Number(scroller.getAttribute("data-instance"))).toBeGreaterThan(1);
        expect(scroller.scrollTop).toBe(480);
      });

      it("lets a spec that tests the page cache opt back in", async () => {
        (window as Window & { __c64uCacheVisitedPages?: boolean }).__c64uCacheVisitedPages = true;
        try {
          renderLayer("/play", <PathNavigationProbe />);
          const first = await screen.findByTestId("play-scroller");
          visit("/disks");
          visit("/play");
          expect(await screen.findByTestId("play-scroller")).toBe(first);
        } finally {
          delete (window as Window & { __c64uCacheVisitedPages?: boolean }).__c64uCacheVisitedPages;
        }
      });
    });

    it("opens the page fresh and at the top when its tab is tapped while it is selected", async () => {
      renderLayer("/play", <PathNavigationProbe />);
      (await screen.findByTestId("play-scroller")).scrollTop = 480;
      visit("/disks");
      visit("/play");
      const before = Number((await screen.findByTestId("play-scroller")).getAttribute("data-instance"));

      act(() => requestPageReset(tabIndexForPath("/play")));

      const scroller = await screen.findByTestId("play-scroller");
      expect(Number(scroller.getAttribute("data-instance"))).toBe(before + 1);
      expect(scroller.scrollTop).toBe(0);
    });
  });

  it("suppresses inactive page render failures instead of showing the fallback", async () => {
    shouldThrowDocsPage = true;
    renderLayer("/");

    expect(await screen.findByText("Home Page")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    expect(screen.getByTestId("swipe-slot-docs").textContent).toBe("");
  });

  it("shows the shared page error boundary with a working Try again action for active page failures", async () => {
    shouldThrowDocsPage = true;
    renderLayer("/docs");

    // HARD19-033: SwipeNav now renders the consolidated PageErrorBoundary, which
    // offers a recovery action instead of telling the user to reload the app.
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByTestId("page-error-boundary-fallback")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("Please try reloading the app.")).not.toBeInTheDocument();
    expect(mocks.addErrorLog).toHaveBeenCalledWith(
      "Page render error",
      expect.objectContaining({ message: "docs render failed" }),
    );

    // Tapping Try again clears the error; once the child stops throwing it
    // re-renders (proves the recovery path, not just the affordance).
    shouldThrowDocsPage = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Docs Page")).toBeInTheDocument();
  });

  it("settles via a synthesized transition end when transitionend never fires", async () => {
    // Render and find elements with real timers first so async queries work normally.
    renderLayer("/", undefined, false, true);
    const runway = await screen.findByTestId("swipe-navigation-runway");

    vi.useFakeTimers();
    try {
      act(() => {
        capturedCallbacks?.onCommit(1, { dx: -120, dy: 0, velocityX: -1 });
      });
      expect(runway).toHaveAttribute("data-runway-phase", "transitioning");

      // Do NOT fire transitionEnd — simulate the CSS engine not delivering the event.
      act(() => {
        vi.advanceTimersByTime(320);
      });

      expect(runway).toHaveAttribute("data-runway-phase", "idle");
      expect(mocks.addLog).toHaveBeenCalledWith(
        "debug",
        "[SwipeNav] transition-end-synthesized",
        expect.objectContaining({ settleAfterMs: 320 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets an orphaned drag back to idle when pointer end never arrives", async () => {
    renderLayer("/play", undefined, false, true);
    const runway = await screen.findByTestId("swipe-navigation-runway");

    vi.useFakeTimers();
    try {
      act(() => {
        capturedCallbacks?.onProgress(-96, -0.5);
      });
      expect(runway).toHaveAttribute("data-runway-phase", "dragging");

      act(() => {
        vi.advanceTimersByTime(600);
      });

      expect(runway).toHaveAttribute("data-runway-phase", "idle");
      expect(mocks.addLog).toHaveBeenCalledWith(
        "debug",
        "[SwipeNav] drag-reset-synthesized",
        expect.objectContaining({ center: "Play", settleAfterMs: 600, dragOffsetPx: -96 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not snap a held-still drag back to idle while the pointer is still down (HARD9-026)", async () => {
    // Regression: the settle timer used to re-arm on every dx change, so a
    // pointer held stationary (finger still down, just paused) for >600ms
    // was indistinguishable from a genuinely missed pointerup and got
    // snapped back to idle under the user's finger.
    renderLayer("/play", undefined, false, true);
    const runway = await screen.findByTestId("swipe-navigation-runway");

    vi.useFakeTimers();
    try {
      act(() => {
        capturedCallbacks?.onProgress(-96, -0.5);
        capturedCallbacks?.onActiveChange?.(true);
      });
      expect(runway).toHaveAttribute("data-runway-phase", "dragging");

      act(() => {
        vi.advanceTimersByTime(600);
      });

      // The pointer is still reported active, so the runway must still be
      // dragging - not synthesized back to idle out from under the user.
      expect(runway).toHaveAttribute("data-runway-phase", "dragging");
      expect(mocks.addLog).not.toHaveBeenCalledWith("debug", "[SwipeNav] drag-reset-synthesized", expect.anything());

      // Once the pointer genuinely lifts, the next check settles normally.
      act(() => {
        capturedCallbacks?.onActiveChange?.(false);
        vi.advanceTimersByTime(600);
      });
      expect(runway).toHaveAttribute("data-runway-phase", "idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the runway container inert while an interstitial is active", async () => {
    renderLayer("/", undefined, true);

    expect(await screen.findByTestId("swipe-navigation-container")).toHaveAttribute("data-interstitial-active", "true");
    expect(screen.getByTestId("swipe-navigation-container")).toHaveAttribute("inert", "");
  });

  // HARD12-022: the departing page stays mounted for the whole transition, and pages holding state across
  // the overlap defend themselves per effect (BUG-040 wake lock, HARD12-006 volume session, HARD12-020
  // machine-execution state). A kept page is never unmounted at all: it is hidden when the runway settles.
  it("keeps the departing page mounted through the transition and kept, hidden, after it settles (HARD12-022)", async () => {
    renderLayer("/play", undefined, false, true);
    const runway = await screen.findByTestId("swipe-navigation-runway");
    expect(mocks.mountCounts.play).toBe(1);
    act(() => {
      capturedCallbacks?.onCommit(1, { dx: -120, dy: 0, velocityX: -1 });
    });
    expect(runway).toHaveAttribute("data-runway-phase", "transitioning");
    expect(screen.getByText("Play Page")).toBeInTheDocument();
    expect(screen.getByTestId("swipe-slot-play")).not.toHaveAttribute("data-slot-cached");
    expect(mocks.mountCounts.disks).toBe(1);

    fireEvent.transitionEnd(runway, { target: runway });

    expect(screen.getByText("Play Page")).toBeInTheDocument();
    expect(screen.getByTestId("swipe-slot-play")).toHaveAttribute("data-slot-cached", "true");
    expect(mocks.unmountCounts.play).toBe(0);
    expect(mocks.mountCounts.play).toBe(1);
    expect(mocks.unmountCounts.disks).toBe(0);
  });

  // HARD27-038: a transition moves in exactly one direction, so only the
  // departing page and the arriving page are ever on screen. The panel on the
  // opposite side is off screen for the whole transition, and mounting it costs
  // a full page hook tree - queries, subscriptions and effects - during the
  // animation frame budget. These three tests pin that it stays a placeholder.
  it("does not mount the off-direction page during a route transition (HARD27-038)", async () => {
    renderLayer("/", <NavigationProbe />);

    await screen.findByText("Home Page");

    fireEvent.click(screen.getByRole("button", { name: "Go Config" }));

    // Home (0) to Config (3) resolves to direction 1, so the runway holds
    // [Docs, Home, Config]. Docs is behind the departing page and never seen.
    const runway = screen.getByTestId("swipe-navigation-runway");
    expect(runway).toHaveAttribute("data-runway-phase", "transitioning");
    expect(await screen.findByText("Config Page")).toBeInTheDocument();
    expect(screen.getByText("Home Page")).toBeInTheDocument();
    expect(mocks.mountCounts.docs).toBe(0);
    expect(screen.getByTestId("swipe-slot-docs").textContent).toBe("");
  });

  it("does not mount the off-direction page during a committed swipe (HARD27-038)", async () => {
    renderLayer("/play", undefined, false, true);
    const runway = await screen.findByTestId("swipe-navigation-runway");

    act(() => {
      capturedCallbacks?.onCommit(1, { dx: -120, dy: 0, velocityX: -1 });
    });

    expect(runway).toHaveAttribute("data-runway-phase", "transitioning");
    expect(screen.getByText("Play Page")).toBeInTheDocument();
    expect(mocks.mountCounts.disks).toBe(1);
    expect(mocks.mountCounts.home).toBe(0);
  });

  it("mounts only the dragged-toward page, and keeps it mounted when the drag reverses (HARD27-038)", async () => {
    renderLayer("/play", undefined, false, true);
    const runway = await screen.findByTestId("swipe-navigation-runway");

    // Dragging left pulls the next page (Disks) in from the right edge.
    act(() => {
      capturedCallbacks?.onProgress(-80, -1);
    });
    expect(runway).toHaveAttribute("data-runway-phase", "dragging");
    expect(mocks.mountCounts.disks).toBe(1);
    expect(mocks.mountCounts.home).toBe(0);

    // Reversing reveals the previous page. The page already revealed stays
    // mounted, so a wavering finger cannot churn mounts and unmounts.
    act(() => {
      capturedCallbacks?.onProgress(80, 1);
    });
    expect(mocks.mountCounts.home).toBe(1);
    expect(mocks.mountCounts.disks).toBe(1);
    expect(mocks.unmountCounts.disks).toBe(0);
  });
});

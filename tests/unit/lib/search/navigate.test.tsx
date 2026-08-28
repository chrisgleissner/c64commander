/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerNavigationGuard } from "@/lib/navigation/navigationGuards";
import {
  ANCHOR_WAIT_CEILING_MS,
  LANDING_HIGHLIGHT_MS,
  markLanded,
  navigateToSearchTarget,
  waitForElement,
} from "@/lib/search/navigate";
import { SECTION_OPEN_REQUEST_EVENT } from "@/lib/ui/collapsibleSectionStore";

const mountSection = (scope: string, id: string) => {
  const element = document.createElement("section");
  element.setAttribute("data-section-scope", scope);
  element.setAttribute("data-section-id", id);
  document.body.appendChild(element);
  return element;
};

const mountControl = (testId: string) => {
  const element = document.createElement("button");
  element.setAttribute("data-testid", testId);
  document.body.appendChild(element);
  return element;
};

describe("waitForElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns an element that is already there without waiting", async () => {
    const element = mountControl("already-here");
    await expect(waitForElement('[data-testid="already-here"]')).resolves.toBe(element);
  });

  it("returns an element that appears later", async () => {
    const promise = waitForElement('[data-testid="appears-later"]');
    const element = mountControl("appears-later");
    await expect(promise).resolves.toBe(element);
  });

  it("gives up at its ceiling rather than waiting forever", async () => {
    vi.useFakeTimers();
    try {
      const promise = waitForElement('[data-testid="never-appears"]', 50);
      await vi.advanceTimersByTimeAsync(51);
      await expect(promise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("has a ceiling of two seconds", () => {
    expect(ANCHOR_WAIT_CEILING_MS).toBe(2_000);
  });
});

describe("markLanded", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("sets and then clears the landing attribute", () => {
    vi.useFakeTimers();
    const element = mountControl("landed");
    markLanded(element);
    expect(element.getAttribute("data-search-landed")).toBe("true");
    vi.advanceTimersByTime(LANDING_HIGHLIGHT_MS + 1);
    expect(element.hasAttribute("data-search-landed")).toBe(false);
  });
});

describe("navigateToSearchTarget", () => {
  const options = () => ({
    navigate: vi.fn(),
    currentPath: "/",
    label: "Test target",
    onToast: vi.fn(),
    runAction: vi.fn(),
  });

  beforeEach(() => {
    document.body.innerHTML = "";
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("navigates to a route it is not already on", async () => {
    const opts = options();
    await expect(navigateToSearchTarget({ kind: "route", path: "/play" }, opts)).resolves.toBe("landed");
    expect(opts.navigate).toHaveBeenCalledWith("/play");
  });

  it("does not navigate to the route it is already on", async () => {
    const opts = options();
    await navigateToSearchTarget({ kind: "route", path: "/" }, opts);
    expect(opts.navigate).not.toHaveBeenCalled();
  });

  it("runs the handler for an action target and navigates nowhere itself", async () => {
    const opts = options();
    await expect(navigateToSearchTarget({ kind: "action", handlerId: "startSidRadio" }, opts)).resolves.toBe("handled");
    expect(opts.runAction).toHaveBeenCalledWith("startSidRadio");
    expect(opts.navigate).not.toHaveBeenCalled();
  });

  it("refuses to move when a navigation guard says no, so the caller can show why", async () => {
    const opts = options();
    const release = registerNavigationGuard(() => false);
    try {
      await expect(navigateToSearchTarget({ kind: "route", path: "/play" }, opts)).resolves.toBe("blocked");
      expect(opts.navigate).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it("asks the named section to open and lands on it", async () => {
    const opts = options();
    const section = mountSection("home", "drives");
    const requests: string[] = [];
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: string; id: string }>).detail;
      requests.push(`${detail.scope}:${detail.id}`);
    };
    window.addEventListener(SECTION_OPEN_REQUEST_EVENT, listener);
    try {
      await expect(
        navigateToSearchTarget({ kind: "section", path: "/", scope: "home", id: "drives" }, opts),
      ).resolves.toBe("landed");
      expect(requests).toContain("home:drives");
      expect(section.getAttribute("data-search-landed")).toBe("true");
    } finally {
      window.removeEventListener(SECTION_OPEN_REQUEST_EVENT, listener);
    }
  });

  it("finds a section by scope and id, not by testid, so a testid rename cannot break it", async () => {
    const opts = options();
    const section = mountSection("home", "drives");
    section.setAttribute("data-testid", "some-other-name-entirely");
    await expect(
      navigateToSearchTarget({ kind: "section", path: "/", scope: "home", id: "drives" }, opts),
    ).resolves.toBe("landed");
  });

  it("lands on the named control inside its section and focuses it", async () => {
    const opts = options();
    mountSection("settings", "appearance");
    const control = mountControl("settings-text-size");
    await expect(
      navigateToSearchTarget(
        {
          kind: "control",
          path: "/settings",
          scope: "settings",
          sectionId: "appearance",
          testId: "settings-text-size",
        },
        { ...opts, currentPath: "/settings" },
      ),
    ).resolves.toBe("landed");
    expect(document.activeElement).toBe(control);
  });

  it("toasts, naming what could not be reached, rather than failing silently", async () => {
    vi.useFakeTimers();
    try {
      const opts = options();
      const promise = navigateToSearchTarget({ kind: "section", path: "/", scope: "home", id: "missing" }, opts);
      await vi.advanceTimersByTimeAsync(ANCHOR_WAIT_CEILING_MS + 1);
      await expect(promise).resolves.toBe("not-found");
      expect(opts.onToast).toHaveBeenCalledWith("Could not reach Test target");
    } finally {
      vi.useRealTimers();
    }
  });

  it("toasts when the section is there but the control inside it never renders", async () => {
    vi.useFakeTimers();
    try {
      const opts = options();
      mountSection("settings", "appearance");
      const promise = navigateToSearchTarget(
        { kind: "control", path: "/settings", scope: "settings", sectionId: "appearance", testId: "never-renders" },
        { ...opts, currentPath: "/settings" },
      );
      await vi.advanceTimersByTimeAsync(ANCHOR_WAIT_CEILING_MS + 1);
      await expect(promise).resolves.toBe("not-found");
      expect(opts.onToast).toHaveBeenCalledWith("Could not reach Test target");
    } finally {
      vi.useRealTimers();
    }
  });
});

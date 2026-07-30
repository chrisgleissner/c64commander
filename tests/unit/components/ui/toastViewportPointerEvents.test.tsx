/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The toast viewport is a container, not a surface.
 *
 * It is a fixed box at z-100 as tall as every stacked toast plus its own bottom padding. On a
 * phone it is anchored below the app bar on the left, which puts it squarely over the Play page's
 * transport row. While it captured pointer events, its gaps and padding swallowed taps meant for
 * Play, Pause and Next — so after an error toast appeared the transport stopped responding until
 * the toast expired. Measured on a Pixel 4: `elementFromPoint` over the Play button returned the
 * viewport, and playback could only be started by dispatching the click directly. That is the
 * worst possible moment to lose the transport, and to the listener it is simply a dead button.
 *
 * jsdom does no layout, so hit-testing cannot be reproduced here. What can be pinned is the
 * invariant that makes it impossible: the container never captures, and each toast opts back in.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toast, ToastProvider, ToastViewport } from "@/components/ui/toast";

const classesOf = (element: Element | null) => (element?.getAttribute("class") ?? "").split(/\s+/);

describe("toast viewport pointer events", () => {
  it("does not capture taps meant for the page beneath it", () => {
    const { container } = render(
      <ToastProvider>
        <ToastViewport />
      </ToastProvider>,
    );
    const viewport = container.ownerDocument.querySelector("ol");
    expect(classesOf(viewport)).toContain("pointer-events-none");
    expect(classesOf(viewport)).not.toContain("pointer-events-auto");
  });

  it("still lets a toast itself be tapped and swiped", () => {
    render(
      <ToastProvider>
        <Toast open>notice</Toast>
        <ToastViewport />
      </ToastProvider>,
    );
    const toast = document.querySelector("li");
    // Toasts are entry points into Diagnostics and are dismissed by tap or swipe, so the one thing
    // that must keep capturing is the toast itself.
    expect(classesOf(toast)).toContain("pointer-events-auto");
  });
});

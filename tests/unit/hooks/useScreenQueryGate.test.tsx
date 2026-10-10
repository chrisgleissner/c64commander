/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { ScreenActivityProvider, useScreenQueryGate } from "@/hooks/useScreenActivity";

const renders: Record<string, number> = {};
const answers: Record<string, boolean> = {};

const Reader = ({ name, wanted }: { name: string; wanted: boolean }) => {
  renders[name] = (renders[name] ?? 0) + 1;
  answers[name] = useScreenQueryGate(wanted);
  return null;
};

// The readers sit below a memo boundary, as a page's rows do below a page element that does not change.
const Readers = React.memo(function Readers() {
  return (
    <>
      <Reader name="idle" wanted={false} />
      <Reader name="wanted" wanted={true} />
    </>
  );
});

describe("useScreenQueryGate", () => {
  it("answers wanted && screen active, and re-renders only a reader whose answer changed", () => {
    const { rerender } = render(
      <ScreenActivityProvider active={true}>
        <Readers />
      </ScreenActivityProvider>,
    );
    expect(answers).toEqual({ idle: false, wanted: true });
    const idleRenders = renders.idle;
    const wantedRenders = renders.wanted;

    act(() => {
      rerender(
        <ScreenActivityProvider active={false}>
          <Readers />
        </ScreenActivityProvider>,
      );
    });

    expect(answers).toEqual({ idle: false, wanted: false });
    expect(renders.idle).toBe(idleRenders);
    expect(renders.wanted).toBe(wantedRenders + 1);
  });

  it("lets a query run while the whole app is in the background, as the screen-activity gate always has", () => {
    const hidden = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    try {
      render(
        <ScreenActivityProvider active={false}>
          <Reader name="background" wanted={true} />
        </ScreenActivityProvider>,
      );
      expect(answers.background).toBe(true);
    } finally {
      if (hidden) Object.defineProperty(document, "hidden", hidden);
      delete (document as { hidden?: boolean }).hidden;
    }
  });
});

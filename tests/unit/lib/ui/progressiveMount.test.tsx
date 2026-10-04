/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountAllWaiting, setProgressiveMountEnabled, useProgressiveMount } from "@/lib/ui/progressiveMount";
import { requestSectionOpen } from "@/lib/ui/collapsibleSectionStore";

/** `top` is where the card starts, in px; the test viewport is 768 px tall. */
const Card = ({
  id,
  wanted,
  top = 5000,
  rememberedHeight,
}: {
  id: string;
  wanted: boolean;
  top?: number;
  rememberedHeight?: number;
}) => {
  const anchor = useRef<HTMLElement | null>(null);
  const mounted = useProgressiveMount(wanted, anchor, rememberedHeight);
  return (
    <section ref={anchor} data-top={top} data-section-scope="test" data-section-id={id}>
      {wanted && mounted ? <div data-testid={`body-${id}`} /> : <div data-testid={`pending-${id}`} />}
    </section>
  );
};

const nextPaintAndTask = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 0));
      }),
  );
const nextTask = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  setProgressiveMountEnabled(true);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = Number(this.getAttribute("data-top") ?? 0);
    return { top, bottom: top + 100 } as DOMRect;
  });
});
afterEach(() => {
  setProgressiveMountEnabled(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useProgressiveMount", () => {
  it("does not spend the first two immediate mounts on measured cards outside the viewport", async () => {
    render(
      <>
        <Card id="a" wanted rememberedHeight={400} />
        <Card id="b" wanted rememberedHeight={400} />
        <Card id="c" wanted top={300} rememberedHeight={400} />
      </>,
    );
    await nextPaintAndTask();
    expect(screen.getByTestId("pending-a")).toBeInTheDocument();
    expect(screen.getByTestId("pending-b")).toBeInTheDocument();
    expect(screen.getByTestId("body-c")).toBeInTheDocument();
  });

  it("leaves measured offscreen bodies unmounted after idle tasks and mounts them before scrolling into view", async () => {
    render(
      <>
        <Card id="a" wanted />
        <Card id="b" wanted />
        <Card id="c" wanted rememberedHeight={400} />
      </>,
    );
    await nextPaintAndTask();
    await nextTask();
    expect(screen.getByTestId("pending-c")).toBeInTheDocument();
    screen.getByTestId("pending-c").parentElement!.setAttribute("data-top", "300");
    await act(async () => {
      document.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(screen.getByTestId("body-c")).toBeInTheDocument();
  });

  it("does not build measured bodies above the restored viewport", async () => {
    render(
      <>
        <Card id="a" wanted />
        <Card id="b" wanted />
        <Card id="c" wanted top={-5000} rememberedHeight={400} />
      </>,
    );
    await nextPaintAndTask();
    expect(screen.getByTestId("pending-c")).toBeInTheDocument();
    act(() => {
      expect(mountAllWaiting()).toBe(true);
    });
    expect(screen.getByTestId("body-c")).toBeInTheDocument();
    expect(mountAllWaiting()).toBe(false);
  });

  it("builds an explicitly requested measured section while it is still offscreen", async () => {
    render(
      <>
        <Card id="a" wanted />
        <Card id="b" wanted />
        <Card id="c" wanted rememberedHeight={400} />
      </>,
    );
    await nextPaintAndTask();
    act(() => requestSectionOpen("other", "c"));
    expect(screen.getByTestId("pending-c")).toBeInTheDocument();
    act(() => requestSectionOpen("test", "c"));
    expect(screen.getByTestId("body-c")).toBeInTheDocument();
  });

  it("mounts more measured content immediately when a larger viewport can show it", () => {
    vi.stubGlobal("innerHeight", 4000);
    render(
      <>
        <Card id="a" wanted />
        <Card id="b" wanted />
        <Card id="c" wanted top={3000} rememberedHeight={400} />
      </>,
    );
    expect(screen.getByTestId("body-c")).toBeInTheDocument();
  });

  it("mounts the first two open cards at once and the rest one per task after the first paint", async () => {
    render(
      <>
        {["a", "b", "c", "d"].map((id) => (
          <Card key={id} id={id} wanted />
        ))}
      </>,
    );
    expect(screen.getByTestId("body-a")).toBeInTheDocument();
    expect(screen.getByTestId("body-b")).toBeInTheDocument();
    expect(screen.getByTestId("pending-c")).toBeInTheDocument();
    expect(screen.getByTestId("pending-d")).toBeInTheDocument();

    await nextPaintAndTask();
    expect(screen.getByTestId("body-c")).toBeInTheDocument();
    expect(screen.getByTestId("pending-d")).toBeInTheDocument();

    await nextTask();
    expect(screen.getByTestId("body-d")).toBeInTheDocument();
  });

  it("mounts a card that starts on screen before the first paint, however many came before it", () => {
    render(
      <>
        <Card id="a" wanted top={0} />
        <Card id="b" wanted top={200} />
        <Card id="c" wanted top={400} />
        <Card id="d" wanted top={5000} />
      </>,
    );
    expect(screen.getByTestId("body-c")).toBeInTheDocument();
    expect(screen.getByTestId("pending-d")).toBeInTheDocument();
  });

  it("builds a waiting card at once when a scroll brings it near the screen before its turn", async () => {
    render(
      <>
        {["a", "b", "c", "d", "e", "f"].map((id) => (
          <Card key={id} id={id} wanted />
        ))}
      </>,
    );
    expect(screen.getByTestId("pending-f")).toBeInTheDocument();

    screen.getByTestId("pending-f").parentElement!.setAttribute("data-top", "300");
    await act(
      () =>
        new Promise<void>((resolve) => {
          document.dispatchEvent(new Event("scroll"));
          requestAnimationFrame(() => resolve());
        }),
    );

    expect(screen.getByTestId("body-f")).toBeInTheDocument();
    expect(screen.getByTestId("pending-e")).toBeInTheDocument();
  });

  it("mounts a card opened after the first render at once", async () => {
    const { rerender } = render(
      <>
        <Card id="a" wanted />
        <Card id="b" wanted />
        <Card id="c" wanted={false} />
      </>,
    );
    await nextTask();
    rerender(
      <>
        <Card id="a" wanted />
        <Card id="b" wanted />
        <Card id="c" wanted />
      </>,
    );
    expect(screen.getByTestId("body-c")).toBeInTheDocument();
  });

  it("mounts everything at once when switched off", () => {
    setProgressiveMountEnabled(false);
    render(
      <>
        {["a", "b", "c"].map((id) => (
          <Card key={id} id={id} wanted rememberedHeight={400} />
        ))}
      </>,
    );
    expect(screen.getByTestId("body-c")).toBeInTheDocument();
  });
});

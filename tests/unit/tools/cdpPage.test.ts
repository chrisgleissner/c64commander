/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectPage } from "../../../tools/hil/cdp_page.mjs";

type Listener = (event?: { data: string }) => void;

class FakeSocket {
  static opensItself = true;
  static last: FakeSocket | null = null;
  private listeners = new Map<string, Listener[]>();

  constructor() {
    FakeSocket.last = this;
    if (FakeSocket.opensItself) queueMicrotask(() => this.emit("open"));
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, event?: { data: string }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  send(raw: string) {
    const { id } = JSON.parse(raw) as { id: number };
    queueMicrotask(() => this.emit("message", { data: JSON.stringify({ id, result: { ok: true } }) }));
  }

  close() {
    this.emit("close");
  }
}

describe("connectPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.opensItself = true;
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => [{ type: "page", webSocketDebuggerUrl: "ws://fake", url: "x" }] })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("leaves no timer behind once a request has been answered", async () => {
    const page = await connectPage("9333");

    await expect(page.send("Runtime.evaluate")).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives up on a socket that never opens", async () => {
    FakeSocket.opensItself = false;
    const connecting = connectPage("9333", { openTimeoutMs: 500 });
    const failure = expect(connecting).rejects.toThrow(/did not open within 500 ms/);

    await vi.advanceTimersByTimeAsync(500);

    await failure;
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emitKeyInputDiagnostics = vi.hoisted(() => vi.fn());
vi.mock("@/lib/diagnostics/keyInputDiagnostics", () => ({ emitKeyInputDiagnostics }));

import { KeyExplorerPopup } from "@/components/diagnostics/KeyExplorerPopup";
import { formatObservations, observeKey, redactKey } from "@/lib/diagnostics/keyExplorer";
import { keypadProfile } from "@/lib/input/profiles/keypad";
import { loadDebugLoggingEnabled } from "@/lib/config/appSettings";

const press = (init: KeyboardEventInit) => fireEvent.keyDown(window, init);

describe("Key Explorer", () => {
  beforeEach(() => {
    localStorage.clear();
    emitKeyInputDiagnostics.mockClear();
  });

  /*
   * It cannot reuse the existing key diagnostics: those emit only when debug logging is on, and
   * this panel is most needed on a handset nobody has put into debug mode.
   */
  it("records keys with debug logging OFF", () => {
    expect(loadDebugLoggingEnabled()).toBe(false);
    render(<KeyExplorerPopup open onClose={() => undefined} />);
    press({ code: "F1", key: "F1", keyCode: 112 });
    expect(screen.getByTestId("key-explorer-list").textContent).toContain("code=F1");
  });

  it("shows what a key resolves to, and says so when it resolves to nothing", () => {
    render(<KeyExplorerPopup open onClose={() => undefined} />);
    press({ code: "F1", key: "F1", keyCode: 112 });
    expect(screen.getByTestId("key-explorer-list").textContent).toContain("resolves to mediaPlayPause");

    press({ code: "F9", key: "F9", keyCode: 120 });
    expect(screen.getAllByTestId("key-explorer-action")[0].textContent).toBe("resolves to nothing");
  });

  it("reports an empty code, which is what an Android WebView sends for a keypad digit", () => {
    render(<KeyExplorerPopup open onClose={() => undefined} />);
    press({ code: "", key: "7", keyCode: 55 });
    expect(screen.getByTestId("key-explorer-list").textContent).toContain("code=<empty>");
    expect(screen.getByTestId("key-explorer-list").textContent).toContain("keyCode=55");
  });

  describe("privacy", () => {
    it("records no character a key produced", () => {
      render(<KeyExplorerPopup open onClose={() => undefined} />);
      press({ code: "KeyS", key: "s", keyCode: 83 });
      const text = screen.getByTestId("key-explorer-list").textContent ?? "";
      expect(text).toContain("code=KeyS");
      expect(text).toContain("key=<character>");
      expect(text).not.toContain("key=s");
    });

    it("reduces a digit and a space to their shape, not their value", () => {
      expect(redactKey("7")).toBe("<digit>");
      expect(redactKey(" ")).toBe("<space>");
      expect(redactKey("a")).toBe("<character>");
    });

    it("keeps a named key as it is, because the name is the answer being looked for", () => {
      expect(redactKey("Escape")).toBe("Escape");
      expect(redactKey("F1")).toBe("F1");
    });

    it("records nothing from a field's contents, because it records only the event's identity", () => {
      render(<KeyExplorerPopup open onClose={() => undefined} />);
      const input = document.createElement("input");
      input.value = "my-secret-password";
      document.body.appendChild(input);
      fireEvent.keyDown(input, { code: "KeyM", key: "m", keyCode: 77 });
      const text = screen.getByTestId("key-explorer-list").textContent ?? "";
      expect(text).not.toContain("my-secret-password");
      expect(text).not.toContain("key=m");
    });
  });

  it("keeps only the last ten", () => {
    render(<KeyExplorerPopup open onClose={() => undefined} />);
    for (let index = 0; index < 15; index += 1) press({ code: `F${index}`, key: `F${index}`, keyCode: 200 + index });
    expect(screen.getByTestId("key-explorer-list").children).toHaveLength(10);
    expect(screen.getByTestId("key-explorer-list").textContent).toContain("code=F14");
    expect(screen.getByTestId("key-explorer-list").textContent).not.toContain("code=F4 ");
  });

  it("stops listening once the panel closes", () => {
    const { rerender } = render(<KeyExplorerPopup open onClose={() => undefined} />);
    rerender(<KeyExplorerPopup open={false} onClose={() => undefined} />);
    press({ code: "F1", key: "F1", keyCode: 112 });
    rerender(<KeyExplorerPopup open onClose={() => undefined} />);
    expect(screen.getByTestId("key-explorer-empty")).toBeInTheDocument();
  });

  it("clears the list on request", () => {
    render(<KeyExplorerPopup open onClose={() => undefined} />);
    press({ code: "F1", key: "F1", keyCode: 112 });
    fireEvent.click(screen.getByTestId("key-explorer-clear"));
    expect(screen.getByTestId("key-explorer-empty")).toBeInTheDocument();
  });

  describe("the copyable report", () => {
    it("names the code, the keyCode and what it resolved to", () => {
      const observation = observeKey(new KeyboardEvent("keydown", { code: "F1", key: "F1" }), keypadProfile);
      expect(formatObservations([observation])).toContain("code=F1");
      expect(formatObservations([observation])).toContain("action=mediaPlayPause");
    });

    it("says so plainly when a key resolved to nothing", () => {
      const observation = observeKey(new KeyboardEvent("keydown", { code: "F9", key: "F9" }), keypadProfile);
      expect(formatObservations([observation])).toContain("action=<unbound>");
    });

    it("has something to say with nothing recorded", () => {
      expect(formatObservations([])).toBe("No keys recorded.");
    });
  });
});
